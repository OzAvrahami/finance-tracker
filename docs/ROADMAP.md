# Roadmap

This roadmap is organized by outcomes rather than speculative dates. It distinguishes completed release milestones from active post-1.0 work.

## Completed milestone: v1.0.0

**v1.0.0**, dated 2026-08-15, is the first stable Finance Tracker release. It promotes the fully verified **v0.9.0** pre-1.0 baseline without adding new runtime functionality solely for the promotion.

The stable designation reflects verified core workflows, complete release documentation, runtime and package alignment, portable quality gates, environment examples, independently verified production schema through Migration 016, external transaction contract coverage, private-artifact checks, and manual verification of the Railway runtime, Vercel origin/CORS match, and latest scheduled due-loan run.

## Planned minor release: v1.1.0 — Savings / חיסכון

The next planned product capability is a substantial Savings module. Its product and accounting design will be handled as separate work; this roadmap does not define or implement it.

## Post-1.0 stabilization

### Active: funded-budget initiative

- Foundation (#17 + #26): immutable monthly opening snapshots, confirmed manual funds, append-only provenance, reconciled reads, and bounded atomic commands are implemented locally in Migration 017; production rollout remains separately reviewed.
- Recurring defaults (#18): dedicated Settings → Budget configuration for expense categories, read-only pending previews, and explicit funded initialization are implemented locally in Migration 018. Production Migration 018 remains unexecuted.
- Carryover (#20): balanced previous/current-month transfers, immutable linkage, read-only preview, explicit application, and Settings → Budget configuration are implemented locally in Migration 019. Production Migration 019 remains unexecuted.
- Next dependent work remains separate: monthly overrides (#19), unused-budget/savings disposition (#21), unbudgeted-expense behavior (#22), reallocation/deficit resolution (#23), and the funded summary UX (#25).
- Income-transaction funding requires a future source-consumption model so one realized income cannot fund multiple months or allocations.

- Add a general CI workflow for client test/lint/build and server tests.
- Introduce a canonical migration runner and applied-migration ledger.
- Establish repeatable disposable or rollback-safe PostgreSQL migration rehearsals.
- Reduce partial-commit exposure around transaction items, LEGO synchronization, keyword learning, and related side effects.
- Make shopping checkout atomic or explicitly recoverable.
- Reconcile import behavior with the supported Add Transaction business pipeline.
- Remove or archive stale inventories, template documentation, unused shell components, and superseded design references.
- Decompose oversized controllers, hooks, and page components along existing business boundaries.

## Future capabilities

These are candidates, not scheduled commitments:

- CPI data ingestion and safe automatic accounting for indexed loans
- A deliberate multi-user ownership and authorization model
- Broader historical-loan import and reconciliation tooling
- Import reconciliation for automatically generated loan payments
- More complete financial audit trails and operational runbooks
- Expanded reporting and forecasting after core accounting contracts stabilize
