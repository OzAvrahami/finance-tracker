# Savings v1.3.0 preparation and operator runbook

Prepared locally on 2026-09-14–15 for SAV-08 [#44](https://github.com/OzAvrahami/finance-tracker/issues/44). This is the canonical integrated runbook and release-note draft. The [accounting specification](SAVINGS_V1_3_0_SPEC.md) and [implementation handoffs](SAVINGS_FOUNDATION.md) retain detailed APIs, reader/write-path audits and earlier evidence.

**Preparation is accepted; production and publication are unexecuted.** All seven package/lockfile version fields are now **1.3.0**, prepared on `feat/savings-v1.3.0` for an owner-operated commit. At this handoff the work is local/uncommitted and unavailable on remote main; the branch base remains `e5dec682a6c18df7d52da6cb77180f8438d63830`. #37–#44 are completed / Done, with #44 independently verified Closed / Completed / Done / P2 — Medium. Parent #36 and milestone v1.3.0 remain open. Commit and transfer verification below establish the later owner-created SHA; GitHub is authoritative for deployment, tag and Release state. This dated preparation record does not assert those later actions or require another documentation-only commit after publication.

## Acceptance and executed release gates

The owner accepted SAV-02, then the corrected SAV-03 appearance, and confirmed “הכל נראה תקין גם המשימות האחרות” for #40–#42. For SAV-07 the owner reviewed the preview/handoff and said **“נראה טוב”**. #43 was completed using that appearance/preview acceptance together with its documented technical verification. No individual owner numerical, desktop/mobile or production checks are inferred. Device/theme evidence below is agent browser evidence, separate from these owner confirmations. The owner subsequently approved the SAV-08 integrated-verification and release-preparation handoff and authorized the separate version/branch/staging preparation. #44 is completed using this acceptance and the evidence below; no additional owner-performed checks are invented. No repeat approval of #37–#44 is needed.

| Integrated gate | Executed result |
| --- | --- |
| Actual 029 baseline → 030–035, zero/nonzero legacy reserve | 2 real PostgreSQL cases passed; every stage's one-result pre/postflight passed and preservation evidence matched |
| Clean install versus upgraded public catalog | Equal relations, columns/defaults, indexes, constraints, triggers, function definitions/signatures/ACLs, RLS/policies and views |
| Backup/restore before and after Savings writes | Four binary custom archives restored to separate disposable databases; rows, effective ACLs, definitions and sequence values matched; post-backup cash tombstones/history remained readable |
| Final-schema connected accounting matrix | 39 cases passed: manual9, interest9, monthly8, surplus8, reporting5; zero failed or skipped among selected cases |
| Final single-result audit | Passed before account creation, on restored account/cash/cancelled history, and on the combined 1560 reconciliation fixture |
| Required client / server suites | 518/518 client tests in34 files; 345/345 server tests |
| Client lint / production build | Passed; existing >500kB bundle advisory only |
| Full application browser | Isolated Chromium, real persistence, normal shell/navigation, both entry points, interest destinations, plan enable/pause/manual fulfillment, archive/restore, report filters/refetch, desktop/mobile RTL and both themes; ordinary expense/income/itemized defaults retained |
| Integrated release hygiene (before version/staging preparation) | UTF-8, local links, schema/migration consistency, unchanged historical migrations, seven then-unchanged version fields, unchanged HEAD/index, unrelated-file preservation and git diff --check |

Commands run from the checkout (each PostgreSQL harness creates, inspects and removes only its own labelled container; no `.env` or production credentials):

```powershell
node --test server/test/savingsReleasePostgres.local.test.js
node server/test/run-savings-release.cjs
npm --prefix client test
npm --prefix server test
npm --prefix client run lint
npm --prefix client run build
git diff --check
```

The matrix runner reuses selected existing financial assertions against **the final full_schema**, with temporary runners outside the checkout. Historical stage-only assertions such as “only three account RPCs exist”, 030-only column equality with today's schema, and 031/032/033/034-specific function hashes are intentionally not selected or counted as passes. Their replacement is the directly executed ordered upgrade and clean-install comparison, including the original stage pre/postflight immediately at its proper stage. The full historical campaign was not rerun. After test-harness fixes, affected rehearsal checks were rerun; no financial implementation or migration changed.

PostgreSQL16 reserializes an existing varchar-array cast and flattens one equivalent AND expression on restore; its implicit owner-only ACL is equivalent to the explicitly revoked/default ACL. The comparator normalizes only these observed expressions and effective ACLs. It does not discard constraints or privileges. The first failures were harness comparison/fixture issues; they are not recorded as passes. Browser harness continuation corrected missing per-action confirmation/waits and an ambiguous metric selector; no product workaround was applied.

Evidence is outside Git: `C:\Users\ozavr\AppData\Local\Temp\finance-sav08-20260914` (application/browser/logs), `finance-sav08-matrix-Wr0qZR` (final-schema matrix), and `finance-sav08-release-dmBft5` (ordered stages/catalogs/fingerprints/four dumps and SHA-256 restore proofs). These are synthetic disposable artifacts, not production backups. Temporary retention is not durable backup custody; the operator must create and retain their own release records below.

## Reconciliation and preservation contract

| Event in one period | Held Savings | Period deposits | Withdrawals | Realized interest | Savings cash out / in |
| --- | ---: | ---: | ---: | ---: | --- |
| Confirmed opening1200 | 1200 | 0 | 0 | 0 | 0 / 0 |
| Ordinary deposit100 | 1300 | 100 | 0 | 0 | 100 / 0 |
| Funded Budget transfer300 | 1600 | 400 | 0 | 0 | 400 / 0 |
| Withdrawal50 | 1550 | 400 | 50 | 0 | 400 / 50 |
| Capitalized net interest10 | 1560 | 400 | 50 | 10 | 400 / 50 |
| Net interest paid to checking5 | **1560** | **400** | **50** | **15** | **400 / 55** |

Only live `transactions` contribute cash. Period ledger flows exclude opening, reversed posts and schedule skips. Paid-out interest never increases holdings; withdrawal never recognizes earnings again. Current holdings include archived accounts and are not historical period-end balances. Cash uses transaction dates; period ledger flows use corrected effective dates. This is cash-flow reporting, not #45's calculated checking balance.

For funded1000/ordinary spending700/transfer300, source funding/allocation become700, envelope actuals remain700, total cash expenses are1000 and Savings increase300. Adding the ordinary deposit100 from the combined fixture makes total cash expenses1100 and envelope actuals800; only the provenance-backed funded300 is excluded. A previous-month source/current-month cash transfer reduces only the source envelope; current-month funding is unchanged. Tests use actual permitted current/previous months, not an arbitrary closed historic month.

The upgrade preserves representative imported transactions, ordinary loan-payment cash/principal/interest relationships, Loan definitions/grants and Budget history. Reserve500 is created through the legacy Budget disposition operation. After migration it remains500 until the explicit confirmed opening1200/overlap300 command retires300, leaving reserve200 without cash. Zero-reserve accounts also work. No migration creates accounts, fabricates opening balances, retires a reserve or posts scheduled cash automatically. Reapplying a completed retirement is not a rollout step.

## Operator runbook — not executed in production

### 1. Confirm scope, baseline and compatible artifact

1. Obtain separate authorization for production work. Record repository commit/artifact SHA, database project identifier, PostgreSQL version, installed migration history and operator. Do not paste credentials into logs/issues. The expected starting application schema is **001–029**, including consolidated Budget024–028 and shopping headers029. Existing user-supplied029 evidence remains historical; this task did not query production.
2. Use the same reviewed Savings client/server revision together. Do not run an old client/server against new cancelled history. All production routes retain real authentication; isolated preview authentication is temporary tooling outside the repository and must never be deployed.
3. Confirm the operator can back up and restore all application objects/roles and the necessary managed-platform configuration. If the live schema differs, stop and compare it to the baseline before choosing a starting stage. Do not replay installed migrations or use `full_schema.sql` as an upgrade script.
4. Keep the Savings scheduler disabled (`SAVINGS_JOB_ENABLED` absent/false), with no timer invoking it. Preserve every existing Loan automation setting. The later maintenance pause suspends invocations, not account/Loan configuration.

### 2. Quiesce writers and secure a recoverable backup

Pause new app/API writes and drain in-flight requests. Pause imports/external integrations, shopping/task writers, manual SQL writers and both due-job invocations for the maintenance window. A read-only browser message alone is insufficient if external clients or jobs can still write. Record the pause boundary and do not re-enable writers between stage fingerprints.

Create a provider-supported database recovery point and export the complete application public schema/data/ACLs/sequence state. Record UTC timestamp, source project, tool/server versions, archive size and SHA-256. Save role definitions/configuration separately with secrets excluded from shared reports. Keep encrypted copies outside the repository and off the source service, with owner-controlled access and retention; name the custodian. Database backups do not contain Storage object bytes, and custom role credentials/platform settings need separate handling. See [Supabase backup scope](https://supabase.com/docs/guides/platform/backups) and [project backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

The following is an **owner-run example**, using preconfigured libpq service entries and protected password files rather than inline credentials. `finance_release_source` must resolve to the explicitly confirmed source; `finance_restore_check` must be a different empty disposable database with required roles/platform dependencies prepared. PostgreSQL binaries must match the source major version or use a compatible newer dump client. Use a direct/session connection suitable for administrative operations.

```powershell
# Only after production authorization, writer pause and connection-identity review.
$releaseBackupDir = 'D:\FinanceTrackerBackups\v1.3.0' # protected location outside Git
New-Item -ItemType Directory -Force -Path $releaseBackupDir | Out-Null
psql 'service=finance_release_source' -X -v ON_ERROR_STOP=1 -c 'select current_database(),current_user,inet_server_addr(),inet_server_port(),version();'
pg_dump 'service=finance_release_source' --schema=public --format=custom --no-password --file="$releaseBackupDir\public-before-savings.dump"
if ($LASTEXITCODE -ne 0) { throw 'Backup failed; do not migrate' }
Get-FileHash -Algorithm SHA256 -LiteralPath "$releaseBackupDir\public-before-savings.dump"
pg_restore --list "$releaseBackupDir\public-before-savings.dump" | Set-Content -Encoding utf8 "$releaseBackupDir\archive-index.txt"
# This target is isolated and empty, NEVER the source; do not use --clean on production.
psql 'service=finance_restore_check' -X -v ON_ERROR_STOP=1 -c 'select current_database(),current_user,inet_server_addr(),inet_server_port(),version();'
pg_restore --dbname='service=finance_restore_check' --exit-on-error --single-transaction "$releaseBackupDir\public-before-savings.dump"
if ($LASTEXITCODE -ne 0) { throw 'Restore rehearsal failed; do not migrate' }
```

This public-schema archive complements the provider recovery point; it does not replace Auth/Storage/role/platform recovery. An existing managed project may already contain public objects: use its documented restore workflow, never ignore duplicate-object/permission errors for the application schema. Require matching preflight counts/fingerprints, Budget reserve/state, Loan relationships, definitions, effective grants and sequence values on the isolated restore. The disposable rehearsal executed custom `pg_dump`/`pg_restore`, including old-backup re-upgrade and a post-write backup with a voided cash record. Production-provider restore and access control have not been exercised here. [PostgreSQL custom archives and restore behavior](https://www.postgresql.org/docs/16/backup-dump.html).

### 3. Apply the ordered chain, keeping writers paused

For each row, execute the **complete preflight**, save its one JSON result, require `MIGRATION_NNN_PREFLIGHT_PASS`, apply the complete migration once, then execute/save its postflight and require `MIGRATION_NNN_POSTFLIGHT_PASS`. In Supabase SQL Editor run each artifact separately; do not append intermediate SELECTs and assume earlier result sets are visible.

| Installed stage required | Preflight | Migration | Postflight |
| --- | --- | --- | --- |
| 029, Savings absent | [030 pre](MIGRATION_030_PRODUCTION_PREFLIGHT.sql) | [030 foundation](../server/migrations/030_savings_foundation.sql) | [030 post](MIGRATION_030_PRODUCTION_POSTFLIGHT.sql) |
| 030 | [031 pre](MIGRATION_031_PRODUCTION_PREFLIGHT.sql) | [031 manual](../server/migrations/031_savings_manual_transactions.sql) | [031 post](MIGRATION_031_PRODUCTION_POSTFLIGHT.sql) |
| 031 | [032 pre](MIGRATION_032_PRODUCTION_PREFLIGHT.sql) | [032 interest](../server/migrations/032_savings_realized_interest.sql) | [032 post](MIGRATION_032_PRODUCTION_POSTFLIGHT.sql) |
| 032 | [033 pre](MIGRATION_033_PRODUCTION_PREFLIGHT.sql) | [033 funded surplus](../server/migrations/033_savings_funded_surplus.sql) | [033 post](MIGRATION_033_PRODUCTION_POSTFLIGHT.sql) |
| 033 | [034 pre](MIGRATION_034_PRODUCTION_PREFLIGHT.sql) | [034 monthly](../server/migrations/034_savings_monthly_deposits.sql) | [034 post](MIGRATION_034_PRODUCTION_POSTFLIGHT.sql) |
| 034 | [035 pre](MIGRATION_035_PRODUCTION_PREFLIGHT.sql) | [035 reports](../server/migrations/035_savings_reporting.sql) | [035 post](MIGRATION_035_PRODUCTION_POSTFLIGHT.sql) |

For030 compare `financial_history`, `legacy_reserve` and `budget_state_fingerprint` exactly; table/view totals increase by2/1. For031–035 compare the entire paired `evidence` objects exactly, including stage-specific unchanged-function fingerprints. Keep both saved results; a PASS without that comparison does not prove preservation. Every030–035 preflight was executed before its migration in the disposable rehearsal, proving it does not depend on later objects. Older stage hash assertions are not final035 checks. If already migrated, inspect recorded stage results and use the correct remaining stage; stop on any unexplained mismatch or partial installation.

After035 run [SAVINGS_RELEASE_POSTFLIGHT.sql](SAVINGS_RELEASE_POSTFLIGHT.sql). Require all18 checks true and `SAVINGS_RELEASE_POSTFLIGHT_PASS`. At first rollout expect zero Savings accounts/entries and zero enabled flags, unchanged legacy reserve/cash/Loan/Budget history, total public tables28/views10 on this baseline. After intentional account/activity creation, nonzero Savings counts are expected; compare them to recorded commands instead of demanding zeros. The audit checks original-order solvency, reversal/cash links, Loan disjointness, permanent occurrence claims, protected permissions and the cash bridge. It is read-only and returns one JSON result.

### 4. Reload, deploy compatibly and reconcile

While writers remain paused, reload PostgREST's schema cache with `NOTIFY pgrst, 'reload schema';`. This is an explicitly later operator action, not part of the read-only checks. Deploy the same reviewed compatible server/client artifact; confirm real authentication, service-role Budget reads and the new RPC signatures. Verify cancellation-aware Node/nested readers as well as SQL. Deployment statuses are evidence of deployment, not financial acceptance.

Before general writes, smoke Savings/Transactions/Budget/Dashboard/Annual/Loans with the owner's authenticated identity. Compare live totals, old transaction IDs/external IDs, Loan balances/schedules/settings, Budget envelopes and legacy reserve against the captured baseline. Do not create a synthetic opening or overlap in production to imitate the fixture. First real opening requires independently confirmed amount/cutoff and explicit overlap evidence; the amount500 reserve is not proof of a bank deposit. For any separately authorized real test write, record its command/transaction/entry IDs, exact expected effects and audited cancellation if intended; never delete history to clean up.

Re-run the final audit after authorized writes and compare reports with contributing transactions/entries. Check period filters, both interest destinations and ordinary-versus-funded deposit treatment. Inspect one existing ordinary transaction edit, import duplicate handling, cancelled historical detail, Budget allocation and Loan read path. If discrepancies arise, keep writes paused and use recovery below. Re-enable ordinary writers only after the operator accepts these production results; resume existing Loan invocations without changing Loan automation settings.

### 5. Enable Savings scheduling separately

Scheduling is a later explicit operator decision. Confirm compatible034+ schema/server, job authentication, a dedicated secret stored server-side, the endpoint `POST /api/internal/jobs/process-due-savings`, and no accidental duplicate timer. Set `SAVINGS_JOB_ENABLED=true` only when authorized. A job may process any enabled due account, so review **all** enabled accounts and their oldest due dates first. Per-account automation requires explicit enablement; saving/editing a plan or restoring an archive does not enable it. No future cash is created; overdue work advances one nominal month per invocation using today's Jerusalem cash date. Repeated timer invocations can process successive missed months, so choose/observe cadence deliberately. Scheduling records activity, not bank transfers. Keep secrets out of logs/browser/issues. Pause with the endpoint gate/timer and/or explicit account pause; do not rewrite occurrence history. Leave Loan endpoint/secret/settings unchanged.

### 6. Recovery and limits

- **Before new writes:** keep writers paused. Prefer correcting a failed stage with a reviewed forward migration. If abandoning the rollout, restore the verified pre-upgrade recovery point into an isolated replacement, compare the saved financial/schema/grant/sequence evidence, then switch only after explicit operator approval. An old compatible application is usable only with that restored pre-Savings state and proof that no post-backup writes would be lost. Do not drop Savings objects in the upgraded database or blindly redeploy the old reader.
- **After any new writes:** immediately pause relevant writers/jobs and take a fresh complete backup of the current state, preserving command receipts, external IDs, entries, Budget operations/items, Loan links, tombstones and sequences. Prefer a compatible read-preserving application/forward SQL fix tested against a restored copy. A complete verified backup at the pause boundary can restore those writes; the rehearsal proved this including cancellation history. Restore to a separate environment first, compare final audit/report/history and switch atomically with the reviewed artifact.
- **If recovering to an earlier point:** use a verified provider PITR/backup covering the intended boundary. Inventory all subsequent writes across every application table before any cutover. A pre-Savings dump alone demonstrably loses newly opened accounts and cash history. There is no generic safe row-merging script: interdependent Budget/Loan/Savings/receipt/sequence changes require a reviewed transaction-aware replay or forward fix, with duplicate identities and historical solvency checked. If later writes cannot be recovered/reconciled, this is a concrete recovery blocker requiring an explicit data-loss decision, not permission to silently discard them. Never unvoid transactions, replay cancelled monthly claims, retire reserves again or offset balances with invented cash.

## Reviewed release notes and completed version preparation

Target: **Finance Tracker v1.3.0 — Savings** (unpublished draft).

- Loans-style Savings accounts, independently confirmed opening/cutoff, optional goals/provider/terms, archive/restore and audit history.
- Exact manual deposits/withdrawals from Savings or Transactions, explicit existing/imported cash linkage, protected correction/detach/cancellation/restoration and live/cancelled readers.
- Actual net interest held in Savings or paid to checking, including audited destination corrections; no estimated interest, tax inference or bank connectivity.
- Named funded-surplus destinations and atomic Budget/cash/Savings posting with whole-transfer reversal and separate source-month/cash-date reconciliation.
- Explicit monthly enable/pause, oldest-due processing, permanent account/month identities and deliberate manual fulfillment; separately enabled protected scheduler, no bank transfers.
- Dashboard, monthly Savings, transaction filters and annual reports distinguish current holdings, period flows and both interest destinations without duplicate cash/earnings.
- Database upgrade030–035; exactly two new physical tables and one summary view. Existing Loan accounting and ordinary transaction design remain preserved. Operator backup/restore and rollout runbook required.

Review these notes with `CHANGELOG.md → [1.3.0] - Prepared (unpublished)`. Unreleased remains empty for later work. The owner accepted #44 and explicitly authorized the **separate version-preparation step**, changing exactly these seven fields from1.2.0 to1.3.0:

| File | Field(s) |
| --- | --- |
| `package.json` | `version` |
| `client/package.json` | `version` |
| `client/package-lock.json` | `version`, `packages[""].version` |
| `server/package.json` | `version` |
| `server/package-lock.json` | `version`, `packages[""].version` |

There is no root lockfile. Dependency trees and dependency versions are unchanged; only the seven root version values change. The changelog records a preparation date, not an invented publication date. The owner authorized selective staging but retains commit/transfer control. The unrelated development-standard modification is excluded. Production migration/deployment, scheduler enablement, tagging and release publication remain separately authorized owner-controlled actions. Keep #36/milestone open until their actual completion criteria are met; #44 is completed without claiming publication.

## Owner commit and Windows-to-Mac continuation — 2026-09-15

The dedicated branch is `feat/savings-v1.3.0`, based on `e5dec682a6c18df7d52da6cb77180f8438d63830`; the initial index was empty. The approved105-file Savings inventory plus five package/lockfiles comprises110 intended files. Selective staging is authorized; the owner executes the commit. The unrelated `docs/github-development-standard.md` remains byte-preserved and unstaged. No runtime, migration or dependency change belongs to this preparation step. Earlier full-suite evidence is reused; only version/lock metadata, documentation links/UTF-8, reviewed inventory and staged whitespace are checked now.

The repository's only workflow is the existing scheduled/manual due-loan job, with no push trigger. However, authenticated deployment records show Vercel Production and Railway production integrations, and available repository configuration does not establish their branch filters or safe preview environment settings. Consequently **a non-deploying branch push is not established**. Use an offline Git bundle; do not push this branch, open a PR or merge to main merely to transfer it. Provider configuration and any later network publishing require a separate review. Bundle creation/fetch does not contact GitHub or activate deployment.

Review the prepared index with `git diff --cached --stat`, `git diff --cached` and `git diff --cached --check`. The completion report supplies a commit command guarded by the exact reviewed index tree, stopping if subsequently staged content differs. Suggested message: `feat(savings): prepare v1.3.0 savings workflows and reports`. No automatic commit is performed. The seven package fields say1.3.0; production still requires030–035 and the operator workflow above.

After the owner commits, create a self-contained bundle and its expected commit identifier outside the repository:

```powershell
Set-Location 'D:\code\finance-tracker'
if ((git branch --show-current) -ne 'feat/savings-v1.3.0') { throw 'Unexpected branch' }
$savingsCommit = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $savingsCommit -eq 'e5dec682a6c18df7d52da6cb77180f8438d63830') { throw 'Commit the reviewed Savings changes first' }
$savingsBundle = Join-Path $env:USERPROFILE 'Downloads\finance-tracker-savings-v1.3.0.bundle'
$savingsShaFile = Join-Path $env:USERPROFILE 'Downloads\finance-tracker-savings-v1.3.0.commit.txt'
if ((Test-Path -LiteralPath $savingsBundle) -or (Test-Path -LiteralPath $savingsShaFile)) { throw 'Transfer files already exist; preserve or rename them before continuing' }
git bundle create $savingsBundle refs/heads/feat/savings-v1.3.0
if ($LASTEXITCODE -ne 0) { throw 'Bundle creation failed' }
git bundle verify $savingsBundle
if ($LASTEXITCODE -ne 0) { throw 'Bundle verification failed' }
[IO.File]::WriteAllText($savingsShaFile, $savingsCommit + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
Write-Output $savingsCommit
```

Transfer **both** files to the Mac's Downloads directory through the owner's chosen file-transfer method. This includes all committed branch history; it does not include the unrelated unstaged standard, Windows.env files, databases, node_modules, logs or running preview services. Keep the SHA file with the bundle and compare it on the Mac.

For a **fresh checkout**, run in macOS zsh. It stops if the target directory already exists:

```zsh
(
  set -eu
  bundle="$HOME/Downloads/finance-tracker-savings-v1.3.0.bundle"
  expected=$(tr -d '\r\n' < "$HOME/Downloads/finance-tracker-savings-v1.3.0.commit.txt")
  mkdir -p "$HOME/code"
  if [[ -e "$HOME/code/finance-tracker" ]]; then echo 'Checkout exists; use the existing-checkout procedure'; exit 1; fi
  git clone --branch feat/savings-v1.3.0 "$bundle" "$HOME/code/finance-tracker"
  cd "$HOME/code/finance-tracker"
  git remote set-url origin https://github.com/OzAvrahami/finance-tracker.git
  [[ "$(git rev-parse HEAD)" == "$expected" ]] || { echo 'Windows/Mac commit mismatch'; exit 1; }
  git status --short --branch
  git rev-parse HEAD
)
```

For an **existing checkout**, the following deliberately stops before switching if any tracked/untracked Mac changes exist. Preserve them through a separate owner decision; there is no automatic stash, reset, force or overwrite. It also stops if the existing Savings branch contains commits not in the transferred history, including divergence or a locally advanced branch. Other local branches/commits remain intact.

```zsh
(
  set -eu
  cd "$HOME/code/finance-tracker"
  case "$(git remote get-url origin)" in
    https://github.com/OzAvrahami/finance-tracker.git|git@github.com:OzAvrahami/finance-tracker.git) ;;
    *) echo 'Unexpected origin; verify checkout identity'; exit 1 ;;
  esac
  [[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] || { echo 'Local Mac changes present; stop and preserve them before switching'; exit 1; }
  bundle="$HOME/Downloads/finance-tracker-savings-v1.3.0.bundle"
  expected=$(tr -d '\r\n' < "$HOME/Downloads/finance-tracker-savings-v1.3.0.commit.txt")
  git bundle verify "$bundle"
  git fetch "$bundle" refs/heads/feat/savings-v1.3.0
  [[ "$(git rev-parse FETCH_HEAD)" == "$expected" ]] || { echo 'Transferred commit mismatch'; exit 1; }
  if git show-ref --verify --quiet refs/heads/feat/savings-v1.3.0; then
    git merge-base --is-ancestor feat/savings-v1.3.0 "$expected" || { echo 'Savings branch diverged or contains untransferred local commits; stop'; exit 1; }
    git switch feat/savings-v1.3.0
    git merge --ff-only "$expected"
  else
    git switch -c feat/savings-v1.3.0 "$expected"
  fi
  [[ "$(git rev-parse HEAD)" == "$expected" ]] || { echo 'Windows/Mac commit mismatch'; exit 1; }
  git status --short --branch
  git rev-parse HEAD
)
```

### Mac dependencies and isolated local configuration

Use a Node version satisfying the manifests: `^20.19.0 || >=22.12.0`. Install the locked dependencies from the repository root (there is no root lockfile):

```zsh
cd "$HOME/code/finance-tracker"
node --version
npm ci --prefix server
npm ci --prefix client
[[ -e server/.env ]] || cp server/.env.example server/.env
[[ -e client/.env ]] || cp client/.env.example client/.env
```

Before starting, configure **isolated local/test** Supabase/PostgREST and Auth, server-only credentials and a test user. The examples intentionally contain no credentials. Do not reuse production endpoints or keys by default. Keep `SAVINGS_JOB_ENABLED=false`, no Savings timer, and existing Loan automation settings unchanged. The foundation handoff documents the actual persistent full-app preview design; its Windows temporary launchers and databases are not portable Git assets. Recreate only an inspected disposable setup on the Mac if needed, with temporary tooling outside the checkout; the saved Windows loopback URL does not identify a running Mac service. No production migration or preflight belongs to this transfer.

Once isolated environment values are configured, use two terminals. The current server script loads server/.env and defaults to5050; the client defaults to5173 and its API setting may be `http://localhost:5050/api`:

```zsh
# Terminal 1
cd "$HOME/code/finance-tracker"
SAVINGS_JOB_ENABLED=false npm --prefix server run dev
```

```zsh
# Terminal 2
cd "$HOME/code/finance-tracker"
npm --prefix client run dev -- --host localhost --port 5173 --strictPort
```

Open http://localhost:5173; this matches the existing server CORS allowlist. Strict port selection stops instead of silently switching to an unsupported origin if5173 is occupied. Configure local authentication for that origin. These commands do not install a database. Existing isolated test persistence and full-app test identity must be prepared before owner interaction; do not replace mutations with mocks. Production compatibility, migrations, deployment, explicit scheduler enablement, tag and release remain pending regardless of successful Git transfer.

## Final database and file inventory

The inventory below is generated from the inspected029/final035 catalogs and reviewed against030–035 DDL. It supersedes stage-only counts; no036 migration is needed. Historical migration contents remain unchanged.

### Footprint and structural changes

Final public footprint: **28 tables /10 views**, versus26/9 before Savings. Added: savings_accounts, savings_entries, savings_account_summary and the two identity sequences savings_accounts_id_seq/savings_entries_id_seq. No materialized view, goal/provider/schedule/job/bridge/history/cache/report table is added.

| Existing object | Intentional change |
| --- | --- |
| categories | Nullable savings_role; role/direction CHECK and unique partial role index; three stable role categories; role-history guard |
| transactions | Four void receipt columns, all-or-none CHECK, unique receipt-key partial index, protected column grants and two guard/reconciliation triggers |
| budget_unused_balance_policies | savings_account_id FK, destination/policy CHECKs and index; read view adds destination |
| budget_operations | Existing operation-type CHECK includes transfer/retirement and reversals |
| budget_operation_items | savings_event_id FK/index, item-kind CHECK and deferred Savings reconciliation trigger |
| budget_savings_entries | Entry-kind/provenance CHECKs allow explicit opening retirement/reversal; no new columns or automatic retirement |
| transaction_items | Two Savings relationship guards only; no columns |
| loan_payments | One BEFORE INSERT/UPDATE link guard only; existing Loan grants/columns/functions/triggers/scheduling unchanged |

Three existing views are replaced: `budget_category_composition`, `budget_month_category_actuals`, `budget_unused_balance_policies_read`. Existing public relations are not dropped.

savings_accounts columns (32):

```text
id: bigint NOT NULL IDENTITY
name: text NOT NULL
notes: text NULL
terms: text NULL
status: text NOT NULL DEFAULT 'active'::text
purpose: text NULL
revision: bigint NOT NULL DEFAULT 1
opened_on: date NOT NULL
reference: text NULL
created_at: timestamp with time zone NOT NULL DEFAULT now()
updated_at: timestamp with time zone NOT NULL DEFAULT now()
archived_at: timestamp with time zone NULL
monthly_day: smallint NULL
target_date: date NULL
product_name: text NULL
release_date: date NULL
currency_code: text NOT NULL DEFAULT 'ILS'::text
next_due_date: date NULL
plan_revision: bigint NOT NULL DEFAULT 0
target_amount: numeric(18,2) NULL
monthly_amount: numeric(18,2) NULL
liquidity_notes: text NULL
plan_start_date: date NULL
institution_name: text NULL
tracking_start_date: date NOT NULL
annual_interest_rate: numeric(12,6) NULL
auto_deposit_enabled: boolean NOT NULL DEFAULT false
creation_fingerprint: text NOT NULL
creation_request_key: uuid NOT NULL
last_config_fingerprint: text NULL
last_config_request_key: uuid NULL
default_payment_source_id: bigint NULL
```

savings_entries columns (25):

```text
id: bigint NOT NULL IDENTITY
amount: numeric(18,2) NOT NULL
reason: text NULL
account_id: bigint NOT NULL
command_id: uuid NOT NULL
created_at: timestamp with time zone NOT NULL DEFAULT now()
event_kind: text NOT NULL
source_kind: text NOT NULL
command_kind: text NOT NULL
entry_action: text NOT NULL DEFAULT 'post'::text
command_index: smallint NOT NULL
plan_revision: bigint NULL
effective_date: date NOT NULL
transaction_id: integer NULL
cash_category_id: bigint NULL
cash_charge_date: date NULL
occurrence_month: date NULL
reverses_entry_id: bigint NULL
cash_movement_type: text NULL
occurrence_root_id: bigint NULL
scheduled_due_date: date NULL
command_fingerprint: text NOT NULL
supersedes_entry_id: bigint NULL
reversed_by_entry_id: bigint NULL
cash_payment_source_id: bigint NULL
```

### Function signatures and ownership

The final catalog has **26 added signatures and2 removed old reader signatures (net24)**, plus29 same-signature replacements. This corresponds to31 changed existing function names (29 retained signatures plus two extended readers), **11 public Savings RPCs**, **11 helper/trigger functions (10 private and one read-only service_role Budget exception)**, and two new Budget overloads. The earlier design count of23 new signatures predates the justified035 report RPC; it is not the final catalog count.

030 owns the two tables/view, account RPCs, nine foundation helpers and reader/relationship compatibility;031 owns four manual public commands and the private posting engine;032 extends that engine/history for interest;033 owns three surplus RPCs, one private surplus helper and two Budget overloads;034 replaces five existing functions only;035 owns the report RPC and final reader signatures.

Added final signatures (extended transaction readers are replacements, not extra reporting structures):

```text
apply_budget_month_disposition(text,uuid,text,text,jsonb)
apply_savings_surplus(uuid,text,jsonb)
budget_actual_transactions(date,date)
cancel_savings_event(uuid,bigint,bigint,text,text)
correct_savings_event(uuid,bigint,bigint,jsonb,text)
create_savings_account(uuid,jsonb,text,text,text)
get_savings_account(bigint,date,date,bigint,integer)
get_savings_report(date,date,bigint)
get_savings_surplus_preview(text,bigint,bigint,text,bigint,date)
post_savings_event(uuid,jsonb)
reverse_savings_surplus(uuid,bigint,text,text)
savings_apply_surplus_locked(uuid,jsonb)
savings_assert_account(bigint)
savings_assert_links()
savings_guard_category_role()
savings_guard_entry_mutation()
savings_guard_loan_payment()
savings_guard_transaction()
savings_guard_transaction_item()
savings_post_event_locked(uuid,jsonb)
savings_validate_account()
set_budget_unused_balance_policy(bigint,text,bigint)
transactions_filtered(date,date,bigint,bigint,boolean,text,bigint,integer,text)
transactions_page(date,date,bigint,bigint,boolean,text,integer,text,text,bigint,date,numeric,text,boolean,boolean,bigint,text)
update_savings_account(bigint,bigint,uuid,jsonb)
void_detached_savings_transaction(uuid,integer,text,text)
```

Removed029 signatures (default-compatible trailing parameters on the new signatures):

```text
transactions_filtered(date,date,bigint,bigint,boolean,text)
transactions_page(date,date,bigint,bigint,boolean,text,integer,text,text,bigint,date,numeric,text,boolean,boolean)
```

Replaced existing signatures:

```text
apply_budget_month_disposition(text,uuid,text,text)
budget_carryover_candidate_rows(text)
budget_funding_source_rows(text,bigint)
budget_month_disposition_candidate_rows(text)
copy_funded_budget_month(text,text,uuid,text)
dashboard_monthly_series(integer)
dashboard_summary(date,date)
get_budget_deficit_resolution_preview(text,bigint,jsonb)
get_budget_month_disposition_preview(text)
get_budget_reallocation_preview(text,text,bigint,text,bigint,numeric)
get_budget_unbudgeted_resolution_preview(text,bigint,numeric,jsonb)
get_funded_budget_month(text)
get_unique_tags()
group_budget_posting_operation()
prevent_category_type_with_unused_balance_policy()
remove_budget_month_override(text,bigint,uuid,text)
remove_funded_budget(bigint,uuid,text)
reverse_budget_carryover(bigint,uuid,text)
reverse_budget_funding_action(bigint,uuid,text)
reverse_budget_month_disposition(bigint,uuid,text)
reverse_budget_unbudgeted_resolution(bigint,uuid,text)
reverse_funded_budget_operation(bigint,uuid,text)
set_budget_month_override(text,bigint,numeric,uuid,text)
set_budget_unused_balance_policy(bigint,text)
set_funded_budget_amount(bigint,numeric,uuid,text)
validate_budget_operation_item()
validate_budget_operation_tree()
validate_budget_savings_entry()
validate_budget_unused_balance_policy()
```

### Indexes, constraints, triggers and permissions

All20 new indexes, including PK/unique constraint indexes; no existing index removed/redefined:

```text
budget_operation_items_savings_event
budget_unused_savings_account
categories_savings_role
savings_accounts_creation_request_key_key
savings_accounts_due
savings_accounts_payment_source
savings_accounts_pkey
savings_accounts_status_id
savings_entries_account_date
savings_entries_active_cash
savings_entries_active_occurrence
savings_entries_cash_history
savings_entries_command_id_command_index_key
savings_entries_occurrence_claim
savings_entries_one_opening
savings_entries_pkey
savings_entries_reversed_by_entry_id_key
savings_entries_reverses_entry_id_key
savings_entries_supersedes_entry_id_key
transactions_savings_void_request_key
```

All11 new trigger attachments; existing attachments retained:

```text
budget_operation_items.budget_operation_items_savings_reconciled
categories.categories_savings_role_guard
loan_payments.loan_payments_savings_link_guard
savings_accounts.savings_accounts_reconciled
savings_accounts.savings_accounts_validate
savings_entries.savings_entries_immutable
savings_entries.savings_entries_reconciled
transaction_items.savings_transaction_items_guard
transaction_items.savings_transaction_items_reconciled
transactions.savings_transactions_guard
transactions.savings_transactions_reconciled
```

Added constraint names (75, including deferred constraint-trigger catalog entries):

```text
budget_operation_items.budget_operation_items_savings_event_id_fkey
budget_operation_items.budget_operation_items_savings_reconciled
budget_unused_balance_policies.budget_unused_balance_policies_savings_account_id_fkey
budget_unused_balance_policies.budget_unused_savings_destination
categories.categories_savings_role_check
savings_accounts.savings_accounts_annual_interest_rate_check
savings_accounts.savings_accounts_check
savings_accounts.savings_accounts_check1
savings_accounts.savings_accounts_check2
savings_accounts.savings_accounts_check3
savings_accounts.savings_accounts_check4
savings_accounts.savings_accounts_check5
savings_accounts.savings_accounts_check6
savings_accounts.savings_accounts_check7
savings_accounts.savings_accounts_check8
savings_accounts.savings_accounts_creation_fingerprint_check
savings_accounts.savings_accounts_creation_request_key_key
savings_accounts.savings_accounts_currency_code_check
savings_accounts.savings_accounts_default_payment_source_id_fkey
savings_accounts.savings_accounts_institution_name_check
savings_accounts.savings_accounts_liquidity_notes_check
savings_accounts.savings_accounts_monthly_amount_check
savings_accounts.savings_accounts_monthly_day_check
savings_accounts.savings_accounts_name_check
savings_accounts.savings_accounts_notes_check
savings_accounts.savings_accounts_pkey
savings_accounts.savings_accounts_plan_revision_check
savings_accounts.savings_accounts_product_name_check
savings_accounts.savings_accounts_purpose_check
savings_accounts.savings_accounts_reconciled
savings_accounts.savings_accounts_reference_check
savings_accounts.savings_accounts_revision_check
savings_accounts.savings_accounts_status_check
savings_accounts.savings_accounts_target_amount_check
savings_accounts.savings_accounts_terms_check
savings_entries.savings_entries_account_id_fkey
savings_entries.savings_entries_amount_check
savings_entries.savings_entries_cash_category_id_fkey
savings_entries.savings_entries_cash_movement_type_check
savings_entries.savings_entries_cash_payment_source_id_fkey
savings_entries.savings_entries_check
savings_entries.savings_entries_check1
savings_entries.savings_entries_check10
savings_entries.savings_entries_check11
savings_entries.savings_entries_check12
savings_entries.savings_entries_check2
savings_entries.savings_entries_check3
savings_entries.savings_entries_check4
savings_entries.savings_entries_check5
savings_entries.savings_entries_check6
savings_entries.savings_entries_check7
savings_entries.savings_entries_check8
savings_entries.savings_entries_check9
savings_entries.savings_entries_command_fingerprint_check
savings_entries.savings_entries_command_id_command_index_key
savings_entries.savings_entries_command_index_check
savings_entries.savings_entries_command_kind_check
savings_entries.savings_entries_entry_action_check
savings_entries.savings_entries_event_kind_check
savings_entries.savings_entries_occurrence_root_id_fkey
savings_entries.savings_entries_pkey
savings_entries.savings_entries_plan_revision_check
savings_entries.savings_entries_reason_check
savings_entries.savings_entries_reconciled
savings_entries.savings_entries_reversed_by_entry_id_fkey
savings_entries.savings_entries_reversed_by_entry_id_key
savings_entries.savings_entries_reverses_entry_id_fkey
savings_entries.savings_entries_reverses_entry_id_key
savings_entries.savings_entries_source_kind_check
savings_entries.savings_entries_supersedes_entry_id_fkey
savings_entries.savings_entries_supersedes_entry_id_key
savings_entries.savings_entries_transaction_id_fkey
transaction_items.savings_transaction_items_reconciled
transactions.savings_transactions_reconciled
transactions.transactions_savings_void_receipt
```

Five replaced existing CHECKs:

```text
budget_operation_items.budget_operation_items_item_kind_check
budget_operations.budget_operations_operation_type_check
budget_savings_entries.budget_savings_entries_entry_kind_check
budget_savings_entries.budget_savings_entries_provenance_shape
budget_unused_balance_policies.budget_carryover_settings_policy_check
```

Exact definitions are in immutable030–035 and the rehearsed full_schema.sql; restore comparison covers definitions, not just names. RLS is enabled on both new tables, with no new permissive policies. PUBLIC/anon/authenticated/service_role receive no direct Savings-table/sequence privileges; only service_role SELECT on the summary. Public Savings RPCs, both Budget overloads and extended readers grant service_role EXECUTE only. The read-only budget_actual_transactions exception supports direct Budget view reads; the other ten helpers have no API-role EXECUTE. SECURITY DEFINER boundaries pin pg_catalog/public/pg_temp; transactions_page remains INVOKER. Schema public CREATE is revoked from PUBLIC/anon/authenticated/service_role. Existing transaction UPDATE grants are narrowed to ordinary columns, preserving legitimate updates while withholding all four void columns. No Loan grants are rewritten. Catalogue comparisons use effective default ACLs and preserve existing function ACLs.

Migration file SHA-256 (verify before execution):

| File | SHA-256 |
| --- | --- |
| 030_savings_foundation.sql | bd5aedc5b607a41ccaf27baeeaa1dd7fc1219b234ef8d59ab2c55f4ef99a521b |
| 031_savings_manual_transactions.sql | 14aea95828aea2536cbd33d5a00965d0a25560f52fe43ffc740dfb680f64a55a |
| 032_savings_realized_interest.sql | 7667e6160cec51129f6057d2f7c70888181955a666370f90f548c8162275e5f9 |
| 033_savings_funded_surplus.sql | 17a407e3747b4ec174c2b8dd60aaa019e82f967f32b136ca05d9d6c5e623907c |
| 034_savings_monthly_deposits.sql | 850cbb7ed5b003f30b8d539d515c79e040e71f783213131af3b005836b4c6a5b |
| 035_savings_reporting.sql | 45efa22802c9dbbd2031589181020c47ddfce576d96500a7ca6efe6758be32f3 |

### Complete local Savings change inventory

110 intended release files relative to the pre-Savings HEAD, including pre-existing authorized SAV-01–07 work. The only unrelated modified file is `docs/github-development-standard.md`, excluded and byte-preserved. TaskCard/taskController changes are Savings cancelled-history reader compatibility, and the external-API test preserves cancelled external identity; these are required Savings release changes, not repository-cleanup work. The five package/lockfiles contain only the authorized seven version-field changes; dependency metadata is unchanged. Review selectively; do not stage the entire dirty tree blindly.

```text
CHANGELOG.md
README.md
client/package-lock.json
client/package.json
client/src/App.jsx
client/src/components/SavingsReport.css
client/src/components/SavingsReport.jsx
client/src/components/SavingsReport.test.jsx
client/src/components/shell/navigation.js
client/src/components/shell/navigation.test.js
client/src/components/ui/Button.jsx
client/src/hooks/useTransactionForm.js
client/src/pages/AddTransaction/AddTransaction.jsx
client/src/pages/AddTransaction/AddTransaction.test.jsx
client/src/pages/AddTransaction/SavingsTransaction.test.jsx
client/src/pages/AnnualSummary/AnnualSummary.jsx
client/src/pages/AnnualSummary/AnnualSummary.test.jsx
client/src/pages/Budget/Budget.jsx
client/src/pages/Budget/Budget.test.jsx
client/src/pages/Budget/BudgetSavingsTransfers.jsx
client/src/pages/Budget/BudgetSavingsTransfers.test.jsx
client/src/pages/Budget/BudgetStates.jsx
client/src/pages/Budget/BudgetSummary.jsx
client/src/pages/Dashboard/Dashboard.jsx
client/src/pages/Dashboard/Dashboard.test.jsx
client/src/pages/Dashboard/DashboardSections.jsx
client/src/pages/Savings/Savings.css
client/src/pages/Savings/Savings.jsx
client/src/pages/Savings/Savings.test.jsx
client/src/pages/Savings/SavingsAccountDialog.jsx
client/src/pages/Savings/SavingsInterestDialog.jsx
client/src/pages/Savings/SavingsInterestDialog.test.jsx
client/src/pages/Savings/SavingsMonthlyDialog.jsx
client/src/pages/Savings/SavingsMonthlyDialog.test.jsx
client/src/pages/Savings/savingsForm.js
client/src/pages/Settings/BudgetSettingsTab.jsx
client/src/pages/Settings/Settings.test.jsx
client/src/pages/Tasks/TaskCard.jsx
client/src/pages/Transactions/Transactions.css
client/src/pages/Transactions/Transactions.jsx
client/src/pages/Transactions/Transactions.test.jsx
client/src/pages/Transactions/TransactionsFilters.jsx
client/src/pages/Transactions/TransactionsList.jsx
client/src/services/api.js
client/src/utils/financeInvalidation.js
client/src/utils/savingsReporting.js
docs/ARCHITECTURE.md
docs/DECISIONS.md
docs/MIGRATION_030_PRODUCTION_POSTFLIGHT.sql
docs/MIGRATION_030_PRODUCTION_PREFLIGHT.sql
docs/MIGRATION_031_PRODUCTION_POSTFLIGHT.sql
docs/MIGRATION_031_PRODUCTION_PREFLIGHT.sql
docs/MIGRATION_032_PRODUCTION_POSTFLIGHT.sql
docs/MIGRATION_032_PRODUCTION_PREFLIGHT.sql
docs/MIGRATION_033_PRODUCTION_POSTFLIGHT.sql
docs/MIGRATION_033_PRODUCTION_PREFLIGHT.sql
docs/MIGRATION_034_PRODUCTION_POSTFLIGHT.sql
docs/MIGRATION_034_PRODUCTION_PREFLIGHT.sql
docs/MIGRATION_035_PRODUCTION_POSTFLIGHT.sql
docs/MIGRATION_035_PRODUCTION_PREFLIGHT.sql
docs/PROJECT_STATUS.md
docs/RELEASE_1_3_0.md
docs/ROADMAP.md
docs/SAVINGS_FOUNDATION.md
docs/SAVINGS_RELEASE_POSTFLIGHT.sql
docs/SAVINGS_V1_3_0_SPEC.md
package.json
server/controllers/budgetController.js
server/controllers/importController.js
server/controllers/savingsController.js
server/controllers/savingsJobController.js
server/controllers/settingsController.js
server/controllers/shoppingController.js
server/controllers/taskController.js
server/controllers/transactionController.js
server/controllers/v1/transactionController.js
server/full_schema.sql
server/index.js
server/middleware/savingsJobAuth.js
server/migrations/030_savings_foundation.sql
server/migrations/031_savings_manual_transactions.sql
server/migrations/032_savings_realized_interest.sql
server/migrations/033_savings_funded_surplus.sql
server/migrations/034_savings_monthly_deposits.sql
server/migrations/035_savings_reporting.sql
server/package-lock.json
server/package.json
server/routes/internalJobRoutes.js
server/routes/savingsRoutes.js
server/services/budgetService.js
server/services/dueSavingsDepositService.js
server/services/savingsService.js
server/services/savingsTransactionService.js
server/test/budgetController.test.js
server/test/dueSavingsDeposits.test.js
server/test/externalTransactionContract.test.js
server/test/run-savings-release.cjs
server/test/savingsAccounts.test.js
server/test/savingsInterestPostgres.local.test.js
server/test/savingsManualPostgres.local.test.js
server/test/savingsMonthlyPostgres.local.test.js
server/test/savingsPostgres.local.test.js
server/test/savingsReleasePostgres.local.test.js
server/test/savingsReportingPostgres.local.test.js
server/test/savingsSurplus.test.js
server/test/savingsSurplusPostgres.local.test.js
server/test/savingsTransactions.test.js
server/test/shoppingListFields.test.js
server/test/transactionLoanPayments.test.js
server/test/transactionsPagination.test.js
```
