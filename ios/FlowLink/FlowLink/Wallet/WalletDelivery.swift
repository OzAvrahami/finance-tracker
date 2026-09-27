import Foundation

@MainActor protocol WalletTransport {
  func sendCapture(_ bytes: Data, credential: DeviceCredential) async -> DeliveryDecision
}
struct WalletEnvelope: Decodable {
  let outcome: String
  let original_outcome: String?
  let disposition: String
  let review_required: Bool
  let reason_code: String
}
enum WalletDelivery {
  static func interpret(status: Int, data: Data, retryAfter: String?, now: Date) -> DeliveryDecision
  {
    let envelope = try? JSONDecoder().decode(WalletEnvelope.self, from: data)
    if status == 401 || status == 403 { return .init(state: .paused, code: "authorization") }
    if status == 429 {
      return .init(state: .retryWait, code: "rate_limited", retryAfter: delay(retryAfter, now: now))
    }
    if status == 503 && envelope?.reason_code == "flowlink_ingestion_disabled" {
      return .init(state: .heldForOwnerReview, code: "flowlink_ingestion_disabled")
    }
    if status == 503 {
      let transient = ["ingestion_unavailable", "flowlink_unavailable"].contains(
        envelope?.reason_code ?? "")
      return .init(
        state: transient ? .retryWait : .paused, code: transient ? "unavailable" : "configuration",
        retryAfter: delay(retryAfter, now: now))
    }
    if [400, 413, 415].contains(status) { return .init(state: .failed, code: "protocol_rejected") }
    if status >= 500 { return .init(state: .retryWait, code: "unavailable") }
    guard let value = envelope else { return .init(state: .paused, code: "unknown_response") }
    let expected: [String: Int] = [
      "created": 201, "reconciled": 200, "already_observed": 200, "ambiguous": 202, "conflict": 409,
      "rejected": 422,
    ]
    guard expected[value.outcome] == status,
      ["created", "attached", "pending", "cancelled"].contains(value.disposition)
    else {
      return .init(state: .paused, code: "unknown_response")
    }
    switch value.outcome {
    case "created", "reconciled", "already_observed":
      return .init(
        state: value.review_required || ["pending", "cancelled"].contains(value.disposition)
          ? .needsReview : .delivered, code: value.outcome)
    case "ambiguous", "conflict": return .init(state: .needsReview, code: value.outcome)
    default: return .init(state: .failed, code: "rejected")
    }
  }
  static func delay(_ header: String?, now: Date) -> TimeInterval {
    guard let header else { return 0 }
    if let seconds = TimeInterval(header), seconds.isFinite, seconds >= 0 { return seconds }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "EEE',' dd MMM yyyy HH':'mm':'ss z"
    return max(0, formatter.date(from: header)?.timeIntervalSince(now) ?? 0)
  }
}
@MainActor final class CaptureService {
  private let store: ReceiptStore
  private let transport: any WalletTransport
  private let connection: () throws -> ProtectedConnection?
  private let now: () -> Date
  private let jitter: () -> Double
  init(
    store: ReceiptStore, transport: any WalletTransport,
    connection: @escaping () throws -> ProtectedConnection?,
    now: @escaping () -> Date = Date.init,
    jitter: @escaping () -> Double = { Double.random(in: 0.8...1.2) }
  ) {
    self.store = store
    self.transport = transport
    self.connection = connection
    self.now = now
    self.jitter = jitter
  }
  func capture(_ frozen: FrozenCapture) async throws -> String {
    try store.insert(frozen, now: now())  // Durable commit BEFORE HTTP or credential read.
    try await send(frozen.id)
    return try store.list().first(where: { $0.id == frozen.id })?.title ?? "Pending retry"
  }
  func send(_ id: String, manual: Bool = false) async throws {
    guard let (receipt, lease) = try store.claim(id, now: now(), manual: manual) else { return }
    let decision: DeliveryDecision
    do {
      guard let current = try connection(), current.session.deviceID == receipt.capture.device
      else { throw CaptureError.connection }
      decision = await transport.sendCapture(receipt.capture.bytes, credential: current.credential)
    } catch { decision = .init(state: .paused, code: "credential_unavailable") }
    let schedule: [TimeInterval] = [30, 120, 600, 3600, 21600]
    let delay = max(
      decision.retryAfter,
      schedule[min(receipt.attempts, schedule.count - 1)] * min(1.2, max(0.8, jitter())))
    try store.finish(
      id, lease: lease, decision: decision,
      next: decision.state == .heldForOwnerReview ? now() : now().addingTimeInterval(delay),
      acknowledgedAt: now())
  }
}
