import XCTest

@testable import FlowLink

@MainActor final class PersistenceTests: XCTestCase {
  func testNonSecretMetadataBackupExclusionAndStableInstallation() throws {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: folder) }
    let config = try FlowLinkConfiguration("https://test.invalid/api/flowlink/v1")
    let store = try InstallationStore(configuration: config, directory: folder)
    try store.save(Fixture.device.session)
    let next = try InstallationStore(configuration: config, directory: folder)
    XCTAssertEqual(next.installationID, store.installationID)
    XCTAssertEqual(try next.load(), Fixture.device.session)
    XCTAssertEqual(
      try folder.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
    for file in try FileManager.default.contentsOfDirectory(
      at: folder, includingPropertiesForKeys: nil)
    {
      let content = try String(contentsOf: file, encoding: .utf8)
      XCTAssertFalse(content.contains("fldev1_"))
      XCTAssertFalse(content.contains("flpair1."))
    }
  }
  func testOriginChangeAndReinstallCannotAdoptOldKeychainNamespace() throws {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: folder) }
    let config = try FlowLinkConfiguration("https://a.invalid/api/flowlink/v1")
    let original = try InstallationStore(configuration: config, directory: folder)
    let other = try InstallationStore(
      configuration: FlowLinkConfiguration("https://b.invalid/api/flowlink/v1"), directory: folder)
    XCTAssertNotEqual(original.namespace, other.namespace)
    let returned = try InstallationStore(configuration: config, directory: folder)
    XCTAssertNotEqual(returned.namespace, original.namespace)
    XCTAssertNotEqual(returned.namespace, other.namespace)
    try FileManager.default.removeItem(at: folder)
    let fresh = try InstallationStore(configuration: config, directory: folder)
    XCTAssertNotEqual(original.installationID, fresh.installationID)
    XCTAssertNotEqual(original.namespace, fresh.namespace)
  }
  func testCorruptMarkerFailsClosedInsteadOfSilentlyInventingIdentity() throws {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: folder) }
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    try Data("broken".utf8).write(to: folder.appendingPathComponent("installation.json"))
    XCTAssertThrowsError(
      try InstallationStore(
        configuration: FlowLinkConfiguration(FlowLinkConfiguration.defaultBase), directory: folder))
  }
}
