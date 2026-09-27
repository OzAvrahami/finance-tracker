import Foundation

@MainActor final class WalletRuntime {
  let configuration: FlowLinkConfiguration
  let metadata: InstallationStore
  let pairing: PairingService
  let api: FlowLinkAPIClient
  let directory: URL
  init() throws {
    configuration = try .installed()
    metadata = try InstallationStore(configuration: configuration)
    api = FlowLinkAPIClient(configuration: configuration)
    pairing = PairingService(
      api: api, vault: KeychainCredentialStore(namespace: metadata.namespace), metadata: metadata,
      configuration: configuration)
    directory = try FileManager.default.url(
      for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
    )
    .appendingPathComponent("FlowLink/Wallet", isDirectory: true)
  }
  private struct BindingCache: Codable {
    let device: String
    let installation: String
    let origin: String
    let bindings: [CardBinding]
  }
  func localIdentity() throws -> DeviceSession? {
    try WalletLocalIdentity.resolve(
      credential: { try pairing.current() }, metadata: { try metadata.load() })
  }
  func bindings() async throws -> [CardBinding] {
    guard let identity = try localIdentity() else { return [] }
    let url = directory.appendingPathComponent("bindings.json")
    do {
      guard let current = try pairing.current(), current.session.deviceID == identity.deviceID
      else { throw CaptureError.connection }
      let cards = try await api.bindings(current.credential)
      try FileManager.default.createDirectory(
        at: directory, withIntermediateDirectories: true,
        attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
      try JSONEncoder().encode(
        BindingCache(
          device: current.session.deviceID, installation: metadata.installationID,
          origin: configuration.origin, bindings: cards)
      ).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      return cards
    } catch let error as FlowLinkError
      where error == .offline || error == .timeout || error == .credentialUnavailable
    {
      guard let data = try? Data(contentsOf: url), data.count <= 32768,
        let cache = try? JSONDecoder().decode(BindingCache.self, from: data),
        cache.device == identity.deviceID, cache.installation == metadata.installationID,
        cache.origin == configuration.origin, cache.bindings.count <= 32
      else { throw error }
      try cache.bindings.forEach { try $0.validate() }
      return cache.bindings
    }
  }
  func store() throws -> ReceiptStore {
    guard let identity = try localIdentity() else { throw CaptureError.connection }
    return try ReceiptStore(
      directory: directory, installation: metadata.installationID, device: identity.deviceID,
      origin: configuration.origin)
  }
  func service(_ store: ReceiptStore) -> CaptureService {
    CaptureService(store: store, transport: api, connection: { [pairing] in try pairing.current() })
  }
  func record(
    binding: String, amount: Decimal, currency: String, merchant: String?, name: String?, now: Date,
    zone: TimeZone, id: UUID
  ) async throws -> String {
    let normalized = try WalletNormalizer.amount(amount, currency: currency)
    let selected = try WalletNormalizer.merchant(merchant, name: name)
    guard let identity = try localIdentity() else { throw CaptureError.connection }
    guard let approved = try await bindings().first(where: { $0.id == binding && $0.isAvailable })
    else {
      throw CaptureError.binding
    }
    let capture = try FrozenCapture.make(
      binding: binding, amount: normalized, merchant: selected,
      installation: metadata.installationID, device: identity.deviceID,
      origin: configuration.origin, now: now, zone: zone, id: id, bindingLabel: approved.label)
    return try await service(store()).capture(capture)
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

// Metadata is a local recovery hint, never transmission authority. A missing
// credential (reset/deletion) must not resurrect a session from metadata.
@MainActor enum WalletLocalIdentity {
  static func resolve(
    credential: () throws -> ProtectedConnection?, metadata: () throws -> DeviceSession?
  ) throws -> DeviceSession? {
    do { return try credential()?.session } catch FlowLinkError.credentialUnavailable {
      guard let value = try metadata(), Validation.uuid(value.deviceID),
        Validation.uuid(value.credentialID),
        Validation.revision(value.credentialRevision), Validation.label(value.label)
      else { throw CaptureError.connection }
      return value
    }
  }
}
