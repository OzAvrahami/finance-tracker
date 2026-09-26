import Foundation

@MainActor protocol MetadataStore {
  func load() throws -> DeviceSession?
  func save(_ session: DeviceSession) throws
  func clear() throws
}
@MainActor final class InstallationStore: MetadataStore {
  private let metadataURL: URL
  let installationID: String
  let namespace: String
  private let backend: String
  private struct Installation: Codable {
    let id: String
    let origin: String
  }
  private struct Metadata: Codable {
    let backend: String
    let session: DeviceSession
  }
  init(configuration: FlowLinkConfiguration, directory: URL? = nil) throws {
    do {
      let manager = FileManager.default
      var folder =
        try directory
        ?? manager.url(
          for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        ).appendingPathComponent("FlowLink", isDirectory: true)
      try manager.createDirectory(
        at: folder, withIntermediateDirectories: true,
        attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try folder.setResourceValues(values)
      let marker = folder.appendingPathComponent("installation.json")
      if manager.fileExists(atPath: marker.path) {
        let stored = try JSONDecoder().decode(Installation.self, from: Data(contentsOf: marker))
        guard Validation.uuid(stored.id) else { throw FlowLinkError.storageUnavailable }
        // An explicit backend change starts a fresh local pairing namespace, even
        // when switching back to a previously used origin. Never resurrect an old session.
        installationID =
          stored.origin == configuration.origin ? stored.id : UUID().uuidString.lowercased()
      } else {
        installationID = UUID().uuidString.lowercased()
      }
      try JSONEncoder().encode(Installation(id: installationID, origin: configuration.origin))
        .write(
          to: marker, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      namespace = configuration.originHash + ":" + installationID
      backend = configuration.baseURL.absoluteString
      metadataURL = folder.appendingPathComponent(configuration.originHash + "-device.json")
    } catch { throw FlowLinkError.storageUnavailable }
  }
  func load() throws -> DeviceSession? {
    guard FileManager.default.fileExists(atPath: metadataURL.path) else { return nil }
    do {
      let value = try JSONDecoder().decode(Metadata.self, from: Data(contentsOf: metadataURL))
      guard value.backend == backend else { throw FlowLinkError.storageUnavailable }
      return value.session
    } catch { throw FlowLinkError.storageUnavailable }
  }
  func save(_ session: DeviceSession) throws {
    do {
      try JSONEncoder().encode(Metadata(backend: backend, session: session)).write(
        to: metadataURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    } catch { throw FlowLinkError.storageUnavailable }
  }
  func clear() throws {
    guard FileManager.default.fileExists(atPath: metadataURL.path) else { return }
    do { try FileManager.default.removeItem(at: metadataURL) } catch {
      throw FlowLinkError.storageUnavailable
    }
  }
}
