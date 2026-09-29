import Foundation

@MainActor final class WalletRuntime {
  let configuration: FlowLinkConfiguration
  let metadata: InstallationStore
  let pairing: PairingService
  let api: any FlowLinkAPI & WalletTransport
  let directory: URL
  init() throws {
    configuration = try .installed()
    metadata = try InstallationStore(configuration: configuration)
    api = FlowLinkAPIClient(configuration: configuration)
    pairing = PairingService(
      api: api, vault: KeychainCredentialStore(namespace: metadata.namespace), metadata: metadata,
      configuration: configuration)
    directory = try BindingDirectory.walletDirectory()
  }
  // Uses the production orchestration with isolated persistence/transport in tests.
  init(configuration: FlowLinkConfiguration, metadata: InstallationStore,
    pairing: PairingService, api: any FlowLinkAPI & WalletTransport, directory: URL) {
    self.configuration = configuration
    self.metadata = metadata
    self.pairing = pairing
    self.api = api
    self.directory = directory
  }
  // Capture identity is non-secret local metadata. Credential availability is a
  // DELIVERY concern, not a condition for preserving Wallet evidence.
  func localIdentity() throws -> DeviceSession? {
    try WalletLocalIdentity.resolve(metadata: { try metadata.load() })
  }
  var bindingDirectory: BindingDirectory {
    BindingDirectory(installation: metadata.installationID, origin: configuration.origin, directory: directory)
  }
  func localBindings() throws -> [CardBinding] {
    guard let identity = try localIdentity() else { throw CaptureError.connection }
    return try bindingDirectory.load(device: identity.deviceID)
  }
  // Configuration-time discovery only; configured entity resolution never calls this.
  func bindings() async throws -> [CardBinding] {
    guard let identity = try localIdentity() else { throw CaptureError.connection }
    do {
      guard let current = try pairing.current(), current.session.deviceID == identity.deviceID
      else { throw CaptureError.connection }
      let cards = try await api.bindings(current.credential)
      try bindingDirectory.replace(cards, device: identity.deviceID)
      return cards
    } catch let error as FlowLinkError
      where error == .offline || error == .timeout || error == .credentialUnavailable
    {
      return try localBindings()
    }
  }
  func store() throws -> ReceiptStore {
    guard let identity = try localIdentity() else { throw CaptureError.connection }
    return try ReceiptStore(
      directory: directory, installation: metadata.installationID, device: identity.deviceID,
      origin: configuration.origin)
  }
  func service(_ store: ReceiptStore) -> CaptureService {
    CaptureService(store: store, transport: api, connection: { [pairing] in try pairing.current() },
      checkpoint: { [directory] stage, code in
        (try? CaptureDiagnostics(directory: directory))?.record(stage, code: code)
      })
  }
  // String is only the App Intent boundary. Financial normalization and the
  // existing persistence-before-Keychain/HTTP pipeline remain shared.
  func record(
    binding: String, bindingLabel: String, amountText: String, merchant: String?, name: String?,
    now: Date, zone: TimeZone, id: UUID
  ) async throws -> String {
    let value: Decimal
    do { value = try WalletNormalizer.ilsText(amountText) }
    catch {
      (try? CaptureDiagnostics(directory: directory))?.unsupportedAmount(amountText)
      throw CaptureError.amount
    }
    return try await record(binding: binding, bindingLabel: bindingLabel, amount: value,
      currency: "ILS", merchant: merchant, name: name, now: now, zone: zone, id: id)
  }
  func record(
    binding: String, bindingLabel: String, amount: Decimal, currency: String, merchant: String?, name: String?, now: Date,
    zone: TimeZone, id: UUID
  ) async throws -> String {
    let normalized = try WalletNormalizer.amount(amount, currency: currency)
    let selected = try WalletNormalizer.merchant(merchant, name: name)
    checkpoint(.parametersNormalized)
    guard Validation.uuid(binding), Validation.label(bindingLabel) else { throw CaptureError.binding }
    guard let identity = try localIdentity() else { throw CaptureError.connection }
    checkpoint(.localIdentityResolved)
    let capture = try FrozenCapture.make(
      binding: binding, amount: normalized, merchant: selected,
      installation: metadata.installationID, device: identity.deviceID,
      origin: configuration.origin, now: now, zone: zone, id: id, bindingLabel: bindingLabel)
    return try await service(store()).capture(capture)
  }
  private func checkpoint(_ stage: CaptureStage) {
    (try? CaptureDiagnostics(directory: directory))?.record(stage)
  }
}

@MainActor enum ForegroundCaptures {
  private static var attempts: [String: Int] = [:]
  private static var running = false
  static func beginSession() { attempts = [:] }
  static func resume() async {
    guard !running else { return }
    running = true
    defer { running = false }
    do {
      let runtime = try WalletRuntime()
      let store = try runtime.store()
      try await resume(store: store, service: runtime.service(store))
    } catch { /* Fail closed; history exposes local recovery. No logs or background promise. */  }
  }
  // Shared by launch/history and regression tests. Held receipts are never due work.
  static func resume(store: ReceiptStore, service: CaptureService, now: Date = Date()) async throws
  {
    for receipt in try store.list() where (attempts[receipt.id] ?? 0) < 3 {
      if [.queued, .retryWait, .inFlight].contains(receipt.state) && receipt.nextAttempt <= now {
        attempts[receipt.id, default: 0] += 1
        try await service.send(receipt.id)
      }
    }
  }
}

// Metadata is only evidence scope; reset clears it. Missing/revoked Keychain
// credentials cannot prevent capture, but can never authorize delivery.
@MainActor enum WalletLocalIdentity {
  static func resolve(metadata: () throws -> DeviceSession?) throws -> DeviceSession? {
    guard let value = try metadata() else { return nil }
    guard Validation.uuid(value.deviceID), Validation.uuid(value.credentialID),
      Validation.revision(value.credentialRevision), Validation.label(value.label)
    else { throw CaptureError.connection }
    return value
  }
}
