import CryptoKit
import Foundation

enum CaptureError: Error, LocalizedError {
  case amount, merchant, binding, storage, capacity, connection
  var errorDescription: String? {
    switch self {
    case .amount:
      "Not recorded. Unsupported ILS amount format. Open Capture diagnostics to review the local format description."
    case .merchant: "Not recorded. A usable Merchant or Name is required."
    case .binding: "Not recorded. Saved card metadata is missing or invalid. Open FlowLink, refresh cards, then check this automation's selected binding."
    case .storage: "Could not save safely. Unlock the device and open FlowLink."
    case .capacity: "Not recorded. Capture storage is full; review existing receipts in FlowLink."
    case .connection: "Not recorded. Pair this installation in FlowLink first."
    }
  }
}
enum WalletNormalizer {
  static func amount(_ value: Decimal, currency: String) throws -> String {
    guard currency == "ILS", !value.isNaN, value > 0 else { throw CaptureError.amount }
    var input = value
    var rounded = Decimal()
    NSDecimalRound(&rounded, &input, 2, .plain)
    guard rounded == value else { throw CaptureError.amount }
    let text = NSDecimalString(&input, Locale(identifier: "en_US_POSIX"))
    let parts = text.split(separator: ".", omittingEmptySubsequences: false)
    guard (1...2).contains(parts.count), parts[0].count <= 28,
      parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy({ $0 >= "0" && $0 <= "9" }) }),
      parts.count == 1 || parts[1].count <= 2
    else { throw CaptureError.amount }
    return String(parts[0]) + "."
      + (parts.count == 1
        ? "00" : String(parts[1]).padding(toLength: 2, withPad: "0", startingAt: 0))
  }
  // Explicit grammar: one ₪ or uppercase ILS prefix/suffix, optional Unicode Zs
  // spacing at the outside/marker boundary, ASCII 1...28 digits + dot + 2 digits.
  // No grouping, locale inference, controls, bare numbers, or binary floating point.
  static func ilsText(_ text: String) throws -> Decimal {
    guard text.utf8.prefix(129).count <= 128 else { throw CaptureError.amount }
    var number = trimAmountSpaces(text)
    if number.hasPrefix("₪") { number.removeFirst() }
    else if number.hasPrefix("ILS") { number.removeFirst(3) }
    else if number.hasSuffix("₪") { number.removeLast() }
    else if number.hasSuffix("ILS") { number.removeLast(3) }
    else { throw CaptureError.amount }
    number = trimAmountSpaces(number)
    let parts = number.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 2, (1...28).contains(parts[0].count), parts[1].count == 2,
      parts.allSatisfy({ $0.utf8.allSatisfy { (48...57).contains($0) } }),
      let value = Decimal(string: number, locale: Locale(identifier: "en_US_POSIX")), value > 0
    else { throw CaptureError.amount }
    _ = try amount(value, currency: "ILS")
    return value
  }
  static func trimAmountSpaces(_ text: String) -> String {
    let scalars = text.unicodeScalars
    let start = scalars.drop(while: { $0.properties.generalCategory == .spaceSeparator })
    let trimmed = start.reversed().drop(while: { $0.properties.generalCategory == .spaceSeparator }).reversed()
    return String(String.UnicodeScalarView(trimmed))
  }
  static func merchant(_ merchant: String?, name: String?) throws -> String {
    let selected =
      (merchant?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false) ? merchant : name
    guard let text = selected, (1...512).contains(text.unicodeScalars.count),
      !text.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
      text.trimmingCharacters(in: .whitespacesAndNewlines).range(
        of: "^attachment(?: [0-9]+)?\\.txt$", options: [.regularExpression, .caseInsensitive])
        == nil,
      text.unicodeScalars.contains(where: { CharacterSet.alphanumerics.contains($0) })
    else { throw CaptureError.merchant }
    return text
  }
  static func localDate(_ now: Date, zone: TimeZone) throws -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    let c = calendar.dateComponents([.year, .month, .day], from: now)
    guard let y = c.year, let m = c.month, let d = c.day, (1...9999).contains(y) else {
      throw CaptureError.storage
    }
    return String(format: "%04d-%02d-%02d", y, m, d)
  }
}
struct WalletRequest: Codable, Equatable, Sendable {
  let binding_id: String
  let amount: String
  let currency: String
  let merchant: String
  let transaction_date: String
  let idempotency_key: String
}
struct FrozenCapture: Codable, Sendable {
  let id: String
  let installation: String
  let device: String
  let origin: String
  let protocolVersion: Int
  let bytes: Data
  let sha256: String
  let capturedAt: Date
  let bindingLabel: String?
  var request: WalletRequest {
    get throws { try JSONDecoder().decode(WalletRequest.self, from: bytes) }
  }
  static func make(
    binding: String, amount: String, merchant: String, installation: String, device: String,
    origin: String, now: Date, zone: TimeZone, id: UUID, bindingLabel: String? = nil
  ) throws -> Self {
    guard Validation.uuid(binding), Validation.uuid(device), Validation.uuid(installation) else {
      throw CaptureError.binding
    }
    if let bindingLabel, !Validation.label(bindingLabel) { throw CaptureError.binding }
    let key = id.uuidString.lowercased()
    let request = WalletRequest(
      binding_id: binding, amount: amount, currency: "ILS", merchant: merchant,
      transaction_date: try WalletNormalizer.localDate(now, zone: zone), idempotency_key: key)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    let bytes = try encoder.encode(request)
    return Self(
      id: key, installation: installation, device: device, origin: origin, protocolVersion: 1,
      bytes: bytes, sha256: hash(bytes), capturedAt: now, bindingLabel: bindingLabel)
  }
  static func hash(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
}
enum ReceiptState: String, Codable, Sendable {
  case queued, inFlight, retryWait, delivered, needsReview, failed, paused, heldForOwnerReview
}
struct CaptureReceipt: Identifiable, Sendable {
  let capture: FrozenCapture
  let state: ReceiptState
  let attempts: Int
  let nextAttempt: Date
  let lastAttempt: Date?
  let outcome: String?
  var id: String { capture.id }
  var retryable: Bool { [.queued, .retryWait, .paused, .heldForOwnerReview].contains(state) }
  // Shared by the UI and the transactional archive guard. Normalize only a
  // comparison copy: never rewrite the frozen merchant or request bytes.
  var canArchiveSyntheticTest: Bool {
    guard state == .heldForOwnerReview, outcome == "flowlink_ingestion_disabled",
      let request = try? capture.request, request.amount == "1.23", request.currency == "ILS"
    else { return false }
    let marker = request.merchant.trimmingCharacters(in: .whitespacesAndNewlines)
      .precomposedStringWithCanonicalMapping
    // The explicit marker is ASCII; no confusable/compatibility folding,
    // punctuation removal, substring matching or internal whitespace collapsing.
    return marker.unicodeScalars.allSatisfy(\.isASCII)
      && marker.uppercased(with: Locale(identifier: "en_US_POSIX")) == "FLOWLINK TEST"
  }
  var title: String {
    switch state {
    case .delivered:
      outcome == "reconciled"
        ? "Matched existing transaction"
        : outcome == "already_observed" ? "Already recorded" : "Recorded"
    case .queued, .retryWait: "Pending retry"
    case .inFlight: "Sending"
    case .needsReview: "Needs review"
    case .failed:
      outcome == "synthetic_test_archived"
        ? "Local test — permanently excluded from delivery" : "Could not send safely"
    case .paused: "Paused — review before retrying"
    case .heldForOwnerReview: "Held for review — ingestion disabled"
    }
  }
}
struct DeliveryDecision: Sendable {
  let state: ReceiptState
  let code: String
  var retryAfter: TimeInterval = 0
}
