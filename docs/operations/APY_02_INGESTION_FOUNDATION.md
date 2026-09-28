# APY-02 implementation and local verification

> Contract/technical reference. Dated implementation and verification notes are historical checkpoints; use the [documentation index](../README.md) for current release/acceptance boundaries and GitHub for live workflow state.

Issue [#80](https://github.com/OzAvrahami/finance-tracker/issues/80), grouped under
[#78](https://github.com/OzAvrahami/finance-tracker/issues/78). Implements the accepted
[APY-01 contract](../architecture/APPLE_PAY_TRANSACTION_RECONCILIATION.md), based on main commit
`034bc068701bb1547d4c20724f331cf8f190ac8e`. Owner acceptance of **this implementation
is pending**. The source-aware commands are private foundations: no Apple route,
Shortcut credentials, CAL producer transition or review UI is mounted.

## Persistence and trust boundary

[Migration 036](../../server/migrations/036_transaction_ingestion_foundation.sql) follows
the final Savings schema through 035. Its identical SQL is appended to
[full_schema.sql](../../server/full_schema.sql), preserving the pre-036 schema.

| Relation | Identity, constraints and purpose |
| --- | --- |
| `transaction_ingestion_sources` | BIGINT identity; unique `(source_kind, instance_key)`; active flag; revision; bounded approved configuration; server timestamps. Logical producers, not credentials. |
| `transaction_source_observations` | BIGINT identity; unique `(source_id, idempotency_key)`; optional **non-unique** provider-reference tuple; nullable INTEGER canonical `transaction_id`; immutable accepted input/hash and receipt time; money/time/card/merchant evidence; disposition, revision and sticky overrides. |
| `transaction_reconciliation_events` | BIGINT identity; append-only decisions and bounded evidence; unique UUID command receipt; source/observation/transaction references; actor, reason, revision and server event time. No accounting rows. |

Foreign keys use RESTRICT, not cascading history deletion. Pure legacy mirrors have
an explicit conditional cleanup path; APY enrollment or an audit event protects them.
The old `transactions.external_id` partial unique index is unchanged. Candidate
indexes are **not unique**: `idx_source_observation_candidates` (card/type/currency/
money/date), `idx_source_observation_transaction`, GIN
`idx_source_observation_reference`, and `idx_reconciliation_observation`.

All three tables use RLS. PUBLIC, anon, authenticated and service_role receive no
direct table/sequence grants. Only service_role can execute these SECURITY DEFINER
commands; private `apy_*` helpers are not callable by those client roles:

| RPC | Service export / purpose |
| --- | --- |
| `configure_ingestion_source(uuid,jsonb)` | `configureSource`: trusted registration/configuration/revocation, expected revision on updates, audited UUID receipt. |
| `ingest_observation(bigint,jsonb)` | `ingestObservation`: normalize, replay/conflict check, candidate decision and cash/provenance/audit in one transaction. |
| `amend_observation(uuid,jsonb)` | `amendObservation`: deliberate CAL charge-date evidence, original input remains immutable. |
| `resolve_observation(uuid,jsonb)` | `resolveObservation`: explicit owner link/separate decision with expected revision and current transaction/candidate fingerprints. |
| `cancel_ingested_transaction(uuid,jsonb)` | `cancelIngestedTransaction`: idempotent, audited cancellation of eligible ordinary APY cash. |
| `get_ingestion_observation(bigint)` | `getObservation`: **owner/server-only** detail and current review fingerprints. Never expose this to source-only credentials. |

[transactionIngestionService.js](../../server/services/transactionIngestionService.js)
takes an injected database client. Trusted callers bind the source ID independently
of the payload. APY-03 must supply narrow authentication and credential-to-source
mapping; accepting a caller-supplied source ID at an HTTP boundary is not authorized.
No secrets are stored in source configuration. Event metadata is allowlisted and
bounded; Authorization headers, keys and arbitrary raw request bodies are rejected.

Four new triggers: `apy_events_immutable`, `apy_observations_immutable`,
`apy_legacy_mirror`, `apy_guard_transaction`. The existing
`savings_guard_transaction()` changes only to permit an ordinary APY void backed
by a private cancellation receipt **in the same database transaction**. A session
flag cannot authorize cancellation. Existing Savings/domain restrictions remain.

Private helper inventory (all `public.apy_` prefix): `hash`, `keys`,
`review_fingerprints`, `payment_source`, `charge_evidence`, `create_cash`, `enrich`,
`receipt`, `merchant`, `date`, `identity`, `cash_fingerprint`, `protected`, `captured`,
`result`, `rejected`, `normalize`, `append_only`, `observation_guard`, `mirror_cash`,
`legacy_mirror_trigger`, `transaction_guard`, `cancel_authorized`.
The pinned Unicode character tables in `apy_merchant` are reproducible with
[apyUnicode.js](../../server/test/helpers/apyUnicode.js); normalization version 1 uses
NFKC and invariant per-codepoint lowercase, preserving diacritics independently of
PostgreSQL locale. Future Unicode upgrades require deliberate version review.

## Input and matching

Internal call example (IDs and decimal amounts are strings):

```js
await ingestObservation(db, registeredSourceId, {
  idempotency_key: 'producer-persisted-capture-key',
  merchant: 'AROMA', accounting_amount: '24.00', currency: 'ILS',
  movement_type: 'expense', transaction_date: '2026-09-22',
  payment_source_id: '1', occurred_at: '2026-09-22T08:30+03:00'
});
```

`occurred_at` and `provider_reference` are optional. A reference, when supplied, is
`{provider,type,scope,value}`. It does not replace the mandatory source-scoped key.
APY-03 still must verify actual iPhone fields and a producer strategy that preserves
the key across retries. No Wallet capabilities have been verified here.

Source configuration allows bounded `payment_source_ids`, `card_mappings`
(`card_reference`, `payment_source_id`), approved `aliases` (`merchant`, `key`, optional
`payment_source_id`), `time_verified`, and `verified_references` namespace tuples.
Configuration changes are revisioned and audited; alias learning is never automatic.
An explicit permitted ID, approved device/card mapping or uniquely matching active
card evidence resolves the payment source. Zero/multiple matches reject without
cash. Legacy last4 behavior is unchanged.

Accounting matching uses exact decimal strings -> BigInt / NUMERIC minor units,
not floating-point equality. Initial creation requires positive exact ILS cents;
84.90 becomes 8490. Original foreign amount/currency/declared scale may be retained
as evidence, but there is no FX conversion or change to legacy accounting storage.
Simple expense/income creation uses existing `transactions`, never observations
as accounting. No Savings, Loan, installment, item, LEGO, Shopping, allocation or
keyword-learning commands are invoked.

Source date and charge date remain independent. Explicit purchase DATE is retained;
otherwise a qualified instant supplies its Asia/Jerusalem date. Naive timestamp text
is preserved as non-comparable evidence. Minute/second/fractional precision and the
original offset text are retained; `observed_at` is immutable server receipt time.
An explicit DATE differing from the Jerusalem instant date sets `date_discrepancy`.

Candidates use original source evidence, resolved card, exact money/basis, movement,
merchant/approved alias and purchase date +/- one day. Only the approved Apple/CAL
pair automatically reconciles; legacy mirrors and manual rows are not guessed into
matches. File-import source registration is foundational, not an import transition.
At most 100 candidate IDs are retained; overflow requires review, never creation.

Decision order follows APY-01: unique verified common reference; uniquely compatible
precision intervals with no undated competitor; guarded unique same-date tuple when
time is missing; otherwise pending/conflict. Minute 08:30 and 08:31 intervals touch;
precise instants with a real minute gap are not rounded into a match. Distinct verified
times can establish separate purchases. Same-source independent keys are not merged.
Saturated candidates, pending competitors, identity edits, protected or cancelled cash
prevent unsafe attachment. A coarse signature is never unique purchase identity.

| Scenario | Outcome | Financial effect |
| --- | --- | --- |
| New supported observation, no plausible candidate | `created` | One live ordinary transaction, immediately visible to existing readers. |
| Strong eligible existing candidate | `reconciled` | Zero additional cash; permitted provisional charge enrichment only. |
| Multiple plausible candidates / insufficient evidence | `ambiguous` | Observation pending, transaction ID null, zero new cash. Includes CAL-first Apple arrivals. |
| Identical source/key/normalized accepted payload | `already_observed` | Existing ID/current disposition; zero new observation or cash. |
| Same key, conflicting payload | `conflict`, `idempotency_key_conflict` | Original input/cash unchanged; bounded conflict event. |
| Cancelled or identity-edited matching cash | `conflict` | No resurrection or automatic financial overwrite. |
| Invalid input/unresolved payment source/disabled source | `rejected` | No cash; no accepted observation. |

Results contain observation/transaction IDs as strings or null, `outcome`,
`original_outcome` on replay, `disposition`, `review_required`, `reason_code`,
`replayed` and `decision_revision`. Ingest results never contain competing IDs.
Command UUID receipts reject conflicting reuse. Capture retries retain their original
fingerprint even after an amendment or review. Pending charge amendments are applied
on later authorized creation/linking; they do not rewrite the original payload.

User category, description, notes and tags are never automated enrichment targets.
Identity edits and charge overrides are sticky even if subsequently edited back.
CAL may replace an APY-created provisional charge date once, subject to existing
Budget capture/domain guards. Manual/legacy charge dates are not treated as provisional.
Owner review links or creates a separate purchase explicitly; consolidation of two
already-linked financial rows and its UI remain future APY work, not a hidden merge.

## Atomicity, cancellation and compatibility

Source-aware commands acquire `LOCK TABLE transactions IN EXCLUSIVE MODE` before
source/observation locks, including before any SELECT FOR UPDATE. This serializes
candidate scan/recheck and cash creation against transaction writers and row lockers
while allowing ordinary SELECT readers. It is intentionally conservative for current
volume. Replacing it with finer locks requires proving the same first-delivery races.
There are no external calls while holding it. Payment/category validation takes share
locks before creation. Deadlock/serialization/lock-timeout codes are retried once by
the Node boundary with the identical key; another failure is returned as retryable.

Cancellation needs a UUID receipt, observation revision, current cash fingerprint,
actor and reason. It preserves cash/provenance IDs and all financial fields, sets
the existing four void fields and records an event. Loan/Savings/installment/itemized/
LEGO/Shopping/foreign/captured-history cash cannot use generic cancellation. Retrying
the same command is safe; later capture replay reports cancelled, never recreates cash.

The v1 controller retains its route, authentication, payload validation, 201 response,
409 duplicate/cancelled variants, missing/blank-ID behavior and dry-run behavior.
Its insert is delegated through `insertLegacyTransaction`, preserving the original
Supabase call/result shape. An AFTER INSERT/UPDATE trigger mirrors non-empty external
IDs **atomically**, including inserts outside that wrapper. It performs no matching.
No-ID transactions still have no invented idempotency. Empty-ID uniqueness stays in
the existing index. Pure legacy ordinary deletion cleans its mirror and releases the
ID; retained cancelled rows reserve it. Explicit APY enrollment protects history and
requires the owner cancellation path thereafter.

## Migration and recovery

Migration 036 is transactional and rerunnable. It creates the legacy_api/default
registry entry, then mirrors each non-empty historical external ID with
`evidence_origin=legacy_backfill`, `legacy_unverified`, unknown original receipt time,
and no invented occurrence time or CAL/Apple identity. Backfill leaves transaction IDs,
amounts, dates, void state and domain associations byte-for-byte unchanged. Unsupported
legacy precision is retained as unmatchable evidence, not rejected or rounded.

Verification used only disposable PostgreSQL 16 Alpine containers with an explicit
test label, no published ports, synthetic data and no environment/production DB URL.
The test runner checks its container identity before DDL and removes its own container.
Clean installation uses the maintained full schema through 036; upgrade tests start
from the pre-APY schema through 035, including an ordered 029 foundation + 030-036 run.
An injected failure proves transaction rollback and safe rerun; fault injection after
cash creation proves cash/observation/event rollback together.

Production migration/deployment are **not performed or authorized by this handoff**.
Future rollout should back up first, apply reviewed 036 in a bounded maintenance window
(it locks transactions), and verify backfill/grants before enabling any future adapter.
Migration failure rolls back as a unit. After source-aware transactions exist, recover
forward: disable affected producer mappings, preserve IDs/keys/receipts, and deploy a
reviewed correction. **Do not drop provenance or revert to hard deletion.** Before any
source-aware writes, restoring a verified pre-migration backup is an operational owner
decision, never an automatic rollback script. Application rollback must keep the 036
guards and database provenance while producers remain disabled.

## Verification and limitations

Exact reproducible commands from repository root (Docker Desktop running for DB tests):

```powershell
node --test server/test/transactionIngestion.test.js
npm test --prefix server
node --test server/test/transactionIngestionPostgres.local.test.js
node server/test/run-savings-release.cjs
npm test --prefix client
npm run build --prefix client
git diff --check
```

Results on 2026-09-23:

| Check | Result |
| --- | --- |
| APY unit/service | 10/10 passed; also included in server total below. |
| All server/API tests | 355/355 passed, zero skipped. |
| APY disposable PostgreSQL | 31/31 passed, zero skipped; final 036 schema, 112.8 seconds. |
| Existing final-schema Savings matrix | 39/39 selected checks passed: Manual 9, Interest 9, Monthly 8, Surplus 8, Reporting 5. Historical stage-only assertions are excluded, not counted as passes. Run after adding 036; subsequent APY-only normalization/amendment refinements did not alter the Savings guard. |
| Client | 544/548 passed; 4 pre-existing Import portal-query failures, investigated below. |
| Client production build | Passed; existing large-chunk advisory (no build error). |
| Documentation/schema checks | Strict UTF-8, local Markdown links, unchanged pre-036 schema, identical migration/full-schema append, reproducible Unicode tables and whitespace passed. All seven version fields remain 1.3.1 and their files are unchanged. |

Database tests exercise real
concurrent psql sessions, same-key and conflicting-key races, cross-source first
delivery, manual row-lock contention, exact money/time, CAL-first ambiguity, review,
amendment, cancellation, original v1 controller against real SQL persistence, legacy
backfill/void identity, grants, and final Savings/Loan/Budget protections. They do not
constitute a production-volume performance benchmark or iPhone/browser acceptance.

No frontend, real Wallet device or production interaction was tested manually. Existing
client Import tests contain a known scope error: options are portaled to document.body
but four tests query within the table. This is documented separately from APY checks;
APY-02 does not change the client. An isolated archive of the accepted main commit
reproduced the same 4 failures (9/13 passed). In that temporary copy only, changing
the portal lookups to screen scope yielded 13/13; this diagnostic is not counted as
a passing repository suite. Preserve this limitation at owner acceptance. No unrelated
client correction is included in #80.

## Release / Version gate

- Release impact: **Yes** — new additive ingestion/provenance capability.
- SemVer impact: **Minor**, backward compatible, grouped APY initiative.
- Candidate release: **proposed v1.4.0**, subject to APY-06 revalidation against the then-current release line.
- Grouping / included release candidate: **#78 / APY-01-06 (#79-#84)**; #80 is the foundation only.
- CHANGELOG status: **Updated under Unreleased**, #80 entry.
- Version-bump status: **Deferred** to owner-operated APY-06 coordinated preparation; all seven authoritative fields remain **1.3.1**.
- Publication status: **Out of scope**.
- Owner verification / acceptance status: **Pending review**.
- Production deployment/migration: **Out of scope for #80**; neither performed.

Owner review: inspect migration/security grants and conservative lock scope; compare
legacy/void behavior with the accepted contract; review race and no-double-counting
evidence and the client-test limitation; accept the uncommitted implementation before
the owner's manual commit. Do not start APY-03 as part of this handoff.
