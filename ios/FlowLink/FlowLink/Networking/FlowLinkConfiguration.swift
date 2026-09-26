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
      return try Self(environment["FLOWLINK_API_BASE_URL"] ?? defaultBase, allowLocalHTTP: true)
    #else
      return try Self(defaultBase)
    #endif
  }
}
