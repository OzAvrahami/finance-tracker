# Unified ingestion: final regression triage

Assessment date: 2026-11-04. Baseline: `3471333d901d61eba62c67e5576217f97e2b083e`.

**Repair update (2026-11-04):** All 14 original failures now pass after test-only fixture repairs. Backend: 573/573; unified-ingestion PostgreSQL: 16/16. **Complete broader PostgreSQL suite: 239 passed, 0 failed, 0 skipped.** The requested automated regression gate is clear; production remains NO-GO pending the separate owner/operational gates. Application code, production SQL and historical guards are unchanged.

Original triage finding: All 14 originally reported failures reproduced on the original committed baseline and on the local unified-ingestion implementation. **No confirmed new regression among these 14; no unresolved baseline classifications.** Eight are existing baseline fixture/expectation defects; six are environment-sensitive test/preflight fingerprint failures, also reproduced at baseline. No application code, migration, test assertion or fixture was changed during that original triage; the separately authorized baseline repairs are recorded below.

## Controlled comparison

- A detached Git worktree at `3471333` was created outside the main checkout. The first run used its ordinary Windows checkout and reproduced all 14 failures.
- The checkout converted 32 historical SQL files to CRLF while the primary checkout held their original LF bytes. A second baseline run aligned only those worktree file bytes with the primary checkout after verifying their LF-normalized content against Git HEAD. It again reproduced all 14 failures. `git diff --ignore-space-at-eol` was empty; no SQL logic or assertion was edited.
- All seven affected test files were byte-identical. All 72 tracked migration/preflight/postflight files matched byte-for-byte in the controlled run. The full-schema prefix through 053 matched; migration 054 exists only in the candidate, as intended.
- Both sides used the same `C:\Program Files\nodejs\node.exe`, Node **v24.11.1**, same installed server dependencies via a worktree junction, identical server lockfile, inherited environment and `--test-concurrency=2 --test-reporter=tap`. These PostgreSQL suites use Node built-ins and Docker rather than a separately installed database client package. No dependency installation or upgrade was performed.
- Both sides used **PostgreSQL 16.15**, image `postgres:16-alpine`, digest `sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685`, with disposable containers and no published ports. The database clock reported `2026-11-04`, Asia/Jerusalem month `2026-11`.
- The 14 affected tests ran without skips on each side. The current-tree broad rerun uses the same 13 Budget/Savings/Shopping test files and concurrency as the original 239-test run. No other repository or production database was used.

## All 14 failures

Every row below failed in both the matched baseline run and current affected-test rerun, with the same failing condition. The distinction in the classification column separates existing fixture/expectation defects from the line-ending environment problem; **all 14 are baseline-reproducible**.

| # | Exact failed test and source | Classification | Verified root cause |
| --- | --- | --- | --- |
| 1 | **initialized override accounting preserves carryover, other adjustments, and immutable starting state**<br>[fundedBudgetPostgres.local.test.js:1847](../../server/test/fundedBudgetPostgres.local.test.js) | Existing baseline failure | Fixed August/September 2026 fixture applies carryover to September; migration 019 permits only the current Asia/Jerusalem month, November 2026. |
| 2 | **release limits clamp negative actuals and reject spent base atomically with exact details**<br>[fundedBudgetPostgres.local.test.js:1881](../../server/test/fundedBudgetPostgres.local.test.js) | Existing baseline failure | Fixed September 2026 override reaches HISTORICAL_MONTH_OVERRIDE_FORBIDDEN before the release-limit assertions. |
| 3 | **transaction changes serialize before override release and cannot produce a stale safe-release decision**<br>[fundedBudgetPostgres.local.test.js:1936](../../server/test/fundedBudgetPostgres.local.test.js) | Existing baseline failure | Fixed September 2026 override is rejected during setup, before either concurrent transaction starts. |
| 4 | **manual, copied, recurring, and carryover-only snapshots layer overrides without rewriting openings**<br>[fundedBudgetPostgres.local.test.js:1963](../../server/test/fundedBudgetPostgres.local.test.js) | Existing baseline failure | Fixed September 2026 recurring initialization is rejected as historical before snapshot-layering assertions. |
| 5 | **pending override blocks carryover until override-aware initialization establishes its base**<br>[fundedBudgetPostgres.local.test.js:2013](../../server/test/fundedBudgetPostgres.local.test.js) | Existing baseline failure | Fixed September 2026 override is rejected during setup before carryover-gate assertions. |
| 6 | **override, initialization, carryover, copy, and generic adjustment share one deadlock-safe month order**<br>[fundedBudgetPostgres.local.test.js:2039](../../server/test/fundedBudgetPostgres.local.test.js) | Existing baseline failure | Fixed September 2026 override is rejected during setup before the lock-order race starts. |
| 7 | **032 upgrade preserves all rows, object counts, Loan definitions/grants; clean snapshot agrees**<br>[savingsInterestPostgres.local.test.js:79](../../server/test/savingsInterestPostgres.local.test.js) | Environment / test infrastructure | 032 preflight hashes raw CRLF function bodies against LF fingerprints; expected_event_engine and expected_history_reader are false. |
| 8 | **031 clean/upgrade inventory and grants preserve two-table/one-view boundary and Loan definitions**<br>[savingsManualPostgres.local.test.js:74](../../server/test/savingsManualPostgres.local.test.js) | Existing baseline failure | 031 fixture has 28 tables / 10 views; the test compares it to the later full schema with 48 tables / 11 views. The mismatch already exists at HEAD. |
| 9 | **034 upgrade and clean snapshot preserve all history, privileges, Loan functions and relation counts**<br>[savingsMonthlyPostgres.local.test.js:126](../../server/test/savingsMonthlyPostgres.local.test.js) | Environment / test infrastructure | 034 preflight rejects CRLF-derived event-engine/history-reader hashes; their LF-normalized values exactly match the recorded fingerprints. |
| 10 | **issue 47 allocation contracts on complete v1.3.0 schema 035**<br>[savingsReleasePostgres.local.test.js:101](../../server/test/savingsReleasePostgres.local.test.js) | Existing baseline failure | A 029-through-035 upgrade catalog is compared to clean_035 loaded from the complete later schema (through 053 at HEAD). CAL/FlowLink/general-API objects already differ before 054. |
| 11 | **029 → 035 with reserve 0: preservation, clean equivalence, overlap and recovery**<br>[savingsReleasePostgres.local.test.js:209](../../server/test/savingsReleasePostgres.local.test.js) | Environment / test infrastructure | Reserve-0 release rehearsal stops at 032 preflight because raw CRLF hashes differ from expected LF hashes; later upgrade/recovery assertions are not reached. |
| 12 | **029 → 035 with reserve 500: preservation, clean equivalence, overlap and recovery**<br>[savingsReleasePostgres.local.test.js:209](../../server/test/savingsReleasePostgres.local.test.js) | Environment / test infrastructure | Reserve-500 release rehearsal stops at the same 032 CRLF-sensitive preflight, independently of reserve amount. |
| 13 | **034 upgrade and clean snapshot preserve history, relations and all write/Loan definitions**<br>[savingsReportingPostgres.local.test.js:144](../../server/test/savingsReportingPostgres.local.test.js) | Environment / test infrastructure | 035 preflight rejects CRLF event-engine/history-reader hashes; LF-normalized values match the expected fingerprints. |
| 14 | **upgrade from 032 preserves reserve retirement, every financial row and object boundary; clean snapshot matches**<br>[savingsSurplusPostgres.local.test.js:143](../../server/test/savingsSurplusPostgres.local.test.js) | Environment / test infrastructure | 033 preflight rejects CRLF event-engine/history-reader hashes; LF-normalized values match the expected fingerprints. |

## Root-cause evidence

**Calendar-sensitive fixtures (1-6).** The tests call August/September 2026 operations while the database clock is November. Existing migration 019 rejects non-current-month carryover; migrations 018/020 reject historical recurring initialization/overrides. The failure messages match on both branches. In tests 3 and 6, setup fails before the concurrency checks, so these failures are not evidence of a new ingestion deadlock.

**CRLF fingerprints (7, 9, 11-14).** An additional portless disposable database loaded the baseline schema and unchanged migrations through each preflight boundary. For both checked functions at stages 032, 033, 034 and 035, raw `md5(prosrc)` differed, while `md5(replace(prosrc, chr(13), ''))` exactly matched the expected constant: all eight fingerprint comparisons were explained by CRLF bytes. For example, the pre-032 event engine's raw hash was `471a0e7c3c5c53bfc97a2b212a30be3d`; removing carriage returns produced the expected `3a89a0b93d4a6260d8979562dc02c127`. This was a diagnostic SELECT only; no preflight or function definition was relaxed. The environment issue is baseline Windows checkout portability, not a production schema verification result.

**Mismatched schema boundaries (8, 10).** Both tests load the unrestricted full-schema file into a database named as an older version and compare it with a genuine historical upgrade boundary. At HEAD the full schema already contains later CAL, FlowLink and general API objects. Test 8 fails on 48/11 versus 28/10 relation counts; test 10 fails its whole-catalog comparison before its accounting scenarios. The original migration 054 is not required to reproduce either failure.

## Original triage rerun results (before repair)

| Run | Passed | Failed | Skipped | Meaning |
| --- | ---: | ---: | ---: | --- |
| Pristine baseline worktree, affected tests | 0 | 14 | 0 | Reproduces every original failure |
| Baseline worktree, exact matching fixture bytes | 0 | 14 | 0 | Confirms same-environment comparison |
| Unified working tree, affected tests | 0 | 14 | 0 | Same names and failure conditions |
| Unified working tree, broader PostgreSQL suite | 225 | 14 | 0 | 239 tests; exact original failure set, no additional failures |

The zero passes in the affected runs are expected: the selection contains only the 14 previously failing cases. They are not whole-suite counts.

## Original triage disposition (superseded by the repair below)

No confirmed new regression was found in the 14 cases, so **no code/test/migration fix was made**. Only this triage record, its history-index link and the existing implementation report are updated. The tests and production guards retain their original expectations and enforcement.

The prior eleven unknown classifications are resolved. Follow-up work on baseline date fixtures, line-ending-safe verification and matching historical schema boundaries needs separate scope; do not bypass production guards or weaken assertions. Those defects mean the broader suite remains red, even though they do not establish a rewrite regression. A matching early failure also cannot prove later assertions that the failed setup never reached.

**GO for completing this regression triage and owner review of the unchanged implementation. NO-GO for production deployment.** Owner acceptance of the ingestion behavior, disposition of the known baseline test gate, an explicit recovery decision, and a separately authorized coordinated migration/backend cutover remain outstanding. Production backup/recovery availability is not established by disposable test backups or restore attempts. No production actions or producer activation are authorized by this report.

## Original triage evidence and preservation

Local evidence directory: `C:\Users\ozavr\AppData\Local\Temp\finance-regression-triage-4cv10n4z`.

It contains the detached `baseline-3471333` worktree, exact `*.command.json` argument/cwd/exit-code records, `baseline-affected.tap`, `baseline-matched-affected.tap`, `current-affected.tap`, `current-broad.tap`, original failure details, fixture/environment parity records and `root-cause-proof.json`. These logs contain synthetic test evidence. The command records allow the exact 14-name selection to be repeated without editing tests. Test-created containers are disposable; the worktree/evidence are retained for owner inspection.

Final SHA-256 comparison verified that every pre-existing runtime/source, migration, test, package/lockfile and unrelated owner file retained its starting content. This includes the APY operations document, both multi-user documents and the operations `__pycache__` file. Only the implementation report and history index changed, plus this new triage record. The primary HEAD and staged diff remain unchanged. `git diff --check` passed. No task test container remains running; the isolated worktree and evidence are retained. No staging, commits, pushes, tags, production migrations, deployments, configuration changes, bank scraping or Financial Data Bridge access occurred.

## Encompassing implementation Release / Version gate (unchanged)

This verification-only triage introduces no additional product change. The encompassing unified-ingestion candidate's gate remains:

- Release impact: **Yes** ? unified financial intake and retired protocol behavior.
- SemVer impact: **Major** ? existing decision for retired envelopes and coordinated operational cutover; not changed by triage.
- Candidate release: **Pending (TBD)** ? owner selection.
- Grouping / included release candidate: **Pending (TBD)** ? owner coordination.
- CHANGELOG status: **Updated under Unreleased** by the implementation; unchanged in this triage.
- Version-bump status: **Deferred** to owner release preparation; no version/dependency changes.
- Publication status: **Out of scope**.
- Owner verification / acceptance status: **Pending review**.

## Authorized baseline repair ? 2026-11-04

The owner subsequently authorized correcting the proven baseline defects in tests only. All original test names, financial expectations, concurrency assertions, privilege checks and strict function fingerprints are retained. No test is skipped, deleted or disabled. Historical production guards and all migration/preflight/postflight SQL files remain byte-for-byte unchanged.

### Repair for each original failure

Numbers refer to the exact test names in the 14-row matrix above. Each case now passes its complete body, including assertions that the former setup failures prevented from executing.

| Original case | Test-only repair | Preserved verification | Targeted result |
| --- | --- | --- | --- |
| 1 | Query the disposable database's Asia/Jerusalem current and previous months; use them for funding, transactions and carryover. | Exact carryover, other adjustments and immutable opening amounts. | Passed |
| 2 | Use the database's current month for the override and transaction fixture. | Exact blocked-release details, atomic rejection and negative-actual clamping. | Passed |
| 3 | Use the current month throughout setup and both concurrent operations. | Transaction serialization, blocked unsafe release, no override event and reconciled month. | Passed |
| 4 | Use previous/current/next months for carryover, active overrides and the separate copy source. | Manual/copied/recurring/carryover-only origins and unchanged opening snapshots. | Passed |
| 5 | Use previous/current months for source funding and the pending destination override. | Carryover remains blocked until override-aware initialization; exact balances afterward. | Passed |
| 6 | Use previous/current/next months for carryover, destination and copy source. | Five concurrent operations, no deadlock, exact resulting state and reconciliation. | Passed |
| 7 | Normalize SQL fixture CRLF to LF before disposable loading; compare the clean snapshot through 032. | Original pre/postflight fingerprints, unchanged rows/counts/Loan definitions/grants and exact function equality. | Passed |
| 8 | Load the clean snapshot through 031, with the same canonical SQL fixture loader. | Full relation-count equality, Loan definitions, privilege boundary and exact event-function equality. | Passed |
| 9 | Normalize fixture line endings; compare clean and upgraded schema through 034. | Original pre/postflight fingerprints, history, privileges, Loan definitions and relation counts. | Passed |
| 10 | Load clean_035 only through migration 035; retain raw-file SHA-256 evidence separately from normalized SQL loading. | Whole-catalog equality and all issue-47 allocation/accounting scenarios. | Passed |
| 11 | Canonical LF SQL fixtures plus the correct clean_035 boundary. | Every 030?035 pre/postflight, reserve-0 history, overlap, catalog/row/sequence equality and disposable restore. | Passed |
| 12 | Same fixture corrections for the independent reserve-500 scenario. | Existing reserve retirement, no invented cash, history, overlap and disposable restore assertions. | Passed |
| 13 | Normalize fixture line endings; compare clean and upgraded schema through 035. | Original pre/postflight hashes, unchanged writes/Loan definitions and reporting equivalence. | Passed |
| 14 | Normalize fixture line endings; compare clean and upgraded schema through 033. | Original pre/postflight hashes, reserve retirement, financial rows and object boundaries. | Passed |

The shared test helper changes only CRLF to LF; it does not strip SQL tokens, comments or other whitespace. Expected fingerprints are unchanged. Historical snapshot selection fails if the next migration marker is absent. Later migrations remain covered by the current full-schema clean-install test and unified-ingestion migration suite; historical parity tests no longer compare different schema versions. The six date fixtures read the same timezone and database clock as the production guards rather than bypassing them.

### Repair files

- `server/test/fundedBudgetPostgres.local.test.js`
- `server/test/helpers/sqlFixtures.js` (new test-only helper)
- `server/test/savingsInterestPostgres.local.test.js`
- `server/test/savingsManualPostgres.local.test.js`
- `server/test/savingsMonthlyPostgres.local.test.js`
- `server/test/savingsReleasePostgres.local.test.js`
- `server/test/savingsReportingPostgres.local.test.js`
- `server/test/savingsSurplusPostgres.local.test.js`
- This report and `docs/architecture/UNIFIED_TRANSACTION_INGESTION.md` (verification record only).

### Repair verification

| Run | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Exact original 14-test selection | 14 | 0 | 0 |
| Complete broader Budget/Savings/Shopping PostgreSQL suite | 239 | 0 | 0 |
| Unified ingestion, disposable PostgreSQL | 16 | 0 | 0 |
| Canonical backend regressions, serial execution | 573 | 0 | 0 |

The targeted selection was checked against the exact original failure-name set. All tests and assertions in the seven existing test files are retained. Node remains v24.11.1, with unchanged dependencies and the same PostgreSQL 16.15 image; broader/targeted runs use concurrency 2 and backend uses concurrency 1. Only portless disposable databases and synthetic data were used. The 16 unified tests include preservation of the 38 synthetic historical CAL receipts and the existing identity, reconciliation, cancellation and domain scenarios. Backend regressions include the unchanged controller, Bulk, manual, Loan, Savings, LEGO, Shopping and paused-channel compatibility coverage.

Repair evidence directory: `C:\Users\ozavr\AppData\Local\Temp\finance-baseline-repair-0cq1xo6_`.

It retains `repaired-affected.tap`, `repaired-broad.tap`, `unified.tap`, `backend.tap`, their exact `*.command.json` records, `fixed-14.json`, environment and version inventory, and the starting file hashes. The original baseline evidence directory above remains intact. Disposable backup/restore tests do **not** establish production backup or recovery availability.

The complete broader run took 784.06 seconds across the same 13 test files. The exact original 14 names also appear as passing in that final complete run. The targeted selection took 308.80 seconds; unified ingestion took 83.29 seconds; backend took 25.20 seconds. Every run exited 0, with no cancelled, skipped or todo cases. `final-results.json` records the parsed counts and `preservation.json` records the final file checks.

**Remaining test failures: none in the requested suites. GO for owner review of this local baseline repair; production NO-GO.** The former 14-test baseline blocker is resolved. Owner acceptance of unified ingestion, an explicit recovery decision and a separately authorized coordinated migration/backend cutover remain required. Production backup/recovery is not verified or assumed available. The encompassing Major compatibility decision is unchanged; this repair does not authorize release preparation, publication, producer activation or production operations.

Final SHA-256 comparison against all 597 starting paths confirms that only the seven listed existing test files and two verification reports changed; the SQL fixture helper is the only new repository file from this repair. All pre-existing application changes, migrations (including 054), production SQL scripts, package/lockfile bytes and unrelated owner files are preserved, including the APY operations document, both multi-user documents and operations `__pycache__`. All original assertion calls and test declarations in the seven suites are retained. HEAD remains `3471333d901d61eba62c67e5576217f97e2b083e`, the staged diff is empty, all seven version fields remain 1.8.0, and `git diff --check` passes. Test-owned containers have been removed by teardown. No production access/migration, Financial Data Bridge access, staging, commits, pushes, tags, deployments or configuration changes occurred.

### Repair Release / Version gate

- Release impact: **No** ? test fixtures/infrastructure and verification documentation only; no financial application behavior change.
- SemVer impact: **None** ? internal test repair.
- Candidate release: **Not applicable** ? no standalone product release required.
- Grouping / included release candidate: **Standalone test repair**; the encompassing unified-ingestion candidate remains Pending (TBD) as recorded above.
- CHANGELOG status: **Not applicable** ? test-only repair recorded here; existing Unreleased implementation entry preserved.
- Version-bump status: **Not applicable** ? all seven canonical fields remain 1.8.0; dependencies unchanged.
- Publication status: **Out of scope**.
- Owner verification / acceptance status: **Pending review**.
