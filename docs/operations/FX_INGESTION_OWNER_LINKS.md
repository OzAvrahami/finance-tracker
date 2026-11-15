# FX ingestion and explicit owner reconciliation

**Current checkpoint:** local migration-first compatibility correction based on
owner commit `9e9222fb5db8448c7460d967ea53b8a037c85bec`. Migration 064 remains
unapplied in production. The original candidate failed deployed-backend
compatibility; the revised candidate and recovery have been verified locally
as described below. No new commit or production action is performed here.

Local #99 follow-up, 2026-11-15, based on `71c29ce0cfb149ba15fee7096ff38da7b9962dd7`.
Implementation worktree: `D:\code\finance-tracker-fx-links`, branch
`fix/fx-ingestion-owner-links`. The existing dirty ingestion worktree and main
are preserved. No commit, push, version bump, production migration/deployment,
producer activation, workbook edit or real financial-record change is authorized
or performed by this implementation.

## Confirmed findings and implemented behavior

The existing `POST /api/v1/transactions` Single/Bulk contract already treats
`amount` as actual ILS accounting money and `currency`/`original_amount` as
original transaction evidence. `exchange_rate` is optional provider evidence.
The implementation removes `refund_currency_unsupported` from the JavaScript
policy, retaining positive JSON-number validation, durable identities, source
resolution and all other admission checks. Refunds post as negative expenses with
`bank_movement: refund`; original money stays positive. Missing rates remain null.
No ILS amount is calculated from original money or a rate, and no fee is inferred.
See the [Single/Bulk contract and example](../architecture/EXTERNAL_TRANSACTION_BULK.md#current-fx-expenserefund-contract-064-follow-up).

The previous explicit review path rejected FX via both JavaScript `protectedCash`
and the private SQL writer's `apy_protected` check. Explicit owner linking now uses
the unchanged non-FX domain protections and compares supplied original evidence
in JavaScript with exact decimal strings. Accounting-only ILS observations can
attach to FX cash. Supplied original amount/currency must agree; a supplied rate
must agree with the existing rate, including holding when the target lacks it.
Missing evidence never erases or fills the target. Incomplete supplied FX evidence
does not become authority for a new posting through a different review reason.

The target's signed amount, movement type, payment source and transaction-date
window still must agree. The existing date window remains at most one day;
`charge_date` is independent and is never used to disguise a purchase-date mismatch.
Observation revision, all candidate fingerprints, target fingerprint, source
exclusivity and duplicate prevention remain required. The existing authenticated
owner route supplies the actor; integration API credentials cannot perform review.

An explicit link updates the source observation and appends its audit event.
It does not UPDATE the transaction: amount, currency, original amount, exchange
rate, description, notes, transaction date, charge date and all other row fields
are preserved. This includes CAL sources with different billing evidence. Actual
billing correction must be completed separately, then reviewed from fresh facts.

Automatic matching, generic cancellation and automatic charge enrichment retain
their existing FX restriction. Loans, installments, parents/children, items,
Shopping checkouts, LEGO, Savings, voids and captured/closed-budget history remain
protected. No generic cancellation or domain bypass is added.

## JavaScript and PostgreSQL responsibilities

`ingestion/policy.js`, `ingestion/core.js` and `ingestion/reconciliation.js` own
eligibility, original-evidence comparison, matching and review policy. The existing
read projection uses the same `linkReason` as command execution for `can_link`.

Forward migration `064_fx_owner_links.sql` changes only the explicit-link branch
of the existing private `ingestion_core_apply(jsonb,jsonb,jsonb)` function. It
retains independent structural/linked-domain restrictions while removing the
blanket FX restriction only for this operation. It binds the target and revision
to the owner command, verifies candidate membership/fingerprints for UI reviews,
and permits only the deployed CAL writer's exact legacy enrichment shapes on
non-FX targets during a migration-first transition. New-backend owner links send
null enrichment and preserve the complete target row. Legacy provisional-date
writes still pass through the unchanged creator, charge-evidence, owner-override
and history checks below the link branch; conflict flags retain review-required
behavior. No-op/conflict shapes are exact boolean objects, and the write shape
binds the selected target and permits only the four existing fields. Non-CAL or
FX enrichment, malformed shapes and extra fields fail closed. This is command
shape/integrity handling: PostgreSQL does not classify, search for matches,
choose targets or implement FX comparison policy.

The unchanged commit function locks cash and related facts, recomputes the
snapshot token, and rejects stale facts before writing. Immutable request/amount
binding, row constraints, source exclusivity and atomic observation/event writes
remain in PostgreSQL. Service-role credentials can call snapshot/commit but cannot
call private apply/post; browser roles cannot call the commit boundary.

064 uses a transaction, a three-second lock timeout and a sixty-second statement
timeout. It requires the exact normalized 059 function-body MD5
`2af72eb0230b4f51594f21f6f50bafae`, SECURITY DEFINER, the known search path,
argument names, JSONB return type, PL/pgSQL language and volatility/null-call shape. An
unexpected definition or repeat application fails closed. CREATE OR REPLACE
preserves ownership and ACLs. `apy_protected`, automatic matching persistence,
cancellation and existing RLS/grants are not changed. The same suffix appears in
`full_schema.sql`; historical migrations remain byte-for-byte unchanged.

## Migration-first compatibility correction (2026-11-15)

The activation preflight correctly stopped before applying 064. Deployed
`71c29ce0cfb149ba15fee7096ff38da7b9962dd7` supplies non-null enrichment on every
CAL owner link. The original 064 candidate rejected even `{ok:true}`, so it was
not backward compatible despite passing updated-backend tests. The read-only
production ledger was checked again before editing: no 064 was recorded. The
actual function still has baseline MD5 `2af72eb0230b4f51594f21f6f50bafae`, the
expected guarded metadata and private postgres ownership/ACL. No applied
migration was edited.

The smallest correction changes only 064's explicit-link persistence validation
and its identical `full_schema.sql` suffix. Existing JavaScript is unchanged.
For a CAL observation and a target passing the original full `apy_protected`
restriction, the writer accepts exactly:

- `{ok:true}`: legacy no-op, including absent charge evidence or an already
  matching non-provisional date; the financial row is unchanged.
- `{ok:false}`: legacy enrichment conflict, including owner overrides or a
  conflicting fixed date. The provenance link persists but remains under review
  with `enrichment_conflict`; the financial row is unchanged.
- `{ok:true, transaction_id, creator_id, charge_date}`: legacy provisional-date
  enrichment. The target is bound to the command; creator and source date remain
  subject to the unchanged downstream guards. Sticky owner edits, protected
  domains/history, invalid creator/target and conflicting charge evidence reject
  the whole command. The existing date update and audit event remain atomic.

No SQL eligibility or matching policy was added. New-backend explicit links
always supply null, so they cannot enter the legacy financial-update path.
The migration's exact baseline/metadata guards, locks, command and target
binding, observation/candidate/target freshness, source exclusivity and
non-FX domain/history protections remain intact.

| Backend | Database | Verified result on disposable PostgreSQL 17.11 |
| --- | --- | --- |
| Deployed `71c29ce` | Existing 059 ingestion boundary | All legacy forms succeed through authenticated owner HTTP; provisional-date behavior and conflict-review outcomes preserved |
| Deployed `71c29ce` | Corrected 064 | Same legacy outcomes and exact replay; FX refunds/links still rejected by old JavaScript with no writes |
| Updated `9e9222f` ingestion code | Corrected 064 | FX Single/Bulk refunds and explicit links pass; complete target rows, including charge date, remain unchanged |
| Updated `9e9222f` ingestion code | Existing database | **Unsupported rollout order.** FX refunds can already persist and ILS null-enrichment links preserve rows, but FX links return HTTP 503 with no observation/event/financial mutation or false success |

The new `ingestionFxCompatibilityPostgres.local.test.js` loads the deployed
commit's actual core/policy/reconciliation source from Git and asserts pinned
SHA-256 hashes before execution. HTTP adapters are verified unchanged against
that revision; both the read projection and command implementation switch
together. The test reproduces the original candidate failure by its committed
checksum, then verifies the corrected transition, forged shapes/evidence,
non-CAL/FX enrichment rejection, stale reviews, owner override, protected items,
failure after provisional date update but before review-event persistence,
permissions and function-only recovery. All data and credentials are synthetic.

Verification: the compatibility suite passes **8 results** (seven subtests plus
parent), and the existing focused FX DB/Auth/HTTP suite passes **9 results**,
with zero failures/skips. The latter was rerun because the migration changed;
it covers fresh/forward schema parity, guard drift, rollback, all protected
domains, refunds/replay/conflicts, concurrent identities and full-row FX link
preservation. Prior unchanged JavaScript/unit and UI evidence was retained;
unrelated suites were not rerun. Logs are `%TEMP%/finance-fx-064-transition.log`
and `%TEMP%/finance-fx-064-compatibility-final.log`.

Corrected 064 SHA-256, UTF-8/LF:
`de4276644a48c6b23852797f5c62dd3752be5736910e4a993b5bea6fc95e0217`.
Expected post-064 normalized function-body MD5:
`75f960211c4d27d102e0b05290e4ef6d`.
The old candidate checksum `5e1a14e...` and its recovery postcondition are
superseded; do not use the old artifact for this corrected candidate.

Refreshed private recovery evidence is in
`C:/Users/ozavr/AppData/Local/FinanceTracker/recovery/064-compatible-20261115-212412`.
It retains the actual saved production definition/owner/ACL, corrected candidate,
strictly guarded function-only restore SQL, checksums and successful PostgreSQL
17 rehearsal. The restore guard accepts only the corrected body and saved
metadata/owner/ACL, restores only that function, preserves financial/evidence
rows, rejects repeated/unexpected recovery and restores old-backend behavior.
Use a separately authorized forward recovery entry; never delete activation
history or automatically undo financial rows. This is not a full backup/PITR
claim. Hosted extension/image parity, live-provider and owner acceptance remain
unverified. Production checks in this correction were read-only.

## Earlier implementation/pre-commit verification (before compatibility correction)

| Executed check | Result |
| --- | --- |
| `node --test server/test/ingestionFxPostgres.local.test.js` | Final pre-commit run: PostgreSQL **17.11**, 9 passed, 0 failed, 0 skipped (eight subtests plus parent), 74.8 seconds |
| `node --test server/test/ingestionFx.test.js server/test/ingestionCore.test.js` | Final pre-commit run: 32 passed, 0 failed, 0 skipped |
| `npm test --prefix server` | Earlier implementation run: 723 passed, 0 failed, 0 skipped; includes six new focused FX policy/command tests |
| `node --test server/test/ingestionCorePostgres.local.test.js server/test/manualRefundPostgres.local.test.js` | Earlier PostgreSQL 16 implementation run: 36 passed, 0 failed, 0 skipped |
| `npm test --prefix client -- src/pages/Transactions/Reconciliation.test.jsx` | Earlier implementation run: 12 passed, 0 failed, 0 skipped |
| Changed JavaScript syntax checks / `git diff --check` | Passed |
| Historical migration/reference-schema comparison | All 64 previously tracked migration files and the existing full-schema prefix preserved; new 064 suffix matches exactly |
| Application versions | All seven fields remain 2.0.0; manifests/lockfiles unchanged |

The new integration suite starts its own disposable PostgreSQL 17, Supabase Auth
and PostgREST containers plus the real Express app. It uses synthetic credentials
and loopback HTTP, never existing database containers or hosted records. It checks:

- Fresh consolidated-reference installation versus forward upgrade from the 059
  ingestion boundary, exact public function definitions/ACLs, preserved prior cash
  and evidence, migration rollback, definition drift and repeat-application refusal.
  Metadata-drift checks cover volatility, strictness, SECURITY DEFINER and search path.
- Real Single/Bulk routes for existing FX expenses/new FX refunds, actual ILS
  amounts differing from original amount times rate, missing rates, original
  evidence, exact replay, changed-content conflict, held evidence and concurrency.
- Real authenticated owner review/readback, complete financial-row preservation,
  conflict holds, source exclusivity, fresh review after billing correction,
  stale/forged commands, integration-credential rejection and atomic failures.
- Persisted loan/loan-payment, installment, parent/child, item, LEGO, Shopping,
  Savings, void and closed-budget guards. Unit tests additionally cover carryover
  and unused-disposition capture facts and sub-double-precision FX conflicts.

The existing 058 and 059 regression suites intentionally exercise their historical
schema stages; they are not evidence that old SQL should be replayed in production.
The migration freshness comparison uses the repository's consolidated reference,
not a fresh reproduction of every hosted Shopping activation or external drift.
PostgreSQL major-version compatibility is now verified. The disposable server was
17.11, while the hosted server reports 17.6; this is not an exact hosted image or
extension-stack reproduction. No live-provider ingestion, production record
correction or browser/manual acceptance is claimed. The optional Chromium
branch of the existing manual-refund harness was not enabled; the 12 UI tests are
Vitest component tests. No dependencies, deployment workflow or frontend code
were changed; existing dependency directories were reused via local junctions.

### Final pre-commit review (2026-11-15)

Local main and the independently read remote main still point to
`71c29ce0cfb149ba15fee7096ff38da7b9962dd7`, the integration base for all 14 task
files. The complete tracked diff and four new files were reviewed together.
The JavaScript behavior, migration 064, identical consolidated-schema suffix,
API contract and Unreleased entry agree. No runtime or migration defect was found.
The review closed the hard-coded PostgreSQL 16 verification gap by adding an
optional image argument to the shared helper and selecting/asserting major 17
in the focused suite. Existing harness callers keep their PostgreSQL 16 default.
Metadata guard coverage was expanded; no application or schema code changed
during this final review. Its disposable containers/network were removed.

Run evidence is retained locally in `%TEMP%/finance-fx-postgres17.log` and
`%TEMP%/finance-fx-precommit-unit.log`. The PostgreSQL image used was
`postgres:17-alpine`, digest
`sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`;
Auth was `v2.195.0` and PostgREST `v14.15`. Earlier 723/36/12 results remain
historical evidence, not newly executed or PostgreSQL 17 results. Their original
logs lack source-hash manifests, so they are not represented as independently
hash-certified reruns. No unrelated suite was rerun. A normalized SHA-256 manifest
(UTF-8, CRLF converted to LF) for the current 14 task files is retained at
`%TEMP%/finance-fx-precommit-sha256.json` for subsequent local comparisons.

Historical persistence and runtime hashes for those focused results (the
unapplied migration/schema candidate is superseded by the correction below):

| File | SHA-256 (LF-normalized) |
| --- | --- |
| `server/migrations/064_fx_owner_links.sql` | `5e1a14e69c724411193feafb6b97c7b4720545e57264c60b737f325640fed09a` |
| `server/full_schema.sql` | `93f7fd48a23cb483c37500689ea26e3c01729b763b33cf53a74f64707e153aee` |
| `server/services/ingestion/core.js` | `9461f6786dfebfada356771d0f2a4e038f04f6a9480dc3cdfb64cd89352fd1bb` |
| `server/services/ingestion/policy.js` | `f55d70b6da783fd7edd73b1d2cfda74c6d31c7ad376520b92bc8826d29f98ed5` |
| `server/services/ingestion/reconciliation.js` | `a518da7514e6ea43f95b622aa0d75f27bc516f233492e054823590063dd2de59` |
| `server/test/helpers/refundEnvironment.js` | `6447824a0418a35f708e7e138b2d883da6cc42c0a3cf3bf5b4ca6934c7fd5d0c` |
| `server/test/ingestionFxPostgres.local.test.js` | `708c11f0f4f35c97d96fdb1c52c3cf547b6eb79bb4c0274fe25d130379b26148` |

### Hosted compatibility preflight (read-only, 2026-11-15)

The connected Supabase project **finance tracker**, reference
`ohhvzveyreolguztcnqx`, reports PostgreSQL **17.6**. Catalog queries ran in
`BEGIN READ ONLY` transactions; only definitions' hashes, function metadata and
permissions were inspected. No financial records were queried or changed.

- The actual `ingestion_core_apply(jsonb,jsonb,jsonb)` normalized body MD5 is
  `2af72eb0230b4f51594f21f6f50bafae`, matching 064's guarded 059 baseline.
  SECURITY DEFINER, search path, JSONB return type, non-set/non-strict volatile
  shape, argument names and PL/pgSQL language all match the migration guard.
- Owner is `postgres`; ACL is `{postgres=X/postgres}`. `anon`, `authenticated`
  and `service_role` cannot execute private apply. Snapshot/commit allow
  `service_role` but deny browser roles. The checked `apy_protected`,
  `apy_captured` and `apy_review_fingerprints` body hashes also match the local
  reference, and their execute permissions remain private.
- The migration ledger lists 055, 056, 059, 060, 061, 062, 063 and
  `shopping_owner_http_read_boundary` (last version `20261114152838`). It has
  **no 064 entry**. Missing historical ledger entries are not authorization to
  replay them; the actual target function is the compatibility evidence.
- This is a point-in-time preflight, not migration execution, deployment,
  backup/restore proof or production acceptance. Repeat it immediately before
  any separately authorized activation; do not weaken guards on later drift.

Changed files: the three ingestion modules; new `server/migrations/064_fx_owner_links.sql`
and the matching `server/full_schema.sql` suffix; new unit and real-PostgreSQL FX
tests; the focused existing core assertion, historical manual-refund fixture and
its shared environment helper; `CHANGELOG.md`, the Single/Bulk contract,
`INGESTION_PACKAGE_1.md` pointer and this handoff/operations plan.

## Remaining activation steps

1. Owner reviews the local diff, verification and release impact; owner performs
   any commit/integration/push. Candidate version/grouping is a later decision.
2. Separately authorize production activation. Verify target identity, current
   migration ledger, actual function definition/ACLs and recovery readiness.
   This work does not establish hosted backup/restore capability or waive it anew.
3. Apply **only new migration 064** using the existing owner-operated procedure,
   then deploy the matching backend. Do not rerun 058/059 or Shopping migrations.
   If the definition guard fails, investigate drift; do not weaken the guard.
   The corrected 064 preserves deployed-backend CAL behavior during the interval.
   Then deploy the matching backend for FX links and full target-row preservation.
   Do not deploy the updated backend first: old persistence rejects FX links.
   Reverify the corrected candidate checksum, fresh target baseline/ledger and
   private recovery guards immediately before any separately authorized apply.
4. Read back definitions/permissions and verify normal authenticated owner review
   and producer contract behavior. No new producer activation is implicit.
5. Obtain owner acceptance. Production fixes to existing data require the separate
   plan and authorization below. Deployment itself never reprocesses held identities.

## Separate follow-up for the 13 reviewed transactions — not executed

Exact target IDs: **1844, 1845, 1846, 1847, 1851, 1852, 1853, 1854, 1855,
1856, 1857, 1858, 1859**. There are 13 unique IDs; 1848–1850 are not included.
The owner confirmed **2026-04-10** as the correct charge date after the billing-day
change from 2 to 10 in March. Descriptions and previous-name notes are already
corrected: preserve their complete current values and add no duplicate annotation.
That confirmation does not authorize this implementation step to mutate real data.

### Operation 1: charge-date correction

1. Obtain separate real-data execution authorization and verify the intended
   environment and activated backend/migration. Freeze the exact 13-ID set.
2. Read fresh complete rows plus associated source observations, audit history,
   financial/domain links and budget capture state. Record row/cash fingerprints,
   revisions, old charge dates, current descriptions/notes and immutable source
   evidence. Verify each ID's identity against the decision workbook. Do not infer
   a source observation ID from the transaction ID or merchant name.
3. If a row already has `charge_date = 2026-04-10`, record a no-op. Otherwise use a
   separately reviewed owner correction that locks the row and compares its fresh
   full-row fingerprint before changing **only `charge_date`** to 2026-04-10.
   Preserve the normal update/audit triggers and their owner-override metadata.
   Never replay a stale full-row form payload over later owner edits. Stop on
   unexpected identity, row count, concurrent edit or protected captured/domain
   history; use that domain's reviewed correction procedure, not a guard bypass.
4. Read all 13 rows back independently. Verify exactly 13 identities, correct
   charge dates, unchanged descriptions/notes, transaction dates, signed amounts,
   payment sources, FX fields and links. Only normal update/audit metadata and
   charge dates may differ. Do not add or remove financial records.

### Operation 2: explicit source linking

1. Discard every pre-correction review token/fingerprint. After charge-date
   readback, fetch fresh owner reconciliation details for each actual pending
   source observation: observation revision, candidate set/fingerprints and exact
   selected transaction fingerprint. Do not reuse date-correction snapshots.
2. Independently verify signed ILS amount, movement type, payment source,
   transaction date, original FX evidence if supplied, source exclusivity,
   duplicate history and protected-domain/budget status. A confirmed billing date
   is not proof that a particular observation is the same purchase. Hold any
   conflict, missing required evidence or ambiguous identity for owner decision.
3. Submit the existing owner link command for one verified observation/target pair,
   with a fresh request UUID and the exact fresh review fields. Retain the frozen
   command for a lost-response replay. Do not issue a new external transaction,
   choose `separate`, change `external_id`, alter accepted source evidence or
   recover historical records automatically.
4. Read back the observation, target transaction and reconciliation event. Require
   the intended persisted `transaction_id`, `outcome = reconciled`,
   `reason_code = owner_link`, **`review_required = false`**, correct source and
   owner audit identity, no duplicate source link, and no additional cash effect.
   Verify the full target row, including `charge_date = 2026-04-10`, remains equal
   to its post-date-correction snapshot. A response alone is not readback proof.
5. Only after those checks may the corresponding case be removed from the active
   decision workbook (retain its evidence in the completion audit). Keep unresolved,
   stale, failed, uncertain and conflicting cases in the workbook. Track date
   correction and source linking as separate per-ID statuses; final completion
   requires independent readback for every intended pair, not merely 13 dates.

## Release / Version gate

- Release impact: **Yes** — supported FX refund intake and explicit reconciliation behavior change.
- SemVer impact: **Patch** for this compatibility correction; the combined unreleased FX capability remains **Minor** relative to v2.0.0. Existing public API shapes remain unchanged.
- Candidate release: **Pending (TBD)** — owner to coordinate the next candidate under #99 after review.
- Grouping / included release candidate: **Pending (TBD)** — this FX follow-up is tracked with #99; remaining #99 packages are not implicitly included or completed.
- CHANGELOG status: **Updated under Unreleased** — FX ingestion and explicit reconciliation (#99 follow-up).
- Version-bump status: **Deferred** — owner-controlled release preparation after candidate selection; all seven existing fields remain 2.0.0.
- Publication status: **Out of scope** — no commit, push, tag, release, migration or production deployment authorized by this implementation.
- Owner verification / acceptance status: **Pending review** of this implementation and subsequent authorized activation; confirmation of the 13 charge dates is separate evidence.
