# Funded Budget Migration 017 — Review and Verification Runbook

This is a review procedure, not authorization to execute against production. Migration 017 has not been applied to production.

## Before approval

1. Confirm the target Supabase project and obtain a current recoverable backup.
2. Record the deployed application commit and independently inspect the target schema; Finance Tracker has no authoritative migration ledger.
3. Run the migration preflight queries read-only. Resolve any reported invalid month, null/missing category, duplicate logical row, negative/non-finite/over-precision amount, or unexpected table shape outside the migration under a separately reviewed data-correction plan.
4. Rehearse the exact production catalog/data shape on a disposable PostgreSQL/Supabase branch. Run `node --test test/fundedBudgetPostgres.local.test.js` from `server/` for the repository fixture suite.
5. Review Migration 017 and `full_schema.sql` alignment, privileges, RPC signatures, and the client/server deployment ordering.

## Approved maintenance window

1. Put budget writes into a maintenance window before applying SQL. Do not deploy the new API before the schema/RPC boundary exists.
2. Apply `server/migrations/017_funded_budget_foundation.sql` once with stop-on-error behavior. It is transactional and must roll back on any preflight or reconciliation failure. Sequence synchronization uses transactional `ALTER SEQUENCE ... RESTART`, not `setval`, so a failure after synchronization restores the prior sequence state together with schema and backfill work.
3. Do not run repair SQL automatically. Stop and investigate any error.

## Read-only post-migration verification

- Every legacy month has one `budget_months` row and exactly one `legacy_import` funding entry.
- Every legacy budget ID is preserved with matching `starting_amount`, `starting_kind = legacy_import`, and one initial active lifecycle event, including zero budgets.
- For every migrated month: available = total allocated = active allocated; inactive retained = unallocated = 0.
- No transaction row or amount changed.
- Direct update/delete of snapshots and history is rejected.
- Bounded budget RPC execution is granted only to `service_role`; `anon` and `authenticated` cannot execute them. Internal trigger/helper functions remain unexposed, and `service_role` has SELECT-only access to funded state/history and legacy `budgets`.
- Canonical month reads, compatibility reads, Dashboard, and Annual Summary return expected values.
- Funded-budget monetary API reads and mutation inputs remain canonical decimal strings. Numeric JSON mutation values, exponent notation, grouping separators, whitespace, non-finite tokens, and values with more than two decimal places are rejected before an RPC call.

## Deployment and rollback boundary

Deploy the compatible server/client only after schema verification. Because the migration creates immutable provenance and backfills production rows, rollback is not a casual down-migration: restore from the reviewed backup or use a separately designed forward correction. Never drop funded history to recreate the legacy mutable model.

Migration execution is all-or-nothing, including the budget ID sequence restart. After a successful commit, application-level correction is intentionally forward-only: positive manual funding and funded adjustments have bounded compensating reversal support, while lifecycle changes, copy operations, initial snapshots, and operation-only no-ops do not claim generic reversal support.

Removal stores the expense total observed by that database operation and uses it to calculate the released amount. Later transaction edits, deletions, or backdating change current actual/unbudgeted reporting but never rewrite the removal snapshot or retroactively alter the funded movement. Review such ledger changes as a point-in-time reporting/reconciliation risk rather than mutating immutable budget provenance.

As of this runbook revision, Migration 017 is still **not applied to production**.

## Migration 018 recurring-default extension

Migration 018 must be reviewed and applied only after Migration 017 has been successfully verified. It adds mutable future-planning configuration, a read-only recurring preview, and bounded configuration/initialization RPCs; it does not backfill defaults or mutate any existing monthly snapshot.

Before any later production execution, verify the Migration 017 object boundary, rehearse `018_recurring_budget_defaults.sql` on a production-shaped disposable copy, and inspect effective table/view/function privileges. Deploy the server only after both migrations are verified, then deploy the client. Viewing a Budget month must remain read-only: only the explicit `initialize_budget_recurring_defaults` RPC may apply defaults, and insufficient funding must leave no partial operation, snapshot, or lifecycle event.

As of this runbook revision, Migration 018 is **not applied to production**.

## Migration 019 carryover extension

Migration 019 must be rehearsed only after the deployed Migration 017 and 018 object boundaries have been verified. It adds no historical carryover backfill and does not rewrite existing budget snapshots, operations, movements, lifecycle events, recurring defaults, or transactions. Carryover configuration begins disabled for every category.

Before any production execution, rehearse `019_budget_category_carryover.sql` on a production-shaped disposable copy and verify the exact source/destination funding and movement pair, cross-month net-zero funding, append-only triggers, bounded RPC execution, and effective ACLs. The canonical preview and monthly GET paths must remain read-only. Only `apply_budget_carryover` may create original transfers, and only `reverse_budget_carryover` may create their bounded compensating pairs.

The apply RPC acquires `LOCK TABLE public.transactions IN SHARE MODE` before any budget-month lock. This waits for existing transaction writers and blocks new transaction inserts, updates, or deletes until the short apply transaction completes. Apply then locks months and affected budgets in stable ID order, captures the authoritative candidate JSON once, compares its fingerprint to the user-approved preview, and consumes those exact captured rows. Rehearsal must prove that an in-flight source-actual change causes `CARRYOVER_PREVIEW_STALE` and zero carryover writes, while a refreshed preview succeeds. Transfer provenance must retain distinct raw actual and nonnegative effective eligibility-actual snapshots and remain unchanged after later transaction edits.

Recurring initialization, copy, funded adjustment, removal, and reactivation use the same month-first/budget-ID lock order. Their actual-spending reads use the `ACCESS SHARE` table lock that is compatible with carryover's `SHARE` lock. Verify representative concurrent calls; the shared ordering is the proof for equivalent serialized monthly mutation paths.

Deploy in this order: establish a budget-write maintenance boundary, apply and verify Migration 019 transactionally, deploy the server, then deploy the client. A failed migration must leave the pre-019 schema intact. After commit, correction is forward-only and cannot edit original transfer history.

As of this runbook revision, Migration 019 is **not applied to production**.
