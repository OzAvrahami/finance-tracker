# Issue #99 - Package 1: ingestion and reconciliation

**Final local acceptance complete (2026-11-08):** owner-reported frontend checks
and the remaining authenticated stale-decision check passed. **Production cutover
remains NO-GO.** This package does **not** complete #99, change a release version,
establish production acceptance, or activate a producer. Earlier Pending statements
below describe their historical checkpoints; the final acceptance section and
Release / Version gate record the current state.

## Evidence and baseline

Repository baseline: `251d906ccdeec2dd5e7b5b2e3d1ff565da0810d4`, through 057,
including the refund-edit fix. Before extraction the disposable unified suite
passed 31/31. Current production definitions were **not inspected** during this
package. Deployed definitions, unknown external RPC consumers, production load,
applied migration state and backup/recovery availability remain unverified.
Historical owner deployment reports do not substitute for current catalog evidence.

The repository's delivery path was `ingest_external_transaction -> unified_ingest
-> apy_create_cash`. `ingest_cal_v1` and `ingest_general_transaction` are historical,
revoked delivery engines; their presence is not proof of a current CAL caller.
The authenticated historical general-receipt correction route **is** a current
caller of `resolve_general_receipt -> evaluate_general_transaction`, so it is
included. Historical migrations remain unchanged. The final definitions obtained
by applying 058, not earlier copies within full_schema.sql, are authoritative for
this candidate.

## Ownership and dependency matrix

All moves below occur in migration/application stage 058. Paths are relative to
`server/`. Tests are listed in the verification section.

| Rule / prior owner | Actual application callers | JavaScript authority | Retained PostgreSQL invariant / evidence |
| --- | --- | --- | --- |
| v1 validation / `ingest_external_transaction` | `controllers/v1/transactionController.js`, `externalTransactionBulk.js` | Existing `unifiedTransactionIngestion.js` schema plus `ingestion/policy.js` | Typed storage, request/evidence signed-amount congruence; single/Bulk tests |
| Merchant, time, money / `apy_normalize` | Every observation intake | `ingestion/normalization.js` | DB canonical hashing, exact NUMERIC; Unicode/FX/microsecond parity tests |
| Source/payment/category / external + `apy_payment_source` | v1, manual, CSV, Wallet adapters | `ingestion/policy.js` | FK, source identity/configuration snapshot, active source and device binding access checks |
| Expense/income/refund / external + `apy_create_cash` | v1 single and Bulk | `ingestion/policy.js` | Signed amount equals immutable observation; refund marker and explicit request agree |
| Eligibility, weak/strong matching / `unified_ingest`, `ingest_observation` | All intake services | `ingestion/reconciliation.js` | Unique source/key, initial identity, fixed target consistency, locked snapshot |
| Historical identities/replay | Same callers; historical CAL/general receipts | `ingestion/core.js`, policy | Immutable receipts, cancellation reservations, DB hash, unique identities |
| Charge-date enrichment / `apy_enrich` | CAL observations, amendment, owner link | `ingestion/reconciliation.js` | Fixed charge-date update plus append-only event in one transaction |
| Review/link/separate / `review_reconciliation`, `resolve_observation` | `routes/reconciliationRoutes.js` | `ingestion/core.js`; `ingestion/readers.js` uses the same eligibility functions | Revision, canonical fingerprints, request-key receipts, atomic event/cash writes |
| Amendment / `amend_observation` | `transactionIngestionService.amendObservation` internal adapter | `ingestion/core.js` | Original payload immutable; revision/event append |
| Cancellation / `cancel_ingested_transaction` | Existing owner service | `ingestion/core.js` | Void/event atomicity, original identity retained; domain guards still reject linked financial deletion |
| Historical receipt correction / `resolve_general_receipt`, `evaluate_general_transaction` | Owner receipt-resolution route | `ingestion/historicalReceipts.js` | Immutable original receipt, unique revision/request key and atomic resolution + observation |
| Manual intake / `ingest_owned_transaction` | `controllers/transactionController.js` | Shared core, then existing controller/domain orchestration | Existing Loan writer, manual scheduling/LEGO boundaries, guarded domain transactions |
| CSV intake / `ingest_owned_transaction` | `controllers/importController.js` | Shared core/policy | Durable document-row identity; no generated installment siblings |
| Wallet device intake / `ingest_flowlink_observation` | `flowlinkService.js` via `transactionIngestionService.js` | Core/normalization, existing route authentication | Credential/device/binding congruence rechecked atomically; no activation |
| Apple Pay source adapter | `applePayIngestionService.js` via shared service | Existing adapter + shared core | Configuration/source permissions retained |
| UI projections / `read_reconciliation`, `apy_ui_transaction` | Owner routes and existing reconciliation clients | `ingestion/readers.js` for eligibility | SQL returns stored rows, aggregate status and canonical fingerprints only |
| Domain protection exception / `apy_protected`, `apy_captured`, legacy mirror helpers | Existing cancellation/domain guards and triggers | JS makes ingestion/review decisions | Retained as essential independent integrity restrictions on domain-linked or financially captured rows; not a second ingestion engine |
| Configuration authorization | Owner/device binding configuration RPCs | Existing configuration adapters | Singleton/device ownership, immutable mappings, RLS and privileged access remain; not another ingestion API |

No job writes through a retired ingestion RPC in the inspected runtime tree.
No frontend calls these privileged database commands directly. The existing
controllers and domain writers keep their API shapes and responsibility for
manual installments, LEGO, Savings, Loan and Shopping workflows.

## New request-to-database flow

1. Existing authentication and v1/Wallet/manual/CSV adapter validate the public
   request. Existing Bulk remains 1-50 independent items with partial success.
2. `ingestion/core.js` obtains `ingestion_core_snapshot(scope)` through the
   service-role client. The snapshot contains data facts, canonical hashes,
   fingerprints, configuration revisions, candidate rows and domain links.
3. JavaScript normalizes exact evidence, resolves policies, evaluates candidates
   and produces a fixed operation: ingest, replay/conflict, link/separate,
   manual approval/resume, amendment, cancellation or historical correction.
4. `ingestion_core_commit(scope, token, decision)` locks `transactions` in
   EXCLUSIVE mode, then the supporting configuration/evidence/domain tables in
   SHARE ROW EXCLUSIVE mode. It recomputes the snapshot and rejects changed facts
   with SQLSTATE 40001 **before any write**. Lock timeout is 3 seconds.
5. Private `ingestion_core_apply` / `ingestion_core_post` persist only typed,
   fixed operations. They check observation/scope membership, source/device
   binding, amount/direction/payment/date congruence, immutable identities,
   target/revision/fingerprint consistency and linked domain constraints.
   Cash, evidence, receipt and history commit or roll back together.
6. Known rolled-back serialization/deadlock/lock-timeout errors get one bounded
   fresh-snapshot retry. Unknown commit never triggers an automatic second post
   or old-engine fallback. The caller preserves the frozen key/evidence and
   recovers via its durable identity. Bulk stops after an uncertain item.

The scope token is an optimistic consistency token, not a public authorization
capability. Only service_role may call snapshot/commit; PUBLIC/anon/authenticated
cannot. The role cannot call private apply/post. The trusted application owns
policy, while persistence rejects inconsistent fixed-operation plans rather than
accepting arbitrary table/column patches. Existing RLS, privilege boundaries,
identity/append-only triggers and domain consistency constraints are retained.

The lock set deliberately preserves the existing global transaction serialization
boundary and also protects the facts read by JS. It is coarse and can contend
with domain/configuration writes. Production throughput and timeout behavior
must be assessed during the authorized cutover; no throughput claim is made.
Candidate scans are bounded; overflow holds for review rather than posting cash.

## SQL simplification

058 removes the active definitions of `ingest_external_transaction`,
`ingest_owned_transaction`, `unified_ingest`, `ingest_observation`, `apy_normalize`,
`apy_payment_source`, `apy_create_cash`, `apy_enrich`,
`ingest_flowlink_observation`, `review_reconciliation`, `resolve_observation`,
`amend_observation`, `cancel_ingested_transaction`, `resolve_general_receipt`,
`evaluate_general_transaction`, `ingest_cal_v1`, `ingest_general_transaction`,
and the detached `cal_external_guard` / `general_external_guard` functions.
Migration 054 already replaced their triggers with `unified_external_guard`;
058 keeps that generic protection and uses no CASCADE when removing old functions.
It does not drop their historical migrations, tables, receipts or financial rows.
It simplifies `read_reconciliation` and `apy_ui_transaction` to data projection.
There is no temporary production fallback to these engines.

Canonical JSON/hash primitives, cash/review fingerprints, immutable evidence
triggers, unique identities, the generic external posting guard, RLS, device
security and atomic domain writers stay. `ingestion_core_row` is a mechanical
numeric JSON storage projection: it preserves the old numeric representation
in immutable `_creation` payloads. JS does not replace PostgreSQL JSONB
canonicalization with JSON.stringify hashing.

## Explicit behavior and contract boundaries

- Refunds: the existing positive `type: refund` contract produces a **negative
  expense**, with `bank_movement: refund`. Eligibility no longer depends on
  bank/card/payment-method type. Identity, mapping, currency and reconciliation
  requirements still apply. Synthetic WHOP ILS 557.55 is a normal test vector,
  not an allowlist or exception. Income remains independently limited to the
  established explicit bank-account policy.
- Date/amount/merchant alone never auto-link two observations. Weak evidence
  remains reviewable without extra cash; independently verified reference or
  compatible verified timestamp evidence can auto-link. Identical independent
  same-source keys remain separate purchases.
- Refund category/notes edits retain the signed amount, expense type, refund
  flag, null installment count and immutable evidence. No frontend relaxation
  for ordinary negative expenses or new transactions is introduced here.
- Imported installment observations preserve only the observed charge. The v1
  contract lacks a separate purchase-series identity; such items remain held
  for reviewed individual posting, and whole-purchase overlaps remain held.
  CSV bank movements retain their existing financial-semantics hold.
- Foreign accounting preserves charged ILS and existing original currency/
  original_amount provenance. No exchange rate or fee is invented. Foreign
  refunds outside the established ILS refund contract are not newly supported.
- Transfers, ambiguous bank events and repayments are not inferred from signs
  or merchant names. No public fields, per-card registrations or account aliases
  are introduced. Existing historical #96 receipt correction still checks its
  original registration/evidence rules; this does not re-enable that intake API.

Read-only producer source inspection found CAL `refundInd` currently retained as
`CAL_REFUND_INDICATED` review evidence in Bank Data Sync. A provider collection
section called installments is **not** proof of installment_number/count. The
producer must supply a verified existing explicit refund request, not invent a
schedule from section membership. Bank Data Sync was not modified or run, no
real bank evidence was read, and no live CAL producer acceptance is claimed.
Financial Data Bridge's repository was not inspected or used.

Previously held observations retain their stored outcomes on replay. A held
unsupported-refund observation needs a separately reviewed correction/resolution
procedure; ordinary retry alone does not promote it.

Historical missed-refund recovery is separate: inspect the frozen provider
identity/evidence and existing observations/receipts/ledger first, determine
whether owner resolution or a separately authorized frozen-identity retry is
appropriate, and verify accounting totals. Do not mint a new ID to bypass a
held receipt, replay historical deliveries, or repair financial rows automatically.

## Deployment, compatibility and recovery

**Mandatory coordinated maintenance window. No rolling mixed-backend window.**

1. Owner reviews this package, the migration and test evidence. Verify the actual
   deployed application/schema/catalog, unknown RPC clients, 057 prerequisites,
   source/device mappings and all existing receipt/observation/cancellation
   counts. Inspect privileges and function/trigger/view definitions, not only
   migration filenames. Resolve #97/#98 catalog-management questions separately.
2. Establish a private schema+data backup and disposable restore evidence if
   available. Backup availability is unverified here; do not mark it Passed or
   assume a paid plan. If unavailable, the owner must explicitly decide the
   recovery risk for this cutover; a past preparation-only waiver is not approval
   for this migration.
3. Freeze external delivery and owner financial writes; drain in-flight work.
   Keep FlowLink paused and do not activate producers. Prevent old backend
   instances/workers from serving writes during the window. A push may trigger
   Railway auto-deployment; coordinate that explicitly before the owner's push.
   This includes the checked-in `process-due-loans.yml` scheduled/manual workflow,
   both `/api/internal/jobs/process-due-loans` and `process-due-savings`, Shopping
   checkout, manual installment/domain writes and any independently scheduled
   Savings caller. Inventory production cron/Edge Functions/direct RPC users and
   database sessions separately; a repository search cannot prove their absence.
   Stopping only the v1 endpoint does not establish a quiescent writer window.
4. With writers quiesced, apply **only 058** once using the verified owner DB
   connection. Example (owner only, private pg_service configuration):
   `psql "service=finance_owner" -X -v ON_ERROR_STOP=1 -f server/migrations/058_ingestion_application_boundary.sql`.
   Never apply full_schema.sql to production. A lock timeout aborts the migration;
   investigate/drain the blocker before retrying the complete transaction.
5. Deploy the reviewed backend while writes remain paused. Verify every instance
   serves that version. The old backend fails after 058; the new backend fails
   against 057. Neither combination is a supported write-compatible state.
6. Re-read catalog/grants, compare immutable history/financial snapshots and
   existing transaction fingerprints to preflight, verify owner read/review
   screens and health, and confirm retired RPCs are absent. No synthetic financial
   production test or producer activation is authorized by this package.
7. Resume only previously authorized channels after explicit owner acceptance.
   Monitor errors, review counts and unknown outcomes using safe metadata.

Read-only catalog checks, run within `BEGIN READ ONLY; ... ROLLBACK;`:

```sql
SELECT p.oid::regprocedure, p.prosecdef, p.proacl, pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND
 (p.proname LIKE 'ingestion_core_%' OR p.proname IN
 ('unified_ingest','ingest_external_transaction','apy_create_cash',
  'read_reconciliation','unified_external_guard'));
SELECT tgrelid::regclass, tgname, pg_get_triggerdef(oid)
FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN
 ('transactions'::regclass,'transaction_source_observations'::regclass,
  'transaction_reconciliation_events'::regclass);
SELECT has_function_privilege('service_role','ingestion_core_commit(jsonb,text,jsonb)','EXECUTE'),
       has_function_privilege('authenticated','ingestion_core_commit(jsonb,text,jsonb)','EXECUTE'),
       has_function_privilege('service_role','ingestion_core_apply(jsonb,jsonb,jsonb)','EXECUTE');
-- Expected after 058: true, false, false.
```

On failure: keep writes paused, preserve the exact failed migration/application
identity and unknown delivery keys, and inspect committed state read-only. Before
058 commits, PostgreSQL transaction rollback preserves the old backend boundary.
After it commits, rolling back only the application is unsafe. Prefer a reviewed
forward fix. Restoring former function definitions or restoring a database needs
separate owner authorization, verified recovery assets and analysis of any new
058 financial writes; never erase receipts/identities or assume a restore exists.

## Original implementation verification

Verified locally on 2026-11-08 with Node v24.11.1 and disposable PostgreSQL 16
containers, using synthetic data and the existing installed dependencies.

| Check | Final result |
| --- | --- |
| Pre-extraction unified PostgreSQL baseline | 31 passed |
| Canonical backend runner, plus new core unit coverage | 601 passed, 0 failed, 0 skipped |
| Frontend Vitest | 756 passed across 51 files |
| Frontend lint / production build | Passed; existing large-chunk build warning remains |
| New core PostgreSQL suite | 19 passed |
| Current Apple Pay and FlowLink binding PostgreSQL suites | 41 passed |
| Historical CAL and reconciliation-review suites | 36 passed, 1 existing optional exporter audit skipped |
| Eight broader PostgreSQL suites, after affected-suite reruns | 272 passed |
| Unique selected PostgreSQL total (13 files; reruns counted once) | **368 passed, 0 remaining failures, 1 optional skip** |
| Whitespace, schema suffix and preservation checks | Passed |

The first eight-suite run reported 259 passed / 13 failed. These failures exposed
historical harnesses mixing schema generations, not failures to be ignored:

- The 037 upgrade assertion now checks the exact pre-054 snapshot at 037 and
  explicitly asserts the three 054 sources plus the nullable 057 column when
  comparing the later schema; all original financial values remain compared.
- Two general-API tests now separate the historical 053 HTTP adapter from the
  current owner-resolution route. The latter upgrades through 058 and exercises
  the real JavaScript service and PostgreSQL boundary.
- Ten 036 tests now use the actual 036 schema and archived controller, preserving
  their original matching, legacy decimal, protection and migration assertions.
  Current behavior has separate 058 coverage rather than changing historical
  expectations to imitate the new implementation.

All three affected complete suites were rerun together: **78 passed / 0 failed**.
The other five broader suites had passed without changes. These are combined
final results, not a claim that the first broad invocation was green. Historical
fixtures are test-only and are never a runtime fallback.

The new core integration coverage includes before/after payload/hash parity,
all-method refunds and independent income policy, exact money and FX, microsecond
timestamps, installments and whole-purchase holds, 8/10 and 50-item Bulk behavior,
concurrent replay, stale decisions/configuration, unknown acknowledgment, injected
rollback, forged-plan rejection and privileges, manual/CSV/Wallet ordering,
owner link/amend/cancel, refund metadata save/reload, domain-protected Loan writes,
38 historical CAL receipt reservations, fresh/upgrade parity and migration lock
timeout rollback. Existing refund-edit frontend regressions also passed.

Reproduce the JavaScript/client checks with `npm --prefix server test`,
`node --test server/test/ingestionCore.test.js`, `npm --prefix client test`,
`npm --prefix client run lint`, and `npm --prefix client run build`.
Run the PostgreSQL files below from `server/` with
`node --test --test-concurrency=1 <files>`; they create disposable databases:

```text
test/ingestionCorePostgres.local.test.js
test/applePayPostgres.local.test.js
test/flowlinkBindingsPostgres.local.test.js
test/calReconciliationPostgres.local.test.js
test/reconciliationReviewPostgres.local.test.js
test/flowlinkPostgres.local.test.js
test/fundedBudgetPostgres.local.test.js
test/generalTransactionPostgres.local.test.js
test/savingsManualPostgres.local.test.js
test/savingsPostgres.local.test.js
test/shoppingPurchasePostgres.local.test.js
test/transactionIngestionPostgres.local.test.js
test/unifiedIngestionPostgres.local.test.js
```

Local logs are outside Git in
`C:\Users\ozavr\AppData\Local\Temp\finance-99-t903uq02`: `backend-final-all.log`,
`frontend.log`, `lint.log`, `build.log`, `core-final.log`,
`wallet-verified-pg.log`, `adapters-pg.log`, `adapters-final-pg.log`,
`broader-pg.log`, and `historical-boundaries-final.log`. Earlier adapter logs
include intermediate failures subsequently resolved by the final core/Wallet
runs; they are retained as evidence rather than represented as passing runs.

This was the original implementation checkpoint; the review and focused fixes
below supersede its assessment. Production catalog,
unidentified direct RPC consumers, recovery assets and lock-contention behavior
remain unverified. The mandatory writer pause and coordinated schema/backend
cutover must be approved and arranged before deployment.

Historical 036-057 suites intentionally retain their historical engines/fixtures;
they prove migration/baseline behavior, not the new runtime. New core and current
Apple Pay/FlowLink HTTP suites use actual JS decisions and disposable PostgreSQL,
not scripted policy results. Existing controller doubles adapt transport only.
The optional retired exporter test remains unavailable/disabled and is not counted
as passing; Financial Data Bridge is not a test dependency of this package.

Remaining #99 packages: Budget policies/calculations; Savings workflows; Loan
workflows; Shopping/receipt rules; other non-essential domain SQL and final catalog
cleanup. #96 public contract/producer acceptance and #97/#98 database-management
work remain separate. #63/#64 multi-user/ownership work remains separately scoped; existing
permissions and ownership boundaries are preserved. Issue #99 stays open.

## Working-tree review and focused fixes (2026-11-08)

Reviewed tracked changes and relevant untracked services, migration and fixtures
against actual callers, historical SQL and contracts. The implementation report
was context, not proof. No production catalog was read or modified. Octocode's
local search rejected its arguments; direct file reads and rg supplied evidence.

### Confirmed findings

References below identify the corrected code locations in this candidate.

| Severity | Finding, concrete scenario and violated invariant | Correction / evidence |
| --- | --- | --- |
| High (P1) | `058:143,282`: a valid snapshot token plus a malformed decision could change the accounting date, currency or notes independently of the immutable request. All three probes actually committed before the fix. Violates request/evidence/ledger congruence. | Posting fields now equal immutable creation fields; supplied creation fields and accounting dates are bound to the request. All three probes now reject and leave no cash/evidence. |
| High (P1) | `058:305,338`: changing a JS conflict decision to a link attached evidence to an itemized, protected transaction. Snapshot freshness alone did not protect domain integrity. | Atomic linking rejects protected/voided targets, same-source saturation and automatic linking over overridden identities; owner linking also checks captured history. Reproduced rejection without new cash. |
| High (P1) | `058:363`: a malformed amendment enrichment overwrote a sticky owner charge-date edit and recorded it as source enrichment. Violates preservation of owner decisions. | Enrichment is bound to source/command charge evidence, the actual creator, provisional origin and non-overridden/non-protected state. Probe now rolls back, retaining the owner's date. |
| High (P1) | `058:222`: historical receipt correction accepted an internally congruent nested observation for 999.00 despite different owner-approved charged evidence. Violates the single command's financial authority. | Nested source/key/amount/direction/merchant/dates/reference/FX fields and revision are bound to the outer owner command. Probe rejects with no ledger or resolution row; legitimate correction/replay still passes. |
| Medium (P2) | `normalization.js:38`: runtime Unicode upgrades changed merchant normalization. The Dockerfile's Node 22 image supplied Unicode 17, while the original checks used Unicode 16; 133 scalar outputs differed, including U+20C1, U+A7CE and U+A7F1. Violates historical normalized matching evidence parity. | Freeze the historical Unicode 16 assigned repertoire in `merchantUnicode16.js`, leaving later assignments opaque. All scalar outputs match the original on both tested runtimes; composition/mixed-string and SQL parity checks pass. No image or product version change. |

The SQL fixes are consistency/integrity checks on fixed operations, not another
classification, matching or eligibility engine. The service role remains trusted
to run JavaScript policy; this is not a claim that a stolen database service key
is untrusted or cannot use its other existing privileges. No public-route exploit
was established for the malformed-plan findings.

The reader/command flow and all snapshot dependencies were traced. Facts used by
JS come from transactions, source/configuration, payment/category, immutable
receipts/observations/events, domain links, Budget capture facts and device/binding
tables. The commit locks these underlying tables before recomputing the token;
view dependencies resolve to those same tables. Retained Loan/domain writers keep
their own atomic checks. SQL still owns canonical fingerprints, review snapshot
membership, response projection and integrity guards; it does not choose matches.

The 19 retirement targets were checked against migration definitions and runtime
callers. Disposable cutover drops without CASCADE, retains the generic trigger,
and checks for residual SQL calls to removed engines. This proves repository
compatibility, not the absence of external production RPC consumers.

Historical harness corrections preserve their intended schema boundaries:
036 remains a historical engine/controller oracle, 037 verifies old data before
explicitly accounting for 054/057 additions, and the old 053 HTTP envelope is
separated from the real current owner-correction route. The archived 057 service
and external wrapper were compared with committed source (only documented test
headers/import paths differ). These fixtures are not evidence for current runtime
behavior; current core/HTTP integration tests supply that evidence.

### Additional checks actually run

| Check | Review result |
| --- | --- |
| Malformed-plan probes before fixes | Five failed assertions because forbidden writes succeeded; nested correction probe separately reproduced the sixth unsafe write |
| Complete affected core PostgreSQL suite after SQL fixes | 26 passed, 0 failed, 0 skipped |
| Focused canonicalization PostgreSQL checks after JS fix | 2 passed (one existing parity test plus one new test) |
| Selected Apple Pay / paused FlowLink HTTP and concurrency checks | 11 passed; replay/conflict, unknown acknowledgment, owner link, payment mapping and six revoke/disable/rotate race orders |
| Core JS unit tests on host Node 24.11.1 / Unicode 16.0 | 26 passed |
| Same unit tests on Docker Node 22.23.4 / Unicode 17.0, network disabled | 26 passed |
| Exhaustive scalar-output comparison across those runtimes | All 1,112,063 non-NUL, non-surrogate scalar inputs equal the original Unicode 16 output after fix; this is not exhaustive multi-character-string coverage |
| Fresh vs upgraded schema | Function definitions plus columns/types/defaults, constraints, indexes, triggers, views, RLS policies and relation/function grants equal |
| Outstanding 057 owner review and committed-command replay through 058 | Passed, including unchanged review fingerprints and changed-command conflict |

The PostgreSQL checks above cover **38 distinct tests**, counting the repeated
canonicalization test once. The broader 368-pass and frontend/backend counts
above are prior evidence, not fresh reruns during this review. The optional
retired-exporter audit was not run and is never counted as passing. No visual UI
owner acceptance was performed. Remaining full suites were not rerun by default.

Review logs and before/after Unicode output are private local artifacts outside Git:
`C:\Users\ozavr\AppData\Local\Temp\finance-99-review-9gxoigxe`.
Key logs: `boundary-before-all.log`, `nested-before.log`, `core-final.log`,
`wallet-focused.log`, `unicode-pg-final.log`, `unit-final.log`,
`node22-unit-final.log`. Earlier intermediate logs remain distinguishable.

Review edits are confined to migration 058, full_schema.sql, normalization.js,
new merchantUnicode16.js, the two core test files, this report and CHANGELOG.
The rest of the existing implementation and unrelated owner files are preserved.

### Owner acceptance and separate verdicts

**Local owner-review GO:** confirmed defects are corrected; no remaining failing
focused check. Owner acceptance remains Pending. **Production cutover NO-GO:**
requires actual catalog/consumer inspection, exact deployed-runtime verification,
writer quiescence, recovery decision and explicit migration/deployment approval.

1. Reproduce the disposable core checks from the repository root:
   `node --test server/test/ingestionCorePostgres.local.test.js` and
   `node --test server/test/ingestionCore.test.js`. They use synthetic data and
   portless PostgreSQL. Inspect the approved refund change separately from parity.
2. For visual acceptance, use the normal frontend/backend and the existing
   [development setup](../operations/DEVELOPMENT.md). First identify an isolated
   Supabase/Auth/PostgREST development environment, with a verified 057 schema
   upgraded using 058, or a compatible empty disposable schema initialized by the
   documented harness conventions. Do not point either process at production or
   apply full_schema.sql to an existing financial database. A raw PostgreSQL test
   container alone is not a working Supabase Auth/PostgREST environment.
3. Set server SUPABASE_URL/SUPABASE_KEY and frontend VITE_SUPABASE_URL/
   VITE_SUPABASE_ANON_KEY to that same isolated environment, and VITE_API_URL to
   `http://localhost:5050/api`. Keep both phone-ingestion flags false and scheduler
   callers stopped. Start `npm run dev --prefix server` and
   `npm run dev --prefix client` in separate terminals. Startup does not initialize
   or migrate a database. No new preview or environment was configured by this review.
4. Using only synthetic fixtures on that local environment, verify a CAL-card
   and Discount refund each posts one negative expense, lowers expense totals
   without raising income, and replays without another ledger row. Edit category
   and notes; reload and confirm signed amount, refund flag and null installment
   count. Exercise a weak cross-source hold, explicit owner link/separate, stale
   review, cancellation and normal manual/CSV behavior. Do not use real deliveries
   or activate FlowLink. The disposable tests provide concrete fixtures for these
   cases if local authentication/environment setup is not yet available.
5. Record Package 1 acceptance only after those checks. Keep #99 open for the
   remaining domain packages. Historical CAL refund recovery remains separate.

The Major assessment follows the exact repository rule, "Intentional incompatible
product, API, schema-contract or operational change." Here, removing old privileged
RPCs means the old backend cannot write against 058 and the new backend cannot
write against 057. The required coordinated downtime is the concrete incompatible
operational/schema boundary; the public v1 API staying compatible does not remove
that rule. No release number is selected or reserved.

## Local owner acceptance: monetary display correction (2026-11-08)

The isolated normal frontend/backend remains available at `http://localhost:5173`
and `http://localhost:5050`, backed by local Supabase/Auth/PostgREST on port 57421
and the compatible 058 schema. Configuration, synthetic credentials and fixtures
remain outside Git in
`C:\Users\ozavr\AppData\Local\FinanceTrackerAcceptance\issue99-package1`.
No acceptance records were reset or edited during this display correction.

The owner reported `-557.5500000000000000` in the CAL refund edit input and
save summary. The active persistence path divides exact numeric minor units by
100 (`ingestion_core_post` in 058), which can retain a scale of 16.
`transactions_filtered` returns `total_amount::text`; `readCash` supplies that
string to `getTransactionById`, overriding the direct table JSON number.
`useTransactionForm` previously copied it verbatim, and `MoneyAmount` defaults
to preserving the string's fractional width. This is a display-scale defect,
not a different accounting amount. Read-only inspection during this correction
found CAL transaction 3 already at `"-557.55"` and Discount transaction 4 still
stored with scale 16; no assertion is made that transaction 3 still reproduced
the original API string at this later checkpoint.

`normalizeMoneyForDisplay` now composes the existing exact minor-unit helpers,
using string input to avoid their legacy numeric presentation-rounding branch.
It normalizes only valid cent-exact values. The edit-load boundary and derived
save summary use it; the input change handler remains unchanged. Invalid extra
precision remains visible and fails the existing `step="0.01"` validation.
The shared `MoneyAmount` component and database/API formats are unchanged.
Refund helper text is now `זיכוי נרשם כהוצאה שלילית`, independent of method.

Focused verification:

- Before correction: the six new frontend cases yielded four failures and two
  passes, reproducing the input-scale defect. Unselected tests were not passes.
- After correction: AddTransaction (42), SavingsTransaction (8) and money (4)
  tests passed: **54 passed**, with no skipped tests. They cover trailing-zero
  strings, ordinary amounts, exact large decimals, invalid extra precision,
  raw typing, negative-refund validation and category/notes save-and-reload.
- The selected disposable PostgreSQL test, `card refund category/notes edit
  retains signed cash, null installments, receipt identity and net expense totals`,
  passed: **1 passed**, no skipped tests. It verifies persisted refund semantics,
  immutable accepted evidence/fingerprint, identity and idempotent replay.
- Targeted ESLint and `git diff --check` passed. A full-row checksum of the
  acceptance ledger was unchanged; all unrelated working-tree file hashes
  were preserved. The running Vite server serves the corrected form module.
- No broad suite rerun, production operation, migration or version change.
  The existing browser-automation URL-verification block prevented visual
  automation in the prior setup turn; these results do not claim browser acceptance.

Owner continuation: refresh the edit page for CAL transaction 3 and Discount
transaction 4. Verify input/summary values `-557.55` and `-149.00`, respectively;
edit category/notes, save and reopen. Confirm the refund remains an expense with
unchanged amount, source identity and null installment count. Other pending
Package 1 acceptance flows and production cutover prerequisites remain pending.

This correction is **Patch** impact on its own; the complete Package 1 retains
the **Major** operational/schema impact below. Owner acceptance remains Pending.

## Local owner acceptance: CSV preview correction (2026-11-08)

Reproduced before editing against the running local backend with authenticated
multipart `POST http://localhost:5050/api/import/preview`, profile `cal`, and the
original `acceptance.csv`. HTTP **500**, response
`{"error":"dateStr.includes is not a function"}`. The captured backend exception
was `TypeError: dateStr.includes is not a function` at
`server/controllers/importController.js:39:32` in the preview row mapper.

The original file is valid: 184 bytes, UTF-8 BOM (`EF BB BF`), CRLF, comma-delimited,
three introductory rows and Hebrew headers on row 4. Its literal row-5 date is
`08/11/2026` (8 November under the CAL day/month convention). There are no literal
hash marks; Excel's possible `########` display is not file content. SheetJS's
default text inference produced a numeric cell (`t: n`, value
`46245.00046296296`, formatted `8/11/26`); the controller assumed a string.
Converting that inferred number back would also risk preserving the wrong
month/day interpretation. This is an application parsing defect, not a malformed
fixture. The acceptance file remains byte-for-byte unchanged.

The preview reader now uses `raw: true` for plain-text input to preserve original
CSV date text. Typed XLSX cells remain typed. `server/utils/importDate.js` handles
day/month text, ISO dates, numeric Excel dates using the 1900/1904 workbook epoch,
and typed Date values; existing strict calendar validation prevents rollover.
Invalid dates, including literal hash marks and Excel's fictitious 1900 leap day,
are rejected. Purchase and billing dates are normalized separately. No changes to
amount calculations, profile mappings, source-byte hashing, save/import or ingestion
code were made. Preserving CSV text also avoids implicit numeric conversion of
original-currency evidence before the existing controller processing.

Verification:

- **12 backend tests passed**, no skipped tests: exact reproducing bytes and stable
  identity, CSV/XLSX across all four profiles, purchase/billing dates, monetary/FX
  evidence, installment text, both workbook epochs, Date input and invalid dates.
- **14 existing Import frontend tests passed**, no skipped tests.
- Both changed application JavaScript files passed `node --check`;
  `git diff --check` passed.
- Restarted only the verified isolated backend process. The real preview endpoint
  now returns HTTP **200**, `totalRows: 1`, description **AC99 CSV coffee**, amount
  **20**, currency **ILS**, date **2026-11-08**. Its source-byte identity is unchanged:
  `csv:08b148fd8fd2a6366d6e8eba63e428865aa5b4dc3a21e3d87700888189b71186:0`.
- No save/import request was sent. Full-row transaction checksum and dashboard
  totals are unchanged: **5 active transactions, income 2000, expenses 368.45,
  balance 1631.55**. No reset/reseed, migration or production action occurred.

Private local evidence: `csv-preview-before.json`, `csv-preview-after.json`,
`acceptance-before-csv-fix.bin` and `backend-before-csv-fix.err.log` under the
existing acceptance directory outside Git. Owner retry file:
`C:\Users\ozavr\AppData\Local\FinanceTrackerAcceptance\issue99-package1\acceptance.csv`.
On `http://localhost:5173`, retain profile **cal** and **Acceptance CAL 2755**,
retry preview and inspect the single row. This checkpoint verifies preview only;
owner acceptance and the later save/import step remain pending.

This correction is **Patch** impact; the full Package 1 still has the **Major**
cutover impact below. Production remains **NO-GO** pending its documented prerequisites.

## Final local acceptance (2026-11-08)

### Evidence attribution

The owner explicitly confirmed the following through the isolated **normal
frontend** at `http://localhost:5173` (owner-reported, not agent-observed browser
automation):

- Dashboard baseline totals.
- CAL and Discount refund category/notes edits surviving save/reload.
- Correct two-decimal refund display.
- Linking observation **12** to transaction **6** without additional financial posting.
- Cancellation of the ILS **40** target.
- CSV import of **AC99 CSV coffee**, ILS **20**.
- Manual creation of **AC99 Manual acceptance**, ILS **30**.

Owner-confirmed current ledger: **7 active transactions; income 2000; expenses
418.45; balance 1581.55**. The normal authenticated dashboard API independently
returned those same values before and after the remaining check below.

Do not infer hidden database invariants from these visual checks. Preservation of
null installment count, immutable ingestion evidence, source identities,
fingerprints, atomic rollback and concurrency remains supported by the separately
attributed automated evidence above. In particular, null installments were not
claimed as visually verified by the owner.

### Stale decision versus committed-command replay

Used the existing local Auth/PostgREST/058 environment; no separate scenario,
reset, reseed or additional financial transaction was needed. Reconstructed
observation 12's historical pre-resolution link command from its recorded review
event and unchanged target/candidate fingerprints. The PostgreSQL canonical
command hash matched the historical event exactly:
`0697783a29961489c0b3096110e06d45915275173d0c337cff6254d3fa87d125`.
This verifies the reconstructed historical command rather than assuming today's
fingerprints were the original values. Historical revision **1** was stale against
the current observation revision **2**.

At `2026-11-08T19:42:57Z`, the normal authenticated owner API
`POST /api/reconciliation/observation/12/resolve` was exercised twice:

| Check | Request identity | Verified response |
| --- | --- | --- |
| Historical command with a fresh UUID | `2a94b0c7-3963-40d8-b2d7-29f5dbe8904b` (verified absent beforehand) | **HTTP 409**, `{"error":"stale_review"}` |
| Exact committed-command replay | Original `1c128347-feab-4f5d-b432-5a0186075319` | **HTTP 200**, recorded `reconciled` / `owner_link`, target **6**, revision **2**, `replayed: true` |

The second response proves replay behavior, **not** stale rejection. The fresh
UUID case is the stale-rejection evidence. Read-only before/after row counts and
ordered full-row checksums matched across **all 48 public tables**, after each
request. Financial rows, observations, receipts, reconciliation history and the
ledger totals remained unchanged. No defect was discovered, so no application
code or test expectations were changed during this finalization.

Frontend HTTP 409 handling reuses valid automated evidence rather than claiming
a new owner visual check: `client/src/pages/Transactions/Reconciliation.test.jsx`,
test **stale decisions refresh evidence and clear selection before renewed
submission** (line 59), asserts evidence is fetched again, all radio choices are
cleared and confirmation is disabled. The prior `frontend.log` records that file's
**12 passing tests**, within the **756-pass / 51-file** run documented above.
Its current source is unchanged by this finalization. No passing suite was rerun.

Private evidence outside Git, under the existing acceptance directory:
`historical-observation-12-command.json`, `stale-acceptance-result.json`, and
`stale-acceptance-table-checksums.txt`. These contain local synthetic evidence;
they are not commit inputs. Runtime remains local with phone-ingestion/Savings
job flags disabled and no external scheduler callers or producer activation.

### Verdict and commit boundary

**Local Package 1 acceptance: complete.** No remaining local acceptance blocker
was found. **Production cutover: NO-GO**, independently of local acceptance.
Current production catalog/consumer discovery, deployed runtime/schema parity,
verified writer quiescence, recovery/backup decision, and explicit coordinated
migration/deployment authorization remain outstanding. Do not assume backup
availability, old-backend compatibility with 058, or safe rollback by rerunning
historical migrations. The earlier cutover/recovery instructions still apply.

Issue #99 stays **open** for Budget, Savings, Loans, Shopping and the remaining
domain packages. No commit, push, version bump, deployment, producer activation
or production acceptance occurred.

The exact **53-file** manual-commit manifest is
[INGESTION_PACKAGE_1_COMMIT_FILES.txt](INGESTION_PACKAGE_1_COMMIT_FILES.txt).
It includes the implementation, independent review fixes, historical test fixture
corrections, monetary display/CSV fixes, Unreleased notes, this report and the
manifest itself. Each entry was checked against the actual modified/untracked
working tree; there are no directory wildcards. Review the individual diffs before
the owner stages these explicit paths; do not stage the entire working tree.

Keep these existing unrelated changes **outside** that commit, unchanged:

- `docs/operations/APY_04_CAL_RECONCILIATION.md`
- `docs/MULTI_USER_ARCHITECTURE.md`
- `docs/MULTI_USER_INVENTORY.md`
- `docs/operations/__pycache__/` (currently `flowlink_compare.cpython-314.pyc`)
- `supabase/.temp/cli-latest` (local CLI-generated metadata, not package source)

Local acceptance configuration, logs, credentials, database files and fixtures
under `%LOCALAPPDATA%\FinanceTrackerAcceptance\issue99-package1` stay outside Git.
The staging area remains unchanged and empty.

## Release / Version gate

- Release impact: **Yes** - application/database cutover and expanded refund support.
- SemVer impact: **Major** under the repository's operational/schema-contract
  rule: retired privileged RPCs make mixed application/schema writes incompatible
  and require coordinated downtime. The public v1 contract stays compatible;
  no release number is selected or version changed by this assessment.
- Candidate release: **Pending (TBD)** - owner selects after package acceptance.
- Grouping / included release candidate: **Pending (TBD)** - track on #99.
- CHANGELOG: **Updated under Unreleased**; unrelated entries preserved.
- Version-bump status: **Deferred** - owner release preparation after scope is final;
  seven application-version fields and native build versions unchanged.
- Publication status: **Out of scope** - no commit, push, tag, deploy or release.
- Owner verification / acceptance: **Accepted locally for Package 1** - explicit
  owner-reported frontend confirmation plus the verified stale API check above.
  Production acceptance remains **Pending**; Issue #99 remains open.

## Changed-file inventory

The following files belong to this package; nothing is staged. Applied migrations
001-057, all version/dependency manifests and lockfiles, and native files are unchanged.
Unrelated owner work in APY_04_CAL_RECONCILIATION.md, both MULTI_USER documents and
operations/__pycache__/ is excluded and its content hashes were verified unchanged.

### Application and database

- `client/src/hooks/useTransactionForm.js`
- `client/src/pages/AddTransaction/AddTransaction.jsx`
- `client/src/utils/money.js`
- `server/controllers/importController.js`
- `server/utils/importDate.js`
- `server/full_schema.sql`
- `server/migrations/058_ingestion_application_boundary.sql`
- `server/routes/reconciliationRoutes.js`
- `server/services/ingestion/core.js`
- `server/services/ingestion/historicalReceipts.js`
- `server/services/ingestion/merchantUnicode16.js`
- `server/services/ingestion/normalization.js`
- `server/services/ingestion/policy.js`
- `server/services/ingestion/readers.js`
- `server/services/ingestion/reconciliation.js`
- `server/services/ingestionCommand.js`
- `server/services/transactionIngestionService.js`
- `server/services/unifiedTransactionIngestion.js`

### Tests and historical fixtures

- `client/src/pages/AddTransaction/AddTransaction.test.jsx`
- `client/src/utils/money.test.js`
- `server/test/importPreview.test.js`
- `server/test/applePay.test.js`
- `server/test/applePayPostgres.local.test.js`
- `server/test/calReconciliationPostgres.local.test.js`
- `server/test/externalTransactionContract.test.js`
- `server/test/fixtures/transactionController036.js`
- `server/test/fixtures/transactionIngestionService057.js`
- `server/test/fixtures/unifiedTransactionIngestion057.js`
- `server/test/flowlinkBindingsPostgres.local.test.js`
- `server/test/flowlinkPostgres.local.test.js`
- `server/test/generalTransactionPostgres.local.test.js`
- `server/test/helpers/applePayHttp.js`
- `server/test/helpers/coreProtocol.js`
- `server/test/helpers/fakeSupabase.js`
- `server/test/helpers/flowlinkHttp.js`
- `server/test/ingestionCore.test.js`
- `server/test/ingestionCorePostgres.local.test.js`
- `server/test/reconciliationReview.test.js`
- `server/test/reconciliationReviewPostgres.local.test.js`
- `server/test/transactionIngestion.test.js`
- `server/test/transactionIngestionPostgres.local.test.js`
- `server/test/unifiedIngestionPostgres.local.test.js`

### Documentation

- `CHANGELOG.md`
- `docs/architecture/FLOWLINK_NATIVE_INGESTION_CONTRACT.md`
- `docs/architecture/GENERAL_TRANSACTION_API.md`
- `docs/architecture/INGESTION_PACKAGE_1.md`
- `docs/architecture/INGESTION_PACKAGE_1_COMMIT_FILES.txt`
- `docs/architecture/UNIFIED_TRANSACTION_INGESTION.md`
- `docs/operations/APY_02_INGESTION_FOUNDATION.md`
- `docs/operations/APY_05_RECONCILIATION_REVIEW.md`
- `docs/operations/DATABASE.md`
- `docs/operations/FLI_03_CARD_BINDINGS.md`
- `docs/operations/GENERAL_TRANSACTION_API.md`


## Manual refund entry correction (2026-11-09)

This correction starts at deployed Package 1 commit
`43dc936600038da07a808a8b52627491ca722987`; the owner confirms production migration
058 is already applied. Earlier candidate/cutover statements above describe their
historical checkpoint. Package 1 architecture review and its completed 058 rollout
rehearsal are reused, not reopened.

### Root cause and behavior

The old form allowed a negative amount only when the persisted expense was already
negative **and** marked `bank_movement=refund`. Chromium reproduced the exact owner
failure on an ordinary expense: entering `-557.55` yielded `rangeUnderflow=true`,
`checkValidity()=false`, and “Value must be greater than or equal to 0.” The existing
frontend tests actually asserted that blocked behavior. Manual ingestion then
rejected signed input, and the atomic writer/observation constraint restricted
negative posting to the external refund envelope.

The ordinary direct expense form now accepts negative owner input, explains that
it reduces expenses rather than adding income, and serializes refunds without
inventing an installment count. Existing negative expenses are recognized without
requiring a saved marker. Income stays nonnegative; existing refund edits retain
their expense direction and negative-only range. Explicit native custom validity
preserves cent precision when removing `min=0` changes HTML's step base.

JavaScript derives the refund marker from the authenticated owner's signed expense
command, ignoring any submitted marker. New refunds use the existing manual
observation/reconciliation path. Refund edits use a small `owner_refund_edit`
decision inside the existing locked snapshot/commit boundary, then the existing
transaction/Loan writer. Amount and marker change together; immutable accepted
source evidence, external IDs, row IDs and references are retained. The existing
transaction trigger records identity overrides and audit events. Refund edits do
not run the subsequent item-delete/reinsert path.

Credit/debit cards, bank accounts, cash, transfers and checks use this same path.
Unrelated installments on the payment source do not imply that an explicit manual
refund belongs to a purchase series. Actual installment rows, itemized purchases,
Loan/Savings links, shopping/LEGO links, cancelled transactions and captured Budget
history remain guarded, with a Hebrew application message directing the owner to
the linked domain correction or a separate new refund. Duplicate candidates still
use the existing reconciliation review and explicit separate-transaction approval;
resuming an approved refund retains the observation rather than creating duplicate
evidence. External v1 retains positive magnitudes plus explicit `type=refund`;
negative external expense input, negative income and CSV negative intake are not
newly accepted. Zero creation remains rejected; existing positive/zero domain
behavior is unchanged.

Direct refund money stays decimal text through the controller; BigInt cents handle
normalization. FX original amount and exchange-rate text pass through without a
JavaScript Number conversion. Refund installments persist as null. No production
financial data or historical batch was changed.

### Focused verification

All resources are synthetic and disposable. The new local harness starts its own
PostgreSQL, Auth and PostgREST containers, dynamically allocated loopback ports,
local gateway and the normal application frontend/backend. It does not load a
private `.env` or access existing task databases. Browser saves use real Supabase
Auth and real HTTP requests; they are not fulfilled by mocked success responses.

- Before change: the real Chromium form reproduced the exact browser validation
  message above. The old two form regression cases also reproduced blocked submit.
- Frontend: 46 AddTransaction tests, 8 Savings form tests and 24 transaction amount
  tests passed. New cases cover creation on card/debit/bank sources, positive-to-
  negative edits, unmarked negative rows, native validity and serialized nulls.
- Server: 69 focused policy, ingestion, external-contract, Loan-controller and
  pricing tests passed. The prior mocked refund controller round trip is replaced
  by the stronger real Auth/HTTP/PostgreSQL coverage.
- Client lint and production build passed. Build retains the existing large-chunk
  warning; no dependency or version changes were made.
- Local integration results and final diff checks are recorded in the owner
  handoff below after completion.

Reproduce the focused checks from the isolated checkout:

```powershell
npm ci --prefix client
npm ci --prefix server
node --require ./server/test/setup.js --test server/test/manualRefund.test.js server/test/ingestionCore.test.js server/test/transactionLoanPayments.test.js server/test/externalTransactionContract.test.js server/test/transactionPricing.test.js
$env:VITE_SUPABASE_URL = 'http://127.0.0.1:1'
$env:VITE_SUPABASE_ANON_KEY = 'synthetic-test-key'
npm test --prefix client -- src/pages/AddTransaction/AddTransaction.test.jsx src/pages/AddTransaction/SavingsTransaction.test.jsx src/pages/Transactions/TransactionsAmounts.test.jsx
npm install --prefix .refund-tools --no-save --package-lock=false playwright
$env:REFUND_PLAYWRIGHT = Join-Path $PWD '.refund-tools/node_modules/playwright'
node --test server/test/manualRefundPostgres.local.test.js
npm run lint --prefix client
npm run build --prefix client
git diff --check
```

The optional browser portion requires an installed Chrome. Without
`REFUND_PLAYWRIGHT`, the local test runs the HTTP/database checks only; that is not
claimed as browser verification. Its containers and child processes are removed
in `finally`, including on assertion failures. `.refund-tools` contains only task
artifacts and temporary dependencies and is excluded from the commit manifest.

### Deployment and integration

Apply forward migration **059** to the verified target before deploying the
corrected backend, then frontend. Migration 058 and all earlier migrations remain
unchanged. 059 is backward compatible with Package 1; no repeated 058 cutover or
producer activation is required. Preserve the existing service/private function
grants. No automatic migration, production deployment, staging, commit or push is
authorized by this handoff.

The isolated branch is `fix/manual-refund-entry` in
`D:\code\finance-tracker-refund-fix`. The original checkout/branch and all its
services/databases remain untouched. Latest checked `origin/main` is still the
base commit above. The concurrent shopping branch must be integrated separately;
check for migration-number and shared-schema collisions when its work arrives.
Do not assume a future fast-forward and do not force-push. The owner commits on
this fix branch first; keep it and its commits when removing the temporary worktree.

Exact source manifest: [MANUAL_REFUND_COMMIT_FILES.txt](MANUAL_REFUND_COMMIT_FILES.txt).
Only the listed files should be staged for this correction. After the owner reports
the commit, verify its contents and a clean source working tree, remove verified
task-generated artifacts and use `git worktree remove` without force. Until then,
retain this worktree as the only working copy of the correction.

### Release / Version gate

- Release impact: Yes — fixes legitimate owner refund creation/editing through the normal application.
- SemVer impact: Patch — backward-compatible correction to the existing refund behavior and persistence boundary.
- Candidate release: Pending (TBD) — owner selection tracked with the correction on #99.
- Grouping / included release candidate: Pending (TBD) — owner to coordinate with #99 and other unreleased changes; no version reserved.
- CHANGELOG status: Updated under Unreleased / Fixed — #99 manual refund entry correction.
- Version-bump status: Deferred — owner-led candidate preparation tracked on #99; all seven existing version fields remain unchanged.
- Publication status: Out of scope — no tag, push, release publication or production execution performed.
- Owner verification / acceptance status: Pending review — automated checks do not establish owner acceptance.

### Completed local handoff evidence

The final local run passed **10/10 tests (9 focused subtests plus their parent)**,
including Chromium creation on credit-card and bank-account sources, edits of
ordinary positive and unmarked negative expenses, and actual HTTP/database reloads.
All six applicable payment-source methods passed authenticated creation. Net totals
remained negative expenses with zero added income. Existing classified-refund
category/notes changes retained IDs, references, dates, immutable source payloads
and previous reconciliation events; the normal override audit event was added.
Exact large decimal amounts and FX fields, null installments, duplicate-review
approval/resumption, altered-decision rollback, stale protected facts and persisted
item/installment/Loan guards passed. External positive-magnitude refunds remained
compatible, and negative external expense/CSV/income inputs remained rejected.
The migration preserved existing function grants and the consolidated suffix
matches 059 exactly. The stale SQLSTATE assertion runs directly against PostgreSQL
to avoid transport retries; ordinary form saves use the real HTTP path.

Combined focused evidence: **69 server tests, 78 frontend tests, 10 local integration
tests**, client lint, client production build, server syntax checks and
`git diff --check` passed. The build reports its existing large-chunk warning.
There was no broad-suite rerun or repeat of the completed 058 rollout rehearsal.
Task-labelled containers, Docker networks and application/Vite child processes
were removed after verification. Temporary dependencies/logs in `.refund-tools`
and the worktree itself remain until the owner's commit/cleanup step.

Issue #99 stays open: this correction's handoff is Verify, not acceptance or
completion of the remaining domain packages. Priority and unrelated metadata are
preserved. Owner acceptance, commit, integration and production deployment remain
pending. At the final remote readback, `origin/main` is still
`43dc936600038da07a808a8b52627491ca722987`; recheck it at integration time.
