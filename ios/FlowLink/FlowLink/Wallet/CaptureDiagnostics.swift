import Foundation
import SQLite3

enum CaptureStage: String, Codable {
  case intentInvoked = "intent_invoked"
  case entityResolvedLocal = "entity_resolved_local"
  case entityResolutionFailed = "entity_resolution_failed"
  case parametersNormalized = "parameters_normalized"
  case localIdentityResolved = "local_identity_resolved"
  case receiptPersisted = "receipt_persisted"
  case deliveryStarted = "delivery_started"
  case deliveryHeldDisabled = "delivery_held_disabled"
  case deliveryFailed = "delivery_failed"
  case deliveryCompleted = "delivery_completed"
  case intentFailed = "intent_failed"
  case intentCompleted = "intent_completed"
}
enum CaptureDiagnosticCode: String {
  case amount, merchant, binding, identity, storage, capacity, authorization, configuration
  case unavailable, retry, rejected, review, disabled, unknown
  static func from(_ error: Error) -> Self {
    if let error = error as? FlowLinkError {
      return switch error {
      case .storageUnavailable: .storage
      case .credentialUnavailable, .unauthorized: .authorization
      case .invalidConfiguration: .configuration
      case .offline, .timeout, .backendUnavailable: .unavailable
      default: .unknown
      }
    }
    guard let error = error as? CaptureError else { return .unknown }
    return switch error {
    case .amount: .amount
    case .merchant: .merchant
    case .binding: .binding
    case .connection: .identity
    case .storage: .storage
    case .capacity: .capacity
    }
  }
}
struct CaptureDiagnostic: Identifiable {
  let id: Int64
  let date: Date
  let stage: CaptureStage
  let code: String?
}

// Best-effort, bounded stage-only diagnostics. Never accept payloads, IDs, labels,
// raw errors or credentials. Failure to diagnose must not prevent receipt persistence.
@MainActor final class CaptureDiagnostics {
  private var db: OpaquePointer?
  init(directory: URL) throws {
    do {
      try FileManager.default.createDirectory(
        at: directory, withIntermediateDirectories: true,
        attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
      var folder = directory
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try folder.setResourceValues(values)
      let url = directory.appendingPathComponent("diagnostics.sqlite")
      guard sqlite3_open_v2(url.path, &db,
        SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK
      else { throw CaptureError.storage }
      try FileManager.default.setAttributes(
        [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
      sqlite3_busy_timeout(db, 100)
      try exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA max_page_count=64; CREATE TABLE IF NOT EXISTS stages(id INTEGER PRIMARY KEY,at REAL NOT NULL,stage TEXT NOT NULL,code TEXT);")
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
  func record(_ stage: CaptureStage, code: CaptureDiagnosticCode? = nil, now: Date = Date()) {
    guard now.timeIntervalSince1970.isFinite else { return }
    do {
      try exec("BEGIN IMMEDIATE")
      // Only closed enum raw values and a finite system timestamp enter this SQL.
      let safeCode = code.map { "'\($0.rawValue)'" } ?? "NULL"
      try exec("INSERT INTO stages(at,stage,code) VALUES(\(now.timeIntervalSince1970),'\(stage.rawValue)',\(safeCode)); DELETE FROM stages WHERE id NOT IN (SELECT id FROM stages ORDER BY id DESC LIMIT 128);")
      try exec("COMMIT")
    } catch { try? exec("ROLLBACK") }
  }
  func list() throws -> [CaptureDiagnostic] {
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, "SELECT id,at,stage,code FROM stages ORDER BY id DESC LIMIT 128", -1, &stmt, nil) == SQLITE_OK else { throw CaptureError.storage }
    defer { sqlite3_finalize(stmt) }
    var result: [CaptureDiagnostic] = []
    while true {
      let step = sqlite3_step(stmt)
      if step == SQLITE_DONE { return result }
      guard step == SQLITE_ROW, let raw = sqlite3_column_text(stmt, 2),
        let stage = CaptureStage(rawValue: String(cString: raw)) else { throw CaptureError.storage }
      let code = sqlite3_column_text(stmt, 3).map { String(cString: $0) }
      guard code == nil || CaptureDiagnosticCode(rawValue: code!) != nil else { throw CaptureError.storage }
      result.append(.init(id: sqlite3_column_int64(stmt, 0),
        date: Date(timeIntervalSince1970: sqlite3_column_double(stmt, 1)), stage: stage, code: code))
    }
  }
  static func checkpoint(_ stage: CaptureStage, code: CaptureDiagnosticCode? = nil) {
    guard let folder = try? BindingDirectory.walletDirectory(),
      let store = try? CaptureDiagnostics(directory: folder) else { return }
    store.record(stage, code: code)
  }
}
