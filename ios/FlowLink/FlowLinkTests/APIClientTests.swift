import XCTest

@testable import FlowLink

private final class ResponseStub: @unchecked Sendable {
  let lock = NSLock()
  var status = 200
  var body = Data()
  var mime = "application/json"
  var failure: URLError?
  var requests: [URLRequest] = []
  func capture(_ request: URLRequest) -> (Int, Data, String, URLError?) {
    lock.lock()
    defer { lock.unlock() }
    requests.append(request)
    return (status, body, mime, failure)
  }
}
private final class MockURLProtocol: URLProtocol, @unchecked Sendable {
  // Test cases run serially in the shared scheme; lock protects URL loading callbacks.
  static let lock = NSLock()
  nonisolated(unsafe) static var stub = ResponseStub()
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    Self.lock.lock()
    let stub = Self.stub
    Self.lock.unlock()
    let (status, data, mime, failure) = stub.capture(request)
    if let failure {
      client?.urlProtocol(self, didFailWithError: failure)
      return
    }
    guard let url = request.url,
      let response = HTTPURLResponse(
        url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": mime])
    else { return }
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: data)
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}
@MainActor final class APIClientTests: XCTestCase {
  private func client(
    status: Int = 200, body: Data = Data(), mime: String = "application/json",
    failure: URLError? = nil
  ) throws -> (FlowLinkAPIClient, ResponseStub) {
    let stub = ResponseStub()
    stub.status = status
    stub.body = body
    stub.mime = mime
    stub.failure = failure
    MockURLProtocol.lock.lock()
    MockURLProtocol.stub = stub
    MockURLProtocol.lock.unlock()
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [MockURLProtocol.self]
    return (
      FlowLinkAPIClient(
        configuration: try FlowLinkConfiguration("https://test.invalid/api/flowlink/v1"),
        sessionConfiguration: config), stub
    )
  }
  func testPairingEncodingWithoutAuthorization() async throws {
    let body = Data(
      "{\"outcome\":\"paired\",\"device_id\":\"\(Fixture.deviceID)\",\"device_label\":\"Phone\",\"credential_id\":\"\(Fixture.credentialID)\",\"credential_revision\":\"1\",\"replayed\":false}"
        .utf8)
    let (api, stub) = try client(status: 201, body: body)
    let draft = PairingDraft(
      code: try PairingCode(Fixture.code), redemptionID: UUID().uuidString.lowercased(),
      candidate: try Fixture.credential(), createdAt: Date(),
      backend: api.configuration.baseURL.absoluteString)
    _ = try await api.redeem(draft)
    let request = try XCTUnwrap(stub.requests.first)
    XCTAssertEqual(request.url?.path, "/api/flowlink/v1/pairings/redeem")
    XCTAssertEqual(request.httpMethod, "POST")
    XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
    XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
    let data: Data
    if let body = request.httpBody {
      data = body
    } else {
      let stream = try XCTUnwrap(request.httpBodyStream)
      stream.open()
      defer { stream.close() }
      var result = Data()
      var buffer = [UInt8](repeating: 0, count: 1024)
      while stream.hasBytesAvailable {
        let count = stream.read(&buffer, maxLength: buffer.count)
        if count <= 0 { break }
        result.append(buffer, count: count)
      }
      data = result
    }
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])
    XCTAssertEqual(
      Set(object.keys), ["pairing_id", "secret", "redemption_id", "device_credential"])
    XCTAssertEqual(object["device_credential"], draft.candidate.wireValue)
    XCTAssertEqual(object["redemption_id"], draft.redemptionID)
  }
  func testDeviceAuthorizationAndTypedResponse() async throws {
    let (api, stub) = try client(body: JSONEncoder().encode(Fixture.device))
    let result = try await api.device(Fixture.credential())
    XCTAssertEqual(result, Fixture.device)
    XCTAssertEqual(
      stub.requests.first?.value(forHTTPHeaderField: "Authorization"),
      try Fixture.credential().authorization)
    XCTAssertEqual(stub.requests.first?.url?.path, "/api/flowlink/v1/device")
    XCTAssertNil(stub.requests.first?.url?.query)
  }
  func testBindingsEmptyAndUnavailable() async throws {
    let (api, _) = try client(body: Data("{\"bindings\":[]}".utf8))
    let empty = try await api.bindings(Fixture.credential())
    XCTAssertTrue(empty.isEmpty)
    let binding = CardBinding(
      id: Fixture.deviceID, label: "Card", status: .disabled, revision: "2", available: false)
    let (other, stub) = try client(body: JSONEncoder().encode(BindingResponse(bindings: [binding])))
    let cards = try await other.bindings(Fixture.credential())
    XCTAssertFalse(try XCTUnwrap(cards.first).isAvailable)
    XCTAssertEqual(stub.requests.first?.url?.path, "/api/flowlink/v1/device/bindings")
    XCTAssertNotNil(stub.requests.first?.value(forHTTPHeaderField: "Authorization"))
  }
  func testSafeStatusMappingIgnoresBody() async throws {
    for (status, expected) in [
      (401, FlowLinkError.unauthorized), (503, .backendUnavailable), (404, .backendUnavailable),
      (429, .rateLimited), (302, .redirectRefused),
    ] {
      let (api, _) = try client(status: status, body: Data("private SQL or token detail".utf8))
      do {
        _ = try await api.device(Fixture.credential())
        XCTFail("Expected safe error")
      } catch {
        XCTAssertEqual(error as? FlowLinkError, expected)
        XCTAssertFalse(error.localizedDescription.contains("private SQL"))
      }
    }
  }
  func testMalformedWrongContentTypeAndOversizedResponses() async throws {
    for (data, mime) in [
      (Data("not JSON".utf8), "application/json"),
      (try JSONEncoder().encode(Fixture.device), "text/html"),
      (Data(repeating: 32, count: 65_537), "application/json"),
    ] {
      let (api, _) = try client(body: data, mime: mime)
      do {
        _ = try await api.device(Fixture.credential())
        XCTFail("Expected malformed response")
      } catch { XCTAssertEqual(error as? FlowLinkError, .malformedResponse) }
    }
  }
  func testTimeoutAndNetworkMapping() async throws {
    for (code, expected) in [
      (URLError.Code.timedOut, FlowLinkError.timeout), (.notConnectedToInternet, .offline),
      (.serverCertificateUntrusted, .invalidConfiguration),
    ] {
      let (api, _) = try client(failure: URLError(code))
      do {
        _ = try await api.device(Fixture.credential())
        XCTFail("Expected network error")
      } catch { XCTAssertEqual(error as? FlowLinkError, expected) }
    }
  }
  func testRedirectDelegateRefusesCrossOriginAndSameOrigin() throws {
    let guardDelegate = RedirectGuard()
    let session = URLSession(configuration: .ephemeral)
    defer { session.invalidateAndCancel() }
    let origin = try XCTUnwrap(URL(string: "https://test.invalid/api/flowlink/v1/device"))
    let task = session.dataTask(with: origin)
    let response = try XCTUnwrap(
      HTTPURLResponse(url: origin, statusCode: 307, httpVersion: nil, headerFields: nil))
    for target in ["https://other.invalid/steal", "https://test.invalid/redirect"] {
      var request = URLRequest(url: try XCTUnwrap(URL(string: target)))
      request.setValue(try Fixture.credential().authorization, forHTTPHeaderField: "Authorization")
      guardDelegate.urlSession(
        session, task: task, willPerformHTTPRedirection: response, newRequest: request
      ) { redirected in XCTAssertNil(redirected) }
    }
  }
  func testDuplicateAndExcessBindingsRejected() async throws {
    let binding = CardBinding(
      id: Fixture.deviceID, label: "Card", status: .active, revision: "1", available: true)
    for count in [2, 33] {
      let (api, _) = try client(
        body: JSONEncoder().encode(
          BindingResponse(bindings: Array(repeating: binding, count: count))))
      do {
        _ = try await api.bindings(Fixture.credential())
        XCTFail("Expected malformed response")
      } catch { XCTAssertEqual(error as? FlowLinkError, .malformedResponse) }
    }
  }
  func testWalletRequestUsesFrozenBytesAndDeviceAuthorization() async throws {
    let body = Data(
      "{\"outcome\":\"created\",\"disposition\":\"created\",\"review_required\":false,\"reason_code\":\"no_candidate\"}"
        .utf8)
    let (api, stub) = try client(status: 201, body: body)
    let request = WalletRequest(
      binding_id: Fixture.deviceID, amount: "4.00", currency: "ILS", merchant: "Israel Post",
      transaction_date: "2026-09-26", idempotency_key: Fixture.credentialID)
    let bytes = try JSONEncoder().encode(request)
    let result = await api.sendCapture(bytes, credential: try Fixture.credential())
    XCTAssertEqual(result.state, .delivered)
    let sent = try XCTUnwrap(stub.requests.first)
    XCTAssertEqual(sent.url?.path, "/api/flowlink/v1/wallet-transactions")
    XCTAssertEqual(sent.httpMethod, "POST")
    XCTAssertEqual(
      sent.value(forHTTPHeaderField: "Authorization"), try Fixture.credential().authorization)
    let stream = try XCTUnwrap(sent.httpBodyStream)
    stream.open()
    defer { stream.close() }
    var buffer = [UInt8](repeating: 0, count: 4096)
    let count = stream.read(&buffer, maxLength: buffer.count)
    XCTAssertEqual(Data(buffer.prefix(max(0, count))), bytes)
  }
  func testWalletTimeoutAndMalformedResponseKeepOriginalReceiptRetrySafe() async throws {
    let (offline, _) = try client(failure: URLError(.timedOut))
    let timed = await offline.sendCapture(Data("{}".utf8), credential: try Fixture.credential())
    XCTAssertEqual(timed.state, .retryWait)
    let (malformed, _) = try client(body: Data("private server details".utf8))
    let result = await malformed.sendCapture(Data("{}".utf8), credential: try Fixture.credential())
    XCTAssertEqual(result.state, .paused)
    XCTAssertEqual(result.code, "unknown_response")
  }
  func testExactServerDisabledEnvelopeBecomesOwnerHold() async throws {
    let body = Data(
      #"{"outcome":"rejected","original_outcome":null,"observation_id":null,"transaction_id":null,"disposition":"pending","review_required":false,"reason_code":"flowlink_ingestion_disabled","replayed":false,"decision_revision":null}"#
        .utf8)
    let (api, stub) = try client(status: 503, body: body)
    let decision = await api.sendCapture(Data("{}".utf8), credential: try Fixture.credential())
    XCTAssertEqual(decision.state, .heldForOwnerReview)
    XCTAssertEqual(decision.code, "flowlink_ingestion_disabled")
    XCTAssertEqual(stub.requests.count, 1)
  }

}
