import Foundation

struct PairingRequest: Encodable, CustomStringConvertible, CustomDebugStringConvertible {
  let pairingID: String
  let secret: String
  let redemptionID: String
  let deviceCredential: String
  enum CodingKeys: String, CodingKey {
    case pairingID = "pairing_id"
    case secret
    case redemptionID = "redemption_id"
    case deviceCredential = "device_credential"
  }
  init(draft: PairingDraft) throws {
    guard let code = draft.code else { throw FlowLinkError.pairingUnavailable }
    pairingID = code.id
    secret = code.secret
    redemptionID = draft.redemptionID
    deviceCredential = draft.candidate.wireValue
  }
  var description: String { "[protected pairing request]" }
  var debugDescription: String { description }
}
@MainActor protocol FlowLinkAPI {
  func redeem(_ draft: PairingDraft) async throws -> PairingResponse
  func device(_ credential: DeviceCredential) async throws -> DeviceResponse
  func bindings(_ credential: DeviceCredential) async throws -> [CardBinding]
}
// No redirect is needed by this fixed API. Refuse ALL redirects, including pairing
// POSTs whose bodies contain secrets even though they have no Authorization header.
final class RedirectGuard: NSObject, URLSessionTaskDelegate, Sendable {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }
}
@MainActor final class FlowLinkAPIClient: FlowLinkAPI, WalletTransport {
  let configuration: FlowLinkConfiguration
  private let session: URLSession
  init(
    configuration: FlowLinkConfiguration, sessionConfiguration: URLSessionConfiguration = .ephemeral
  ) {
    self.configuration = configuration
    sessionConfiguration.urlCache = nil
    sessionConfiguration.httpCookieStorage = nil
    sessionConfiguration.urlCredentialStorage = nil
    sessionConfiguration.requestCachePolicy = .reloadIgnoringLocalCacheData
    sessionConfiguration.timeoutIntervalForRequest = 20
    sessionConfiguration.timeoutIntervalForResource = 25
    session = URLSession(
      configuration: sessionConfiguration, delegate: RedirectGuard(), delegateQueue: nil)
  }
  deinit { session.invalidateAndCancel() }
  func redeem(_ draft: PairingDraft) async throws -> PairingResponse {
    guard draft.backend == configuration.baseURL.absoluteString else {
      throw FlowLinkError.invalidConfiguration
    }
    let value: PairingResponse = try await call(
      "pairings/redeem", body: JSONEncoder().encode(PairingRequest(draft: draft)),
      allowed: [200, 201])
    try value.validate()
    return value
  }
  func device(_ credential: DeviceCredential) async throws -> DeviceResponse {
    let value: DeviceResponse = try await call("device", credential: credential)
    try value.validate()
    return value
  }
  func bindings(_ credential: DeviceCredential) async throws -> [CardBinding] {
    let value: BindingResponse = try await call("device/bindings", credential: credential)
    guard value.bindings.count <= 32, Set(value.bindings.map(\.id)).count == value.bindings.count
    else { throw FlowLinkError.malformedResponse }
    try value.bindings.forEach { try $0.validate() }
    return value.bindings
  }
  func sendCapture(_ bytes: Data, credential: DeviceCredential) async -> DeliveryDecision {
    var request = URLRequest(
      url: configuration.baseURL.appendingPathComponent("wallet-transactions"), timeoutInterval: 20)
    request.httpMethod = "POST"
    request.httpBody = bytes
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue(credential.authorization, forHTTPHeaderField: "Authorization")
    do {
      let (stream, response) = try await session.bytes(for: request)
      guard let http = response as? HTTPURLResponse else {
        return .init(state: .paused, code: "unknown_response")
      }
      var data = Data()
      for try await byte in stream {
        guard data.count < 65_536 else { return .init(state: .paused, code: "unknown_response") }
        data.append(byte)
      }
      return WalletDelivery.interpret(
        status: http.statusCode, data: data,
        retryAfter: http.value(forHTTPHeaderField: "Retry-After"), now: Date())
    } catch let error as URLError {
      if [
        .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate,
        .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid,
      ].contains(error.code) {
        return .init(state: .paused, code: "configuration")
      }
      return .init(state: .retryWait, code: "unknown_delivery")
    } catch { return .init(state: .retryWait, code: "unknown_delivery") }
  }
  private func call<T: Decodable>(
    _ path: String, credential: DeviceCredential? = nil, body: Data? = nil,
    allowed: Set<Int> = [200]
  ) async throws -> T {
    var request = URLRequest(
      url: configuration.baseURL.appendingPathComponent(path),
      cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
    request.httpMethod = body == nil ? "GET" : "POST"
    request.httpBody = body
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
    if let credential {
      request.setValue(credential.authorization, forHTTPHeaderField: "Authorization")
    }
    do {
      let (bytes, response) = try await session.bytes(for: request)
      guard let http = response as? HTTPURLResponse else { throw FlowLinkError.malformedResponse }
      guard allowed.contains(http.statusCode) else {
        throw Self.error(status: http.statusCode, pairing: body != nil)
      }
      guard http.mimeType == "application/json" else { throw FlowLinkError.malformedResponse }
      var data = Data()
      for try await byte in bytes {
        guard data.count < 65_536 else { throw FlowLinkError.malformedResponse }
        data.append(byte)
      }
      do { return try JSONDecoder().decode(T.self, from: data) } catch {
        throw FlowLinkError.malformedResponse
      }
    } catch let error as FlowLinkError { throw error } catch let error as URLError {
      switch error.code {
      case .timedOut: throw FlowLinkError.timeout
      case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate,
        .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid:
        throw FlowLinkError.invalidConfiguration
      default: throw FlowLinkError.offline
      }
    } catch { throw FlowLinkError.offline }
  }
  static func error(status: Int, pairing: Bool) -> FlowLinkError {
    switch status {
    case 300..<400: .redirectRefused
    case 401: pairing ? .pairingInvalid : .unauthorized
    case 409: .pairingConflict
    case 410: .pairingUnavailable
    case 429: .rateLimited
    case 404, 500...599: .backendUnavailable
    case 400, 403, 413, 415, 422: pairing ? .pairingInvalid : .invalidConfiguration
    default: .malformedResponse
    }
  }
}
