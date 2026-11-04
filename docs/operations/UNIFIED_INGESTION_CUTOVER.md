# Unified ingestion production cutover ? prepared, not executed

Prepared 2026-11-04. This runbook does not authorize production writes, deployment, producer activation or release publication.

## Decision and verified evidence

**Local preparation and restore rehearsal: complete. Production execution: NO-GO until the owner confirms the maintenance controls, disabled producer settings and post-commit recovery choice below.** This is a coordinated maintenance-window cutover, not a rolling backend deployment. No paid Supabase backup plan is required for the logical exports performed here.

- Production Railway deployment: `1f1033bb-41fa-48e5-a18d-4e6c00c9c382`, SUCCESS, commit `3471333d901d61eba62c67e5576217f97e2b083e`, main, one replica in us-west2, `npm --prefix server start`.
- Project `0c072417-78d2-465b-8ca3-9916cba965e6`; service `bc6566ed-5963-441b-b612-87caf94d7e7b`; production environment `29b7e41d-acf2-47a7-b7d1-3c5910d38997`.
- Supabase Finance Tracker project: `ohhvzveyreolguztcnqx`, PostgreSQL 17.6. Migration 054 absent; both CAL/general guards present; 38 historical CAL receipts; zero general registrations and receipts.
- Railway watches `/server/**`, `/shared/**`, `/Dockerfile.backend`, `/.dockerignore`, `/railway.json`, `/package.json`. A backend change or test-only server change can trigger deployment. Root package changes are not the only trigger.
- Railway OAuth exposes variable names, not values. `FLOWLINK_INGESTION_ENABLED`, `APPLE_PAY_INGESTION_ENABLED`, `SUPABASE_URL` and `CAL_INGESTION_SOURCES` are present, but their current values were not readable through this connection. Owner must confirm the correct Supabase target and paused-channel state in Railway; do not recreate sealed variables. The local CLI is installed (5.41.2) but currently unauthenticated; the MCP connection supplied the read-only deployment/config evidence.
- GitHub reports successful Railway and Vercel deployment statuses for 3471333. The current Vercel deployment link is https://vercel.com/ozavrahamis-projects/finance-tracker/BkEYd2QWdsPX4PiZGFcDnxEhozfx . Vercel dashboard auto-deployment settings were not inspected. Preserve the existing Git-connected frontend workflow; no new integration is needed.
- Prior regression verification: broader PostgreSQL 239/239, unified PostgreSQL 16/16, backend 573/573. No tests or financial application code were changed during cutover preparation.

## Private backup and restore evidence

Private directory (outside Git):

`C:\Users\ozavr\AppData\Local\FinanceTracker\private-backups\20261104-121449`

NTFS inheritance is disabled on this directory; explicit full-control access is limited to the current owner and SYSTEM. This is access-controlled local storage; encryption-at-rest and an off-device copy were not verified. Never attach these files to an Issue, commit them, or paste their contents into a report.

| Artifact | Purpose |
| --- | --- |
| `database.dump` | Canonical full custom-format PostgreSQL logical archive: schema and data from one pg_dump snapshot, including managed schema definitions |
| `cluster-roles.sql` | Cluster role definitions/memberships without role passwords |
| `schema.sql`, `data.sql`, `roles.sql` | Supabase CLI-compatible exports; data includes Auth and Storage metadata. These separate commands are not one shared snapshot; use database.dump as the canonical consistent recovery point |
| `backup-manifest.json` | Byte sizes, SHA-256 values, tools/image metadata and verification summary |
| `restore-verification.private.json`, `catalog-parity.json`, `cutover-rehearsal.json` | Private restore and migration evidence |
| `Refresh-Backup.ps1`, `verify-backup.py` | Private owner helpers for a new timestamped backup and a fresh disposable restore |

Supabase CLI 3.0.0 used its existing authenticated access and normal temporary CLI login role; no password reset, project reconfiguration or paid backup feature was used. Full pg_dump used the existing session pooler on port 5432 with SSL and a read-only session. A direct Docker IPv6 connection was unavailable; no network settings were changed. Temporary connection credential files are removed after use.

Restore verification used Supabase PostgreSQL 17.6.1.171 in a disposable Docker container with `--network none`, no published ports and a tmpfs data directory. Restore completed with `--single-transaction --exit-on-error`. **All 88 table COPY payload fingerprints and 29 sequence states matched the archive.** Public function definitions/grants, columns, indexes, policies and triggers matched production; relation ownership/RLS/effective grants matched. Five CHECK definitions were parser-normalized (AND grouping/array casts), with boundary/null equivalence verified. Owner-only ACLs represented as defaults are semantically identical. Raw schema text is not claimed byte-identical: extension initial-privilege dump formatting also differs.

The archive restored every database table in its TOC; it is not a full Supabase platform backup. Database role passwords, project API/JWT secrets, OAuth/email settings, Railway/Vercel settings and Edge Function artifacts require the existing platform configuration. Storage object count was zero; no object-file export was necessary at this observation. Do not infer future storage-file coverage from this database backup.

This backup was taken while production remained live. **Take and verify a fresh backup after pausing writers at the actual cutover.** It is not safe to restore this older recovery point over newer financial writes or identity/cancellation records.

## Migration 054 and compatibility matrix

Approved file: `server/migrations/054_unified_transaction_ingestion.sql`.
SHA-256 of rehearsed bytes: `fc58a9a9520cb9be77e6cfff49def16781e5d76e831885f862f3ac8e0ad42fbf`.

The file wraps its changes in BEGIN/COMMIT and locks transactions exclusively. It expands the source-kind/observation constraints, adds three internal source rows, installs the shared ingestion adapters, replaces the two old external-ID guards with a generic guard, adjusts reconciliation/domain-cancellation functions, and revokes service_role access to retired CAL/general intake RPCs. It retains all old receipts, observations, transactions, reconciliation and cancellation identities. It is forward-only and not safe to rerun blindly; there is no approved down migration. No historical migration file is edited or reapplied.

| Backend / database | Result and consequence |
| --- | --- |
| 3471333 / pre-054 | Current production combination |
| New backend / pre-054 | New RPC absent: SQLSTATE 42883; process `/health` can still return OK. Do not deploy new backend first |
| 3471333 / post-054 | Retired CAL/general calls fail with 42501; old external-ID inserts fail with PING1. Old manual/CSV/domain writers must not continue around the new decision path |
| New backend / post-054 | Local adapter dry-run and grant checks pass; matching UI changes are required to handle review outcomes correctly |

The real backup-copy rehearsal applied 054 successfully, preserved all 88 table payloads except the three intended source additions, and preserved the 38 CAL receipts. The read-only pre/postflight files compared all 48 public tables, excluding only those three newly added source rows. Injecting an error before COMMIT in a separate local copy rolled back the schema and restored old guards. PostgreSQL sequences can advance even when a transaction aborts; gaps are not permission to reuse identities.

The exact preflight SELECT was also executed through Supabase CLI read-only mode against production: all checks passed at that instant, and all 48 public-table preservation fingerprints still matched the restored backup. This point-in-time observation does not establish a future maintenance pause. Final readback confirmed 054 still absent, zero unified source rows, 38 CAL receipts and zero general registrations.

No real production transaction or producer capture was sent. Local successful dry-run is not live Bank Data Sync/FlowLink acceptance. Existing conservative review behavior for installments, bank semantics, refunds and insufficient identity evidence remains as documented in the implementation report.

## Required safe order

1. Owner reviews the exact commit inventory, protocol retirement/review behavior, this runbook and recovery choice. Keep Bank Data Sync inactive and FlowLink paused. Confirm both channel-enable flags are false; changing them, if needed, is a separately reviewed owner action. Preserve API keys, bindings and existing source identifiers.
2. Control automatic deployments BEFORE any push. Disconnect the Railway Git source for the maintenance window using the existing service; record its current main/root configuration. Do not introduce a new service or production environment. Coordinate Vercel production promotion so the matching frontend is ready before reopening app writes.
3. Owner commits only the manifest-listed files locally, without pushing yet. Review the resulting SHA. Keep the unrelated owner documents/cache unstaged.
4. Pause manual/CSV/Shopping/Loan/Savings writes, external callers and scheduled job callers. Stop the old Railway deployment. Drain/inspect outstanding database writers and wait for their outcomes. Stopping a process does not prove its last database request rolled back. Do not reset identities or replay uncertain batches with new IDs.
5. Capture read-only preflight, take a NEW private backup, restore-verify it, then capture preflight again. Both preservation maps must match and every check must pass. If they differ, the writer pause is not established: stop and investigate.
6. Apply ONLY migration 054, once, with bounded lock/statement timeouts. If the command times out or loses its response, inspect schema/guard/grant state before retrying. Never run full_schema.sql or supabase db push against this existing production database.
7. Run read-only postflight and compare all preservation fingerprints with preflight. Reload PostgREST's schema cache. Do not start a backend if any check differs or the RPC cache is unavailable.
8. Push the reviewed SHA with Railway auto-deploy still disconnected; deploy the backend from a clean export of that SHA. Verify deployment SUCCESS, exact source/artifact SHA, one replica, correct project and authenticated read-only paths. Publish/promote the matching frontend using the existing Vercel Git workflow; check exact SHA and reload stale browser tabs.
9. Only after owner validation, restore ordinary application writes and the Git source connection. Reconfirm there is no stale 3471333 replica/deployment. Keep automated bank delivery and FlowLink paused. Do not authorize a live financial smoke transaction implicitly; any such test requires separate owner approval and an identity/recovery plan.

## Owner commands ? examples prepared, none executed

Run from PowerShell. All production mutations in this section require the owner's separate execution approval. Do not paste credentials into command arguments or shell history. Supabase CLI syntax below was checked against installed 3.0.0; older --linked/--db-url examples do not apply unchanged.

```powershell
Set-Location 'D:\code\finance-tracker'
$project = '0c072417-78d2-465b-8ca3-9916cba965e6'
$service = 'bc6566ed-5963-441b-b612-87caf94d7e7b'
$environment = '29b7e41d-acf2-47a7-b7d1-3c5910d38997'
$ref = 'ohhvzveyreolguztcnqx'
$privateBackup = 'C:\Users\ozavr\AppData\Local\FinanceTracker\private-backups\20261104-121449'

# Authentication prerequisite; CLI currently needs login. Do not use a new project.
railway login
railway deployment list --project $project --service $service --environment $environment --limit 3 --json

# OWNER ACTION: stop automatic backend deployment before a push.
railway service source disconnect --project $project --service $service --environment $environment --json
if ($LASTEXITCODE -ne 0) { throw 'Source disconnect failed' }

# OWNER GIT ACTIONS. Inspect inventory and existing index before staging.
git status --short
git diff --cached --exit-code
if ($LASTEXITCODE -ne 0) { throw 'Unexpected staged work; review before proceeding' }
git add --pathspec-from-file=docs/operations/UNIFIED_INGESTION_COMMIT_FILES.txt
git diff --cached --check
git diff --cached --name-status
# Confirm the staged names exactly match the reviewed inventory before committing.
git commit -m 'refactor(ingestion): unify transaction intake and repair PostgreSQL fixtures'
if ($LASTEXITCODE -ne 0) { throw 'Commit failed' }
$candidate = (git rev-parse HEAD).Trim()

# OWNER ACTION: after all callers/users/jobs are paused.
railway down --project $project --service $service --environment $environment --yes
if ($LASTEXITCODE -ne 0) { throw 'Old deployment stop failed' }

npx --no-install supabase db query --remote=$ref --read-only --file docs/operations/sql/MIGRATION_054_CUTOVER_PREFLIGHT.sql --output-format json > "$privateBackup\preflight-before-refresh.private.json"
if ($LASTEXITCODE -ne 0) { throw 'Preflight query failed' }

# Creates a new protected timestamped directory; refuses overwriting an old backup.
& "$privateBackup\Refresh-Backup.ps1"
if ($LASTEXITCODE -ne 0) { throw 'Backup/restore verification failed' }
# Set this to the NEW verified directory printed by the helper:
$cutoverEvidence = 'REPLACE_WITH_NEW_VERIFIED_PRIVATE_DIRECTORY'
if ($cutoverEvidence -like 'REPLACE_*' -or -not (Test-Path -LiteralPath "$cutoverEvidence\database.dump")) { throw 'Verified cutover backup not selected' }

npx --no-install supabase db query --remote=$ref --read-only --file docs/operations/sql/MIGRATION_054_CUTOVER_PREFLIGHT.sql --output-format json > "$cutoverEvidence\preflight.private.json"
if ($LASTEXITCODE -ne 0) { throw 'Preflight query failed' }
$beforeRefresh = (Get-Content -Raw "$privateBackup\preflight-before-refresh.private.json" | ConvertFrom-Json).rows[0].preflight
$pre = (Get-Content -Raw "$cutoverEvidence\preflight.private.json" | ConvertFrom-Json).rows[0].preflight
if ($pre.checks.PSObject.Properties.Value -contains $false -or $pre.checks.PSObject.Properties.Value -contains $null) { throw 'Preflight gate failed' }
if ((Compare-Object $beforeRefresh.preservation.PSObject.Properties $pre.preservation.PSObject.Properties -Property Name,Value)) { throw 'Writers changed data during backup; stop' }

$migration = Resolve-Path 'server/migrations/054_unified_transaction_ingestion.sql'
if ((Get-FileHash -LiteralPath $migration -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'fc58a9a9520cb9be77e6cfff49def16781e5d76e831885f862f3ac8e0ad42fbf') { throw 'Migration differs from rehearsed bytes' }
# Bound the lock wait without editing the migration; its own BEGIN/COMMIT stays intact.
$applyFile = Join-Path $cutoverEvidence 'apply-054.sql'
$applySql = "SET lock_timeout='5s';`nSET statement_timeout='120s';`n" + [IO.File]::ReadAllText($migration)
[IO.File]::WriteAllText($applyFile, $applySql, [Text.UTF8Encoding]::new($false))
# OWNER PRODUCTION MIGRATION ACTION ? never execute during preparation.
npx --no-install supabase db query --remote=$ref --file $applyFile --yes --output-format json > "$cutoverEvidence\apply-054.private.json"
if ($LASTEXITCODE -ne 0) { throw 'Migration result uncertain/failed: inspect state; do not blindly retry' }

npx --no-install supabase db query --remote=$ref --read-only --file docs/operations/sql/MIGRATION_054_CUTOVER_POSTFLIGHT.sql --output-format json > "$cutoverEvidence\postflight.private.json"
if ($LASTEXITCODE -ne 0) { throw 'Postflight query failed' }
$post = (Get-Content -Raw "$cutoverEvidence\postflight.private.json" | ConvertFrom-Json).rows[0].postflight
if ($post.checks.PSObject.Properties.Value -contains $false -or $post.checks.PSObject.Properties.Value -contains $null) { throw 'Postflight gate failed' }
if ((Compare-Object $pre.preservation.PSObject.Properties $post.preservation.PSObject.Properties -Property Name,Value)) { throw 'Historical data changed; keep writers stopped' }
# OWNER cache reload; a healthy process alone does not verify RPC discovery.
npx --no-install supabase db query --remote=$ref --yes "NOTIFY pgrst, 'reload schema';"
if ($LASTEXITCODE -ne 0) { throw 'Schema cache reload failed' }

# OWNER PUSH: Railway source must still be disconnected. This can trigger Vercel.
git push origin main
if ($LASTEXITCODE -ne 0) { throw 'Push failed' }
$remoteHead = (git ls-remote origin refs/heads/main).Split()[0]
if ($remoteHead -ne $candidate) { throw 'Remote main is not the reviewed candidate' }

# Export ONLY committed files outside the worktree; never deploy a dirty checkout.
$deployRoot = Join-Path $env:LOCALAPPDATA ('FinanceTracker\deploy-' + $candidate.Substring(0,12))
if (Test-Path -LiteralPath $deployRoot) { throw 'Choose a fresh deployment export directory' }
New-Item -ItemType Directory -Path $deployRoot | Out-Null
$archive = Join-Path $cutoverEvidence 'candidate.tar'
git archive --format=tar --output=$archive $candidate
if ($LASTEXITCODE -ne 0) { throw 'Git export failed' }
tar -xf $archive -C $deployRoot
if ($LASTEXITCODE -ne 0) { throw 'Export extraction failed' }
railway up $deployRoot --path-as-root --project $project --service $service --environment $environment --detach --message "Unified ingestion $candidate"
if ($LASTEXITCODE -ne 0) { throw 'Deployment request failed' }
railway deployment list --project $project --service $service --environment $environment --limit 3 --json
# Wait for SUCCESS; a detached upload command returning is not deployment success.
Invoke-WebRequest 'https://finance-tracker-production-d34c.up.railway.app/health'
gh api "repos/OzAvrahami/finance-tracker/commits/$candidate/status"
# Require the matching frontend SHA and owner authenticated read-only UI checks.
# Verify GET /api/reconciliation/summary and /pending via the normal authenticated UI.
# Optionally inspect PostgREST's authenticated OpenAPI GET without logging its key.
# /health by itself is insufficient: it does not query the database.

# OWNER ACTION, after validation and explicit reopening approval:
railway service source connect --project $project --service $service --environment $environment --repo OzAvrahami/finance-tracker --branch main --json
# Reconnecting may deploy main again. Confirm the exact SHA/one replica before resuming.
```

The prepared CLI examples were syntax-checked against installed help; production mutation commands were NOT executed. The private backup helper and disposable restore path were exercised. A maintenance pause is not automatically enforced by these documentation steps: explicitly control users, scheduler callers, direct SQL/PostgREST writers and any other clients. If the owner cannot establish that boundary, do not apply 054.

## Recovery commands and limits

1. **Before migration COMMIT:** a SQL error aborts the migration transaction. A disconnected/timeout client is ambiguous: read catalog state first. When 054 is confirmed absent and the old guards/grants remain intact, redeploy the existing 3471333 artifact via the Railway deployment dashboard or the clean old-source export below. Do not replay the migration merely because the HTTP/CLI response was lost.
2. **After COMMIT, before ordinary writes resume:** keep the API stopped if postflight/deployment fails. Prefer a reviewed forward fix while retaining all records. A backend-only rollback to 3471333 is incompatible with 054. Do not improvise trigger drops, grant reversals or a down migration.
3. **After any post-cutover writes:** retain a second fresh archive of the incident state before recovery. Restoring the pre-cutover archive would lose newer cash, receipts, edits, cancellation decisions and identity reservations. It requires explicit owner data-loss/reconciliation approval; never silently overwrite those records.
4. **Database recovery:** the following isolated restore is verified and needs no paid backup plan. A managed Supabase recovery destination/configuration has NOT been restored in this preparation. The owner must choose either fail-closed forward recovery or a rehearsed empty recovery target before approving production execution. A new Free project, if chosen, requires an available Free project slot; none was created here. Do not assume raw cluster-role/managed-schema dumps can be replayed into an existing managed project with its restricted roles.

```powershell
# Fully verified LOCAL restore check. Network disabled; no service can consume rows.
python "$privateBackup\verify-backup.py"
if ($LASTEXITCODE -ne 0) { throw 'Backup restore failed' }

# Safe state check after a lost/failed migration response; it works before or after 054.
npx --no-install supabase db query --remote=$ref --read-only "SELECT to_regprocedure('public.unified_ingest(bigint,jsonb,jsonb,jsonb,text,jsonb)') IS NOT NULL AS migration_054_present, (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.transactions'::regclass AND tgname IN ('cal_external_identity','general_external_identity')) AS old_guards, (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.transactions'::regclass AND tgname='unified_external_identity') AS new_guards;"
if ($LASTEXITCODE -ne 0) { throw 'Database state unknown; keep writers stopped' }

# Only AFTER the database is verified back at the old pre-054 state:
$oldExport = Join-Path $env:LOCALAPPDATA 'FinanceTracker\recovery-3471333'
if (Test-Path -LiteralPath $oldExport) { throw 'Choose a fresh old-source export path' }
New-Item -ItemType Directory -Path $oldExport | Out-Null
git archive --format=tar --output="$privateBackup\recovery-3471333.tar" 3471333d901d61eba62c67e5576217f97e2b083e
if ($LASTEXITCODE -ne 0) { throw 'Recovery source export failed' }
tar -xf "$privateBackup\recovery-3471333.tar" -C $oldExport
if ($LASTEXITCODE -ne 0) { throw 'Recovery source extraction failed' }
railway up $oldExport --path-as-root --project $project --service $service --environment $environment --detach --message 'Recovery 3471333; verified pre-054 database'
# Keep Git auto-deploy disconnected until the recovery/new-main decision is resolved.
```

For a separately selected EMPTY managed Supabase recovery project, the documented CLI-compatible path is roles.sql, schema.sql, then data.sql with triggers disabled during loading in a single transaction. Its exact managed-target schema/version/permissions must be rehearsed first; Auth/Storage version differences can block it. Do not call that path verified based on the local restore. No destructive reset/restore command against the current production project is approved or included here. Reference: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore .

## Intended commit scope versus owner work

Use [UNIFIED_INGESTION_COMMIT_FILES.txt](UNIFIED_INGESTION_COMMIT_FILES.txt) as the exact path inventory, including the two retired runtime-file deletions and their test fixtures. It contains the existing unified ingestion implementation, its tests/docs, the seven repaired PostgreSQL suites/new fixture helper, and this preparation's runbook/checks/inventory. Review file content as well as names; the inventory is not owner acceptance.

Explicitly excluded and preserved:

- `docs/operations/APY_04_CAL_RECONCILIATION.md`
- `docs/MULTI_USER_ARCHITECTURE.md`
- `docs/MULTI_USER_INVENTORY.md`
- `docs/operations/__pycache__/` and its existing file(s)
- All private backups, exports, logs and credentials outside the repository.

All 598 starting file hashes were preserved; only the four new runbook/inventory/read-only SQL files were added in Git scope. A CLI-generated version-cache update was restored to its exact starting bytes. Backup-manifest hashes verified, temporary connection credential carriers removed, and all task-owned restore containers/volumes removed. `git diff --check` and PowerShell command parsing passed. No source, financial logic, migration 054, dependency, version or existing owner file was edited during this preparation. No stage/commit/push/tag/deploy, production migration, Financial Data Bridge access, or Bank Data Sync/FlowLink activation occurred.

## Release / Version gate

This cutover preparation adds operational documentation and read-only checks; the existing implementation's Major compatibility decision remains in force.

- Release impact: **No additional product impact** for preparation; encompassing unified ingestion **Yes**.
- SemVer impact: **None** for preparation; encompassing unified ingestion **Major** for retired envelopes/coordinated cutover.
- Candidate release: **Not applicable** for preparation; implementation **Pending (TBD)**, owner decision.
- Grouping / included release candidate: **Standalone preparation**, attached to the existing unified-ingestion candidate; candidate grouping Pending (TBD).
- CHANGELOG status: **Not applicable** for preparation; existing implementation Unreleased entry preserved.
- Version-bump status: **Not applicable** here; seven fields remain 1.8.0. Implementation release preparation remains Deferred to owner.
- Publication status: **Out of scope**.
- Owner verification / acceptance status: **Pending cutover/recovery review and separate execution authorization**.
