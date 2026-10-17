# General transaction API: local review and migrations 052 / 053

[Contract, compatibility and synthetic examples](../architecture/GENERAL_TRANSACTION_API.md).
Issue [#96](https://github.com/OzAvrahami/finance-tracker/issues/96), local implementation
on `main` at `1da80871f57354f6429358d37e97b0517d1efaf3`. No staging/commit/push,
production SQL, hosting changes, source activation or producer delivery is included.

## Local synthetic review

From `D:\code\finance-tracker` in PowerShell:

```powershell
node --require ./server/test/setup.js --test server/test/generalTransactionContract.test.js server/test/externalTransactionContract.test.js server/test/transactionIngestion.test.js server/test/calIngestion.test.js server/test/reconciliationReview.test.js
if ($LASTEXITCODE -ne 0) { throw 'Contract/regression tests failed' }
node --test server/test/generalTransactionPostgres.local.test.js
if ($LASTEXITCODE -ne 0) { throw 'Disposable database tests failed' }
```

The second command requires running Docker Desktop and `postgres:16-alpine`.
It creates its own labelled, portless PostgreSQL container, checks its isolation,
applies the final schema and the pre-052 upgrade separately, tests synthetic rows,
and removes only that container on completion. No normal `.env` or network database
URL is loaded. It also exercises the actual controller and API-key middleware over
ephemeral loopback HTTP with injected disposable persistence. This is backend
integration verification, not browser/production/producer acceptance.

For an already-established **isolated** local backend, a manual request can use:

```powershell
# Preconditions: this port belongs to the isolated test backend, with 052, 053 and a
# synthetic-account registration. Never substitute the normal backend until its
# database isolation has been independently verified. Do not change normal .env.
$reviewBase = 'http://127.0.0.1:<isolated-port>'
$reviewHeaders = @{ Authorization = 'Bearer <isolated-test-integration-key>' }
$reviewBody = node -e "const f=require('./server/test/fixtures/generalTransaction'); console.log(JSON.stringify(f.envelope(f.item())))"
if ($LASTEXITCODE -ne 0) { throw 'Synthetic fixture generation failed' }
Invoke-RestMethod -Method Post -Uri "$reviewBase/api/v1/transactions" -Headers $reviewHeaders -ContentType 'application/json' -Body $reviewBody
# Repeat unchanged: replay, same receipt and transaction IDs, no extra cash.
Invoke-RestMethod -Method Post -Uri "$reviewBase/api/v1/transactions" -Headers $reviewHeaders -ContentType 'application/json' -Body $reviewBody
```

No persistent review server was repointed to a test database. The test commands
are the reproducible isolated review environment; normal owner data is preserved.

## Migration preflight, application and recovery (owner-operated, not executed in production)

Migrations, in order: `server/migrations/052_general_transaction_contract.sql`,
then `server/migrations/053_general_receipt_resolution.sql`, then backend/cache refresh.
Inventory through 051 was inspected. Requires APY 036, CAL 045, review 046 and
billing 047; deploy on the reviewed current schema through 051. No historical
migration is edited. `full_schema.sql` includes both forward migrations for
new disposable installations; **do not run full_schema.sql on an existing database**.

1. Verify target/environment and actual applied inventory. Read-only checks:

   ```sql
   SELECT to_regclass('public.transaction_ingestion_sources'),
          to_regclass('public.transaction_source_observations'),
          to_regclass('public.cal_ingestion_receipts'),
          to_regprocedure('public.ingest_observation(bigint,jsonb)'),
          to_regprocedure('public.review_reconciliation(uuid,jsonb)'),
          to_regprocedure('public.ingest_cal_v1(uuid,jsonb,jsonb,jsonb)');
   SELECT to_regclass('public.transaction_api_registrations'),
          to_regclass('public.transaction_api_receipts'),
          to_regprocedure('public.ingest_general_transaction(text,jsonb)');
   SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name='cal_ingestion_receipts'
     AND column_name IN ('contract_version','billing_evidence','legacy_request_hash');
   ```

   Existing objects are necessary, not proof of matching function bodies. Compare
   current definitions with the reviewed migration chain and actual deployment
   inventory. If 052 objects exist, inspect applied state rather than rerunning it.
   052 deliberately has no blind rerun path; partial/unexpected state requires investigation.
2. Coordinate ingestion writes and obtain a recoverable database backup with a
   verified recovery procedure for this rollout. **No backup or restore test has
   been performed here. The prior #95-specific waiver does not apply to #96.**
   Capture preservation snapshots/counts of transactions, observations, receipts,
   APY events and domain cash tables before applying schema changes.
3. Under separate production authorization, apply only the pending reviewed 052,
   then 053 files, each transactionally. Schema must precede backend. Existing routes remain
   compatible; 052 creates **zero registrations**. Refresh the PostgREST schema
   cache using the environment's existing procedure before deploying backend.
4. Read-only postflight:

   ```sql
   SELECT count(*) FROM public.transaction_api_registrations;
   SELECT count(*) FROM public.transaction_api_receipts;
   SELECT relname,relrowsecurity FROM pg_class
   WHERE oid IN ('public.transaction_api_registrations'::regclass,
                 'public.transaction_api_receipts'::regclass);
   SELECT has_function_privilege('service_role','public.ingest_general_transaction(text,jsonb)','EXECUTE') AS service_execute,
          has_function_privilege('anon','public.ingest_general_transaction(text,jsonb)','EXECUTE') AS anon_execute,
          has_function_privilege('authenticated','public.ingest_general_transaction(text,jsonb)','EXECUTE') AS authenticated_execute,
          has_table_privilege('service_role','public.transaction_api_receipts','INSERT') AS direct_insert;
   SELECT tgname FROM pg_trigger WHERE tgrelid='public.transaction_api_receipts'::regclass AND NOT tgisinternal;
   ```

   Fresh migration counts must both be zero; RLS true; execute true/false/false;
   direct insert false; immutable receipt trigger present. Compare prior financial
   snapshots: the migration performs no cash/provenance backfill or source enrollment.
5. Deploy reviewed backend only after schema/cache readiness. No frontend change
   is required. Do not enable producer sending as a deployment smoke test.
6. Failure before commit rolls back that migration (052 or 053). After successful migration, stop affected
   delivery and forward-fix; do not delete receipts/observations, remove guards or
   replay history under new keys. Old backend can continue legacy supported routes
   while new registrations remain disabled. Once evidence has been accepted,
   restore requires coordinated recovery of the whole database **and producer
   durable acknowledgement state**; no destructive down migration is provided.

## Trusted registration and outstanding decisions

An administrator must use existing `configure_ingestion_source` with a stable
source instance and approved payment IDs/aliases/references, then separately
register an opaque account key against that source. The SQL command accepts only
an existing active supported source. `transaction_api_registrations` is private;
ordinary API callers cannot configure or mutate it. Its defaults are disabled,
history-unreviewed and owner-selected billing-date policy. Registration itself
blocks legacy external-ID inserts on that mapped account, even while disabled;
inventory and coordinate all writers before creating it. No production registration SQL
with real IDs is supplied or executed in this task.

One mapped payment source is required. Multiple candidates hold even when last4
matches; inactive cards hold with a distinct reason because charges can be valid.
Do not reactivate a card solely to bypass this hold. Receipt-only cases now use the
guarded owner resolution procedure below; unresolved inactive-card policy still holds.

The owner explicitly selected **confirmed billing date** for individual-installment
accounting/reporting during this implementation. Original purchase and mapped dates
remain independent evidence. An explicit review-only registration policy can hold
an account, but there is no producer-selected mapped-date accounting path. Producer
identity/cutover agreement is still pending. Refund automatic posting remains outside
the accepted APY policy. Policy approval is not functional or production acceptance.

## Owner receipt resolution procedure (053)

1. Locate the `receipt_id` retained from delivery. Investigate missing evidence
   against the provider, or have the authorized administrator correct the source
   mapping through existing `configure_ingestion_source` with a reviewed complete
   configuration. Keep original keys and source identity. Do not identify a card
   by last4 alone, activate an inactive card to bypass review, or edit receipt SQL.
2. Read `GET /api/reconciliation/receipt/:id` using an authenticated **owner
   session JWT**, allowlisted by existing `FLOWLINK_OWNER_USER_IDS`. Integration
   API keys and FlowLink tokens cannot authorize this route. Inspect original and
   current evidence/history and the current result. If there is an observation ID,
   use the existing observation review/amendment/cancellation procedure instead.
3. Construct complete, verified revised item evidence with the **same delivery key**.
   Use `same_identity` only when identity/reference is unchanged; otherwise use
   `provider_link` and an investigation/provider relationship reference. Similar
   amount/date/merchant is insufficient. Keep uncertain relations held. Do not
   use this procedure to merge different existing receipt keys.
4. Save one UUID and the exact request body privately. POST `/receipt/:id/resolve`
   with the freshly read revision/token. Read `financial_posted` and `reason_code`:
   success can still mean held. The response is not authority to declare unsupported
   refunds/FX resolved. Reread the receipt to inspect immutable history.
5. For lost response/503, retry the saved UUID/body verbatim. On 409 stale review,
   reread and investigate the intervening change before a new decision/UUID. Never
   generate a fresh identity merely because an acknowledgment was lost. Once
   posted, operator corrections use the established observation/transaction path.

Reproducible synthetic HTTP walkthrough, **only on an independently isolated
backend/database**, with migrations 052 then 053 and a synthetic registration:

```powershell
$reviewBase = 'http://127.0.0.1:<isolated-port>'
$integrationHeaders = @{ Authorization = 'Bearer <isolated-integration-key>' }
$ownerHeaders = @{ Authorization = 'Bearer <isolated-owner-session-JWT>' }
$completed = node -e "console.log(JSON.stringify(require('./server/test/fixtures/generalTransaction').item()))" | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Fixture failed' }
$pending = $completed | ConvertTo-Json -Depth 20 | ConvertFrom-Json
$pending.event.status = 'pending'
$body = @{contract='finance.transactions.v1'; account='synthetic-account'; item=$pending} | ConvertTo-Json -Depth 20
$accepted = Invoke-RestMethod -Method Post -Uri "$reviewBase/api/v1/transactions" -Headers $integrationHeaders -ContentType 'application/json' -Body $body
$receiptId = $accepted.results[0].receipt_id
$receiptUrl = "$reviewBase/api/reconciliation/receipt/$receiptId"
$review = Invoke-RestMethod -Uri $receiptUrl -Headers $ownerHeaders
$resolutionJson = @{
  request_key = [guid]::NewGuid().ToString()
  expected_revision = $review.revision
  review_token = $review.review_token
  item = $completed
  reason = 'Synthetic completed provider evidence verified'
  relationship = @{kind='same_identity'}
} | ConvertTo-Json -Depth 20
# Keep this exact JSON/UUID for retry; do not reconstruct it after a lost response.
$resolved = Invoke-RestMethod -Method Post -Uri "$receiptUrl/resolve" -Headers $ownerHeaders -ContentType 'application/json' -Body $resolutionJson
$replayed = Invoke-RestMethod -Method Post -Uri "$receiptUrl/resolve" -Headers $ownerHeaders -ContentType 'application/json' -Body $resolutionJson
Invoke-RestMethod -Uri $receiptUrl -Headers $ownerHeaders
# Expected: initial zero cash; one completed observation/cash row; second POST replay.
```

No persistent server or normal environment was repointed. The database/HTTP tests
below reproduce this procedure with injected disposable persistence and synthetic
owner authentication; they do not establish a live Supabase login/session.

### Additional 053 migration checks and recovery

Preflight: verify reviewed 052 definitions and whether 053 has already been
applied. Do not rerun either applied migration. Read-only object inventory:

```sql
SELECT to_regclass('public.transaction_api_resolutions'),
       to_regclass('public.transaction_api_current'),
       to_regprocedure('public.get_general_receipt(bigint)'),
       to_regprocedure('public.resolve_general_receipt(uuid,jsonb)');
```

053 adds one append-only RLS table and one private effective-evidence view;
replaces the public ingestion wrapper/result reader and updates the existing
whole-purchase guard to consider resolved evidence. It creates no registrations
and revises no existing receipts or cash. Keep the same preservation/backup
requirements above; the earlier #95 waiver is not a #96 waiver. Production
prerequisites, backup and applied state remain **unverified**, not passed.

After applying pending 053, refresh the existing PostgREST schema cache, compare
preflight financial/evidence counts and run these read-only checks:

```sql
SELECT count(*) FROM public.transaction_api_resolutions; -- zero immediately after migration
SELECT relrowsecurity FROM pg_class WHERE oid='public.transaction_api_resolutions'::regclass;
SELECT tgname FROM pg_trigger WHERE tgrelid='public.transaction_api_resolutions'::regclass AND NOT tgisinternal;
SELECT has_function_privilege('service_role','public.resolve_general_receipt(uuid,jsonb)','EXECUTE') AS owner_backend_execute,
       has_function_privilege('anon','public.resolve_general_receipt(uuid,jsonb)','EXECUTE') AS anon_execute,
       has_function_privilege('authenticated','public.resolve_general_receipt(uuid,jsonb)','EXECUTE') AS direct_jwt_execute,
       has_function_privilege('service_role','public.evaluate_general_transaction(text,jsonb,bigint)','EXECUTE') AS private_helper_execute,
       has_table_privilege('service_role','public.transaction_api_resolutions','INSERT') AS direct_insert;
```

Expected: RLS true, immutable trigger, privileges true/false/false/false/false.
HTTP owner authorization remains in the backend; browser JWTs cannot execute the
SQL command directly. Verify definitions, not only object existence. Apply order
is **052 → 053 → backend**; no frontend change is required. 053 failure before
commit rolls back as tested. After commit, stop affected delivery and forward-fix;
do not delete history or downgrade the effective-evidence guards. A database
restore must coordinate producer acknowledgment state, as described above.

### Focused lifecycle verification (2026-10-17)

- **19 distinct disposable PostgreSQL/HTTP tests passed**: final 18-test migration/
  lifecycle suite, plus the subsequently added owner HTTP procedure test. The SQL
  was unchanged between those runs. Tests cover 052→053/full-schema equivalence,
  rollback, permissions, immutable history, current mapping tokens, owner edits,
  cancellations, concurrent resolutions, exact retries and cross-source installment
  guards. Initial SQL ambiguity in the result reader was fixed before these passes.
  The migration case was then extended and passed independently with existing
  pre-053 pending/posted receipts: receipt contents were preserved, posted replay
  remained safe, and the old held receipt could be resolved after upgrade.
- **15 unit/HTTP tests passed** after extracting the shared bounded RPC wait:
  9 general contract tests and 6 owner-review tests. Existing legacy/CAL evidence
  from the prior checkpoint is reused where code is unchanged.
- **1 actual producer pure-mapper/allowlist test passed**, using synthetic data
  only. Original date loss, completed billing date, pending date/identity/currency
  absence and rejection of an unrecognized original-date field were demonstrated.
- Financial counts: pending **0 → completed resolution 1 → concurrent/repeated
  requests 1**; failed revision insertion **0 cash / 0 observations / 0 revisions**;
  missing installment original date **0 → explicit evidence resolution 1 → retry 1**;
  a distinct observed next installment **2** (never total-count expansion).
- No live producer delivery/collection, production SQL, real financial records,
  production readiness probe, browser UI or owner functional acceptance performed.
  Current producer output still needs original-date, identity and exact-money
  agreement; consumer success does not establish practical producer readiness.
- Follow-up ESLint: **5 JavaScript files, zero findings**. Seven version fields
  remain **1.7.0**; schema prefix and migration suffix checks, local documentation
  links and whitespace checks pass. Preserved owner files and Git index match
  the existing pre-implementation hash manifest.

Additional local commands (PowerShell; no normal environment edits):

```powershell
node --require ./server/test/setup.js --test server/test/generalTransactionContract.test.js server/test/reconciliationReview.test.js
if ($LASTEXITCODE -ne 0) { throw 'Focused HTTP checks failed' }
node --test server/test/generalTransactionPostgres.local.test.js
if ($LASTEXITCODE -ne 0) { throw 'Disposable persistence checks failed' }
# Optional accessible producer checkout. Only the exported pure mapper runs.
$env:GENERAL_PRODUCER_REPO = 'D:\code\bank-data-sync'
try {
  node --test server/test/generalProducerFields.local.test.js
  if ($LASTEXITCODE -ne 0) { throw 'Synthetic producer field check failed' }
} finally { Remove-Item Env:GENERAL_PRODUCER_REPO }
```

## Prior implementation verification (before lifecycle follow-up)

- Final changed contract/legacy HTTP suites: **22 passed**. Reused unchanged APY
  service, CAL adapter and owner-review unit evidence: **24 passed** in the earlier
  focused run (46 distinct unit/HTTP tests overall, not repeated-run totals).
- Final general PostgreSQL/HTTP suite: **14 passed**, including upgrade equivalence,
  migration and item rollback, private grants/RLS, immutable receipts, concurrent
  duplicates, lost-response retry, cancellation, owner edits, legacy cutover,
  confirmed-billing installment accounting, missing dates, whole/individual arrival
  orders and independent mixed-batch persistence.
- Existing CAL PostgreSQL/HTTP regressions: **29 passed, 1 skipped** (optional real
  exporter test was deliberately not enabled; no private producer data used).
  Existing owner-review PostgreSQL regressions: **7 passed**. Their unchanged
  no-general-registration scenarios are reused after the final default/guard change;
  the final general suite tests the new registration and installment paths directly.
- Initial new-test failures were corrected: a fixture generated month `010`, and
  an assertion compared PostgreSQL decimal formatting instead of exact numeric value.
  An existing schema-definition comparison caught LF/CRLF normalization in the
  appended schema; existing line endings were restored and the suite then passed.
  No failing assertion was suppressed or runtime failure relabelled as a pass.
- Focused ESLint recommended Node rules: **8 changed JavaScript files, 0 findings**.
  Migration/full-schema suffix equality, local documentation links, whitespace,
  seven-field version inventory and owner-file/index preservation checks passed.
- No production schema probe/migration, live provider/collector, producer delivery,
  real financial record, browser/device check or owner functional acceptance.
- Owner APY document, multi-user drafts, cache files, normal environment and index
  are excluded from this implementation. All seven version fields remain 1.7.0.

## Source commit and producer handoff preparation

Reviewed the complete tracked diff and all new-file contents against the exact
18-file manifest below. Branch **main**, HEAD
`1da80871f57354f6429358d37e97b0517d1efaf3`; index **empty**. The listed task files
contain no unrelated owner hunks at this checkpoint, so explicit whole-file
staging of this list is appropriate. Excluded owner work remains unstaged and
unchanged. Stop and review again if the branch, HEAD, index or file scope changes;
do not discard/stash unrelated work to make a commit command succeed.

Finalized the [consumer-to-producer handoff](../architecture/GENERAL_TRANSACTION_API.md#consumer-to-producer-source-commit-handoff),
including wire contract/limits, registration, money/dates, stable identity,
owner-controlled pending resolution, cutover and unsupported evidence. Clarified
that `related_provider_reference` is retained evidence, not an automatic link.
No runtime or SQL defect requiring a code/migration change was found in this
preparation review. No source enablement or producer implementation is included.

Expanded the existing synthetic fixture file with **12 exportable offline
vectors** plus an injected transport-failure projection. The exporter is documented
in the contract and can be consumed by bank-data-sync without private records or
network access. The complete installment vector is prospective complete evidence;
the actual producer still loses original purchase date and its paired missing-date
vector remains held. Producer agreement and live readiness are separate from this
consumer source handoff.

Preparation checks: **10 contract tests passed**, including fixture validation;
**one new PostgreSQL matrix test passed all 12 vectors**, checking ordered response
projections, financial counts and confirmed-billing installment date. Prior 19
PostgreSQL/HTTP cases, 6 owner-review HTTP cases, actual producer mapper test and
unchanged legacy/CAL verification are reused with their recorded scope. This means
20 distinct general PostgreSQL/HTTP test cases now have passing evidence, not a
claim that the entire suite was rerun during preparation. The three changed
fixture/test JavaScript files passed refreshed lint with zero findings; version,
schema consistency, documentation links, whitespace and owner/index preservation
checks also passed. No frontend build is needed for these changes.

The owner performs staging and the source commit. Proposed message:
`feat(ingestion): add general transaction contract and receipt resolution (#96)`.
Review the staged scope and complete diff before committing; keep APY/multi-user
documents, cache/private files and normal environment out of the commit. Source
commit authorization does not imply functional acceptance, release selection or
deployment authorization. #96 stays **Open / Verify**, Priority unchanged, owner
acceptance **Pending**. All seven version fields stay **1.7.0** and the #96 entry
stays under **Unreleased**.

Future migration/rollout remains the separate owner-operated **052 → 053 → backend**
sequence documented above. Live activation follows only after separate agreement,
readiness checks and authorization. No blanket backup waiver applies to #96.

## Reviewed local file scope

Exact combined #96 manifest (18 files; includes the prior implementation):

```text
CHANGELOG.md
docs/README.md
docs/architecture/GENERAL_TRANSACTION_API.md
docs/operations/GENERAL_TRANSACTION_API.md
server/controllers/v1/transactionController.js
server/full_schema.sql
server/index.js
server/routes/reconciliationRoutes.js
server/migrations/052_general_transaction_contract.sql
server/migrations/053_general_receipt_resolution.sql
server/services/generalTransactionContract.js
server/services/generalTransactionIngestion.js
server/test/externalTransactionContract.test.js
server/test/fixtures/generalTransaction.js
server/test/generalProducerFields.local.test.js
server/test/generalTransactionContract.test.js
server/test/generalTransactionPostgres.local.test.js
server/test/reconciliationReview.test.js
```

- `server/services/generalTransactionContract.js` (new): strict shared evidence/envelope validation and bounds.
- `server/services/generalTransactionIngestion.js` (new): ordered per-item processing and bounded retry outcomes.
- `server/controllers/v1/transactionController.js`: explicit contract routing and legacy cutover error.
- `server/index.js`: raw request byte accounting and safe JSON parser errors.
- `server/migrations/052_general_transaction_contract.sql` (new), `server/full_schema.sql`: private receipts/registrations, atomic APY wrapper and cutover/installment guards.
- `server/migrations/053_general_receipt_resolution.sql` (new): immutable owner revisions, guarded resolution and effective-evidence reconciliation.
- `server/routes/reconciliationRoutes.js`, `server/test/reconciliationReview.test.js`: existing owner gate extended with receipt read/resolve and HTTP authorization validation.
- `server/test/generalProducerFields.local.test.js` (new): opt-in, synthetic-only verification of the actual producer mapper/allowlist.
- `server/test/generalTransactionContract.test.js`, `server/test/generalTransactionPostgres.local.test.js`, `server/test/fixtures/generalTransaction.js` (new): synthetic contract and persistence coverage.
- `server/test/externalTransactionContract.test.js`: legacy cutover response regression.
- `docs/architecture/GENERAL_TRANSACTION_API.md`, `docs/operations/GENERAL_TRANSACTION_API.md` (new), `docs/README.md`, `CHANGELOG.md`: contract, owner review, migration/recovery, navigation and Unreleased entry.

This is **18 task files**. Excluded owner changes: `docs/operations/APY_04_CAL_RECONCILIATION.md`,
`docs/MULTI_USER_ARCHITECTURE.md`, `docs/MULTI_USER_INVENTORY.md`, `docs/operations/__pycache__/`.
No normal environment files, packages/locks, frontend/native files or applied historical
migrations were changed. Index remains empty and unchanged; owner commits are separate.

## Release / Version gate

- Release impact: **Yes** — new opt-in general single/batch transaction evidence API
  with guarded owner resolution of receipt-only holds.
- SemVer impact: **Minor** — additive explicit contract; installed legacy and CAL
  callers retain compatibility, with an additive forward migration.
- Candidate release: **Pending owner selection**, tracked on #96.
- Grouping / included release candidate: **Pending owner selection**, #96.
- CHANGELOG status: **Updated under Unreleased**, #96 entry; prior entries preserved.
- Version-bump status: **Deferred** to owner-led release preparation; seven fields
  remain **1.7.0**. No candidate is chosen by implementation.
- Publication status: **Out of scope**.
- Owner verification / acceptance status: **Pending implementation review** and
  producer transition. Only the billing-date installment policy is explicitly
  owner-approved. Automated verification is not acceptance.
