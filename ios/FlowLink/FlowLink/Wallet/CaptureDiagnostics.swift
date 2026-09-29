import Foundation
import SQLite3

enum CaptureStage: String, Codable {
  case amountFormatUnsupported = "amount_format_unsupported"
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
// Structural evidence only. No raw text/digits/filename/identifier is retained.
// Inspect at most 129 UTF-8 bytes and 128 Unicode scalars even for hostile input.
struct AmountFormatDescriptor: Equatable {
  let marker: String
  let digits: Bool
  let separator: String
  let fractionalDigits: Int
  let outerSpaces: Bool
  let byteLength: Int // 129 means at least 129, beyond the parser limit.
  let controls: Bool
  static let markers = ["NONE", "ILS_SYMBOL", "ILS_CODE", "OTHER", "MULTIPLE"]
  static let separators = ["NONE", "DOT", "COMMA", "MULTIPLE"]

  init(_ text: String) {
    byteLength = text.utf8.prefix(129).count
    let prefix = String(String.UnicodeScalarView(text.unicodeScalars.prefix(128)))
    let symbols = prefix.filter { $0 == "₪" }.count
    let codes = prefix.components(separatedBy: "ILS").count - 1
    let other = prefix.unicodeScalars.contains { $0.properties.generalCategory == .currencySymbol && $0 != "₪" }
      || prefix.replacingOccurrences(of: "ILS", with: "").unicodeScalars.contains { CharacterSet.letters.contains($0) }
    marker = symbols + codes > 1 || (symbols + codes > 0 && other) ? "MULTIPLE"
      : symbols == 1 ? "ILS_SYMBOL" : codes == 1 ? "ILS_CODE" : other ? "OTHER" : "NONE"
    digits = prefix.utf8.contains { (48...57).contains($0) }
    let dots = prefix.filter { $0 == "." }.count
    let commas = prefix.filter { $0 == "," }.count
    separator = dots + commas > 1 ? "MULTIPLE" : dots == 1 ? "DOT" : commas == 1 ? "COMMA" : "NONE"
    if dots + commas == 1, let index = prefix.firstIndex(where: { $0 == "." || $0 == "," }) {
      fractionalDigits = prefix[prefix.index(after: index)...].utf8.prefix(while: { (48...57).contains($0) }).count
    } else { fractionalDigits = 0 }
    outerSpaces = prefix.unicodeScalars.first?.properties.generalCategory == .spaceSeparator
      || (byteLength <= 128 && prefix.unicodeScalars.last?.properties.generalCategory == .spaceSeparator)
    controls = prefix.unicodeScalars.contains {
      $0.properties.generalCategory == .control || $0.properties.generalCategory == .format
    }
  }
  // Closed alphabet only; safe to persist in the existing diagnostic code column.
  var encoded: String {
    ["fmt1", marker, digits ? "1" : "0", separator, String(fractionalDigits),
      outerSpaces ? "1" : "0", String(byteLength), controls ? "1" : "0"].joined(separator: "|")
  }
  init?(encoded: String) {
    let p = encoded.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
    guard p.count == 8, p[0] == "fmt1", Self.markers.contains(p[1]),
      Self.separators.contains(p[3]), [p[2], p[5], p[7]].allSatisfy({ ["0", "1"].contains($0) }),
      let fractions = Int(p[4]), (0...128).contains(fractions),
      let length = Int(p[6]), (0...129).contains(length) else { return nil }
    marker = p[1]; digits = p[2] == "1"; separator = p[3]; fractionalDigits = fractions
    outerSpaces = p[5] == "1"; byteLength = length; controls = p[7] == "1"
  }
  var summary: String {
    "Currency marker: \(marker) · Digits present: \(digits ? "yes" : "no") · Separator: \(separator) · Fractional digits: \(fractionalDigits) · Outer spaces: \(outerSpaces ? "yes" : "no") · UTF-8 bytes: \(byteLength == 129 ? "129+ (bounded sample)" : String(byteLength)) · Controls: \(controls ? "yes" : "no")"
  }
}

struct CaptureDiagnostic: Identifiable {
  let id: Int64
  let date: Date
  let stage: CaptureStage
  let code: String?
  let format: AmountFormatDescriptor?
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
  func unsupportedAmount(_ text: String) {
    write(.amountFormatUnsupported, safeCode: AmountFormatDescriptor(text).encoded, now: Date())
  }
  func record(_ stage: CaptureStage, code: CaptureDiagnosticCode? = nil, now: Date = Date()) {
    write(stage, safeCode: code?.rawValue, now: now)
  }
  private func write(_ stage: CaptureStage, safeCode: String?, now: Date) {
    guard now.timeIntervalSince1970.isFinite else { return }
    do {
      try exec("BEGIN IMMEDIATE")
      // Only closed enum raw values and a finite system timestamp enter this SQL.
      let sqlCode = safeCode.map { "'\($0)'" } ?? "NULL"
      try exec("INSERT INTO stages(at,stage,code) VALUES(\(now.timeIntervalSince1970),'\(stage.rawValue)',\(sqlCode)); DELETE FROM stages WHERE id NOT IN (SELECT id FROM stages ORDER BY id DESC LIMIT 128);")
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
      guard step == SQLITE_ROW, let raw = sqlite3_column_text(stmt, 2) else { throw CaptureError.storage }
      // Preserve but ignore retired/unknown stages from older diagnostic builds.
      guard let stage = CaptureStage(rawValue: String(cString: raw)) else { continue }
      let code = sqlite3_column_text(stmt, 3).map { String(cString: $0) }
      let format = stage == .amountFormatUnsupported ? code.flatMap(AmountFormatDescriptor.init(encoded:)) : nil
      guard format != nil || code == nil || code.flatMap(CaptureDiagnosticCode.init(rawValue:)) != nil
      else { throw CaptureError.storage }
      result.append(.init(id: sqlite3_column_int64(stmt, 0),
        date: Date(timeIntervalSince1970: sqlite3_column_double(stmt, 1)), stage: stage,
        code: format == nil ? code : nil, format: format))
    }
  }
  static func checkpoint(_ stage: CaptureStage, code: CaptureDiagnosticCode? = nil) {
    guard let folder = try? BindingDirectory.walletDirectory(),
      let store = try? CaptureDiagnostics(directory: folder) else { return }
    store.record(stage, code: code)
  }
}
