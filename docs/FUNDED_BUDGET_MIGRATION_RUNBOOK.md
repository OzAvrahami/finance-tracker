# Funded Budget Migration 017 — Review and Verification Runbook

This is a review procedure, not authorization to execute against production. Migration 017 is already deployed; these instructions remain its verification record and do not authorize reapplication.

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

Migration 017 is the deployed funded-budget prerequisite for all later budget migrations. This runbook does not authorize reapplying it.

## Migration 018 recurring-default extension

Migration 018 must be reviewed and applied only after Migration 017 has been successfully verified. It adds mutable future-planning configuration, a read-only recurring preview, and bounded configuration/initialization RPCs; it does not backfill defaults or mutate any existing monthly snapshot.

Before any later production execution, verify the Migration 017 object boundary, rehearse `018_recurring_budget_defaults.sql` on a production-shaped disposable copy, and inspect effective table/view/function privileges. Deploy the server only after both migrations are verified, then deploy the client. Viewing a Budget month must remain read-only: only the explicit `initialize_budget_recurring_defaults` RPC may apply defaults, and insufficient funding must leave no partial operation, snapshot, or lifecycle event.

Migration 018 is the deployed recurring-default prerequisite for Migration 019. This runbook does not authorize reapplying it.

## Migration 019 carryover extension

Migration 019 must be rehearsed only after the deployed Migration 017 and 018 object boundaries have been verified. It adds no historical carryover backfill and does not rewrite existing budget snapshots, operations, movements, lifecycle events, recurring defaults, or transactions. Carryover configuration begins disabled for every category.

Before any production execution, rehearse `019_budget_category_carryover.sql` on a production-shaped disposable copy and verify the exact source/destination funding and movement pair, cross-month net-zero funding, append-only triggers, bounded RPC execution, and effective ACLs. The canonical preview and monthly GET paths must remain read-only. Only `apply_budget_carryover` may create original transfers, and only `reverse_budget_carryover` may create their bounded compensating pairs.

The apply RPC acquires `LOCK TABLE public.transactions IN SHARE MODE` before any budget-month lock. This waits for existing transaction writers and blocks new transaction inserts, updates, or deletes until the short apply transaction completes. Apply then locks months and affected budgets in stable ID order, captures the authoritative candidate JSON once, compares its fingerprint to the user-approved preview, and consumes those exact captured rows. Rehearsal must prove that an in-flight source-actual change causes `CARRYOVER_PREVIEW_STALE` and zero carryover writes, while a refreshed preview succeeds. Transfer provenance must retain distinct raw actual and nonnegative effective eligibility-actual snapshots and remain unchanged after later transaction edits.

Recurring initialization, copy, funded adjustment, removal, and reactivation use the same month-first/budget-ID lock order. Their actual-spending reads use the `ACCESS SHARE` table lock that is compatible with carryover's `SHARE` lock. Verify representative concurrent calls; the shared ordering is the proof for equivalent serialized monthly mutation paths.

Deploy in this order: establish a budget-write maintenance boundary, apply and verify Migration 019 transactionally, deploy the server, then deploy the client. A failed migration must leave the pre-019 schema intact. After commit, correction is forward-only and cannot edit original transfer history.

Migration 019 is the deployed carryover prerequisite for Migration 020. This runbook does not authorize reapplying it.

## Migration 020 month-override extension

Migration 020 must be applied only after Migrations 017–019 are deployed and independently verified. It creates empty override configuration/provenance tables, extends bounded domains, replaces the recurring initializer and copy RPC with override-aware definitions, and wraps the canonical read. It performs no historical override backfill and must not rewrite existing snapshots, operations, movements, lifecycle events, recurring defaults, carryover rows, or transactions.

Before production execution, rehearse `020_month_budget_overrides.sql` on the deployed 017/018/019 shape. Verify explicit zero versus absence, initialization precedence and exact shortfall, immutable fallback snapshots, carryover/other-adjustment preservation, full-or-nothing base release, idempotency, ACLs, copy skip reporting, pending-override carryover blocking, December/January handling, and exact values above 2^53. Confirm page reads and override preview create no state.

Financial override changes lock `transactions` in `SHARE` mode before the month and budget locks. This makes the clamped transaction-authoritative actual stable through a decrease/removal write. Month rows and affected budgets then lock in stable ID order, followed by category and configuration rows. Representative concurrency tests cover initialization, carryover, copy, generic adjustment, lifecycle mutation, and transaction edits.

Deploy in order: establish a budget-write maintenance boundary, apply and verify Migration 020 transactionally, deploy the server, then deploy the client. A failed migration must leave the complete pre-020 schema intact; post-commit correction is forward-only through bounded commands.

Migration 020 is the deployed month-override prerequisite for Migration 021. This runbook does not authorize reapplying it.

## Migration 021 unused-budget disposition and Savings extension

Migration 021 must be applied only after Migrations 017–020 are deployed and independently verified. It deterministically maps every existing carryover-setting row to `carry_forward`, leaves categories without a row unconfigured, and preserves every historical carryover batch/transfer. It creates no close batch, disposition event, Savings entry, budget operation, funding entry, movement, lifecycle event, snapshot, recurring default, override, or transaction.

Rehearse the ordered migration on a production-shaped disposable database. Verify the read-only preview, immediately-completed/current Asia/Jerusalem boundary, exact candidate fingerprint, deficit and unbudgeted-expense blockers, mixed-policy atomicity, and transaction-write race. For return-to-unallocated, verify source funding/category both decrease, destination funding/unallocated both increase, neither source unallocated nor destination category allocation changes, and cross-month funding nets to zero. For Savings, verify source funding/category both decrease, source unallocated is unchanged, the retained immutable ledger increases, and expense totals do not change. Carry-forward must use the existing Migration 019 transfer rows and operations.

Apply takes the `transactions` `SHARE` lock first, stabilizes the complete policy table against absent-row insert phantoms, takes the transaction-scoped application-wide Savings advisory mutex, then locks source/destination months and affected budgets in stable ID order. Reversal uses the same transaction/Savings/month order. Apply recomputes and captures exact candidates only after those boundaries, compares the approved fingerprint, and consumes that captured JSON. A stale preview must raise `MONTH_DISPOSITION_PREVIEW_STALE` with no writes. Corrections are compensating and must be blocked if destination unallocated, carryover destination headroom, or retained Savings is insufficient.

Deploy in order: establish a budget-write maintenance boundary, apply and verify Migration 021 transactionally, deploy the server, then deploy the client. Do not deploy the unified Settings or month-close routes before their policy/read/RPC objects exist. A failed migration must restore the complete pre-021 state.

Migration 021 is the deployed unused-disposition/Savings prerequisite for Migration 022. This runbook does not authorize reapplying it.

## Migration 022 reallocation and deficit-resolution extension

Migration 022 requires the exact deployed Migration 017–021 ledger, override, carryover, disposition, and Savings shape. It extends operation and funding-source domains, adds immutable funding-action headers and source legs, and extends Savings entries for deficit-only withdrawals. It performs no historical reallocation, resolution, withdrawal, budget, transaction, carryover, override, or disposition backfill.

Rehearsal must prove all three planned movement forms, transaction-authoritative source headroom, atomic mixed category/unallocated/Savings deficit legs, partial resolution, Savings and monthly reconciliation, exact strings above 2^53, and rejection of inactive or `no_budget` destinations. Current-month planned moves and current/immediately-completed-unclosed deficit resolution must use Asia/Jerusalem lifecycle classification; any original close batch permanently blocks normal actions.

Apply takes the transaction `SHARE` lock first, the Savings advisory mutex when Savings participates, then the month, affected budgets, and affected categories in stable ID order. It captures one authoritative candidate, validates the approved fingerprint immediately, and writes from that material. Transaction, funding, lifecycle, category-active, or Savings races must return the specific stale-preview conflict with no partial provenance.

Deploy in order: establish the budget-write maintenance boundary, apply and verify Migration 022 transactionally, deploy the server, then deploy the client. Do not deploy #23 routes or UI before its RPCs and canonical read wrapper exist. Migration 022 must not be applied by an application deployment command.

As of this runbook revision, Migration 022 is **not applied to production**.

## Migration 023 unbudgeted-expense resolution extension

Migration 023 requires the exact Migration 017–022 funded, recurring, carryover, override, disposition/Savings, and action/leg shape. It adds a zero-opening `unbudgeted_resolution` starting kind, bounded preview/apply/reversal RPCs, one append-only resolution-event table, and a shared source-capacity helper. It performs no historical snapshot, action, event, movement, Savings, lifecycle, transaction, recurring, override, carryover, or disposition backfill.

Rehearsal must prove missing-snapshot creation at zero, explicit inactive-snapshot reactivation, partial and full allocation, atomic mixed source legs, exact Savings and month reconciliation, pending-override protection, current/immediately-completed-unclosed lifecycle rules, and permanent closed-month rejection. Preview must write nothing. A transaction, funding, lifecycle, Savings, initialization, override, or duplicate-snapshot race must either serialize before capture or return `UNBUDGETED_RESOLUTION_PREVIEW_STALE` with no partial snapshot or provenance.

Apply takes the transaction `SHARE` lock first, then the Savings advisory mutex when selected, the month, all affected budgets, and categories in stable ID order. It recomputes one authoritative preview under those boundaries and writes only after the approved fingerprint matches. Reversal compensates funding and lifecycle history; it never deletes the late snapshot or original event.

Deploy in order: establish the budget-write maintenance boundary, apply and verify Migration 023 transactionally, deploy the server, then deploy the client. Do not deploy #22 routes or UI before the RPCs and canonical read wrapper exist. Migration 023 must not be applied by an application deployment command.

As of this runbook revision, Migration 023 is **not applied to production**.
