# Issue #102 - Gate 3E.2 owner-controlled checkpoint plan

Prepared 2026-11-12. **Commands below were not executed.** Staging and commits
remain owner actions. Review the complete inventory and readiness report before
using them; this document does not authorize a push, merge, rebase or deployment.

## Audit result

Initial 107 files: 17 modified tracked + 90 untracked; zero staged. All matched
Gate 3E.1 final hashes. E2 adds five files, yielding 112 paths: 17 modified tracked
and 95 untracked. All original 107 files, four migrations and both stashes remain
byte-identical. No tracked runtime change was made in E2.

The initial classification was 59 source, 34 tests, 10 documentation and four
migrations. The table below refines preview/fixture material as test material.
No generated artifact, private evidence or unrelated file belongs in this checkpoint.
`node_modules`, client `dist`, local environment files and external evidence remain
excluded. The only already-tracked files matching an ignore rule are `.gitignore`
and `client/.gitignore`, because the historical root `.gitignore` rule matches them;
neither changed and neither is in the staging list. No new ignored file is proposed.

Secret/credential patterns, private row-snapshot patterns, fixture provenance,
Docker allowlist, tracked paths and accumulated diff were reviewed. Synthetic
credentials are generated per disposable run and written outside the worktree.
A scanner cannot prove absence of every possible secret; owner review of the
actual staged diff remains mandatory. No public artifact contains private rows.

## Logical review groups and commit recommendation

1. Hierarchy/domain and Supabase persistence: `server/modules/shopping`, migrations
   060-063, injectable authentication and their tests.
2. HTTP/workflow/receipt integration and packaging: routers, preserved mature
   receipt adapters, Docker allowlist and coordinated legacy replacements.
3. React administration and ordinary Shopping compatibility: feature module,
   existing Shopping/Settings consumers, API transport, Vite dev gates and tests.
4. Operational evidence and acceptance tooling: contracts, cutover/recovery
   runbooks, test helpers/launchers and existing #102 Unreleased entry.

These groups have cross-file runtime dependencies. Recommend **one complete local
checkpoint commit** after reviewing all four groups, rather than committing an
unrunnable subset. Do not amend or rewrite published history. A separate later
owner-authorized main-integration commit should preserve the newer manual-refund
work; rerun affected finance/schema tests afterward. No main-integration commands
are provided here because merge/rebase is outside this authorization.

HEAD is `43dc936600038da07a808a8b52627491ca722987`; observed main is
`70610646da8f5b26755ac3387484b28416401135` (one newer commit, 19 paths).
CHANGELOG is the only dirty-path overlap, but financial semantics and deployed
059 also require review. Do not overwrite main changes based on a clean text merge.

## Complete reviewed path inventory

| Initial/current status | Classification | Path |
|---|---|---|
| modified tracked | source | `.dockerignore` |
| modified tracked | documentation | `CHANGELOG.md` |
| untracked | source | `client/src/features/shopping/components/CategorySelector.jsx` |
| untracked | source | `client/src/features/shopping/components/CategoryTree.jsx` |
| untracked | test / public synthetic fixture | `client/src/features/shopping/components/CategoryTree.test.jsx` |
| untracked | source | `client/src/features/shopping/components/EditDialog.jsx` |
| untracked | source | `client/src/features/shopping/hooks/useUnsavedChanges.js` |
| untracked | test / public synthetic fixture | `client/src/features/shopping/hooks/useUnsavedChanges.test.jsx` |
| untracked | test / public synthetic fixture | `client/src/features/shopping/preview/catalogPreview.js` |
| untracked | test / public synthetic fixture | `client/src/features/shopping/preview/catalogPreview.test.js` |
| untracked | documentation | `client/src/features/shopping/README.md` |
| untracked | source | `client/src/features/shopping/services/catalogApi.js` |
| untracked | test / public synthetic fixture | `client/src/features/shopping/services/catalogApi.test.js` |
| untracked | source | `client/src/features/shopping/services/httpCatalogApi.js` |
| untracked | test / public synthetic fixture | `client/src/features/shopping/services/httpCatalogApi.test.js` |
| untracked | source | `client/src/features/shopping/services/workflowTransport.js` |
| untracked | test / public synthetic fixture | `client/src/features/shopping/services/workflowTransport.test.js` |
| untracked | source | `client/src/features/shopping/settings/CategoriesPanel.jsx` |
| untracked | source | `client/src/features/shopping/settings/ListTypesPanel.jsx` |
| untracked | source | `client/src/features/shopping/settings/ProductsPanel.jsx` |
| untracked | source | `client/src/features/shopping/settings/shoppingAdmin.css` |
| untracked | source | `client/src/features/shopping/settings/ShoppingCatalogAdmin.jsx` |
| untracked | test / public synthetic fixture | `client/src/features/shopping/settings/ShoppingCatalogAdmin.test.jsx` |
| untracked | source | `client/src/features/shopping/settings/ShoppingIntegration.jsx` |
| modified tracked | source | `client/src/main.jsx` |
| modified tracked | source | `client/src/pages/Settings/ShoppingSettingsTab.jsx` |
| modified tracked | source | `client/src/pages/Shopping/ReceiptProductDetails.jsx` |
| modified tracked | source | `client/src/pages/Shopping/ReceiptReviewTable.jsx` |
| modified tracked | source | `client/src/pages/Shopping/ShoppingCategoryInput.jsx` |
| modified tracked | source | `client/src/pages/Shopping/ShoppingIntelligence.jsx` |
| modified tracked | source | `client/src/pages/Shopping/ShoppingListDetail.jsx` |
| modified tracked | source | `client/src/pages/Shopping/ShoppingListDialog.jsx` |
| untracked | test / public synthetic fixture | `client/src/pages/Shopping/ShoppingListDialog.test.jsx` |
| modified tracked | source | `client/src/pages/Shopping/ShoppingLists.jsx` |
| modified tracked | source | `client/src/pages/Shopping/ShoppingQuickEntry.jsx` |
| modified tracked | source | `client/src/pages/Shopping/ShoppingReceiptDialog.jsx` |
| modified tracked | source | `client/src/services/api.js` |
| modified tracked | source | `client/vite.config.js` |
| untracked | documentation | `docs/operations/SHOPPING_ADMINISTRATION_CONTRACT.md` |
| untracked | documentation | `docs/operations/SHOPPING_CATEGORY_CONTRACT.md` |
| untracked | documentation | `docs/operations/SHOPPING_GATE_3E2_CHECKPOINT.md` |
| untracked | documentation | `docs/operations/SHOPPING_GATE_3E2_READINESS.md` |
| untracked | documentation | `docs/operations/SHOPPING_HIERARCHY_CUTOVER.md` |
| untracked | documentation | `docs/operations/SHOPPING_HTTP_INTEGRATION.md` |
| untracked | documentation | `docs/operations/SHOPPING_ISOLATED_PERSISTENCE.md` |
| untracked | documentation | `docs/operations/SHOPPING_WORKFLOW_COMPATIBILITY.md` |
| modified tracked | source | `server/middleware/auth.js` |
| untracked | source | `server/middleware/requireUser.js` |
| untracked | migration | `server/migrations/060_shopping_hierarchy_persistence.sql` |
| untracked | migration | `server/migrations/061_shopping_category_contract.sql` |
| untracked | migration | `server/migrations/062_shopping_administration_contract.sql` |
| untracked | migration | `server/migrations/063_shopping_workflow_persistence.sql` |
| untracked | source | `server/modules/shopping/catalog/catalogService.js` |
| untracked | source | `server/modules/shopping/catalog/commercialService.js` |
| untracked | test / public synthetic fixture | `server/modules/shopping/categories/categoryContract.test.js` |
| untracked | source | `server/modules/shopping/categories/categoryResponse.js` |
| untracked | source | `server/modules/shopping/categories/categoryService.js` |
| untracked | test / public synthetic fixture | `server/modules/shopping/categories/categoryService.test.js` |
| untracked | source | `server/modules/shopping/categories/hierarchy.js` |
| untracked | test / public synthetic fixture | `server/modules/shopping/categories/hierarchy.test.js` |
| untracked | source | `server/modules/shopping/http/administrationReads.js` |
| untracked | source | `server/modules/shopping/http/administrationRouter.js` |
| untracked | source | `server/modules/shopping/http/workflowIntelligenceRouter.js` |
| untracked | source | `server/modules/shopping/http/workflowRouter.js` |
| untracked | source | `server/modules/shopping/intelligence/lookupService.js` |
| untracked | test / public synthetic fixture | `server/modules/shopping/list-types/fixtures/approvedTaxonomy.js` |
| untracked | test / public synthetic fixture | `server/modules/shopping/list-types/gate2Visibility.local.test.js` |
| untracked | source | `server/modules/shopping/list-types/listTypeService.js` |
| untracked | test / public synthetic fixture | `server/modules/shopping/list-types/listTypeService.test.js` |
| untracked | source | `server/modules/shopping/list-types/typeCommands.js` |
| untracked | source | `server/modules/shopping/lists/listCommands.js` |
| untracked | source | `server/modules/shopping/lists/listReads.js` |
| untracked | source | `server/modules/shopping/lists/listService.js` |
| untracked | documentation | `server/modules/shopping/PERSISTENCE.md` |
| untracked | documentation | `server/modules/shopping/README.md` |
| untracked | source | `server/modules/shopping/receipts/receiptService.js` |
| untracked | test / public synthetic fixture | `server/modules/shopping/shared/administrationContract.test.js` |
| untracked | source | `server/modules/shopping/shared/catalogCommands.js` |
| untracked | source | `server/modules/shopping/shared/catalogResponse.js` |
| untracked | source | `server/modules/shopping/shared/contracts.js` |
| untracked | source | `server/modules/shopping/shared/errors.js` |
| untracked | source | `server/modules/shopping/shared/factsReader.js` |
| untracked | source | `server/modules/shopping/shared/httpContracts.js` |
| untracked | source | `server/modules/shopping/shared/migrationReadiness.js` |
| untracked | test / public synthetic fixture | `server/modules/shopping/shared/migrationReadiness.test.js` |
| untracked | source | `server/modules/shopping/shared/persistence.js` |
| untracked | test / public synthetic fixture | `server/modules/shopping/shared/persistence.test.js` |
| untracked | source | `server/modules/shopping/shared/persistenceErrors.js` |
| untracked | test / public synthetic fixture | `server/modules/shopping/shared/preservation.local.test.js` |
| untracked | source | `server/modules/shopping/shared/repository.js` |
| untracked | source | `server/modules/shopping/shared/requestIdentity.js` |
| untracked | source | `server/modules/shopping/shared/workflowCommands.js` |
| modified tracked | source | `server/services/shoppingCommercialProducts.js` |
| untracked | test / public synthetic fixture | `server/test/helpers/shoppingAdministrationContractCases.js` |
| untracked | test / public synthetic fixture | `server/test/helpers/shoppingBrowserCases.js` |
| untracked | test / public synthetic fixture | `server/test/helpers/shoppingCategoryContractCases.js` |
| untracked | test / public synthetic fixture | `server/test/helpers/shoppingCutoverRehearsal.js` |
| untracked | test / public synthetic fixture | `server/test/helpers/shoppingHttpFixture.js` |
| untracked | test / public synthetic fixture | `server/test/helpers/shoppingIntegrationFrontend.js` |
| untracked | test / public synthetic fixture | `server/test/helpers/shoppingIsolatedDatabase.js` |
| untracked | test / public synthetic fixture | `server/test/helpers/shoppingWorkflowBrowser.js` |
| untracked | test / public synthetic fixture | `server/test/helpers/shoppingWorkflowFixture.js` |
| untracked | test / public synthetic fixture | `server/test/shoppingAdministrationHttp.local.test.js` |
| untracked | test / public synthetic fixture | `server/test/shoppingAdministrationHttp.test.js` |
| untracked | test / public synthetic fixture | `server/test/shoppingAdministrationOwner.local.js` |
| untracked | test / public synthetic fixture | `server/test/shoppingCutover.local.test.js` |
| untracked | test / public synthetic fixture | `server/test/shoppingHierarchyFoundation.test.js` |
| untracked | test / public synthetic fixture | `server/test/shoppingHierarchyPostgres.local.test.js` |
| untracked | test / public synthetic fixture | `server/test/shoppingIsolationGuard.test.js` |
| untracked | test / public synthetic fixture | `server/test/shoppingPersistenceFoundation.test.js` |
| untracked | test / public synthetic fixture | `server/test/shoppingWorkflow.local.test.js` |
| untracked | test / public synthetic fixture | `server/test/shoppingWorkflowOwner.local.js` |

## Owner-only PowerShell staging preparation

Run from the authorized worktree only after owner review. The guards below are
intentionally tied to this checkpoint. If anything changes, stop and review a
new inventory instead of widening the staging list. No `git add .` or `-A`.

```powershell
Set-Location 'D:\code\finance-tracker-worktree\finance-tracker-shopping'
if ((Get-Location).Path -ne 'D:\code\finance-tracker-worktree\finance-tracker-shopping') { throw 'Wrong worktree' }
if ((git branch --show-current) -ne 'feat/shopping-category-hierarchy') { throw 'Wrong branch' }
if ((git rev-parse HEAD) -ne '43dc936600038da07a808a8b52627491ca722987') { throw 'HEAD changed; re-audit' }
if (@(git diff --cached --name-only).Count -ne 0) { throw 'Index is not empty' }
$reviewedPaths = @(
  '.dockerignore'
  'CHANGELOG.md'
  'client/src/features/shopping/components/CategorySelector.jsx'
  'client/src/features/shopping/components/CategoryTree.jsx'
  'client/src/features/shopping/components/CategoryTree.test.jsx'
  'client/src/features/shopping/components/EditDialog.jsx'
  'client/src/features/shopping/hooks/useUnsavedChanges.js'
  'client/src/features/shopping/hooks/useUnsavedChanges.test.jsx'
  'client/src/features/shopping/preview/catalogPreview.js'
  'client/src/features/shopping/preview/catalogPreview.test.js'
  'client/src/features/shopping/README.md'
  'client/src/features/shopping/services/catalogApi.js'
  'client/src/features/shopping/services/catalogApi.test.js'
  'client/src/features/shopping/services/httpCatalogApi.js'
  'client/src/features/shopping/services/httpCatalogApi.test.js'
  'client/src/features/shopping/services/workflowTransport.js'
  'client/src/features/shopping/services/workflowTransport.test.js'
  'client/src/features/shopping/settings/CategoriesPanel.jsx'
  'client/src/features/shopping/settings/ListTypesPanel.jsx'
  'client/src/features/shopping/settings/ProductsPanel.jsx'
  'client/src/features/shopping/settings/shoppingAdmin.css'
  'client/src/features/shopping/settings/ShoppingCatalogAdmin.jsx'
  'client/src/features/shopping/settings/ShoppingCatalogAdmin.test.jsx'
  'client/src/features/shopping/settings/ShoppingIntegration.jsx'
  'client/src/main.jsx'
  'client/src/pages/Settings/ShoppingSettingsTab.jsx'
  'client/src/pages/Shopping/ReceiptProductDetails.jsx'
  'client/src/pages/Shopping/ReceiptReviewTable.jsx'
  'client/src/pages/Shopping/ShoppingCategoryInput.jsx'
  'client/src/pages/Shopping/ShoppingIntelligence.jsx'
  'client/src/pages/Shopping/ShoppingListDetail.jsx'
  'client/src/pages/Shopping/ShoppingListDialog.jsx'
  'client/src/pages/Shopping/ShoppingListDialog.test.jsx'
  'client/src/pages/Shopping/ShoppingLists.jsx'
  'client/src/pages/Shopping/ShoppingQuickEntry.jsx'
  'client/src/pages/Shopping/ShoppingReceiptDialog.jsx'
  'client/src/services/api.js'
  'client/vite.config.js'
  'docs/operations/SHOPPING_ADMINISTRATION_CONTRACT.md'
  'docs/operations/SHOPPING_CATEGORY_CONTRACT.md'
  'docs/operations/SHOPPING_GATE_3E2_CHECKPOINT.md'
  'docs/operations/SHOPPING_GATE_3E2_READINESS.md'
  'docs/operations/SHOPPING_HIERARCHY_CUTOVER.md'
  'docs/operations/SHOPPING_HTTP_INTEGRATION.md'
  'docs/operations/SHOPPING_ISOLATED_PERSISTENCE.md'
  'docs/operations/SHOPPING_WORKFLOW_COMPATIBILITY.md'
  'server/middleware/auth.js'
  'server/middleware/requireUser.js'
  'server/migrations/060_shopping_hierarchy_persistence.sql'
  'server/migrations/061_shopping_category_contract.sql'
  'server/migrations/062_shopping_administration_contract.sql'
  'server/migrations/063_shopping_workflow_persistence.sql'
  'server/modules/shopping/catalog/catalogService.js'
  'server/modules/shopping/catalog/commercialService.js'
  'server/modules/shopping/categories/categoryContract.test.js'
  'server/modules/shopping/categories/categoryResponse.js'
  'server/modules/shopping/categories/categoryService.js'
  'server/modules/shopping/categories/categoryService.test.js'
  'server/modules/shopping/categories/hierarchy.js'
  'server/modules/shopping/categories/hierarchy.test.js'
  'server/modules/shopping/http/administrationReads.js'
  'server/modules/shopping/http/administrationRouter.js'
  'server/modules/shopping/http/workflowIntelligenceRouter.js'
  'server/modules/shopping/http/workflowRouter.js'
  'server/modules/shopping/intelligence/lookupService.js'
  'server/modules/shopping/list-types/fixtures/approvedTaxonomy.js'
  'server/modules/shopping/list-types/gate2Visibility.local.test.js'
  'server/modules/shopping/list-types/listTypeService.js'
  'server/modules/shopping/list-types/listTypeService.test.js'
  'server/modules/shopping/list-types/typeCommands.js'
  'server/modules/shopping/lists/listCommands.js'
  'server/modules/shopping/lists/listReads.js'
  'server/modules/shopping/lists/listService.js'
  'server/modules/shopping/PERSISTENCE.md'
  'server/modules/shopping/README.md'
  'server/modules/shopping/receipts/receiptService.js'
  'server/modules/shopping/shared/administrationContract.test.js'
  'server/modules/shopping/shared/catalogCommands.js'
  'server/modules/shopping/shared/catalogResponse.js'
  'server/modules/shopping/shared/contracts.js'
  'server/modules/shopping/shared/errors.js'
  'server/modules/shopping/shared/factsReader.js'
  'server/modules/shopping/shared/httpContracts.js'
  'server/modules/shopping/shared/migrationReadiness.js'
  'server/modules/shopping/shared/migrationReadiness.test.js'
  'server/modules/shopping/shared/persistence.js'
  'server/modules/shopping/shared/persistence.test.js'
  'server/modules/shopping/shared/persistenceErrors.js'
  'server/modules/shopping/shared/preservation.local.test.js'
  'server/modules/shopping/shared/repository.js'
  'server/modules/shopping/shared/requestIdentity.js'
  'server/modules/shopping/shared/workflowCommands.js'
  'server/services/shoppingCommercialProducts.js'
  'server/test/helpers/shoppingAdministrationContractCases.js'
  'server/test/helpers/shoppingBrowserCases.js'
  'server/test/helpers/shoppingCategoryContractCases.js'
  'server/test/helpers/shoppingCutoverRehearsal.js'
  'server/test/helpers/shoppingHttpFixture.js'
  'server/test/helpers/shoppingIntegrationFrontend.js'
  'server/test/helpers/shoppingIsolatedDatabase.js'
  'server/test/helpers/shoppingWorkflowBrowser.js'
  'server/test/helpers/shoppingWorkflowFixture.js'
  'server/test/shoppingAdministrationHttp.local.test.js'
  'server/test/shoppingAdministrationHttp.test.js'
  'server/test/shoppingAdministrationOwner.local.js'
  'server/test/shoppingCutover.local.test.js'
  'server/test/shoppingHierarchyFoundation.test.js'
  'server/test/shoppingHierarchyPostgres.local.test.js'
  'server/test/shoppingIsolationGuard.test.js'
  'server/test/shoppingPersistenceFoundation.test.js'
  'server/test/shoppingWorkflow.local.test.js'
  'server/test/shoppingWorkflowOwner.local.js'
)
$actualPaths = @(git status --porcelain=v1 -uall | ForEach-Object { $_.Substring(3).Replace('\', '/') })
if (@(Compare-Object ($reviewedPaths | Sort-Object) ($actualPaths | Sort-Object)).Count -ne 0) { throw 'Working tree inventory changed; re-audit' }
$expectedStashes = @(
  'a65a74fea220e359032e1635abdcce26ad901a4b'
  'a73f15cf7817d4e2e4e99d9cde3cc43d357f504f'
)
if (@(Compare-Object $expectedStashes @(git stash list --format=%H)).Count -ne 0) { throw 'Stashes changed; investigate' }
git diff --check
if ($LASTEXITCODE -ne 0) { throw 'Diff check failed' }
# OWNER ACTION ONLY: stage these reviewed paths.
git add -- $reviewedPaths
if ($LASTEXITCODE -ne 0) { throw 'Staging failed; inspect index without destructive cleanup' }
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'Staged diff check failed' }
git diff --cached --stat
if (@(Compare-Object ($reviewedPaths | Sort-Object) (@(git diff --cached --name-only) | Sort-Object)).Count -ne 0) { throw 'Unexpected staged paths' }
git diff --cached
```

Read the entire staged diff, rerun the documented relevant checks if edits were
made, and only then perform the separate owner-controlled checkpoint:

```powershell
git commit -m 'feat(shopping): checkpoint hierarchy and workflow integration (#102)'
git status --short
git stash list --format='%H %s'
```

Do not push, tag, merge, rebase or deploy as part of these commands. Keep private
mapping/evidence, screenshots, logs, backups, generated credentials and Docker
artifacts out of Git. The readiness report lists production blockers and the
complete Release / Version gate; owner acceptance and release preparation remain
Pending/Deferred.
