import AppIntents
import SQLite3
import XCTest

@testable import FlowLink

@MainActor private final class LocalFirstAPI: FlowLinkAPI, WalletTransport {
  var requests: [String] = []
  var cards: [CardBinding] = []
  var deviceError: FlowLinkError?
  var beforeDevice: (@MainActor () async -> Void)?
  var beforeSend: (@MainActor () async -> Void)?
  var onSend: ((Data) throws -> Void)?
  var decision = DeliveryDecision(state: .heldForOwnerReview, code: "flowlink_ingestion_disabled")
  func redeem(_ draft: PairingDraft) async throws -> PairingResponse { throw FlowLinkError.offline }
  func device(_ credential: DeviceCredential) async throws -> DeviceResponse {
    requests.append("device")
    await beforeDevice?()
    if let deviceError { throw deviceError }
    return Fixture.device
  }
  func bindings(_ credential: DeviceCredential) async throws -> [CardBinding] {
    requests.append("bindings")
    return cards
  }
  func sendCapture(_ bytes: Data, credential: DeviceCredential) async -> DeliveryDecision {
    requests.append("capture")
    do { try onSend?(bytes) } catch { XCTFail("Receipt must be readable before HTTP") }
    await beforeSend?()
    return decision
  }
}

@MainActor final class LocalFirstCaptureTests: XCTestCase {
  private let card = CardBinding(id: Fixture.deviceID, label: "Approved card", status: .active,
    revision: "1", available: true)
  private func folder() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  }
  private func setup(_ folder: URL) throws -> (WalletRuntime, MemoryVault, LocalFirstAPI) {
    let config = try FlowLinkConfiguration("https://test.invalid/api/flowlink/v1")
    let metadata = try InstallationStore(configuration: config, directory: folder)
    try metadata.save(Fixture.device.session)
    let vault = MemoryVault()
    try vault.store(JSONEncoder().encode(ProtectedConnection(
      credential: Fixture.credential(), session: Fixture.device.session)), slot: "current")
    let api = LocalFirstAPI()
    api.cards = [card]
    let pairing = PairingService(api: api, vault: vault, metadata: metadata, configuration: config)
    let runtime = WalletRuntime(configuration: config, metadata: metadata, pairing: pairing,
      api: api, directory: folder.appendingPathComponent("Wallet"))
    return (runtime, vault, api)
  }
  private func record(_ runtime: WalletRuntime, id: UUID = UUID(),
    merchant: String = "FLOWLINK TEST") async throws -> String {
    try await runtime.record(binding: card.id, bindingLabel: card.label,
      amount: Decimal(string: "1.23")!, currency: "ILS", merchant: merchant, name: "Fallback",
      now: Date(), zone: TimeZone(secondsFromGMT: 0)!, id: id)
  }

  func testStringBoundaryPersistsCanonicalILSBeforeHTTPAndHolds() async throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, _, api) = try setup(folder)
    let id = UUID()
    let now = Date()
    let zone = try XCTUnwrap(TimeZone(secondsFromGMT: 0))
    api.onSend = { bytes in
      let stored = try XCTUnwrap(runtime.store().list().first)
      XCTAssertEqual(stored.capture.bytes, bytes)
      XCTAssertEqual(stored.id, id.uuidString.lowercased())
      XCTAssertEqual(stored.capture.bindingLabel, self.card.label)
      let request = try stored.capture.request
      XCTAssertEqual(request.amount, "1.23")
      XCTAssertEqual(request.currency, "ILS")
      XCTAssertEqual(request.binding_id, self.card.id)
      XCTAssertEqual(request.merchant, "FLOWLINK TEST")
      XCTAssertEqual(request.transaction_date, try WalletNormalizer.localDate(now, zone: zone))
    }
    let result = try await runtime.record(binding: card.id, bindingLabel: card.label,
      amountText: "₪1.23", merchant: "FLOWLINK TEST", name: "Ignored", now: now, zone: zone, id: id)
    XCTAssertEqual(result, "Held for review — ingestion disabled")
    XCTAssertEqual(api.requests, ["capture"])
    XCTAssertTrue(try XCTUnwrap(runtime.store().list().first).canArchiveSyntheticTest)
    let stages = try CaptureDiagnostics(directory: runtime.directory).list().reversed().map(\.stage)
    XCTAssertEqual(stages, [.parametersNormalized, .localIdentityResolved, .receiptPersisted,
      .deliveryStarted, .deliveryHeldDisabled])
    let intent = RecordWalletTransaction()
    let _: IntentParameter<String> = intent.$amount
    XCTAssertFalse(RecordWalletTransaction.openAppWhenRun)
  }
  func testUnsupportedStringProducesLocalDescriptorWithoutReceiptOrHTTP() async throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, _, api) = try setup(folder)
    do {
      _ = try await runtime.record(binding: card.id, bindingLabel: card.label,
        amountText: "₪987654.321", merchant: "PRIVATE MERCHANT", name: nil,
        now: Date(), zone: XCTUnwrap(TimeZone(secondsFromGMT: 0)), id: UUID())
      XCTFail("Unsupported representation must fail closed")
    } catch { XCTAssertEqual(error as? CaptureError, .amount) }
    XCTAssertTrue(api.requests.isEmpty)
    XCTAssertFalse(FileManager.default.fileExists(atPath: runtime.directory.appendingPathComponent("captures.sqlite").path))
    let row = try XCTUnwrap(CaptureDiagnostics(directory: runtime.directory).list().first)
    XCTAssertEqual(row.stage, .amountFormatUnsupported)
    XCTAssertEqual(row.format?.fractionalDigits, 3)
    let bytes = try Data(contentsOf: runtime.directory.appendingPathComponent("diagnostics.sqlite"))
    XCTAssertNil(bytes.range(of: Data("987654".utf8)))
    XCTAssertNil(bytes.range(of: Data("PRIVATE MERCHANT".utf8)))
  }
  func testStringBoundaryKeepsNameFallbackAndFailsClosedOnStorageFailure() async throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, _, api) = try setup(folder)
    _ = try await runtime.record(binding: card.id, bindingLabel: card.label,
      amountText: "21.00 ILS", merchant: " ", name: "Fallback", now: Date(),
      zone: XCTUnwrap(TimeZone(secondsFromGMT: 0)), id: UUID())
    XCTAssertEqual(try runtime.store().list().first?.capture.request.merchant, "Fallback")
    try FileManager.default.removeItem(at: runtime.directory)
    try Data("blocked".utf8).write(to: runtime.directory)
    do {
      _ = try await runtime.record(binding: card.id, bindingLabel: card.label,
        amountText: "₪1.23", merchant: "FLOWLINK TEST", name: nil, now: Date(),
        zone: XCTUnwrap(TimeZone(secondsFromGMT: 0)), id: UUID())
      XCTFail("Storage failure must prevent HTTP")
    } catch {}
    XCTAssertEqual(api.requests, ["capture"])
  }
  func testDiagnosticUpgradeKeepsHistoryAndBoundsUnsupportedDescriptors() throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let diagnostics = try CaptureDiagnostics(directory: folder)
    diagnostics.record(.intentCompleted)
    var db: OpaquePointer?
    XCTAssertEqual(sqlite3_open(folder.appendingPathComponent("diagnostics.sqlite").path, &db), SQLITE_OK)
    defer { sqlite3_close(db) }
    XCTAssertEqual(sqlite3_exec(db, "INSERT INTO stages(at,stage,code) VALUES(0,'retired_diagnostic_stage',NULL)", nil, nil, nil), SQLITE_OK)
    diagnostics.unsupportedAmount("₪654321.123")
    let reopened = try CaptureDiagnostics(directory: folder)
    XCTAssertEqual(try reopened.list().map(\.stage), [.amountFormatUnsupported, .intentCompleted])
    XCTAssertEqual(try reopened.list().first?.format?.fractionalDigits, 3)
    for _ in 0..<140 { diagnostics.unsupportedAmount("bare 654321") }
    XCTAssertEqual(try reopened.list().count, 128)
    XCTAssertTrue(try reopened.list().allSatisfy { $0.stage == .amountFormatUnsupported && $0.format != nil })
    let bytes = try Data(contentsOf: folder.appendingPathComponent("diagnostics.sqlite"))
    XCTAssertNil(bytes.range(of: Data("654321".utf8)))
  }

  func testConfiguredEntityResolutionIsLocalOnlyEvenWhenDisabled() async throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, vault, api) = try setup(folder)
    let disabled = CardBinding(id: card.id, label: card.label, status: .disabled,
      revision: "2", available: false)
    try runtime.bindingDirectory.replace([disabled], device: Fixture.deviceID)
    vault.failure = .credentialUnavailable
    let query = FlowLinkBindingQuery(local: { try runtime.localBindings() }, refresh: {
      XCTFail("Runtime resolution must never refresh")
      return []
    })
    let entities = try await query.entities(for: [card.id])
    XCTAssertEqual(entities.first?.label, card.label)
    XCTAssertEqual(entities.first?.id, card.id)
    XCTAssertTrue(api.requests.isEmpty)
  }

  func testConfigurationDiscoveryRefreshesSharedDirectory() async throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, _, api) = try setup(folder)
    let query = FlowLinkBindingQuery(local: { try runtime.localBindings() },
      refresh: { try await runtime.bindings() })
    let suggested = try await query.suggestedEntities()
    XCTAssertEqual(suggested.map(\.id), [card.id])
    XCTAssertEqual(try runtime.localBindings(), [card])
    XCTAssertEqual(api.requests, ["bindings"])
    _ = try await query.entities(for: [card.id])
    XCTAssertEqual(api.requests, ["bindings"])
  }

  func testMissingOrCorruptDirectoryFailsLocallyWithoutNetwork() async throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, _, api) = try setup(folder)
    let query = FlowLinkBindingQuery(local: { try runtime.localBindings() },
      refresh: { try await runtime.bindings() })
    do { _ = try await query.entities(for: [card.id]); XCTFail() } catch {}
    try runtime.bindingDirectory.replace([card], device: Fixture.deviceID)
    try Data("invalid".utf8).write(to: runtime.directory.appendingPathComponent("bindings.json"))
    do { _ = try await query.entities(for: [card.id]); XCTFail() } catch {}
    XCTAssertTrue(api.requests.isEmpty)
  }

  func testDirectoryScopesDeviceInstallationAndOriginAndRejectsUnsafeValues() throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, _, _) = try setup(folder)
    try runtime.bindingDirectory.replace([card], device: Fixture.deviceID)
    XCTAssertTrue(try runtime.bindingDirectory.load(device: Fixture.credentialID).isEmpty)
    for directory in [
      BindingDirectory(installation: Fixture.credentialID, origin: runtime.configuration.origin,
        directory: runtime.directory),
      BindingDirectory(installation: runtime.metadata.installationID, origin: "https://other.invalid:443",
        directory: runtime.directory)
    ] { XCTAssertTrue(try directory.load(device: Fixture.deviceID).isEmpty) }
    XCTAssertThrowsError(try runtime.bindingDirectory.replace([card, card], device: Fixture.deviceID))
    XCTAssertThrowsError(try runtime.bindingDirectory.replace([
      CardBinding(id: card.id, label: "unsafe\nlabel", status: .active, revision: "1", available: true)
    ], device: Fixture.deviceID))
    let raw = try Data(contentsOf: runtime.directory.appendingPathComponent("bindings.json"))
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: raw) as? [String: Any])
    XCTAssertEqual(Set(object.keys), ["device", "installation", "origin", "bindings"])
    let bindings = try XCTUnwrap(object["bindings"] as? [[String: Any]])
    XCTAssertEqual(Set(try XCTUnwrap(bindings.first).keys), ["id", "label", "status", "revision", "available"])
  }

  func testRemovedBindingRemainsLocallyResolvableButNotSuggested() async throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, _, api) = try setup(folder)
    try runtime.bindingDirectory.replace([card], device: Fixture.deviceID)
    api.cards = []
    _ = try await runtime.bindings()
    let query = FlowLinkBindingQuery(local: { try runtime.localBindings() }, refresh: {
      try runtime.localBindings()
    })
    let suggested = try await query.suggestedEntities()
    let resolved = try await query.entities(for: [card.id])
    XCTAssertTrue(suggested.isEmpty)
    XCTAssertEqual(resolved.first?.id, card.id)
    XCTAssertEqual(try runtime.localBindings().first?.available, false)
  }

  func testLaunchShowsCachedCardsBeforeSlowDeviceRefreshAndUpdatesDirectory() async throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, _, api) = try setup(folder)
    try runtime.bindingDirectory.replace([card], device: Fixture.deviceID)
    let model = ConnectionModel(api: api, pairing: runtime.pairing,
      configuration: runtime.configuration, directory: runtime.bindingDirectory)
    let entered = expectation(description: "Device refresh waiting")
    var resume: CheckedContinuation<Void, Never>?
    api.beforeDevice = {
      await withCheckedContinuation { continuation in
        resume = continuation
        entered.fulfill()
      }
    }
    let refresh = Task { await model.restore() }
    let waitResult = await XCTWaiter.fulfillment(of: [entered], timeout: 2)
    XCTAssertEqual(waitResult, .completed)
    XCTAssertEqual(model.cards, [card])
    XCTAssertTrue(model.cardsAreCached)
    XCTAssertTrue(model.busy)
    let renamed = CardBinding(id: card.id, label: "Updated name", status: .disabled,
      revision: "2", available: false)
    api.cards = [renamed]
    resume?.resume()
    await refresh.value
    XCTAssertEqual(model.cards, [renamed])
    XCTAssertFalse(model.cardsAreCached)
    XCTAssertEqual(try runtime.localBindings(), [renamed])
  }

  func testOfflineLaunchRetainsCachedDisplayWithOfflineStatus() async throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, _, api) = try setup(folder)
    try runtime.bindingDirectory.replace([card], device: Fixture.deviceID)
    api.deviceError = .offline
    let model = ConnectionModel(api: api, pairing: runtime.pairing,
      configuration: runtime.configuration, directory: runtime.bindingDirectory)
    await model.restore()
    XCTAssertEqual(model.cards, [card])
    XCTAssertTrue(model.cardsAreCached)
    XCTAssertEqual(model.state, .offline)
    XCTAssertNil(model.status)
  }

  func testRuntimePersistsBeforeFirstHTTPRequestWithoutAnyBindingCacheOrUI() async throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, _, api) = try setup(folder)
    let id = UUID()
    api.onSend = { bytes in
      let reopened = try runtime.store()
      let receipt = try XCTUnwrap(reopened.list().first)
      XCTAssertEqual(receipt.id, id.uuidString.lowercased())
      XCTAssertEqual(receipt.capture.bytes, bytes)
      XCTAssertEqual(receipt.capture.bindingLabel, self.card.label)
    }
    let result = try await record(runtime, id: id)
    XCTAssertEqual(result, "Held for review — ingestion disabled")
    XCTAssertEqual(api.requests, ["capture"])
    XCTAssertEqual(try runtime.store().list().first?.state, .heldForOwnerReview)
  }

  func testOfflineDeliveryRetainsReceiptAndOriginalEvidence() async throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, _, api) = try setup(folder)
    api.decision = .init(state: .retryWait, code: "unknown_delivery")
    _ = try await record(runtime)
    let receipt = try XCTUnwrap(runtime.store().list().first)
    XCTAssertEqual(receipt.state, .retryWait)
    XCTAssertEqual(try receipt.capture.request.amount, "1.23")
    XCTAssertEqual(try receipt.capture.request.merchant, "FLOWLINK TEST")
    XCTAssertEqual(api.requests, ["capture"])
  }

  func testSlowDeliveryAlreadyHasCommittedReceiptAndCanReopenBeforeResponse() async throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, _, api) = try setup(folder)
    let entered = expectation(description: "HTTP suspended after commit")
    var resume: CheckedContinuation<Void, Never>?
    api.beforeSend = {
      await withCheckedContinuation { continuation in
        resume = continuation
        entered.fulfill()
      }
    }
    let task = Task { try await self.record(runtime) }
    let waitResult = await XCTWaiter.fulfillment(of: [entered], timeout: 2)
    XCTAssertEqual(waitResult, .completed)
    let receipt = try XCTUnwrap(runtime.store().list().first)
    XCTAssertEqual(receipt.state, .inFlight)
    XCTAssertEqual(receipt.capture.bindingLabel, card.label)
    resume?.resume()
    _ = try await task.value
    XCTAssertEqual(try runtime.store().list().first?.capture.bytes, receipt.capture.bytes)
  }

  func testUnavailableOrMissingCredentialDoesNotPreventLocalCapture() async throws {
    for missing in [false, true] {
      let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
      let (runtime, vault, api) = try setup(folder)
      if missing { vault.values = [:] } else { vault.failure = .credentialUnavailable }
      _ = try await record(runtime)
      XCTAssertEqual(try runtime.store().list().first?.state, .paused)
      XCTAssertTrue(api.requests.isEmpty)
    }
  }

  func testServerAuthorityRejectionsRetainEvidenceAndNeverUseCacheAsAuthority() async throws {
    for decision in [DeliveryDecision(state: .paused, code: "authorization"),
      .init(state: .failed, code: "rejected"), .init(state: .paused, code: "configuration")] {
      let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
      let (runtime, _, api) = try setup(folder)
      try runtime.bindingDirectory.replace([card], device: Fixture.deviceID)
      api.decision = decision
      _ = try await record(runtime)
      XCTAssertEqual(try runtime.store().list().first?.state, decision.state)
      XCTAssertEqual(api.requests, ["capture"])
    }
  }

  func testInvalidParametersAndMissingIdentityNeverSend() async throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, _, api) = try setup(folder)
    do {
      _ = try await runtime.record(binding: "bad", bindingLabel: card.label, amount: 1,
        currency: "ILS", merchant: "Test", name: nil, now: Date(), zone: .current, id: UUID())
      XCTFail()
    } catch {}
    try runtime.metadata.clear()
    do { _ = try await record(runtime); XCTFail() } catch {}
    XCTAssertTrue(api.requests.isEmpty)
  }

  func testRenamingBindingNeverChangesFrozenReceipt() async throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, _, _) = try setup(folder)
    _ = try await record(runtime)
    let before = try XCTUnwrap(runtime.store().list().first)
    try runtime.bindingDirectory.replace([
      CardBinding(id: card.id, label: "Renamed", status: .active, revision: "2", available: true)
    ], device: Fixture.deviceID)
    let after = try XCTUnwrap(runtime.store().list().first)
    XCTAssertEqual(after.capture.bytes, before.capture.bytes)
    XCTAssertEqual(after.capture.bindingLabel, card.label)
  }

  func testSyntheticArchiveIsPermanentLocalOnlyAndPreservesEvidence() async throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, _, api) = try setup(folder)
    _ = try await record(runtime, merchant: "Flowlink test")
    let store = try runtime.store()
    let original = try XCTUnwrap(store.list().first)
    XCTAssertTrue(original.canArchiveSyntheticTest) // Same predicate used by the UI.
    XCTAssertEqual(original.state, .heldForOwnerReview) // Merely recognizing never archives.
    try store.archiveSyntheticTest(original.id)
    api.decision = .init(state: .delivered, code: "created")
    try await runtime.service(store).send(original.id, manual: true)
    try await ForegroundCaptures.resume(store: store, service: runtime.service(store))
    XCTAssertEqual(api.requests, ["capture"])
    let archived = try XCTUnwrap(runtime.store().list().first)
    XCTAssertEqual(archived.state, .failed)
    XCTAssertEqual(archived.outcome, "synthetic_test_archived")
    XCTAssertEqual(archived.capture.bytes, original.capture.bytes)
    XCTAssertEqual(try archived.capture.request.merchant, "Flowlink test")
    XCTAssertEqual(archived.capture.sha256, original.capture.sha256)
    XCTAssertEqual(archived.id, original.id)
    XCTAssertFalse(archived.canArchiveSyntheticTest)
    XCTAssertFalse(archived.retryable)
  }

  func testSyntheticMarkerCaseAndOuterWhitespaceDoNotRewriteStoredEvidence() async throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, _, _) = try setup(folder)
    let store = try runtime.store()
    for merchant in ["FLOWLINK TEST", " flowlink TEST ", "\u{00a0}FlowLink Test\u{00a0}"] {
      let id = UUID()
      _ = try await record(runtime, id: id, merchant: merchant)
      let original = try XCTUnwrap(store.list().first { $0.id == id.uuidString.lowercased() })
      XCTAssertTrue(original.canArchiveSyntheticTest)
      XCTAssertEqual(original.state, .heldForOwnerReview)
      try store.archiveSyntheticTest(original.id)
      let saved = try XCTUnwrap(store.list().first { $0.id == original.id })
      XCTAssertEqual(saved.capture.bytes, original.capture.bytes)
      XCTAssertEqual(saved.capture.sha256, original.capture.sha256)
      XCTAssertEqual(try saved.capture.request.merchant, merchant)
      XCTAssertFalse(saved.retryable)
    }
  }

  func testSyntheticMarkerEligibilityRejectsEveryOtherGuardAndNearMatch() throws {
    func receipt(merchant: String = "Flowlink test", amount: String = "1.23",
      currency: String = "ILS", state: ReceiptState = .heldForOwnerReview,
      outcome: String? = "flowlink_ingestion_disabled") throws -> CaptureReceipt {
      let frozen = try FrozenCapture.make(binding: card.id, amount: amount, merchant: merchant,
        installation: Fixture.credentialID, device: Fixture.deviceID,
        origin: "https://test.invalid:443", now: Date(), zone: TimeZone(secondsFromGMT: 0)!, id: UUID())
      let original = try frozen.request
      let request = WalletRequest(binding_id: original.binding_id, amount: amount, currency: currency,
        merchant: merchant, transaction_date: original.transaction_date, idempotency_key: original.idempotency_key)
      let bytes = try JSONEncoder().encode(request)
      let capture = FrozenCapture(id: frozen.id, installation: frozen.installation, device: frozen.device,
        origin: frozen.origin, protocolVersion: frozen.protocolVersion, bytes: bytes,
        sha256: FrozenCapture.hash(bytes), capturedAt: frozen.capturedAt, bindingLabel: frozen.bindingLabel)
      return CaptureReceipt(capture: capture, state: state, attempts: 1, nextAttempt: Date(), lastAttempt: nil, outcome: outcome)
    }
    XCTAssertTrue(try receipt().canArchiveSyntheticTest)
    for state: ReceiptState in [.queued, .inFlight, .retryWait, .delivered, .needsReview, .failed, .paused] {
      XCTAssertFalse(try receipt(state: state).canArchiveSyntheticTest)
    }
    for outcome in [nil, "unknown_delivery", "created", "flowlink_unavailable"] as [String?] {
      XCTAssertFalse(try receipt(outcome: outcome).canArchiveSyntheticTest)
    }
    for amount in ["1.230", "01.23", "1.24", "21.00"] {
      XCTAssertFalse(try receipt(amount: amount).canArchiveSyntheticTest)
    }
    for currency in ["ils", "USD"] { XCTAssertFalse(try receipt(currency: currency).canArchiveSyntheticTest) }
    for merchant in ["", "Actual merchant", "FLOWLINK TEST purchase", "MY FLOWLINK TEST", "FLOWLINK  TEST",
      "FLOWLINK\nTEST", "FLOWLINK-TEST", "FLÖWLINK TEST", "ＦＬＯＷＬＩＮＫ ＴＥＳＴ", "FLOWLINK TEſT"] {
      XCTAssertFalse(try receipt(merchant: merchant).canArchiveSyntheticTest, merchant)
    }
  }

  func testCannotArchiveRealOrUncertainReceiptAsSynthetic() async throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, _, api) = try setup(folder)
    _ = try await record(runtime, merchant: "Actual merchant")
    let store = try runtime.store()
    XCTAssertThrowsError(try store.archiveSyntheticTest(XCTUnwrap(store.list().first).id))
    api.decision = .init(state: .retryWait, code: "unknown_delivery")
    _ = try await record(runtime)
    for receipt in try store.list() { XCTAssertThrowsError(try store.archiveSyntheticTest(receipt.id)) }
  }

  func testDiagnosticsAreBoundedStageOnlyAndRecordPersistenceBeforeDelivery() async throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, _, _) = try setup(folder)
    _ = try await record(runtime)
    let diagnostics = try CaptureDiagnostics(directory: runtime.directory)
    let stages = try diagnostics.list().reversed().map(\.stage)
    XCTAssertEqual(stages, [.parametersNormalized, .localIdentityResolved, .receiptPersisted,
      .deliveryStarted, .deliveryHeldDisabled])
    for _ in 0..<200 { diagnostics.record(.intentCompleted) }
    XCTAssertEqual(try diagnostics.list().count, 128)
    XCTAssertTrue(try diagnostics.list().allSatisfy { $0.stage == .intentCompleted && $0.code == nil })
  }

  func testMetadataUpgradeKeepsIdentityWithoutCredentialRead() throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, _, _) = try setup(folder)
    let path = folder.appendingPathComponent(runtime.configuration.originHash + "-device.json")
    var object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: path)) as? [String: Any])
    object.removeValue(forKey: "installation")
    try JSONSerialization.data(withJSONObject: object).write(to: path)
    let upgraded = try InstallationStore(configuration: runtime.configuration, directory: folder)
    XCTAssertEqual(try upgraded.load(), Fixture.device.session)
    XCTAssertEqual(upgraded.installationID, runtime.metadata.installationID)
    object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: path)) as? [String: Any])
    XCTAssertEqual(object["installation"] as? String, upgraded.installationID)
  }

  func testFirstCredentialReadOccursAfterDurableReceiptCommit() async throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, vault, api) = try setup(folder)
    var reads = 0
    vault.beforeRead = { slot in
      XCTAssertEqual(slot, "current")
      XCTAssertEqual(try runtime.store().list().count, 1)
      XCTAssertTrue(api.requests.isEmpty)
      reads += 1
    }
    _ = try await record(runtime)
    XCTAssertEqual(reads, 1)
  }

  func testLegacyMetadataCannotResurrectAfterOriginChangeAndRelaunch() throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, _, _) = try setup(folder)
    let path = folder.appendingPathComponent(runtime.configuration.originHash + "-device.json")
    var object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: path)) as? [String: Any])
    object.removeValue(forKey: "installation")
    try JSONSerialization.data(withJSONObject: object).write(to: path)
    _ = try InstallationStore(configuration: FlowLinkConfiguration("https://other.invalid/api/flowlink/v1"), directory: folder)
    let returned = try InstallationStore(configuration: runtime.configuration, directory: folder)
    XCTAssertNil(try returned.load())
    let relaunched = try InstallationStore(configuration: runtime.configuration, directory: folder)
    XCTAssertNil(try relaunched.load())
    XCTAssertNotEqual(relaunched.installationID, runtime.metadata.installationID)
  }

  func testDirectoryAndDiagnosticFilesRemainReadableAndExcludedFromBackup() throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, _, _) = try setup(folder)
    try runtime.bindingDirectory.replace([card], device: Fixture.deviceID)
    let diagnostics = try CaptureDiagnostics(directory: runtime.directory)
    diagnostics.record(.intentInvoked)
    _ = try runtime.store()
    for filename in ["bindings.json", "diagnostics.sqlite", "captures.sqlite"] {
      XCTAssertFalse(try Data(contentsOf: runtime.directory.appendingPathComponent(filename)).isEmpty)
    }
    XCTAssertEqual(try runtime.bindingDirectory.load(device: Fixture.deviceID), [card])
    XCTAssertEqual(try diagnostics.list().first?.stage, .intentInvoked)
    XCTAssertEqual(try runtime.directory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
  }

  func testDirectoryAndDiagnosticFilesUseAfterFirstUnlockProtection() throws {
    #if targetEnvironment(simulator)
    // Observed with iOS 27 Simulator: attributesOfItem omits protectionKey;
    // URL resources return class C even for explicit .noFileProtection and
    // .completeFileProtection controls. Do not manufacture a passing result.
    throw XCTSkip("Physical iOS required: Simulator cannot distinguish Data Protection classes. All class assertions and negative controls remain enabled on device.")
    #else
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, _, _) = try setup(folder)
    try runtime.bindingDirectory.replace([card], device: Fixture.deviceID)
    let diagnostics = try CaptureDiagnostics(directory: runtime.directory)
    diagnostics.record(.intentInvoked)
    _ = try runtime.store()
    for filename in ["bindings.json", "diagnostics.sqlite", "captures.sqlite"] {
      let protection = try runtime.directory.appendingPathComponent(filename)
        .resourceValues(forKeys: [.fileProtectionKey]).fileProtection
      XCTAssertEqual(try XCTUnwrap(protection), .completeUntilFirstUserAuthentication)
    }
    let unprotected = folder.appendingPathComponent("unprotected-test-only")
    let complete = folder.appendingPathComponent("complete-test-only")
    try Data([1]).write(to: unprotected, options: .noFileProtection)
    try Data([1]).write(to: complete, options: .completeFileProtection)
    XCTAssertEqual(try XCTUnwrap(unprotected.resourceValues(forKeys: [.fileProtectionKey]).fileProtection), URLFileProtection.none)
    XCTAssertEqual(try XCTUnwrap(complete.resourceValues(forKeys: [.fileProtectionKey]).fileProtection), .complete)
    #endif
  }

  func testDeliveryStateWriteFailureDoesNotReportCommittedReceiptAsNotRecorded() async throws {
    let folder = folder(); defer { try? FileManager.default.removeItem(at: folder) }
    let (runtime, _, api) = try setup(folder)
    api.onSend = { _ in
      var db: OpaquePointer?
      XCTAssertEqual(sqlite3_open(runtime.directory.appendingPathComponent("captures.sqlite").path, &db), SQLITE_OK)
      defer { sqlite3_close(db) }
      XCTAssertEqual(sqlite3_exec(db,
        "CREATE TRIGGER fail_finish BEFORE UPDATE OF state ON receipts BEGIN SELECT RAISE(ABORT,'test'); END;",
        nil, nil, nil), SQLITE_OK)
    }
    let message = try await record(runtime)
    XCTAssertEqual(message, "Saved locally. Delivery may be uncertain; review the original receipt in FlowLink.")
    let receipt = try XCTUnwrap(runtime.store().list().first)
    XCTAssertEqual(receipt.state, .inFlight)
    XCTAssertEqual(try receipt.capture.request.amount, "1.23")
    XCTAssertEqual(api.requests, ["capture"])
  }
}
