import Foundation
import Security

struct DeviceCredential: Codable, Equatable, CustomStringConvertible, CustomDebugStringConvertible {
  private let value: String
  init(_ value: String) throws {
    guard value.hasPrefix("fldev1_"), Validation.secret(String(value.dropFirst(7))) else {
      throw FlowLinkError.invalidPairing
    }
    self.value = value
  }
  var authorization: String { "Bearer " + value }
  var wireValue: String { value }
  var description: String { "[protected device credential]" }
  var debugDescription: String { description }
}
struct PairingCode: Codable, Equatable, CustomStringConvertible, CustomDebugStringConvertible {
  let id: String
  let secret: String
  init(_ text: String) throws {
    let parts = text.trimmingCharacters(in: .whitespacesAndNewlines).split(
      separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 3, parts[0] == "flpair1", Validation.uuid(String(parts[1])),
      Validation.secret(String(parts[2]))
    else { throw FlowLinkError.invalidPairing }
    id = String(parts[1])
    secret = String(parts[2])
  }
  var description: String { "[protected pairing capability]" }
  var debugDescription: String { description }
}
struct CredentialGenerator {
  var randomBytes: () throws -> Data = {
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
      throw FlowLinkError.credentialUnavailable
    }
    return Data(bytes)
  }
  func generate() throws -> DeviceCredential {
    let data = try randomBytes()
    guard data.count == 32 else { throw FlowLinkError.credentialUnavailable }
    return try DeviceCredential("fldev1_" + data.base64URL)
  }
}
// These Codable records are Keychain-only, never app status/UserDefaults models.
struct ProtectedConnection: Codable, CustomStringConvertible, CustomDebugStringConvertible {
  let credential: DeviceCredential
  let session: DeviceSession
  var description: String { "[protected connection]" }
  var debugDescription: String { description }
}
struct PairingDraft: Codable, CustomStringConvertible, CustomDebugStringConvertible {
  var code: PairingCode?
  let redemptionID: String
  let candidate: DeviceCredential
  let createdAt: Date
  let backend: String
  var description: String { "[protected pairing recovery]" }
  var debugDescription: String { description }
}
