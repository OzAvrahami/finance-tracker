import CryptoKit
import Foundation

struct FlowLinkConfiguration: Equatable {
  static let defaultBase = "https://finance-tracker-production-d34c.up.railway.app/api/flowlink/v1"
  static let ownerSite = "https://finance-tracker-sigma-ten-19.vercel.app/settings"
  let baseURL: URL
  let origin: String
  init(_ raw: String, allowLocalHTTP: Bool = false) throws {
    guard var c = URLComponents(string: raw), let scheme = c.scheme?.lowercased(),
      let host = c.host?.lowercased(), !host.isEmpty,
      c.user == nil, c.password == nil, c.query == nil, c.fragment == nil,
      c.port.map({ (1...65535).contains($0) }) ?? true,
      c.percentEncodedPath == "/api/flowlink/v1" || c.percentEncodedPath == "/api/flowlink/v1/"
    else { throw FlowLinkError.invalidConfiguration }
    let loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].contains(host)
    guard scheme == "https" || (allowLocalHTTP && scheme == "http" && loopback) else {
      throw FlowLinkError.invalidConfiguration
    }
    if c.port == (scheme == "https" ? 443 : 80) { c.port = nil }
    c.scheme = scheme
    c.host = host
    c.path = "/api/flowlink/v1"
    guard let url = c.url else { throw FlowLinkError.invalidConfiguration }
    baseURL = url
    origin = "\(scheme)://\(host):\(c.port ?? (scheme == "https" ? 443 : 80))"
  }
  var originHash: String {
    SHA256.hash(data: Data(origin.utf8)).map { String(format: "%02x", $0) }.joined()
  }
  static func installed(environment: [String: String] = ProcessInfo.processInfo.environment) throws
    -> Self
  {
    #if DEBUG
      // Intent launches do not inherit Xcode's Run environment. Persist only the
      // validated, non-secret development endpoint in the non-backed-up app container.
      var folder = try FileManager.default.url(
        for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
      ).appendingPathComponent("FlowLink", isDirectory: true)
      try FileManager.default.createDirectory(
        at: folder, withIntermediateDirectories: true,
        attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try folder.setResourceValues(values)
      let selection = folder.appendingPathComponent("backend-selection.json")
      if let override = environment["FLOWLINK_API_BASE_URL"] {
        let config = try Self(override, allowLocalHTTP: true)
        try JSONEncoder().encode(config.baseURL.absoluteString).write(
          to: selection, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return config
      }
      if FileManager.default.fileExists(atPath: selection.path) {
        return try Self(
          JSONDecoder().decode(String.self, from: Data(contentsOf: selection)), allowLocalHTTP: true
        )
      }
      return try Self(defaultBase)
    #else
      return try Self(defaultBase)
    #endif
  }
}
