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

## D-022 — Month close disposes unused funding without treating Savings as expense

**Status:** Accepted

**Date:** 2026-09-03

### Context

Positive category headroom is funded money, but it is not automatically monthly surplus or an expense. A completed month needs one explicit, non-overlapping policy per category, and money must not remain simultaneously available in its source and destination.

### Decision

Use one policy row—carry forward, Savings, return to next-month unallocated, or no row—and one explicit close transaction for the immediately completed Asia/Jerusalem month. Carry-forward reuses Migration 019. Return-to-unallocated is a balanced cross-month funding pair with no destination category. Savings is one retained reserve outside monthly funded envelopes, derived from immutable signed ledger entries and excluded from expenses. Any active funded deficit or positive unbudgeted expense blocks the complete close.

### Consequences

Settings changes affect only future closes, previews write nothing, and apply writes exactly the fingerprinted candidate material or returns a stale-preview conflict. Historical policy, funded, raw-actual, and effective-actual snapshots are append-only. Corrections compensate rather than delete and must pass destination or Savings funding safety. Deficit resolution (#23), unbudgeted-expense resolution (#22), Savings withdrawals/accounts, and the full Budget redesign (#25) remain separate.

## D-023 — Reallocation and deficit resolution move only funded money

**Status:** Accepted

**Date:** 2026-09-04

### Context

Changing category priorities and funding actual overspending require explicit sources. A completed month with a funded deficit must remain repairable before Migration 021 can close it, without enabling arbitrary historical planning.

### Decision

Represent planned moves and multi-source deficit funding through immutable funding actions and source legs backed by the existing operation/movement ledger. Source eligibility is funded headroom after nonnegative transaction-authoritative actuals. Current-month actions may move between categories and unallocated funds; the immediately completed unclosed month permits only deficit resolution. Savings is an explicit deficit-only source that subtracts the retained reserve while adding equal monthly funding and allocation.

### Consequences

Opening state, recurring defaults, overrides, carryover, disposition, and transactions remain unchanged. Partial resolution remains visibly deficient. An original month-close batch permanently blocks normal actions even if later compensated. Unbudgeted categories remain #22 work, while named Savings accounts, general withdrawals, and the full Budget redesign remain out of scope.

## D-024 — Late budgets preserve the no-budget spending history

**Status:** Accepted

**Date:** 2026-09-04

### Context

Transaction-authoritative expenses may exist without an active monthly snapshot. Resolving them must not pretend funding existed at month opening or silently edit transaction classification.

### Decision

Migration 023 creates a missing snapshot with immutable zero opening and `starting_kind = unbudgeted_resolution`, then records every selected funding source through the existing Migration 022 action/leg ledger. An inactive snapshot is explicitly reactivated without rewriting or duplicating it; retained funding is preserved and zero-additional-funding reactivation is allowed only when it already covers the actual. Recorded spending suggests the initial amount and determines the resulting deficit, but it is not a ceiling on the monthly budget the user chooses: the selected source totals and their exact capacities are authoritative. Preview and apply share the transaction, Savings, month, budget, and category serialization boundaries, so changed approved material returns `UNBUDGETED_RESOLUTION_PREVIEW_STALE` with no partial state.

### Consequences

An allocation below current spending becomes an ordinary funded deficit for #23 and continues blocking #21 close. An allocation equal to or above current spending removes the `no_budget` blocker without changing the expense; any positive remaining balance is ordinary category funding. Transaction correction remains the existing Transactions workflow reached through month/category filters. Recurring defaults are never inferred, pending overrides must initialize first, and closed/older/future months remain immutable. The full Budget redesign (#25) remains separate.

## D-025 — Budget operations are the universal action header

**Status:** Accepted

**Date:** 2026-09-05

### Context

Migrations 019–023 added feature-specific batch, transfer, action, leg, and event tables around the proven funded ledger. Production has no rows in those newer provenance tables, making this the safest point to remove overlapping write-side identities without transforming history.

### Decision

Migration 024 keeps the accounting and configuration tables, makes `budget_operations` the sole business-action header, and adds one typed append-only `budget_operation_items` table for approval-time facts. Cross-month actions use one root and child posting operations. Funding entries, movements, Savings entries, lifecycle events, and transactions remain separate authorities; operation-item amounts are never used to calculate money.

The migration refuses to proceed if any retired feature table contains rows. Public commands remain domain-specific and retain their signatures. Migration 024 used relational adapter views only as a bounded deployment bridge. Migration 025 rewrites command internals against the consolidated model and removes those adapters. Canonical reads derive direct movement classifications and assert that composition equals authoritative final funding.

### Consequences

The physical Budget model is eleven tables, action reversal is rooted in `budget_operations.reverses_operation_id`, and feature-specific provenance no longer creates additional action headers. Pure recurring-default and unused-policy changes remain configuration-only. The canceled combined recurring/month edit is rebuilt after consolidation as one bounded command and uses operation items rather than another event table.

## D-026 — Internal Budget compatibility relations are temporary

**Status:** Accepted

**Date:** 2026-09-05

### Context

Migration 024 intentionally kept feature-table-shaped views so the consolidation could be deployed without simultaneously changing every PL/pgSQL command. Those aliases duplicated the old mental model in the catalog even though they stored no data.

### Decision

Migration 025 preserves the domain-specific public RPCs but rewrites their internals to use `budget_operations`, `budget_operation_items`, and the authoritative posting ledgers directly. It removes all eight feature compatibility relations, the two carryover-setting aliases, and the three composition intermediates. Nine canonical read views remain.

### Consequences

Internal SQL relation names are not compatibility contracts. Future Budget features must extend the universal operation/item model or receive explicit architectural approval; they must not introduce feature-specific tables or views as shortcuts. Migration 025 changes no funded, Savings, lifecycle, configuration, provenance, or transaction row.

## D-027 — Inline current-and-future Budget edits are one command

**Status:** Accepted

**Date:** 2026-09-06

### Context

The previous inline recurring action updated only future configuration while the selected current month remained unchanged, which made a successful command look broken.

### Decision

Migration 026 provides one current-Asia/Jerusalem-month command that applies the existing safe month override and the same recurring default atomically. Migration 027 includes existing future snapshots that still follow inherited/default planning in the same approved material and transaction. A read-only fingerprint includes every inspected future snapshot, its funding and actual state, and explicit-customization classification. The existing standalone month-override and Settings recurring commands remain unchanged.

### Consequences

All openings remain immutable, increases still require each affected month's unallocated funding, and decreases retain #19 release safety per month. The current month receives its explicit override configuration; inherited future months receive movements and typed propagation provenance without override rows, so later recurring changes can propagate again. Explicit future overrides and other proven month-specific openings are preserved. One root with deterministic child postings explains the atomic command without adding another table or view. Future-month inline editing remains month-only; future-only recurring changes stay in Settings.

## D-028 — Named Savings has a separate ledger and explicit cash authority

**Status:** Design accepted; SAV-02 owner acceptance recorded on 2026-09-13; SAV-03 completed using documented evidence and owner appearance confirmation; SAV-04 realized-interest commands implemented locally. Remaining commands retain their downstream ownership. Product scope and two-table/one-view boundary remain unchanged.

**Date:** 2026-09-10

### Context

SAV-01 (#37) inspects the current loan, transaction and consolidated Budget paths before implementing parent #36. The existing retained Budget reserve is not a named bank-account balance, and current raw expense sums would count a funded transfer twice if it also created a cash expense without a provenance distinction.

### Decision

Use exactly `savings_accounts` and `savings_entries`, plus one nonmaterialized `savings_account_summary` view. Cash remains authoritative in transactions; held balances and realized earnings derive from typed entries. A controlled one-time reversal pointer enforces unique active cash links, while immutable financial facts and reversal/replacement rows preserve history. Cancelled Savings cash retains an excluded tombstone. Account/month occurrence claims survive cancellation and schedule edits.

A funded surplus transfer removes source funding/allocation once, creates one expense and one deposit, and uses typed existing Budget provenance to exclude that specific expense from envelope actuals while retaining it in cash reporting. Ordinary manual Savings deposits remain normal envelope actuals. Opening amounts are independently declared at one cutoff; explicitly confirmed overlap with the legacy reserve retires only the duplicated reserve claim, with no invented cash or extra account deposit.

### Consequences

The [canonical Savings specification](SAVINGS_V1_3_0_SPEC.md) defines exact objects, commands, numerical proofs, rejection boundaries and rollout gates. SAV-02 (#38) owns the initial forward migration and compatibility foundation; later children reuse it. Migration 030 and the account/reader/UI foundation are now implemented locally; [SAVINGS_FOUNDATION.md](SAVINGS_FOUNDATION.md) separates delivered objects from later commands and records validation. Generic historical cash-linked Budget correction remains outside v1.3.0. SAV-01 #37 remains completed / Done; #38 is completed / Done after owner acceptance, with its native dependency retained. The work is local/uncommitted; no production operation or version bump is claimed.

Review resolutions: budget_actual_transactions(DATE,DATE) is the read-only SECURITY DEFINER/service_role EXECUTE exception, while mutating helpers stay protected. Corrections retain original-post ordering through replacement chains. One new loan_payments link guard closes reverse-direction contention without Loan schema/grant/accounting changes. Four protected transaction void fields and a unique receipt support #39's dedicated void_detached_savings_transaction with no second Savings reversal; still-live detached cash must be explicitly reused. The four-case interest matrix conserves realized earnings for equal-amount conversions and enforces prefix solvency. #38 delivers baseline SQL/Node reads, privileges and cancelled-history handling before #39 enables writes and refetch; #43 adds reporting only. The canonical inventory contains ten public Savings RPCs and assigns all structural foundation work to #38's next-available-number migration.


### SAV-02 implementation details, 2026-09-12

The inspected next migration is 030. Static replacements of the final existing function definitions keep historical migrations immutable and make privilege/reader changes reviewable. The delivered inventory is 3 account RPCs + 9 helpers, 11 attachments and 27 existing function replacements; the full initiative totals above are not prematurely exposed commands. Account mutation requests normalize supported values, use exact decimal text and optimistic revisions, and serialize transactions before reference/account locks. A conservative final-ledger integrity scan is used for this single-user foundation; any later optimization must retain both-direction relationship and concurrency checks. The service summary SELECT casts BIGINT IDs before JSON decoding and paginates through the complete collection without adding another view/RPC. No persisted balance cache exists.

Monthly plans store configuration and clipped due dates while automation is always false. Outstanding occurrence edits are rejected instead of silently advancing a plan before its owner implements settlement/skip. Budget named-account transfer/policy execution also stays explicitly gated; opening/reserve retirement is the only new Budget posting enabled here. All live reader compatibility, protected-column privileges and cancelled detail/identity handling are delivered now. Production preflight/postflight are read-only owner-run JSON artifacts; successful disposable PostgreSQL and browser checks are not production evidence or owner acceptance.

### SAV-03 implementation decisions, 2026-09-13

Migration 031 adds four public manual commands and one private engine without further tables/views. A cash correction preserves its transaction ID and original-post ledger ordering; detach reverses the ledger once and requires an explicit normal category. Because cancel_savings_event has no replacement-category argument, detach is transported through correct_savings_event with action=detach; cancellation uses void. This avoids guessing a category or adding a redundant overload. Still-live detached cash can only be explicitly reused; tombstones restore through new cash. Ordinary scalar edits after detach use the existing transaction RPC, retain the restricted cash shape and cannot affect Savings. Cash remains the only cash authority.

The engine takes the existing transaction serialization lock before ordered referenced rows and validates the complete final ledger at commit. Historical captured Budget operations conservatively block cash changes, including after detach. This favors correctness over write throughput for the existing single-user application. The transaction filter function uses fixed-path service-only SECURITY DEFINER to read protected Savings metadata; the pagination wrapper remains SECURITY INVOKER. Imports/external integrations and checkout reject unsupported Savings input; deliberate linking follows import. At that SAV-03 boundary, realized interest and transfer/automatic execution remained with #40–#42; the SAV-04 extension is recorded below. See [the implementation/write-path audit](SAVINGS_FOUNDATION.md).


### SAV-04 implementation decisions, 2026-09-13

Migration 032 replaces only the existing private event engine and account-history reader. No extra RPC, feature table, view, column, trigger or grant expansion is needed. Capitalized interest uses action=noncash and no cash snapshot; payout uses the stable interest_payout income role and explicit create_cash/link_cash. The approved four-case correction matrix is implemented atomically: payout-to-payout retains cash ID, payout-to-capitalized voids old cash, capitalized-to-payout creates one explicitly specified income, and noncash-to-noncash writes no cash. Conversions preserve equal-amount realized earnings and validate original-post balance prefixes. Cumulative realized earnings also stay in the exact-money range.

Reinstatement preserves the original destination; a subsequent destination change is a separate audited correction. Live detached cash must be explicitly linked; voided cash is replaced with a new row. Noncash cancellation uses cash_action=none and posts no cash receipt. Cash-month Budget restrictions apply only to actual old/new cash dates, so a purely noncash historical correction does not rewrite Budget history. The history RPC determines reinstatable eligibility across the whole chain, independent of pagination. Manual deposit/withdrawal kind changes remain prohibited. Descriptive annual rates and automation are unchanged. See [executed evidence and rollout](SAVINGS_FOUNDATION.md).


### SAV-05 implementation decisions, 2026-09-13

Named transfers use the existing Budget root/item and funding/movement structures with one linked Savings deposit and expense per candidate. All cash confirmations in a close are validated before any write, so shared destination accounts do not invalidate the batch's own previews. A coarse transaction/policy lock plus ordered row locks favors correctness over concurrent write throughput in this single-owner application. No bridge/batch/history relation is added.

Only typed, unreversed funded-transfer provenance is excluded from Budget actuals. Ordinary manual Savings deposits remain envelope expenses; the existing paginated transaction reader supplies Annual cash reconciliation with exact decimal strings. Its PostgREST projection includes the id and movement_type columns needed for ordering/filtering, as verified against real PostgREST. The private surplus helper exposes no service-role mutation permission; its internal reverse-preview mode is reached only through the existing protected funded-month reader.

A standalone transfer does not itself close a month. The foundation's conservative placeholder blocking all manual Savings activity in a transfer month is narrowed; specific funded cash remains protected and actual closed/carry/disposition history remains guarded. Eligible corrections require whole reversal followed by a new preview/apply, never an independently edited expense. Legacy reserve policy stays noncash and is named distinctly. SAV-04 owner review is deferred by the owner's explicit instruction; it is not a dependency or accepted outcome for SAV-05. [Evidence and rollout](SAVINGS_FOUNDATION.md#sav-05-funded-surplus-implementation--2026-09-13).


## SAV-06 implementation decisions — 2026-09-14

- The ledger's existing unique (account_id, occurrence_month) first-post index is the occurrence authority. Config revision, cash date and request UUID never redefine identity. Next due is recomputed from the nominal day and permanent claims inside the same mutation; a cancelled or skipped month remains claimed.
- Explicit fulfillment of an already-linked deposit is an audited same-snapshot reversal/replacement, not mutable occurrence metadata and not another deposit/cash amount. The narrow deferred-guard exception retains its original financial ordering and requires the same account, cash and snapshots. Different amount/source fulfillment needs an explicit override and reason.
- The oldest missed occurrence posts on the current Jerusalem cash date; another overdue month waits for another invocation. Plan edits cannot silently discard overdue work. Archive/pause preserve the due date, and restore never enables automation automatically.
- Scheduler authorization uses a dedicated secret plus disabled-by-default enable flag. It shares operational conventions with Loans but does not change Loan settings or scheduling. No scheduled workflow is enabled here; owner migration/deployment/configuration precede activation. Automation records app activity, never transfers money at a bank.

## SAV-07 reporting decisions — 2026-09-14

Use one new read-only get_savings_report RPC shared by existing screens. This produces one PostgreSQL snapshot and avoids downloading paginated histories for each account or duplicating cash classification in Node/Dashboard/Annual code. It is an additive reporting function, not another table/view or monetary authority. The two existing transaction readers gain a validated optional trailing cash-flow filter, preserving old calls and default cash totals; the signature replacement is atomic and unambiguous.

Current all-time holdings remain distinct from effective-date period flows. Active posts are the net result of immutable reversal/replacement history, including archived accounts. Linked cash is classified from the live relationship and stable category role/direction; detached cash returns to ordinary cash classification while retaining its historical audit link. Transactions alone supply cash; ledger amounts are never added again. Only the established typed funded transfer is excluded from Budget actuals. The existing Dashboard/Annual Budget calculations and Loan definitions are untouched.

Owner confirmation on 2026-09-14 supersedes the historical deferred/pending review for #40–#42. #43 requires its own owner review. Neither confirmation nor the new disposable reporting tests asserts production execution. [Evidence and owner rollout](SAVINGS_FOUNDATION.md).


## SAV-08 — Integrated verification and recovery boundary (2026-09-15)

The canonical [release runbook](RELEASE_1_3_0.md) is the final inventory/operator handoff. Rehearse the actual029→035 chain and clean snapshot rather than counting obsolete stage-only assertions as final acceptance. Final-schema commands/readers retain two Savings tables/one view;11 public RPCs,11 helper/trigger functions with one read-only Budget exception, and two Budget overloads. Backup restoration compares financial rows, sequences and effective permissions as well as schema. A pre-Savings backup cannot retain later account/cash/receipt changes; after writes, use a verified complete current backup/PITR plus reconciliation or a compatible forward fix. No drop-ledger/old-reader rollback is approved.

Owner “נראה טוב” accepts SAV-07 appearance/preview alongside recorded technical evidence. The owner subsequently approved SAV-08 integrated verification/release preparation; #44 is completed / Done. The explicitly authorized separate version step now prepares all seven fields at1.3.0 without dependency/runtime changes. Branch transfer uses a Git bundle because available deployment configuration does not establish a non-deploying branch push. No production or publication acceptance is inferred.
