# Shopping UX and Settings — v1.7.0 candidate review

The owner approved the two-state mockup on 2026-10-16. This approves the design,
not acceptance of the implemented result. Details expand below the compact entry;
there is no permanent sidebar and no new list-type system.

## Behavior and API compatibility

- A name and quantity (default 1) are sufficient. New names are saved to the list
  and reusable catalog on successful submission by default.
  A closed unit selector sits beside quantity, defaulting to **יח׳**.
  Additional details contain optional category, estimated unit price, requirements
  and a checked **להציע את הפריט גם ברשימות הבאות** choice. Uncheck it for a list-only item.
- Suggestions search generic planning/catalog items, not commercial products or
  barcodes. Available scoped matches filter immediately; background searches debounce
  for 250 ms and request 8 results. A bounded 20-item preload starts on entry mount.
  Neither response is a complete catalog; broader/uncached queries still search the
  server. See the 2026-10-18 correction below for cache bounds and verification.
  An explicit new-name option remains available after an empty or failed search.
- Selecting a suggestion retains its catalog ID. Completing a typed prefix is
  allowed; extra typed words remain the list-specific name. Explicit unit/price
  corrections and notes are retained. No quantity or package-content conversion occurs.
- Enter selects an active suggestion without submitting; arrows navigate, Escape
  closes suggestions. With no active suggestion, Enter submits the entered item.
  Success clears item-specific fields and restores name focus; failure retains them.
  Deliberate repeats are separate rows. The pending-request guard prevents double submission.
- `POST /shopping/lists/:id/items` opts into the atomic new contract with
  `entry_mode: "name_first"`. The UI explicitly sends `save_to_catalog: true`
  by default; unchecking sends false. Omitted `save_to_catalog` still defaults false
  in the API contract for compatibility.
  Existing callers without that mode retain legacy automatic catalog reuse/creation.
  Catalog category is derived server-side. Scoped selection rejects unrelated categories.
- `planned_name` is a list-specific override, including for existing catalog rows;
  editing it never renames the catalog, detaches identity or changes barcode mappings.
  Notes remain visible on the checklist. Omitted catalog defaults may be inherited;
  explicit null clears unit/price, and a zero price stays zero in the new contract.
- Checkmarks, receipt review/confirmation and financial checkout retain separate
  effects. Current snapshots include the name override and notes, so corrections
  invalidate receipt review context. Previously frozen plans remain unchanged.

## Migration 050

Apply `server/migrations/050_shopping_quick_entry.sql` after 049, as one transaction,
before the new backend/frontend. Do not rerun an applied migration. This task only
applied it to disposable PostgreSQL and the existing isolated local Shopping stack.
No production application or SQL operation is authorized by this document.

It adds nullable `shopping_list_items.planned_name`, a unique `is_neutral` category
marker and a service-role-only atomic `shopping_add_planned_item` RPC. The neutral
category uses reserved system ID -1 when newly created, leaving positive owner
sequences untouched. If its Hebrew name already exists, that row gains the marker;
its existing ID and relationships are retained. Initial list types are linked in
the migration; later types are linked transactionally on first uncategorized use.
The system category remains usable without owner setup even if marked inactive.
Existing non-null category and catalog/custom-name exclusivity constraints remain.

The transaction creates an explicitly reusable catalog item and the list row together.
A name/category collision returns an actionable error instead of overwriting a
catalog item. Closed-list locking remains active. No historical plan, receipt,
mapping, purchased-state or financial data is rewritten by the migration.

## Review and evidence (2026-10-16)

Normal app: **http://localhost:5173/shopping**, backend **http://localhost:5050**.
The existing process configuration points to the isolated local Supabase stack on
port 55421, PostgreSQL container `supabase_db_finance-shopping92` on port 55422.
Normal owner `.env` files were not changed. Do not restart using those normal files
and assume they target the isolated stack; confirm the target first. The existing
private local startup helper remains under `%TEMP%/finance-shopping95-private`.

Open **בדיקת UX — קניות ומתנות** (synthetic list 6). Try a new gift, type `בדיקת UX`
and select the saved milk suggestion, add 0.5 kg, and enter two packages with package
contents in requirements. Expand/collapse details, verify the checked reuse default,
then uncheck it for a list-only item. Correct a row's name/notes, use checkmarks, and inspect receipt access.
Use this synthetic list for mutations; no purchase confirmation or checkout is
needed to review entry. Try narrow screens, both themes and mixed Hebrew/English.

Verified: mockup visually opened; migration upgrade/fresh-schema and six new
PostgreSQL scenarios passed; normal authenticated local API smoke passed with five
synthetic rows and unchanged transaction count. Existing item/plan contents were
verified preserved when applying 050 locally. UI tests exercise keyboard selection,
focus, repeat entry, pending protection, failed/stale search and optional details.
Receipt regression tests cover snapshots, stale confirmation, quantity allocation
and financial separation. Final focused evidence: 51 client tests, 21 controller/
list tests, six new disposable PostgreSQL tests and 15 receipt workflow regression
tests passed. Focused lint, the client build and `git diff --check` passed. These
counts combine the applicable focused runs; unchanged passing suites were reused.

No connected browser was available: desktop/mobile/theme visual acceptance and
real browser interaction remain **unperformed**, not inferred from source or DOM
tests. No live receipt provider calls or private receipt tests were needed for this
entry change. The existing large frontend bundle advisory remains.

## Category and unit follow-up (2026-10-16)

The owner approved this implementation direction during local review. Both this
follow-up and the overall Shopping UX implementation still await functional acceptance.

Category is an optional editable combobox inside collapsed additional details.
Focus shows scoped categories, typing filters them, and arrows only highlight.
Enter or pointer selection commits the existing identity; Escape, Tab, blur and
closing details do not create anything. An unmatched typed name is shown as
**קטגוריה חדשה תיווצר בהוספה: <name>**. Only item submission resolves/creates it.
An unavailable suggestion request is explicitly described as unresolved; the
server still checks the name. A successful response supplies the canonical category
for subsequent entries. Clearing the field uses the existing neutral fallback.
Selected catalog items retain their server-derived category and shared defaults.

`category_name` is additive to the `entry_mode: "name_first"` contract; an explicit
`category_id` takes precedence. Matching uses NFKC, collapsed Unicode whitespace
and ASCII case folding for English, preserving a readable canonical name. Typed
category names are bounded to 300 characters. Partial matches are never substituted.
The existing category model has globally unique names and separate list-type links:
a normalized name present only in an incompatible scope returns a scope error,
without silently linking that category. Existing historical normalization collisions
remain intact and require explicit category selection if ambiguous in this scope.
Creating a category does not change the reusable checkbox choice.

`shared/shoppingEntryOptions.mjs` and `ShoppingUnitSelect` supply both entry and row
editing: `unit` (יח׳), `kg` (ק״ג), `g` (גרם), `l` (ליטר), `ml` (מ״ל), `pack` (מארז),
`pair` (זוג). Known equivalent spellings normalize when submitted. A custom/legacy
unit remains visible as its current option until deliberately replaced. `package`
is not silently equated with `pack`. No historical units are rewritten; receipt
conversion helpers remain unchanged, and unknown conversions remain unresolved.
The UI opts into `unit_mode: "controlled"`; unrelated legacy/receipt callers are
not globally restricted. Quantities retain up to three decimal places. Buttons
add/subtract one while retaining the fractional part; changing units never rescales
quantity or parses package contents from names. Successful entry resets to 1 יח׳;
failed entry retains category, quantity, unit, notes, price and reusable choice.

### Forward migration 051 and local state

`server/migrations/051_shopping_entry_categories.sql` must follow **050**, before
the updated backend/frontend. It replaces the existing add-item RPC, adding typed
category resolution and the canonical category response. Item validation precedes
category creation; category, type link, optional catalog item and list row commit
or roll back together. A per-normalized-name transaction advisory lock and category
write trigger prevent duplicate new categories, including concurrent legacy writes.
No new catalog/table, historical data rewrite or modification to 049/050 is involved.
Retries reuse the category; intentional repeated list rows stay separate.

051 was tested against disposable PostgreSQL (fresh schema and upgrade from applied
050), then applied **only** to `supabase_db_finance-shopping92` on local port 55422.
Before application, 050 prerequisites were present and 051 absent. Counts and content
fingerprints of all 16 Shopping/financial tables matched before/after application;
the new function and active trigger were read back. **Do not rerun 050 or 051 on this
local database.** Production prerequisites/application remain unperformed and outside
this task. For a future authorized rollout, inspect applied state and apply only
pending reviewed migrations in 050 → 051 → backend → frontend order.

### Follow-up review and evidence

Open **http://localhost:5173/shopping**, synthetic list
**בדיקת UX — קטגוריות ויחידות** (list 7). Original review list 6 is preserved.

1. Expand details, focus category, type a prefix and navigate with arrows. Escape
   preserves the prefix; Enter on a suggestion selects it without adding an item.
2. Enter a new category such as `ציוד לטיולים`, inspect the pending-name explanation,
   and press **הוספה**. Repeat its name with extra spaces: the same identity is used.
   Uncheck the default reusable choice to verify a list-only item; clear category for neutral.
3. Add `מלפפון` at 0.5 ק״ג, `אגוזים` at 250 גרם, and `גרביים` at 3 זוג. Change the
   selector without changing quantity. A name containing `500 גרם` must not set quantity.
4. Select a saved item, inspect its inherited unit, then edit an existing row's unit
   and requirements. Legacy units remain visible until changed. Check keyboard,
   narrow widths, Hebrew/English rendering and both themes during owner acceptance.

Follow-up automated evidence: 34 client tests passed across the focused runs
(`ShoppingQuickEntry.test.jsx`, `Shopping.test.jsx`; the corrected row-test rerun
passed, with unchanged passing tests reused). Eight controller/shared-option tests
and eight disposable PostgreSQL category/unit scenarios passed. Six existing
PostgreSQL quick-entry regressions also passed against the updated schema, including
receipt-context invalidation, frozen snapshots/checkmarks, closed-list locks and
RPC access control. Coverage includes
scope/exact/partial matching, concurrent and retried category resolution, atomic
failure, category loading failure, failed-field preservation, keyboard/focus,
fractional stepping, controlled options and legacy editing. Focused ESLint and the
frontend build passed; only the existing bundle-size advisory remains.

The restarted normal local backend passed an authenticated synthetic API smoke:
seven new rows exercise normalized reuse, distinct partial categories, opt-in reuse,
fractions, catalog identity and legacy-unit replacement. Invalid inputs created no
category; original review rows and financial count stayed unchanged. Frontend HTTP
and served configuration checks confirmed local ports 5050/55421; no normal environment
file was changed. No connected browser was available, so desktop/narrow/theme/touch
visual checks and real browser keyboard checks are **unperformed**. DOM tests are
automated interaction evidence only. No provider calls, production mutations or
financial checkout were performed.

## Owner default decision follow-up

The owner's latest decision supersedes the earlier unchecked/list-only UI default.
**להציע את הפריט גם ברשימות הבאות** stays inside collapsed details and starts checked
on a fresh form and after successful addition. Unchecking explicitly creates a
list-only item. Failed submission preserves either choice and all entered values.
Typing and suggestion navigation perform no catalog writes. Existing catalog
selection retains its identity and sends `save_to_catalog: false`; returning to
new-item entry retains the checkbox choice. Duplicate-name/category conflicts still
use the existing rejection/review behavior, without silent replacement or merging.
No historical list-only items are backfilled. Hebrew/RTL layout is otherwise unchanged.

This default-only follow-up changes `ShoppingQuickEntry.jsx`, its test file, this
document and the existing Unreleased entry. No API, SQL, migration or environment
changes were needed. All 15 quick-entry tests, focused ESLint and the frontend build
passed; the existing bundle-size advisory remains. Existing database/receipt test
evidence above is reused because those implementations are unchanged. Browser visual
and interactive acceptance were not performed for this follow-up. Review at the same
local URL: expand details to inspect the checked label, submit a new synthetic name,
then uncheck for a second name and verify the reset. Functional acceptance is pending.

## Empty-placeholder RTL correction

The name-first item-name and notes inputs now explicitly receive `dir="rtl"` and
inline `text-align: right` while empty, including initial display, clearing and
successful-add reset. Once entered text exists they use `dir="auto"` and
`text-align: start`, retaining browser bidirectional handling for Hebrew, English
and mixed names such as `מטען USB-C 65W`. Saved values receive no directional
control characters or text reversal. Notes are labelled **הערות והעדפות**, with
placeholder **העדפות או פרטים שחשוב לזכור…**; the mixed example placeholder is removed.

Source inspection traced `TextField` props to the native input, the inherited
document RTL rule, and the shared `.ui-field-input { text-align: start }` rule.
The scoped inline alignment overrides that shared declaration for these two inputs
only. Numeric controls, other fields/screens, autocomplete and checked reuse defaults
are unchanged. No API, migration or environment modifications were needed.

All 16 quick-entry tests passed across focused runs (15 existing tests plus the
new initial/type/clear/reset test after correcting its event simulation). Focused
lint and frontend build passed with the existing bundle-size advisory. DOM assertions
check native `dir`, jsdom-computed alignment declarations, unchanged mixed-text payloads,
focus restoration and numeric LTR attributes. No browser was connected: actual
browser computed styles, desktop/narrow visual alignment and theme verification
remain **unperformed**; jsdom does not prove visual alignment. On the local review URL,
inspect both empty fields, type and clear Hebrew/English text, then add a synthetic
item and reopen details to inspect both reset placeholders. **Owner verification update:**
the owner confirms that the corrected Hebrew placeholders and RTL alignment look
correct in their browser. This accepts that specific visual correction only; it
does not verify every reset, device, theme, keyboard, receipt or financial scenario.

## Combined owner-commit review: Shopping UX and Settings version

Settings now has one secondary **אודות המערכת** section below the existing tabs,
with **גרסת האפליקציה** and an isolated LTR version value. Vite statically imports
only `version` from `client/package.json`; the production bundle contains the scalar
`1.7.0` and renders `v` plus that value. There is no backend request, environment
exposure, remote-release lookup or duplicated version field. All seven inventoried
version fields were synchronized from 1.6.0 to 1.7.0 in owner-approved candidate preparation. The label describes the loaded
frontend artifact; it does not establish release publication or migration readiness.

Review URLs: **http://localhost:5173/settings** (bottom of any Settings tab) and
**http://localhost:5173/shopping** (synthetic lists 6/7 described above). Vite serves
the normal application with the existing isolated local backend; normal environment
files and owner data were not changed. Settings uses existing theme tokens, a wrapping
label/value row and `bdi dir="ltr"`. Browser desktop/narrow/theme inspection is still
unperformed because no browser is connected to the agent.

### Diff review and remaining findings

Reviewed the actual tracked diff and new Shopping source/tests, including the final
050/051 definitions and their consolidated-schema copies. Entry retains debounced,
bounded scoped suggestions and stale-response guards; successful addition resets
focus, quantity/unit and the checked reusable choice. Explicit opt-out stays list-only.
Categories resolve inside the list-locked RPC with atomic rollback and normalized-name
locking. Units share one definition/control, preserve legacy values and do not convert
package contents. List-specific name/notes edits retain catalog IDs and mappings.
Receipt access remains secondary with pending-review status; its live non-empty-list
check follows checklist changes. 050's updated snapshot includes name/notes, invalidates
stale receipt context and leaves frozen plan/history intact. Purchase checkmarks,
receipt confirmation and financial checkout remain separate.

One concrete copy defect found during final review was fixed: the habits panel still
told owners to manually enable the old reusable checkbox. It now names the current
checked-by-default option. No category-scoping redesign was made.

**Category-name collision remains unresolved by design:** a name that exists only
under another list type is absent from this type's suggestions. Typing it may show
the pending-new-category explanation; submission then returns a scope error and
preserves the form. Choose an available category, clear it for neutral, use a distinct
name, or deliberately change mappings through the existing Settings workflow.
The pre-existing `shopping_catalog_categories.name UNIQUE` constraint already prevented
two identical names across types; the old create-category endpoint also rejected
that insert. Thus the exact-name cross-scope limitation is pre-existing, documented,
and not a regression introduced by Settings or this UX. **051 intentionally extends
duplicate prevention to normalized equivalents** (whitespace/NFKC/English case), so
previously distinct spellings may now conflict too. Historical collisions are retained;
ambiguous scoped matches require explicit selection. This tightening is disclosed,
not labelled resolved. Retry-safe category identity does not deduplicate intentional
list rows; an uncertain network outcome should be checked in the list before retrying.

Evidence categories:

- **Passed now:** focused existing Settings navigation test augmented to compare the
  rendered version with package metadata and assert LTR; targeted habits rendering
  test; focused lint; production frontend build and inspection of its emitted version
  constant/render site; seven-field synchronization; local Settings HTTP/module checks.
  Existing frontend bundle-size advisory remains.
- **Reused:** 16 quick-entry DOM tests (including RTL/reset and checked/unchecked failure
  preservation), 21 list UI tests, receipt UI/regression evidence above, eight controller/
  shared-unit tests, eight 051 and six 050 disposable PostgreSQL scenarios, and prior
  authenticated local synthetic API smoke. Unchanged database/receipt suites were not
  needlessly rerun. These automated results are not manual acceptance.
- **Read back locally now:** isolated port 55422 has both new columns, both enabled
  item/category triggers, one neutral category, and all six final 050/051 function
  bodies matching the files. All three read-only SQL blocks below were executed
  successfully against this isolated applied schema. No migration was rerun; original application checksums
  and preservation evidence above remain applicable.
- **Owner verified:** only the corrected Hebrew placeholder/RTL visual appearance.
- **Unperformed:** Settings desktop/narrow/theme browser inspection, broader manual
  Shopping acceptance, production schema/preflight/application/deployment and any
  new live receipt-provider or production mutation tests.

### Exact proposed commit scope (35 files)

The previous 26 implementation/handoff paths remain in scope. Version preparation
adds nine paths: the five package/lockfiles, root README, the development standard's
current version inventory, history index and new `RELEASE_1_7_0.md` candidate record.
The array below is the complete exact scope, including all new files. There are no
identified unrelated hunks within these paths at this checkpoint. Exclude unrelated
`docs/operations/APY_04_CAL_RECONCILIATION.md`, `docs/MULTI_USER_ARCHITECTURE.md`,
`docs/MULTI_USER_INVENTORY.md`, and `docs/operations/__pycache__/`, plus ignored private
and environment files. The index is empty and has not been changed by preparation.

Owner-operated PowerShell (the helper checks the exit status of every Git command):

```powershell
Set-Location 'D:\code\finance-tracker'
$ErrorActionPreference = 'Stop'
function Invoke-CheckedGit {
  & git @args
  if ($LASTEXITCODE -ne 0) { throw "Git failed with exit code $LASTEXITCODE" }
}
Invoke-CheckedGit status --short
$reviewBranch = Invoke-CheckedGit branch --show-current
if ($reviewBranch -ne 'main') { throw 'Branch changed: review before staging.' }
$reviewHead = Invoke-CheckedGit rev-parse HEAD
if ($reviewHead -ne 'ad28ac9931553ac5ed93df30e902c7af4a9e4ee0') {
  throw 'HEAD changed: recheck the reviewed baseline before staging.'
}
$existingIndex = @(Invoke-CheckedGit diff --cached --name-only)
if ($existingIndex.Count -ne 0) {
  throw 'The index changed: preserve and review existing staged work before proceeding.'
}
$releaseScope = @(
  'CHANGELOG.md'
  'README.md'
  'client/package-lock.json'
  'client/package.json'
  'client/src/pages/Settings/Settings.css'
  'client/src/pages/Settings/Settings.jsx'
  'client/src/pages/Settings/Settings.test.jsx'
  'client/src/pages/Shopping/Shopping.css'
  'client/src/pages/Shopping/Shopping.test.jsx'
  'client/src/pages/Shopping/ShoppingCategoryInput.jsx'
  'client/src/pages/Shopping/ShoppingIntelligence.jsx'
  'client/src/pages/Shopping/ShoppingIntelligence.test.jsx'
  'client/src/pages/Shopping/ShoppingListDetail.jsx'
  'client/src/pages/Shopping/ShoppingQuickEntry.jsx'
  'client/src/pages/Shopping/ShoppingQuickEntry.test.jsx'
  'client/src/pages/Shopping/ShoppingReceiptDialog.jsx'
  'client/src/pages/Shopping/ShoppingReceiptDialog.test.jsx'
  'client/src/pages/Shopping/ShoppingUnitSelect.jsx'
  'docs/README.md'
  'docs/github-development-standard.md'
  'docs/history/README.md'
  'docs/history/RELEASE_1_7_0.md'
  'docs/operations/SHOPPING_UX.md'
  'package.json'
  'server/controllers/shoppingController.js'
  'server/full_schema.sql'
  'server/migrations/050_shopping_quick_entry.sql'
  'server/migrations/051_shopping_entry_categories.sql'
  'server/package-lock.json'
  'server/package.json'
  'server/test/shoppingEntryCategoriesPostgres.local.test.js'
  'server/test/shoppingEntryOptions.test.js'
  'server/test/shoppingQuickEntry.test.js'
  'server/test/shoppingQuickEntryPostgres.local.test.js'
  'shared/shoppingEntryOptions.mjs'
)
Invoke-CheckedGit diff -- $releaseScope
# Review the new files listed above too; ordinary git diff omits untracked contents.
Invoke-CheckedGit add -- $releaseScope
$stagedPaths = @(Invoke-CheckedGit diff --cached --name-only)
if (Compare-Object ($releaseScope | Sort-Object) ($stagedPaths | Sort-Object)) {
  throw 'Unexpected staged scope: inspect before committing.'
}
Invoke-CheckedGit diff --cached --check
Invoke-CheckedGit diff --cached --stat
Invoke-CheckedGit diff --cached
```

If new unrelated edits appear in a listed file after this review, do not stage the
whole file. Use `Invoke-CheckedGit add -p -- '<that exact path>'` for tracked mixed
files and review each selected hunk; keep unrelated changes out of the index. Do not
reset/clean/stash owner work. Stop if the scope cannot be cleanly separated. After
reviewing the entire staged diff, the owner runs in the same PowerShell session:

```powershell
Invoke-CheckedGit commit -m "feat(shopping): streamline list entry and prepare v1.7.0"
Invoke-CheckedGit status --short
```

There is no push, tag, publication or deployment in this sequence. Candidate preparation
and a commit do not establish production readiness or overall functional acceptance.

### Owner-operated migration and rollout procedure (separate from Git commit)

Actual files: `server/migrations/050_shopping_quick_entry.sql`, followed by
`server/migrations/051_shopping_entry_categories.sql`. Prerequisite is the verified
Shopping schema through **049**. 050 adds `planned_name`, the neutral marker/index
and add-item RPC, replacing `shopping_snapshot`. 051 depends on those objects,
adds normalization/resolution functions and a category trigger, and replaces the
add-item RPC. Both are transaction-wrapped, single-run forward files. **Do not execute
`full_schema.sql` on an existing database or blindly rerun either migration.**

The isolated local application has both applied and source-matched. Production state
was not inspected in this task. Historical #95 shipping notes are not applied-state
evidence. Use the [Shopping rollout/recovery runbook](SHOPPING_RECEIPTS.md) for writer
coordination and artifact verification, with the current owner-operated boundary:
no agent push/deployment/SQL/settings changes. The prior owner backup/restore-test
waiver was for the **#95 rollout / migration 049** and remains recorded as **waived**,
never passed. It is **not implicitly extended to 050/051 or v1.7.0**. Future owner-operated
050/051 production preparation follows the existing runbook's backup/restore requirement
unless the owner separately changes that requirement; none is claimed verified here.
No production backup access or new approval is needed to complete this local preparation.
Preserve data and use compatible forward recovery; do not promise recovery from an
unverified or nonexistent backup.

**Preflight — owner, correct Supabase project → SQL Editor:**

1. Verify the target project and actual 049 state against its reviewed definitions,
   constraints, grants and item-lock trigger using the existing runbook. First inventory
   the proposed objects (read-only); presence alone does not prove a migration matches:

```sql
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns WHERE table_schema='public' AND
 ((table_name='shopping_list_items' AND column_name='planned_name') OR
  (table_name='shopping_catalog_categories' AND column_name='is_neutral') OR
  (table_name='shopping_receipts' AND column_name IN
   ('progress','lease_expires_at','confirmation_request','origin_plan')))
ORDER BY table_name,column_name;
SELECT signature, to_regprocedure(signature) AS installed
FROM (VALUES ('public.shopping_snapshot(bigint)'),
 ('public.shopping_receipt_context(bigint)'),
 ('public.shopping_move_receipt(bigint,bigint,text)'),
 ('public.shopping_add_planned_item(bigint,jsonb)'),
 ('public.shopping_category_display(text)'), ('public.shopping_category_key(text)'),
 ('public.shopping_category_write_guard()'),
 ('public.shopping_resolve_entry_category(bigint,text)')) f(signature);
SELECT tgname,tgenabled,pg_get_triggerdef(oid) FROM pg_trigger
WHERE tgrelid IN (to_regclass('public.shopping_list_items'),
 to_regclass('public.shopping_catalog_categories')) AND NOT tgisinternal;
SELECT indexdef FROM pg_indexes WHERE schemaname='public'
 AND indexname='shopping_one_neutral_category';
SELECT proname,pg_get_functiondef(oid) FROM pg_proc
WHERE pronamespace='public'::regnamespace AND proname IN
 ('shopping_snapshot','shopping_add_planned_item','shopping_category_display',
  'shopping_category_key','shopping_category_write_guard','shopping_resolve_entry_category');
```

2. Before 050, both new columns, neutral index and add-item RPC must be absent;
   the snapshot must match 049. If 050 is already present, compare it with 050 (or
   051 if also present), and skip the applied file. Partial/drifted state means stop
   and reconcile; do not apply fragments. Before 051, 050 must be complete and its
   four new category functions/trigger absent. After 051, snapshot must match 050
   and all category/add-item definitions must match 051. Verify the reserved ID
   below: if `-1` already belongs to an unrelated category before 050, stop. Existing
   exact `ללא קטגוריה` is intentionally reused and linked to all types by 050.

```sql
SELECT id,name FROM public.shopping_catalog_categories
WHERE id=-1 OR name='ללא קטגוריה';
-- Run after verifying the 049 lease column exists:
SELECT count(*) AS extracting, max(lease_expires_at) AS latest_lease
FROM public.shopping_receipts WHERE state='extracting';
```

3. Privately record current Git deployment controls/SHAs and hold automatic
   Railway/Vercel deployments **before any owner push**. Repository config does not
   prove a live hold. Railway watches server/shared changes; Vercel builds the client.
   If Vercel is disconnected, retain that hold until frontend deployment is appropriate;
   otherwise use its existing dashboard control. If dashboard controls cannot enforce
   ordering, do not push until an owner-operated ordered deployment is arranged.
   Coordinate a Shopping write pause (including catalog Settings) and drain extraction
   leases. Do not invent maintenance flags or change unrelated integrations. Preserve
   open draft edits and plan a client reload after cutover.
4. Capture private before counts/digests of Shopping lists/items, frozen plans,
   receipts/drafts, mappings, confirmations, checkouts and financial/provenance records.
   Compare original columns only across 050: `planned_name` is added as null; neutral
   category flag/links are expected additions. 051 should change no rows. Account for
   unrelated concurrent financial integrations rather than assuming their counts froze.

**Application — only after preflight, owner SQL Editor:** run each **pending** reviewed
file in full, **050 then 051**, and require its final successful `COMMIT`. In the same
editor batch prepend `SET lock_timeout = '5s'; SET statement_timeout = '60s';` and
append `RESET lock_timeout; RESET statement_timeout;`. Keep the file's own transaction;
do not wrap it in a second transaction. On any error, issue `ROLLBACK;` if necessary,
then inspect catalog state before considering retry. With an already configured
private PostgreSQL CLI session, `psql -X -v ON_ERROR_STOP=1 -f <exact pending file>`
is the alternative; do not paste credentials into commands or repository files.
The files already notify PostgREST to reload its schema cache.

**Postflight — owner, read-only:** rerun the inventory/definition queries above and
verify both columns, the valid unique partial index, and both enabled triggers.
Compare definitions with the final files, not just names. Then run:

```sql
SELECT count(*) AS neutral_categories FROM public.shopping_catalog_categories WHERE is_neutral;
-- Expected 1; after 050 every existing type must be linked to it.
SELECT count(*) AS missing_neutral_links FROM public.shopping_list_types t
CROSS JOIN public.shopping_catalog_categories c
WHERE c.is_neutral AND NOT EXISTS (
 SELECT 1 FROM public.shopping_catalog_category_list_types ct
 WHERE ct.list_type_id=t.id AND ct.category_id=c.id);
-- Expected 0; no historical category/name deduplication was requested.
SELECT conname,pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid='public.shopping_list_items'::regclass AND contype='c';
SELECT r.role,f.signature,has_function_privilege(r.role,f.signature,'EXECUTE') AS allowed
FROM (VALUES ('anon'),('authenticated'),('service_role')) r(role)
CROSS JOIN (VALUES ('public.shopping_add_planned_item(bigint,jsonb)'),
 ('public.shopping_category_display(text)'),('public.shopping_category_key(text)'),
 ('public.shopping_resolve_entry_category(bigint,text)')) f(signature);
-- Only service_role is allowed for these four functions.
```

Read back role/RLS state and unchanged before/after evidence. Do not test production
by adding items, confirming purchases, checking out, replaying imports or uploading
private receipts. A health response/version label alone is insufficient.

**Rollout:** verified **schema 050 → schema 051 → matching backend → matching frontend**.
The backend now selects `is_neutral`; deploying it before 050 breaks those reads.
The new category input requires 051; 050's RPC would ignore the new typed category.
After the owner pushes with verified holds, deploy backend from the reviewed SHA,
verify its root-context Docker/shared-module packaging, health and authenticated
read-only Shopping access, then deploy/promote the matching frontend. Verify API/Auth
targets, SHAs, draft visibility and Settings version; reload stale clients. Lift the
Shopping write pause and restore exactly the recorded Git controls only after checks.
All of these production actions remain unperformed here.

**Recovery:** a failure before a migration commits should roll back that file;
recheck actual state and retain the previously working deployment. If 050 committed
but 051 failed, keep writes held and repair/apply only the missing reviewed step.
After migration commit, retain additive columns, neutral identity, catalog links,
planned-name overrides and receipt evidence. Do not use a destructive down migration,
drop new fields, or restore a whole database over newer unrelated writes. If deployment
fails, keep Shopping unavailable and forward-fix/redeploy compatible artifacts; old
frontends/backends can ignore overrides or typed categories and are not an automatic
safe rollback. Any restore from an independently available verified backup first
requires an isolated comparison and a defined write cutoff/reconciliation plan.

## Release / Version gate

- Release impact: Yes — Shopping entry/editing and visible Settings build version.
- SemVer impact: Patch for default-choice and empty-placeholder RTL corrections (no new API/capability);
  Minor for the overall pending Shopping UX expansion and the additive Settings version
  display, preserving legacy callers. Settings introduces no API/schema changes.
- Candidate release: **v1.7.0 — prepared and unpublished**, expressly approved by the owner;
  see [candidate record](../history/RELEASE_1_7_0.md). Prior v1.6.0 history is unchanged.
- Grouping / included release candidate: Reviewed Shopping UX and Settings version-display
  bundle only; no new work assigned to old issues and no change to v1.6.0 membership.
- CHANGELOG status: Prepared v1.7.0 section; only the Shopping/Settings entries moved
  from Unreleased. Unrelated entries and v1.6.0 history are preserved.
- Version-bump status: Synchronized — all seven established fields at **1.7.0**,
  with dependency trees and unrelated package metadata unchanged.
- Publication status: Out of scope.
- Owner verification / acceptance status: v1.7.0 preparation approved. Accepted only for the specific Hebrew
  placeholder/RTL visual correction, per owner's confirmation. Settings and overall
  Shopping functional acceptance remain Pending; no unperformed scenario is accepted.

## Quick-entry dropdown/search correction (2026-10-18)

This is a separate local Patch follow-up, not v1.7.0 release preparation. Baseline:
`main` at `12f2c8f0eb36710cf74bf565e1131cbea919fae7`; index initially empty.

Source-confirmed causes: both absolutely positioned suggestion lists were descendants
of `.ui-glass { overflow: hidden }`; GlassCard also establishes a backdrop-filter
stacking context. A larger z-index cannot escape that clipping. The empty category
used `dir="auto"` without explicit alignment. Item edits discarded all suggestions
and waited 250 ms before every network search; the scoped backend then fetches
category links and catalog rows sequentially. Actual multi-second backend latency
and owner-browser clipping geometry have **not** been measured in this session.

Both popups now use a body portal anchored to the input. Placement follows ancestor
scrolling, resizing, input/popup resizing and the visual viewport, flips upward near
the bottom, clamps width, and scrolls within at most 320 px. Existing GlassCard
overflow stays intact. Pointer selection retains input focus; blur/Tab/Escape close
the popup. ARIA IDs remain connected across the portal. Category's empty placeholder
explicitly uses RTL/right alignment; entered text retains automatic direction.

Each mounted entry has an in-memory cache isolated by authenticated user and list
type, cleared/aborted on scope changes, logout or unmount. The existing API remains
unchanged: preload **20** items on mount, search at most **8** after a 250 ms remote
debounce. Preload and query responses are **partial**; there is no complete-catalog
claim or pagination bypass. Broader or uncached queries still request the server.
Local matching runs in the input render without a debounce, ranks exact/prefix/
substring matches deterministically and retains IDs, category context and defaults.

Bounds: 128 rows, 32 recent query keys, 30-second exact-query reuse, 2-minute row
freshness, and 8-second request timeout. At most the preload and latest query remain
in flight; identical requests share work. Aborted/stale work cannot refill a cleared
cache. Eviction invalidates query reuse so a missing cached row is not mistaken for
absence. Successful Shopping mutations invalidate/refetch mounted suggestions and
categories, including reusable-item creation; failures preserve useful matching rows
and the explicit new-name action. Cached data never replaces server validation.
No backend/schema/dependency/migration or financial workflow changes are required.

### Focused evidence and local review

- 51 focused client tests passed: quick entry (21), cache (6), popup placement with
  synthetic geometry (2), API wrapper/interceptor regressions (22). These cover
  immediate matches, partial/narrow/broad caches, failure/stale work, auth/list-type
  isolation, invalidation/eviction, keyboard category selection and new-category
  submission, preserved units/default reuse/requirements/failure values.
- Cold path, controlled clock/network: dispatch at 250 ms, a deliberately delayed
  1,000 ms response available at 1,250 ms. Warm broad/narrow edits display the cached
  match in the same input update with no clock advance or extra request. This is
  deterministic DOM evidence, **not real network or browser paint timing**.
- Node-only benchmark: 128 synthetic cached rows / 1,000 filters, median 0.149 ms,
  p95 0.229 ms. This measures filtering only, not rendering or production latency.
- Focused ESLint, production frontend build and whitespace checks pass. Existing
  >500 kB bundle warning remains. All seven version fields remain 1.7.0.
- Normal frontend/back end were already listening on 5173/5050. The frontend returns
  HTTP 200 and serves the updated quick-entry module. Normal environment files and
  owner data were not changed; no live financial writes or database tests were run.
- Browser runtime discovery returned no available browser. Actual computed styles,
  desktop/narrow viewport, light/dark themes, touch/scrollbar behavior, real keyboard
  interaction and cold/warm browser latency (including the <100 ms target) remain
  **unperformed**. Earlier owner acceptance of other RTL corrections does not accept
  this new category correction or either bug fix.

Review at **http://localhost:5173/shopping** using an existing synthetic review list
(listed above). Expand details, focus empty category and verify its placeholder,
then scroll the page near the bottom, scroll the popup and select by pointer or
arrows/Enter. Check Escape/Tab and a new typed category without submitting. Type an
existing catalog name such as `אקטימל`, allow its initial lookup, then clear/retype
and broaden/narrow it. Repeat at narrow width in both themes and with network
throttling: available matches should remain usable while remote work is pending.
No receipt confirmation or checkout is needed.

### Release / Version gate for this correction

- Release impact: **Yes**, visible dropdown/search bug corrections.
- SemVer impact: **Patch**, compatible fixes with no new API/schema capability.
- Candidate release: **Pending owner selection**; no candidate selected here.
- Grouping: **Pending owner selection**; not assigned to the prior candidate.
- CHANGELOG: **Updated under Unreleased**; unrelated/history entries preserved.
- Version bump: **Deferred** to owner-led release preparation; seven fields at 1.7.0.
- Publication: **Out of scope**.
- Owner verification / acceptance: **Pending** for these fixes.

This was the initial handoff state; the subsequent owner acceptance and combined
commit scope are recorded below.

## Local startup recovery (2026-10-18)

The owner's subsequent loading report exposed a stopped local dependency. Frontend
5173 and backend 5050 were running, but Docker Desktop was stopped and isolated
Supabase on 55421 was refusing connections. The served frontend configuration was
verified to target that local Supabase URL, not production. `ProtectedRoute` waits
on `AuthProvider.getSession()` before mounting Dashboard or Shopping; the existing
provider had neither a rejection handler nor a loading timeout. No evidence showed
the Shopping portal or cache causing this startup failure: they mount only within
Shopping, and the API cache invalidation interceptor excludes initial GET requests.

Started the existing Docker Desktop installation. Its existing Shopping containers
resumed without a database reset, migration, environment change, or frontend/backend
restart. Auth, gateway and PostgreSQL became healthy. Read-only authenticated checks
using the existing isolated review account then returned HTTP 200 for all nine
startup resources: Dashboard summary/monthly series, tasks, loans, budgets,
transactions, Savings report, Shopping lists and list types (39–111 ms in this run).
Authentication itself returned 200 in 147 ms. Category options, bounded catalog
preload and a typed search also returned 200 (47–65 ms). The typed `אקטימל` search
has no matches in synthetic list 7's catalog; this is not a failure or a claim that
the owner's other catalog contains no such product. No financial mutations occurred.

The focused frontend correction bounds initial authentication loading at 15 seconds,
handles rejected/failed session restoration, and offers a Hebrew **ניסיון חוזר**
action. It preserves stored authentication data, keeps protected content hidden on
error, accepts recovery events, ignores stale responses, and cleans up timers and
subscriptions. No application version or Shopping feature was changed by recovery.

Verification: six AuthProvider cases and four ProtectedRoute cases cover hung/error
restoration, retry, recovery, sign-out, stale results and unmount cleanup. The 23
existing quick-entry/popup tests were rerun after the auth change. Focused lint and
the production frontend build pass, retaining the existing bundle-size advisory.
Browser discovery still returned no available browser: actual Dashboard/Shopping
rendering, popup appearance and warm-search browser timing remain unverified.
HTTP/process success is not presented as visual acceptance. Refresh
**http://localhost:5173** (then `/shopping`) for owner review.

Release gate: **Yes / Patch** for the compatible authentication recovery correction;
candidate and grouping **Pending owner selection**; CHANGELOG **Updated under
Unreleased**; version bump **Deferred**, all seven fields remain 1.7.0; publication
**Out of scope**; owner acceptance **Pending**. The local service restart itself is
not a deployment. No staging, commit, push, production SQL or hosting changes occurred.

## Combined bug-fix owner acceptance and commit scope (2026-10-18)

The owner confirms that the normal local application now loads and the reviewed
Shopping behavior looks correct. Record this as **Accepted for local loading and
the Shopping behavior actually reviewed**. It does not establish additional mobile,
theme, keyboard, touch, viewport or browser-performance coverage. The authentication
timeout/error/retry fault scenarios remain supported by automated evidence, not a
claim that the owner manually induced and tested each failure. This current record
supersedes the Pending acceptance checkpoints for these corrections above; it does
not expand historical v1.7.0 or unrelated feature acceptance.

Final combined review: branch `main`, HEAD and read-only remote `origin/main` lookup
both `12f2c8f0eb36710cf74bf565e1131cbea919fae7`; index empty. Reviewed tracked diffs
and all five new files. No unrelated owner hunks are mixed into the following
**17-file task scope** (the original 12-file Shopping scope plus five auth files):

```text
CHANGELOG.md
client/src/components/ProtectedRoute.css
client/src/components/ProtectedRoute.jsx
client/src/components/ProtectedRoute.test.jsx
client/src/context/AuthContext.jsx
client/src/context/AuthContext.test.jsx
client/src/pages/Shopping/Shopping.css
client/src/pages/Shopping/ShoppingCategoryInput.jsx
client/src/pages/Shopping/ShoppingQuickEntry.jsx
client/src/pages/Shopping/ShoppingQuickEntry.test.jsx
client/src/pages/Shopping/ShoppingSuggestionPopup.jsx
client/src/pages/Shopping/ShoppingSuggestionPopup.test.jsx
client/src/pages/Shopping/shoppingSuggestionCache.js
client/src/pages/Shopping/shoppingSuggestionCache.test.js
client/src/services/api.js
client/src/services/api.test.js
docs/operations/SHOPPING_UX.md
```

Exclude owner work in `docs/operations/APY_04_CAL_RECONCILIATION.md`,
`docs/MULTI_USER_ARCHITECTURE.md`, `docs/MULTI_USER_INVENTORY.md` and
`docs/operations/__pycache__/`, plus all private/environment files. Neither the
index nor these files was changed during preparation. No schema, migrations,
package metadata, hosting or production changes belong to this bundle.

Both corrections are accurately covered by the two new Unreleased / Fixed entries;
unrelated entries are preserved. Reuse the **61 distinct passing focused cases**
(51 Shopping/cache/API cases plus 10 auth/route cases), focused lint, final frontend
build, and recorded local authenticated HTTP evidence. The 23 Shopping entry/popup
cases rerun during startup recovery are a subset, not extra cases. Only acceptance
documentation changed in this preparation, so no runtime suite/build was repeated;
whitespace, manifest, version inventory and preservation checks were rerun.

Proposed owner commit: `fix: repair shopping suggestions and auth startup recovery`.
Stage only the explicit paths, review the staged diff, then commit in a separate
step. Push only that verified commit to `origin main` through the existing Git
workflow; stop if branch, parent, staged tree/scope or remote baseline changes.
The agent has not staged, committed or pushed anything. Commit/push completion and
deployment are not claimed by this preparation.

### Complete Release / Version gate for the combined bundle

- Release impact: **Yes** — visible Shopping corrections and auth startup recovery.
- SemVer impact: **Patch** — compatible bug fixes; no new schema/API contract.
- Candidate release: **Pending owner selection**; unselected.
- Grouping / included release candidate: **Pending owner selection**; unselected.
- CHANGELOG: **Updated under Unreleased**, both corrections included.
- Version bump: **Deferred** to owner-led release preparation; seven fields stay 1.7.0.
- Publication: **Out of scope**; no tag or release is prepared.
- Owner verification / acceptance: **Accepted for the local loading and Shopping
  behavior actually reviewed**, with the unperformed/manual fault-scenario limits
  stated above. No broader coverage is inferred.
