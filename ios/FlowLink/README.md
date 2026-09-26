# FlowLink iOS foundation — FLI-04 (#89)

FlowLink is a small iPhone companion for Finance Tracker. This version pairs a device, checks its connection and lists owner-approved card bindings. It does **not** capture Wallet transactions. App Intents and durable capture receipts belong to [FLI-05 #90](https://github.com/OzAvrahami/finance-tracker/issues/90).

- Project: `ios/FlowLink/FlowLink.xcodeproj`, shared scheme **FlowLink**.
- App version **0.1.0**, build **1**, independent of Finance Tracker **1.3.1**.
- Temporary bundle identifier: `com.ozavrahami.flowlink.local`.
- iPhone; deployment target **iOS 17.0**; Swift 6 language mode; Apple frameworks only.
- Targets: `FlowLink`, `FlowLinkTests`, `FlowLinkUITests`.
- No nested Git repository, package dependencies, development team or distribution assets.

The [accepted contract](../../docs/FLOWLINK_NATIVE_INGESTION_CONTRACT.md), [enrollment implementation](../../docs/FLI_02_DEVICE_ENROLLMENT.md) and [binding implementation](../../docs/FLI_03_CARD_BINDINGS.md) remain authoritative.

## Architecture

| Directory | Responsibility |
| --- | --- |
| `FlowLink/App` | SwiftUI entry point and dependency composition |
| `FlowLink/Domain` | Safe device/binding models, explicit connection states and fixed error messages |
| `FlowLink/Networking` | Validated configuration, typed URLSession API client, redirect refusal |
| `FlowLink/Security` | Secure randomness, protected pairing draft, Keychain adapter |
| `FlowLink/Persistence` | Non-secret device metadata and non-backed-up installation identity |
| `FlowLink/Features` | Pairing/recovery, binding service, observable state and native connection UI |
| `FlowLinkTests` | Fake credential store/API, mocked URLProtocol and disposable metadata directories |
| `FlowLinkUITests` | Real app launch, invalid pairing and large-text Hebrew-locale navigation |

The app has one compact screen: Connection, Cards and Diagnostics. Cards are read-only. “Manage cards in Finance Tracker” opens the existing web `/settings` page in Safari; FlowLink has no owner JWT login or administration capability. An empty list explains the owner approval step. Failed refreshes clear displayed availability without deleting credentials. Available/disabled/unavailable use text and symbols, not color alone. Native controls support Dynamic Type, VoiceOver, system light/dark appearance and RTL layout.

## Backend configuration

The non-secret default is:

```text
https://finance-tracker-production-d34c.up.railway.app/api/flowlink/v1
```

This is an endpoint address, **not evidence that FlowLink is deployed there**. Do not pair against production during local verification. A 404/503 is shown as backend unavailable. Server activation, migrations, owner configuration and flags remain separately authorized owner operations.

In a **Debug** Xcode scheme's Run → Arguments → Environment Variables, set:

```text
FLOWLINK_API_BASE_URL=http://localhost:5050/api/flowlink/v1
```

Use the actual port of your authorized local backend. Simulator localhost reaches the Mac. The URL must end exactly in `/api/flowlink/v1`; userinfo, query and fragment are rejected. Only explicit loopback hosts (`localhost`, `127.0.0.1`, `::1`) permit HTTP. All other hosts require HTTPS. Release ignores the development environment override and has no ATS exceptions. Debug has only `NSAllowsLocalNetworking`; neither configuration uses `NSAllowsArbitraryLoads`.

For a physical iPhone, localhost means the phone, not the Mac. Use a Mac LAN hostname/address served over **HTTPS with a certificate trusted by that phone**, set the same Debug override and follow any system local-network prompt. HTTP LAN URLs and invalid/self-signed-untrusted TLS are rejected. Do not weaken ATS or certificate verification to make a local connection work. Development backend data and credentials must be disposable; follow the backend's local setup instructions without changing production flags or services.

Backend origin (scheme, lowercase host, effective port) is hashed into the Keychain namespace. Changing origin creates a fresh local pairing namespace, even when switching back to a previously used origin. It cannot send a previous origin's credential to another host. The fixed API path is validated. All redirects are refused, including same-origin redirects and pairing POSTs whose body contains a capability. Tokens are never in URLs. Requests use an ephemeral URLSession, no shared cookie/cache/credential storage, a 20-second request timeout, a 25-second resource timeout and a 64-KiB decoded-response limit. Server error bodies are never shown or logged.

## Pairing and recovery

1. Obtain a one-time pairing capability through the existing authorized owner enrollment workflow. The binding Settings panel is not a replacement for the enrollment API. Paste `flpair1.<UUIDv4>.<43 base64url chars>` into the secure input.
2. Validate locally. Generate a UUIDv4 redemption ID and a `fldev1_` credential from 32 bytes of `SecRandomCopyBytes` randomness.
3. Save the complete protected draft to Keychain **before** sending `POST /pairings/redeem`. This request has no Authorization header.
4. On success, atomically store the current credential with its device identity in Keychain, persist non-secret metadata, then delete the draft. The input is cleared on submission.
5. On timeout, relaunch or partial local persistence failure, offer **Retry pairing**, reusing the exact saved capability/redemption/credential. No automatic retry creates a new credential.
6. At the 24-hour receipt boundary, the next unlocked draft access scrubs the pairing capability and probes `GET /device` with the original candidate. A server 410 also triggers this probe. A valid candidate is promoted; otherwise recovery stays explicit. iOS cannot run cleanup while the app is suspended/locked, so expired capability material is removed at the next available app use.
7. Reset/forget requires confirmation, clears only local state and explicitly warns that it does not revoke a server device. The owner should review uncertain enrollment before issuing a new capability.

Authenticated calls are only `GET /device` and `GET /device/bindings`, using the Keychain credential as Bearer authentication. Safe status includes device label, credential revision, protocol and ingestion flag. The app displays no payment-source IDs, APY source IDs, owner identities or raw provider information. A 401 enters recovery; network and 503 errors preserve the credential. No ingestion request is made by this version.

## Keychain and installation boundary

Generic-password service: `FlowLink.credentials.v1`. Accounts: `<SHA256 canonical origin>:<installation UUID>:current` and `:pairing-draft`. Values use `kSecAttrSynchronizable=false` and `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. There is no Keychain sharing group or biometric gate. Store/replace uses `SecItemUpdate` or `SecItemAdd`; delete is idempotent. Errors map to fixed safe UI messages, never credential/OSStatus payloads.

[Apple documents this accessibility class](https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlockthisdeviceonly) as device-only storage available after the first unlock following a restart. Real lock/restart/reinstall behavior remains a physical-device verification item. Unit tests use a fake credential-store protocol, never the developer's actual Keychain.

Application Support contains only a random installation marker and origin-specific non-secret device metadata. The directory is excluded from backup and files use complete-until-first-user-authentication protection. A missing marker creates a new namespace; an invalid marker fails closed. Reinstallation therefore never silently adopts leftover Keychain credentials. Pairing secrets and credentials never enter UserDefaults, ordinary metadata files, logs or observable UI models.

## Build and test

Verified toolchain: Xcode 27.0 (27A266a), Apple Swift 6.4. Select the installed full Xcode developer directory; no team is needed for the simulator.

From the repository root:

```sh
xcodebuild -version
xcode-select -p
xcrun swift --version
xcrun simctl list devices available
```

Use an available iPhone simulator ID (the verification run used `C016BBEB-E3EB-4D81-AC87-4B74571C74D1`, iPhone 18 Pro / iOS 27.0):

```sh
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink \
  -configuration Debug \
  -destination 'platform=iOS Simulator,id=C016BBEB-E3EB-4D81-AC87-4B74571C74D1' \
  -derivedDataPath /private/tmp/flowlink89-derived \
  build

xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink \
  -configuration Debug \
  -destination 'platform=iOS Simulator,id=C016BBEB-E3EB-4D81-AC87-4B74571C74D1' \
  -derivedDataPath /private/tmp/flowlink89-derived \
  -resultBundlePath /private/tmp/flowlink89-tests.xcresult \
  -collect-test-diagnostics never test
```

Keep normal ad-hoc simulator signing enabled: disabling code signing also removes the simulator entitlements required by Keychain. No developer team or certificate is needed. Choose a new result-bundle path for each run. Shared scheme test parallelization is disabled because URLProtocol test responses are process-local fixtures. Unit network requests are intercepted; UI tests use an `.invalid` backend and invalid pairing text only. No production device, binding or financial transaction is created. Build artifacts and result bundles stay outside the repository.

Physical-device signing is optional: open the project, select the app target's Signing & Capabilities, choose an **existing** local development team, and select the connected iPhone. This implementation did not configure accounts, certificates, App Store identifiers or a device. Owner verification should include Keychain locked/unlocked behavior, relaunch/recovery against a disposable backend, VoiceOver, both appearances and physical-device layout. Simulator success does not prove physical-device security behavior.

## Verification evidence (2026-09-26)

- Debug simulator build: passed. Release simulator build: passed for `generic/platform=iOS Simulator`, using the same project/scheme and `/private/tmp/flowlink89-release` DerivedData.
- Final `xcodebuild test`: **35 passed, 0 failed, 0 skipped** — 33 unit tests and 2 UI tests. Result bundle: `/private/tmp/flowlink89-tests-final.xcresult` (local artifact, not committed).
- Unit coverage: 8 API-client, 9 domain/configuration, 13 pairing/state and 3 persistence tests. All network results are mocked.
- Initial run: 33 unit tests passed; 2 UI tests failed (3 assertions). `CODE_SIGNING_ALLOWED=NO` removed simulator Keychain entitlements; normal ad-hoc signing corrected this without a team/certificate change. The large-text test overscrolled its controls; it now scrolls incrementally. Pairing errors now appear beside the input, and Connect dismisses the keyboard. The corrected full run passed, followed by another full pass after tightening backend-switch isolation.
- Xcode emits “Metadata extraction skipped, no AppIntents.framework dependency found”; expected because App Intents are explicitly absent.
- UTF-8: 23 changed/new text files passed. Local Markdown links: 7 passed. Both plist ATS/version checks passed. All 7 Finance Tracker version fields are 1.3.1. Diff whitespace check passed; no nested `.git`, notification/App Intent implementation or credential logging found. Secret-pattern review found no real secrets; test credentials are generated synthetic fixtures.
- No physical device, Apple developer account, production endpoint, migration or provider was used. VoiceOver and real-device first-unlock/reboot/reinstall behavior remain owner acceptance items.

## Release / Version gate

- Release impact: **Yes**.
- SemVer impact: **Minor**, part of the grouped FlowLink/APY initiative.
- Candidate release: proposed **v1.4.0**, final decision [#84](https://github.com/OzAvrahami/finance-tracker/issues/84).
- Included release candidate: [FlowLink #85](https://github.com/OzAvrahami/finance-tracker/issues/85) / [APY #78](https://github.com/OzAvrahami/finance-tracker/issues/78); no version per Issue.
- CHANGELOG status: actual FLI-04 foundation recorded under Unreleased.
- Version-bump status: Finance Tracker's seven fields remain **1.3.1**; deferred coordinated preparation. FlowLink starts at **0.1.0 / 1** independently.
- Publication status: **None / out of scope**. No tag, GitHub Release, deployment or Apple distribution.
- Owner acceptance / verification: **Pending** for #89.

See the canonical [Release / Version gate](../../docs/github-development-standard.md#release--version-gate). Owner commit/push and any production or publication work remain separate. Wallet App Intent/capture/SQLite receipts are #90; notifications/APNs, App Store/TestFlight/Unlisted distribution and a full finance mobile app are excluded.
