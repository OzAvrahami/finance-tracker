# FLI-02 device enrollment implementation

> Contract/technical reference. Dated implementation and verification notes are historical checkpoints; use the [documentation index](../README.md) for current release/acceptance boundaries and GitHub for live workflow state.

Issue [#87](https://github.com/OzAvrahami/finance-tracker/issues/87), based on the
accepted [native contract](../architecture/FLOWLINK_NATIVE_INGESTION_CONTRACT.md). This delivery
implements backend enrollment/security/status only, as authorized in the current
implementation request. It does not deliver the originally planned owner web panel,
iOS enrollment UI, bindings, APY source registration or a native money route. The
APIs below are ready for those later clients; UI acceptance is not claimed here.

## Configuration and trust boundary

`FLOWLINK_OWNER_USER_IDS` is a strict JSON array of 1–10 distinct lowercase Supabase
user UUID strings. The tracked [.env.example](../../server/.env.example) is intentionally
empty. An absent, empty, duplicate, oversized or malformed configuration returns 503
`flowlink_configuration_invalid` from all FlowLink APIs. There is no first-user
bootstrap and email/display names are never authority.

Owner authentication independently uses the same Supabase `auth.getUser` proof as
the existing `requireAuth`, then compares the verified user ID with the configured
allowlist. It is isolated to avoid forwarding secrets to the general error logger;
the existing middleware and other routes are unchanged. Invalid/missing JWT: 401;
authenticated non-owner: 403. Approved owners have equal shared-dataset authority.
Configured IDs and owner audit UUIDs are not returned to the phone.

Device auth accepts only `Bearer fldev1_<43 canonical unpadded base64url characters>`
(32 random bytes). Each request hashes the whole credential with SHA-256 and performs
a fresh private DB lookup of the active credential and active device. There is no
in-process authentication cache. No plaintext or digest comparison occurs in Node;
SQL uses the indexed fixed-length digest lookup permitted by the contract. A device
credential is not a Supabase session, external API key or legacy Apple credential.

The router is mounted before the general parser/logger/JWT boundary. In production
it requires HTTPS through the existing trusted-proxy configuration. HTTP is allowed
for isolated local verification. Responses are `Cache-Control: no-store`; device and
redemption requests reject browser Origin and query strings. Owner routes retain the
existing web CORS allowlist. All POST bodies must be uncompressed JSON objects, at
most 8 KiB, with only the documented fields. Structured diagnostics contain only a
fixed event name, status, safe reason code and duration, never bodies/headers/digests.

## API

All paths below have prefix `/api/flowlink/v1`. UUIDs are canonical lowercase v4;
credential revisions are decimal strings. Labels are trimmed, 1–80 Unicode characters,
with controls/format characters and PAN-like digit sequences rejected.

| Method/path | Authority and request | Successful response |
| --- | --- | --- |
| POST `/owner/pairings` | Owner JWT; `{ "purpose":"enroll", "label":"My phone" }` OR `{ "purpose":"replace_credential", "device_id":"<uuid>" }` | 201: `pairing_id`, `pairing_text`, `expires_at`, `purpose`, `device_id` (null for enroll). Text is returned once. |
| POST `/owner/pairings/:id/cancel` | Owner JWT; `{}` | 200: `pairing_id`, `status:"cancelled"`; repeat cancellation is idempotent. A consumed/other terminal capability returns 409. |
| GET `/owner/devices[?cursor=...]` | Owner JWT; optional opaque validated cursor | 200: `devices`, `next_cursor`; 50 items/page ordered by `(created_at,id)`. Items contain only `id,label,status,created_at,revoked_at,credential_revision`. |
| POST `/owner/devices/:id/revoke` | Owner JWT; `{}` | 200: same safe device projection. Repeat revocation is idempotent; there is no reactivation/delete endpoint. |
| POST `/pairings/redeem` | Body capability, no user JWT: `pairing_id`, `secret`, `redemption_id`, `device_credential` | 201 first commit / 200 identical recovery: `outcome:"paired",device_id,device_label,credential_id,credential_revision,replayed`. No plaintext credential in response. |
| GET `/device` | Device Bearer credential | 200: `device:{id,label,status}`, `credential:{id,revision}`, `protocol_version:1`, `ingestion_enabled:false`. |

`secret` is just the 43-character secret component from
`flpair1.<pairing UUID>.<secret>`; neither field is accepted through a query string.
The phone must generate its credential and redemption UUID once and persist them
securely before redemption. Keychain/client implementation belongs to FLI-04.
The status flag is deliberately false regardless of environment: FLI-02 has no
native ingestion capability or placeholder binding endpoint.

Errors use only `{ "error": { "code": "<safe code>" } }`:

| HTTP | Codes/meaning |
| --- | --- |
| 400 | `invalid_input`, `invalid_json`, `query_not_supported` |
| 401 | `unauthorized`, `pairing_invalid` (unknown capability and wrong proof share this result) |
| 403 | `owner_required`, `browser_origin_not_supported`, `https_required` |
| 404 | `not_found` |
| 409 | `state_conflict`, `pairing_consumed`, `pairing_superseded`, `credential_reused` |
| 410 | `pairing_unavailable` after valid proof of expiry/cancellation/lock or elapsed receipt window |
| 413 / 415 | `payload_too_large` / `json_required`, `encoding_not_supported` |
| 429 | `rate_limited`, with Retry-After |
| 503 | `flowlink_configuration_invalid`, `flowlink_unavailable`; no raw DB error is exposed |

IP ingress: 120/15 minutes, redemption: 30/15 minutes/IP, owner: 60/15 minutes/user,
device status: 120/15 minutes/device. These use the repository's process-local limiter;
they do not claim distributed rate enforcement. DB quotas additionally enforce
10 capabilities/hour/owner, 5 pending/owner and 100 active devices.

## Pairing, replacement and revocation

The server generates 256-bit capability entropy and stores SHA-256 of the complete
pairing text. TTL is exactly 10 minutes. Five wrong proofs atomically lock a known
pending capability; failed attempts commit instead of rolling back with an exception.
Unknown IDs never create a capability/device. Owner creation response loss leaves
an unused capability: cancel if its ID is known, otherwise allow expiry; no secret
recovery endpoint exists.

Redemption stores only the proposed credential digest plus an immutable claim hash
and device/credential receipt. An identical claim, including redemption UUID and
credential, returns the same committed result for 24 hours after consumption, even
after the original capability TTL. A different claim gives 409 without changing the
winner. Replaying a rotated/revoked credential's receipt gives 409 and cannot revive
it. After 24 hours the phone tests its stored candidate credential with `/device`;
it must not automatically enroll again. Pairing metadata may be pruned after 90 days;
then even its old correct proof receives generic 401.

Replacement requires a new owner-issued capability targeting an active device. It
preserves device identity, revokes the old credential, increments revision and
activates exactly one replacement in the same transaction, with no overlap window.
Revocation is permanent and invalidates all credentials plus pending replacements.
Other devices are unaffected. Device/credential history cannot be hard-deleted.

## Migration and concurrency

[037_flowlink_device_enrollment.sql](../../server/migrations/037_flowlink_device_enrollment.sql)
adds exactly three relations:

- `flowlink_devices`: UUID identity, safe label, active/revoked lifecycle and owner audit.
- `flowlink_device_credentials`: UUID identity, device FK, unique 32-byte digest,
  positive revision and immutable revocation history; unique `(device_id,revision)`
  and partial unique active credential per device.
- `flowlink_pairing_capabilities`: digest, fixed command/target, TTL, attempts and
  terminal-state constraints, unique redemption UUID and immutable result receipt;
  partial unique pending replacement per device, owner/time and expiry indexes.

Foreign keys use RESTRICT. All three relations have RLS, no client policies, and no
direct PUBLIC/anon/authenticated/service-role grants. Seven SECURITY DEFINER RPCs,
with pinned search paths, are executable only by service_role:
`create_flowlink_pairing`, `redeem_flowlink_pairing`, `cancel_flowlink_pairing`,
`revoke_flowlink_device`, `get_flowlink_device`, `list_flowlink_devices`,
`cleanup_flowlink_pairings`. Validation/projection helpers are private. Three guard
triggers protect device, credential and capability state/history.

Mutations obtain the existing APY `transactions` EXCLUSIVE table lock first, then
device/credential/capability locks, and recheck current state. The conservative
contract lock serializes enrollment/replacement/revocation with future money-write
commands; it does not write transactions. Same-claim races commit one identity.
Conflicting races retain the winning receipt. Revocation/replacement ordering is
tested in both directions with actual competing PostgreSQL sessions. Safe aborted
DB lock/deadlock/serialization failures may retry once with identical RPC arguments;
transport uncertainty returns 503 so the caller reuses its stored claim.

The migration is transactional, rerunnable and additive after 036; no backfill,
financial mutation, 036 edit or existing guard replacement. The same SQL is appended
to [full_schema.sql](../../server/full_schema.sql), following existing schema maintenance.
Cleanup is bounded to 500 expiry transitions and 500 old capability removals per call,
also invoked opportunistically during pairing creation. No scheduler is added.

Apply only with separately authorized owner operations. Migration 037 was tested
only in portless disposable PostgreSQL containers. Production 036 evidence is historical;
it does not imply 037 was applied. Before production use, review/apply 037 and set the
owner allowlist separately. No production configuration/secret was read or changed.

Recovery: missing configuration fails closed. Stop new use by removing the allowlist
in a separately authorized operation; retain schema/identity history. Use owner
revocation for a lost device, replacement pairing for a retained installation's lost
credential. Forward-fix after identities exist; never advise dropping APY provenance
or reverting to hard deletion. No rollback should discard credentials/receipts while
phones may be recovering an uncertain response. An aborted migration rolls back in
full; investigate its cause before retry. The legacy Apple route/flag remains untouched.

## Verification and release gate

Local verification on 2026-09-26, against this worktree:

| Command (repository root) | Result |
| --- | --- |
| `node --test server/test/flowlink.test.js` | 22/22 passed. |
| `npm test --prefix server` | 397/397 passed, including those 22 focused tests. |
| `node --test server/test/flowlinkPostgres.local.test.js` | 25/25 passed before the final two edge cases were added. |
| `node --test --test-name-pattern="receipt recovery ends\|active-device cap" server/test/flowlinkPostgres.local.test.js` | Both added cases passed: 27 distinct FlowLink DB cases verified in total. |
| `node --test server/test/transactionIngestionPostgres.local.test.js server/test/applePayPostgres.local.test.js` | 44/45 initially passed; the schema-equality fixture still stopped at 036. |
| `node --test --test-name-pattern="ordered 029 foundation" server/test/transactionIngestionPostgres.local.test.js` | 1/1 passed after extending the ordered chain to the current schema (037): all 45 distinct APY/Apple DB cases verified. |
| `node server/test/run-savings-release.cjs` | 39/39 selected final-schema cases passed: manual 9, interest 9, monthly 8, surplus 8, reporting 5. |

Two initial FlowLink test-harness failures (lost-response injection and cleanup
fixture ordering) were corrected before the successful 25-case run. The APY fixture
change preserves its full-schema equality assertion; it does not exclude FlowLink
objects to hide a difference. No runtime accounting regression was found. Git
whitespace, strict UTF-8, local Markdown file links, schema append parity and all seven
unchanged 1.3.1 fields passed. Client suites were not rerun: no client/shared API
contract was changed. No pre-existing client failure is claimed as retested here.

Focused
HTTP tests use synthetic identities; disposable integration exercises the same
router/service against PostgreSQL through the service-role RPC boundary, not a real
Supabase/PostgREST deployment. No owner web UI, Keychain, hardware or production
verification is claimed. The next mobile and binding tasks remain separate.

- Release impact: **Yes**, new backend device enrollment capability.
- SemVer impact: **Minor**, additive and backward compatible.
- Candidate release: **proposed v1.4.0**, subject to #84 revalidation.
- Grouping: **#85 / FLI-01–06**, coordinated with existing **#78 / APY** candidate.
- CHANGELOG: **Updated under Unreleased**, #87 entry only.
- Version bump: **Deferred** to coordinated release preparation; all seven fields stay 1.3.1.
- Publication: **Out of scope / not performed**.
- Owner verification / acceptance: **Pending** for #87.
- Production migration/deployment/configuration: **Not performed**, separately authorized.
- Commit/push: **Not performed**; owner-operated.
