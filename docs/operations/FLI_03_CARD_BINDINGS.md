# FLI-03 multi-card bindings and authorized ingestion

> Contract/technical reference. Dated implementation and verification notes are historical checkpoints; use the [documentation index](../README.md) for current release/acceptance boundaries and GitHub for live workflow state.

Implementation for [#88](https://github.com/OzAvrahami/finance-tracker/issues/88),
following the accepted [native contract](../architecture/FLOWLINK_NATIVE_INGESTION_CONTRACT.md).
This builds on committed [FLI-02](FLI_02_DEVICE_ENROLLMENT.md), accepted by the owner
on 2026-09-26. The native iOS client and actual Wallet interoperability remain #89/#90;
this is a backend bridge and existing-web owner panel, not a user-ready Wallet client.

## Identity and migration

[038_flowlink_card_bindings.sql](../../server/migrations/038_flowlink_card_bindings.sql)
is additive after 037. Applied/committed 036 and 037 are unchanged. Its SQL is also
appended verbatim to [full_schema.sql](../../server/full_schema.sql).

- `flowlink_card_bindings`: immutable UUID/device/payment/source identity; label,
  active/disabled/retired status, positive revision, owner audit and timestamps.
  One non-retired mapping per device/payment source; many cards per device and
  separate bindings for the same payment source on different devices are allowed.
- `flowlink_binding_commands`: append-only UUID command receipt, verified actor,
  operation, 32-byte command hash and strictly projected owner snapshot (max 4 KiB).
  No credentials, raw requests or financial observations are stored here.

RLS is enabled with no browser policies. PUBLIC, anon, authenticated and service_role
have no direct table access. Six SECURITY DEFINER RPCs are executable only by
service_role; validation/projection/guard helpers remain private. Search paths are
pinned and tables qualified. Guards forbid identity changes, hard deletion, terminal
retirement reversal and receipt edits/deletion. Foreign keys use RESTRICT; indexes
support device/status/history, scoped mapping uniqueness and command history.

### Owner command semantics

Creation explicitly validates the owner-selected active payment source and active
device; no card-label/last4 inference or fixed payment-source ID. It allocates the
binding UUID and atomically invokes existing `configure_ingestion_source`:

- source kind `apple_pay`, immutable instance key `flowlink:<lowercase binding UUID>`;
- exact singleton `payment_source_ids` array of decimal strings;
- empty `card_mappings`, `aliases`, `verified_references`; `time_verified:false`;
- actor `flowlink_owner:<verified owner UUID>`, request key = binding command UUID.

Registration, binding insertion and receipt commit together. A new binding is not
created during ingestion. The transitional `APPLE_PAY_SOURCE_CONFIG` is not consulted.

Updates require the displayed binding revision and at least one real label/status
change. Source revision is read under lock, independently of binding revision. APY
configuration updates preserve the current approved configuration, including aliases.
Disabling/retiring makes the APY source inactive in the same commit. Re-enabling
requires a live device and active payment source. Retirement is terminal; a real
card/payment-source replacement requires a new binding/source. Old queued captures
are never redirected. Revocation blocks the entire device without rewriting bindings
or sources; credential rotation keeps their identities.

Receipt lookup precedes state/revision checks. An exact replay returns the original
safe snapshot with `replayed:true`, even after another update or device revocation;
it grants no renewed ingestion authority. Changed command/actor under the same UUID
returns 409 `request_key_conflict`. An already-used APY command UUID cannot be reused
as a new binding command. Commands are serialized by the existing transaction lock.

## HTTP and private RPC surface

All routes below have prefix `/api/flowlink/v1`.

| HTTP | Private RPC | Authority / result |
| --- | --- | --- |
| GET `/owner/payment-sources` | `list_flowlink_payment_sources` | Supabase JWT + owner allowlist; active sources only, 100/page. Safe id/name/method/issuer/last4/is_active. |
| POST `/owner/devices/:id/bindings` | `create_flowlink_binding` | Owner; request_id, label, payment_source_id. 201 new / 200 exact replay. |
| GET `/owner/devices/:id/bindings` | `list_flowlink_owner_bindings` | Owner; 50/page including disabled/retired history. |
| PATCH `/owner/bindings/:id` | `update_flowlink_binding` | Owner; request_id, expected_revision, optional label/status. 200 or sanitized conflict. |
| GET `/device/bindings` | `list_flowlink_bindings` | Device credential; own non-retired id/label/status/revision/available only. |
| POST `/wallet-transactions` | `ingest_flowlink_observation` | Device credential + native flag; safe APY outcome envelope. |

Owner lists return `next_cursor:null` at the end. Cursors are canonical bounded
base64url JSON: `{id}` for payment sources, `{created_at,id}` for binding history.
Unknown query fields and malformed cursors are rejected. Mapping/source IDs and
revisions are decimal strings, never JS floating-point IDs. Owner snapshots contain
id, device_id, label, payment_source_id, source_id, status, revision, created_at,
updated_at, retired_at; mutation responses additionally include replayed.

Management returns 400 invalid_input, 404 not_found, 409 state_conflict/stale_revision/
request_key_conflict, 429 quota, or sanitized 503. At most 32 non-retired bindings
per device. Device listing returns no payment-source details, owner UUIDs, source IDs,
credentials, competing candidates or other devices. Availability requires active
binding/source/payment-source and a valid source identity/mapping. The read RPC also
checks the live device credential. No device_id request/query is accepted.

Existing enrollment, owner device management and status APIs remain available.
`GET /device` now reports the actual native flag instead of FLI-02's fixed false.

## Money authorization and concurrency

`ingest_flowlink_observation(p_credential_sha256 BYTEA,p_request JSONB)` is the sole
native money entry point. HTTP authentication is only an early rejection. Within
one PostgreSQL transaction:

1. Acquire `LOCK TABLE public.transactions IN EXCLUSIVE MODE` before any row lock.
2. Resolve credential identity, then lock device, credential and requested binding
   in that order. Recheck active/current authority and binding ownership/state.
3. Lock APY source, verify apple_pay kind, exact derived instance key, active state
   and exact singleton payment-source authorization. Mismatch fails closed with 503;
   no repair is attempted. Unknown/other-device/disabled/retired binding gives the
   same 403; invalid/revoked credential gives 401.
4. Lock/recheck active payment source with FOR SHARE. Inactive gives 422.
5. Independently validate the six-field native request in SQL, build the trusted
   expense observation with the binding's payment-source ID, then invoke existing
   `ingest_observation` inside this transaction. Commit once.

All new mutations use the transactions-first order; FLI-02 revocation/rotation already
uses it. Ingestion committed first remains valid. Revocation/disable/rotation committed
first makes the waiting old request fail with zero cash. Payment-source deactivation
is excluded by its row lock and rechecked after waiting. Middleware state cannot
substitute for these checks. Native authorization is checked even on receipt retries.

The narrow [service adapter](../../server/services/transactionIngestionService.js) calls
this wrapper; all existing trusted APY callers remain unchanged. APY owns matching,
exact money, provenance and cash creation. Outcomes: 201 created; 200 reconciled or
already_observed; 202 ambiguous with pending evidence; 409 conflict; 422 rejected.
There is no new transaction creation or reconciliation algorithm, category learning,
financial schema change or domain side effect.

The request is exactly binding_id, amount, currency, merchant, transaction_date,
idempotency_key. UUIDs are lowercase v4; amount is a canonical positive decimal string
with exactly two fraction digits and at most 28 whole digits; currency is exactly ILS.
Merchant uses APY Unicode normalization, 1–512 characters, nonempty normalized text,
no control/file-placeholder text. Date must be a valid Gregorian YYYY-MM-DD. Unknown
fields are rejected even when null. SQL independently validates the boundary.

## Flags, transport and diagnostics

Only literal `FLOWLINK_INGESTION_ENABLED=true` enables native writes; absent/false
returns 503 `flowlink_ingestion_disabled`. This is independent of the Apple flag.
The tracked [.env.example](../../server/.env.example) keeps it false. Owner allowlist
configuration remains required for all FlowLink APIs; no values are provisioned here.

Uncompressed JSON writes are bounded to 8 KiB. Device routes reject browser Origin
and query strings. Owner routes preserve explicit CORS and now permit PATCH. Every
response is no-store. Native boundary errors use the safe APY envelope with null IDs;
SQL details, headers, merchant/card data, credentials and digests are never logged.

Rate limits are process-local: 120/IP/15m, owner 60/15m, device reads 120/15m shared
between status/bindings, device writes 60/15m keyed by device UUID so rotation does not
reset the bucket. Existing pairing quotas remain. No cluster-global enforcement claim.
Deadlock/serialization/lock-timeout failures retry at most once with identical RPC
arguments. Uncertain transport outcomes return 503; callers reuse the original key.

## Existing-web owner panel

Settings → FlowLink uses [FlowlinkBindingsTab](../../client/src/pages/Settings/FlowlinkBindingsTab.jsx)
and the existing Select/TextField/buttons/confirmation dialog and theme tokens.
The owner explicitly selects a registered device and payment source, creates a label,
lists bindings and disables/re-enables/retires them. Retirement confirmation explains
its terminal behavior and retained queued-capture identity. Revoked devices retain
history but cannot create/re-enable. All list pages are loaded; no first-card default.

Backend owner authorization remains authoritative. Unapproved users get a safe
permission message without mutation controls. The web panel contains no mobile login,
pairing-secret recovery, notifications or Wallet automation editor. It is a Hebrew
RTL Settings surface with semantic controls; hardware/browser visual acceptance is
still Pending. Component tests verify the normal controls and terminal-state UX.

During an uncertain response the panel freezes the command and selection, offering
an exact-key retry rather than a fresh mutation. Definitive conflicts reload current
state for a deliberate new action. This pending command lives only in the mounted
panel: after navigation/reload, inspect refreshed bindings/history before retrying a
new command. Device durable capture storage belongs to #89/#90.

## Verification

Tests use synthetic credentials and portless disposable PostgreSQL 16 containers;
no .env, network DB URL or production identity is loaded. HTTP/database integration
uses the actual router and services with a service-role psql RPC transport, not a
claim of deployed Supabase/PostgREST or native hardware verification.

| Command from repository root | Result |
| --- | --- |
| `node --test server/test/flowlink.test.js server/test/flowlinkBindings.test.js` | 33 passed, 0 failed. |
| `npm test --prefix server` | 408 passed, 0 failed (includes those 33). |
| `node --test server/test/flowlinkPostgres.local.test.js server/test/flowlinkBindingsPostgres.local.test.js` | Final combined run: 54 passed, 0 failed (27 enrollment + 27 binding cases). |
| `node --test server/test/flowlinkBindingsPostgres.local.test.js` | Final 27 binding cases passed, 0 failed; 54 distinct FlowLink DB cases total including 27 enrollment regressions. |
| `node --test server/test/transactionIngestionPostgres.local.test.js server/test/applePayPostgres.local.test.js` | 45 passed, 0 failed. |
| `npm test --prefix client -- src/pages/Settings/FlowlinkBindingsTab.test.jsx src/pages/Settings/Settings.test.jsx src/services/api.test.js` | 49 passed, 0 failed; includes 6 new panel cases. |
| `node server/test/run-savings-release.cjs` | Final run: 39 passed, 0 failed (Manual 9, Interest 9, Monthly 8, Surplus 8, Reporting 5). |
| `npm run build --prefix client` | Passed; large-bundle warning reported. |

Database cases cover exact receipts after intervening commands, lost responses,
concurrent commands/duplicates, source corruption, explicit mappings across cards and
devices, quotas, pagination, grants/guards, atomic rollback, cash/replay/
conflict/strong candidate/ambiguity, all six revoke/disable/rotate orderings, payment
source deactivation and simultaneous existing APY/native ingestion. No accounting
assertions were removed. FLI-02's migration comparison now applies later migrations
before comparing with the final schema; its no-money enrollment invariant remains.

Initial failures: the first unit launch lacked installed dependencies (installed via
locked npm ci); first DB run was 21/22 because NUMERIC returned extra trailing zeros,
corrected to compare exact value independently of scale; first client run was 48/49
because a test's exact label query omitted the existing required-field marker,
corrected to an accessible-name query. The first Savings run passed 31 and failed 8
in the Monthly startup hook; the unchanged retry passed 22 and failed 17 in the
Manual/Monthly startup hooks (missing socket / server shutting down). The Docker
image temporarily accepts Unix-socket connections during initialization. The final
release runner now waits for its final TCP listener inside the portless container;
all 39 then passed. The touched FlowLink fixtures use the same stricter readiness
probe. No Savings scenario, assertion, runtime code or migration was changed.

Additional checks: affected client files passed focused ESLint; git diff --check,
strict UTF-8, changed-document local file links, 038/full_schema parity, empty index,
unchanged 036/037 and seven 1.3.1 fields all passed. Owner browser/theme/mobile visual
review and native hardware testing remain unclaimed and Pending.

## Deployment boundary and release gate

Production application of 037/038, owner-allowlist provisioning, native enablement,
real enrollment/bindings and deployment are separately authorized owner operations.
No production state/configuration/secrets were inspected or changed. Keep both
native and transitional Apple ingestion disabled until explicit authorization.
Before any production use, verify the actual applied migration chain; repository SQL
is not production evidence. Before receipt use, disable the native adapter and retain
additive schema if application rollback is needed. After financial provenance exists,
preserve all identity/history and fix forward; never drop history or restore hard deletes.

- Release impact: **Yes**, additive backend and owner-web capability.
- SemVer impact: **Minor**.
- Candidate release: **proposed v1.4.0**, final decision/revalidation in #84.
- Included release candidate: **#85 FlowLink / #78 APY** grouped candidate.
- CHANGELOG status: **Updated under Unreleased**, actual #88 runtime scope only.
- Version-bump status: **Deferred**; all seven product fields remain **1.3.1**.
- Publication status: **None / out of scope**; no tag or GitHub Release created.
- Owner verification / acceptance: **Pending** for #88 (Open / Verify / P1 at handoff).
- Commit/push/merge: **Not performed**; owner operates Git.
