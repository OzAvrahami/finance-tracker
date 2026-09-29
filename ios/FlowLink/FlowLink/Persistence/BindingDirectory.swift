import Foundation

// Display/evidence only. No credential or financial authority lives here.
// Shared by the normal app and the App Intent in the same application target/container.
@MainActor final class BindingDirectory {
  private struct Snapshot: Codable {
    let device: String
    let installation: String
    let origin: String
    let bindings: [CardBinding]
  }
  let directory: URL
  private let installation: String
  private let origin: String
  private var url: URL { directory.appendingPathComponent("bindings.json") }

  static func walletDirectory() throws -> URL {
    try FileManager.default.url(
      for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
    ).appendingPathComponent("FlowLink/Wallet", isDirectory: true)
  }

  init(installation: String, origin: String, directory: URL) {
    self.installation = installation
    self.origin = origin
    self.directory = directory
  }

  func load(device: String) throws -> [CardBinding] {
    guard Validation.uuid(installation), Validation.uuid(device) else { throw CaptureError.binding }
    guard FileManager.default.fileExists(atPath: url.path) else { return [] }
    do {
      let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? Int.max
      guard size <= 131_072 else { throw CaptureError.storage }
      let value = try JSONDecoder().decode(Snapshot.self, from: Data(contentsOf: url))
      guard value.installation == installation, value.origin == origin, value.device == device
      else { return [] }
      try validate(value.bindings, limit: 256)
      return value.bindings
    } catch { throw CaptureError.storage }
  }

  func replace(_ cards: [CardBinding], device: String) throws {
    try validate(cards, limit: 32)
    // Preserve removed IDs as unavailable metadata for configured automations.
    // Retirement must not prevent evidence capture or silently remap an old ID.
    let old = try load(device: device)
    let ids = Set(cards.map(\.id))
    let retired = old.filter { !ids.contains($0.id) }.map {
      CardBinding(id: $0.id, label: $0.label, status: .disabled, revision: $0.revision, available: false)
    }
    let combined = cards + retired
    try validate(combined, limit: 256) // Fail visibly at capacity; never silently evict an identity.
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    var folder = directory
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try folder.setResourceValues(values)
    let bytes = try JSONEncoder().encode(Snapshot(
      device: device, installation: installation, origin: origin, bindings: combined))
    guard bytes.count <= 131_072 else { throw CaptureError.storage }
    try bytes.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }

  private func validate(_ cards: [CardBinding], limit: Int) throws {
    guard cards.count <= limit, Set(cards.map(\.id)).count == cards.count else {
      throw CaptureError.storage
    }
    try cards.forEach { try $0.validate() }
  }
}
