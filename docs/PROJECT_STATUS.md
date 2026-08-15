# Project Status

## Baseline status

- Formal release tracking has not yet started.
- Target first formally tracked baseline: **v0.9.0**.
- The baseline has not been tagged or released.
- Repository HEAD observed during the documentation audit: `657e22a`.
- Repository migration history currently reaches Migration 015.
- Production migration state must be verified independently; repository migration files do not prove database application state.

The application is mature and operational across its principal product areas, but it remains pre-1.0 while release hygiene, database reproducibility, and several architectural boundaries are formalized.

## Module status

| Module | Status | Current scope and limitations |
|---|---|---|
| Dashboard | Operational | Database-backed KPI summary and monthly series. |
| Transactions | Operational with known limitations | Direct, itemized, installment, loan-linked, filtered, and paginated workflows. Core loan accounting is atomic; several surrounding item/LEGO/keyword operations are separate calls. |
| Categories | Operational | Active state, keywords, quick creation, and Settings CRUD. |
| Payment sources | Operational | Managed in Settings and used by transactions, loans, budgets, and checkout. |
| Monthly budgets | Operational | Monthly read/upsert, copy, delete, and category breakdown. |
| Annual summary | Operational | Dedicated annual view using API-backed financial aggregates. |
| Loans | Operational with known limitations | Finance v3 active/closed views, details, modern creation, legacy compatibility, manual/automatic payments, CPI metadata, and early payoff. CPI automatic calculation is intentionally unsupported. |
| Loan payments | Operational | Authoritative principal accounting with installment, catch-up, irregular, balance-adjustment, and early-payoff events. |
| Import | Operational with known limitations | Spreadsheet preview and persistence across known statement profiles. It is a separate ingestion path and does not execute every Add Transaction side effect. |
| Tasks | Operational | CRUD with optional transaction and loan links. |
| Shopping lists | Operational with known limitations | Catalog/list/item management and financial checkout. Checkout is a multi-call mutation rather than one database transaction. |
| LEGO collection | Operational with known limitations | Manual management, Rebrickable lookup, transaction synchronization, Purchase/Gift/GWP handling, and cost allocation. Some conventions remain application-enforced. |
| Settings | Operational | Category, payment-source, and shopping reference-data management. |
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
- There is no general CI workflow for client tests, lint, build, and server tests.
- Legacy loan calculation and the newer `loan_payments` model coexist intentionally.
- Automatic payment generation does not support CPI-indexed loans.
- The core transaction/loan-payment boundary is atomic, but all rich transaction side effects are not contained in one database transaction.
- Shopping checkout creates its financial and shopping records through multiple database calls.
- Import is not behaviorally identical to Add Transaction.
- Authentication is present, but financial data has no per-user row-ownership isolation.
- Runtime, environment-variable, migration, and deployment contracts need a single maintained operational specification.
- Package versions currently do not represent the planned formal baseline.
- The external transaction API's tags representation should be verified against the deployed schema before it is treated as stable.

## Repository versus production state

The repository documents intended code and schema. It does not establish:

- which migrations are currently applied to any external database;
- which commit is currently deployed;
- whether scheduler/deployment secrets are configured; or
- whether private operational repair scripts have been executed.

Those facts require an external deployment and database verification before release.

## Baseline readiness checklist

- [x] Create canonical README, changelog, status, roadmap, architecture, and decision documentation.
- [ ] Verify the actual production migration level and record it outside schema assumptions.
- [ ] Run and record the complete client test suite.
- [ ] Run and record client lint.
- [ ] Run and record the client production build.
- [ ] Run and record the complete server test suite.
- [ ] Normalize and document the effective Node/runtime contract.
- [ ] Verify the external transaction API tags representation end to end.
- [ ] Decide how package versions should align with the planned baseline.
- [ ] Confirm private production audit, backup, and repair artifacts are excluded from the release commit.
- [ ] Review known partial-mutation and security boundaries for baseline acceptance.
- [ ] Review the final baseline commit and changelog.
- [ ] Create the `v0.9.0` tag only after approval.
