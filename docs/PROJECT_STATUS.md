# Project Status

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
