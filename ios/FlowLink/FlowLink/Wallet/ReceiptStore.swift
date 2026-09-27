import Foundation
import SQLite3

// A connection is confined to its actor. BEGIN IMMEDIATE + conditional lease claims
// arbitrate other connections/processes; an actor alone is not the concurrency boundary.
@MainActor final class ReceiptStore {
  private var db: OpaquePointer?
  private let namespace: String
  private let device: String
  private let origin: String
  private let limit: Int
  init(directory: URL, installation: String, device: String, origin: String, limit: Int = 500)
    throws
  {
    self.namespace = installation
    self.device = device
    self.origin = origin
    self.limit = limit
    do {
      try FileManager.default.createDirectory(
        at: directory, withIntermediateDirectories: true,
        attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
      var folder = directory
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try folder.setResourceValues(values)
      let url = directory.appendingPathComponent("captures.sqlite")
      guard
        sqlite3_open_v2(
          url.path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil)
          == SQLITE_OK
      else { throw CaptureError.storage }
      try FileManager.default.setAttributes(
        [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
        ofItemAtPath: url.path)
      sqlite3_busy_timeout(db, 2000)
      // <= 600 x 4096-byte pages + rollback journal stays below 5 MiB.
      try exec(
        "PRAGMA page_size=4096; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA fullfsync=ON; PRAGMA max_page_count=600;"
      )
      try exec(
        """
        CREATE TABLE IF NOT EXISTS receipts (
          id TEXT PRIMARY KEY, installation TEXT NOT NULL, device TEXT NOT NULL, origin TEXT NOT NULL,
          frozen TEXT NOT NULL, created REAL NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
          next REAL NOT NULL, last REAL, outcome TEXT, lease TEXT);
        CREATE TRIGGER IF NOT EXISTS immutable_capture BEFORE UPDATE OF id,installation,device,origin,frozen,created ON receipts
        BEGIN SELECT RAISE(ABORT,'immutable'); END;
        """)
      // Local receipt schema upgrade: retain delivered captures for 30 days from
      // acknowledgement, including captures that spent weeks offline.
      try transaction {
        let columns = try statement("PRAGMA table_info(receipts)")
        var hasAcknowledgedAt = false
        while sqlite3_step(columns) == SQLITE_ROW {
          if let value = sqlite3_column_text(columns, 1), String(cString: value) == "acknowledged" {
            hasAcknowledgedAt = true
          }
        }
        sqlite3_finalize(columns)
        if !hasAcknowledgedAt { try exec("ALTER TABLE receipts ADD COLUMN acknowledged REAL") }
        // Pre-upgrade delivered receipts get a conservative fresh retention window.
        try update(
          "UPDATE receipts SET acknowledged=? WHERE state='delivered' AND acknowledged IS NULL",
          [String(Date().timeIntervalSince1970)])
      }
    } catch {
      if let db { sqlite3_close(db) }
      db = nil
      throw CaptureError.storage
    }
  }
  isolated deinit { if let db { sqlite3_close(db) } }
  private func exec(_ sql: String) throws {
    guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw CaptureError.storage }
  }
  private func statement(_ sql: String, _ values: [String?] = []) throws -> OpaquePointer {
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else {
      throw CaptureError.storage
    }
    for (index, value) in values.enumerated() {
      let status: Int32
      if let value {
        status = value.withCString {
          sqlite3_bind_text(
            stmt, Int32(index + 1), $0, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        }
      } else {
        status = sqlite3_bind_null(stmt, Int32(index + 1))
      }
      if status != SQLITE_OK {
        sqlite3_finalize(stmt)
        throw CaptureError.storage
      }
    }
    return stmt
  }
  private func update(_ sql: String, _ values: [String?] = []) throws {
    let stmt = try statement(sql, values)
    defer { sqlite3_finalize(stmt) }
    guard sqlite3_step(stmt) == SQLITE_DONE else { throw CaptureError.storage }
  }
  private func transaction<T>(_ body: () throws -> T) throws -> T {
    try exec("BEGIN IMMEDIATE")
    do {
      let value = try body()
      try exec("COMMIT")
      return value
    } catch {
      try? exec("ROLLBACK")
      throw error
    }
  }
  func insert(_ capture: FrozenCapture, now: Date) throws {
    guard capture.installation == namespace, capture.device == device, capture.origin == origin,
      FrozenCapture.hash(capture.bytes) == capture.sha256
    else { throw CaptureError.storage }
    try transaction {
      try update(
        "DELETE FROM receipts WHERE state='delivered' AND acknowledged < ?",
        [String(now.addingTimeInterval(-30 * 86400).timeIntervalSince1970)])
      let count = try statement("SELECT count(*) FROM receipts")
      defer { sqlite3_finalize(count) }
      guard sqlite3_step(count) == SQLITE_ROW, sqlite3_column_int(count, 0) < limit else {
        throw CaptureError.capacity
      }
      let frozen = String(decoding: try JSONEncoder().encode(capture), as: UTF8.self)
      try update(
        "INSERT INTO receipts(id,installation,device,origin,frozen,created,state,next) VALUES(?,?,?,?,?,?,'queued',?)",
        [
          capture.id, namespace, device, origin, frozen,
          String(capture.capturedAt.timeIntervalSince1970), String(now.timeIntervalSince1970),
        ])
    }
  }
  func list() throws -> [CaptureReceipt] {
    let stmt = try statement(
      "SELECT frozen,state,attempts,next,last,outcome FROM receipts WHERE installation=? AND device=? AND origin=? ORDER BY created DESC",
      [namespace, device, origin])
    defer { sqlite3_finalize(stmt) }
    var result: [CaptureReceipt] = []
    func string(_ index: Int32) -> String? {
      sqlite3_column_text(stmt, index).map { String(cString: $0) }
    }
    while true {
      let status = sqlite3_step(stmt)
      if status == SQLITE_DONE { break }
      guard status == SQLITE_ROW else { throw CaptureError.storage }
      guard let json = string(0), let state = string(1).flatMap(ReceiptState.init(rawValue:)) else {
        throw CaptureError.storage
      }
      let capture = try JSONDecoder().decode(FrozenCapture.self, from: Data(json.utf8))
      guard FrozenCapture.hash(capture.bytes) == capture.sha256 else { throw CaptureError.storage }
      result.append(
        CaptureReceipt(
          capture: capture, state: state, attempts: Int(sqlite3_column_int(stmt, 2)),
          nextAttempt: Date(timeIntervalSince1970: sqlite3_column_double(stmt, 3)),
          lastAttempt: sqlite3_column_type(stmt, 4) == SQLITE_NULL
            ? nil : Date(timeIntervalSince1970: sqlite3_column_double(stmt, 4)), outcome: string(5))
      )
    }
    return result
  }
  func claim(_ id: String, now: Date, manual: Bool = false) throws -> (CaptureReceipt, String)? {
    try transaction {
      guard let receipt = try list().first(where: { $0.id == id }) else { return nil }
      // Lease exceeds the 25-second HTTP resource timeout. Crash recovery waits out the lease.
      let expired =
        receipt.state == .inFlight && now.timeIntervalSince(receipt.lastAttempt ?? now) >= 60
      guard receipt.retryable || expired else { return nil }
      guard receipt.nextAttempt <= now,
        manual || ![.paused, .heldForOwnerReview].contains(receipt.state)
      else { return nil }
      if !manual
        && (receipt.attempts >= 20 || now.timeIntervalSince(receipt.capture.capturedAt) > 7 * 86400)
      {
        try update(
          "UPDATE receipts SET state='paused',outcome='review_age_or_attempts' WHERE id=?", [id])
        return nil
      }
      let lease = UUID().uuidString
      try update(
        "UPDATE receipts SET state='inFlight',attempts=attempts+1,last=?,lease=? WHERE id=?",
        [String(now.timeIntervalSince1970), lease, id])
      return (receipt, lease)
    }
  }
  func finish(
    _ id: String, lease: String, decision: DeliveryDecision, next: Date,
    acknowledgedAt: Date = Date()
  ) throws {
    try update(
      "UPDATE receipts SET state=?,outcome=?,next=?,acknowledged=?,lease=NULL WHERE id=? AND lease=? AND state='inFlight'",
      [
        decision.state.rawValue, decision.code, String(next.timeIntervalSince1970),
        decision.state == .delivered ? String(acknowledgedAt.timeIntervalSince1970) : nil, id,
        lease,
      ])
    guard sqlite3_changes(db) == 1 else { throw CaptureError.storage }
  }
}
