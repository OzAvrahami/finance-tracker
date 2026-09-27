# FlowLink native ingestion contract

FLI-01 [#86](https://github.com/OzAvrahami/finance-tracker/issues/86), parent
[#85](https://github.com/OzAvrahami/finance-tracker/issues/85). **Contract complete
for owner review; acceptance Pending.** Dated 2026-09-26, audited at local/remote
main `15c358e7a4de93c293a8bf5e6255a84b115bb471`. This document specifies future
implementation, not existing FlowLink tables, endpoints or tested iPhone behavior.
The [planning record](FLOWLINK_NATIVE_INGESTION_PLAN.md) remains historical.

The accepted [APY contract](APPLE_PAY_TRANSACTION_RECONCILIATION.md) and
[036 implementation](APY_02_INGESTION_FOUNDATION.md) continue to govern financial
identity, matching, accounting, cancellation and legacy compatibility. This contract
adds authorization and a native producer; it does not replace those decisions.

## 1. Audit, boundaries and ownership

| Repository evidence | Consequence |
| --- | --- |
| [requireAuth](../server/middleware/auth.js), [AuthContext](../client/src/context/AuthContext.jsx) | Supabase getUser proves a user, not an approved owner. Client sign-up exists. Add an explicit owner UUID allowlist; do not infer authority from login, email, payment_sources.owner or future #63 roles. |
| [Server mounts](../server/index.js), [external auth](../server/middleware/apiKeyAuth.js) | JWT, external API and internal jobs are different trust boundaries. New device routes must not fall through to broad JWT APIs or reuse their secrets. |
| [Apple route](../server/routes/applePayRoutes.js), [config](../server/config/applePay.js), [adapter](../server/services/applePayIngestionService.js) | Reuse bounded parsing, exact normalization and safe APY response projection. Global environment credentials and single-card bootstrap are transitional, not device authority. |
| [Ingestion service](../server/services/transactionIngestionService.js), [Migration 036](../server/migrations/036_transaction_ingestion_foundation.sql) | Atomic ingestion/configuration lock transactions in EXCLUSIVE mode before rows. Six service-only RPCs, three RLS relations, append-only events, scoped retry keys and protected cash already exist. |
| [Payment-source controller](../server/controllers/settingsController.js), [routes](../server/routes/transactionRoutes.js), [schema](../server/full_schema.sql) | Existing active/all-source reads require ordinary JWT only. IDs are BIGINT; name/method/issuer/last4/owner are descriptive, not authorization. New owner-scoped listing is required; devices cannot use broad settings APIs. |
| [APY tests](../server/test/transactionIngestionPostgres.local.test.js), [Apple HTTP/DB tests](../server/test/applePayPostgres.local.test.js), [Apple unit tests](../server/test/applePay.test.js) | Reuse patterns for disposable full-schema persistence, isolation, races, exact cash, safe errors and legacy compatibility; these are not FlowLink device test evidence. |

Latest migration is 036; latest published stable release and seven product fields
are 1.3.1. No iOS project or device credential model exists. Existing production
evidence on [#81](https://github.com/OzAvrahami/finance-tracker/issues/81#issuecomment-5847181997)
records owner-applied 036, unchanged financial totals and disabled Apple ingestion.
No production SQL, configuration inspection/change or live device test was performed
for FLI-01. Keep `APPLE_PAY_INGESTION_ENABLED=false` and its current variables intact.

| Work | Exact implementation boundary |
| --- | --- |
| FLI-02 #87 | Owner gate, pairing/device/credential schema and private commands, enrollment/auth/revocation APIs; minimal owner web pairing/device panel using the existing session. No native money route. |
| FLI-03 #88 | Binding schema/lifecycle, per-binding APY registration, atomic authorized ingestion wrapper and route, owner payment-source/binding panel and device-safe binding listing. |
| FLI-04 #89 | ios/FlowLink Xcode project, SwiftUI shell, Keychain/pairing/networking/status; display/select approved bindings. Native management cannot grant a binding; direct owner to the web panel. May build UI against this contract before #88 integration. |
| FLI-05 #90 | App Intent, real Wallet parameter experiment, exact normalization, durable capture receipt, bounded retry and technical device tests. |
| FLI-06 #91 | Integrated device/multi-card/isolation tests, separately authorized controlled production test and enablement decision, explicit #81 acceptance/transition decision. |

Use `ios/FlowLink/` inside this repository, no nested Git repository. Swift/SwiftUI,
App Intents/App Shortcuts, native networking; local Mac development/device builds.
FLI-04 adds narrow Xcode user-state ignores while retaining shared project/schemes.
FlowLink app 0.1.0 / build 1 is independent of Finance Tracker's proposed v1.4.0.
No notifications, APNs, distribution/TestFlight, full finance UI, generic OAuth,
tenants or CAL transition. #63 is not a blocker. Spouse enrollment needs owner
authorization, not a spouse Finance Tracker login; data remains today's shared dataset.

```text
approved owner JWT -> pairing capability -> installed device + Keychain credential
                                            |
                                            +-> binding UUID -> one payment source
                                                   |
Wallet automation -> App Intent -> frozen receipt --+
 -> device HTTP -> atomic authorization -> per-binding apple_pay APY source
 -> existing ingest_observation -> one canonical financial transaction / pending evidence
```

## 2. Owner gate and route trust boundaries

New configuration names below are **specified, not implemented or provisioned**:

| Setting | Decision |
| --- | --- |
| `FLOWLINK_OWNER_USER_IDS` | JSON array of 1–10 distinct canonical Supabase user UUID strings. Server-only deployment configuration, not email, client data or a new roles table. Invalid/empty/missing configuration disables all FlowLink APIs with 503 `flowlink_configuration_invalid`. No first-user bootstrap. Multiple explicitly approved owners have equal authority in the shared dataset. |
| `FLOWLINK_INGESTION_ENABLED` | Only literal `true` enables the native money route; absent/false gives 503 `flowlink_ingestion_disabled`. Pairing/status/owner management remain available when this flag is false. Independent of the legacy Apple flag. |

Owner routes require existing `requireAuth` AND allowlisted `req.user.id` on every
request; valid unapproved user gets 403 `owner_required`, invalid/missing JWT 401
`unauthorized`. The server passes the verified owner UUID to private management
commands; no caller-supplied actor is accepted. Configuration removal takes effect
on service restart/deploy; it does not erase existing devices. A targeted emergency
revocation is a database command, not a cache/configuration change.

Device APIs use `Authorization: Bearer <fldev1_credential>` only. They never accept
Supabase JWTs, the old Apple token or EXTERNAL_API_KEY as device credentials.
Pair redemption instead proves a one-use owner-issued capability in the JSON body.
It is not public arbitrary registration. Device and redemption routes reject Origin,
query strings, compressed bodies and non-JSON writes. HTTPS only; no credential in
URL, logs, App Intent parameters or source configuration. Owner routes retain the
existing explicit web CORS allowlist and Bearer session, not cookie authentication.
All responses use Cache-Control: no-store.

Mount isolated parsers/handlers before the general 2 MB parser/logger/JWT boundary;
owner subrouter explicitly applies session plus owner gate. Structured logs contain
only operation, sanitized reason/status, safe IDs and duration. Redact headers,
pairing/credential bodies, digests, merchant/card data and SQL error details. Do not
fall through to the general error logger with raw exceptions or request bodies.

## 3. Pairing and credentials: exact exchange

**Chosen issuance model: Keychain-first, phone-generated credential, owner-authorized
activation.** Server generation with a one-time plaintext response would make lost
responses unrecoverable under digest-only storage. The phone therefore generates the
candidate secret first; the server issues/activates its authority during redemption.
No admin secret or reusable bootstrap credential is involved.

1. Owner's authenticated web panel creates a capability with label and purpose
   `enroll`, or `replace_credential` for an existing active device. Owner gets an
   opaque copyable pairing text once. First implementation uses copy/paste into the
   foreground app (same phone's authenticated web page, or private owner-assisted
   transfer). No QR scanner or deep link is required; do not place it in a URL.
2. Wire text is `flpair1.<pairing UUID>.<43 base64url characters>`. The last component
   is 32 CSPRNG bytes, unpadded. UUID is only the lookup identifier. Server stores
   SHA-256 of the complete UTF-8 text, never plaintext; UI clears it on expiry/leave.
   Response loss at creation: capability remains unused; cancel if its ID is known,
   otherwise let its 10-minute TTL expire and create a replacement within the quota;
   no secret-recovery endpoint. Browser does not persist it in localStorage.
3. Phone validates the backend HTTPS origin (fixed for the pairing, no redirect to
   another host), creates a UUIDv4 `redemption_id` and 32 CSPRNG bytes using native
   secure randomness. Credential is `fldev1_` plus 43 unpadded base64url characters.
   Save credential and pairing draft to protected Keychain **before** transmission.
   Draft includes backend origin and capability, expires after at most 24 hours.
4. POST redemption sends pairing ID/secret components, redemption ID and proposed
   device credential. Server hashes secrets before private RPC. Atomic redemption
   locks/rechecks capability, state and clock. `enroll` creates server UUID device
   and one credential row; `replace_credential` keeps device/bindings/sources and
   atomically revokes the current credential while activating the replacement.
5. Commit consumes the capability and stores a safe redemption receipt. Response
   contains device/credential UUIDs and replay status, **no plaintext credential**.
   Phone promotes its already-stored secret to current, then removes pairing draft.
   It can confirm via device status. No network success is reported before commit.

TTL is **10 minutes** from server creation. At most **5 invalid-secret attempts per
known capability**, committed atomically (not rolled back by raising an exception).
Fifth failure locks it permanently; unknown IDs receive the same 401 `pairing_invalid`
without revealing existence. A correct secret permits specific expiry/consumed errors.
Creation: at most 10/hour/owner and 5 pending capabilities/owner (database enforced).
Redemption ingress: 30 attempts/15 minutes/IP, including unknown IDs; 429 with
Retry-After. Counts persist in DB for capability/owner limits; IP limiter follows
existing single-process server pattern, not a claim of cluster-wide protection.

| Situation | Required result |
| --- | --- |
| First valid unexpired claim | 201 `paired`, exactly one device/credential activation, consumed capability. |
| Lost response / restart | Reuse stored capability, redemption ID and exact candidate credential. Same normalized claim returns 200 `paired`, replayed=true; never make a second device. |
| Concurrent identical claims | One commit, second reads identical receipt. |
| Consumed capability, different redemption ID/credential | 409 `pairing_consumed`; never replace the winner. |
| Correct secret, expired/locked/cancelled unused capability | 410 `pairing_unavailable`; owner creates another. |
| Receipt replay after device revoked or credential superseded | 409 `pairing_superseded`; cannot reactivate or return live authority. |
| Retry after claim receipt window | 410 `pairing_unavailable`; try the stored candidate credential against device status. If 200, promote it; otherwise owner recovery. Never auto-enroll anew. |

Identical claim comparison hashes canonical `{pairing_id,redemption_id,
credential_sha256}`; owner label/purpose/target are fixed on creation. Replay window
ends 24 hours after successful consumption, even if original 10-minute TTL passed.
Replay proves the original secret and claim and checks current credential/device;
it is receipt retrieval, not a second redemption. Consume and expiry tests use DB
time. Retain the digest and capability metadata/receipt for 90 days, then delete
the expired capability record. A retained digest never extends its validity window;
it permits uniform proof checking before an expired/consumed response. Retain no
server-side pairing plaintext. After cleanup even a formerly valid capability gets
generic 401 pairing_invalid; the phone can still test its candidate device credential.

Credential digests are SHA-256 of the entire ASCII credential, stored as 32-byte
BYTEA; high random entropy makes password KDFs unnecessary. Server hashes once and
uses fixed-length constant-time comparison when comparing secret digests in Node.
Private SQL uses indexed digest lookup plus current row/state recheck; no plaintext
SQL arguments/storage. Digests are authentication-sensitive too: never expose them.
Credential format has no embedded device ID. One active credential/device; no
previous-token overlap. Owner-authorized replacement pairing is the sole rotation
operation for v1 (no independent mobile rotation API). Pending captures survive it.

Device states are `active` and permanently `revoked`; no redundant device-disabled
state. Revocation invalidates all device credentials immediately at commit and
cancels pending replacement capabilities. It cannot remotely erase a stolen phone.
Lost phone: revoke, enroll replacement as a **new** device and explicitly approve new
bindings. Lost credential on retained installation: owner replacement pairing may
keep identity. Reinstall has a new non-backed-up installation marker; never silently
adopt surviving Keychain credentials. Show recovery and require owner pairing; warn
that old local captures may be lost and must be reconciled before new submissions.
No hard-delete of device/binding/source history. Label is display only, never auth.

## 4. Proposed additive schema

All names here are final for FLI-02/03, not existing schema. UUIDs use random v4;
timestamps are TIMESTAMPTZ, server-controlled. UUID JSON strings are lowercase;
BIGINT IDs/revisions cross JSON as decimal strings. Every FK uses ON DELETE RESTRICT.
Owner UUID columns are audit snapshots, not FKs that cascade on auth-user deletion.
No plaintext secret columns, arbitrary raw metadata, notification fields or tenant model.

| Table / owner | Columns and integrity |
| --- | --- |
| `flowlink_devices` / #87 | `id UUID PK`, `label TEXT` 1–80 Unicode characters, `status TEXT` active/revoked, `created_by UUID`, `created_at`, `updated_at`, `revoked_at NULL`, `revoked_by UUID NULL`. Revoked iff revocation fields set; no return to active. Index `(created_at,id)` for owner listing. Identity immutable. |
| `flowlink_device_credentials` / #87 | `id UUID PK`, `device_id UUID FK devices`, `credential_sha256 BYTEA UNIQUE` exactly 32 bytes, `status TEXT` active/revoked, `revision BIGINT >0`, `created_at`, `revoked_at NULL`, `revocation_reason TEXT NULL` rotated/device_revoked. UNIQUE(device_id,revision); partial UNIQUE(device_id) WHERE status='active'; index device_id. Digest and identity immutable; retain revoked digests/rows to reject reuse and preserve lifecycle evidence. No per-request last_seen write required. |
| `flowlink_pairing_capabilities` / #87 | `id UUID PK`, `secret_sha256 BYTEA NOT NULL` 32 bytes, `purpose TEXT` enroll/replace_credential, `target_device_id UUID NULL FK devices` required only for replacement, `device_label TEXT` 1–80, `created_by UUID`, `created_at`, `expires_at` exactly +10m, `status TEXT` pending/consumed/cancelled/locked/expired, `failed_attempts SMALLINT` 0–5, `consumed_at NULL`, `redemption_id UUID UNIQUE NULL`, `claim_hash BYTEA NULL` 32 bytes, `result_device_id UUID NULL FK devices`, `result_credential_id UUID NULL FK credentials`, `cancelled_at NULL`. Consumed iff receipt IDs/hash/time present; replacement result device must equal target. Partial UNIQUE(target_device_id) for pending replacement; indexes `(created_by,created_at)`, `(status,expires_at)`. Expiry is enforced from clock even before cleanup updates status. |
| `flowlink_card_bindings` / #88 | `id UUID PK`, `device_id UUID FK devices`, `label TEXT` 1–80, `payment_source_id BIGINT FK payment_sources`, `source_id BIGINT UNIQUE NOT NULL FK transaction_ingestion_sources`, `status TEXT` active/disabled/retired, `revision BIGINT >0`, `created_by UUID`, `created_at`, `updated_at`, `retired_at NULL`. UNIQUE(device_id,id) for scoped lookups; partial UNIQUE(device_id,payment_source_id) WHERE status<>'retired'; index `(device_id,status,id)`. Retired iff retired_at set; no unretire. Device/payment/source IDs never change. |
| `flowlink_binding_commands` / #88 | `request_id UUID PK`, `binding_id UUID NOT NULL FK bindings`, `actor_id UUID`, `operation TEXT` create/update, `command_hash BYTEA` 32 bytes, `result JSONB` safe owner-binding snapshot, `created_at`. Index `(binding_id,created_at)`. Result is object, strictly projected and at most 4 KiB; no secrets. Append-only, no delete. One successful command receipt in the same transaction as binding and APY configuration changes. |

Four identity/security relations plus one small binding command receipt relation.
The fifth enables stable owner-command replay after intervening updates: 036's
source receipt contains source ID/revision, not a binding/label snapshot. Do not
change its accepted schema or overwrite its immutable audit events.
Credential history is separate to enforce one active digest
and prevent old-token reuse without adding a generic security-event subsystem.
Pairing receipts record creator, purpose and resulting credential revision. Device
revocation is retained on device/credential rows. Binding/source state changes use
existing APY configuration audit plus binding command receipts, not fabricated
financial observations. Command hash covers operation, target, verified actor UUID
and normalized requested fields, not the current source revision. Check receipt
first; for a new command, derive the source revision under lock. This prevents a
lost response followed by another update from turning replay into a fresh mutation.

Devices/credentials/bindings and linked provenance are retained; deletion is not an
API. Pairing metadata cleanup after 90 days is a service-only bounded maintenance
operation; expiry transitions/pruning work opportunistically during management too.
No scheduler/notification subsystem is required. Deleting old capability metadata
does not delete device/credential history. This is a retention minimum for identity
history, not a future legal-retention policy.

Enable RLS with no PUBLIC/anon/authenticated policies or direct table grants.
Revoke direct table/sequence access from service_role as in 036. Only named private
SECURITY DEFINER RPCs executable by service_role; pinned search_path, schema-qualified
objects, no caller-supplied SQL. Helpers/guards not executable by client roles.
Guard triggers enforce immutable identity, terminal states and no hard deletion of
device/credential/binding rows; binding command receipts are append-only. Do not
modify canonical transactions or 036 guards.
Only pairing cleanup may remove expired capability records under the documented policy.
All columns are NOT NULL except those explicitly marked nullable. Credential revoked
state requires revoked_at/reason; active requires both null. Revisions begin at 1 and
increment under lock. Pairing terminal states cannot return to pending; consumed
receipt fields are immutable. Before creating a replacement capability, expire stale
pending rows so the partial unique index cannot block legitimate recovery.

Safe device response fields: its device UUID/label/status, current credential UUID/
revision, own binding UUID/label/status/revision and capability protocol version.
Never expose digests, owner UUIDs, payment_source_id, source_id, other devices,
candidate lists or generic observation detail. Owner may see safe mappings/audit
timestamps, but never recover credentials or pairing secrets after issuance.

## 5. Binding and APY source lifecycle

One device has many bindings; each binding authorizes exactly one active, owner-chosen
payment source. No last4/display-text inference. Same real payment source on two
phones requires two owner-approved bindings and two APY source instances. One
non-retired binding per payment source per device prevents accidental duplicate
automations for that device; display names need not be unique.

Binding creation is a private atomic command: allocate binding UUID, register source
through `configure_ingestion_source`, then insert binding before commit. Derived
instance key is **`flowlink:<lowercase binding UUID>`**, source_kind `apple_pay`.
Store source_id on the binding; do not store a second independently editable key.
036 permits this colon-containing key; the narrower legacy Apple environment-config
regex is not reused. Verify kind/key/mapping on every financial command.

Initial source configuration is exactly:

```json
{
  "payment_source_ids": ["<owner-selected decimal ID>"],
  "card_mappings": [],
  "aliases": [],
  "time_verified": false,
  "verified_references": []
}
```

The wrapper injects trusted `payment_source_id` into the APY observation after
authorization; no card_reference is needed. Source creation uses the owner command
UUID as APY request_key and actor `flowlink_owner:<verified owner UUID>`.
Binding command request/hash/result enables lost-response replay without new bindings.
Same key with changed command is 409. All subsequent configuration calls use a new
command UUID and the locked source's actual expected_revision; never guess a revision.
Source revision and binding revision are separate, not required to have equal values.

Disable: binding becomes disabled and source is_active=false in one transaction.
Re-enable: same binding/payment source, source active, both still valid; requires
owner request and expected binding revision. Retire: terminal disabled source,
retained historical mapping. Replacing a real card/payment source always retires old
binding and creates new UUID/source; queued captures remain on the old binding and
cannot be redirected automatically. Labels may be corrected by owner without
changing identity. Credential rotation never configures/renames sources.

Device revocation blocks all its bindings at the wrapper, even if their stored
status/source flag remains active; responses expose this as unavailable. No source
rewrite/fan-out is required to revoke a device. Disable/retire binding explicitly
when desired. Inactive payment_source also blocks ingestion. Privileged direct APY
commands remain trusted server operations and must not be exposed to device tokens.
Native handlers must use the wrapper exclusively.

## 6. Atomic authorization and lock contract

Add `ingest_flowlink_observation(p_credential_sha256 BYTEA, p_request JSONB)`.
Middleware may reject early, but is never the final authority. Within **one database
transaction**, this wrapper:

1. Acquires `LOCK TABLE public.transactions IN EXCLUSIVE MODE` **before any row
   lock**, matching 036 and avoiding source-first/financial-row lock inversion.
2. Finds the credential/device, locks device FOR UPDATE, then credential FOR UPDATE,
   then the requested binding FOR UPDATE; rechecks active credential/current device,
   binding ownership/state and immutable source/payment mapping. No other device's
   binding existence is disclosed. Unknown/disabled/revoked credentials all give 401.
3. Locks its APY source FOR UPDATE; verifies apple_pay kind, derived instance key,
   active source and exact singleton allowlist. Configuration mismatch gives 503,
   not repair-on-ingest. Uses the existing APY payment-source lock/active validation.
4. Validates/normalizes the narrow request again and constructs the trusted APY
   observation (expense, bound payment ID, exact ILS amount, date, merchant, key).
   Calls existing `ingest_observation` **inside the same transaction**; its table
   lock is already held. Do not invoke a second PostgREST call or duplicate matching.
5. Returns existing safe APY result after commit; any failure rolls back all effects.

All new mutating commands use the same initial transactions EXCLUSIVE lock, then
device -> credential -> binding -> APY source when applicable. Pairing rows are
locked after device/credential (for enrollment no device exists yet); never lock a
capability then wait for a pre-existing device. Multiple rows use ascending UUID/ID.
Owner-limit checks/claim writes are serialized under this conservative table lock.
No HTTP/Keychain work while locks are held. Keep transactions short. Read-only status
auth is advisory; no authorization cache may permit a subsequent money write.

Revocation, credential replacement and disable/retire follow this lock order too.
**Linearization:** if ingestion commits first, that receipt is valid and revocation
applies to subsequent writes; if revocation/disable commits first, waiting ingestion
rechecks and writes zero cash. Cannot retroactively undo already committed purchases.
Payment-source deactivation uses existing row-lock exclusion; test this interleaving
against actual settings and APY functions. Retain once-only retry of 40P01/40001/55P03
with identical key/payload; repeated failure -> 503, never regenerate a capture.

Add a narrow method to transactionIngestionService for the authorized wrapper;
reuse pure normalization/result mapping. Keep legacy `ingestObservation` available
to its existing trusted callers. No new accounting columns, joins or writer effects:
created = one live ordinary expense; attached = zero new cash; ambiguity = pending
observation and zero avoidable cash; same-key conflict preserves original evidence.
No Savings/Loan/items/installments/LEGO/Shopping/keyword/allocation side effects.

## 7. Exact HTTP surface

Base **`/api/flowlink/v1`**. All writes reject unknown fields and non-object JSON;
8 KiB decoded UTF-8 limit, no compression. UUID fields canonical lowercase v4,
labels 1–80 Unicode characters after trimming, no control characters or apparent
full card numbers (13–19 digits with optional spaces/hyphens). Authentication
and infrastructure errors use `{ "error": { "code": "<allowlisted code>" } }`;
ingestion always uses the existing safe APY envelope including on boundary errors.
No stack traces, SQL messages or secrets. Missing methods/paths return 404.

### Owner-only routes (Supabase JWT + approved-owner gate)

| Method/path (relative to base) | Strict JSON input | Successful response |
| --- | --- | --- |
| POST `/owner/pairings` | `{purpose:"enroll",label}` OR `{purpose:"replace_credential",device_id}` | 201 `{pairing_id,pairing_text,expires_at,purpose,device_id:null-or-UUID}`; label for replacement inherited. Not replayable secret issuance; lost response needs replacement capability. |
| POST `/owner/pairings/:id/cancel` | `{}` | 200 `{pairing_id,status:"cancelled"}`; repeated cancel stable, consumed -> 409. |
| GET `/owner/devices` | None | 200 `{devices:[{id,label,status,created_at,revoked_at,credential_revision}],next_cursor}`. Max 50, cursor is opaque server-validated `(created_at,id)`; query cursor permitted only on owner lists. No hashes. |
| POST `/owner/devices/:id/revoke` | `{}` | 200 safe device, repeat stable; revokes all credentials and replacement capabilities. No reactivation API. |
| GET `/owner/payment-sources` | None | 200 `{payment_sources:[{id,name,method,issuer,last4,is_active}],next_cursor}` active rows only, decimal string IDs. Owner explicitly chooses; no matching inference. |
| POST `/owner/devices/:id/bindings` | `{request_id,label,payment_source_id}` | 201 safe owner binding, 200 identical replay. payment_source_id positive decimal string BIGINT. Active device/source required. |
| GET `/owner/devices/:id/bindings` | None | 200 `{bindings:[...],next_cursor}` including disabled/retired history; safe owner binding includes id,device_id,label,payment_source_id,source_id,status,revision,created_at,updated_at,retired_at. |
| PATCH `/owner/bindings/:id` | `{request_id,expected_revision,status?,label?}`; at least one change | 200 updated safe owner binding. status active/disabled/retired only. Identity fields rejected. Stale revision/terminal change or conflicting UUID -> 409. |

Management list bounds: max 100 active devices, 32 non-retired bindings/device; list
binding history paginates at 50 with the same cursor convention when needed.
Owner payment-source listing paginates at 100 rather than truncating silently.
Return next_cursor=null at end. Owner selects existing payment sources; creating them
remains the existing separate settings workflow. These are small web panels in #87/88,
not a new generic admin platform. Owner binding commands check binding-command receipts
before stale-revision checks; exact original command returns original safe receipt.
Creation and update responses include `replayed:boolean` alongside the binding
snapshot. Owner list cursors are base64url JSON, max 256 bytes, strict typed fields:
`{created_at,id}` for devices/bindings, `{id}` for payment sources ordered by ID.
They are paging positions, not authority; owner scope is checked independently.
Malformed/unknown query fields -> 400. Missing owner target -> 404 `not_found`;
inactive/terminal/duplicate mapping -> 409 `state_conflict`; quota -> 429;
stale binding revision -> 409 `stale_revision`; conflicting request UUID -> 409
`request_key_conflict`; invalid scalar -> 400 `invalid_input`. These safe errors also
define the private-command error mapping; SQL constraint details never escape.

### Device/capability routes

| Method/path | Auth/input | Response |
| --- | --- | --- |
| POST `/pairings/redeem` | Capability proof; `{pairing_id,secret,redemption_id,device_credential}`. secret is 43-character component, not whole pairing_text; server reconstructs it before hashing. | 201/200 `{outcome:"paired",device_id,device_label,credential_id,credential_revision,replayed}`. Lifecycle errors per §3. |
| GET `/device` | Device Bearer; no query | 200 `{device:{id,label,status:"active"},credential:{id,revision},protocol_version:1,ingestion_enabled:boolean}`. Invalid/revoked 401. |
| GET `/device/bindings` | Device Bearer; no query | 200 `{bindings:[{id,label,status,revision,available}]}` own non-retired only, max 32. available=false for inactive payment/source; no internal IDs/card details. App shows only available active entries for new selection. |
| POST `/wallet-transactions` | Device Bearer + request below | APY safe result with 201/200/202/409/422; auth/binding/infrastructure errors as below. |

No device route for binding creation, global payment-source enumeration, arbitrary
financial reads/review/cancel or another device. GET status/bindings use service-only
read RPCs checking current digest/device, not direct table grants.

Future rate defaults: pre-auth 120/15m/IP for device routes, authenticated 60/15m/device
for writes (rotation cannot reset device bucket), reads 120/15m/device; owner management
60/15m/owner plus pairing limits in §3. Retries count. Implement express-rate-limit
in-memory consistent with today's server; persistent pairing bounds are independent.
Before multi-replica deployment, replace process-local buckets with shared enforcement;
do not claim global limits now. Return 429/Retry-After; normal shopping bursts fit.

### Wallet v1 request

```json
{
  "binding_id": "11111111-1111-4111-8111-111111111111",
  "amount": "4.00",
  "currency": "ILS",
  "merchant": "Israel Post",
  "transaction_date": "2026-09-26",
  "idempotency_key": "22222222-2222-4222-8222-222222222222"
}
```

Exactly these six fields are required. UUIDs above are examples, not real bindings.
Amount must be a positive canonical decimal **string**, pattern
`^(0|[1-9][0-9]{0,27})\.[0-9]{2}$`, at most 28 whole digits; reject zero. Convert with
BigInt/NUMERIC, never JS Number; 4.00 -> 400 cents. Currency exactly ILS. Merchant is
the already-selected original Merchant or Name text, 1–512 Unicode characters,
must normalize nonempty through APY; reject Attachment.txt placeholders and non-text.
No separate name field on HTTP: native fallback occurs before receipt creation.
Date is a valid Gregorian `YYYY-MM-DD`, year 0001–9999, frozen capture-local date.
No freshness threshold that would silently redraft an offline purchase.

Reject unknown fields including payment_source_id, source_id, movement_type,
category_id, transaction_id, occurred_at, provider_reference and raw/card metadata,
**even if null**. Initial native protocol omits optional APY source-time/reference
evidence; future genuine evidence requires a reviewed protocol extension. Adapter
forces expense, omits category (ordinary APY uncategorized cash), and omits charge_date
(existing APY provisional default). Budget/report actuals follow existing uncategorized
behavior; no automatic category learning or funding allocation is added.

| HTTP | Meaning / client action |
| --- | --- |
| 201 created | Persist success receipt; one live canonical transaction. |
| 200 reconciled / already_observed | Success/current receipt; zero new cash. Inspect disposition/review_required, not HTTP alone. |
| 202 ambiguous | Accepted pending observation, no new cash; retain needs-review status, no automatic resubmission. |
| 400 invalid_json/unsupported_field/invalid_input | Non-retryable protocol error; preserve receipt for diagnosis. |
| 401 unauthorized | Missing/invalid/revoked device credential, generic; pause sends, require recovery. |
| 403 binding_unavailable | Unknown, other-device, disabled/retired binding; same message, zero cash. Pause that receipt; do not remap. |
| 409 conflict | Existing APY reason (e.g. idempotency_key_conflict, identity_edited, cancelled_record_exists); stop retry, owner review. |
| 413 / 415 | Oversized/unsupported media or encoding; no automatic retry. |
| 422 rejected | Invalid money/currency/merchant/date or inactive payment source; no automatic retry until reviewed, never mutate an uncertain receipt. |
| 429 | Respect Retry-After, same key/body. |
| 503 | `flowlink_ingestion_disabled` creates a durable **held-for-owner-review** receipt, never automatic retry; only explicit confirmed manual retry may submit it. Other configuration/source mismatches pause. Only genuine transient service failures retry automatically with the same key/body. |

Safe APY envelope remains `outcome, original_outcome, observation_id, transaction_id,
disposition, review_required, reason_code, replayed, decision_revision`; numeric IDs
are strings/null. Boundary rejection uses null IDs, disposition pending, false replay
and review_required, allowlisted reason. Replay of a pending/cancelled observation is
not success posting merely because HTTP=200. No competing transaction IDs are exposed.

## 8. Keychain and native installation state

Use generic-password Keychain items, service `FlowLink.credentials.v1`, account
`<backend-origin-hash>:<installation UUID>:current` and `:pairing-draft` during pairing.
Value contains only the credential and necessary local pairing/device identity
metadata. The origin hash is SHA-256 of canonical HTTPS origin, not an auth authority.
No credential in UserDefaults, receipt files, logs, Info.plist, App Intent parameters,
Wallet automation or source. Set `kSecAttrSynchronizable=false` and
**`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`**; no biometric prompt on every
Wallet execution. No cross-app access group; App Intent stays in the app target for v1.

[Apple's accessibility contract](https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlockthisdeviceonly)
allows access after first unlock until reboot and prevents migration to another
device. Hardware tests must verify actual App Intent execution, protected-file access
and Keychain behavior while locked/on reboot. Before first unlock, fail without HTTP
if secure storage is unavailable; never downgrade protection or claim durable capture.
If receipt storage works but credential read fails, keep a receipt awaiting unlock.
No guarantee that iOS runs a personal automation or permits networking while locked.

Installation marker and origin selection live in non-backed-up Application Support;
not secrets. Missing marker means new installation even if Keychain items survived
uninstall. Require explicit recovery/pairing, not silent identity reuse. Origin change
requires new pairing and isolates receipts; never send an existing credential to a
new host or follow cross-origin redirect. Server cannot detect app uninstall remotely.

## 9. App Intent and Wallet interoperability gate

User-facing action **FlowLink: Record Wallet Transaction**, four parameters:

| Parameter | Contract |
| --- | --- |
| Card | Required `FlowLinkCardBinding` AppEntity: opaque binding UUID, safe owner-defined label. EntityQuery resolves only this installation's approved bindings. Refresh from server when possible, bounded protected cache for offline resolution. Missing/stale selection never defaults to another binding. |
| Merchant | Optional text from Transaction → Merchant. Prefer when nonempty and usable. |
| Name | Optional text from Transaction → Name, fallback only when Merchant is absent/whitespace. Nonempty malformed Merchant fails instead of hiding corruption through fallback. Never concatenate. |
| Amount | Required; preferred experiment is `IntentCurrencyAmount` with Decimal + currencyCode, subject to installed SDK/Wallet interoperability verification below. |

Multiple cards appear by safe label plus short binding-ID suffix to distinguish equal
labels, no payment/source IDs. User manually selects corresponding Wallet card in
personal automation and corresponding FlowLink binding in the action. The action
is exposed with App Shortcuts on installation; it cannot create the Wallet automation.
No Card or Pass input is required for authority. Cache is convenience, never server
authorization. A disabled/retired cached entity may identify an old receipt but cannot
be selected as a substitute or used to bypass current DB checks.

Owner evidence: iPhone 17 Pro Max/iOS 27.0 English; Apps → Wallet selected-card trigger;
Transaction properties exactly Card or Pass, Merchant, Amount, Name. Real contactless
test produced Merchant/Name text Israel Post; Notes serialized Amount and Card or Pass
as attachments with text `₪4.00` and a Wallet display label. **Native types unknown.**
No purchase time, date, timezone, separate currency or provider/event ID verified.

FLI-05 must execute this bounded experiment before declaring the action usable:

1. Confirm target SDK supports Apple's documented
   [IntentCurrencyAmount](https://developer.apple.com/documentation/appintents/intentcurrencyamount)
   (Decimal and currencyCode). Attempt binding Transaction → Amount directly in the
   automation picker. Record offered conversions, runtime type, exact decimal/currency,
   empty/unsupported cases and a real controlled purchase. This API's existence is
   not evidence Wallet provides it. No Double/Float conversion in between.
2. If direct typed binding fails, use a String Amount parameter with the variable's
   explicit Text conversion, or **one** declarative Text conversion action before
   the FlowLink action. Apple's [variable conversion UI](https://support.apple.com/guide/shortcuts/adjust-variables-apda36b9018b/ios)
   supports selecting content type, but exact Wallet conversion must be proved.
   Input must be textual contents, never file name, binary or rich object. No file
   parsing/Notes/Quick Look/regex/HTTP/JSON in the production automation.
3. Native text parser accepts only verified `₪` + 1–28 ASCII whole digits + dot +
   exactly two fractional digits; normalizes leading zeros using integer/decimal
   arithmetic and rejects nonpositive values, grouping, foreign symbols, bare amounts,
   unknown whitespace/precision. Typed path accepts positive exact ILS Decimal with
   at most cents, same magnitude bound, no rounding/FX. Both produce canonical text.
4. If neither yields exact money/currency with at most that one conversion, stop the
   Amount integration path and report device evidence. Do not recreate the rejected
   complex Shortcut. Backend implementation may proceed independently. No experiment
   or claimed parameter compatibility is completed by FLI-01.

AppEntity/EntityQuery follow Apple's [entity contract](https://developer.apple.com/documentation/appintents/appentity).
Action output is a safe dialog/result status: Recorded, Already recorded, Pending
retry, Held for review, Needs review, or Not recorded with safe reason. Normal enabled
ingestion does not require routine approval; a disabled-ingestion hold always requires
explicit owner review/manual retry. No notification implementation. Real discoverability, invocation/lock behavior
and localized Hebrew/RTL status presentation require later device tests.

## 10. Frozen capture receipt and retry

At entry capture Gregorian local calendar DATE once with the device's current timezone
and locale-independent YYYY-MM-DD formatting; generate UUIDv4 once. Never use a retry's
clock or server receipt date. After native normalization, **durably commit a receipt
before any ingestion POST** (binding/status reads do not post money). Unsupported values fail locally with no submission. A failed
durable write means Not recorded; do not send and then attempt to persist the key.

Use a small SQLite store in Application Support, excluded from backup, with
[completeUntilFirstUserAuthentication](https://developer.apple.com/documentation/foundation/fileprotectiontype/completeuntilfirstuserauthentication)
protection on database/journal/side files. Use transactional insert/update, serialized
connection access and full durable commits; no new third-party persistence platform.
App target hosts the intent, so v1 needs no shared-app-group database. Verify actual
concurrent-intent and crash behavior rather than assuming an in-memory Swift actor
alone serializes all executions.

Receipt fields: `idempotency_key` UUID PK, `installation_id`, `device_id`,
`backend_origin`, `binding_id`, safe approved binding display-label snapshot, `payload_version=1`, immutable UTF-8 request bytes,
their SHA-256, selected original merchant, canonical amount/currency/date (within
those bytes), local `captured_at` for diagnostics only, `state`, `attempt_count`,
`next_attempt_at`, `last_attempt_at`, safe `last_error_code`, safe response IDs/outcome/
disposition/revision. No credential, raw Wallet objects, raw Wallet card label or provider time.
The owner-approved binding label is local review metadata, not payment authority or an HTTP field.
Identity/date/payload are immutable; statuses update separately. Local captured_at
is never sent as occurred_at or used for reconciliation.

| Receipt state/event | Required behavior |
| --- | --- |
| queued / in_flight | Persist attempt start; load current Keychain credential only at transmission. 20-second request timeout. One worker claim per receipt. Crash/timeout/lost response resets to retry_wait with original bytes/key; even duplicate sends are APY-idempotent. |
| transient timeout/network/503 ingestion_unavailable/429 | Backoff 30s, 2m, 10m, 1h, then 6h; honor longer Retry-After, ±20% jitter. At most one HTTP attempt per intent invocation; foreground app resumes due work, max 3 attempts per receipt per foreground session. No sleeps keeping intent alive, no promised background delivery. |
| 503 flowlink_ingestion_disabled | Persist held-for-owner-review separately from transient retry. Retain exact receipt through restart. Launch/foreground and later backend enablement must not send it. Show merchant, amount/currency, original date, binding label and held status. Only confirmed manual retry sends the same original bytes/key with current Keychain credential; still disabled means held again. |
| acknowledged created/reconciled | Terminal delivered; retain safe receipt 30 days then remove. already_observed evaluates original/current disposition: pending -> needs_review, cancelled -> needs_review, otherwise delivered. |
| ambiguous/conflict/rejected | needs_review or failed; no automatic retry or new key. Retain full receipt pending explicit owner resolution. APY-05 financial review UI remains out of scope; app only shows safe status and asks owner to inspect Finance Tracker. |
| 401 / other invalid config / binding unavailable | paused; credential recovery or explicit owner resume needed. Rotation keeps same device/binding/payload. Retired binding cannot be substituted. |
| queued longer than 7 days or 20 attempts | paused for explicit review; do not unexpectedly auto-post old cash. Manual resume uses same payload/key only. |

Bound local store to **500 receipts and 5 MiB** (including payload data); evict only
delivered receipts older than 30 days. Never silently evict unresolved cash uncertainty.
At capacity refuse a new capture before HTTP and show storage/review-needed status.
Unresolved receipts have no automatic deletion deadline: bounded capacity plus manual
resolution avoids losing lost-response identity. Owner-reviewed local dismissal may
remove a failed/pending receipt but cannot cancel server cash; warn before dismissal.
Reinstall/clear-storage must warn about unresolved receipts; reconcile externally
before accepting new captures for the same purchase. No automatic resend under a new
device/source after reinstall. Unsupported/protocol failures do not create a new key.

Offline resolution can use a cached binding for its same immutable identity; server
rechecks current state on send. Credential rotation may change only the header.
Concurrent equal legitimate captures use independent UUIDs. Two automation invocations
for one physical purchase may still produce two cash rows: Wallet offers no verified
durable event ID and APY does not auto-merge Apple↔Apple. Do not hash merchant/amount/
date/card into identity. Configure only one automation per selected device/card.

**Owner decision, 2026-09-27:** real Wallet runtime/locked-event evidence is deferred,
not an implementation completion blocker for #90. Prepare infrastructure with both
ingestion flags false, capture/hold a later natural event, inspect it before any
financial posting, then authorize native enablement and manually retry the original
receipt. No pre-purchase enablement is required. Configuration-time direct Amount,
Merchant and Name mapping is owner-verified; actual runtime values remain unverified.
The [owner rollout and deferred #91 checklist](FLOWLINK_OWNER_ROLLOUT.md) supplies
migration/security evidence, production setup and the legacy CAL duplicate boundary.
This decision changes no backend route, request, authorization or financial RPC.

Date limitations: delayed execution across midnight or travel can produce a different
accounting date than purchase. Retain the captured date and let owner review/correct
known errors; no fabricated occurred_at, precision or provider_reference. Server
observed_at stays independent. Adjacent-date matching retains APY's conservative rules.

## 11. Private command and migration plan

Use next available migration numbers at implementation time; **never edit 036 in
place**. FLI-02 adds first three tables and these service-only RPC contracts (JSON
commands strictly validated, safe JSON results; UUID actor injected by gated server):

| Command | Purpose |
| --- | --- |
| `create_flowlink_pairing(p_owner_id UUID,p_pairing_id UUID,p_secret_sha256 BYTEA,p_command JSONB)` | Purpose/label/target, DB TTL and owner quota. Server generates random capability outside DB, no plaintext SQL argument. |
| `redeem_flowlink_pairing(p_pairing_id UUID,p_secret_sha256 BYTEA,p_redemption_id UUID,p_credential_sha256 BYTEA)` | Atomic claim/rotation and replay. Return errors as data when failed-attempt counters must commit. |
| `cancel_flowlink_pairing(p_owner_id UUID,p_pairing_id UUID)` | Cancel unused capability, safe repeated cancellation. |
| `revoke_flowlink_device(p_owner_id UUID,p_device_id UUID)` | Transactions-first revocation, including credentials and replacement capabilities; idempotent. |
| `get_flowlink_device(p_credential_sha256 BYTEA)` | Current device auth/status; safe result only. |
| `list_flowlink_devices(p_cursor JSONB)` | Owner-projected paginated metadata, callable only by trusted gated server. |
| `cleanup_flowlink_pairings()` | Bounded 500-row expiry/prune maintenance, private service-only; no public HTTP route. |

FLI-03 adds binding and binding-command tables/guards and:

| Command | Purpose |
| --- | --- |
| `create_flowlink_binding(p_owner_id UUID,p_request_key UUID,p_command JSONB)` | device_id,label,payment_source_id; atomic registration/binding receipt. |
| `update_flowlink_binding(p_owner_id UUID,p_request_key UUID,p_command JSONB)` | binding_id,expected_revision,status/label; atomic APY config event and binding revision. Preserve approved aliases, do not rebuild config from stale environment. |
| `list_flowlink_bindings(p_credential_sha256 BYTEA)` | Own non-retired safe bindings, no financial/internal source IDs. |
| `list_flowlink_owner_bindings(p_device_id UUID,p_cursor JSONB)` | Owner mapping/history projection. |
| `list_flowlink_payment_sources(p_cursor JSONB)` | Active owner selection projection, no new payment sources. |
| `ingest_flowlink_observation(p_credential_sha256 BYTEA,p_request JSONB)` | Money-write-time authorization wrapper in §6. |

Server may perform an early digest-format/auth check, but DB wrapper remains decisive.
No direct browser/device DB access. APY helper commands stay service-only. Parameter
actor is an audit identity, not a way for browser RPC calls to bypass server allowlist.

No backfill: do not enroll legacy observations, convert the transitional token, assign
existing transactions to devices, or infer bindings from last4. Source registration
happens during owner binding creation, not on arbitrary mobile requests. Applied 036
and its financial guards remain untouched. New guards only protect new relations.
Append new migration SQL to maintained full_schema.sql under the existing workflow.

Migration tests cover full schema through then-current latest and upgrade from 036,
rerun/rollback-on-error, exact grants and unchanged financial snapshots. Before native
use, disable adapter and retain unused additive schema if rolling back application.
After any native receipt/provenance exists: disable native ingestion, preserve all
IDs/keys/history, fix forward. Never drop APY/device-binding history or return to
hard deletion. Production migration/configuration/enablement are owner-operated and
require separate explicit authorization. Keep legacy Apple route disabled throughout.

Transitional reuse: APY shared service/RPCs, normalization, result whitelist, parser/
throttle/logging patterns and test harness. Do not reuse environment token/source
bootstrap as native enrollment. #91 coordinates an explicit owner decision about
#81 and later cleanup; no silent acceptance or deletion of historical evidence.

## 12. Test and acceptance matrix

These are required future tests, **not passed implementation tests in FLI-01**.

| Layer | Required assertions | Owner issue |
| --- | --- | --- |
| Unit/security | Missing/malformed owner config fail closed; non-owner authenticated denied; multiple owner UUIDs; token prefixes/entropy/digest compare; no secret logs; strict unknown fields/body sizes; merchant precedence; exact ILS/no Float/FX; format/limits/date/UUID. | #87/88/90 |
| Disposable PostgreSQL pairing | TTL boundary, fifth failure lock persists, quotas concurrent, identical concurrent claim one device/credential, competing claim conflict, lost-response replay, retention/cleanup, replacement supersedes old credential without identity changes, replay after revoke cannot revive. | #87 |
| Disposable PostgreSQL binding/auth | Device A cannot use B binding; cannot choose arbitrary payment/source/category; disabled/revoked/inactive source blocks; immutable/retired relationship; creation/config rollback; duplicate command receipt/revision conflict; all PUBLIC/anon/authenticated/service direct grants denied; private RPC allowlist only. | #87/88 |
| Real DB financial races | Ingest vs revoke, rotate, disable, retire and payment-source deactivation in both lock orders. Winning ingest may commit once; lifecycle winner gives zero new cash. Existing Savings/Loan row-lock contention has no new inversion. Actual concurrent sessions, no mock-only safety claim. | #88 |
| Real DB accounting | One capture one live expense; same-key/concurrent/lost-response replay zero extra; conflicting payload original unchanged; CAL-like strong candidate zero new; CAL-first ambiguity zero avoidable cash; cancellation/identity-edit conflict; equal independent Apple purchases separate; two devices/cards isolated sources; no repeated domain effects; legacy external_id/void/readers unchanged. Synthetic CAL evidence is a test fixture, not APY-04 implementation. | #88 |
| HTTP integration | Real private wrapper, route ordering, owner JWT vs device/capability isolation, token rejection, expired/revoked pairing, source config failure, rate limits/413/415, safe IDs/reason envelope, candidate non-disclosure, no browser/query credential path. | #87/88 |
| Native automated | Keychain abstraction/failure, credential-free receipts, exact Decimal/text parser, immutable date/key, disk-full before send, transactional receipt crash/restart, queue limits/backoff, response-state mapping, same-header-secret replacement with unchanged body, stale binding no remap, parallel invocations/worker claims. | #89/90 |
| Real device | Development install, manual pairing, Keychain locked/first-unlock/reinstall, App Shortcut discoverability, EntityQuery multiple labels/bindings, Wallet Amount typed/text experiment, real values/empty input, one-conversion UX ceiling, no secret in automation, timeout/restart recovery and foreground resume. | #89/90/91 |
| Controlled production later | Separate owner authorization for additive migrations/config/token issuance/enablement. Small selected-card ILS purchase, exactly one transaction/source mapping/observation, category/date/amount/merchant/report/Budget behavior, same-key replay; independently revoke one device without affecting another. Spouse production data only if expressly approved. No CAL prerequisite. | #91 |

Walkthroughs supporting the design: two claimants cannot consume one capability;
lost enrollment response uses retained candidate credential; revoked device wins
before ingest -> no observation/cash; ingest wins -> one preserved receipt; retired
binding retry never follows replacement; 4.00 ILS stays 400 cents; two equal purchases
retain distinct keys; ambiguous existing CAL candidates add no cash. These are design
reviews, not database execution or real-device verification.

FLI-02 is technically specified and can start **after owner review/authorization of
#86**. #88/#89 retain blockers #86/#87; #90 remains blocked by #88/#89, #91 by #90.
No graph changes, downstream work or production operations occur in FLI-01.

## 13. Release / Version gate

- Release impact: **No independently** — architecture/documentation, no runtime change.
- SemVer impact: **None independently**; implemented native capability remains a
  backward-compatible **Minor** alongside APY.
- Candidate release: **Not applicable independently**; proposed grouped Finance
  Tracker **v1.4.0**, subject to APY-06 #84 revalidation.
- Grouping / included release candidate: **FLI #85 / #86–91**, coordinated with
  **APY #78 / #79–84**; no new release tracker or milestone.
- CHANGELOG status: **Not applicable** for this design-only work; unchanged.
- Version-bump status: **Not applicable independently**; grouped preparation deferred
  to #84. All seven product fields remain **1.3.1**. FlowLink app/build independent.
- Publication status: **Out of scope**.
- Owner verification / acceptance status: **Pending review**; #86 Open / Verify / P1
  at handoff, not accepted or closed.
- Production migration/deployment/configuration: **Not performed**; deployment Not
  applicable to this documentation change. Existing owner-reported applied 036 and
  disabled route evidence are historical baseline, not new testing here.
