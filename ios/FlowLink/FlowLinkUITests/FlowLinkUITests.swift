import XCTest

final class FlowLinkUITests: XCTestCase {
  // Safe on an already-installed owner Release app: inspect Diagnostics only.
  // Do not use the unpaired simulator helper or override the owner's backend.
  @MainActor func testInstalledVersionAndBuildConfiguration() {
    #if targetEnvironment(simulator)
      let app = launch()
    #else
      let app = XCUIApplication(bundleIdentifier: "com.ozavrahami.flowlink.local")
      app.activate()
    #endif
    XCTAssertTrue(app.navigationBars["FlowLink"].waitForExistence(timeout: 10))
    let state = app.descendants(matching: .any).matching(identifier: "connectionState").firstMatch
    let connected = state.label.contains("Connected") && !state.label.contains("Not")
    print("FLOWLINK_UI_CONNECTED=\(connected)")
    let version = app.descendants(matching: .any).matching(identifier: "flowlinkVersion").firstMatch
    for _ in 0..<10 where !version.isHittable { app.swipeUp() }
    XCTAssertTrue(version.exists)
    func text(_ element: XCUIElement) -> String {
      ([element.label, element.value as? String ?? ""]
        + element.staticTexts.allElementsBoundByIndex.map(\.label)).joined(separator: " ")
    }
    let versionText = text(version)
    XCTAssertNotNil(versionText.range(of: #"\d+\.\d+\.\d+ \(\d+\)"#,
      options: .regularExpression))
    let configuration = app.descendants(matching: .any)
      .matching(identifier: "flowlinkConfiguration").firstMatch
    XCTAssertTrue(configuration.exists)
    #if DEBUG
      XCTAssertTrue(text(configuration).contains("Debug"))
    #else
      XCTAssertTrue(text(configuration).contains("Release"))
    #endif
    // These two fields contain only public build metadata, never financial/credential data.
    print("FLOWLINK_UI_VERSION=\(versionText)")
    print("FLOWLINK_UI_CONFIGURATION=\(text(configuration))")
  }

  @MainActor private func launch(rtl: Bool = false) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchEnvironment["FLOWLINK_API_BASE_URL"] = "https://ui-test.invalid/api/flowlink/v1"
    app.launchArguments = [
      "-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-UIPreferredContentSizeCategoryName",
      "UICTContentSizeCategoryL",
    ]
    if rtl {
      app.launchArguments = [
        "-AppleLanguages", "(he)", "-AppleLocale", "he_IL", "-UIPreferredContentSizeCategoryName",
        "UICTContentSizeCategoryAccessibilityXXXL",
      ]
    }
    app.launch()
    return app
  }
  @MainActor func testScannerIsPrimaryAndManualFallbackRemainsAvailable() {
    let app = launch()
    XCTAssertTrue(app.buttons["scanQR"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.secureTextFields["pairingCode"].exists)
    app.buttons["scanQR"].tap()
    let paste = app.buttons["scannerPaste"]
    XCTAssertTrue(paste.waitForExistence(timeout: 10))
    paste.tap()
    XCTAssertTrue(app.secureTextFields["pairingCode"].waitForExistence(timeout: 5))
  }
  @MainActor func testUnpairedAndInvalidCodeShowsSafeError() {
    let app = launch()
    app.buttons["Having trouble scanning?"].tap()
    let field = app.secureTextFields["pairingCode"]
    XCTAssertTrue(field.waitForExistence(timeout: 10))
    field.tap()
    field.typeText("invalid")
    app.buttons["connect"].tap()
    XCTAssertTrue(app.staticTexts["safeMessage"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.secureTextFields["pairingCode"].exists)
    XCTAssertFalse(app.buttons["retryPairing"].exists)
  }
  @MainActor func testRTLAndLargeTextPairingControlAccessible() {
    let app = launch(rtl: true)
    XCTAssertTrue(app.navigationBars["FlowLink"].waitForExistence(timeout: 10))
    let fallback = app.buttons["Having trouble scanning?"]
    for _ in 0..<12 where !fallback.isHittable { app.swipeUp() }
    fallback.tap()
    let field = app.secureTextFields["pairingCode"]
    for _ in 0..<12 where !field.isHittable {
      app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
        .press(
          forDuration: 0.1,
          thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)))
    }
    XCTAssertTrue(app.secureTextFields["pairingCode"].exists)
    XCTAssertTrue(app.buttons["connect"].exists)
  }
  @MainActor func testLocalCaptureDiagnosticsAccessibleWithoutPairing() {
    let app = launch()
    XCTAssertTrue(app.navigationBars["FlowLink"].waitForExistence(timeout: 10))
    let diagnostics = app.buttons["Capture diagnostics"]
    for _ in 0..<12 where !diagnostics.isHittable { app.swipeUp() }
    XCTAssertTrue(diagnostics.exists)
    diagnostics.tap()
    XCTAssertTrue(app.navigationBars["Capture diagnostics"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Refresh diagnostics"].exists)
  }
}
