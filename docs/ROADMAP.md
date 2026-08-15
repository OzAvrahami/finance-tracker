# Roadmap

This roadmap is organized by outcomes rather than speculative dates. It distinguishes baseline stabilization from larger future capabilities.

## Baseline: v0.9.0

Preparation for the first formal baseline is complete. **v0.9.0** establishes the documented starting point for semantic-version tracking.

Completed preparation includes canonical documentation, runtime and package alignment, portable quality gates, environment examples, independently verified production schema through Migration 016, external transaction contract coverage, private-artifact checks, and manual verification of the Railway runtime, Vercel origin/CORS match, and latest scheduled due-loan run.

## Stabilization after v0.9.0

This is the current active roadmap.

- Add a general CI workflow for client test/lint/build and server tests.
- Introduce a canonical migration runner and applied-migration ledger.
- Establish repeatable disposable or rollback-safe PostgreSQL migration rehearsals.
- Reduce partial-commit exposure around transaction items, LEGO synchronization, keyword learning, and related side effects.
- Make shopping checkout atomic or explicitly recoverable.
- Reconcile import behavior with the supported Add Transaction business pipeline.
- Remove or archive stale inventories, template documentation, unused shell components, and superseded design references.
- Decompose oversized controllers, hooks, and page components along existing business boundaries.

## v1.0.0 readiness

`v1.0.0` should represent stable operational contracts, not completion of every possible feature.

- Database evolution is reproducible and its applied state is observable.
- Core transaction, budget, loan, shopping, import, and LEGO workflows have stable documented behavior.
- Critical financial consistency paths have verified regression and database-level coverage.
- Backup, rollback, and recovery expectations are documented and rehearsable.
- Test, lint, and build gates run consistently before release.
- The effective single-user/security model is explicit, reviewed, and intentionally accepted or replaced.
- Runtime, environment, deployment, and scheduler contracts are stable and documented.
- High-risk partial mutations are removed or have explicit bounded recovery behavior.
- Legacy loan behavior is understood, tested, and retained or migrated intentionally.
- Public/external API contracts are documented and verified.

## Future capabilities

These are candidates, not scheduled commitments:

- CPI data ingestion and safe automatic accounting for indexed loans
- A deliberate multi-user ownership and authorization model
- Broader historical-loan import and reconciliation tooling
- Import reconciliation for automatically generated loan payments
- More complete financial audit trails and operational runbooks
- Expanded reporting and forecasting after core accounting contracts stabilize
