# Finance Tracker v1.8.0 candidate — prepared, unpublished

Prepared on **2026-10-29**, under explicit owner authorization for **release
preparation only**, using Strategy A on current `main`. Baseline HEAD and remote
main: `d610a31c47a6bd3d2a0ed4031cd21e07e151e3fc`. This is a preparation date,
not publication. No staging, commit, push, tag, release publication, deployment,
production SQL, configuration change or Issue/Project update is part of this work.

The latest published GitHub Release was independently read back on 2026-10-29:
[v1.7.0](https://github.com/OzAvrahami/finance-tracker/releases/tag/v1.7.0), published
2026-10-17, non-draft, non-prerelease, returned by Latest; its annotated tag targets
`1da80871f57354f6429358d37e97b0517d1efaf3`. The older preparation records remain
historical. v1.8.0 has not been published.

## Finalized candidate membership and acceptance

The complete five-commit increment since v1.7.0 is included. Candidate membership
is owner-approved; this does not turn pending feature acceptance into acceptance.

| Commit | Scope | Individual impact | Acceptance |
| --- | --- | --- | --- |
| `2db1200` | #96 general single/batch transaction contract, durable receipts, guarded owner resolution, migrations 052/053 and shared ingestion compatibility | Minor | Implemented and deployed; full owner acceptance and live producer activation pending |
| `12f2c8f` | GitHub language statistics excludes migration SQL/full schema | None | Repository maintenance; no product impact |
| `0191c14` | Shopping suggestions/popups/cache and authentication startup recovery | Patch | Accepted for local loading and Shopping behavior actually reviewed |
| `d8f5f83` | #100 Sold lifecycle, Active/Sold/All views, active-only summaries and same-UUID manual return | Minor | Accepted |
| `d610a31` | #101 saved-purchase repurchase offers, explicit same-UUID confirmation and replacement acquisition/link details | Minor | Accepted |

Combined impact is **Minor**, hence v1.8.0. Existing coordination remains on
[#100](https://github.com/OzAvrahami/finance-tracker/issues/100) and
[#101](https://github.com/OzAvrahami/finance-tracker/issues/101); this record documents
the expanded owner-selected membership without creating a new Issue or milestone.
[#96](https://github.com/OzAvrahami/finance-tracker/issues/96) stays open until its
separate acceptance criteria are explicitly satisfied. #100/#101 remain completed.

### Accepted behavior

- #100 preserves sold records and acquisition details, excludes them from collection
  summaries and supports an explicit manual return that clears obsolete financial linkage.
- #101 offers return only after a new purchase saves. Confirmation replaces acquisition
  fields and the transaction link atomically, preserves UUID, handles discounts and
  Gift/GWP rules, and rejects stale confirmations. Historical edits never reactivate Sold.
- Shopping fixes clipping and viewport placement and provides immediate scoped cached
  suggestions while bounded searches refresh. Auth startup failures/timeouts expose
  a retry state while retaining access controls and ignoring stale bootstrap responses.
  Recorded acceptance does not imply unperformed mobile/theme/keyboard/touch/performance
  coverage or manually induced authentication failures. See the
  [bounded acceptance record](../operations/SHOPPING_UX.md#combined-bug-fix-owner-acceptance-and-commit-scope-2026-10-18).

### Included #96 capability: deployed, unaccepted and not activated

The explicit `finance.transactions.v1` contract supports single/bounded batch evidence,
strict money/date/status semantics, repeat-safe per-item receipts and owner-only
receipt resolution. Unsupported refunds/FX, uncertain identity/mapping and incomplete
evidence remain held. Owner approval of confirmed billing dates for installments is
policy approval, not complete implementation or producer acceptance.

The recorded producer inspection found missing separate original purchase dates for
installments. Producer evidence projection, exact money/signs, stable identity,
retry acknowledgements and historical cutover agreement remain activation gates.
No complete live CAL/Apple Pay producer acceptance is claimed. See the
[contract](../architecture/GENERAL_TRANSACTION_API.md) and
[migration/recovery runbook](../operations/GENERAL_TRANSACTION_API.md).

Historical unresolved FlowLink/#81/#90 device and real Wallet work is inherited from
the v1.7.0 tree, not a new increment here. Its unrelated entries remain under
Unreleased. Native FlowLink version/build numbers and ingestion flags are unchanged.
Multi-user drafts and other local owner work are outside this preparation.

## Production evidence supplied by the owner

The following findings were explicitly supplied with the 2026-10-29 preparation
authorization. They were **not independently re-probed during this local task**:

- Railway deployment `d610a31`: SUCCESS, single replica, standard Node server startup.
- Railway uses the confirmed Finance Tracker Supabase project.
- Key migration 052/053 functions match deployed definitions; required RLS, triggers
  and privilege boundaries were verified.
- General API registrations: **0**; receipts: **0**; resolutions: **0**.
- No new API producer activation is authorized.

Zero registrations means no general API account is enabled and there are no mapped
accounts for its registration-based legacy-write guard at that checkpoint. Future
registration changes require separate cutover review: even a disabled registration
can block legacy external-ID writes on its mapped account. These findings do not
establish every migration-history detail or complete live ingestion acceptance.
Do not blindly rerun 052/053 or execute `full_schema.sql` against an existing database.
This preparation runs no migrations or production probes.

#101's in-memory offers/locks fit the reported single-replica, standard Node startup
topology. They are not distributed coordination. Multi-worker scaling or overlapping
serving processes during rollout requires explicit review. Offers expire after
15 minutes or process restart, with manual Return as fallback. A push touching root
`package.json` can trigger Railway auto-deployment and restart the API, invalidating
pending offers. No push is authorized by this preparation.

## Backup and recovery decision

**Backup unavailable — owner elected to proceed with release preparation despite the risk.**

The owner reports no configured production backups. Backup and recovery verification
are **not Passed**. This is a bounded decision to proceed with local preparation;
it does not authorize new migrations, destructive database operations, restoration,
configuration changes, deployment or publication, and is not a blanket future waiver.
No backup was created and no restore was initiated.

The #96 runbook's recoverable-backup and verified-recovery prerequisites remain
unsatisfied for future database operations. Once evidence is accepted, recovery must
coordinate the database and producer durable acknowledgement state. No destructive
down migration or deletion of receipt history is an approved recovery procedure.

## Version inventory and local verification

All seven canonical fields are prepared as **1.8.0**:

| File | Fields |
| --- | --- |
| `package.json` | `version` |
| `client/package.json` | `version` |
| `client/package-lock.json` | `version`, `packages[""].version` |
| `server/package.json` | `version` |
| `server/package-lock.json` | `version`, `packages[""].version` |

Only these metadata values change in package files. Dependency versions, lockfile
trees, scripts and other metadata are preserved; no root lockfile is created.
No runtime source, migration, environment or native FlowLink file changes.

Fresh local verification on 2026-10-29:

| Check | Result |
| --- | --- |
| Seven-field consistency and semantic JSON comparison with baseline | Passed; only the seven intended values changed |
| Frontend `npm run lint` | Passed |
| Frontend `npm run build` | Passed; existing >500 kB chunk warning remains |
| Emitted frontend artifact | Contains 1.8.0; Settings imports the client package version |
| Backend focused regressions | **183 passed, 0 failed, 0 skipped**: 167 in the initial focused run plus 16 manual-loan repayment cases in a separate run |
| Frontend focused regressions | **130 passed, 0 failed**, across 10 suites |
| Historical release bodies and three unrelated FlowLink bullets | Unchanged, with line endings normalized for comparison |
| Preservation | All **573** tracked/nonignored files outside the preparation scope and the Git index match starting hashes |
| Documentation | Local file links resolve; all four owner PowerShell blocks parse without execution |
| Whitespace | `git diff --check` passed; new preparation record checked separately |

Backend suites use the existing test setup with fake/static fixtures and loopback
HTTP boundaries, not production persistence. Reproduce their combined coverage from
`server` with:

```text
node --require ./test/setup.js --test test/legoRepurchase.test.js test/legoPurchaseFields.test.js test/legoAcquisitionMigration.test.js test/transactionPricing.test.js test/transactionLoanPayments.test.js test/manualLoanRepayments.test.js test/generalTransactionContract.test.js test/externalTransactionContract.test.js test/transactionIngestion.test.js test/calIngestion.test.js test/applePay.test.js test/reconciliationReview.test.js test/savingsTransactions.test.js test/shoppingQuickEntry.test.js test/shoppingEntryOptions.test.js
```

Frontend command from `client`:

```text
npm test -- src/pages/AddTransaction/AddTransaction.test.jsx src/pages/LegoCollection/LegoCollection.test.jsx src/utils/legoHelpers.test.jsx src/utils/transactionPricing.test.js src/pages/Shopping/ShoppingQuickEntry.test.jsx src/pages/Shopping/shoppingSuggestionCache.test.js src/pages/Shopping/ShoppingSuggestionPopup.test.jsx src/context/AuthContext.test.jsx src/components/ProtectedRoute.test.jsx src/services/api.test.js
```

No failing local test/build or unintended dependency/runtime change was identified.
No database migration/integration suite, live producer, production smoke write,
browser/device acceptance, backup or recovery test was run in this preparation.
Historical PostgreSQL evidence remains historical. Passing mocked regressions does
not establish complete live CAL/Apple Pay compatibility or satisfy #96 acceptance.

## Exact preparation scope and owner commands

The preparation contains **11 files**, listed in the PowerShell block below.
`docs/operations/APY_04_CAL_RECONCILIATION.md`, both `docs/MULTI_USER_*` documents
and `docs/operations/__pycache__/` are excluded and preserved. Never use `git add .`
for this working tree. Review the complete preparation diff before staging.

These commands are **instructions for later owner execution**, not actions taken by
the agent. Run each stage separately in the same PowerShell session and inspect its output. Stop if the baseline,
branch, remote, index or expected file scope differs. No Issue change is required.

```powershell
Set-Location D:\code\finance-tracker
function Invoke-CheckedGit {
    & git @args
    if ($LASTEXITCODE -ne 0) { throw 'Git command failed; stop and inspect.' }
}
$baseline = 'd610a31c47a6bd3d2a0ed4031cd21e07e151e3fc'
$releaseScope = @(
    'package.json'
    'client/package.json'
    'client/package-lock.json'
    'server/package.json'
    'server/package-lock.json'
    'CHANGELOG.md'
    'README.md'
    'docs/README.md'
    'docs/github-development-standard.md'
    'docs/history/README.md'
    'docs/history/RELEASE_1_8_0.md'
)
if ((Invoke-CheckedGit branch --show-current) -ne 'main') { throw 'Wrong branch' }
if ((Invoke-CheckedGit rev-parse HEAD) -ne $baseline) { throw 'Baseline changed' }
if (Invoke-CheckedGit diff --cached --name-only) { throw 'Index is not empty' }
$remoteBefore = Invoke-CheckedGit ls-remote origin refs/heads/main
if (($remoteBefore -split '\s+')[0] -ne $baseline) { throw 'Remote changed' }
Invoke-CheckedGit diff --check
Invoke-CheckedGit diff -- $releaseScope
Get-Content -Encoding UTF8 docs/history/RELEASE_1_8_0.md
```

After reviewing those results, the owner may stage the exact scope and review again:

```powershell
Invoke-CheckedGit add -- $releaseScope
$stagedPaths = @(Invoke-CheckedGit diff --cached --name-only)
if (Compare-Object ($releaseScope | Sort-Object) ($stagedPaths | Sort-Object)) {
    throw 'Unexpected staged scope; stop without resetting unrelated work'
}
Invoke-CheckedGit diff --cached --check
Invoke-CheckedGit diff --cached --stat
Invoke-CheckedGit diff --cached
```

Only after approving the staged diff, commit as a separate owner step:

```powershell
Invoke-CheckedGit commit -m 'chore(release): prepare v1.8.0 candidate'
$releaseCommit = Invoke-CheckedGit rev-parse HEAD
Invoke-CheckedGit show --stat --oneline $releaseCommit
Invoke-CheckedGit status --short
```

**Stop before push.** It can deploy/restart Railway because root `package.json`
changes. The owner must separately authorize that production effect and review
pending #101 confirmations/rollout overlap, the no-backup risk and #96 boundaries.
No migration or activation accompanies the push. When separately authorized:

```powershell
if ((Invoke-CheckedGit branch --show-current) -ne 'main') { throw 'Wrong branch' }
if ((Invoke-CheckedGit rev-parse HEAD) -ne $releaseCommit) { throw 'HEAD changed' }
if ((Invoke-CheckedGit rev-parse 'HEAD^') -ne $baseline) { throw 'Unexpected parent' }
$remoteBeforePush = Invoke-CheckedGit ls-remote origin refs/heads/main
if (($remoteBeforePush -split '\s+')[0] -ne $baseline) { throw 'Remote changed' }
Invoke-CheckedGit push origin main
$remoteAfterPush = Invoke-CheckedGit ls-remote origin refs/heads/main
if (($remoteAfterPush -split '\s+')[0] -ne $releaseCommit) { throw 'Remote verification failed' }
```

Record the actual preparation commit; it does not exist at this checkpoint. Verify
the resulting deployments separately. Do not tag the implementation baseline as if
it contained this preparation. Publication requires a later explicit decision,
reviewed notes and an annotated `v1.8.0` tag targeting the verified preparation commit,
followed by GitHub Release readback (tag target, URL, draft/prerelease and Latest).

## Release / Version gate

- Release impact: **Yes** — product capabilities and corrections in the grouped candidate.
- SemVer impact: **Minor** — #100/#101/#96 are additive capabilities; Shopping/Auth is
  Patch; language statistics maintenance has no product impact.
- Candidate release: **v1.8.0, prepared and unpublished** — owner-authorized local preparation.
- Grouping / included release candidate: **Strategy A: #100 + #101 + #96 + reviewed
  Shopping/Auth + language statistics maintenance**, documented here with existing
  #100/#101 coordination. No scope is silently omitted; Issue metadata is unchanged.
- CHANGELOG status: **Prepared v1.8.0 section**; unrelated Unreleased entries and
  historical release bodies preserved.
- Version-bump status: **Synchronized — seven fields at 1.8.0**; dependencies unchanged.
- Publication status: **Deferred** — owner-controlled, outside this preparation;
  commit/push, deployment and tagging/publication require their separate steps.
- Owner verification / acceptance status: Preparation and membership authorized;
  #100/#101 accepted; Shopping/Auth accepted within recorded scope; **#96 full
  acceptance remains Pending**, as does owner review of the final preparation diff.

Recommendation: proceed with local candidate review after checks pass. Publication
is **not yet authorized or ready**: obtain final owner review and an explicit decision
on shipping #96 with its pending acceptance/disabled capability clearly disclosed,
then complete the separately authorized commit/push/deployment/publication gates.
Full #96 acceptance and producer activation remain separate; keep #96 open meanwhile.
