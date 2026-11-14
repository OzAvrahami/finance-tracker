# Shopping production activation — Issue #102

The owner explicitly authorized the production cutover on 2026-11-14 and waived a mandatory pre-migration backup. This waiver does not establish recoverability. No database reset or unverified restore is an acceptable recovery action.

## Execution boundary

`server/scripts/shoppingProductionBundle.js` is an offline SQL generator, not an automatic migration runner. It pins the immutable 060–063 source hashes, requires the explicitly approved project, physical PostgreSQL system identifier, owner authorization, migration ledger and all 15 Shopping preservation fingerprints. Private mapping input stays outside Git and deployment artifacts.

The generated transaction replaces disposable-only guards with production identity checks, including fail-closed NULL handling. It uses a 3-second lock timeout, 60-second statement timeout and 120-second transaction timeout. Financial and Shopping table locks drain in-flight writes. The original sequence `setval` is derived as transactional `ALTER SEQUENCE ... RESTART` with the identical next generated category ID; a forced failure test verifies sequence rollback as well as row, schema and ledger rollback. Source migrations remain unchanged.

Temporary Shopping DML triggers reject incompatible old writers and delayed callbacks. The matching backend first runs with `SHOPPING_PRODUCTION_MODE=fenced`. After the bounded migration commits, its preservation and permission assertions and PostgREST projections must pass before activating the new backend and removing the temporary fence. Never reactivate an old backend against the migrated schema.

## Server-controlled activation

- `SHOPPING_PRODUCTION_PROJECT` and `SUPABASE_URL` must identify the approved project.
- `SHOPPING_PRODUCTION_MODE` accepts only `fenced` or `active`.
- `SHOPPING_HISTORICAL_CATEGORY_IDS` contains the verified 25 historical identities from private mapping evidence.
- Existing `FLOWLINK_OWNER_USER_IDS` is the owner-approved authority for both Shopping access and administration. No browser flag or request field grants access.
- New browser writes carry `X-Shopping-Contract: hierarchy-v1`; old clients receive 426. Actual authorization, revisions, scope tokens and durable replay remain server/database enforced.
- The production router intercepts Shopping/settings paths case-insensitively, matching Express route semantics, without falling through to legacy Shopping writers. The shared parser's byte count preserves the narrower administrative input limit.
- Service-role credentials remain backend-only. Development preview remains separate and absent from production bundles.

Production verification found that 060 preserved anonymous SELECT access from legacy policies. The separately tested forward migration `20261114152838_shopping_owner_http_read_boundary.sql` closes PUBLIC/anon/authenticated SELECT on exactly the 15 Shopping tables and explicitly retains service-role SELECT. The hosted ledger timestamp is authoritative; the new local file was aligned to it after application. No financial grants, source migrations 060–063, or retained function definitions changed. Anonymous REST and RPC probes now fail with permission errors; owner-authenticated Express reads continue to work.

## Recovery and operations

Before commit, transaction failure leaves the original schema, rows, ledger and category sequence intact. After commit, fence Shopping and use a compatible forward fix if deployment fails. A prior application deployment is not a valid schema rollback. No hosted recovery rehearsal or verified backup was claimed.

The Railway service remains connected to main, while this cutover uses reviewed local CLI artifacts based on feature HEAD plus uncommitted activation changes. Until the owner checkpoints and integrates these changes, **do not trigger an automatic deployment of the older main source or roll back to a legacy build**. Preserve the verified deployment IDs and source-file manifest in the private execution record. Owner Git checkpoint, final production acceptance, version synchronization and formal publication remain separate actions.

Production smoke tests use disposable, explicitly named records and never create real checkout/refund transactions. Cleanup must target only those newly created test identities. Preserve durable command audit records and do not rewind sequences. Compare the original 85 list-row fingerprints, receipt/plan evidence and financial fingerprints again afterward.
