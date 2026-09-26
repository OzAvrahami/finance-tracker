import XCTest

@testable import FlowLink

@MainActor final class PairingTests: XCTestCase {
  func testKeychainFirstSuccessfulPairingPromotesAndRemovesDraft() async throws {
    let (service, vault, metadata, api, _) = try Fixture.context()
    try service.prepare(Fixture.code)
    XCTAssertNotNil(vault.values["pairing-draft"])
    XCTAssertTrue(api.drafts.isEmpty)
    let result = try await service.resume()
    XCTAssertEqual(result, Fixture.device.session)
    XCTAssertEqual(metadata.value, result)
    XCTAssertNil(vault.values["pairing-draft"])
    XCTAssertNotNil(try service.current())
  }
  func testLostResponseAndRelaunchReuseExactlyOneGeneratedCredential() async throws {
    let (_, vault, metadata, api, config) = try Fixture.context()
    var generated = 0
    let generator = CredentialGenerator(randomBytes: {
      generated += 1
      return Data(repeating: 2, count: 32)
    })
    let a = PairingService(
      api: api, vault: vault, metadata: metadata, configuration: config, generator: generator)
    try a.prepare(Fixture.code)
    api.redeemError = .timeout
    do {
      _ = try await a.resume()
      XCTFail()
    } catch { XCTAssertEqual(error as? FlowLinkError, .timeout) }
    api.redeemError = nil
    let restarted = PairingService(
      api: api, vault: vault, metadata: metadata, configuration: config, generator: generator)
    _ = try await restarted.resume()
    XCTAssertEqual(generated, 1)
    XCTAssertEqual(api.drafts.count, 2)
    XCTAssertEqual(api.drafts[0].redemptionID, api.drafts[1].redemptionID)
    XCTAssertEqual(api.drafts[0].candidate, api.drafts[1].candidate)
    XCTAssertEqual(api.drafts[0].code, api.drafts[1].code)
  }
  func testLockedKeychainPreventsNetworkAndGenerationDoesNotBecomeAuthority() async throws {
    let (service, vault, _, api, _) = try Fixture.context()
    vault.failure = .credentialUnavailable
    XCTAssertThrowsError(try service.prepare(Fixture.code))
    XCTAssertTrue(api.drafts.isEmpty)
    XCTAssertThrowsError(try service.current())
    vault.failure = nil
    XCTAssertNil(try service.current())
  }
  func testPromotionInterruptedByMetadataFailureKeepsRecoverableDraft() async throws {
    let (service, vault, metadata, api, _) = try Fixture.context()
    try service.prepare(Fixture.code)
    metadata.failSave = true
    do {
      _ = try await service.resume()
      XCTFail()
    } catch { XCTAssertEqual(error as? FlowLinkError, .storageUnavailable) }
    XCTAssertNotNil(vault.values["current"])
    XCTAssertNotNil(vault.values["pairing-draft"])
    metadata.failSave = false
    _ = try await service.resume()
    XCTAssertEqual(api.drafts[0].candidate, api.drafts[1].candidate)
    XCTAssertNil(try service.draft())
  }
  func testExpiredDraftRemovesCapabilityAndChecksOriginalCandidateOnly() async throws {
    var clock = Date(timeIntervalSince1970: 1_000_000)
    let (service, vault, _, api, _) = try Fixture.context(now: { clock })
    try service.prepare(Fixture.code)
    let original = try XCTUnwrap(service.draft())
    clock.addTimeInterval(86_401)
    XCTAssertNil(try service.draft()?.code)
    let stored = String(decoding: try XCTUnwrap(vault.values["pairing-draft"]), as: UTF8.self)
    XCTAssertFalse(stored.contains(try XCTUnwrap(original.code).secret))
    _ = try await service.resume()
    XCTAssertTrue(api.drafts.isEmpty)
    XCTAssertEqual(api.deviceCredentials, [original.candidate])
  }
  func testExpiredServerReceiptUsesCandidateStatusAndNeverAutoEnrolls() async throws {
    let (service, _, _, api, _) = try Fixture.context()
    try service.prepare(Fixture.code)
    api.redeemError = .pairingUnavailable
    _ = try await service.resume()
    XCTAssertEqual(api.drafts.count, 1)
    XCTAssertEqual(api.deviceCredentials.count, 1)
  }
  func testFailedRecoveryKeepsCandidateUntilExplicitReset() async throws {
    let (service, _, _, api, _) = try Fixture.context()
    try service.prepare(Fixture.code)
    api.redeemError = .pairingUnavailable
    api.deviceError = .unauthorized
    do {
      _ = try await service.resume()
      XCTFail()
    } catch { XCTAssertEqual(error as? FlowLinkError, .pairingUnavailable) }
    XCTAssertNotNil(try service.draft())
    XCTAssertThrowsError(try service.prepare(Fixture.code))
    XCTAssertFalse(try service.reset(confirmed: false))
    XCTAssertNotNil(try service.draft())
    XCTAssertTrue(try service.reset(confirmed: true))
    XCTAssertNil(try service.draft())
  }
  func testRevocationClearsDisplayedAvailabilityWithoutErasingCredential() async throws {
    let (service, vault, _, api, config) = try Fixture.context()
    try service.prepare(Fixture.code)
    _ = try await service.resume()
    let model = ConnectionModel(api: api, pairing: service, configuration: config)
    api.deviceError = .unauthorized
    await model.restore()
    XCTAssertEqual(model.state, .revoked)
    XCTAssertTrue(model.cards.isEmpty)
    XCTAssertNotNil(vault.values["current"])
  }
  func testOfflineThenRecoveryAndEmptyCards() async throws {
    let (service, vault, _, api, config) = try Fixture.context()
    try service.prepare(Fixture.code)
    _ = try await service.resume()
    let model = ConnectionModel(api: api, pairing: service, configuration: config)
    api.deviceError = .offline
    await model.restore()
    XCTAssertEqual(model.state, .offline)
    XCTAssertNotNil(vault.values["current"])
    api.deviceError = nil
    await model.refresh()
    XCTAssertEqual(model.state, .paired)
    XCTAssertTrue(model.cards.isEmpty)
    XCTAssertEqual(model.status?.ingestionEnabled, false)
  }
  func testResetRequiresConfirmationAndCanBeCancelled() async throws {
    let (service, vault, _, api, config) = try Fixture.context()
    try service.prepare(Fixture.code)
    _ = try await service.resume()
    let model = ConnectionModel(api: api, pairing: service, configuration: config)
    await model.restore()
    model.confirmReset()
    XCTAssertNotNil(vault.values["current"])
    model.requestReset()
    model.cancelReset()
    model.confirmReset()
    XCTAssertNotNil(vault.values["current"])
    model.requestReset()
    model.confirmReset()
    XCTAssertTrue(vault.values.isEmpty)
    XCTAssertEqual(model.state, .unpaired)
  }
  func testDuplicateSubmissionIsPreventedWhileConnecting() async throws {
    let (service, _, _, api, config) = try Fixture.context()
    api.pause = true
    let model = ConnectionModel(api: api, pairing: service, configuration: config)
    let first = Task { await model.connect(code: Fixture.code) }
    await Task.yield()
    await model.connect(code: Fixture.code)
    await first.value
    XCTAssertEqual(api.drafts.count, 1)
    XCTAssertEqual(model.state, .paired)
  }
  func testUnfinishedDraftRestoresWithoutAnyAutomaticNetworkRequest() async throws {
    let (service, _, _, api, config) = try Fixture.context()
    try service.prepare(Fixture.code)
    let model = ConnectionModel(api: api, pairing: service, configuration: config)
    await model.restore()
    XCTAssertTrue(model.hasDraft)
    XCTAssertEqual(model.state, .unpaired)
    XCTAssertTrue(api.drafts.isEmpty)
    XCTAssertTrue(api.deviceCredentials.isEmpty)
  }
  func testCredentialReplacementIsAtomicAndDeleteIsLocal() async throws {
    let (service, _, metadata, api, _) = try Fixture.context()
    try service.prepare(Fixture.code)
    _ = try await service.resume()
    let old = try service.current()?.credential
    try service.prepare(Fixture.code)
    _ = try await service.resume()
    XCTAssertNotEqual(try service.current()?.credential, old)
    try service.reset(confirmed: true)
    XCTAssertNil(try service.current())
    XCTAssertNil(metadata.value)
    XCTAssertEqual(api.drafts.count, 2)
  }
}
