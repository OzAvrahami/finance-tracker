import Foundation

enum FlowLinkError: Error, Equatable, LocalizedError {
  case invalidPairing, invalidConfiguration, credentialUnavailable, storageUnavailable
  case offline, timeout, unauthorized, pairingInvalid, pairingUnavailable, pairingConflict
  case backendUnavailable, rateLimited, malformedResponse, redirectRefused

  var errorDescription: String? {
    switch self {
    case .invalidPairing: "Enter the complete pairing code supplied by the Finance Tracker owner."
    case .invalidConfiguration: "Check the backend address and its secure connection configuration."
    case .credentialUnavailable: "Secure storage is unavailable. Unlock this device and try again."
    case .storageUnavailable:
      "FlowLink could not safely save its connection. Try again before continuing."
    case .offline: "The backend could not be reached. Your saved connection has been kept."
    case .timeout: "The request timed out. Retry to recover the same pairing result."
    case .unauthorized:
      "This device credential is no longer accepted. Ask the owner about recovery."
    case .pairingInvalid: "The pairing code was not accepted. Ask the owner to check it."
    case .pairingUnavailable:
      "Pairing has expired or is unavailable. Ask the owner for recovery before resetting."
    case .pairingConflict:
      "This pairing cannot be reused. Ask the owner to review the device connection."
    case .backendUnavailable:
      "FlowLink is unavailable on this backend. It may not be deployed or configured yet."
    case .rateLimited: "Too many requests. Wait before trying again."
    case .malformedResponse:
      "The backend returned an unsupported response. Your saved connection has been kept."
    case .redirectRefused:
      "The backend redirected the request. Check the configured address before retrying."
    }
  }
}

enum Validation {
  static func uuid(_ value: String) -> Bool {
    value.range(
      of: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
      options: .regularExpression) != nil
  }
  static func revision(_ value: String) -> Bool {
    value.range(of: "^[1-9][0-9]{0,18}$", options: .regularExpression) != nil
      && UInt64(value).map { $0 <= UInt64(Int64.max) } == true
  }
  static func label(_ value: String) -> Bool {
    !value.isEmpty && value.unicodeScalars.count <= 80
      && !value.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
  }
  static func secret(_ value: String) -> Bool {
    guard value.count == 43,
      value.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
      let data = Data(
        base64Encoded: value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(
          of: "_", with: "/") + "=")
    else { return false }
    return data.count == 32 && data.base64URL == value
  }
}
extension Data {
  var base64URL: String {
    base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(
      of: "/", with: "_"
    ).replacingOccurrences(of: "=", with: "")
  }
}

struct DeviceSession: Codable, Equatable {
  let deviceID: String
  let label: String
  let credentialID: String
  let credentialRevision: String
}
struct DeviceResponse: Codable, Equatable {
  struct Device: Codable, Equatable {
    let id: String
    let label: String
    let status: String
  }
  struct Credential: Codable, Equatable {
    let id: String
    let revision: String
  }
  let device: Device
  let credential: Credential
  let protocolVersion: Int
  let ingestionEnabled: Bool
  enum CodingKeys: String, CodingKey {
    case device, credential
    case protocolVersion = "protocol_version"
    case ingestionEnabled = "ingestion_enabled"
  }
  var session: DeviceSession {
    DeviceSession(
      deviceID: device.id, label: device.label, credentialID: credential.id,
      credentialRevision: credential.revision)
  }
  func validate() throws {
    guard Validation.uuid(device.id), Validation.label(device.label), device.status == "active",
      Validation.uuid(credential.id), Validation.revision(credential.revision)
    else { throw FlowLinkError.malformedResponse }
    guard protocolVersion == 1 else { throw FlowLinkError.invalidConfiguration }
  }
}
struct PairingResponse: Decodable {
  let outcome: String
  let deviceID: String
  let deviceLabel: String
  let credentialID: String
  let credentialRevision: String
  let replayed: Bool
  enum CodingKeys: String, CodingKey {
    case outcome, replayed
    case deviceID = "device_id"
    case deviceLabel = "device_label"
    case credentialID = "credential_id"
    case credentialRevision = "credential_revision"
  }
  var session: DeviceSession {
    DeviceSession(
      deviceID: deviceID, label: deviceLabel, credentialID: credentialID,
      credentialRevision: credentialRevision)
  }
  func validate() throws {
    guard outcome == "paired", Validation.uuid(deviceID), Validation.uuid(credentialID),
      Validation.label(deviceLabel), Validation.revision(credentialRevision)
    else { throw FlowLinkError.malformedResponse }
  }
}
struct CardBinding: Codable, Identifiable, Equatable {
  enum Status: String, Codable { case active, disabled }
  let id: String
  let label: String
  let status: Status
  let revision: String
  let available: Bool
  var isAvailable: Bool { status == .active && available }
  func validate() throws {
    guard Validation.uuid(id), Validation.label(label), Validation.revision(revision) else {
      throw FlowLinkError.malformedResponse
    }
  }
}
struct BindingResponse: Codable { let bindings: [CardBinding] }

enum DeviceState: Equatable {
  case unpaired, pairing, checking, paired, credentialUnavailable, revoked, offline, configurationError
  var title: String {
    switch self {
    case .unpaired: "Not connected"
    case .pairing: "Connecting"
    case .checking: "Checking connection"
    case .paired: "Connected"
    case .credentialUnavailable: "Unlock to continue"
    case .revoked: "Connection needs recovery"
    case .offline: "Offline"
    case .configurationError: "Backend unavailable"
    }
  }
}
