import Foundation

@testable import FlowLink

@MainActor final class MemoryVault: CredentialStore {
  var values: [String: Data] = [:]
  var failure: FlowLinkError?
  var beforeRead: ((String) throws -> Void)?
  func read(_ slot: String) throws -> Data? {
    try beforeRead?(slot)
    if let failure { throw failure }
    return values[slot]
  }
  func store(_ data: Data, slot: String) throws {
    if let failure { throw failure }
    values[slot] = data
  }
  func delete(_ slot: String) throws {
    if let failure { throw failure }
    values.removeValue(forKey: slot)
  }
}
@MainActor final class MemoryMetadata: MetadataStore {
  var value: DeviceSession?
  var failSave = false
  func load() throws -> DeviceSession? { value }
  func save(_ session: DeviceSession) throws {
    if failSave { throw FlowLinkError.storageUnavailable }
    value = session
  }
  func clear() throws { value = nil }
}
@MainActor final class MockAPI: FlowLinkAPI {
  var drafts: [PairingDraft] = []
  var deviceCredentials: [DeviceCredential] = []
  var redeemError: FlowLinkError?
  var deviceError: FlowLinkError?
  var bindingError: FlowLinkError?
  var pause = false
  var cards: [CardBinding] = []
  func redeem(_ draft: PairingDraft) async throws -> PairingResponse {
    drafts.append(draft)
    if pause { try await Task.sleep(for: .milliseconds(30)) }
    if let redeemError { throw redeemError }
    return PairingResponse(
      outcome: "paired", deviceID: Fixture.deviceID, deviceLabel: "Test phone",
      credentialID: Fixture.credentialID, credentialRevision: "1", replayed: drafts.count > 1)
  }
  func device(_ credential: DeviceCredential) async throws -> DeviceResponse {
    deviceCredentials.append(credential)
    if let deviceError { throw deviceError }
    return Fixture.device
  }
  func bindings(_ credential: DeviceCredential) async throws -> [CardBinding] {
    if let bindingError { throw bindingError }
    return cards
  }
}
enum Fixture {
  static let deviceID = "11111111-1111-4111-8111-111111111111"
  static let credentialID = "22222222-2222-4222-8222-222222222222"
  static let code =
    "flpair1.11111111-1111-4111-8111-111111111111." + Data(repeating: 0, count: 32).base64URL
  static let device = DeviceResponse(
    device: .init(id: deviceID, label: "Test phone", status: "active"),
    credential: .init(id: credentialID, revision: "1"), protocolVersion: 1, ingestionEnabled: false)
  static func credential() throws -> DeviceCredential {
    try CredentialGenerator(randomBytes: { Data(repeating: 1, count: 32) }).generate()
  }
  @MainActor static func context(now: @escaping () -> Date = Date.init) throws -> (
    PairingService, MemoryVault, MemoryMetadata, MockAPI, FlowLinkConfiguration
  ) {
    let config = try FlowLinkConfiguration("https://test.invalid/api/flowlink/v1")
    let vault = MemoryVault()
    let metadata = MemoryMetadata()
    let api = MockAPI()
    return (
      PairingService(api: api, vault: vault, metadata: metadata, configuration: config, now: now),
      vault, metadata, api, config
    )
  }
}
