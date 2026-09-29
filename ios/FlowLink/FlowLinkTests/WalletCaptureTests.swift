import AppIntents
import SQLite3
import XCTest

@testable import FlowLink

@MainActor private final class MockDelivery: WalletTransport {
  var sent: [Data] = []
  var credentials: [DeviceCredential] = []
  var decision = DeliveryDecision(state: .retryWait, code: "unknown_delivery")
  var beforeSend: (() throws -> Void)?
  func sendCapture(_ bytes: Data, credential: DeviceCredential) async -> DeliveryDecision {
    do { try beforeSend?() } catch { XCTFail("Receipt not durable before send") }
    sent.append(bytes)
    credentials.append(credential)
    return decision
  }
}
@MainActor final class WalletCaptureTests: XCTestCase {
  private func decimal(_ text: String) throws -> Decimal {
    try XCTUnwrap(Decimal(string: text, locale: Locale(identifier: "en_US_POSIX")))
  }
  private func capture(
    at date: Date = Date(timeIntervalSince1970: 1_790_440_000), id: UUID = UUID()
  ) throws -> FrozenCapture {
    try .make(
      binding: Fixture.deviceID, amount: "4.00", merchant: "Israel Post",
      installation: Fixture.credentialID,
      device: Fixture.deviceID, origin: "https://test.invalid:443", now: date,
      zone: try XCTUnwrap(TimeZone(secondsFromGMT: 0)), id: id, bindingLabel: "Approved card")
  }
  private func store(_ folder: URL, limit: Int = 500) throws -> ReceiptStore {
    try ReceiptStore(
      directory: folder, installation: Fixture.credentialID, device: Fixture.deviceID,
      origin: "https://test.invalid:443", limit: limit)
  }
  private func temporary() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  }
  func testExactMoneyAndObservedShekelText() throws {
    for (input, expected) in [
      ("4", "4.00"), ("0.01", "0.01"),
      ("9999999999999999999999999999.99", "9999999999999999999999999999.99"),
    ] {
      XCTAssertEqual(try WalletNormalizer.amount(decimal(input), currency: "ILS"), expected)
    }
    XCTAssertEqual(try WalletNormalizer.shekelText("₪0004.00"), "4.00")
    XCTAssertEqual(try WalletNormalizer.shekelText("₪4.00"), "4.00")
  }
  func testMoneyRejectsUnsupportedRepresentations() throws {
    for input in [
      "4.00", "₪0.00", "₪-4.00", "₪4.001", "₪1,000.00", " ₪4.00", "₪4.00 ", "$4.00",
      "Attachment.txt", "₪4,00", "₪٤.٠٠",
    ] {
      XCTAssertThrowsError(try WalletNormalizer.shekelText(input), input)
    }
    for input in ["0", "-1", "4.001", "10000000000000000000000000000"] {
      XCTAssertThrowsError(try WalletNormalizer.amount(decimal(input), currency: "ILS"))
    }
    XCTAssertThrowsError(try WalletNormalizer.amount(decimal("4"), currency: "USD"))
    XCTAssertThrowsError(try WalletNormalizer.amount(.nan, currency: "ILS"))
  }
  func testMerchantPreferenceAndStrictFallback() throws {
    XCTAssertEqual(try WalletNormalizer.merchant("Israel Post", name: "Other"), "Israel Post")
    XCTAssertEqual(try WalletNormalizer.merchant(" ", name: "דואר ישראל"), "דואר ישראל")
    for merchant in [
      "Attachment.txt", "Attachment 2.txt", "\nBad", String(repeating: "x", count: 513), "!!!",
    ] {
      XCTAssertThrowsError(
        try WalletNormalizer.merchant(merchant, name: "Must not hide invalid Merchant"))
    }
    XCTAssertThrowsError(try WalletNormalizer.merchant(nil, name: " "))
  }
  func testFrozenDateIDAndExactRequestShape() throws {
    let id = UUID()
    let record = try capture(id: id)
    let request = try record.request
    XCTAssertEqual(request.idempotency_key, id.uuidString.lowercased())
    let object = try XCTUnwrap(
      JSONSerialization.jsonObject(with: record.bytes) as? [String: String])
    XCTAssertEqual(
      Set(object.keys),
      ["binding_id", "amount", "currency", "merchant", "transaction_date", "idempotency_key"])
    XCTAssertEqual(request.amount, "4.00")
    let instant = Date(timeIntervalSince1970: 0)
    XCTAssertEqual(
      try WalletNormalizer.localDate(instant, zone: XCTUnwrap(TimeZone(secondsFromGMT: -3600))),
      "1969-12-31")
    XCTAssertEqual(
      try WalletNormalizer.localDate(instant, zone: XCTUnwrap(TimeZone(secondsFromGMT: 3600))),
      "1970-01-01")
    XCTAssertNotEqual(try capture().id, try capture().id)
  }
  func testDurableBeforeSendAndRestartRetrySameBytesWithRotatedHeader() async throws {
    let folder = temporary()
    defer { try? FileManager.default.removeItem(at: folder) }
    var now = Date(timeIntervalSince1970: 1_790_440_000)
    let db = try store(folder)
    let transport = MockDelivery()
    let record = try capture(at: now)
    var credential = try Fixture.credential()
    transport.beforeSend = {
      XCTAssertEqual(try self.store(folder).list().first?.capture.bytes, record.bytes)
    }
    let connection = {
      ProtectedConnection(credential: credential, session: Fixture.device.session)
    }
    let service = CaptureService(
      store: db, transport: transport, connection: connection, now: { now }, jitter: { 1 })
    _ = try await service.capture(record)
    now.addTimeInterval(120)
    credential = try CredentialGenerator(randomBytes: { Data(repeating: 9, count: 32) }).generate()
    transport.decision = .init(state: .delivered, code: "created")
    try await CaptureService(
      store: store(folder), transport: transport, connection: connection, now: { now }
    ).send(record.id)
    XCTAssertEqual(transport.sent, [record.bytes, record.bytes])
    XCTAssertNotEqual(transport.credentials[0], transport.credentials[1])
    XCTAssertEqual(try db.list().first?.state, .delivered)
  }
  func testConcurrentConnectionsClaimOnlyOnceAndRecoverExpiredLease() throws {
    let folder = temporary()
    defer { try? FileManager.default.removeItem(at: folder) }
    let one = try store(folder)
    let two = try store(folder)
    let record = try capture()
    let now = record.capturedAt
    try one.insert(record, now: now)
    let first = try XCTUnwrap(one.claim(record.id, now: now))
    XCTAssertNil(try two.claim(record.id, now: now))
    let second = try XCTUnwrap(two.claim(record.id, now: now.addingTimeInterval(61)))
    XCTAssertThrowsError(
      try one.finish(
        record.id, lease: first.1, decision: .init(state: .delivered, code: "created"), next: now,
        acknowledgedAt: now))
    try two.finish(
      record.id, lease: second.1, decision: .init(state: .needsReview, code: "ambiguous"), next: now
    )
    XCTAssertNil(try one.claim(record.id, now: now.addingTimeInterval(70), manual: true))
  }
  func testCapacityNeverEvictsUnresolvedAndNoSendIfPersistenceFails() async throws {
    let folder = temporary()
    defer { try? FileManager.default.removeItem(at: folder) }
    let db = try store(folder, limit: 1)
    let transport = MockDelivery()
    let record = try capture()
    try db.insert(record, now: record.capturedAt)
    let service = CaptureService(store: db, transport: transport, connection: { nil })
    do {
      _ = try await service.capture(capture())
      XCTFail()
    } catch { XCTAssertTrue(transport.sent.isEmpty) }
    XCTAssertEqual(try db.list().count, 1)
  }
  func testDeliveredRetentionAndOldCapturePause() throws {
    let folder = temporary()
    defer { try? FileManager.default.removeItem(at: folder) }
    let db = try store(folder, limit: 1)
    let old = try capture()
    let now = old.capturedAt
    try db.insert(old, now: now)
    XCTAssertNil(try db.claim(old.id, now: now.addingTimeInterval(8 * 86400)))
    XCTAssertEqual(try db.list().first?.state, .paused)
    let lease = try XCTUnwrap(
      db.claim(old.id, now: now.addingTimeInterval(8 * 86400), manual: true))
    try db.finish(
      old.id, lease: lease.1, decision: .init(state: .delivered, code: "created"), next: now,
      acknowledgedAt: now)
    let new = try capture(at: now.addingTimeInterval(31 * 86400))
    try db.insert(new, now: new.capturedAt)
    XCTAssertEqual(try db.list().map(\.id), [new.id])
  }
  func testCredentialUnavailableRetainsReceiptWithoutHTTP() async throws {
    let folder = temporary()
    defer { try? FileManager.default.removeItem(at: folder) }
    let db = try store(folder)
    let transport = MockDelivery()
    let record = try capture()
    let service = CaptureService(
      store: db, transport: transport, connection: { throw FlowLinkError.credentialUnavailable })
    _ = try await service.capture(record)
    XCTAssertTrue(transport.sent.isEmpty)
    XCTAssertEqual(try db.list().first?.state, .paused)
  }
  func testOutcomeMappingAndRetryAfter() throws {
    func result(
      _ status: Int, _ outcome: String, _ disposition: String = "created",
      reason: String = "no_candidate"
    ) -> DeliveryDecision {
      WalletDelivery.interpret(
        status: status,
        data: Data(
          "{\"outcome\":\"\(outcome)\",\"disposition\":\"\(disposition)\",\"review_required\":false,\"reason_code\":\"\(reason)\"}"
            .utf8), retryAfter: "180", now: Date())
    }
    for (code, value) in [(201, "created"), (200, "reconciled"), (200, "already_observed")] {
      XCTAssertEqual(result(code, value).state, .delivered)
    }
    XCTAssertEqual(result(200, "already_observed", "pending").state, .needsReview)
    XCTAssertEqual(result(200, "already_observed", "cancelled").state, .needsReview)
    XCTAssertEqual(result(202, "ambiguous").state, .needsReview)
    XCTAssertEqual(result(409, "conflict").state, .needsReview)
    XCTAssertEqual(result(422, "rejected").state, .failed)
    for code in [401, 403] { XCTAssertEqual(result(code, "rejected").state, .paused) }
    XCTAssertEqual(
      result(503, "rejected", reason: "flowlink_ingestion_disabled").state, .heldForOwnerReview)
    XCTAssertEqual(result(503, "rejected", reason: "ingestion_unavailable").state, .retryWait)
    XCTAssertEqual(result(429, "rejected").retryAfter, 180)
    XCTAssertEqual(result(201, "conflict").state, .paused)
    XCTAssertEqual(
      WalletDelivery.interpret(
        status: 200, data: Data("secret SQL".utf8), retryAfter: nil, now: Date()
      ).code, "unknown_response")
  }
  func testBackoffAndRetryAfterCannotBeBypassedByManualRetry() async throws {
    let folder = temporary()
    defer { try? FileManager.default.removeItem(at: folder) }
    let db = try store(folder)
    let transport = MockDelivery()
    let record = try capture()
    let now = record.capturedAt
    transport.decision = .init(state: .retryWait, code: "rate_limited", retryAfter: 180)
    let service = CaptureService(
      store: db, transport: transport,
      connection: {
        ProtectedConnection(credential: try Fixture.credential(), session: Fixture.device.session)
      }, now: { now }, jitter: { 1 })
    _ = try await service.capture(record)
    try await service.send(record.id, manual: true)
    XCTAssertEqual(transport.sent.count, 1)
    XCTAssertEqual(try db.list().first?.nextAttempt, now.addingTimeInterval(180))
  }
  func testEntityQueryOffersOnlyOwnAvailableBindingsAndNeverSubstitutes() async throws {
    let allowed = CardBinding(
      id: Fixture.deviceID, label: "Approved", status: .active, revision: "1", available: true)
    let disabled = CardBinding(
      id: Fixture.credentialID, label: "Disabled", status: .disabled, revision: "2",
      available: false)
    let query = FlowLinkBindingQuery(local: { [allowed, disabled] }, refresh: { [allowed, disabled] })
    let suggested = try await query.suggestedEntities()
    XCTAssertEqual(suggested.map(\.id), [allowed.id])
    do {
      _ = try await query.entities(for: [UUID().uuidString.lowercased()])
      XCTFail("Missing local metadata must fail clearly without substituting a binding")
    } catch { XCTAssertTrue(error is CaptureError) }
    let retired = try await query.entities(for: [disabled.id])
    XCTAssertEqual(retired.map(\.id), [disabled.id]) // Capture evidence; server authorizes later.
    let resolved = try await query.entities(for: [allowed.id])
    XCTAssertEqual(resolved.first?.label, "Approved")
    XCTAssertEqual(
      Set(Mirror(reflecting: try XCTUnwrap(resolved.first)).children.compactMap(\.label)),
      ["id", "label"])
  }
  func testTwentyAttemptsPauseAndOtherDeviceCannotLoadReceipts() throws {
    let folder = temporary()
    defer { try? FileManager.default.removeItem(at: folder) }
    let db = try store(folder)
    let record = try capture()
    let now = record.capturedAt
    try db.insert(record, now: now)
    for index in 0..<20 {
      let instant = now.addingTimeInterval(TimeInterval(index))
      let lease = try XCTUnwrap(db.claim(record.id, now: instant))
      try db.finish(
        record.id, lease: lease.1, decision: .init(state: .retryWait, code: "unknown_delivery"),
        next: instant)
    }
    XCTAssertNil(try db.claim(record.id, now: now.addingTimeInterval(30)))
    XCTAssertEqual(try db.list().first?.state, .paused)
    let other = try ReceiptStore(
      directory: folder, installation: Fixture.credentialID, device: Fixture.credentialID,
      origin: "https://test.invalid:443")
    XCTAssertTrue(try other.list().isEmpty)
    XCTAssertNil(try other.claim(record.id, now: now, manual: true))
  }
  func testOldCaptureGetsFullRetentionAfterLateAcknowledgement() throws {
    let folder = temporary()
    defer { try? FileManager.default.removeItem(at: folder) }
    let db = try store(folder, limit: 1)
    let old = try capture()
    let captured = old.capturedAt
    try db.insert(old, now: captured)
    let acknowledged = captured.addingTimeInterval(40 * 86400)
    let claim = try XCTUnwrap(db.claim(old.id, now: acknowledged, manual: true))
    try db.finish(
      old.id, lease: claim.1, decision: .init(state: .delivered, code: "created"),
      next: acknowledged, acknowledgedAt: acknowledged)
    let tooEarly = try capture(at: acknowledged.addingTimeInterval(29 * 86400))
    XCTAssertThrowsError(try db.insert(tooEarly, now: tooEarly.capturedAt))
    XCTAssertEqual(try db.list().first?.id, old.id)
    let afterRetention = try capture(at: acknowledged.addingTimeInterval(31 * 86400))
    try db.insert(afterRetention, now: afterRetention.capturedAt)
    XCTAssertEqual(try db.list().map(\.id), [afterRetention.id])
  }
  func testProtocolRejectionsNeverEnterAutomaticRetry() {
    for status in [400, 413, 415] {
      let decision = WalletDelivery.interpret(
        status: status, data: Data(), retryAfter: nil, now: Date())
      XCTAssertEqual(decision.state, .failed)
      XCTAssertEqual(decision.code, "protocol_rejected")
    }
  }
  func testSQLiteQuotaFailureRollsBackAndDoesNotTransmit() async throws {
    let folder = temporary()
    defer { try? FileManager.default.removeItem(at: folder) }
    let db = try store(folder)
    let transport = MockDelivery()
    let original = try capture()
    let oversized = Data(repeating: 65, count: 3 * 1024 * 1024)
    let frozen = FrozenCapture(
      id: original.id, installation: original.installation, device: original.device,
      origin: original.origin, protocolVersion: 1, bytes: oversized,
      sha256: FrozenCapture.hash(oversized), capturedAt: original.capturedAt,
      bindingLabel: original.bindingLabel)
    let service = CaptureService(store: db, transport: transport, connection: { nil })
    do {
      _ = try await service.capture(frozen)
      XCTFail("Expected SQLite full")
    } catch {}
    XCTAssertTrue(transport.sent.isEmpty)
    XCTAssertTrue(try db.list().isEmpty)
    try db.insert(original, now: original.capturedAt)
    XCTAssertEqual(try db.list().first?.id, original.id)
  }
  func testLocalReceiptSchemaUpgradePreservesOldDeliveredReceipt() throws {
    let folder = temporary()
    defer { try? FileManager.default.removeItem(at: folder) }
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let old = try capture(at: Date().addingTimeInterval(-60 * 86400))
    let json = String(decoding: try JSONEncoder().encode(old), as: UTF8.self).replacingOccurrences(
      of: "'", with: "''")
    var legacy: OpaquePointer?
    XCTAssertEqual(
      sqlite3_open(folder.appendingPathComponent("captures.sqlite").path, &legacy), SQLITE_OK)
    let sql =
      "CREATE TABLE receipts(id TEXT PRIMARY KEY,installation TEXT,device TEXT,origin TEXT,frozen TEXT,created REAL,state TEXT,attempts INTEGER DEFAULT 0,next REAL,last REAL,outcome TEXT,lease TEXT); INSERT INTO receipts(id,installation,device,origin,frozen,created,state,next) VALUES('\(old.id)','\(old.installation)','\(old.device)','\(old.origin)','\(json)',0,'delivered',0);"
    XCTAssertEqual(sqlite3_exec(legacy, sql, nil, nil, nil), SQLITE_OK)
    sqlite3_close(legacy)
    let upgraded = try store(folder, limit: 1)
    XCTAssertEqual(try upgraded.list().first?.id, old.id)
    XCTAssertThrowsError(try upgraded.insert(capture(at: Date()), now: Date()))
    XCTAssertEqual(try upgraded.list().first?.capture.bytes, old.bytes)
    XCTAssertEqual(
      try folder.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
  }
  func testLocalCaptureIdentityUsesMetadataOnlyAndResetCannotResurrectIt() throws {
    XCTAssertEqual(try WalletLocalIdentity.resolve(metadata: { Fixture.device.session }),
      Fixture.device.session)
    XCTAssertNil(try WalletLocalIdentity.resolve(metadata: { nil }))
    XCTAssertThrowsError(try WalletLocalIdentity.resolve(metadata: {
      DeviceSession(deviceID: "invalid", label: "Phone", credentialID: Fixture.credentialID,
        credentialRevision: "1")
    }))
  }
  func testDisabledHoldSurvivesRelaunchAndEnablementUntilExactManualRetry() async throws {
    let folder = temporary()
    defer { try? FileManager.default.removeItem(at: folder) }
    let original = try capture()
    var now = original.capturedAt
    let transport = MockDelivery()
    transport.decision = WalletDelivery.interpret(
      status: 503,
      data: Data(
        #"{"outcome":"rejected","disposition":"pending","review_required":false,"reason_code":"flowlink_ingestion_disabled"}"#
          .utf8),
      retryAfter: "60", now: now)
    var credential = try Fixture.credential()
    let connection = {
      ProtectedConnection(credential: credential, session: Fixture.device.session)
    }
    transport.beforeSend = {
      let stored = try XCTUnwrap(self.store(folder).list().first)
      XCTAssertEqual(stored.capture.bytes, original.bytes)
      XCTAssertEqual(stored.capture.bindingLabel, "Approved card")
    }
    // First connection is released before reopening the durable SQLite file.
    do {
      let db = try store(folder)
      let service = CaptureService(
        store: db, transport: transport, connection: connection, now: { now })
      let title = try await service.capture(original)
      XCTAssertEqual(title, "Held for review — ingestion disabled")
      XCTAssertEqual(try db.list().first?.state, .heldForOwnerReview)
    }
    now.addTimeInterval(2 * 86400)  // Including midnight/restart: the date never changes.
    let reopened = try store(folder)
    let service = CaptureService(
      store: reopened, transport: transport, connection: connection, now: { now })
    XCTAssertEqual(try reopened.list().first?.capture.bytes, original.bytes)
    XCTAssertEqual(try reopened.list().first?.capture.bindingLabel, original.bindingLabel)
    XCTAssertTrue(try XCTUnwrap(reopened.list().first).retryable)
    ForegroundCaptures.beginSession()
    try await ForegroundCaptures.resume(store: reopened, service: service, now: now)
    XCTAssertEqual(transport.sent.count, 1)
    // An explicit retry while still disabled remains held, never schedules itself.
    try await service.send(original.id, manual: true)
    XCTAssertEqual(try reopened.list().first?.state, .heldForOwnerReview)
    XCTAssertEqual(transport.sent.count, 2)
    transport.decision = .init(state: .delivered, code: "created")  // Backend later enabled.
    credential = try CredentialGenerator(randomBytes: { Data(repeating: 9, count: 32) }).generate()
    ForegroundCaptures.beginSession()
    try await ForegroundCaptures.resume(store: reopened, service: service, now: now)
    try await service.send(original.id)  // Even direct automatic service entry cannot bypass hold.
    XCTAssertEqual(transport.sent.count, 2)
    try await service.send(original.id, manual: true)
    XCTAssertEqual(transport.sent, [original.bytes, original.bytes, original.bytes])
    XCTAssertNotEqual(transport.credentials[0], transport.credentials[2])
    XCTAssertEqual(try reopened.list().first?.state, .delivered)
    XCTAssertEqual(try reopened.list().first?.capture.request, try original.request)
    // Delivered receipts cannot be forced through another local manual send.
    try await service.send(original.id, manual: true)
    XCTAssertEqual(transport.sent.count, 3)
  }
  func testHeldReceiptNeverEvictedAndReviewOutcomesCannotBeForced() async throws {
    for outcome in ["ambiguous", "conflict"] {
      let folder = temporary()
      defer { try? FileManager.default.removeItem(at: folder) }
      let original = try capture()
      var now = original.capturedAt
      let db = try store(folder, limit: 1)
      let transport = MockDelivery()
      transport.decision = .init(state: .heldForOwnerReview, code: "flowlink_ingestion_disabled")
      let service = CaptureService(
        store: db, transport: transport,
        connection: {
          ProtectedConnection(credential: try Fixture.credential(), session: Fixture.device.session)
        }, now: { now })
      _ = try await service.capture(original)
      now.addTimeInterval(90 * 86400)
      XCTAssertThrowsError(try db.insert(capture(at: now), now: now))
      XCTAssertEqual(try db.list().first?.capture.bytes, original.bytes)
      transport.decision = .init(state: .needsReview, code: outcome)
      try await service.send(original.id, manual: true)
      try await service.send(original.id, manual: true)
      XCTAssertEqual(transport.sent, [original.bytes, original.bytes])
      XCTAssertEqual(try db.list().first?.state, .needsReview)
    }
  }
  func testHeldManualRetryCannotSwitchDeviceOrBinding() async throws {
    let folder = temporary()
    defer { try? FileManager.default.removeItem(at: folder) }
    let db = try store(folder)
    let original = try capture()
    let transport = MockDelivery()
    transport.decision = .init(state: .heldForOwnerReview, code: "flowlink_ingestion_disabled")
    let first = CaptureService(
      store: db, transport: transport,
      connection: {
        ProtectedConnection(credential: try Fixture.credential(), session: Fixture.device.session)
      }, now: { original.capturedAt })
    _ = try await first.capture(original)
    let wrong = DeviceSession(
      deviceID: Fixture.credentialID, label: "Other device", credentialID: Fixture.credentialID,
      credentialRevision: "2")
    let next = CaptureService(
      store: db, transport: transport,
      connection: {
        ProtectedConnection(credential: try Fixture.credential(), session: wrong)
      }, now: { original.capturedAt })
    try await next.send(original.id, manual: true)
    XCTAssertEqual(transport.sent.count, 1)
    XCTAssertEqual(try db.list().first?.capture.bytes, original.bytes)
    XCTAssertEqual(try db.list().first?.capture.request.binding_id, try original.request.binding_id)
    XCTAssertEqual(try db.list().first?.state, .paused)
  }
  func testLegacyReceiptWithoutLabelDecodesWithoutChangingPayload() throws {
    let original = try capture()
    var json = try XCTUnwrap(
      JSONSerialization.jsonObject(with: JSONEncoder().encode(original)) as? [String: Any])
    json.removeValue(forKey: "bindingLabel")
    let restored = try JSONDecoder().decode(
      FrozenCapture.self, from: JSONSerialization.data(withJSONObject: json))
    XCTAssertNil(restored.bindingLabel)
    XCTAssertEqual(restored.bytes, original.bytes)
  }

}
