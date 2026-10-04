# FlowLink — native foundation and Wallet ingestion

Current correction: [String Amount boundary](#string-amount-boundary--2026-09-29). Earlier dated build/typed-parameter instructions below are historical; use the current section for installation and owner testing.

FlowLink is a small iPhone companion for Finance Tracker. The FLI-04 foundation pairs a device and lists approved cards. [FLI-05 #90](https://github.com/OzAvrahami/finance-tracker/issues/90) adds a native Wallet action and durable delivery receipts. **The local-first synthetic gate was accepted on hardware. A subsequent real Wallet event resolved its binding but did not record perform() entry. The owner now confirms direct Wallet Amount/Merchant/Name → String configuration mapping. The permanent String-based action is implemented; its new synthetic test and actual real Wallet String/locked-background runtime remain pending.**

- Project: `ios/FlowLink/FlowLink.xcodeproj`, shared scheme **FlowLink**.
- App version **0.1.0**, build **2**, independent of the Finance Tracker product version (see the [documentation index](../../docs/README.md)).
- Temporary bundle identifier: `com.ozavrahami.flowlink.local`.
- iPhone; deployment target **iOS 17.0**; Swift 6 language mode; Apple frameworks only.
- Targets: `FlowLink`, `FlowLinkTests`, `FlowLinkUITests`.
- No nested Git repository, package dependencies or distribution assets. The owner selected an existing Personal Team for local development signing; that configuration is preserved.

The [accepted contract](../../docs/architecture/FLOWLINK_NATIVE_INGESTION_CONTRACT.md), [enrollment implementation](../../docs/operations/FLI_02_DEVICE_ENROLLMENT.md) and [binding implementation](../../docs/operations/FLI_03_CARD_BINDINGS.md) remain authoritative.

## Owner-device build versioning

Every **new installable FlowLink owner-device build** must increment the app target's
`CURRENT_PROJECT_VERSION` in **both Debug and Release**. Never reuse a build number already
installed on the owner's device. Keep `MARKETING_VERSION` independent; currently **0.1.0**.
This rule applies to later owner-device builds even within the same Issue. Rebuilding/testing
the same pending, not-yet-installed delivery artifact does not allocate another build number.
Read back `CFBundleShortVersionString` and `CFBundleVersion` from the final signed `.app`
before giving the owner its installation command. This does not change Finance Tracker's
product SemVer fields. Test bundles are not separately installable owner app deliveries.

Current owner delivery is **FlowLink 0.1.0 (3)**, a Release signing-renewal build for #91.
Builds 1 and 2 and their commands/results below are historical. The build-3 recovery
checkpoint below records its installation and remaining device-trust gate.

### Build 3 signing recovery — 2026-10-04

The documented build-2 provisioning expiration was 2026-10-03 19:47 UTC; the retained
development profile confirms that expiry. Release build 3 renews the existing Personal
Team provisioning without runtime changes. Its profile expires **2026-10-11 06:54 UTC**.
The bundle/application identifier and signed entitlements match the prior app; production
Release configuration continues to ignore the stale Debug-only endpoint override.

The owner confirmed both ingestion flags false before installation. The signed Release
build passed signature and plist/project validation and was installed over the existing
app without uninstalling or replacing its data container. Private before/after exports
confirmed byte-identical installation/device metadata, bindings, captures and diagnostics.
The five receipts remained three held purchases and two excluded synthetic tests, with
no queued/retryWait/inFlight entries. No receipt was retried.

The first ordinary launch was denied by iOS with a signing/entitlement/user-trust error.
After the owner approved the existing Developer App trust, normal launch succeeded. The
owner confirmed Connected, ingestion Disabled and the existing card available, verifying
retained credential access without re-pairing. A post-launch private export confirmed the
receipt database and diagnostics byte-identical to the original evidence; all five receipt
rows, frozen payloads, attempts and retry times were unchanged. Installation/device/binding
JSON content also remained unchanged. Recovery is complete; no receipt was retried, and
financial posting remains a separately controlled verification step with ingestion disabled.

Only app build metadata changed; Finance Tracker remains 1.6.0 and FlowLink remains 0.1.0.
No runtime test suite was repeated for this metadata-only recovery. No product SemVer
change or release publication is required by this local signing renewal.

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

The app has one compact screen: Connection, Cards and Diagnostics. Cards are read-only. “Manage cards in Finance Tracker” opens the existing web `/settings` page in Safari; FlowLink has no owner JWT login or administration capability. An empty list explains the owner approval step. Cached safe cards appear before refresh, explicitly labelled as unverified availability; failed refreshes retain display metadata without granting authority or deleting credentials. Available/disabled/unavailable use text and symbols, not color alone. Native controls support Dynamic Type, VoiceOver, system light/dark appearance and RTL layout.

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

Application Support contains a random installation marker, scoped non-secret device/binding metadata, immutable capture receipts and bounded stage-only diagnostics. The directory is excluded from backup and files use complete-until-first-user-authentication protection. A missing marker creates a new namespace; an invalid marker fails closed. Reinstallation therefore never silently adopts leftover Keychain credentials. Credentials never enter UserDefaults, ordinary metadata files, logs or observable UI models. Pairing text lives briefly in the secure input/scanner confirmation memory, then only in the protected Keychain draft for recovery; it is never ordinary persisted state.

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

`RecordWalletTransaction` exposes **FlowLink → Record Wallet Transaction** through public App Intents/App Shortcuts. The original parameters were **Card binding** (`FlowLinkCardBinding` AppEntity), **Merchant** (optional String), **Name** (optional String), and **Amount** (`IntentCurrencyAmount`, restricted to ILS). The current Amount is String; see the current correction below. The [Apple money type](https://developer.apple.com/documentation/appintents/intentcurrencyamount) provides Decimal and currencyCode; its availability does not prove the Wallet variable supplies compatible content.

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

This is **configuration-time compatibility evidence supplied by the owner**. It does not reveal the raw Wallet Amount type or prove the runtime Decimal/currency value. This describes the earlier IntentCurrencyAmount experiment, now superseded by the String Amount boundary below. It was not proof of runtime materialization.

### Deferred runtime/device evidence — implementation may reach Verify

The owner superseded the local mock and immediate-purchase gate on 2026-09-27. At that checkpoint the implementation was **Open / Verify / P1**, with owner acceptance **Pending**, after automated checks and builds passed. The 2026-09-29 failed event and Windows correction below supersede that workflow checkpoint. Real runtime Amount, original Merchant/Name values and Wallet-event locked/background execution remain explicitly deferred; no purchase is required now. Earlier checkpoint notes below are historical, not current completion gates.

The authoritative later workflow is **capture first, review before posting**: prepare production enrollment/bindings but leave both ingestion flags false; a natural event is stored durably and receives `flowlink_ingestion_disabled`; it remains held until the owner reviews it and explicitly retries that same receipt after separately authorizing native enablement. No pre-purchase enablement or helper Shortcut action is needed. Invalid runtime evidence/storage unavailability still fails safely; configuration compatibility is not a guarantee that a real event executes.

See the [owner rollout runbook](../../docs/operations/FLOWLINK_OWNER_ROLLOUT.md) for exact 037 → 038 preflight/postflight, SHA/deployment verification, authenticated owner UUID, pairing/bindings, production app configuration, deferred #91 checklist and legacy CAL duplicate protection. These are prepared instructions; no production action occurred and #91 was not started. The Mac mock/CA is optional historical evidence and no longer blocks completion. Cleanup is in that runbook; if the CA was never installed, no iPhone certificate cleanup is needed.

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

At the historical typed-parameter checkpoint (superseded by the String section below), the path accepted only positive exact ILS Decimal, at most two fractional digits and 28 whole digits, without rounding, binary floating-point money or FX. The optional tested text parser accepts only `₪` + ASCII digits + dot + two digits; no grouping, whitespace, foreign currency, negative, zero or attachment forms. Nonempty invalid Merchant fails; Name is used only for missing/whitespace Merchant. Selected text is at most 512 Unicode scalars and must be usable; no concatenation or fabricated name.

Intent entry freezes one local Gregorian date/timezone and one UUIDv4, before asynchronous work. Delayed execution, crossing midnight or travel can change the capture date relative to purchase date: this is an accounting fallback, not a purchase timestamp. No `occurred_at`, provider reference or fuzzy dedupe is generated. Independent invocations get independent keys, even for identical purchases.

`Wallet/ReceiptStore.swift` uses native SQLite, DELETE rollback journal, FULL synchronous commits, fullfsync, busy timeout and BEGIN IMMEDIATE transactions. The database and its directory use complete-until-first-user-authentication protection, with the parent excluded from backup. No shared app group or external dependency. Physical lock/side-file behavior remains a hardware verification item.

The immutable record contains the approved binding display-label snapshot, installation/device/origin, protocol version, the exact six-field UTF-8 request bytes and SHA-256, one key, and diagnostic capture time. Credentials are absent; Keychain is read at transmission. Protected local installation/device metadata and the selected entity ID/label are sufficient to preserve evidence, even if Keychain is unavailable or empty. Credentials are first read after commit. A missing credential pauses delivery; it never becomes authorization. Explicit connection reset still clears metadata and prevents new capture; metadata is installation/origin scoped, including an in-place legacy metadata upgrade. SQLite guards frozen fields; mutable state includes attempts, next/last attempt, safe outcome/error and claim lease. Responses store safe outcome state rather than full server payloads or competing candidate IDs.

A receipt commits before any capture-path HTTP request or credential read, including binding/status requests. A second connection/process cannot claim an active receipt. A 60-second lease exceeds the 25-second HTTP timeout; expired claims recover with identical bytes/key, and a stale worker cannot overwrite a newer claim. Credential rotation changes only the header, never receipt identity. Device/origin mismatch cannot replay another installation's receipts. Local storage failure or capacity failure means no POST.

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


## Local-first correction ? 2026-09-29

Status: **#90 Open / In Progress / P1; owner acceptance Pending**. Windows source work does not pass the Mac gate. Base `71faa5ce0fe356361fd4b5063ded603558d4dd7d`; branch `fix/flowlink-local-first-capture-90`. Preserve Finance Tracker **1.4.0** and FlowLink **0.1.0/build 1**, QR onboarding and later repository cleanup. No #91/#82 work.

### Failed hardware evidence, not a successful capture

Owner report: iPhone 17 Pro Max / iOS 27, 2026-09-29 about 10:46 local, real **ILS 21.00**, selected Discount card ending 2755. The payment succeeded according to the Wallet/card notification. The personal automation triggered, then Record Wallet Transaction reported **?Couldn't communicate with a helper application.?** FlowLink ? Capture receipts was empty. **Runtime capture acceptance failed; no local receipt and no FlowLink financial transaction were reported.** This was not the intended disabled-ingestion hold. The raw runtime Amount/merchant inputs, actual stage reached and locked/background execution are not established by that notification.

Owner also observed cards appearing only after a delay on normal launch. Code establishes why that UI waited; it does not establish that the same delay caused the generic iOS helper failure.

### Audited causes and execution boundary

Before this correction:

1. Shortcuts could call `FlowLinkBindingQuery.entities(for:)` before `perform()`. It called `approved()` ? `WalletRuntime.bindings()` ? configuration/installation initialization ? Keychain identity ? another credential read ? live GET bindings. Cache fallback existed only for selected errors and only if that separate cache had previously been populated.
2. `perform()` froze date/timezone/UUID, then created a runtime. Initialization parsed the backend selection, loaded/rewrote the protected installation marker, created a URLSession and pairing service, and located Application Support. No initializer performed HTTP.
3. `record()` normalized Decimal/currency and selected Merchant/Name, read local identity through Keychain, awaited another binding lookup, required live/cached availability, and then constructed `FrozenCapture` with a rediscovered label.
4. Opening `ReceiptStore` read identity again, opened/upgraded SQLite, then `CaptureService.capture()` finally inserted the receipt. Its own insert-before-credential/POST order was correct, but earlier dependencies could prevent reaching it.
5. `ConnectionModel.restore()` read pairing state, awaited `/device` and `/device/bindings`, then assigned cards. Errors cleared cards. It never populated the runtime's separate cache.

The confirmed defects are pre-persistence networking/credential dependence and separate cache population paths. **The specific cause of the owner's OS helper error remains unproven.** If no diagnostics appear after the corrected manual test, investigate system parameter/helper invocation and device logs; do not claim the transport was reached.

Now:

```text
configured entity ID -> local protected directory -> ID + label
perform freezes Date / TimeZone / UUID once
  -> exact normalization -> Merchant/Name -> validate ID/label
  -> local installation/device metadata -> FrozenCapture
  -> SQLite insert COMMIT -> readback
  -> current Keychain credential -> HTTP -> persisted delivery outcome
```

No `ConnectionModel`, foreground view, owner session, QR workflow, interactive login, live device/binding status or network participates before receipt commit. `@MainActor` serializes the existing service/storage code; it does not require a SwiftUI view or foreground app. `openAppWhenRun=false` and the direct `IntentCurrencyAmount`/Merchant/Name mappings stay unchanged. URLSession construction is not a request. Invalid parameters, missing local identity, missing/corrupt configured entity metadata, unavailable protected storage and capacity exhaustion can still prevent capture; each fails safely rather than inventing evidence.

[Apple documents entity lookup during parameter resolution](https://developer.apple.com/documentation/appintents/entity-queries). `entities(for:)` reconstructs the selected UUID's display representation locally, including disabled/retired metadata. Missing IDs fail clearly, never fall back to another card. `suggestedEntities()` alone may refresh remotely and offers only available active bindings. This does not assert undocumented Shortcuts serialization details or promise background execution.

### Shared directory, protection and diagnostics

`BindingDirectory` uses the existing `FlowLink/Wallet/bindings.json` shape/path, preserving existing cache compatibility. It stores only installation UUID, device UUID, canonical origin and `{id,label,status,revision,available}`. No credentials, payment/source IDs or headers. Validated maximum: 32 live response rows, 256 total including removed IDs retained as disabled tombstones, 128 KiB file cap. At capacity fail visibly rather than silently evicting configured IDs. Atomic replacement prevents partial JSON; concurrent refreshes remain advisory snapshots, never financial authorization. Binding rename updates display but cannot change an existing receipt's frozen label/bytes.

App composition injects the same directory into `ConnectionModel`. `restore()` assigns local metadata/cards before the first network suspension, displays **Saved ? availability not verified**, then refreshes. Successful responses update directory and UI; offline, slow and authority failures retain safe display with explicit connection state. Normal success shows current server availability. An upgrade with no existing cache needs one successful normal card refresh, not re-pairing; subsequent configured runtime resolution is local-only.

Installation metadata now includes its installation scope. Existing same-origin installations upgrade in place without reading Keychain; a changed/missing marker must not resurrect an old metadata identity. Explicit reset still clears metadata. No reset is part of this correction.

SQLite receipts, directory and diagnostics use complete-until-first-user-authentication and backup exclusion. SQLite DELETE journal inherits the protected directory; FULL commit and receipt leases remain. Keychain stays `AfterFirstUnlockThisDeviceOnly`, non-synchronizing. Apple documents [file access after first unlock](https://developer.apple.com/documentation/foundation/fileprotectiontype/completeuntilfirstuserauthentication) and [device-only Keychain access](https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlockthisdeviceonly). Actual locked files/journal/helper access must be checked on hardware. **No before-first-unlock support is claimed.** All intent code is in the app target with the same container; no new extension, App Group, entitlement or signing change.

FlowLink ? Diagnostics ? **Capture diagnostics** shows at most 128 local records (separate protected SQLite, 64-page cap). Only system time, allowlisted stage and allowlisted error code are stored: `entity_resolved_local`, `entity_resolution_failed`, `intent_invoked`, `parameters_normalized`, `local_identity_resolved`, `receipt_persisted`, `delivery_started`, `delivery_held_disabled`, `delivery_failed`, `delivery_completed`, `intent_failed`, `intent_completed`. No merchant, amount, binding/device ID, raw error, payload or credential. Diagnostics are best-effort and never gate capture. Times are operational evidence, not purchase timestamps. Concurrent invocations can interleave stages; this is not a complete per-event trace.

| Delivery result after commit | Local evidence / retry |
| --- | --- |
| `503 flowlink_ingestion_disabled` | Held for owner review; never automatic retry, including after server enablement. |
| Timeout/offline/429/transient service failure | Immutable receipt retained; bounded original-key retry with backoff/Retry-After. |
| Unreadable/missing credential, 401 or 403 (including binding unavailable) | Paused; no automatic retry or remapping. |
| Invalid configuration/source or unknown result | Paused; retain evidence for review. |
| 400/413/415/422 | Failed terminal delivery, evidence retained. |
| Ambiguous/conflict | Needs review; no new capture/key/cash. |

Capture history reads receipts before awaiting due delivery. If a delivery-state write fails after the verified receipt commit, the intent reports saved locally / uncertain delivery, never encourages a new key.

The backend's unchanged disabled-route guard returns before auth/ingest; the synthetic hold therefore creates no financial observation/event. A stale directory never bypasses server credential/device/binding/source/payment/flag checks. Existing held receipts remain excluded from foreground work. No migration or backend change is required.

### Regression sources and Windows verification boundary

`LocalFirstCaptureTests.swift` exercises the real runtime orchestration with temporary protected files/SQLite and fake transport: local-only entity lookup, remote discovery/shared cache, missing/corrupt metadata, namespace isolation, retired IDs, slow/offline startup, persisted-before-first-HTTP and before-first-Keychain-read, suspended delivery/reopen, post-commit delivery-state write failure, credential failure, server rejection, immutable rename/retry, synthetic-test terminal archive, bounded diagnostics and metadata upgrade. Existing Wallet SQLite/retry/hold tests remain; their old credential-dependent identity and disabled-entity expectations are deliberately corrected. QR/manual pairing/recovery tests are retained. UI test source adds unpaired local diagnostics navigation.

Windows checks are static source/project/reference/UTF-8/plist/version/whitespace checks, not native compilation. Tree-sitter syntax inspection requires two known grammar-only normalizations in memory: `isolated deinit` and `try?` on the throwing property inside a SwiftUI optional binding; the accepted baseline also uses these constructs. Xcode must validate types, actor isolation, AppIntents metadata extraction, SwiftUI presentation and iOS file protection. No client/server runtime changed, so application suites need no repeat for this native-only correction. No physical-process crash, lock, app-install or synthetic invocation has occurred in this Windows pass.

### Windows results for this correction

| Check / command | Result |
| --- | --- |
| `node --test server/test/flowlink.test.js server/test/flowlinkBindings.test.js` | **33 passed, 0 failed, 0 skipped**. Existing isolated HTTP/service harness and fake RPC; no production requests or DB. Relevant because stale native metadata must never bypass disabled/current-authority server checks. |
| `python "$env:TEMP\flowlink90_windows_check.py"` (temporary read-only validator) | **22 changed/new UTF-8 files**, **27 Swift grammar scans**, **93 OpenStep objects / all source memberships**, **2 XML plists**, **31 local Markdown file links** passed. Grammar accommodations described above; not Swift type-checking or Xcode project validation. Temporary tools: tree-sitter 0.26.0, tree-sitter-swift 0.7.3, openstep-parser 2.0.3, installed only under the OS temp directory. |
| `git diff --check` | Passed. No staged changes. |
| Version / scope checks | Seven product fields **1.4.0**; app **0.1.0/build 1**, bundle ID/team unchanged. No changed migrations/schema, nested iOS Git, matched secret literals or notification/APNs implementation. |
| Native tests/builds | **Not run on Windows**. Source inventory: **84 unit tests + 4 UI tests**, including **22 new local-first unit tests + 1 new UI test**. Existing QR/manual-pairing/recovery source retained. No claim that these sources compile/pass yet. |
| Client / full application suites | Not rerun: no client/server implementation changed. The focused server authority suite above is the only application test run. |

The failed real event is recorded on [#90](https://github.com/OzAvrahami/finance-tracker/issues/90#issuecomment-5887822842). Existing local multi-user drafts and unrelated cache files are untouched. Historical native/QR passes elsewhere in this document are not new correction evidence.

### Historical Windows-to-Mac gate (superseded by current String checkpoint)

First transfer the reviewed working diff by the owner's chosen Git/file workflow without replacing current main or the Mac's local work. The agent has made no commit/push. Run from the Mac checkout containing this exact correction. Choose an available iPhone simulator UUID from the inventory; do not blindly reuse historical IDs.

```sh
cd /Users/ozavrahami/code/finance-tracker
git status --short
xcodebuild -version
xcrun simctl list devices available
xcrun devicectl list devices
export FLOWLINK_SIMULATOR_ID='<available iPhone simulator UUID>'
export FLOWLINK_GATE_DIR="$(mktemp -d /private/tmp/flowlink90-local-first.XXXXXX)"
plutil -lint ios/FlowLink/FlowLink/Info-Debug.plist ios/FlowLink/FlowLink/Info-Release.plist ios/FlowLink/FlowLink.xcodeproj/project.pbxproj
xcodebuild -list -project ios/FlowLink/FlowLink.xcodeproj
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Debug \
  -destination "platform=iOS Simulator,id=$FLOWLINK_SIMULATOR_ID" \
  -derivedDataPath "$FLOWLINK_GATE_DIR/debug" -resultBundlePath "$FLOWLINK_GATE_DIR/tests.xcresult" \
  -collect-test-diagnostics never test
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Release \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath "$FLOWLINK_GATE_DIR/release-sim" build
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath "$FLOWLINK_GATE_DIR/device" build
```

The Debug `test` builds and runs both unit/UI targets; record exact passed/failed/skipped counts. Keep normal simulator signing. Signed Release uses the **existing** team/bundle ID; no `-allowProvisioningUpdates`, new signing setup, uninstall or pairing reset. If signing fails, stop and report rather than changing owner assets. Check bundle/team/backend match the installed app before install.

Only after the gate passes, the **owner** installs Release over the existing app (historical owner device identifier below; first confirm it in `devicectl list devices`):

```sh
xcrun devicectl device install app --device 00008150-00181C513E30C01C \
  "$FLOWLINK_GATE_DIR/device/Build/Products/Release-iphoneos/FlowLink.app" \
  --timeout 60 --json-output "$FLOWLINK_GATE_DIR/install.json"
```

Same bundle/team/container and unchanged Keychain namespace preserve pairing and local data. Installation is pending, not evidence of success. **Do not uninstall, forget the connection, change backend origin or recreate pairing/binding.** Open FlowLink once, check the existing identity, refresh cards to populate the shared directory, then confirm cached labels appear on reopening before network refresh finishes. If pairing/card disappears, stop; do not reset it.

### Separate synthetic Shortcut ? no new purchase

Keep both `FLOWLINK_INGESTION_ENABLED=false` and `APPLE_PAY_INGESTION_ENABLED=false`. Never enable them for this test. Leave the real Wallet automation unchanged.

1. On the owner iPhone create a **separate temporary manual Shortcut**, e.g. ?FlowLink local capture test?. Add **FlowLink ? Record Wallet Transaction** (same existing discoverable action).
2. Choose the already-approved binding. Set Amount to **ILS 1.23**, Merchant **FLOWLINK TEST**, Name **FLOWLINK TEST**. Use the currency amount parameter's constant editor; if its exact UI differs, inspect the on-device picker rather than adding Text/regex/HTTP helpers. No real Wallet input, Card or Pass, credential, JSON or URL is needed.
3. Run once. Expect no helper communication error and a **Held for review ? ingestion disabled** result. Do not repeatedly rerun the Shortcut to retry: each invocation creates a different UUID.
4. Open Capture receipts: exactly one new `FLOWLINK TEST` / `1.23 ILS` receipt, original capture-local date and selected binding label, held status. Diagnostics should show local resolution (when Shortcuts resolves it), invoked ? normalized ? identity ? persisted ? delivery started ? disabled hold ? completed. Screenshot only these safe stages/status if reporting a failure.
5. If no receipt exists, inspect diagnostics and stop; do not buy another item to debug. If paused/retry-wait instead of held, retain it and diagnose the connection while flags stay false; never enable ingestion to force a result.
6. For the acknowledged disabled synthetic receipt only, choose **Mark as local test ? never send?**, confirm. This keeps immutable bytes/UUID/date/evidence, records a terminal non-retryable marker, and removes delivery controls. Existing terminal `failed` storage state is reused so older builds also cannot retry it. The operation is restricted to held `flowlink_ingestion_disabled`, exact merchant `FLOWLINK TEST`, amount `1.23`, currency `ILS`; it cannot mark real/uncertain/delivered receipts. Never mutate or reuse a real capture UUID.
7. Delete only the temporary Shortcut afterward, not any real receipt or automation. Confirm the marked test remains visible and cannot retry. Do not uninstall FlowLink.

Expected financial effect: **zero transaction, zero financial APY observation/event**. Disabled guard code and existing backend regression evidence support that expectation; this Windows pass did not query production or independently verify new production row counts. The owner can inspect the normal transaction list; any formal financial/provenance readback remains a separately authorized read-only operation.

This test establishes only **manual Shortcuts ? AppIntent ? local receipt ? disabled hold**. It does not prove real Wallet `Transaction.Amount`, natural purchase execution, locked/background execution or before-first-unlock behavior. Those acceptance items remain pending; no second real purchase is required for debugging. Keep #90 Open / In Progress / P1 until both the Mac gate and owner synthetic test evidence are recorded. Do not move to Verify merely because native builds pass; do not close it or start #91.

Release / Version gate for this correction: release impact **Yes**; SemVer **Patch** (repair existing experimental capture behavior, not completion of the original Minor initiative); candidate **TBD on #90 after published v1.4.0**; grouping **existing FlowLink #85/#90, future release membership TBD**; CHANGELOG **Updated under Unreleased**; version bump **Deferred to owner-coordinated release preparation**, all seven product fields **1.4.0**, native **0.1.0/build 1** unchanged; publication **Out of scope**; owner acceptance **Pending**. No production execution/configuration/migration/secret/flag change, financial operation, commit, push, notification/APNs or distribution work.


### Mac native gate — 2026-09-29

Clean starting checkout: `fix/flowlink-local-first-capture-90`, HEAD `52abba48ed0a0a6728557a100dbdc48b52adf1da`. Xcode **27.0 (27A266a)**, Swift **6.4**, developer directory `/Applications/Xcode.app/Contents/Developer`. iPhone 18 Pro / iOS 27 simulator `C016BBEB-E3EB-4D81-AC87-4B74571C74D1`; signed Release targets Oz’s physical iPhone 17 Pro Max, `00008150-00181C513E30C01C`.

| Gate | Result |
| --- | --- |
| Unit tests | **84 passed, 0 failed, 1 explicitly skipped** (85 total) |
| UI tests | **4 passed, 0 failed, 0 skipped**, including QR/paste recovery and local diagnostics |
| Debug simulator build | Passed |
| Release simulator build | Passed |
| Signed Release physical-device build | Passed, signature verified; **not installed/launched** |
| Physical-iOS test compilation | `build-for-testing CODE_SIGNING_ALLOWED=NO` passed; no test installation/execution |
| Plists / project / scheme | 2 source plists + project passed `plutil`; shared-scheme XML parsed; `xcodebuild -list` and all targets built |
| Version / scope | Seven Finance Tracker fields remain **1.4.0**; app **0.1.0/build 1**, existing team/bundle/Keychain namespace unchanged; no server or migration changes |

**Mac-only corrections and intermediate failures:**

- The original Data Protection test failed three assertions because Simulator's `attributesOfItem` omits `NSFileProtectionKey`. A raw-string cast also failed. A diagnostic probe showed URL resource readback, but new negative controls proved that Simulator returns the same class even for explicit unprotected/complete files. Consequently the exact class assertions **remain hardware-only**, now including negative controls; Simulator reports a named skip rather than false security evidence. An added always-running test checks the three real files, readable binding/diagnostic state and backup exclusion. Both tests compile for physical iOS. Actual device encryption/locked-file behavior is **not verified** by simulator success or the signed app build.
- The diagnostics UI test exposed the refresh button falling below populated history. Move only **Refresh diagnostics** into the navigation toolbar; no capture/delivery/state behavior changed. All four UI tests pass after this correction.
- No Swift actor/Sendable/compiler defect was found. No isolation was bypassed. `entities(for:)` remains local-only; configuration-time discovery refreshes the shared directory; receipt commit/readback precedes Keychain/HTTP; startup cached cards, stage-only diagnostics, QR pairing and `openAppWhenRun=false` remain covered.

Exact final commands from repository root (all outputs under `/private/tmp/flowlink90-local-first*`):

```sh
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Debug -destination 'platform=iOS Simulator,id=C016BBEB-E3EB-4D81-AC87-4B74571C74D1' -derivedDataPath /private/tmp/flowlink90-local-first-sim test
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Debug -destination 'platform=iOS Simulator,id=C016BBEB-E3EB-4D81-AC87-4B74571C74D1' -derivedDataPath /private/tmp/flowlink90-local-first-sim build
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Release -destination 'platform=iOS Simulator,id=C016BBEB-E3EB-4D81-AC87-4B74571C74D1' -derivedDataPath /private/tmp/flowlink90-local-first-release-sim build
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Release -destination 'platform=iOS,id=00008150-00181C513E30C01C' -derivedDataPath /private/tmp/flowlink90-local-first-device build
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath /private/tmp/flowlink90-local-first-device-tests CODE_SIGNING_ALLOWED=NO build-for-testing
plutil -lint ios/FlowLink/FlowLink/Info-Debug.plist ios/FlowLink/FlowLink/Info-Release.plist ios/FlowLink/FlowLink.xcodeproj/project.pbxproj
xcodebuild -list -project ios/FlowLink/FlowLink.xcodeproj
codesign --verify --deep --strict --verbose=2 /private/tmp/flowlink90-local-first-device/Build/Products/Release-iphoneos/FlowLink.app
git diff --check
```

Owner install command — **prepared, not executed**:

```sh
xcrun devicectl device install app --device 00008150-00181C513E30C01C \
  /private/tmp/flowlink90-local-first-device/Build/Products/Release-iphoneos/FlowLink.app \
  --timeout 60 --json-output /private/tmp/flowlink90-local-first-install.json
```

The installed phone app was read back as `com.ozavrahami.flowlink.local`, **0.1.0/build 1**. The new app uses the same bundle and unchanged team `AVQU374YW5`; an in-place update retains its container/Keychain. Do **not** uninstall, forget/re-pair or change backend origin. Release uses the existing production HTTPS origin; confirm the current app is already connected to that origin before installing, otherwise stop because an origin change intentionally isolates pairing/storage. Post-install retention is pending owner observation, not claimed executed. No phone container/Keychain contents were inspected. Open once, check existing identity, refresh approved cards to populate the shared directory; stop if pairing or bindings disappear.

Then perform the **separate synthetic Shortcut** checklist above: existing binding, **ILS 1.23**, Merchant and Name both **FLOWLINK TEST**, run **once**, with both ingestion flags remaining false. Expect one immutable held receipt and stage diagnostics through `receipt_persisted` before `delivery_started`, followed by `delivery_held_disabled` and `intent_completed`. Mark the acknowledged synthetic receipt **Mark as local test — never send…** after inspection so it cannot later post. This is not real Wallet or locked/background acceptance. Owner test is still pending; #90 remains **Open / In Progress / P1**.

Release / Version gate: impact **Yes**, SemVer **Patch** for the existing local-first correction; candidate **TBD on #90 after v1.4.0**, grouping **FlowLink #85/#90** with future release membership pending; CHANGELOG **Updated under Unreleased**; version bump **Deferred** to owner release preparation, product **1.4.0**, native **0.1.0/build 1** unchanged; publication **Out of scope**; owner verification/acceptance **Pending**. No commit/push/merge, production operation, migration, config/flag change, pairing/device enrollment or #91 work performed.


### Owner synthetic success and marker cleanup — 2026-09-29

The owner ran the synthetic Shortcut successfully on the physical iPhone. Reported chronology, oldest first:

`entity_resolved_local → intent_invoked → parameters_normalized → local_identity_resolved → receipt_persisted → delivery_started → delivery_held_disabled → intent_completed`

The visible receipt has **ILS 1.23**, merchant **Flowlink test**, the correct existing binding, and **Held for review — ingestion disabled**. This is owner hardware evidence that local entity resolution and App Intent execution succeeded, durable receipt persistence preceded HTTP delivery, and the disabled backend produced a held receipt with **no financial posting**. It does not establish real Wallet runtime values or locked/background behavior.

The mixed-case merchant exposed the cleanup guard's case-sensitive equality. UI availability and the transactional archive operation now share `CaptureReceipt.canArchiveSyntheticTest`: exact held state, exact disabled reason, exact `1.23`/`ILS`, and the explicit ASCII marker **FLOWLINK TEST** after outer whitespace trimming, canonical normalization and locale-stable case normalization. Prefixes/suffixes, internal whitespace changes, punctuation and Unicode lookalikes remain rejected. The comparison never changes merchant evidence, request bytes, binding, date or idempotency key. No automatic archive; the existing owner confirmation remains required.

After installing the rebuilt app **over the existing installation**, open the existing held receipt → **Mark as local test — never send…** → confirm **Mark local test**. Check **Local test — permanently excluded from delivery** and absence of retry controls. **Do not rerun the Shortcut or tap Retry same capture.** Both ingestion flags stay false. #90 remains **Open / In Progress / P1** until the owner confirms this cleanup; owner acceptance remains Pending. The prior Mac gate's install command/path applies to the rebuilt artifact. No installation, production action or receipt mutation was performed by the agent.

Cleanup validation: **86 unit tests passed, 0 failed, 1 existing hardware-only protection skip** (87 total); **4 UI tests passed, 0 failed**. Debug simulator `test`, Release simulator build and signed Release iPhone build passed using the same commands/DerivedData paths in the Mac gate above. Signature, 3 plist/project checks, UTF-8, versions and `git diff --check` passed. Added coverage exercises mixed-case/trimmed persisted markers, every eligibility guard, near-matches/lookalikes, immutable evidence, and terminal non-deliverability. No production request or physical Shortcut execution was performed by the agent.


## String Amount boundary — 2026-09-29

### Evidence and permanent action

Owner inspection on iPhone / iOS 27 confirms direct Transaction.Amount → String,
Transaction.Merchant → optional String, Transaction.Name → optional String, and the existing
binding entity. No helper actions were required; those configuration probes were not executed.
The SDK rejected Decimal as a standalone AppIntent parameter. IntentFile is no longer needed.
All temporary probe actions, stages and tests have been removed. Old unknown diagnostic rows
remain stored but are skipped by the reader; diagnostics are not cleared during upgrade.

**Record Wallet Transaction** now takes Card binding (`FlowLinkCardBinding`), Amount (`String`),
Merchant (`String?`), Name (`String?`). It retains its type/action and parameter identifiers and
`openAppWhenRun=false`. Currency is fixed internally to ILS, with no Currency input. Existing
local entity resolution, frozen date/timezone/UUID, merchant precedence and receipt pipeline
are unchanged. String normalization runs before the existing Decimal-based normalization,
local identity and immutable receipt commit/readback. Only then may Keychain/HTTP delivery occur.
The same server authority and disabled-ingestion hold rules apply.

Configuration compatibility is not real runtime evidence. Historical Notes serialization
`₪4.00` does not establish every real Wallet String representation. The permanent String action
still needs the owner synthetic test and later natural-event evidence.

### Exact grammar

Maximum **128 UTF-8 bytes including outer spacing**. Accept exactly one `₪` or uppercase `ILS`,
as prefix or suffix, with zero or more Unicode **Zs (space separator)** characters outside and
between marker and number. ASCII digits only: **1–28 whole digits, one dot, exactly 2 fractional
digits**. Leading zeros are accepted and canonicalized. The amount must be greater than zero.

Examples: `₪1.23`, `₪21.00`, `₪ 21.00`, `21.00 ₪`, `ILS 21.00`, `21.00 ILS`, `ILS21.00`.
Ordinary spaces, non-breaking spaces, narrow non-breaking spaces and thin spaces are accepted
only at the described boundaries. Tabs/newlines, control/format characters (including bidi
marks), grouping, commas, signs, scientific notation, non-ASCII digits, bare numbers, repeated
markers, foreign/lowercase currency codes, arbitrary words, filenames and excess length/precision
are rejected. No punctuation guessing, NumberFormatter, locale inference, rounding or FX.

Validated text is parsed using Foundation.Decimal with en_US_POSIX and normalized by the existing
exact-money function to two-decimal canonical text. At most 30 significant digits are below
Decimal's precision limit; no Float/Double financial conversion occurs. The server receives the
same six-field request with `currency: "ILS"`.

### Unsupported format diagnostics

No guessed receipt is created. `amount_format_unsupported` stores only a closed structural
descriptor in the existing diagnostics code column, with no schema migration: marker class,
ASCII digit presence, separator class, fractional-digit count, outer Zs spacing, controls, and
UTF-8 length capped at **129+**. Inspection is bounded to 129 UTF-8 bytes for length and the first
128 Unicode scalars for shape; overlength descriptions are explicitly a bounded sample.
No raw input, monetary digits, filename, merchant, binding or credential is retained/transmitted.
FlowLink → Diagnostics → Capture diagnostics displays the descriptor locally. Existing protected,
backup-excluded SQLite, 128-record/64-page limits and best-effort behavior remain. The descriptor
helps identify unsupported shapes; it is not runtime amount evidence or an accounting record.

### Minimal existing-automation migration (owner only)

Automatic migration of a saved IntentCurrencyAmount parameter to String cannot be established
from compilation or metadata. The action identifier remains stable, but a saved literal or
variable coercion may be stale. Use this minimal explicit reconfiguration rather than assuming
that an old saved action updates safely:

1. After installing over the existing app, open Shortcuts → Automation → the existing Wallet
   selected-card trigger. Keep that trigger/card.
2. Remove **only the old FlowLink Record Wallet Transaction action**, plus any temporary probes
   still present. Add the current **FlowLink → Record Wallet Transaction**.
3. Select the same approved FlowLink binding. Set Amount = Transaction.Amount,
   Merchant = Transaction.Merchant, Name = Transaction.Name directly.
4. Set Show When Run OFF; retain Automation ON. Save without executing. Do not add conversions,
   a Currency parameter, Card or Pass, HTTP, credentials or technical helpers.

No QR/pairing/binding changes or complete Wallet-trigger recreation are required by this change.
Report if the current editor rejects a direct assignment; do not compensate with helper actions.

### Owner synthetic String test — execute once, separately from Wallet automation

Both production ingestion flags remain false; no flag changes are part of this test.

1. Create a **separate temporary manual Shortcut** with one current Record Wallet Transaction action.
2. Select the existing approved binding. Enter literal Amount **₪1.23** (include the shekel symbol),
   Merchant **FLOWLINK TEST**, Name **FLOWLINK TEST**.
3. Run that manual Shortcut **once**. The agent has not run it. Do not make a purchase or execute
   the real Wallet automation for this test.
4. Inspect FlowLink: receipt is ILS 1.23 / FLOWLINK TEST / correct binding / Held for review.
   Expected stages: entity_resolved_local → intent_invoked → parameters_normalized →
   local_identity_resolved → receipt_persisted → delivery_started → delivery_held_disabled →
   intent_completed. Confirm persistence precedes delivery.
5. Explicitly choose **Mark as local test — never send…**, then confirm **Mark local test**.
   Verify “Local test — permanently excluded from delivery” and no retry controls.
6. Do not rerun. Remove the temporary manual Shortcut. If any expected step fails, retain evidence
   and report it; do not retry by creating another invocation/key.

This does not verify real Wallet String values or locked/background execution. #90 remains
Open / In Progress / P1, with owner acceptance Pending for the current correction. #91/#82
are not started.

### Release / Version gate

- Release impact: Yes — compatibility correction to the existing Wallet action.
- SemVer impact: Patch; exact runtime compatibility is not yet proven.
- Candidate release: TBD after v1.4.0, tracked by #90.
- Grouping / included release candidate: FlowLink #85/#90; final membership TBD.
- CHANGELOG status: Updated under Unreleased for the permanent String boundary.
- Version-bump status: Deferred to owner-coordinated preparation; Finance Tracker remains 1.4.0; FlowLink app version remains 0.1.0 and owner-device build is incremented to 2.
- Publication status: Out of scope; none.
- Owner verification / acceptance: Pending new synthetic String test and real Wallet/locked-runtime evidence; earlier local-first synthetic acceptance retained.

### String correction native verification

Xcode 27.0 (27A266a), Swift 6.4; iPhone 18 Pro / iOS 27 Simulator.
Final unit suite: **93 passed, 0 failed, 1 skipped** (94 total). The skip is the existing
hardware-only Data Protection assertion, retained for real-device execution. UI suite:
**4 passed, 0 failed**. Initial combined run passed (92 unit passes, 1 skip, 4 UI passes);
a subsequently added diagnostic-history compatibility/retention test passed in the final
unit run. No build/test failure occurred in this correction pass.

Debug Simulator, Release Simulator and signed Release physical-device builds passed.
AppIntents metadata contains only RecordWalletTransaction: required String Amount, optional
String Merchant/Name, original binding entity, same identifiers, openAppWhenRun=false. Temporary
actions are absent. Signature verification and owner-device development provisioning passed;
profile expires 2026-10-03 19:47 UTC. Actual installation remains owner-operated. Both plists,
project, UTF-8, local Markdown links, seven product-version fields and git diff --check passed.

```sh
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Debug -destination 'platform=iOS Simulator,id=C016BBEB-E3EB-4D81-AC87-4B74571C74D1' -derivedDataPath /private/tmp/flowlink90-string-sim -resultBundlePath /private/tmp/flowlink90-string-tests.xcresult -collect-test-diagnostics never test
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Debug -destination 'platform=iOS Simulator,id=C016BBEB-E3EB-4D81-AC87-4B74571C74D1' -derivedDataPath /private/tmp/flowlink90-string-sim -resultBundlePath /private/tmp/flowlink90-string-unit-final.xcresult -only-testing:FlowLinkTests -collect-test-diagnostics never test
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Debug -destination 'platform=iOS Simulator,id=C016BBEB-E3EB-4D81-AC87-4B74571C74D1' -derivedDataPath /private/tmp/flowlink90-string-debug build
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Release -destination 'generic/platform=iOS Simulator' -derivedDataPath /private/tmp/flowlink90-string-release build
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Release -destination 'platform=iOS,id=00008150-00181C513E30C01C' -derivedDataPath /private/tmp/flowlink90-string-device build
plutil -lint ios/FlowLink/FlowLink/Info-Debug.plist ios/FlowLink/FlowLink/Info-Release.plist ios/FlowLink/FlowLink.xcodeproj/project.pbxproj
codesign --verify --deep --strict --verbose=2 /private/tmp/flowlink90-string-device/Build/Products/Release-iphoneos/FlowLink.app
git diff --check
```

In-place owner installation, not executed by the agent:

```sh
xcrun devicectl device install app --device 00008150-00181C513E30C01C /private/tmp/flowlink90-string-device/Build/Products/Release-iphoneos/FlowLink.app --timeout 60
```

Keep the existing installed app: do not uninstall/reset/re-pair. Bundle ID, development team,
Keychain namespace and storage paths remain unchanged. No production/backend/migration/flag
changes, real receipts/transactions, commits, pushes or staging were performed. Regression
receipts use isolated test storage/transport only. Follow the owner migration and one-run
synthetic test above; stop for review before a real purchase or ingestion enablement.

### Current owner-device delivery: FlowLink 0.1.0 (2)

Build 2 supersedes the earlier build-1 String implementation artifact before owner installation.
Only the app Debug/Release CURRENT_PROJECT_VERSION changed; MARKETING_VERSION remains 0.1.0.
The String capture/diagnostic implementation and all existing #90 work are preserved. Root
AGENTS.md now references the permanent owner-device build versioning rule above.

Revalidation: **93 unit tests passed, 0 failed, 1 existing hardware-only Data Protection skip**.
UI tests were not repeated for this version-only change; the unchanged UI previously passed
4/4 tests in the String implementation checkpoint. Release Simulator and signed physical
Release builds passed. AppIntents extraction exposes only the permanent String action;
no probes and openAppWhenRun=false. Signature/provisioning, both plists/project, UTF-8 and
whitespace checks passed. The signed app itself reports CFBundleShortVersionString=0.1.0,
CFBundleVersion=2, CFBundleIdentifier=com.ozavrahami.flowlink.local. Development provisioning
includes the owner's iPhone and expires 2026-10-03 19:47 UTC. No installation performed.

```sh
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Debug -destination 'platform=iOS Simulator,id=C016BBEB-E3EB-4D81-AC87-4B74571C74D1' -derivedDataPath /private/tmp/flowlink90-build2-sim -resultBundlePath /private/tmp/flowlink90-build2-tests.xcresult -only-testing:FlowLinkTests -collect-test-diagnostics never test
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Release -destination 'generic/platform=iOS Simulator' -derivedDataPath /private/tmp/flowlink90-build2-release build
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink -configuration Release -destination 'platform=iOS,id=00008150-00181C513E30C01C' -derivedDataPath /private/tmp/flowlink90-build2-device build
codesign --verify --deep --strict --verbose=2 /private/tmp/flowlink90-build2-device/Build/Products/Release-iphoneos/FlowLink.app
```

Use this current **owner-operated, in-place** install command; do not uninstall/reset/re-pair:

```sh
xcrun devicectl device install app --device 00008150-00181C513E30C01C /private/tmp/flowlink90-build2-device/Build/Products/Release-iphoneos/FlowLink.app --timeout 60
```

Release / Version gate remains: Release impact Yes; Patch correction; candidate TBD after
v1.4.0; grouping FlowLink #85/#90, membership TBD; CHANGELOG already updated under Unreleased;
Finance Tracker SemVer bump deferred (all seven fields remain 1.4.0), independent FlowLink build
increment synchronized to 2; publication out of scope; owner acceptance Pending. #90 remains
Open / In Progress / P1. No staging/commit/push, deployment, backend/database or ingestion-flag
change; no production test or automatic installation.
