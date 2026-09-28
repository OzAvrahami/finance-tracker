# APY-03: Apple Wallet probe and Finance Tracker Shortcut

> Historical record: dated statements, commands, acceptance and production claims below describe their original checkpoint. They are not current operating status. See the [documentation index](../README.md) and linked GitHub evidence before use.

> **2026-09-26 direction/status update:** the owner superseded the complex
> user-authored Shortcut client with the native FlowLink initiative
> [#85](https://github.com/OzAvrahami/finance-tracker/issues/85). See the additive
> [native planning record](FLOWLINK_NATIVE_INGESTION_PLAN.md). The backend, security
> patterns, safe result envelope, tests and device evidence below remain useful;
> the global environment credential and single-card setup are transitional.
> Do not follow this historical guide to activate production. #81 remains
> Open / Verify / P1 with owner acceptance **Pending**; no Shortcut HTTP/E2E
> acceptance is implied.
>
> The owner reports Migration 036 applied with preflight and postflight 01-11/
> OVERALL PASS, schema-cache reload, unchanged canonical rows/totals and legacy
> backfill of 1 source / 1,531 observations / 0 events. Railway success at
> `98efa80f45b4d2006b2601a9e1fdd620b797a459` and non-posting health 200 / Apple
> 503 `apple_ingestion_disabled` were independently checked during planning.
> `APPLE_PAY_INGESTION_ENABLED` must remain false. Transitional credential/source
> environment configuration was owner-provisioned; its values were not inspected,
> and environment configuration does not establish database source registration.
> Earlier statements below about unapplied migration/undeployed code/unconfigured
> credentials describe the historical implementation handoff, not current state.
> No production change or SQL was performed in this planning update.

[#81](https://github.com/OzAvrahami/finance-tracker/issues/81), parent
[#78](https://github.com/OzAvrahami/finance-tracker/issues/78). Implements the thin
adapter over the accepted [APY contract](../architecture/APPLE_PAY_TRANSACTION_RECONCILIATION.md)
and [APY-02 foundation](../operations/APY_02_INGESTION_FOUNDATION.md), baseline
`2b01db85f11a509dc7dc2a4a36b9961483ac52ca`.

**Owner-device evidence:** iPhone 17 Pro Max, **iOS 27.0**, English Shortcuts UI.
Verified **Automation > Apps > Wallet**, **When [Card] is tapped**, specific-card
selection, and the **Transaction** Magic Variable. Its complete picker contains
exactly **Card or Pass**, **Merchant**, **Amount**, **Name**, with no further entries.

No separate Currency, purchase date/time, timestamp, timezone/offset, transaction ID,
event ID, provider reference, location or category is exposed. Do not invent them.

The owner has now performed one real contactless purchase and reported:

| Property | Original Shortcuts type | Notes serialization | Verified textual representation |
| --- | --- | --- | --- |
| Merchant | Exact native type not established | Inline text | `Israel Post` |
| Name | Exact native type not established | Inline text | `Israel Post` |
| Amount | **Unidentified** | `Attachment.txt` | `₪4.00` after opening the attachment |
| Card or Pass | **Unidentified** | `Attachment.txt` | Selected Wallet display label (not retained here) after opening the attachment |

Notes' attachment representation does not establish that Wallet returned a file or
raw string. Merchant and Name happened to agree for this purchase only. Empty-field
behavior and other purchases are not established by it. Final on-device coercion
to plain text, actual HTTP POST and Finance Tracker E2E acceptance remain **Pending**.

Migration 036 is in the repository, **not applied to production**. The endpoint is
not deployed; no production token/source is configured. Owner acceptance is Pending.
No CAL producer transition or review UI is included.

## Evidence: documented, suggested, observed

| Claim | Apple documentation | Community hint | Owner device |
| --- | --- | --- | --- |
| Wallet trigger / specific card | [Transaction trigger](https://support.apple.com/guide/shortcuts/transaction-trigger-apd65c67538a/ios) | Not needed | Trigger selection and one real contactless execution verified. |
| Automatic execution | [Add automations](https://support.apple.com/guide/shortcuts/add-automations-apdfbdbd7123/ios) | Not needed | Real trigger execution observed; no HTTP capture yet. |
| Variable properties and explicit conversion | [Adjust variables](https://support.apple.com/guide/shortcuts/adjust-variables-apda36b9018b/ios) | No assumptions adopted | Four property names verified; final plain-text conversion still Pending. |
| Card identity | [Apple Pay security](https://support.apple.com/en-us/101554) distinguishes device and physical account numbers | No last4 inference | Notes attachment renders the selected display label; native type remains unknown. |
| Amount / merchant representations | No complete payload schema inferred from docs | No community mapping adopted | Textual amount and merchant/name values above verified for one purchase only. |

## A. Remaining local-only conversion check

Use the same specific-card trigger. Before any production HTTP action is installed,
verify these native action steps locally with no credential:

1. Read **Transaction > Amount**. Add an explicit **Get Text from Input** action
   (or explicit Text content conversion in the variable editor) and pass that output
   into a **Text** action. Store its output as `AmountText`. Action labels and the
   conversion result must be confirmed on this iOS version; the Notes attachment is
   not proof that this action already works. Do not pass the original typed variable
   directly into a JSON Dictionary.
2. Inspect the resulting content type through the variable details/Get Type action
   where available. Display only the resulting plain text locally. It must be content
   such as `₪4.00`, not `Attachment.txt`, a file URL, dictionary or rich object.
   If conversion produces a filename/unsupported result, stop and report that exact
   safe result; do not read arbitrary files or strip unknown content to force it.
3. Explicitly convert **Transaction > Merchant** and **Transaction > Name** to plain
   text separately. Preserve their distinction. Select nonempty Merchant; only use
   Name when Merchant is empty/unavailable. If both are unusable, stop without POST.
4. Card or Pass is **not needed in the preferred production payload**. Any further
   inspection is setup/diagnostics only: type first, safe display detail only, never
   a full PAN/device number or raw object. No physical-last4 inference.
5. Verify the exact text parser and plain JSON recipe below locally. Report the safe
   text outputs and whether the Dictionary serializes amount/currency/merchant/date/
   UUID as strings. Final conversion and HTTP acceptance remain pending until actually
   performed. Notes and Quick Look were probe tools, not production dependencies.

## B. Finance Tracker Shortcut protocol and intended actions

**Final Wallet property mapping is Pending.** Configure actions only from the actual
probe results. The action sequence below is an implementation recipe, not a verified
device recording. Native action labels/availability must be checked on installed iOS.

```text
Selected Wallet-card trigger / Transaction
  -> capture local date once
  -> generate invocation UUID once
  -> read Merchant, Name, Amount
  -> explicitly convert typed values to plain text
  -> parse verified ILS symbol text to exact amount string + ILS
  -> prefer nonempty Merchant, otherwise Name; stop if neither usable
  -> build plain JSON (no Card or Pass in server-bound mode)
  -> POST /api/ingestion/apple-pay
  -> reuse identical saved payload/key for any transport retry
```

Use a native **Generate UUID** action if available and verify it on-device. If absent,
report that gap instead of substituting time/merchant/amount as identity. The UUID
belongs outside any Repeat/retry loop. Two independent invocations generate different
keys: this prevents duplicate **transport delivery of one invocation**, not two Wallet
automations independently firing for the same physical purchase. Do not claim the
latter can be deduplicated without durable provider evidence.

### HTTP request

`POST /api/ingestion/apple-pay`, `Content-Type: application/json`,
`Authorization: Bearer ftapy1_<dedicated random credential>`.
HTTPS is required for any non-loopback use. No token in URL/query/body. No browser
Origin is supported: this is a native Shortcut capability, not an owner browser API.

Synthetic example, with Finance Tracker API field names (not Wallet property names).
Here transaction_date is the explicitly labeled capture-date accounting fallback,
not a date supplied by Apple:

```json
{
  "amount": "4.00",
  "currency": "ILS",
  "merchant": "Israel Post",
  "transaction_date": "2026-09-22",
  "occurred_at": null,
  "provider_reference": null,
  "idempotency_key": "dc718c62-4023-4b80-880e-bcf065797c05"
}
```

| Field | Exact protocol rule |
| --- | --- |
| amount | Required positive decimal **string**, up to 28 whole digits and 2 fraction digits, e.g. `84.90`. JSON numbers, grouping separators, commas, exponents, zero, negatives and extra precision reject. The adapter also recognizes only the verified coerced text form `₪4.00` with currency=ILS and exactly two fraction digits; the production Shortcut should send normalized `4.00`. No FX conversion. |
| currency | Required literal `ILS`, based on verified exact accounting/purchase currency evidence. Do not hardcode it when Wallet currency is unknown or the purchase is foreign. |
| merchant | Preferred nonempty plain merchant text, maximum 512 Unicode characters. If missing/null/whitespace, optional name is used. Nonempty invalid merchant rejects rather than being masked. APY handles matching normalization. |
| name | Optional plain text, maximum 512 Unicode characters; fallback only when merchant is empty/unavailable. No concatenation. Invalid typed/file-like inputs reject even in unused fields. |
| payment_method | **Omit in preferred server-bound mode**; its presence (even null) rejects. Required only for retained legacy exact-label configuration. Never send Card or Pass objects/files. |
| idempotency_key | Required UUID string; preserve the complete payload and exact key across retries. It is independent of any Apple/provider reference. |
| transaction_date | Optional only if a timezone-qualified genuine occurred_at supplies the APY Asia/Jerusalem purchase date. Otherwise required `YYYY-MM-DD` accounting date: source date if available, or the explicit local capture-date fallback below for this Apple flow. Invalid calendar dates reject. |
| occurred_at | Optional/null. Actual source timestamp only: ISO date/time to minute, second or 1-6 fractional digits, with original offset/Z when known. Unqualified local time is retained only as non-comparable evidence and requires a separate purchase DATE. No added precision. |
| provider_reference | Optional/null, safe text 1-80 characters. Stored as unverified Apple Wallet evidence scoped to the registered instance, never retry identity or automatic reference-confirmation authority. |

Unknown fields reject. Callers cannot send source ID, canonical transaction ID,
movement type, category, metadata, charge date, review/cancel command or arbitrary
payment-source ID. Initial scope is simple **expense purchases**, not income/refunds.
Requests are capped at **8 KiB**; compressed bodies and non-JSON content reject.

### Exact text normalization and merchant choice

These are Finance Tracker protocol rules for **explicit textual coercion results**,
not a declaration that raw Wallet Amount is a string. On the Shortcut:

1. Require plain `AmountText` matching the **whole** verified format:
   `\A₪([0-9]{1,28})\.([0-9]{2})\z` using Match Text. Require exactly one whole-input
   match; no automatic removal of whitespace/bidi characters, grouping commas or
   unknown currency symbols. An unverified representation must stop safely.
2. Remove only the initial verified `₪` using Replace Text after validation. Keep
   the digits and decimal point as **Text**, e.g. `4.00`. Reject an all-zero amount.
   Set currency Text to `ILS` **because that verified symbol was recognized**, not
   because every Wallet purchase is presumed ILS. No Calculate/Number rounding or FX.
3. The adapter defensively accepts the same exact symbol-prefixed text, normalizes
   with integer minor units, and still requires currency `ILS`. Plain decimal-string
   requests remain supported. Conflicting currency, unknown symbols, objects, arrays,
   filenames and binary/rich inputs reject; there is no implicit stringification.
4. Select plain nonempty Merchant, otherwise plain nonempty Name. Both unusable means
   rejection/stop, not a fabricated description. The API's optional `name` implements
   the same fallback if needed, but the normal Shortcut sends the chosen `merchant`.
   Preserve the original selected text; do not concatenate or assume aliases.

Match Text/Replace Text and the actual coercion output must be checked on the owner's
device before HTTP capture. These instructions define the intended parser; automated
fixtures validate the server equivalent and do not prove Shortcut execution.

| Finance Tracker field | Verified source / producer | Proposed final mapping |
| --- | --- | --- |
| amount | Amount renders as `₪4.00` in Notes attachment; native type unknown | Explicit text conversion, strict verified-symbol parsing -> `4.00` Text |
| currency | Verified `₪` in coerced textual representation | `ILS` only after successful recognition; no separate Wallet property |
| merchant | Merchant and Name each rendered `Israel Post` once | Prefer nonempty Merchant, then Name; final on-device conversion Pending |
| payment_method | Server configuration | Omit; Card or Pass is setup/diagnostics only |
| occurred_at | No source property exposed | null |
| provider_reference | No source property exposed | null |
| transaction_date | Local capture date, frozen once | Accounting fallback, not provider date/time |
| idempotency_key | One invocation UUID | Preserve exact payload/key across retries; independent invocations not deduplicated by this key |

### Explicit capture-date accounting fallback

The owner authorized this narrow policy after inspecting iOS 27.0's complete picker.
The server already accepts an explicit valid DATE with no occurred_at/provider ID;
it does not require a Wallet-provided date. No date-handling or schema change is needed.

For this flow, run **Current Date once near the start of the automation**, save it
as `CaptureStartedAt`, then **Format Date** with [custom calendar format](https://support.apple.com/guide/shortcuts/custom-date-formats-apd8d9b19184/ios)
`yyyy-MM-dd` in the user's current local timezone. Save that text as `CaptureDate`
and send it as `transaction_date`. Verify the formatter's output against the phone's
local calendar date, including its timezone/calendar settings. Do not format UTC
and truncate it, recalculate on retry, or derive a date from server receipt time.
This local variable records execution time; **do not send it as occurred_at**.
No capture timestamp is added to the API. Keep occurred_at/provider_reference null.

The supplied DATE is the canonical accounting day and APY observation matching date,
**not proof of the provider's purchase date**. APY stores it in its existing date
fields; there is no new per-observation date-origin field. Its fallback origin is
explicit in this adapter policy/Shortcut mapping. The server cannot attest when the
Shortcut actually executed. observed_at remains independently server-controlled;
charge_date remains the foundation's provisional accounting-date default, not an
actual settlement claim. No source timestamp, offset or precision is manufactured.

Preserve the exact saved DATE, payload and UUID across transport retries, including
next-day resubmission. For example, capture at 00:02 local on September 23 must send
September 23 even if UTC still shows September 22. A payment at 23:59 with delayed
execution at 00:02 may be recorded on the next accounting day. The fallback cannot
detect that discrepancy: if delay, offline execution, travel or timezone change
makes the date known to be wrong, stop automatic submission and review/correct the
accounting date explicitly; never fabricate source time to compensate. After an
accepted capture, do not change its date under the same retry key: use the existing
owner correction flow. Same-key changed evidence conflicts by design.

Adjacent-day CAL date-only evidence remains review-only under APY; do not widen
matching or automatically move accounting dates. Normal ambiguity still creates
no avoidable second financial transaction. This policy authorizes neither a CAL
adapter nor production activation.

### Responses and retries

Accepted protocol responses contain only:

```json
{
  "outcome": "created",
  "original_outcome": null,
  "observation_id": "12",
  "transaction_id": "581",
  "disposition": "created",
  "review_required": false,
  "reason_code": "no_candidate",
  "replayed": false,
  "decision_revision": "1"
}
```

IDs/revision are strings or null. No competing IDs, source internals, payload, stack
trace or secrets are returned. Errors retain this envelope with null IDs. Use the
`disposition` on replay: a cancelled original is not a newly active purchase.

| HTTP | Outcome / action |
| --- | --- |
| 201 | created: one live expense immediately; no CAL wait. |
| 200 | reconciled or already_observed: no additional financial row. |
| 202 | ambiguous: observation pending; existing plausible cash remains, no extra cash. Record review required; do not generate another UUID to force posting. |
| 409 | conflict: preserve existing cash; owner review/correction required. Do not rotate the key to bypass it. |
| 400 / 422 | rejected syntax / unsupported accounting or unsafe mapping. Correct the unsupported setup/input; do not treat as a successful capture. |
| 401 / 403 | authentication failure / browser Origin forbidden. Stop and inspect local setup without printing credentials. |
| 413 / 415 | body too large / unsupported content or compression. |
| 429 | stop the loop; respect Retry-After before retrying the same payload/key. |
| 503 | disabled, configuration/source unavailable or uncertain transient delivery. Retry only after backoff or correcting setup, using the original payload/key. No success is implied. |

Use **Get Contents of URL** with POST, the two headers above and a JSON Dictionary.
Keep amount as Text. Read dictionary `outcome` and `review_required` where the native
action exposes the response. For transient transport/503 failures, a small bounded
retry (for example at most 3 attempts with 2/5/10-second waits) must reuse the same
saved Dictionary and CaptureKey; 429 takes its longer Retry-After. Do not loop on
validation/auth/conflict or pending review.

Some native action/iOS versions may stop on non-2xx or network errors instead of
allowing the next If action. **This behavior is Pending device verification.** If a
native retry loop cannot handle it, use a separate resubmission Shortcut that loads
the previously saved payload from **On My iPhone**, adds the current credential and
sends it unchanged. It must not execute Generate UUID. Never save the credential in
the payload file. Remove successful files when no longer needed; keep pending/error
records until explicitly resolved. A lost response remains safe when resent with
the same key. Without local durable payload storage, a fresh rerun is not guaranteed
to be the same event; do not claim restart-safe capture from an in-memory UUID alone.

### Server-controlled single-card binding (preferred)

One dedicated credential (plus its rotation overlap) selects one configured Apple
source instance. `APPLE_PAY_SOURCE_CONFIG.payment_source_id` binds that source to
exactly one Finance Tracker payment source. The Shortcut is configured for one
selected Wallet card. It sends **no card label/last4/payment_source_id**.

The adapter supplies the stable internal alias `apple-shortcut-selected-card` to the
existing APY mapping RPC. It is explicitly server protocol evidence, not a fabricated
Wallet property. Configuration maps that alias to the one chosen ID; the database
validates it atomically. No first-match behavior or physical-last4 inference occurs.
Client payment_method (even null), payment_source_id and source_id cannot override it.

Owner setup must explicitly verify selected-card-to-Finance-Tracker correspondence.
Future different cards need independent source/credential configuration; a client
must not select among cards using a shared bound token. Multi-credential routing is
not implemented here. Rotation preserves source identity and the binding.

Existing explicit `card_mappings` mode remains available for compatibility with the
original APY-03 adapter/tests. In that mode only, exact safe payment_method text is
required; missing/ambiguous mappings still fail. The two configuration modes are
mutually exclusive. For this owner's production Shortcut, use the bound mode.

Any later binding correction requires a new configuration receipt and expected
revision; accepted retries retain their original mapping/financial outcome. Changing
the actual producer/card is a new source decision, not silently repurposing history.
No source or credential has been registered in production during this work.

## Server configuration and later authorized activation

See [server/.env.example](../../server/.env.example). All settings are opt-in, and no
real values were provisioned during APY-03:

| Variable | Purpose |
| --- | --- |
| APPLE_PAY_INGESTION_ENABLED | Only exact `true` enables requests; absent/false returns 503 before writes. |
| APPLE_PAY_TOKEN_SHA256 | SHA-256 hex digest of the full dedicated versioned token. Never a Supabase, owner, v1 or job credential. |
| APPLE_PAY_PREVIOUS_TOKEN_SHA256 | Optional short overlap during rotation; remove it to revoke the old credential. |
| APPLE_PAY_SOURCE_CONFIG | Bounded JSON source registration/mapping command described below, no secrets. |

Credential format: `ftapy1_` followed by base64url for 32 cryptographically random
bytes. Future separately authorized issuance can use Node `crypto.randomBytes(32)`;
retain the token securely for the Shortcut and only its SHA-256 digest on the server.
No real production credential has been generated/installed here. Never put token
values in Git, screenshots, URLs, application logs or shared Shortcut exports.
Shortcuts credential storage/sync is not a hardware secret vault; review who can
access the phone, Apple Account and shared shortcuts before later activation.

Rotate by setting a new current digest and temporarily retaining the old digest as
previous, updating the Shortcut securely, then removing the previous digest.
Keep the same logical source instance and bootstrap receipt during token rotation:
credential changes do not change observation identity. Setting enabled=false disables
the route immediately on the next request with that configuration; a production
environment change/restart itself still requires separate authorization. A privileged
source revocation via the existing APY configure RPC is also honored on every ingest,
even after the adapter cached its source ID. Retain provenance when disabling.

Synthetic source configuration (IDs/UUID replaced only during authorized setup):

```json
{
  "instance_key": "owner-iphone",
  "request_key": "d0904939-c065-4c19-bc94-431a83e3ea57",
  "payment_source_id": "1",
  "time_verified": false
}
```

The server forces source_kind=apple_pay and allowed payment-source IDs derived from
the one bound ID (or legacy explicit mappings). No request can supply a source
instance. Config allows 16 KiB, BIGINT IDs as strings and at most 32 mappings in
legacy mode; no card label is needed in bound mode.
Leave time_verified=false until actual timestamp/precision/zone evidence is verified.
Provider references are unverified and no aliases are learned by this adapter.

On the first **authenticated valid capture**, bootstrap invokes APY-02's
`configure_ingestion_source` with the stable configuration request UUID; successful
setup is cached per router/configuration. Restart repeats that same idempotent receipt,
not a new namespace or new source. Failed setup is not cached. Existing disabled
source state is never silently reactivated by replaying the old setup receipt.
For a deliberate configuration update, supply a **new request_key** plus
`expected_revision` as the current source revision string. A stale revision/conflicting
receipt fails closed. Treat configuration as a complete replacement; coordinate any
later APY-04 alias/mapping work rather than overwriting it accidentally.

No new migration is needed. Production source registration is a later authorized
operational step: after migration/deployment approval, register the reviewed command
with the existing private RPC or allow the explicitly enabled adapter's first valid
capture to bootstrap it. Do not enable configuration as an implicit migration step.
Missing migration/RPC results in sanitized 503, not a fallback legacy INSERT.

### Request security and diagnostics

The route mounts before general Morgan logging, the 2 MiB parser and owner JWT. It
retains Helmet/compression, but owns its 8 KiB JSON parser, credential auth and safe
logs. It rejects browser Origins and query parameters; it does not relax existing
owner/v1/job authentication or CORS. Other paths under this mount return 404 and
cannot invoke review/cancellation/admin commands. No source credentials reach the DB.

There is a pre-auth IP ceiling of **120 requests / 15 minutes** and a post-auth
adapter ceiling of **60 / 15 minutes**, counting retries and both rotating tokens.
This permits a burst of human purchases with bounded retries while stopping loops.
Both return 429/Retry-After. Existing one-proxy trust configuration is retained.
Limits use the existing express-rate-limit in-memory store: per process, reset on
restart, not a distributed/global quota. Before multi-replica deployment, coordinate
a shared store/proxy policy if a global ceiling is required; no such rollout was done.

Structured logs contain event/source kind, HTTP status, safe outcome/reason, safe
observation/transaction IDs and duration only. No headers, token, full payload,
merchant/card text or query URLs. Upstream hosting/access-log redaction must also
be checked during a later deployment; repository logging cannot prove host behavior.

## Local verification and production boundary

From repository root, with Docker Desktop running:

```powershell
node --test server/test/applePay.test.js
node --test server/test/applePayPostgres.local.test.js
npm test --prefix server
node --test server/test/transactionIngestionPostgres.local.test.js
node server/test/run-savings-release.cjs
git diff --check
```

The HTTP suite runs real Express requests on loopback with synthetic tokens and
injected transport. The PostgreSQL suite sends actual HTTP requests through the
adapter/shared service to real RPCs using psql transport in a labeled, portless
PostgreSQL 16 Alpine container with the complete schema through 036. It reads no
private .env/production URL. CAL fixtures seed foundation observations, not a CAL
producer implementation. Tests remove their own disposable containers.

No frontend/schema/shared legacy API behavior changes are intended. The accepted
APY-02 client evidence remains 544 passes / 4 baseline Import portal-query failures;
these client tests/build were not rerun for this server-only adapter. No claim that
those unrelated tests were fixed. No synthetic preview was created.

Initial implementation results (2026-09-23), retained as prior evidence:

| Check | Result |
| --- | --- |
| Focused Apple unit/HTTP suite | 16/16 passed (also included in the complete server run) |
| Complete server/API suite | 371/371 passed, zero skipped |
| Apple HTTP + disposable PostgreSQL integration | 12/12 passed, complete schema through 036 |
| Existing APY-02 disposable PostgreSQL suite | 31/31 passed |
| Selected Savings release regressions | 39/39 passed: manual 9, interest 9, monthly 8, surplus 8, reporting 5; unselected historical assertions are excluded, not passes |

Prior picker-only follow-up: server runtime/schema were unchanged. Re-ran the focused
unit/HTTP suite: **16/16 passed**. Added one real PostgreSQL HTTP regression for the
explicit capture-date fallback: local accounting DATE retained with null source
time/precision/provider reference, independently recorded observed_at, unchanged
receipt on replay, conflict on retry with recomputed next-day DATE, and adjacent-day
date-only card evidence pending with zero extra cash. This uses synthetic requests,
not an executed Shortcut. The updated PostgreSQL suite passed **13/13**; the full
server/APY-02/Savings/client evidence above is reused,
not claimed as rerun for this documentation/policy clarification.

The database scenarios cover immediate cash, attachment, CAL-first ambiguity with
zero extra cash, same-key conflict/replay, lost-response retry, concurrent HTTP
delivery, separate equal purchases, cancellation/user-edit protection, exact card
mapping, optional time evidence, rotation/revocation and bootstrap across restart.
These are synthetic inputs against real local persistence, **not Wallet device or
production evidence**. Existing APY-02 tests also retain cross-source race coverage.

Real-runtime-evidence follow-up (same worktree, accepted base preserved):

| Check | Current result |
| --- | --- |
| Focused Apple unit/HTTP tests, included in complete server run | 20/20 passed |
| `npm test --prefix server` | 375/375 passed, zero skipped |
| `node --test server/test/applePayPostgres.local.test.js` | 14/14 passed through schema 036 |

New cases exercise **coerced text fixtures**, not raw Wallet strings: exact ILS text,
unsupported currency/typed/file inputs, Merchant precedence/Name fallback, mutually
exclusive single-card configuration, credential rejection and client override
prevention. Real PostgreSQL verifies the bound payment-source ID, cash amount,
null time/provider evidence, replay/conflict, independent invocation and restart.
An initial database attempt could not start because Docker Desktop was stopped;
after restarting the local engine, all 14 cases passed. No production access occurred.
The existing APY-02/Savings/client results above remain prior evidence; those suites
were not unnecessarily repeated for adapter-only changes.

| Production/device state | This handoff |
| --- | --- |
| Migration 036 in repository | Yes, unchanged |
| Migration 036 applied to production | No |
| Apple route in repository | Yes |
| Apple route deployed to production | No |
| Production Shortcut secret configured | No |
| Production Wallet source registered | No |
| Owner picker probe | Verified: device/iOS/trigger/four property names only |
| Real contactless runtime probe | Verified one purchase; Notes serialization/text only |
| Native Amount / Card or Pass types | Unidentified |
| Final on-device plain-text conversion | Pending |
| Final on-device API mapping / HTTP POST | Pending |
| Real end-to-end Finance Tracker capture | Not performed |

## Release / Version gate

- Release impact: **Yes**, opt-in secure Apple source adapter.
- SemVer impact: **Minor**, backward-compatible grouped APY capability.
- Candidate release: **proposed v1.4.0**, APY-06 revalidation required.
- Grouping / included release candidate: **#78 / #79-84 (APY-01-06)**.
- CHANGELOG status: **Updated under Unreleased**, #81 entry; no 1.4.0 section.
- Version-bump status: **Deferred to APY-06** coordinated preparation; seven fields remain **1.3.1**.
- Publication status: **Out of scope**.
- Owner verification / acceptance status: **Pending**, including final text conversion, HTTP capture and E2E acceptance.
- Production migration/deployment/configuration: **Not performed; separately authorized**.

Keep #81 Open / Verify / P1 after code verification. Do not mark the actual-device
criteria complete or begin #82/APY-04 as part of this handoff.
