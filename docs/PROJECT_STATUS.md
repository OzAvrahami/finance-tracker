# Project Status

## Current integrated Savings handoff — 2026-09-15

The owner approved the SAV-08 integrated-verification and release-preparation handoff. #37–#44 are completed / Done; #44 is independently verified Closed / Completed / Done with P2 — Medium and its existing metadata and relationships preserved. This uses the recorded technical evidence and actual owner confirmations, without inferring additional numerical/device or production checks. Parent #36 and milestone v1.3.0 remain open. The separate seven-field version step is now prepared at **1.3.0** on `feat/savings-v1.3.0`; the reviewed work is prepared for an owner-operated commit and remains uncommitted/unpublished at this handoff. Production migrations030–035 and deployment are not executed. The [canonical runbook and transfer instructions](RELEASE_1_3_0.md) record the inventory, existing verification, recovery limits and remaining owner-controlled workflow.

Earlier stage-status and acceptance notes below are historical; this current handoff supersedes their pending-review wording without changing the recorded test evidence.

## Historical Savings acceptance — 2026-09-14

Owner confirmation “הכל נראה תקין גם המשימות האחרות” completes #40–#42 when combined with their documented technical verification: all three are independently verified Closed / Completed / Done, with existing P2/P1/P2 priorities and relationships preserved. This is confirmation that the features look correct, not a claim of specific owner tests or production acceptance. Prior deferred/pending-review notes in historical evidence below are superseded. #43 reporting is implemented and Open / Verify; #44 remains unstarted. The complete Savings work remains local/uncommitted and undeployed. See [current handoff](SAVINGS_FOUNDATION.md).


## Historical SAV-03–07 implementation evidence

- [SAV-01 / #37](https://github.com/OzAvrahami/finance-tracker/issues/37) remains completed / Done. The canonical LOCAL [specification](SAVINGS_V1_3_0_SPEC.md) and approved product scope remain authoritative; incoming SAV-01 hash d03d510a1791e9135440d495de2465a17c4c3f71a32a6cffb1c92fa501ce6b70 is historical provenance, not the hash of this subsequent implementation reconciliation.
- The owner explicitly accepted [SAV-02 / #38](https://github.com/OzAvrahami/finance-tracker/issues/38): “בנוגע לחסכון מאושר אפשר להתקדם”. Independent readback confirms CLOSED / COMPLETED / Done / P1 — High. This is owner-reported acceptance, without inventing individual owner checks. Migration 030/account foundation remains local and is not claimed deployed.
- [SAV-03 / #39](https://github.com/OzAvrahami/finance-tracker/issues/39) is completed / Done / P1 — High after the owner’s confirmation of corrected appearance and its existing implementation/verification evidence. No additional owner functional checks are inferred. Both issues retain one existing Project item, labels, assignees, milestone v1.3.0, parent #36 and native dependencies (#38→#37, #39→#38); completed dependencies remain. All unrelated Project items were read back unchanged. #40 realized interest, #41 funded transfers and #42 monthly deposits are accepted and completed; #43 reporting is implemented locally for owner review and #44 remains unstarted.
- Manual deposits/withdrawals use the normal transaction form from either the Savings page or transaction flow. Explicit existing/imported linkage, audited corrections/detach/cancellation/reinstatement, account metadata/filtering, exact-money atomic commands and basic financial refetch are delivered. The complete application shell/menu and mobile More navigation are verified; owner review no longer uses a separately mounted Savings page.
- Migration 031 adds four manual RPCs and one private helper, extends two existing transaction reader signatures and the existing transaction guard, with no new tables/views/columns/triggers. Cumulative Savings inventory remains exactly two physical tables and one summary view; all ten public Savings RPCs and eleven helper/trigger functions (ten private plus the read-only Budget exception) are delivered after Migration 033. Migration 032 adds realized interest by replacing the private event engine and account-history reader only. Migration 033 adds surplus/policy execution without new relations; Migration034 implements monthly deposits through five existing function replacements; Migration035 adds the shared read-only report and two extended transaction readers, with no write or relation changes. [Full inventory, APIs, write-path audit and rollout](SAVINGS_FOUNDATION.md).
- Executed SAV-03 checks: complete client 491/491 across 30 files and server 336/336; after final UI corrections, 30 affected form tests (including a new restoration regression) and 47 Transactions tests passed. Disposable PostgreSQL 16: 12/12 manual cases plus two passing targeted cases for owner-artifact preservation and category/direction/installment rejection (14 distinct cases). Coverage includes clean/030 upgrade, unchanged financial history/Loan definitions, exact money, idempotency/rollback, prefixes, corrections, linked/detached void, explicit cash reuse, live/cancelled reads, privileges, concurrent withdrawals and both Loan/Savings link orders. Client lint/build, strict UTF-8/local links, schema inventory/suffix, versions and git diff --check passed. Build retains the existing large-chunk advisory.
- Actual full-app isolated Chromium verification used Express/PostgREST and disposable PostgreSQL: both entry points, normal menu/mobile navigation, persisted edits/link/detach/void/new-cash reinstatement, insufficient-balance errors, RTL desktop/mobile, both themes, actual theme toggle, overflow, Escape and focus restoration. These are agent checks, not owner acceptance of #39. Preview remains at **http://127.0.0.1:5180/savings**, using a local-only test identity and real isolated persistence; production auth is unchanged.
- Historical SAV-02 evidence remains: 11 real PostgreSQL tests (four cases rerun after hardening), 331 server / 487 client tests, lint/build and isolated account-component browser checks. It is preserved in the foundation handoff and is separate from the new full-application/manual-flow evidence.
- Owner production order: 030 with its existing pre/postflight if absent; then [031 preflight](MIGRATION_031_PRODUCTION_PREFLIGHT.sql) → [031 migration](../server/migrations/031_savings_manual_transactions.sql) → [031 postflight](MIGRATION_031_PRODUCTION_POSTFLIGHT.sql), comparing every evidence fingerprint/count while writes are paused. Deploy compatible readers/server/client before enabling manual writes. Artifacts were exercised only locally. For the current interest bundle, follow this with [032 preflight](MIGRATION_032_PRODUCTION_PREFLIGHT.sql) → [032 migration](../server/migrations/032_savings_realized_interest.sql) → [032 postflight](MIGRATION_032_PRODUCTION_POSTFLIGHT.sql), preserving all evidence, before deploying the compatible full client/server. Production installation/deployment remain pending; #38–#42 acceptance is complete and does not need repetition.
- Work remains local/uncommitted and unavailable on remote main. All seven package/lockfile versions remain 1.2.0. HEAD/index, all historical migrations including 030 and the unrelated development-standard modification are preserved. No stage, commit, push, production SQL, deployment or release was performed.

## v1.2.0 deployment and acceptance

- Application commit [c7129c5cbe016177b5c0ccac0d93d72d8fd54b4a](https://github.com/OzAvrahami/finance-tracker/commit/c7129c5cbe016177b5c0ccac0d93d72d8fd54b4a) was manually committed and pushed by the user. Independent GitHub readback confirmed remote main at this exact SHA and successful Vercel and Railway commit statuses.
- User acceptance is complete: #2 with “2 סבבה”; the compact loan row/four-card grid (#10) and Dashboard-wide decoration correction (#27) with final “אושר”. No repeat QA is requested. This is user-performed acceptance, not agent browser testing inferred from deployment statuses.
- Independent GitHub readback confirms #2, #10, and #27 are **CLOSED / COMPLETED**, their existing Finance Tracker Project #1 items are **Done**, and their **P3 — Low** priorities, labels, assignees, and milestone membership are preserved. Milestone **v1.2.0** is **closed**. #28 remains a closed duplicate; #22/#30 remain completed.
- Previous complete bundle gates: client **480/480** tests across 28 files; server **325/325** tests; client lint and production build passed. After the presentation corrections, **65/65** affected Dashboard/Loans tests passed, along with client lint and the production build. The build retains the existing large-chunk advisory; backend/database suites were not rerun.
- Migration 029: **3/3** targeted real disposable PostgreSQL tests passed, covering preservation, optional-field behavior, preflight/postflight, and canonical schema equivalence. No production database was accessed and no Budget PostgreSQL suite was rerun.
- All seven package/lockfile version fields remain **1.2.0**. Annotated tagging and GitHub Release publication follow the user-owned workflow after this final documentation commit is pushed and its remote SHA verified. [GitHub Releases](https://github.com/OzAvrahami/finance-tracker/releases) is authoritative for publication state; this acceptance record does not require another documentation-only commit after publication.
- Migration 029 was applied by the user in production through Supabase SQL Editor. User-supplied results: `MIGRATION_029_PREFLIGHT_PASS`, `MIGRATION_029_POSTFLIGHT_PASS`, `list_count = 4`, `item_count = 27`, `checkout_count = 0`, matching `header_fingerprint = 1ba300c74d46b3d9208ed0bd2744a50a`, and `nullable_columns_without_defaults = true`. This is recorded user evidence, not a new agent-run production check. Do not reapply or modify Migration 029.
- [Release completion handoff and recorded evidence](RELEASE_1_2_0.md). Documentation-only reconciliation reused prior test evidence without rerunning application/database suites.

## Historical v1.1.x release evidence

- Previous accepted application version: **v1.1.1 — Budget Allocation Fix**.
- Application commit `968c6d0` was pushed to remote `main`; Vercel and Railway reported successful deployments, and the user accepted the production behavior with “עובד נהדר”. This is user-performed functional acceptance, not automated browser verification.
- The annotated tag and GitHub Release are created after this versioned documentation commit through the manual release workflow. No additional source change is required when publication completes; GitHub is authoritative for publication state.
- **v0.9.0** was the formal pre-1.0 baseline and the starting point for semantic release tracking.
- The complete v0.9.0 release-quality review remains the evidence supporting the stable designation.
- No runtime functionality changed between the verified v0.9.0 baseline and the v1.0.0 promotion; only release metadata and canonical documentation changed.
- Repository migration history reaches Migration 029; the new nullable shopping-list header fields are installed in production according to the user-supplied evidence above. Migrations 024–025 establish the authoritative consolidated 11-table/9-view Budget model, Migration 027 provides #30 future-snapshot propagation, and Migration 028 corrects #22 so selected funding capacity—not recorded spending—bounds a newly created monthly budget.
- User-provided production Supabase verification from 2026-09-06, recovered from the preceding project conversation, reports `budget_tables = 11`, `budget_views = 9`, both Migration 027 preview/apply RPCs present, Clothing's recurring default at `500.00`, and `migration_027_status = PASS`. This is recorded historical evidence, not a new live verification performed during release preparation.
- On 2026-09-07 the user executed Migration 028's preflight, migration, and postflight in Supabase SQL Editor. The supplied results report both gates passing, 12 reconciled months, zero maximum delta, the corrected preview contract present, the old expense cap and `maximum_allocation` field absent, and the 11-table/9-view boundary intact. This database evidence is distinct from the separately completed user acceptance of the deployed application.

The application is mature, operational across its principal product areas, and stable for regular personal use. The known limitations below remain explicit post-1.0 stabilization work rather than hidden release blockers.

## Module status

| Module | Status | Current scope and limitations |
|---|---|---|
| Dashboard | Operational | Database-backed KPI summary and monthly series. |
| Transactions | Operational with known limitations | Direct, itemized, installment, loan-linked, filtered, and paginated workflows. Core loan accounting is atomic; several surrounding item/LEGO/keyword operations are separate calls. |
| Categories | Operational | Active state, keywords, quick creation, and Settings CRUD for category metadata. |
| Payment sources | Operational | Managed in Settings and used by transactions, loans, budgets, and checkout. |
| Monthly budgets | v1.1.1 correction deployed and accepted | The funded envelope, recurring defaults, overrides, carryover, explicit month close and Savings, reallocation, deficit and unbudgeted-expense resolution, consolidated operation/item model, atomic current/future recurring edit, and #25 presentation are implemented. Migration 028 is installed and postflight-verified from user-supplied database results; application commit `968c6d0` deployed successfully and the user accepted the #22 allocation and transaction-review production workflow. |
| Annual summary | Operational | Dedicated annual view using API-backed financial aggregates. |
| Loans | Operational with known limitations | Finance v3 active/closed views, details, modern creation, legacy compatibility, manual/automatic payments, CPI metadata, and early payoff. CPI automatic calculation is intentionally unsupported. |
| Loan payments | Operational | Authoritative principal accounting with installment, catch-up, irregular, balance-adjustment, and early-payoff events. |
| Import | Operational with known limitations | Spreadsheet preview and persistence across known statement profiles. It is a separate ingestion path and does not execute every Add Transaction side effect. |
| Tasks | Operational | CRUD with optional transaction and loan links. |
| Shopping lists | Operational with known limitations | Catalog/list/item management and financial checkout. Checkout is a multi-call mutation rather than one database transaction. |
| LEGO collection | Operational with known limitations | Manual management, Rebrickable lookup, transaction synchronization, Purchase/Gift/GWP handling, and cost allocation. Some conventions remain application-enforced. |
| Settings | Operational | Category metadata, dedicated recurring Budget configuration, payment-source, and shopping reference-data management. |
| Loan simulator | Operational | Calculation utility within the loan area; not a separate persisted accounting system. |

## Current architecture state

- Finance v3 is the current UI and design-system architecture.
- Finance v2 is a historical/intermediate shell retained only as development context.
- The application is a React SPA backed by an Express REST API and Supabase/PostgreSQL.
- Supabase Auth supplies browser authentication; the Express server performs privileged database access.
- PostgreSQL owns important financial consistency operations, loan summary refreshes, due-payment idempotency, keyset pagination, and dashboard aggregation.
- Node owns HTTP validation, orchestration, amortization component calculation, transaction pricing, import parsing, external integrations, and response shaping.
- The application is effectively single-user. Financial rows do not carry a per-user ownership model.

## Known limitations

- There is no canonical migration runner or authoritative applied-migration ledger in the repository.
- Migrations 024–025 establish the consolidated Budget boundary and remove obsolete internal views/helpers. Migrations 026–027 provide the bounded combined current/future-recurring command without adding Budget relations.
- Income transactions do not yet supply consumable budget funding. Monthly budget funding is manual; `legacy_import` is migration-only.
- General Savings withdrawals/accounts and historical corrections remain deferred; #25's funded-budget presentation is complete.
- There is no general CI workflow for client tests, lint, build, and server tests.
- Legacy loan calculation and the newer `loan_payments` model coexist intentionally.
- Automatic payment generation does not support CPI-indexed loans.
- The core transaction/loan-payment boundary is atomic, but all rich transaction side effects are not contained in one database transaction.
- Shopping checkout creates its financial and shopping records through multiple database calls.
- Import is not behaviorally identical to Add Transaction.
- Authentication is present, but financial data has no per-user row-ownership isolation.
- Deployment facts remain operational evidence rather than repository guarantees: Railway production was manually verified on Node.js 22.23.2, the deployed Vercel origin matches the CORS allowlist, and the latest scheduled due-loan GitHub Actions run was manually verified successful.
- Transaction tags remain comma-separated TEXT. External v1 requests accept `string[]` and serialize explicitly; commas inside an individual tag are unsupported because the storage format has no escape convention.

## Repository versus production state

The repository documents intended code and schema. Production was verified read-only for expected object presence through Migration 015, then Migration 016 was applied and independently verified. The final release review also manually verified the Railway Node.js 22.23.2 runtime, the deployed Vercel origin/CORS match, and a successful latest scheduled due-loan workflow run. The repository still does not establish:

- an authoritative ordered record of which migrations were applied to any external database;
- which commit is currently deployed;
- whether private operational repair scripts have been executed.

Those remaining facts require external deployment or database records; they are not implied by repository state.

## Stable-release evidence

- [x] Create canonical README, changelog, status, roadmap, architecture, and decision documentation.
- [x] Verify and record production object state through Migration 015 independently of repository assumptions.
- [x] Apply Migration 016 and independently verify its production object state.
- [x] Run and record the complete client test suite.
- [x] Run and record client lint.
- [x] Run and record the client production build.
- [x] Run and record the complete canonical server test suite.
- [x] Normalize and document the effective Node/runtime contract.
- [x] Verify and canonicalize the external transaction API tags representation in repository code and schema history.
- [x] Align private application package versions to the stable `1.0.0` release.
- [x] Add complete client/server environment examples and document scheduler-only secrets.
- [x] Confirm private production audit, backup, and repair artifacts remain ignored and unstaged.
- [x] Review and accept the documented partial-mutation and security boundaries for the stable contract.
- [x] Complete the release review and finalize the dated changelog entries.
- [x] Verify the Railway production runtime as Node.js 22.23.2.
- [x] Verify the deployed Vercel client origin matches the server CORS allowlist.
- [x] Verify the latest scheduled due-loan GitHub Actions run completed successfully.

## Historical v1.1.1 local quality gate

Recorded v1.1.1 implementation and release-preparation evidence through 2026-09-07 (v1.2.0 results are above):

| Gate | Result |
|---|---|
| Client tests | 458 tests passed |
| Focused Budget tests | 49 tests passed |
| Client lint | Passed |
| Client production build | Passed; Vite reported the existing large-chunk advisory |
| Canonical server tests | 307 tests passed |
| Focused Migration 028 PostgreSQL tests | 4 tests passed; no failures or skips |
| Complete disposable PostgreSQL suite | 108 tests passed; no failures or skips |
| Earlier disposable PostgreSQL attempt | Infrastructure unavailable; Docker's Linux engine did not start, so that attempt executed zero SQL tests and is not counted as a pass |
| Migration 028 production preflight/postflight | User-executed in Supabase SQL Editor on 2026-09-07; both reported PASS with 12 reconciled months and zero maximum delta |

Migrations 027 and 028 must not be applied again. Migration 027 is installed and accepted. The user-supplied Migration 028 output establishes the corrected database contract and accounting invariants; separately, application commit `968c6d0` deployed successfully and the user accepted the production allocation and transaction-review behavior. Issue #22 is completed.

The prior v1.0.0 quality gate remains recorded below for historical context.

Run on 2026-08-15 with Node.js 24.11.1, which satisfies the declared runtime range:

| Gate | Result |
|---|---|
| Client tests | 26 files, 408 tests passed; no failures or skips |
| Client lint | Passed with no errors or warnings |
| Client production build | Passed; Vite reported the existing large-chunk advisory |
| Canonical server tests | 250 tests passed; no failures or skips |
| Server environment-isolation run | Passed with inherited service variables blank; test bootstrap supplied non-secret values |

These local gates are complemented by the final manual deployment checks: Railway production uses Node.js 22.23.2, the deployed Vercel origin matches the CORS allowlist, and the latest scheduled due-loan workflow run succeeded. Database evidence remains catalog/object-state verification rather than an applied-migration ledger.


## SAV-04 local handoff — 2026-09-13

The owner confirmed “אוקי עכשיו נראה סבבה” after reviewing the corrected full-app preview. This accepts the corrected appearance and resolves the reported Savings/transaction-form visual concerns. It does not assert additional owner-performed functional checks. Together with the documented SAV-03 implementation, PostgreSQL and application verification, this authorizes finalizing #39 as Closed / Completed / Done, P1 — High; #38 remains accepted / Closed / Done. The work remains local/uncommitted and undeployed.

#40 implements net realized interest in Savings or checking, explicit existing-income linkage, all four audited correction destinations, cancellation/restoration, separate earnings summaries and basic financial refresh. Independent readback confirms Open / Verify for owner verification, P2 — Medium, milestone v1.3.0, parent #36 and native dependency on completed #39. No downstream issue was started.

Executed: full client 501/501 and server 337/337; an additional focused explicit-payout shortcut regression passed (8/8 transaction Savings tests). Fifteen distinct real PostgreSQL interest cases passed across the complete 13-case run and targeted upgrade/Budget-history/earnings-range additions; all 14 prior manual cases passed against the 032 engine. Lint/build passed with only the existing chunk-size advisory. Full-app isolated Chromium verified both destinations, cash linkage and existing income editing, conversions, cancellation/restoration, RTL desktop/mobile/light/dark, focus return, and invalid-money feedback. Twelve matched released-baseline ordinary forms retained identical geometry/control values/styles. These are agent checks against disposable persistence, not owner acceptance or production testing. Details, screenshots location and owner checklist are in [SAVINGS_FOUNDATION.md](SAVINGS_FOUNDATION.md).


## SAV-05 local handoff — 2026-09-13

The owner said “בוא נתקדם אני לא אבדוק עכשיו את הריבית”. This defers interest verification; it does not accept #40 or block #41, which depends on completed #39. #40 remains Open / Verify / P2 — Medium, with owner checks pending. #38/#39 remain Closed / Completed / Done.

#41 implements named Savings destinations, explicit funded-surplus and month-close confirmations, atomic funding/allocation/cash/deposit postings, whole reversal and provenance-only Budget exclusion. Budget and Annual bridge cash to envelope totals. Migration 033 adds no tables/views and does not reapply legacy reserve retirement. Local automated checks and full-app isolated browser evidence are recorded in [the handoff](SAVINGS_FOUNDATION.md#sav-05-funded-surplus-implementation--2026-09-13). Owner acceptance and production installation/deployment remain pending. Current owner preview: http://127.0.0.1:5182/budget (disposable sav05_preview).

Production order appends [033 preflight](MIGRATION_033_PRODUCTION_PREFLIGHT.sql) → [033 migration](../server/migrations/033_savings_funded_surplus.sql) → [033 postflight](MIGRATION_033_PRODUCTION_POSTFLIGHT.sql) after installed 032, with paused writes and equal evidence, followed by compatible server/client deployment. This order is documentation for the owner, not an executed production action. All seven version fields remain 1.2.0; HEAD/index and unrelated work are preserved.

Independent final SAV-05 readback confirms #41 Open / Verify / P1 — High, with all ten implementation criteria evidenced and owner review pending. #40 stays Open / Verify / P2 — Medium (review deferred, not accepted); #38/#39 stay Closed / Completed / Done. Labels, assignees, v1.3.0 milestone, parent #36, native dependencies and unique Project membership were preserved; all unrelated Project items match the initial snapshot.


## SAV-06 local implementation — 2026-09-14

#42 delivers monthly-plan execution and explicit manual/imported fulfillment; no owner acceptance or production activation is claimed. The [handoff](SAVINGS_FOUNDATION.md#sav-06-monthly-deposits--2026-09-14) records calendar rules, APIs, exact object inventory, executed tests and the prepared full-app test account. #40 remains Open/Verify/P2 with interest review deferred; #41 remains Open/Verify/P1 awaiting owner review. #38/#39 remain completed. #42 retains P2, milestone v1.3.0, parent36 and its completed native dependency39; no new dependency on40/41 is introduced. Final independent tracking readback is recorded in the handoff after validation.

## SAV-07 local reporting handoff — 2026-09-14

#43 is independently verified Open / Verify / P2, retaining parent36, milestonev1.3.0 and completed native dependencies40/41/42. Migration035 adds one read-only report RPC and extends two transaction reader signatures, with zero new relations or financial write changes. Dashboard/monthly Savings/Annual reports separate current holdings from period ledger flows and transaction-authoritative cash; classification filters preserve cursor/totals semantics. Full client518/server345, seven distinct real disposable PostgreSQL cases, scoped post-fix UI checks, lint/build and full-app desktop/mobile RTL/theme checks passed. Owner review and production rollout remain pending. [Detailed evidence, fixture, limitations and rollout](SAVINGS_FOUNDATION.md#sav-07-reporting-implementation--2026-09-14).
