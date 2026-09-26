import XCTest

@testable import FlowLink

final class DomainTests: XCTestCase {
  func testCredentialFormatAndNativeEntropy() throws {
    let a = try CredentialGenerator().generate()
    let b = try CredentialGenerator().generate()
    XCTAssertNotEqual(a, b)
    XCTAssertEqual(a.wireValue.count, 50)
    XCTAssertTrue(a.wireValue.hasPrefix("fldev1_"))
    XCTAssertTrue(Validation.secret(String(a.wireValue.dropFirst(7))))
  }
  func testInjectableRandomnessAndFailure() throws {
    let credential = try CredentialGenerator(randomBytes: { Data(repeating: 0, count: 32) })
      .generate()
    XCTAssertEqual(credential.wireValue, "fldev1_" + String(repeating: "A", count: 43))
    XCTAssertThrowsError(try CredentialGenerator(randomBytes: { Data([0]) }).generate())
    XCTAssertThrowsError(
      try CredentialGenerator(randomBytes: { throw FlowLinkError.credentialUnavailable }).generate()
    )
  }
  func testValidPairingAndRedactedDescriptions() throws {
    let code = try PairingCode(Fixture.code)
    XCTAssertEqual(code.id, Fixture.deviceID)
    XCTAssertFalse(String(reflecting: code).contains(code.secret))
    let credential = try Fixture.credential()
    XCTAssertFalse(String(reflecting: credential).contains(credential.wireValue))
  }
  func testMalformedPairing() {
    for code in [
      "", Fixture.code.replacingOccurrences(of: "flpair1", with: "flpair2"),
      Fixture.code.replacingOccurrences(of: Fixture.deviceID, with: "bad"), Fixture.code + "A",
      Fixture.code.replacingOccurrences(of: "AAAAAAAA", with: "!!!!!!AA"), Fixture.code + ".extra",
    ] {
      XCTAssertThrowsError(try PairingCode(code))
    }
  }
  func testCanonicalSecretEncodingAndUUIDv4() {
    XCTAssertFalse(Validation.secret(String(repeating: "A", count: 42) + "B"))
    XCTAssertFalse(Validation.uuid("11111111-1111-1111-8111-111111111111"))
    XCTAssertFalse(Validation.uuid("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"))
  }
  func testBackendConfigurationRejectsUnsafeDestinations() throws {
    for url in [
      "http://example.com/api/flowlink/v1", "https://user:secret@example.com/api/flowlink/v1",
      "https://example.com/api/flowlink/v1?token=x", "https://example.com/api/flowlink/v1#x",
      "https://example.com/other", "file:///api/flowlink/v1",
      "http://192.168.1.8:5050/api/flowlink/v1",
    ] {
      XCTAssertThrowsError(try FlowLinkConfiguration(url, allowLocalHTTP: true))
    }
    XCTAssertThrowsError(try FlowLinkConfiguration("http://localhost:5050/api/flowlink/v1"))
    XCTAssertNoThrow(
      try FlowLinkConfiguration("http://localhost:5050/api/flowlink/v1", allowLocalHTTP: true))
    XCTAssertNoThrow(try FlowLinkConfiguration("https://mac.local/api/flowlink/v1"))
  }
  func testOriginCanonicalizationAndIsolation() throws {
    let a = try FlowLinkConfiguration("https://EXAMPLE.com/api/flowlink/v1/")
    let b = try FlowLinkConfiguration("https://example.com:443/api/flowlink/v1")
    XCTAssertEqual(a.originHash, b.originHash)
    XCTAssertNotEqual(
      a.originHash, try FlowLinkConfiguration("https://example.com:444/api/flowlink/v1").originHash)
  }
  func testBindingModelHasOnlySafeFieldsAndUnavailableState() throws {
    let json = """
      {"id":"11111111-1111-4111-8111-111111111111","label":"כרטיס","status":"disabled","revision":"2","available":true,"payment_source_id":"secret","source_id":"secret","owner_id":"secret"}
      """
    let card = try JSONDecoder().decode(CardBinding.self, from: Data(json.utf8))
    try card.validate()
    XCTAssertFalse(card.isAvailable)
    let encoded = try JSONEncoder().encode(card)
    let fields = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
    XCTAssertEqual(Set(fields.keys), Set(["id", "label", "status", "revision", "available"]))
  }
  func testResponseValidationRejectsUnknownProtocolAndMalformedRevisions() throws {
    let d = Fixture.device
    XCTAssertThrowsError(
      try DeviceResponse(
        device: d.device, credential: d.credential, protocolVersion: 2, ingestionEnabled: false
      ).validate())
    XCTAssertFalse(Validation.revision("9223372036854775808"))
    XCTAssertFalse(Validation.revision("01"))
  }
}
