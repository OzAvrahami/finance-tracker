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
