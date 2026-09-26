# FlowLink native Wallet ingestion: planning decision

> **FLI-01 follow-up, 2026-09-26:** the implementation-ready
> [native ingestion contract](FLOWLINK_NATIVE_INGESTION_CONTRACT.md) now defines
> the owner gate, pairing, device/binding APIs and atomic APY authorization for
> owner review. #86 acceptance remains Pending. The original planning record below
> is preserved as history; it does not authorize downstream implementation.

Date: 2026-09-26. **Planning only; FLI-01 has not started.** FlowLink is a working
name, not a branding project. The owner selected a native companion to replace the
complex user-authored APY-03 Shortcut client. This record defines the work to review
under FLI-01; it does not approve a final API/schema or authorize implementation.

## Verified baseline and evidence boundaries

Local and remote main: `98efa80f45b4d2006b2601a9e1fdd620b797a459`, initially clean.
Latest published stable release: [v1.3.1](https://github.com/OzAvrahami/finance-tracker/releases/tag/v1.3.1).
All seven authoritative package/lockfile version fields remain 1.3.1. Unreleased
contains the existing APY-02/#80 and APY-03/#81 entries. Historical release-preparation
wording does not override published release evidence.

The owner reports production Migration 036 preflight PASS, postflight 01-11 and
OVERALL PASS, schema-cache reload, unchanged canonical rows/totals, and backfill of
one legacy_api source, 1,531 legacy observations and zero reconciliation events.
These database results were **not rerun** in this planning task. GitHub deployment
records independently show Railway success for the baseline SHA. Non-posting HTTP
checks returned health 200/OK and Apple endpoint 503/apple_ingestion_disabled.

The transitional Apple credential/source environment configuration was provisioned
by the owner; no values were read. Environment configuration is not proof that an
Apple source was registered in the database. `APPLE_PAY_INGESTION_ENABLED` must remain
false. No production SQL, configuration change, secret change or deployment is
authorized here. Source configuration and credentials are not the final native model.

## Repository audit

| Surface | Actual implementation and implication |
| --- | --- |
| [Owner/session middleware](../server/middleware/auth.js), [client auth](../client/src/context/AuthContext.jsx) | Supabase `getUser(token)` establishes a user; the client exposes sign-in and sign-up. There is no owner/admin-role check or tenant boundary in this middleware. A valid user JWT alone must not authorize device enrollment. |
| [Server mounts](../server/index.js) | Ordinary APIs use requireAuth with a privileged server Supabase client. Apple, external-v1 and scheduler routes have distinct earlier trust boundaries. Preserve these boundaries. |
| [External API auth](../server/middleware/apiKeyAuth.js) | One EXTERNAL_API_KEY; not a device credential or an enrollment authority. Never distribute it to FlowLink. |
| [Apple config](../server/config/applePay.js), [route](../server/routes/applePayRoutes.js), [adapter](../server/services/applePayIngestionService.js) | Disabled-by-default route, digest verification, bounded JSON, throttling, safe result projection, exact amount and Merchant/Name rules are reusable. Environment-wide current/previous token hashes and one selected-card configuration are transitional. Bound-mode requests reject client payment_method/source/payment IDs. Native multi-device support needs a new scoped adapter/auth boundary, not an undocumented reinterpretation of this request. |
| [Shared service](../server/services/transactionIngestionService.js), [036](../server/migrations/036_transaction_ingestion_foundation.sql) | Existing sources/observations/events and atomic private RPCs remain authoritative. Source identity is separate from credentials; unique source+idempotency key and immutable accepted evidence already exist. Commands lock transactions before source rows; new authorization/lifecycle commands must honor this ordering. |
| [Payment-source settings](../server/routes/settingsRoutes.js), [controller](../server/controllers/settingsController.js), [transaction routes](../server/routes/transactionRoutes.js) | GET /api/settings/payment-sources returns all rows; GET /api/transactions/payment-sources returns active rows. Both are behind ordinary user auth, not device/owner-specific authorization. Reuse the schema and owner-facing selection logic only behind the new explicit owner gate; do not expose these broad APIs to device credentials. |
| payment_sources | BIGINT id, name, method, owner display text, unique slug, is_active, issuer, optional non-unique last4. The owner text is not an authorization principal. |
| [APY tests](../server/test/applePay.test.js), [HTTP/PostgreSQL tests](../server/test/applePayPostgres.local.test.js), [foundation tests](../server/test/transactionIngestionPostgres.local.test.js) | Existing evidence covers exact money, request escalation, retries/races, ambiguity, date fallback, cancellation, overrides and private grants. Device/binding isolation is new future test work; those tests do not establish native Wallet interoperability. |
| Root/client/server/docs | Existing web/backend monorepo; no existing iOS/Xcode/Swift project or device/pairing credential model found. No new runtime artifacts are created here. |
| [.gitignore](../.gitignore) | Generic build and macOS exclusions exist, but dedicated Xcode user-state/DerivedData handling is absent. FLI-04 must add narrow exclusions and preserve shared project/scheme files. No ignore changes in this planning run. |

## Scope and monorepo

Use Swift, SwiftUI, App Intents/App Shortcuts, Keychain and native networking in
`ios/FlowLink/` within this same Git repository. Future layout:

```text
ios/FlowLink/
  FlowLink.xcodeproj
  FlowLink/
  FlowLinkTests/
  FlowLinkUITests/
```

Windows checkout: `D:\code\finance-tracker`. Mac checkout:
`/Users/ozavrahami/code/finance-tracker`. No separate repository, nested .git, Xcode
project, Swift source or build/signing assets are created now. Initial work targets
local development/device builds on a Mac; Windows inspection is not an Xcode build.

The app is an ingestion companion, not a full Finance Tracker client. Retain Hebrew
and RTL usability where relevant. Native UI may show connection and capture status;
notification delivery is out of scope. Notifications/#52 and Multi-user/#63 are
context, not blockers. Notifications/APNs/local notifications and distribution
(App Store, Unlisted, TestFlight, certificates/provisioning automation) are deferred.
Do not add speculative notification fields, endpoints or permissions.

## Proposed security and identity direction for FLI-01

```text
owner-authorized pairing -> installed device -> device credential in Keychain
                                      |
                                      +-> opaque card binding A -> payment source X
                                      +-> opaque card binding B -> payment source Y

Wallet personal automation -> FlowLink App Intent(binding, Merchant, Name, Amount)
 -> native normalization + frozen capture receipt
 -> device-authenticated backend adapter
 -> authorized binding -> registered apple_pay APY source
 -> transactionIngestionService -> atomic APY decision -> canonical transactions
```

**Enrollment recommendation:** use the existing owner web session, plus a new narrow
server-side authorization check against explicitly configured approved Supabase user
IDs, to issue a short-lived, single-use, high-entropy pairing capability. No implicit
"first signed-in user is owner", email/display-name inference or public registration.
The configured authority must be fail-closed and separately provisioned by the owner
in later authorized operations; no real identity/config value is selected now.
This targeted gate avoids claiming that the unimplemented Multi-user initiative
already supplies roles. It does not retrofit tenant isolation across the application.

The phone redeems that capability over HTTPS; possession of a valid owner-issued
capability is required even if the exchange has no user JWT. Reject missing/expired/
consumed capabilities, rate-limit guesses and atomically serialize redemption. Use
bounded request bodies and redact pairing material from logs/URLs. No reusable owner,
service-role, bootstrap or admin credential enters the phone or automation.

Each installation gets a cryptographically random, narrowly scoped credential;
server persistence contains only a one-way digest and non-secret credential identity/
lifecycle fields. Store the plaintext in device-local, non-synchronizing Keychain.
Rotation/revocation affects only that device; rotating a token does not rename APY
sources. Device labels are presentation, not authorization. A spouse device can be
approved by the owner for the current shared Finance Tracker dataset without being
given the owner session. This is not a claim of multi-tenant access isolation.

FLI-01 must specify exact issuance/redemption and lost-response recovery (including
whether a Keychain-first client-generated credential simplifies digest-only replay),
pairing expiration/attempt bounds, credential format/version and rotation overlap.
It must define reinstall/recovery behavior: local Keychain survival after uninstall
must not silently enroll a different installation or migrate identity to another
phone. Do not promise remote wipe of a compromised phone.

Keychain accessibility must balance background App Intent execution and device lock
state without weakening per-device isolation. Candidate device-only accessibility
must be verified on hardware, including before first unlock; failure must preserve
pending capture safely, not put a token in Shortcut parameters or request an owner
password. No claim of unlimited iOS background execution or guaranteed retry timing.

**Bindings:** use an opaque client-visible binding ID, owned by one device, with one
server-selected active payment_source_id and one stable APY source link. The phone
may list only its approved bindings and safe display/status information. An owner-only
web management surface selects payment sources and approves/revokes bindings; device
credentials cannot grant themselves new sources. App binding management displays and
selects approved bindings and directs authorization changes through the owner flow.
Do not expose broad payment-source APIs to a device or trust an arbitrary submitted
payment_source_id. Every request checks device, credential, binding and source state.

Proposed APY mapping: `source_kind=apple_pay`, stable `instance_key=flowlink:<binding UUID>`
(exact naming finalized in FLI-01), server-stored source ID, allowlist containing only
the binding's payment source. Each binding belongs to exactly one device. Register
through configure_ingestion_source with audited configuration receipts/revisions;
do not copy the transitional APPLE_PAY_SOURCE_CONFIG into this model. Credential
rotation and app updates retain the binding/source. Disabling preserves observations.
Changing the actual card/payment source should retire the old binding and create a
new one; pending retries keep their original binding and must not be silently remapped.

The owner's reported Debit 2755 -> payment_source_id 6 is one setup observation,
not a default, fixture mandate or matching rule. Never infer mappings from merchant,
amount, Wallet label, physical/device last4 or first-match selection.

**Future backend ownership:** FLI-02 owns enrollment/device credential primitives and
owner authorization. FLI-03 owns bindings, owner binding administration, safe device
listing and the device-authenticated ingestion adapter/API bridge. FLI-05 consumes
that bridge. No backend adapter is left implicit inside the Swift issue.

FLI-01 must define private atomic authorization around the existing ingestion command
so device/binding revocation cannot race between a stale middleware check and a money
write. A narrow service/private-command wrapper may be needed; it must reuse the APY
normalization/matching/accounting command and preserve its transactions-first lock
order. No parallel ledger or independent matching algorithm. New additive security
relations/migrations belong to later implementation; never edit applied 036 in place.
No PUBLIC/browser mutation of device credentials or APY tables; service-role stays
server-side. Device access must not include review/cancellation/admin or other devices.

## Native input, capture and retry boundary

Owner evidence: iPhone 17 Pro Max, iOS 27.0, English Shortcuts, Apps > Wallet selected
card trigger and Transaction with exactly Card or Pass, Merchant, Amount and Name.
One contactless purchase rendered Merchant and Name as Israel Post; Amount and Card
or Pass became Notes attachments, with amount text `₪4.00` and a card display label.
The original Amount/Card or Pass types remain unidentified. No separate currency,
date/time/offset/event/provider identifier was exposed. No community example upgrades
this evidence. Native App Intent parameter interoperability remains a real-device gate.

User setup is one manual personal automation per device/card: selected-card Wallet
trigger -> FlowLink: Record Wallet Transaction -> choose an approved binding and map
the small set of transaction inputs -> enable. App Shortcuts expose the action; they
do not create the personal automation. Use only supported public APIs.

FlowLink owns typed-value conversion, exact money validation, Merchant then Name
fallback, request serialization, Keychain auth, native HTTP and retry receipts. Initial
supported posting is a positive exact ILS expense. Recognize the verified shekel text
only after supported conversion; unknown/foreign/ambiguous values fail safely, without
FX or binary-float identity. Merchant and Name are not assumed always equal/populated.
Never send rich/file/Attachment.txt content as a scalar or fabricate a merchant.

FLI-05 must prove whether Wallet Amount can bind directly to a supported App Intent
parameter, or whether a minimal declarative Text conversion is needed. A raw String
parameter is not assumed valid. If reliable conversion requires the rejected complex
Shortcut logic, stop that path and return the device evidence to the owner; do not
reintroduce regex/JSON/auth/networking into the user-authored automation silently.

Capture the local calendar date once when the intent executes; freeze transaction_date
in the native capture receipt. It is an accounting capture-date fallback, not source
purchase time. occurred_at and provider_reference remain absent/null; observed_at
remains server receipt time. Midnight, delayed execution and travel can require owner
correction. Never manufacture source time or recompute the date on a retry.

Generate one invocation UUID once and persist the exact normalized payload, binding,
date and key before first transmission in protected, bounded local storage. App
termination, timeout or a lost successful response must not regenerate it. Token
rotation can change authentication without changing the receipt; binding changes
must not redirect queued captures. Credential is read from Keychain at transmission,
not embedded in the queued payload. Define retention/recovery and explicit safe retry
in FLI-01; no unbounded background execution promise. No notifications are required.

Independent invocations/devices can represent equal real purchases. A coarse amount/
merchant/date/card signature is never event identity. Existing APY auto-reconciliation
is apple_pay <-> cal only; it does not deduplicate two independent Apple automations
or reconcile legacy imports. Do not introduce Apple-to-Apple fuzzy merging. Avoid two
active automations for the same device/card; test repeated legitimate purchases and
duplicate invocation limitations explicitly. CAL remains broader coverage, with its
producer transition owned by #82 and not started here.

Server outcomes remain created/reconciled/already_observed/ambiguous/conflict/rejected.
New unrepresented activity creates live cash immediately; sufficiently strong existing
evidence attaches with zero extra cash; ambiguous plausible candidates remain pending
with zero avoidable new cash. Preserve user edits, void history, legacy external_id
compatibility and all Savings/Loan/domain invariants. Safe device responses disclose
only its receipt, not competing candidates, arbitrary provenance or financial lists.

## Work breakdown, boundaries and release

FLI parent [#85](https://github.com/OzAvrahami/finance-tracker/issues/85) and its native
sub-issues all start Backlog/P1:

| Code | Issue | Work |
| --- | --- | --- |
| FLI-01 | [#86](https://github.com/OzAvrahami/finance-tracker/issues/86) | Architecture and native ingestion contract |
| FLI-02 | [#87](https://github.com/OzAvrahami/finance-tracker/issues/87) | Device enrollment and credential foundation |
| FLI-03 | [#88](https://github.com/OzAvrahami/finance-tracker/issues/88) | Multi-card device bindings and native backend adapter |
| FLI-04 | [#89](https://github.com/OzAvrahami/finance-tracker/issues/89) | FlowLink iOS application foundation |
| FLI-05 | [#90](https://github.com/OzAvrahami/finance-tracker/issues/90) | Wallet App Intent ingestion |
| FLI-06 | [#91](https://github.com/OzAvrahami/finance-tracker/issues/91) | Native Wallet ingestion end-to-end verification |

FLI-01 defines and obtains review of the contract; no implementation starts in this run.
FLI-02 is blocked by 01; 03 by 01/02; 04 by 01/02; 05 by 03/04; 06 by 05.
FLI-04 may build its binding UI against the reviewed contract; real FLI-03 integration
is verified under 05/06. FLI-06 includes two-device/card isolation and revocation tests,
owner-device evidence, controlled production enablement decision and recovery, with
separate authorization required for production or spouse data.

Keep #81 Open/Verify/P1 and acceptance Pending. Its backend/tests remain useful; its
complex Shortcut UX and global environment credential/card model are superseded for
the long-term client. Preserve the original evidence and add a dated supersession
note. Keep #79/#80 closed/accepted. Keep #82's native blockers (#80/#81) unchanged;
FLI completion informs the pending #81 acceptance/transition decision, not automatic
acceptance. Reassess #82 only with owner review if its prerequisite semantics change.
#83/#84 retain their existing graph. Do not make notifications or distribution blockers.

The native addition can remain backward compatible: proposed Finance Tracker Minor
v1.4.0, still coordinated with APY parent #78 and revalidated by #84. FLI is a work
parent, not a duplicate release tracker. Preserve the disabled transitional endpoint
contract unless a separately reviewed retirement changes that compatibility assessment.
FlowLink's CFBundleShortVersionString/CFBundleVersion are independent (e.g. 0.1.0 / 1).
FLI-04 should document these separate fields when introduced; do not synchronize them
to the seven backend/web version fields. No versions or CHANGELOG change during planning.

Planning gate: Release impact No; SemVer None independently; candidate Not applicable
for this document; grouping FLI with APY #78; CHANGELOG Not applicable; version bump
Not applicable; publication Out of scope; owner acceptance Pending planning review.
Future runtime children have Yes/Minor proposed v1.4.0; Unreleased updates during
implementation; coordinated backend version preparation deferred to #84; publication
and production operations require separate authorization.

## Apple references and remaining contract work

- [App Shortcuts availability](https://developer.apple.com/design/human-interface-guidelines/app-shortcuts): installed app actions exposed through App Intents/App Shortcuts. This does not establish Wallet Amount parameter compatibility.
- [Shortcuts variable conversion](https://support.apple.com/guide/shortcuts/adjust-variables-apda36b9018b/ios): content-type/property selection, not proof of a particular runtime Amount type.
- [Keychain accessibility](https://developer.apple.com/documentation/security/restricting-keychain-item-accessibility): FLI-01/05 must verify the selected policy and execution conditions on-device.
- [Device-only Keychain availability](https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlockthisdeviceonly): access after first unlock is a possible background-use policy, not an already-selected/tested setting.

FLI-01 must finalize endpoint/request schemas, enrollment recovery, owner authority,
device/binding lifecycle, APY wrapper lock/revocation semantics, Keychain/receipt
protection, App Intent parameter experiment and acceptance matrix before runtime work.
This planning record neither completes FLI-01 nor authorizes FLI-02 implementation.
