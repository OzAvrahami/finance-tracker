# Technical Decisions

This file records durable architectural decisions visible in the repository. Dates use Git evidence when recoverable; approximate periods are labeled accordingly.

## D-001 — Supabase authentication with server-mediated financial APIs

**Status:** Accepted

**Date:** 2026-02 (repository history)

### Context

The browser needs authenticated sessions, while financial operations require centralized validation and privileged database access.

### Decision

Use Supabase Auth in the browser and send authenticated feature requests to the Express API. Keep privileged Supabase credentials and financial orchestration on the server.

### Consequences

The client does not directly own normal feature-table access. Authentication is centralized, but the data model remains effectively single-user because rows do not carry per-user ownership.

## D-002 — PostgreSQL RPCs protect atomic financial mutations

**Status:** Accepted

**Date:** 2026-08-13

### Context

Sequential PostgREST requests could commit a ledger transaction without its authoritative loan payment, or reverse only one side.

### Decision

Use narrowly scoped PostgreSQL functions for transaction/loan-payment create, update, and delete operations that must commit or roll back together.

### Consequences

Core loan-accounting mutations are atomic and database constraints remain the final guard. Surrounding item, LEGO, and keyword side effects are not automatically part of the same transaction.

## D-003 — Separate the cash ledger from authoritative loan accounting

**Status:** Accepted

**Date:** 2026-08-13

### Context

Loan payments contain principal, interest, fees, and adjustments. Subtracting `transactions.total_amount` from principal produces incorrect balances.

### Decision

Keep `transactions` as the actual cash/card ledger and use `loan_payments` for authoritative loan accounting.

### Consequences

Only principal and explicit balance adjustments change outstanding principal. A loan-related transaction may exist without being an installment.

## D-004 — Preserve legacy and `loan_payments` calculation modes

**Status:** Accepted

**Date:** 2026-08-13

### Context

Existing loans could not all be safely reinterpreted when the principal-aware model was introduced.

### Decision

Add `loans.calculation_mode`, retain legacy transaction-total behavior for unmigrated loans, and use `loan_payments` for deliberately migrated or newly created loans.

### Consequences

Compatibility is preserved, but both behaviors require tests and documentation until legacy loans are audited or intentionally retained.

## D-005 — Loan-linked transactions do not create future ledger transactions

**Status:** Accepted

**Date:** 2026-08-13

### Context

A future contractual loan payment is not yet an actual expense, while ordinary card installments may be represented by future sibling ledger rows.

### Decision

Do not generate future transaction siblings when `loan_id` is present. Store future loan expectations on the loan and create a transaction only when the payment becomes actual.

### Consequences

Loan balances no longer count future ledger rows as paid. Ordinary non-loan installment behavior remains distinct.

## D-006 — Exclude CPI-indexed loans from automatic generation

**Status:** Accepted

**Date:** 2026-08-14

### Context

The application records indexation metadata but does not fetch or calculate live CPI adjustments.

### Decision

Model interest and indexation separately, and reject/skip automatic payment generation for CPI-indexed loans.

### Consequences

Indexed loans can be represented truthfully, but require manual/provider-informed accounting until a reviewed CPI engine exists.

## D-007 — Persist reversible manual schedule transitions

**Status:** Accepted

**Date:** 2026-08-15

### Context

Actual bank posting dates can differ from contractual due dates, and simple month arithmetic cannot always reproduce provider schedules.

### Decision

Persist the previous and next scheduled due dates on manual loan-payment rows. Advance from the submitted contractual transition, not the transaction posting date.

### Consequences

Split/date edits do not advance schedules again, and deletion, link-only conversion, final-payment reversal, and loan moves can restore prior schedules without heuristics.

## D-008 — Preserve provider history through irregular payments and balance adjustments

**Status:** Accepted

**Date:** 2026-08-14

### Context

CPI linkage, arrears, returned debits, catch-up payments, and provider snapshots can make a contractual amortization schedule unsuitable as historical fact.

### Decision

Represent real but unallocated cash as irregular/catch-up events and represent provider-confirmed balance movement as non-cash balance adjustments. Do not invent unsupported principal/interest splits.

### Consequences

Accounting remains reconcilable while provenance and uncertainty stay explicit. Provider snapshots can anchor principal without fabricating cash transactions.

## D-009 — Use keyset pagination instead of offset pagination

**Status:** Accepted

**Date:** 2026-08-05

### Context

Loading or offset-paginating a growing transaction history is inefficient and can drift when rows are inserted.

### Decision

Use PostgreSQL keyset pagination with opaque date/amount/id cursors and database-computed filtered totals.

### Consequences

Pages remain stable and transfer less data, at the cost of stricter cursor/query contracts.

## D-010 — Finance v3 is the current tokenized design system

**Status:** Accepted

**Date:** 2026-08-06 to 2026-08-10

### Context

Finance v2 established a responsive shell but did not provide the final shared visual/component language.

### Decision

Use Finance v3 tokens, glass surfaces, shared controls, and overlay primitives across current routed pages.

### Consequences

New UI work should compose the shared system. Legacy token aliases remain temporarily for compatibility and Finance v2 is historical context.

## D-011 — Treat RTL and bidi isolation as separate concerns

**Status:** Accepted

**Date:** 2026-08 (repository implementation)

### Context

Hebrew page direction can reorder installment progress, codes, and mixed numeric text incorrectly.

### Decision

Keep the application RTL-first while explicitly isolating numeric and technical fragments with semantic bidi/LTR markup and utilities.

### Consequences

Values remain in logical data order and render predictably without reversing source data.

## D-012 — Use three-stage LEGO transaction cost allocation

**Status:** Accepted

**Date:** 2026-08-10

### Context

Receipt prices, transaction-level discounts, and actual acquisition cost are distinct values for itemized LEGO purchases.

### Decision

Preserve receipt price, allocate the relevant transaction-level discount, and derive the stored purchase cost using integer minor-unit rules.

### Consequences

Collection cost is traceable to transaction evidence, while allocation and synchronization require consistent application utilities.

## D-013 — Purchase, Gift, and GWP are canonical LEGO acquisition types

**Status:** Accepted

**Date:** 2026-08-11

### Context

Earlier acquisition labels were ambiguous and zero-price promotional sets needed distinct semantics.

### Decision

Use `purchase`, `gift`, and `gwp` as the canonical persisted vocabulary and explicitly distinguish genuine gifts from gifts-with-purchase.

### Consequences

UI, transaction metadata, and collection records share one vocabulary. Older ambiguous data required guarded normalization.

## D-014 — Migrations are schema history; `full_schema.sql` is a consolidated reference

**Status:** Accepted

**Date:** 2026-05 onward; consolidated through 2026-08 repository work

### Context

The project needs both ordered evolution and a readable representation of the intended current schema.

### Decision

Keep ordered SQL migrations under `server/migrations/` and synchronize material changes into `server/full_schema.sql`.

### Consequences

Both sources must stay aligned. Neither repository presence nor the consolidated file proves external application state; a migration runner/applied ledger is still needed.

## D-015 — Formal semantic tracking begins with the v0.9.0 baseline

**Status:** Accepted

**Date:** 2026-08-15

### Context

The project is mature but historical work was not released under a formal semantic-version process.

### Decision

Use `v0.9.0` as the first formally tracked baseline. Record earlier work as milestones and do not invent retrospective version numbers.

### Consequences

Readiness checks, documentation, and baseline review were completed on 2026-08-15. `v0.9.0` establishes the formal versioning baseline. Future releases should keep tags, changelog entries, and package metadata deliberate and consistent.

## D-016 — Preserve comma-separated transaction tags at the v0.9.0 boundary

**Status:** Accepted

**Date:** 2026-08-15

### Context

`transactions.tags` and the existing autocomplete function use comma-separated TEXT, while the external v1 API accepts an array of tag strings. Passing that array through to a TEXT column relied on undocumented PostgREST coercion, and the prerequisite column, index, and function were not represented in migration history.

### Decision

Keep the established TEXT storage for the v0.9.0 baseline. Validate external tag values, serialize the array explicitly with commas in Node, and canonicalize `external_id`, its partial unique index, and the service-only `get_unique_tags()` RPC in Migration 016.

### Consequences

External ingestion has a deterministic database payload without a broader tag-model migration. Individual tag values cannot contain commas, duplicates retain their input order, and any future normalized tag model will require an explicit migration and API compatibility plan.

## D-017 — v1.0.0 establishes the stable product contract

**Status:** Accepted

**Date:** 2026-08-15

### Context

`v0.9.0` established formal release tracking and passed the complete production and repository readiness review. The verified product is mature enough for a stable contract without claiming feature completeness or eliminating documented technical debt.

### Decision

Use `v1.0.0` as the first stable Finance Tracker release. Apply semantic-version intent to product contracts: backwards-compatible product features use MINOR versions, backwards-compatible fixes use PATCH versions, and MAJOR versions are reserved for materially incompatible or breaking product, data, or API contracts.

### Consequences

Internal refactoring does not require a major version solely because implementation changes. Version impact follows externally meaningful compatibility, while new capabilities and fixes continue through deliberate changelog, package, and tag updates.

## D-018 — Funded budgets use immutable provenance and derived current state

**Status:** Accepted

**Date:** 2026-08-29

### Context

The legacy `budgets.amount` value could be overwritten without explaining the source of money or why a category changed. The funded-budget initiative also needs a stable foundation for later defaults, overrides, carryover, savings, reallocations, unbudgeted expenses, and deficit resolution.

### Decision

Use a hybrid PostgreSQL model. Existing budget rows become immutable category/month opening snapshots. Append-only operations, funding entries, movements, and lifecycle events are authoritative for subsequent change; derived views provide efficient current state. Normal initial funding is confirmed manual available money with a required label. `legacy_import` is migration-only, and transaction income is not yet consumable funding. Transactions remain authoritative actual spending.

### Consequences

Active zero, inactive history, and no budget are distinct. Removal releases only eligible unspent funding and preserves the point-in-time actual-spending snapshot used; later ledger edits do not retroactively rewrite that funding history. All financial mutations use idempotent RPCs, exact finite numeric arithmetic, canonical month-first locks, constraints, and reconciliation. Canonical monetary reads and authoritative mutation inputs use decimal strings across the JSON/Node/React boundary; numeric JSON money is rejected before the RPC call because it may already be rounded. JavaScript `Number` is permitted only for non-authoritative visual geometry or percentages and cannot feed a financial mutation. Generic compensating reversal is intentionally limited to supported manual-funding and monetary-adjustment operations. Legacy `amount` remains only a compatibility field and cannot be rewritten after cutover. Production deployment requires a separately reviewed Migration 017 run; repository presence is not deployment evidence.

## D-019 — Recurring defaults are configuration applied only by explicit funded initialization

**Status:** Accepted

**Date:** 2026-08-30

### Context

Normal category plans repeat, but a stored default is not itself money and must not mutate a month merely because the Budget page was viewed. Established monthly opening state must remain historically stable and future monthly overrides need a clean precedence point.

### Decision

Store one optional exact recurring amount per expense category in restricted mutable configuration. Absence means disabled; zero is an explicit default. The monthly read only previews missing eligible defaults. A separate explicit, idempotent PostgreSQL command applies all eligible defaults atomically to a current or future month, using existing unallocated funding and creating immutable snapshots with `starting_kind = recurring_default`. Existing active or inactive snapshots always take precedence.

Recurring amounts are managed centrally in the dedicated Settings → Budget area. Category Settings remains limited to category metadata; this keeps future budget-specific configuration in one extensible location without exposing unimplemented carryover, disposition, or override controls.

### Consequences

Page loads are financially read-only, insufficient funds produce no partial allocation, and changing or disabling a default affects only months that have not been initialized. Migration 018 does not add carryover, savings, reallocation, deficit resolution, or monthly overrides. A future #19 override can be selected by the same month-initialization boundary without rewriting an existing opening snapshot.

## D-020 — Carryover is a balanced explicit cross-month transfer

### Context

Unused funded category money must not be copied into another month while remaining funded in its source month. Carryover is distinct from a recurring opening basis, and viewing a Budget month cannot authorize a financial mutation.

### Decision

Migration 019 transfers eligible positive unused funding through a linked operation pair. The source category releases the amount and the source month records an equal negative funding delta; the destination month records equal positive funding and allocates it to the same category. Apply first takes a short `SHARE` lock on `transactions`, then locks the two months and their budgets in stable ID order and reconciles them together. The transaction-table lock conflicts with transaction writers, making point-in-time actuals stable until apply commits. A read-only current-month preview reports ready, blocked, and already-applied categories with a deterministic fingerprint. The explicit idempotent command captures that same authoritative candidate material once inside its transaction, validates the approved fingerprint immediately, and writes from the captured rows. A mismatch raises `CARRYOVER_PREVIEW_STALE` and rolls back without financial state. A compensating command reverses a transfer only when destination funding remains safely releasable.

### Consequences

Carryover cannot create or double-count money. It never rewrites `starting_amount`, recurring defaults, or historical transactions. Each immutable transfer preserves both the raw actual-spending total observed at apply time and `max(raw actual, 0)`, the effective value used by eligibility; later transaction edits may change current reporting but cannot recalculate that history. A destination with no applicable base receives an active zero `carryover_only` snapshot before the incoming movement; pending recurring initialization, inactive state, unbudgeted actuals, and active deficits block application. Savings/disposition, monthly overrides, unbudgeted-expense resolution, and deficit resolution remain separate issues.

## D-021 — Month overrides are base-only configuration with immutable funded effects

**Status:** Accepted

**Date:** 2026-09-02

### Context

A one-month planning choice must override a recurring or existing base without changing the recurring setting, rewriting the opening snapshot, or absorbing carryover.

### Decision

Store one optional exact override per budget month/category. Before category initialization it is planning configuration only. Initialization selects it ahead of the recurring default and captures the then-current recurring amount or zero as fallback. After initialization, set and remove commands append operations, movements, and immutable override events; effective base is derived from the opening snapshot plus override deltas. Actual-dependent releases use the carryover transaction-first serialization boundary and exclude carryover from base headroom. Normal changes are forbidden for past Asia/Jerusalem months.

### Consequences

Explicit zero differs from no override, no recurring default is required, and removal is a full compensating change or an atomic conflict. Manual, copied, recurring, monthly-override, and carryover-only openings remain explainable. Copy preserves destination overrides and pending overrides must initialize before carryover. Savings, disposition, deficit resolution, unbudgeted-expense resolution, and the full funded-budget redesign remain outside this decision.
