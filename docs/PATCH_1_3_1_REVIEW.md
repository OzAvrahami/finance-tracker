# v1.3.1 prepared release review: #49, #51, #47

**Owner acceptance: Accepted on 2026-09-18.** The owner explicitly stated:
“The owner has explicitly accepted all three fixes: #49, #51, and #47.”
This includes the related #51 bigint Savings-ID correction. No repeat acceptance
is required. This statement does not establish additional device, browser,
authenticated-backend or production tests. The limitations below remain evidence
limitations, not an outstanding request for manual acceptance.

Acceptance and finalized preparation gates are recorded on
[#49](https://github.com/OzAvrahami/finance-tracker/issues/49#issuecomment-5731462320),
[#51](https://github.com/OzAvrahami/finance-tracker/issues/51#issuecomment-5731462670)
and [#47](https://github.com/OzAvrahami/finance-tracker/issues/47#issuecomment-5731463014).

**Finalized candidate:** one Patch release, **v1.3.1**, containing only **#49,
#51 and #47**, coordinated by existing #49. Temporary preview-harness repairs
are outside the product release and commit. Preparation is authorized; commit,
push, merge, deployment, annotated tagging and publication have not occurred.

Implemented on `fix/transaction-budget-patch-49-51-47` from clean main
`aa6a18a48fc4017448f1c1b482a7b8d08c8a4e41`. The preceding published release is
[v1.3.0](https://github.com/OzAvrahami/finance-tracker/releases/tag/v1.3.0)
(2026-09-15). Historical preparation notes are not its current publication state.
Owner acceptance, commits, release preparation and publication remain separate.

Implementation handoffs were recorded on [#49](https://github.com/OzAvrahami/finance-tracker/issues/49#issuecomment-5727471085),
[#51](https://github.com/OzAvrahami/finance-tracker/issues/51#issuecomment-5727472299)
and [#47](https://github.com/OzAvrahami/finance-tracker/issues/47#issuecomment-5727473503).
Independent Issue and Project readbacks confirm **Open / Verify** for all three.
Priority **P2**, labels, assignments, milestone absence and relationships were
preserved; unrelated Project items were unchanged.

## Changes and review inventory

| Issue | Root cause and correction | Files |
| --- | --- | --- |
| [#49](https://github.com/OzAvrahami/finance-tracker/issues/49) | The absolute popup lived inside the form card's stacking context; the outer popup owned overflow without viewport placement, pointer-down cancellation impeded touch, and keyboard navigation did not reveal the active option. Portal the popup outside the cards, bound/flip it within the visible viewport, give the listbox sole scroll ownership, contain scroll chaining, permit native touch panning, and reveal options by changing only list scroll position. | `client/src/components/CategoryCombobox.jsx`, `.css`, `.test.jsx` |
| [#51](https://github.com/OzAvrahami/finance-tracker/issues/51) | UI changes existed only in component state and edit/return links discarded them. Make criteria URL-addressable and carry a validated snapshot on both desktop and mobile edit links; Save, Cancel and Back use the same destination. | `client/src/utils/transactionsNavigation.js`; `client/src/pages/Transactions/Transactions.jsx`, `TransactionsList.jsx`, `Transactions.test.jsx`, `TransactionsRoundTrip.test.jsx`; `client/src/hooks/useTransactionForm.js`; `client/src/pages/AddTransaction/AddTransaction.jsx` |
| [#47](https://github.com/OzAvrahami/finance-tracker/issues/47) | Separate deficit and unbudgeted dialogs had diverged. Share the existing compact source selector and contextual preview while choosing the operation explicitly: deficit uses `{legs}` and deficit endpoints; upper allocation uses `{requested_amount, legs}` and unbudgeted endpoints. Preserve exact-money validation, availability/lifecycle checks, preview fingerprints, receipt retries and duplicate guards. | `client/src/pages/Budget/BudgetFundingActions.jsx`, `Budget.test.jsx`, `BudgetAllocation.test.jsx`; `server/test/fundedBudgetPostgres.local.test.js`, `server/test/savingsReleasePostgres.local.test.js` |

Shared records: [CHANGELOG.md](../CHANGELOG.md) and this review document. The initial
working tree and index were clean; there were no pre-existing edits to separate.
No backend implementation, schema, migrations or financial formulas changed.
Release preparation additionally updates the five package/lockfiles, README,
the canonical inventory, concise release notes and the AGENTS.md review preference.
All implementation work already present at preparation time is preserved.

## Transactions return contract

- `/transactions` query parameters own the visible criteria. UI edits replace the
  current URL; only the API search value is debounced. Edit captures the visible
  search text even before that debounce completes.
- Existing `month`, `categoryId` and `uncategorized=1` links remain supported.
  Carried context uses concrete `from`/`to` dates; empty values mean unbounded.
  It also includes category, uncategorized, payment source, search, supported sort
  field/direction, and the existing Savings account/flow filters.
- `/edit-transaction/:id?returnTo=<encoded /transactions?...>` survives refresh,
  copying the edit URL and opening it in another tab. The validator accepts only
  the exact Transactions route and recognized criteria. It rejects arbitrary
  routes/URLs, hashes, duplicate criteria, invalid IDs/dates/date order, unknown
  sort/flow values and search outside the API's 200-character trimmed limit.
  Invalid or absent context returns to `/transactions` with normal defaults.
- Save, Cancel and the editor Back link share this contract. Ordinary creation
  retains its existing behavior; an Add URL cannot adopt an edit return context.
- Returning remounts the list and requests a fresh first batch (100 rows) and
  totals with the original criteria. Accumulated rows, keyset cursors, loading
  state and scroll position are not carried. A saved row may move or disappear
  from the restored view; Load more obtains new cursors from the new results.
- No storage-backed/global preferences were added. #50 remains separate: its
  future typed Budget context can extend the validator/serializer and travel
  through this one return contract. Arbitrary origin metadata is not trusted;
  this patch does not add a Budget banner, destination or contextual workflow.

## Verification

- Focused frontend suites: **187 tests across eight files passed**, including
  CategoryCombobox, AddTransaction, Transactions, real MemoryRouter round trips,
  Budget/allocation, Savings transaction entry and Budget Savings transfers.
  The focused schema follow-up below added four route cases: **191 distinct
  frontend cases have now passed across these suites**. The full set was not
  rerun; only the changed route suite (19 tests), lint and build were rerun.
- The original 15 route tests fix the clock to September 2026, select August through the
  UI, and cover Save/Cancel/Back, pending search, custom/unbounded dates, fresh
  results, changed filter membership, old-page/cursor disposal, editor refresh,
  malformed context and same-component URL changes. Only the API is mocked.
- Budget controller suite: **34 passed**. Disposable PostgreSQL: **four focused
  cases passed**, covering consolidated operation types, partial/exact allocation,
  stale/insufficient funding and the new 400/530/130 regression. The latter checks
  read-only preview, 50 + 80 partial coverage, idempotent retries, separate upper
  allocation and unchanged transaction count/total and actual spending.
  These initial checks used the Budget foundation through migration 028. The
  follow-up below closes that schema gap for the affected allocation operations.
- Chromium checked actual page components/routes with synthetic in-memory API
  fixtures, at **1440×844 and 390×844**, in **dark/light Hebrew RTL**: popup bounds
  and hit-testing over form cards, wheel/keyboard scrolling without page movement,
  selection/dismissal, all three August returns, and both allocation entry points.
  A real-card component fixture additionally checked native Chromium emulated
  touch panning. Budget keyboard opening, Tab containment, Escape and focus return,
  plus keyboard edit/cancel, passed at both widths. Screenshots were inspected.
- Client lint, production build and `git diff --check` passed. Build retains its
  warning about a bundle larger than 500 kB. All seven inventoried version values
  were `1.3.0` during implementation verification; the authorized preparation step
  below synchronizes them to `1.3.1`. UTF-8 and local links were checked.

The integrated Browser tool reported no available browser, so browser checks used
an isolated standalone Chromium instance. They do not establish physical
trackpad/phone behavior, Safari/Firefox behavior, virtual-keyboard behavior or a
live authenticated backend round trip. Owner acceptance is now explicit, while
these additional checks remain unperformed evidence limitations. No
production service was accessed. Docker initially needed starting; all selected
local SQL checks subsequently passed and their disposable containers were removed.

### Focused v1.3.0 schema follow-up

The additional regression in `server/test/savingsReleasePostgres.local.test.js`
passed: **one test with two independently seeded database scenarios** (full and
partial coverage). It reused the existing disposable release harness; no other
release rehearsal or already-passed database/frontend suite was rerun.

**Exact schema baseline:** the consolidated `server/full_schema.sql` prefix
through 029, followed by the actual migrations `030_savings_foundation.sql`,
`031_savings_manual_transactions.sql`, `032_savings_realized_interest.sql`,
`033_savings_funded_surplus.sql`, `034_savings_monthly_deposits.sql` and
`035_savings_reporting.sql`, applied in order. This is the complete final v1.3.0
schema, not the minimal 028 test fixture. The test compares the resulting public
catalog (functions, views, constraints, triggers, indexes, columns, policies and
ACLs) with a separate clean database loaded from the full 035 schema; they match.
It does not claim to replay 001–029 individually from an empty database.
`git diff v1.3.0 -- server/full_schema.sql server/migrations` was empty, confirming
these definitions match the released tag. The full-schema file SHA-256 is
`b47c29eab19cf03333a0456c4d194c8c87ad710c010b2e9b6177fa36077a3891`.

The run used disposable `postgres:16-alpine` container
`finance-sav08-release-39204`, with no published ports and no `.env`/production
credentials. Its databases were `issue47_schema035`, `issue47_full035` and
`issue47_partial035`, alongside the harness's 029 and clean-035 comparison
databases. The container was removed after verification. Machine-local JSON
evidence, including all six migration hashes, catalog-equivalence proof and
before/after values, is retained outside the repository at
`C:\Users\ozavr\AppData\Local\Temp\finance-sav08-release-m2vCnR`.

Migration interaction review:

| Migration | Interaction with the two allocation entry points |
| --- | --- |
| 029 | Optional shopping-list fields only; no allocation dependency. Included in the consolidated baseline. |
| 030 | Introduces named Savings accounts/entries, voided-cash handling and explicit retirement of overlapping legacy reserve. Replaces both allocation previews, funding-source readers, Budget actual readers/composition and operation validators. `source_kind: savings` still means the legacy Budget reserve, not a named account balance. |
| 031 | Manual Savings cash creation/correction/cancellation and linked transaction guards affect the cash consumed by the Budget actual reader. It does not replace the allocation apply RPCs. |
| 032 | Realized interest extends the Savings event engine: paid-out interest is income, capitalized interest has no cash transaction. Neither becomes a deficit funding source automatically. |
| 033 | Changes Budget composition, operation validation and monthly reads; funded Savings surplus has matching funding/allocation postings and cash provenance. The actual reader excludes that transfer cash from envelope spending to avoid double consumption. Both allocation previews use this reader indirectly. |
| 034 | Monthly Savings occurrences extend account/event logic; no new allocation endpoint or automatic use of named account balances. |
| 035 | Replaces transaction reporting signatures and adds Savings aggregates; read-only changes. Final definitions/ACLs are included in the catalog comparison. |

The test invokes the **actual RPCs mapped by the existing service layer** as
`service_role`: `get_budget_deficit_resolution_preview` /
`apply_budget_deficit_resolution` with legs, and
`get_budget_unbudgeted_resolution_preview` / `apply_budget_unbudgeted_resolution`
with requested amount and legs. It does not substitute mocked accounting.

- Both scenarios start with funding **400**, actual spending **530**, deficit
  **130**. Full mixed-source coverage adds **130** once; partial coverage adds
  **50**, then **80**. The intermediate state is **450 / 530 / 80** and the final
  state is **530 / 530 / 0**. Every receipt retry leaves all financial rows unchanged.
- Sources cover unallocated funds, a positive-balance category and legacy reserve.
  An explicit opening overlap reduces legacy reserve from **500 to 300**, while
  opening a named account at **1000**. A valid preceding 033 surplus transfer of
  **20** raises the named account to **1020** and lowers the source category's
  available capacity to **180**. Its known cash row is created **before** the
  allocation checks; Budget actuals exclude it correctly.
- After deficit coverage, source-category capacity is **130**, legacy reserve
  **270**, unallocated **251**, total available **1011**, allocated **760**.
  The extra **1** in unallocated funding is an intentional stale-preview fixture:
  applying the old fingerprint fails atomically, then a fresh preview succeeds.
- The upper entry point allocates **75** to a previously unbudgeted category via
  its separate operation. Source-category capacity becomes **105**, reserve
  **245**, unallocated **226**, available **1036**, allocated **810**. Its category
  ends at **75 funded / 75 actual / 0 deficit**. Reconciliation succeeds.
- Full database-row comparisons show **no transaction insert/update/delete and
  no named Savings-entry change** from either allocation. Deficit spending stays
  **530**, total Budget actuals stay **705**, and the named account stays **1020**.
  Read-only preview/cancellation, an insufficient category-source preview, stale
  apply rejection and distinct operation types are also asserted.

No #47 runtime regression was found. Schema inspection did expose a directly
related **#51 validator regression**: Savings account IDs were incorrectly treated
as UUIDs, although the released schema/API uses positive bigint strings. A new
route test failed with the filter resetting to `all`; the validator now preserves
exact positive PostgreSQL bigint IDs. New cases cover ordinary IDs, IDs beyond
JavaScript's safe-integer range, rejection above the bigint limit and UUID
rejection. The revised **19 route tests**, lint and build passed. Only
`transactionsNavigation.js`, its route regression suite, the SQL release test
and this review document changed during this follow-up.

These are **real database checks**, separate from the earlier **synthetic browser
preview**. They verify final-schema RPC/accounting behavior, not an authenticated
browser-to-API end-to-end session. Owner acceptance is now Accepted; no additional
manual/device test execution is inferred from it.

Run just the new database check:

```powershell
node --test --test-name-pattern='issue 47 allocation contracts' server/test/savingsReleasePostgres.local.test.js
```

### Reproduce automated checks

Run from the repository root (PowerShell):

```powershell
npm.cmd --prefix client test -- src/components/CategoryCombobox.test.jsx src/pages/AddTransaction/AddTransaction.test.jsx src/pages/AddTransaction/SavingsTransaction.test.jsx src/pages/Transactions/Transactions.test.jsx src/pages/Transactions/TransactionsRoundTrip.test.jsx src/pages/Budget/Budget.test.jsx src/pages/Budget/BudgetAllocation.test.jsx src/pages/Budget/BudgetSavingsTransfers.test.jsx
npm.cmd --prefix client run lint
npm.cmd --prefix client run build
node --test server/test/budgetController.test.js
node --test --test-name-pattern='issue 47 compact allocation|post-cleanup override, reallocation, deficit|migration 028 preserves partial/exact|migration 028 rejects insufficient' server/test/fundedBudgetPostgres.local.test.js
git diff --check
```

The explicit `.local.test.js` command requires Docker and creates only its own
disposable PostgreSQL fixture. It does not read production database credentials.

## Local preview and owner acceptance

The owner prefers the **normal application running locally with its frontend and
backend** for future reviews. This preference is also recorded in root AGENTS.md.
Do not build another synthetic preview or turn this release into environment
setup. The commands/checklist below are retained as reference, not a request to
repeat acceptance or a claim that a local authenticated test was performed.

For the normal authenticated application, use the existing development-only
configuration described in [README.md](../README.md#environment-configuration),
pointing at a development database. In separate PowerShell terminals:

```powershell
Set-Location D:\code\finance-tracker
npm.cmd --prefix server run dev
```

```powershell
Set-Location D:\code\finance-tracker
npm.cmd --prefix client run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Use the normal application's configured local origin (`http://localhost:5173`
in the existing API CORS allowlist). The temporary synthetic preview previously
used for evidence is not the owner's preferred future review environment. Its
root redirect and report-mock repairs stayed outside the repository and are not
product changes or part of this release commit.

1. **#49:** Open Add Transaction with a long category list. Scroll with wheel,
   trackpad and a touch device, including near viewport edges. Try arrows,
   Home/End, search, selection, creation and dismissal. Confirm the page stays
   still while the list scrolls and the selected value survives dismissal.
2. **#51:** With September 2026 as the clock month, select August in Transactions,
   set category/payment/search/sort, edit a row and repeat separately for Save,
   Cancel and Back. Confirm August and every criterion remain. Change a saved
   row's date outside August and confirm fresh results exclude it. Try custom
   and cleared ranges and refreshing/copying the edit URL.
3. **#47:** In a permitted month use a category funded 400 with spending 530.
   Open deficit resolution: month/category, funding/spending/deficit and suggested
   130 must be correct. Confirm preview 530/0 and apply; spending stays 530,
   available source balances and summaries refresh. Also try partial 50, cancel,
   another funding source, and the upper unbudgeted allocation entry point.
4. Repeat the relevant flows in both themes, desktop/mobile and keyboard-only.

## Release / Version gate

- Release impact: **Yes** for all three Issues — corrections to released behavior.
- SemVer impact: **Patch** for each; backward-compatible fixes, no new product capability.
- Candidate release: **v1.3.1 finalized**, relative to published v1.3.0, by explicit owner instruction.
- Grouping / included release candidate: Existing [#49](https://github.com/OzAvrahami/finance-tracker/issues/49) coordinates **#49, #51, #47**. Highest applicable impact: Patch. No new milestone or tracker.
- CHANGELOG status: **Finalized in [1.3.1] — Prepared (unpublished)** in [CHANGELOG.md](../CHANGELOG.md); only the three candidate entries moved, Unreleased retained. [Release notes](RELEASE_1_3_1.md) prepared.
- Version-bump status: **Synchronized — 1.3.1**, all seven authoritative fields across five files verified; dependency trees and unrelated metadata unchanged. No root lockfile created.
- Publication status: **Deferred** to the owner's separate release step tracked on #49. No new tag/Release; published v1.3.0 remains unchanged.
- Owner verification / acceptance status: **Accepted** for #49, #51 and #47 by the explicit owner statement recorded above, including the #51 bigint correction. No additional tests or production acceptance are implied.

The [canonical policy](github-development-standard.md#release--version-gate)
governs this gate. Implementation, automated checks, owner acceptance, candidate
finalization, coordinated version synchronization, owner commit/push, annotated
tag and published GitHub Release remain distinct. A tag alone is not publication.

## Preparation verification and transfer path

Only version metadata and documentation changed during this preparation step.
Existing implementation/test files were compared with their starting SHA-256
values and remain byte-identical. Existing test/build evidence is reused; no
application, database or browser suite was rerun for documentation/version-only
changes. The seven JSON values, full JSON equality after removing those version
fields, historical changelog preservation, release-note scope, UTF-8, local links,
the reviewed file inventory and `git diff --check` pass. The initial empty index
is unchanged. No migration is required for v1.3.1.

| File | Verified prepared fields |
| --- | --- |
| `package.json` | `version = 1.3.1` |
| `client/package.json` | `version = 1.3.1` |
| `client/package-lock.json` | `version = 1.3.1`, `packages[""].version = 1.3.1` |
| `server/package.json` | `version = 1.3.1` |
| `server/package-lock.json` | `version = 1.3.1`, `packages[""].version = 1.3.1` |

Commit locally on `fix/transaction-budget-patch-49-51-47` using the exact allowlist
below. Then the owner can transfer the reviewed commit through a branch push and
PR to main, or a local fast-forward merge into current main followed by a main
push. Fetch/review the latest remote state before choosing the path; do not force
a merge or push if main has advanced. At preparation readback, remote main and
local HEAD were both `aa6a18a48fc4017448f1c1b482a7b8d08c8a4e41`.

**Deployment evidence:** GitHub records Vercel **Production** and Railway
**finance-tracker / production** deployments for that main SHA, with successful
commit statuses. The same SHA also has a Vercel Preview deployment. The only
tracked GitHub Actions workflow is the scheduled/manual loan job; it has no push
trigger. `client/vercel.json` supplies only the SPA rewrite. Provider branch
filters, automatic deployment settings and whether a task-branch push will
deploy are not established by these files/records. Treat a branch push as
potentially deployment-triggering and a merge/push to main as likely to trigger
production through the provider integrations. Confirm those settings before
the owner executes transfer. No provider settings were accessed or changed.

After transfer, independently verify the remote SHA and required deployment
completion before closing the Issues/moving Done. Owner acceptance is already
recorded and must not be requested again. Keep all three Open / Verify until
those remaining conditions are met. Annotated tagging and GitHub Release
publication are a later separately authorized step tracked on #49.

## Exact owner commit allowlist

The 26 files below include the accepted implementation, regression coverage and
coordinated release documentation/metadata. Temporary preview files are excluded.
These commands are for the owner; the agent has not staged or committed anything.
The index guard protects any staging added after this handoff.

```powershell
Set-Location D:\code\finance-tracker
if ((git branch --show-current) -ne 'fix/transaction-budget-patch-49-51-47') { throw 'Unexpected branch' }
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { throw 'Index is not empty; review existing staging first.' }
$releaseFiles = @(
  'AGENTS.md'
  'CHANGELOG.md'
  'README.md'
  'package.json'
  'client/package.json'
  'client/package-lock.json'
  'server/package.json'
  'server/package-lock.json'
  'docs/github-development-standard.md'
  'docs/PATCH_1_3_1_REVIEW.md'
  'docs/RELEASE_1_3_1.md'
  'client/src/components/CategoryCombobox.css'
  'client/src/components/CategoryCombobox.jsx'
  'client/src/components/CategoryCombobox.test.jsx'
  'client/src/hooks/useTransactionForm.js'
  'client/src/pages/AddTransaction/AddTransaction.jsx'
  'client/src/pages/Budget/Budget.test.jsx'
  'client/src/pages/Budget/BudgetFundingActions.jsx'
  'client/src/pages/Budget/BudgetAllocation.test.jsx'
  'client/src/pages/Transactions/Transactions.jsx'
  'client/src/pages/Transactions/Transactions.test.jsx'
  'client/src/pages/Transactions/TransactionsList.jsx'
  'client/src/pages/Transactions/TransactionsRoundTrip.test.jsx'
  'client/src/utils/transactionsNavigation.js'
  'server/test/fundedBudgetPostgres.local.test.js'
  'server/test/savingsReleasePostgres.local.test.js'
)
git add -- $releaseFiles
if ($LASTEXITCODE -ne 0) { throw 'Staging failed' }
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'Whitespace check failed' }
git diff --cached --stat
git diff --cached
git commit -m 'fix: prepare v1.3.1 transaction and budget fixes'
```
