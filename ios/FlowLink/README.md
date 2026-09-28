# FlowLink — native foundation and Wallet ingestion

FlowLink is a small iPhone companion for Finance Tracker. The FLI-04 foundation pairs a device and lists approved cards. [FLI-05 #90](https://github.com/OzAvrahami/finance-tracker/issues/90) adds a native Wallet action and durable delivery receipts. **The owner verified direct Shortcuts parameter mapping on iPhone 17 Pro Max / iOS 27. Runtime Wallet-event values and locked-device behavior remain unverified; this is not production E2E acceptance.**

- Project: `ios/FlowLink/FlowLink.xcodeproj`, shared scheme **FlowLink**.
- App version **0.1.0**, build **1**, independent of Finance Tracker **1.3.1**.
- Temporary bundle identifier: `com.ozavrahami.flowlink.local`.
- iPhone; deployment target **iOS 17.0**; Swift 6 language mode; Apple frameworks only.
- Targets: `FlowLink`, `FlowLinkTests`, `FlowLinkUITests`.
- No nested Git repository, package dependencies or distribution assets. The owner selected an existing Personal Team for local development signing; that configuration is preserved.

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

1. **Owner web:** Settings → FlowLink → **חיבור iPhone חדש** (Connect new iPhone). Enter a unique friendly name (for example, “Noya iPhone”), then **יצירת QR**. **iPhone:** open FlowLink → **Scan QR**, allow camera access, point at that QR and tap **Connect**. The owner list refreshes and selects a unique new active device with that name. Verify the device label on the phone, then explicitly choose its payment source and create its card binding in web Settings. No console, token copying, owner login on the phone or developer tools are needed.
   - QR rendering uses local `react-qr-code` SVG, never an external image service. Its payload is the exact existing `flpair1.<UUIDv4>.<43 base64url chars>` capability, not a URL. Keep the QR private.
   - Enrollment expires after **10 minutes**; the web countdown removes the QR at expiry and offers **Generate new QR**. This limit applies only to enrollment, never everyday Wallet capture. Closing/navigation attempts cancellation; server expiry remains authoritative if offline. A consumed/cancel race refreshes devices rather than revoking anything.
   - Web polling reads only safe devices (first after 5 seconds, then every 30 seconds). The current API exposes no consumed-pairing status/correlation endpoint: auto-selection requires exactly one newly seen active device with the chosen unique label. Concurrent same-name results require manual selection; no financial mapping is inferred. Confirm the label on the phone before binding a card.
   - **Having trouble scanning?** reveals the manual secure paste field. On the web, **לא מצליחים לסרוק?** reveals/copies the code only on demand. Camera denial/unavailability provides the same fallback. No screenshots/code enter analytics or logs.
   - AVFoundation reads QR metadata only. The existing `PairingCode` parser rejects unrelated QR/URLs; an accepted code stops capture and queued duplicates. Cancel/background/disappearance stops the camera. Confirmation calls the existing `ConnectionModel.connect(code:)`; no second pairing service exists.
2. Validate locally. Generate a UUIDv4 redemption ID and a `fldev1_` credential from 32 bytes of `SecRandomCopyBytes` randomness.
3. Save the complete protected draft to Keychain **before** sending `POST /pairings/redeem`. This request has no Authorization header.
4. On success, atomically store the current credential with its device identity in Keychain, persist non-secret metadata, then delete the draft. The input is cleared on submission.
5. On timeout, relaunch or partial local persistence failure, offer **Retry pairing**, reusing the exact saved capability/redemption/credential. No automatic retry creates a new credential.
6. At the 24-hour receipt boundary, the next unlocked draft access scrubs the pairing capability and probes `GET /device` with the original candidate. A server 410 also triggers this probe. A valid candidate is promoted; otherwise recovery stays explicit. iOS cannot run cleanup while the app is suspended/locked, so expired capability material is removed at the next available app use.
7. Reset/forget requires confirmation, clears only local state and explicitly warns that it does not revoke a server device. The owner should review uncertain enrollment before issuing a new capability.

Connection-management authenticated calls are `GET /device` and `GET /device/bindings`, using the Keychain credential as Bearer authentication. Safe status includes device label, credential revision, protocol and ingestion flag. The app displays no payment-source IDs, APY source IDs, owner identities or raw provider information. A 401 enters recovery; network and 503 errors preserve the credential. FLI-05 additionally posts the six-field frozen request to `/wallet-transactions`; see below.

## Keychain and installation boundary

Generic-password service: `FlowLink.credentials.v1`. Accounts: `<SHA256 canonical origin>:<installation UUID>:current` and `:pairing-draft`. Values use `kSecAttrSynchronizable=false` and `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. There is no Keychain sharing group or biometric gate. Store/replace uses `SecItemUpdate` or `SecItemAdd`; delete is idempotent. Errors map to fixed safe UI messages, never credential/OSStatus payloads.

[Apple documents this accessibility class](https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlockthisdeviceonly) as device-only storage available after the first unlock following a restart. Real lock/restart/reinstall behavior remains a physical-device verification item. Unit tests use a fake credential-store protocol, never the developer's actual Keychain.

Application Support contains only a random installation marker and origin-specific non-secret device metadata. The directory is excluded from backup and files use complete-until-first-user-authentication protection. A missing marker creates a new namespace; an invalid marker fails closed. Reinstallation therefore never silently adopts leftover Keychain credentials. Credentials never enter UserDefaults, ordinary metadata files, logs or observable UI models. Pairing text lives briefly in the secure input/scanner confirmation memory, then only in the protected Keychain draft for recovery; it is never ordinary persisted state.

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

For physical-device development: open the project, select the app target's Signing & Capabilities, choose an **existing** local development team, and select the connected iPhone. The owner selected the existing Personal Team in Xcode and installed the foundation. The agent preserves that signing change; it does not configure Apple accounts or distribution assets. Owner verification should include Keychain locked/unlocked behavior, relaunch/recovery against a disposable backend, VoiceOver, both appearances and physical-device layout. Simulator success does not prove physical-device security behavior.

## FLI-04 baseline verification evidence (2026-09-26)

- Debug simulator build: passed. Release simulator build: passed for `generic/platform=iOS Simulator`, using the same project/scheme and `/private/tmp/flowlink89-release` DerivedData.
- Final `xcodebuild test`: **35 passed, 0 failed, 0 skipped** — 33 unit tests and 2 UI tests. Result bundle: `/private/tmp/flowlink89-tests-final.xcresult` (local artifact, not committed).
- Unit coverage: 8 API-client, 9 domain/configuration, 13 pairing/state and 3 persistence tests. All network results are mocked.
- Initial run: 33 unit tests passed; 2 UI tests failed (3 assertions). `CODE_SIGNING_ALLOWED=NO` removed simulator Keychain entitlements; normal ad-hoc signing corrected this without a team/certificate change. The large-text test overscrolled its controls; it now scrolls incrementally. Pairing errors now appear beside the input, and Connect dismisses the keyboard. The corrected full run passed, followed by another full pass after tightening backend-switch isolation.
- Xcode emits “Metadata extraction skipped, no AppIntents.framework dependency found”; expected because App Intents are explicitly absent.
- UTF-8: 23 changed/new text files passed. Local Markdown links: 7 passed. Both plist ATS/version checks passed. All 7 Finance Tracker version fields are 1.3.1. Diff whitespace check passed; no nested `.git`, notification/App Intent implementation or credential logging found. Secret-pattern review found no real secrets; test credentials are generated synthetic fixtures.
- No physical device, Apple developer account, production endpoint, migration or provider was used. VoiceOver and real-device first-unlock/reboot/reinstall behavior remain owner acceptance items.

## FLI-05 initial implementation checkpoint (2026-09-26)

- Xcode 27.0 (27A266a), Swift 6.4, deployment target iOS 17.0. Initial checkpoint simulator tests: **48 unit + 2 UI = 50 passed, 0 failed, 0 skipped**. Debug test build and Release simulator build passed. Physical iPhone Debug build passed with the owner-selected Personal Team.
- `devicectl` installed and launched the updated app on **Oz’s iPhone / iPhone 17 Pro Max**. Owner reports iOS 27.0; earlier device metadata reports 24A437. No Wallet or lock/reboot runtime experiment performed.
- Generated `Metadata.appintents/extract.actionsdata` contains one discoverable `RecordWalletTransaction` action, one App Shortcut, `FlowLinkCardBinding` entity, optional String Merchant/Name and the native currency Amount parameter. Metadata is compile-time evidence, not proof of the phone picker or Wallet compatibility.
- The phone app was launched with `FLOWLINK_API_BASE_URL=https://wallet-probe.invalid/api/flowlink/v1`, persisted for the inspection session. It cannot target the production backend. Empty card selection is expected without disposable pairing; do not create production bindings to fill it.
- Intermediate corrections: Swift 6 required an isolated SQLite deinitializer; an added test reference initially landed in the wrong Xcode build phase and was moved to the unit Sources phase; a dependency-injected EntityQuery needed a separate explicit `init()` to satisfy AppIntents. Corrected builds/tests passed. No financial/backend contract change was needed.
- At this initial checkpoint the status was **Open / In Progress / P1** pending the owner Shortcuts inspection. That configuration inspection subsequently passed; runtime verification remains pending. #89 is accepted/completed. Nothing committed or staged.

Initial checkpoint commands (repository root; use a fresh result-bundle path to repeat):

```sh
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Debug -destination 'platform=iOS Simulator,id=C016BBEB-E3EB-4D81-AC87-4B74571C74D1' -derivedDataPath /private/tmp/flowlink90-sim -resultBundlePath /private/tmp/flowlink90-tests-verified.xcresult -collect-test-diagnostics never test
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Release -destination 'generic/platform=iOS Simulator' -derivedDataPath /private/tmp/flowlink90-release build
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Debug -destination 'platform=iOS,id=00008150-00181C513E30C01C' -derivedDataPath /private/tmp/flowlink90-device build
xcrun devicectl device install app --device 00008150-00181C513E30C01C /private/tmp/flowlink90-device/Build/Products/Debug-iphoneos/FlowLink.app --timeout 60 --json-output /private/tmp/flowlink90-install.json
xcrun devicectl device process launch --device 00008150-00181C513E30C01C --terminate-existing --environment-variables '{"FLOWLINK_API_BASE_URL":"https://wallet-probe.invalid/api/flowlink/v1"}' com.ozavrahami.flowlink.local --timeout 30 --json-output /private/tmp/flowlink90-launch.json
```

## FLI-05 Wallet action, configuration evidence and deferred runtime

`RecordWalletTransaction` exposes **FlowLink → Record Wallet Transaction** through public App Intents/App Shortcuts. Parameters are **Card binding** (`FlowLinkCardBinding` AppEntity), **Merchant** (optional String), **Name** (optional String), and **Amount** (`IntentCurrencyAmount`, restricted to ILS). The [Apple money type](https://developer.apple.com/documentation/appintents/intentcurrencyamount) provides Decimal and currencyCode; its availability does not prove the Wallet variable supplies compatible content.

The entity query uses only the paired device's approved safe binding API. New selection includes active/available bindings only; duplicate labels have a short opaque ID suffix. Missing/disabled identities are never replaced with another card. A bounded protected cache (32 bindings, at most 32 KiB) is used only on offline/timeout, scoped to device, installation and origin. Authorization remains the live server's responsibility.

### Owner-verified Shortcuts configuration

The owner verified the following directly on **iPhone 17 Pro Max / iOS 27**, after the development app was installed:

- **FlowLink → Record Wallet Transaction** is discoverable in the Wallet automation UI.
- **Transaction → Amount** maps directly into `IntentCurrencyAmount`. The action renders **Record [Amount] ILS …**. No Text conversion, Match Text, Replace Text, regex or helper action is needed.
- **Transaction → Merchant** and **Transaction → Name** map directly to their respective fields.
- The complete automation has only the selected-card Wallet trigger and the single FlowLink action. No Card or Pass input, JSON, HTTP, credential, internal financial ID or retry action is used.
- **Show When Run** is disabled for the intended background UX. This setting does not establish that iOS executes the automation successfully while locked.
- Card binding is empty as expected: the development installation has no backend pairing or approved binding. No fake selectable binding is supplied.
- The automation was **not run**, no purchase was made, and no production backend/device/binding was created or contacted.

This is **configuration-time compatibility evidence supplied by the owner**. It does not reveal the raw Wallet Amount type or prove the runtime Decimal/currency value. The native typed parameter remains the chosen path; no text fallback is selected. The strict parser for the previously observed `₪4.00` text remains unit-tested and is not exposed as another Shortcut action.

### Deferred runtime/device evidence — implementation may reach Verify

The owner superseded the local mock and immediate-purchase gate on 2026-09-27. The implementation is **Open / Verify / P1**, with owner acceptance **Pending**, after automated checks and builds passed. Real runtime Amount, original Merchant/Name values and Wallet-event locked/background execution remain explicitly deferred; no purchase is required now. Earlier checkpoint notes below are historical, not current completion gates.

The authoritative later workflow is **capture first, review before posting**: prepare production enrollment/bindings but leave both ingestion flags false; a natural event is stored durably and receives `flowlink_ingestion_disabled`; it remains held until the owner reviews it and explicitly retries that same receipt after separately authorizing native enablement. No pre-purchase enablement or helper Shortcut action is needed. Invalid runtime evidence/storage unavailability still fails safely; configuration compatibility is not a guarantee that a real event executes.

See the [owner rollout runbook](../../docs/FLOWLINK_OWNER_ROLLOUT.md) for exact 037 → 038 preflight/postflight, SHA/deployment verification, authenticated owner UUID, pairing/bindings, production app configuration, deferred #91 checklist and legacy CAL duplicate protection. These are prepared instructions; no production action occurred and #91 was not started. The Mac mock/CA is optional historical evidence and no longer blocks completion. Cleanup is in that runbook; if the CA was never installed, no iPhone certificate cleanup is needed.

### Historical post-inspection/local mock checkpoint (2026-09-26)

- Latest application tests: **53 unit + 2 UI = 55 passed, 0 failed, 0 skipped**. Coverage now also includes acknowledgement-based retention, conservative local SQLite receipt upgrades, full-database rollback, malformed protocol responses and protected-metadata recovery without resurrecting deleted credentials. Release Simulator and Debug physical-device builds passed.
- Exact test command: `xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Debug -destination 'platform=iOS Simulator,id=C016BBEB-E3EB-4D81-AC87-4B74571C74D1' -derivedDataPath /private/tmp/flowlink90-sim -resultBundlePath /private/tmp/flowlink90-post-mapping-tests.xcresult -collect-test-diagnostics never test`.
- A subsequent Debug-only `NSLocalNetworkUsageDescription` explains Mac development access. Debug Simulator and device builds passed again with `-destination 'generic/platform=iOS Simulator'` and `-destination 'generic/platform=iOS'`, respectively. Signing remains Automatic / the owner's Personal Team. Release has no new network permissions or ATS exception.
- The updated app was installed and launched on Oz's physical iPhone with the persisted Debug override `https://192.168.1.190:8443/api/flowlink/v1`. The LAN address is session-specific, not product configuration. No real backend enrollment or financial call was made.
- Temporary fixture tooling and private state live **outside the repository** at `/private/tmp/fli90-mock-20260926`. `python3 /private/tmp/fli90-mock-20260926/mock.py` serves only synthetic pairing, device status, one binding labelled **Local Wallet test - no accounting**, and created/replayed/conflict protocol responses. It has no financial database or outbound client. It is not evidence of APY matching, atomic authorization or financial E2E.
- `python3 /private/tmp/fli90-mock-20260926/check.py` passed **16 local fixture/TLS checks, 0 failed**, using separate test state so the owner's pairing remained unused. The fixture retains credential/command/payload hashes and bounded receipt keys, not merchant/amount payloads; access logging is disabled. State and the one-time pairing text are protected local files. Same-key changed bytes conflict; exact replay produces a synthetic already-observed response.
- HTTPS uses an ephemeral test CA and IP-address certificate. The CA signing key was removed after issuance; remaining server key/state are outside Git. HTTP port 8089 serves only the public certificate profile; pairing and API traffic use HTTPS 8443. No app certificate-validation bypass, broad ATS relaxation, VPN or device-management payload is used.
- Historical setup required a manually trusted local CA and disposable pairing. **Those owner steps are superseded and are not required now.** Do not install the CA to complete #90. Cleanup and the intended production-connected configuration are in the owner rollout runbook.
- After local testing, stop the fixture process, remove its local pairing from the app and remove the temporary certificate profile from Settings → General → VPN & Device Management. Do not leave the development root trusted for ordinary use. Files under `/private/tmp` are disposable and may disappear after restart; loss of fixture state requires a deliberate new local pairing, not a production fallback.
- At that historical checkpoint #90 was **Open / In Progress / P1**, awaiting local setup and runtime evidence; the owner subsequently deferred that gate. Raw Wallet-event Amount values and locked-device behavior are still unverified; no production transaction, deployment, configuration, secret, or distribution operation occurred.

### Normalization and immutable receipt

The typed path accepts only positive exact ILS Decimal, at most two fractional digits and 28 whole digits, without rounding, binary floating-point money or FX. The optional tested text parser accepts only `₪` + ASCII digits + dot + two digits; no grouping, whitespace, foreign currency, negative, zero or attachment forms. Nonempty invalid Merchant fails; Name is used only for missing/whitespace Merchant. Selected text is at most 512 Unicode scalars and must be usable; no concatenation or fabricated name.

Intent entry freezes one local Gregorian date/timezone and one UUIDv4, before asynchronous work. Delayed execution, crossing midnight or travel can change the capture date relative to purchase date: this is an accounting fallback, not a purchase timestamp. No `occurred_at`, provider reference or fuzzy dedupe is generated. Independent invocations get independent keys, even for identical purchases.

`Wallet/ReceiptStore.swift` uses native SQLite, DELETE rollback journal, FULL synchronous commits, fullfsync, busy timeout and BEGIN IMMEDIATE transactions. The database and its directory use complete-until-first-user-authentication protection, with the parent excluded from backup. No shared app group or external dependency. Physical lock/side-file behavior remains a hardware verification item.

The immutable record contains the approved binding display-label snapshot, installation/device/origin, protocol version, the exact six-field UTF-8 request bytes and SHA-256, one key, and diagnostic capture time. Credentials are absent; Keychain is read at transmission. If Keychain is temporarily unavailable but protected metadata and a matching cached binding are readable, capture can still persist locally and pause without HTTP. Missing/deleted credentials do not resurrect identity from metadata. SQLite guards frozen fields; mutable state includes attempts, next/last attempt, safe outcome/error and claim lease. Responses store safe outcome state rather than full server payloads or competing candidate IDs.

A receipt commits before POST. A second connection/process cannot claim an active receipt. A 60-second lease exceeds the 25-second HTTP timeout; expired claims recover with identical bytes/key, and a stale worker cannot overwrite a newer claim. Credential rotation changes only the header, never receipt identity. Device/origin mismatch cannot replay another installation's receipts. Local storage failure or capacity failure means no POST.

### Delivery and retry

- created/reconciled/already_observed with a live disposition → delivered; pending/cancelled or review-required → needs review.
- ambiguous/conflict → needs review; rejected and HTTP 400/413/415 protocol errors → failed; no automatic resend/new key.
- timeout/network/temporary availability → retry wait with original bytes/key. Invalid or unrecognized response → paused for explicit inspection.
- Exact HTTP 503 / `flowlink_ingestion_disabled` → **heldForOwnerReview**, persisted in SQLite. It is manually retryable, never scheduled or selected by foreground/launch retry, and never evicted as a delivered receipt. Enabling the backend alone cannot submit it. A confirmed manual retry while still disabled returns it to held state with unchanged bytes/key/date.
- 401/403 and other configuration 503 → paused; no remapping. Transient unavailable 503 retries. 429 honors the longer Retry-After delay (seconds or HTTP-date).
- Backoff: 30 seconds, 2 minutes, 10 minutes, 1 hour, then 6 hours, ±20% jitter. Scheduling uses floating-point time only; money does not.
- One POST attempt per intent invocation. Foreground opening/resume excludes held receipts and processes only due transient/queued receipts, at most three attempts per receipt per foreground session. There is no sleeping intent, background guarantee or notification.
- After seven days or 20 attempts, pause for explicit review. Manual retry confirms the exact original payload/key and respects the scheduled delay; there is no “retry with new ID.”

Storage is capped at 500 receipts. SQLite is limited to 600 × 4096-byte pages so the database plus rollback journal stays below 5 MiB; full storage fails closed. Only delivered receipts whose acknowledgement is older than 30 days can be evicted. A late acknowledgement starts a fresh 30-day window; a local SQLite schema upgrade preserves earlier receipts conservatively. No backend migration is involved. Unresolved receipts have no automatic deletion deadline and are never silently evicted. Capture history is delivery diagnostics, not a transaction editor. Review unresolved captures before forgetting/reinstalling; this app cannot cancel server cash. Local deletion of unresolved receipts is intentionally not offered.

### Final held-review implementation verification (2026-09-27)

- **58 unit + 2 UI = 60 tests passed, 0 failed, 0 skipped.** The new tests exercise real SQLite close/reopen, two-day frozen identity, disabled holds, launch/foreground and backend enablement producing no held POST, explicit manual retry using identical bytes, credential rotation, no device/binding remapping, no force-resend after delivered/ambiguous/conflict, old receipt decoding without a label, and unresolved retention. Existing persistence-before-POST/capacity/timeout tests remain intact. Backend replay evidence is separate: **33 HTTP tests and 27 disposable PostgreSQL tests passed**, including zero additional cash on same-key replay.
- Debug Simulator test build, Release Simulator build and Debug physical-device build passed. The held-review build installed on Oz's iPhone after one device transport-reset failure and a successful unchanged retry. No runtime purchase/locked observation is claimed. Existing Personal Team signing and 0.1.0/build 1 are preserved.
- Capture history now shows merchant, canonical amount/ILS, frozen date, **binding label snapshot**, state and explicit held-review explanation. Only confirmed **Retry same capture** can send a held row. No editing/remapping/regeneration controls exist. Legacy receipts retain exact bytes and show label unavailable rather than inventing a label. Data survives app/process restart subject to protected-storage availability; uninstall survival is not promised.
- Commands from repository root:

```sh
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Debug -destination 'platform=iOS Simulator,id=C016BBEB-E3EB-4D81-AC87-4B74571C74D1' -derivedDataPath /private/tmp/flowlink90-sim -resultBundlePath /private/tmp/flowlink90-held-tests.xcresult -collect-test-diagnostics never test
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Release -destination 'generic/platform=iOS Simulator' -derivedDataPath /private/tmp/flowlink90-release build
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath /private/tmp/flowlink90-device build
xcrun devicectl device install app --device 00008150-00181C513E30C01C /private/tmp/flowlink90-device/Build/Products/Debug-iphoneos/FlowLink.app --timeout 30 --json-output /private/tmp/flowlink90-held-install-retry.json
node --test server/test/flowlink.test.js server/test/flowlinkBindings.test.js
node --test server/test/flowlinkBindingsPostgres.local.test.js
python3 docs/operations/flowlink_rehearse.py --postgres-major 16 --output /private/tmp/fli90-reference-reviewed-final
```

The rollout rehearsal verifies 15 cases against disposable PostgreSQL, including ordered/full-schema equality, unchanged domain/financial baseline through enrollment, and rejection of actual grant/RLS/RPC/data drift. A documentation-generation command initially had a Python quoting error; no SQL was applied by that failed command. It was corrected before the successful rehearsal. No existing migration or backend runtime was changed.

### Non-production phone setup

Debug `FLOWLINK_API_BASE_URL` is validated and persisted as non-secret, non-backed-up configuration so system-launched intents use the same endpoint as the foreground app. Release ignores that development selection. For an iPhone, use a trusted HTTPS endpoint on a disposable backend; localhost refers to the phone. HTTP LAN hosts and invalid TLS remain rejected. Pair and approve cards only in that disposable environment with separately provided owner setup. No production configuration is changed by the app.

## Release / Version gate

- Release impact: **Yes**.
- SemVer impact: **Minor**, backward-compatible, part of the grouped FlowLink/APY initiative.
- Candidate release: proposed **v1.4.0**, final decision [#84](https://github.com/OzAvrahami/finance-tracker/issues/84).
- Included release candidate: [FlowLink #85](https://github.com/OzAvrahami/finance-tracker/issues/85) / [APY #78](https://github.com/OzAvrahami/finance-tracker/issues/78); no version per Issue.
- CHANGELOG status: actual FLI-04 foundation and FLI-05 implementation progress recorded under Unreleased; configuration mapping is owner-verified; runtime/device verification remains pending.
- Version-bump status: Finance Tracker's seven fields remain **1.3.1**; deferred coordinated preparation. FlowLink starts at **0.1.0 / 1** independently.
- Publication status: **None / out of scope**. No tag, GitHub Release, deployment or Apple distribution.
- Owner acceptance / verification: **Pending** for #90; #89 accepted and completed.

See the canonical [Release / Version gate](../../docs/github-development-standard.md#release--version-gate). Owner commit/push and any production or publication work remain separate. Wallet App Intent/capture/SQLite receipts and owner-held review are implemented in #90. Real purchase runtime/locked evidence is deferred to the separately authorized #91 checkpoint; notifications/APNs, App Store/TestFlight/Unlisted distribution and a full finance mobile app are excluded.

## QR onboarding acceptance (#90)

The second-iPhone workflow is identical: owner generates a QR labelled “Noya iPhone”; that phone scans and connects; the owner selects the new phone and explicitly creates its card binding. No spouse production enrollment was performed while implementing this correction.

Once at least one approved card is available, **Finish Wallet setup** explains the verified iOS 27 configuration: selected Wallet card trigger → FlowLink **Record Wallet Transaction**, chosen binding, direct Transaction.Amount / Merchant / Name, Show When Run off, automation on. FlowLink cannot create a personal automation. Real purchase values and locked/background execution remain deferred; QR compilation/tests do not prove optical scanning on hardware. Owner review should exercise permission allow/deny, scanning, connected status and new-device selection on a non-production setup before any separately authorized enrollment.

Both ingestion flags remain false. QR enrollment changes no money, ingestion retry/hold behavior, schema, credential format or authorization policy. Migrations 037/038 are already deployed per owner; do not rerun them for this UX change.

### QR correction verification — 2026-09-28

Starting HEAD: `f7b1e7003d1f9d272dda5cc34c0282089f62bf4a`; branch: `feat/flowlink-qr-pairing-90`. Xcode 27.0 (27A266a), `/Applications/Xcode.app/Contents/Developer`, iOS deployment target 17.0. Existing Personal Team and `com.ozavrahami.flowlink.local` signing preserved.

| Check | Result |
| --- | --- |
| Targeted web pairing/bindings/API | 37 passed, 0 failed |
| Full client suite, bounded concurrency | 562 passed, 4 failed (566 total, 38 files) |
| Unchanged starting-commit Import tests | Same 4 failed, 9 passed; existing tests look for portalled category options inside the table |
| FlowLink server authentication/enrollment/bindings | 33 passed, 0 failed |
| Native unit tests | 62 passed, 0 failed |
| Native UI tests | 3 passed, 0 failed: primary scanner/fallback, invalid paste, RTL/large text |
| Debug and Release simulator builds | Passed |
| Debug physical iPhone build | Passed, Oz’s iPhone / iPhone 17 Pro Max, existing local signing; no new installation/enrollment performed |
| Client production build | Passed; existing bundle-size advisory remains |
| Plist/project validation | 3 passed |
| Changed-file UTF-8 / Markdown file links | 20 files / 30 local links passed |

Commands from repository root (logs/DerivedData outside Git):

```sh
npm --prefix client test -- src/pages/Settings/FlowlinkBindingsTab.test.jsx src/pages/Settings/FlowlinkPairingDialog.test.jsx src/services/api.test.js
npm --prefix client test -- --maxWorkers=2
npm --prefix client run build
node --test server/test/flowlink.test.js server/test/flowlinkBindings.test.js
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Debug -destination 'platform=iOS Simulator,id=C016BBEB-E3EB-4D81-AC87-4B74571C74D1' -derivedDataPath /private/tmp/flowlink90-qr-sim build
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Debug -destination 'platform=iOS Simulator,id=C016BBEB-E3EB-4D81-AC87-4B74571C74D1' -derivedDataPath /private/tmp/flowlink90-qr-sim test
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Release -destination 'platform=iOS Simulator,id=C016BBEB-E3EB-4D81-AC87-4B74571C74D1' -derivedDataPath /private/tmp/flowlink90-qr-release build
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Debug -destination 'platform=iOS,id=00008150-00181C513E30C01C' -derivedDataPath /private/tmp/flowlink90-qr-device build
plutil -lint ios/FlowLink/FlowLink/Info-Debug.plist ios/FlowLink/FlowLink/Info-Release.plist ios/FlowLink/FlowLink.xcodeproj/project.pbxproj
git diff --check
```

Intermediate results are not hidden: the first targeted run found an accessibility-role mismatch in the new error alert; using the existing Alert `urgent` property fixed it. One full client run overlapped Xcode work and also timed out an unchanged AddTransaction test at its 5-second limit; bounded-concurrency rerun passed that test without changing it. The four Import failures reproduce in an isolated archive of starting HEAD with the same dependencies. No unrelated Import behavior/tests were changed.

The new QR dependency is pinned `react-qr-code@2.2.0`, a local SVG renderer. No QR network service, camera photo recording, arbitrary scanned URL handling, notification/APNs code, database/server change, production invocation or distribution asset was added. All seven Finance Tracker fields remain 1.3.1; FlowLink remains 0.1.0/build 1. Optical scanning, camera permission behavior on the owner's physical phone, real enrollment and owner acceptance are pending; build success is not that evidence.

### Release / Version gate

- Release impact: **Yes** — usable owner-web/native QR enrollment and Wallet setup guidance.
- SemVer impact: **Minor**, backward-compatible onboarding capability within FLI-05.
- Candidate release: **proposed v1.4.0**, final decision [#84](https://github.com/OzAvrahami/finance-tracker/issues/84).
- Grouping / included release candidate: existing FlowLink [#85](https://github.com/OzAvrahami/finance-tracker/issues/85), coordinated by #84; no per-Issue bump.
- CHANGELOG status: **Updated under Unreleased**, #90 onboarding correction.
- Version-bump status: **Deferred** to owner-coordinated #84 preparation; seven product fields 1.3.1 and native 0.1.0/build 1 unchanged.
- Publication status: **Out of scope**; no tag or GitHub Release.
- Owner acceptance / verification: **Pending**, #90 remains open for Verify. Real Wallet runtime/locked-event evidence remains deferred; #91 was not started.
