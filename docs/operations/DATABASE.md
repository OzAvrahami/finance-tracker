# Database files, migrations and checks

## Three different authorities

| Location | Meaning | Not evidence of |
| --- | --- | --- |
| [server/migrations](../../server/migrations) | Ordered incremental history, **001–044**; preserve filenames/order/content | A live database's applied state or a from-empty bootstrap |
| [server/full_schema.sql](../../server/full_schema.sql) | Consolidated reference used by disposable harnesses, including later replacements | A deployment ledger or approved production reset script |
| [operations/sql](sql) | Target/stage-specific read-only catalog, totals and invariant checks | Migrations, automatic repairs or universal current-schema checks |

Migrations begin by altering existing domain objects. There is **no canonical
repository migration runner or authoritative applied-migration ledger**, and no
verified general procedure that creates a new installation by simply applying
001–044 to an empty database. `supabase/.temp` CLI state is not that ledger.

The consolidated schema is executable in the controlled disposable harnesses with
their role/prerequisite setup. Those specific tests do not establish a production
bootstrap procedure. Older stage tests can intentionally slice the schema at a
marker or apply a subset; read the test before choosing a baseline.

## Migration families

| Range | Responsibility |
| --- | --- |
| 001–007 | Categories, LEGO acquisition/pricing, transaction pagination/items |
| 008–015 | Loan accounting, due payments, payoff, indexation and manual repayment |
| 016 | Legacy external transaction contract |
| 017–028 | Funded Budget, recurring/default/carryover, consolidation and allocation |
| 029 | Optional Shopping list fields |
| 030–035 | Named Savings foundation, cash/interest/surplus/monthly/reporting |
| 036 | APY source observations, idempotency/reconciliation and legacy mirror |
| 037–038 | FlowLink enrollment/credentials, bindings and authorized ingestion |
| 039 | [Shopping confirmed purchases, receipt review and atomic checkout](SHOPPING_RECEIPTS.md); not applied to production by #92 implementation |
| 040 | [Multi-photo receipt sets and stale-review protection](SHOPPING_RECEIPTS.md); forward upgrade of test-applied 039, no production application |
| 041 | [Explicit receipt reprocessing and correction archives](SHOPPING_RECEIPTS.md); isolated/disposable verification only |
| 042 | [Product identifiers, lookup cache, durable drafts and exact price breakdown](SHOPPING_RECEIPTS.md); forward upgrade after 041, isolated/disposable verification only |
| 043 | [Preserve newer submitted corrections in reprocessing archives](SHOPPING_RECEIPTS.md); forward function correction after test-applied 042, no data rewrite |
| 044 | [Personal/commercial product separation and immutable mapping revisions](SHOPPING_RECEIPTS.md); forward upgrade after 043, isolated/disposable verification only |

Historical migrations contain superseded intermediate objects. Do not remove or
rename them because later migrations replace them. #46 preserves every migration
and the full schema byte-for-byte. Future changes use a reviewed additive migration
at the next available number; this cleanup adds no migration system.

## Operational checks

The SQL files grouped in `docs/operations/sql/` retain their exact original bytes:

- `audit_003_readonly.sql`: historical pagination/security prerequisite audit;
  referenced by the diagnostic scripts and fake-Supabase fixture guidance.
- `MIGRATION_028_PRODUCTION_{PREFLIGHT,POSTFLIGHT}.sql`: funded allocation boundary.
- `MIGRATION_029_{PREFLIGHT,POSTFLIGHT}.sql`: Shopping optional-header boundary.
- `MIGRATION_030` through `MIGRATION_035` production pre/postflight pairs: each
  specific Savings upgrade boundary, not interchangeable with final-schema checks.
- `SAVINGS_RELEASE_POSTFLIGHT.sql`: integrated Savings boundary.
- `flowlink_snapshot.sql`: catalog/security/domain snapshot for the FlowLink
  owner rollout. Its comparison inputs depend on reviewed baseline and enrollment state.

Apply none of these automatically. Even read-only production SQL requires owner
authorization; snapshots may contain sensitive operational metadata. A PASS applies
to the queried target, baseline and time, not every installation. Follow the reviewed
runbook's backup, writer-quiescence, preflight/apply/postflight and recovery boundary.

The FlowLink snapshot is consumed by
[flowlink_rehearse.py](flowlink_rehearse.py), which uses a portless disposable Docker
database and refuses output inside the checkout. [flowlink_compare.py](flowlink_compare.py)
compares saved artifacts offline; neither is a migration runner. Their location stays
unchanged because the rehearsal derives the repository root from its directory.

## Verification consumers

- [fundedBudgetPostgres.local.test.js](../../server/test/fundedBudgetPostgres.local.test.js)
  loads 028 checks using `path.join`.
- Savings `*Postgres.local.test.js` suites read individual checks; the
  [release suite](../../server/test/savingsReleasePostgres.local.test.js) constructs
  030–035 check paths dynamically.
- [run-savings-release.cjs](../../server/test/run-savings-release.cjs) rewrites selected
  scenario runners outside the repository and injects the final Savings postflight.
- [Shopping SQL tests](../../server/test/shoppingListPostgres.local.test.js) use 029.
- [check-supabase-key-roles.js](../../server/scripts/check-supabase-key-roles.js) and
  [verify-anon-read-access.js](../../server/scripts/verify-anon-read-access.js) are
  explicitly networked diagnostics. Their existence does not authorize running them.

Path-only cleanup is verified by resolving every literal and expanded dynamic SQL
consumer and comparing old/new SQL bytes; it does not require production queries or
replaying financial test suites whose SQL/assertions did not change.

## Production and recovery evidence

Use the dated [history index](../history/README.md), Issue evidence and
[FlowLink owner runbook](FLOWLINK_OWNER_ROLLOUT.md). Owner-recorded installation of
036–038 is not re-proved by this cleanup. Do not reapply a migration solely because
a release was published or a document moved.

Once APY/FlowLink identities or Savings history exist, dropping their tables or
returning to incompatible hard-delete readers is not a rollback plan. Preserve
provenance, disable new ingestion if required by the approved runbook, and use a
verified restore/reconciliation or compatible forward fix. No production operation
was performed for #46.
