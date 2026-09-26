import Foundation

@MainActor final class PairingService {
  private let api: any FlowLinkAPI
  private let vault: any CredentialStore
  private let metadata: any MetadataStore
  private let configuration: FlowLinkConfiguration
  private let generator: CredentialGenerator
  private let now: () -> Date
  init(
    api: any FlowLinkAPI, vault: any CredentialStore, metadata: any MetadataStore,
    configuration: FlowLinkConfiguration, generator: CredentialGenerator = CredentialGenerator(),
    now: @escaping () -> Date = Date.init
  ) {
    self.api = api
    self.vault = vault
    self.metadata = metadata
    self.configuration = configuration
    self.generator = generator
    self.now = now
  }
  private func read<T: Decodable>(_ slot: String) throws -> T? {
    guard let data = try vault.read(slot) else { return nil }
    do { return try JSONDecoder().decode(T.self, from: data) } catch {
      throw FlowLinkError.credentialUnavailable
    }
  }
  func current() throws -> ProtectedConnection? {
    let connection: ProtectedConnection? = try read("current")
    if let connection {
      _ = try DeviceCredential(connection.credential.wireValue)
      guard Validation.uuid(connection.session.deviceID),
        Validation.uuid(connection.session.credentialID),
        Validation.revision(connection.session.credentialRevision),
        Validation.label(connection.session.label)
      else { throw FlowLinkError.credentialUnavailable }
    }
    return connection
  }
  func draft() throws -> PairingDraft? {
    var draft: PairingDraft? = try read("pairing-draft")
    if var value = draft {
      guard value.backend == configuration.baseURL.absoluteString,
        Validation.uuid(value.redemptionID)
      else { throw FlowLinkError.invalidConfiguration }
      _ = try DeviceCredential(value.candidate.wireValue)
      if let code = value.code { _ = try PairingCode("flpair1.\(code.id).\(code.secret)") }
      // Expire sensitive capability material on the next unlocked app use.
      // Retain only the protected candidate to check an uncertain commit.
      if value.code != nil
        && (now().timeIntervalSince(value.createdAt) >= 86_400 || value.createdAt > now())
      {
        value.code = nil
        try vault.store(JSONEncoder().encode(value), slot: "pairing-draft")
        draft = value
      }
    }
    return draft
  }
  func prepare(_ text: String) throws {
    guard try draft() == nil else { throw FlowLinkError.pairingConflict }
    let code = try PairingCode(text)
    let draft = PairingDraft(
      code: code, redemptionID: UUID().uuidString.lowercased(), candidate: try generator.generate(),
      createdAt: now(), backend: configuration.baseURL.absoluteString)
    try vault.store(JSONEncoder().encode(draft), slot: "pairing-draft")  // BEFORE any network request.
  }
  func resume() async throws -> DeviceSession {
    guard let draft = try draft() else { throw FlowLinkError.pairingUnavailable }
    let session: DeviceSession
    if draft.code == nil {
      do { session = try await api.device(draft.candidate).session } catch FlowLinkError
        .unauthorized
      { throw FlowLinkError.pairingUnavailable }
    } else {
      do { session = try await api.redeem(draft).session } catch FlowLinkError.pairingUnavailable {
        // An expired capability can still have committed before a lost response.
        do { session = try await api.device(draft.candidate).session } catch FlowLinkError
          .unauthorized
        { throw FlowLinkError.pairingUnavailable }
      }
    }
    try promote(credential: draft.candidate, session: session)
    return session
  }
  private func promote(credential: DeviceCredential, session: DeviceSession) throws {
    // One atomic Keychain update stores credential + identity. Keep draft until
    // every step succeeds; a crash at any step can replay the original claim.
    try vault.store(
      JSONEncoder().encode(ProtectedConnection(credential: credential, session: session)),
      slot: "current")
    try metadata.save(session)
    try vault.delete("pairing-draft")
  }
  func refreshIdentity(_ session: DeviceSession) throws {
    guard let current = try current(), current.session.deviceID == session.deviceID,
      current.session.credentialID == session.credentialID,
      current.session.credentialRevision == session.credentialRevision
    else { throw FlowLinkError.unauthorized }
    try vault.store(
      JSONEncoder().encode(ProtectedConnection(credential: current.credential, session: session)),
      slot: "current")
    try metadata.save(session)
  }
  @discardableResult func reset(confirmed: Bool) throws -> Bool {
    guard confirmed else { return false }
    try vault.delete("pairing-draft")
    try vault.delete("current")
    try metadata.clear()
    return true  // Does not revoke anything remotely.
  }
}
@MainActor struct BindingService {
  let api: any FlowLinkAPI
  func list(using credential: DeviceCredential) async throws -> [CardBinding] {
    try await api.bindings(credential)
  }
}
