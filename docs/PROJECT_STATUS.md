# Project Status

## Current release status

- Current release as of 2026-08-15: **v1.0.0 — Stable**.
- **v0.9.0** was the formal pre-1.0 baseline and the starting point for semantic release tracking.
- The complete v0.9.0 release-quality review remains the evidence supporting the stable designation.
- No runtime functionality changed between the verified v0.9.0 baseline and the v1.0.0 promotion; only release metadata and canonical documentation changed.
- Repository migration history currently reaches Migration 022. Migration 022 is implemented locally and has not been applied to production.
- Production object/data preflights have independently verified the funded-budget foundation through Migration 021. No Finance Tracker applied-migration ledger exists, so these findings are object-state evidence rather than an authoritative execution history.

The application is mature, operational across its principal product areas, and stable for regular personal use. The known limitations below remain explicit post-1.0 stabilization work rather than hidden release blockers.

## Module status

| Module | Status | Current scope and limitations |
|---|---|---|
| Dashboard | Operational | Database-backed KPI summary and monthly series. |
| Transactions | Operational with known limitations | Direct, itemized, installment, loan-linked, filtered, and paginated workflows. Core loan accounting is atomic; several surrounding item/LEGO/keyword operations are separate calls. |
| Categories | Operational | Active state, keywords, quick creation, and Settings CRUD for category metadata. |
| Payment sources | Operational | Managed in Settings and used by transactions, loans, budgets, and checkout. |
| Monthly budgets | Reallocation/deficit extension implemented locally, production migration pending | Funded month/read model, recurring initialization, carryover, month overrides, unified unused-balance policy, month close, retained Savings, current-month reallocation, and multi-source deficit resolution. Unbudgeted resolution and the full redesign remain future work. |
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
- Migration 022 has not been applied to production. Its server/client paths require deployed and verified Migrations 017–021 before deployment.
- Income transactions do not yet supply consumable budget funding. Monthly budget funding is manual; `legacy_import` is migration-only.
- Unbudgeted-expense resolution (#22), general Savings withdrawals/accounts, historical corrections, and the full funded-budget presentation (#25) remain deferred.
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

## Latest local quality gate

Run on 2026-08-15 with Node.js 24.11.1, which satisfies the declared runtime range:

| Gate | Result |
|---|---|
| Client tests | 26 files, 408 tests passed; no failures or skips |
| Client lint | Passed with no errors or warnings |
| Client production build | Passed; Vite reported the existing large-chunk advisory |
| Canonical server tests | 250 tests passed; no failures or skips |
| Server environment-isolation run | Passed with inherited service variables blank; test bootstrap supplied non-secret values |

These local gates are complemented by the final manual deployment checks: Railway production uses Node.js 22.23.2, the deployed Vercel origin matches the CORS allowlist, and the latest scheduled due-loan workflow run succeeded. Database evidence remains catalog/object-state verification rather than an applied-migration ledger.
