# Shopping catalog administration — Gate 3C.1 / local Gate 3C.2

The separate synthetic preview remains available. Gate 3C.2 also provides an
authenticated, disposable local HTTP/database mode; see
[startup, routes and boundaries](../../../../docs/operations/SHOPPING_HTTP_INTEGRATION.md).
No production route, hosted migration, permission, receipt or purchase change is activated.

## Run in the normal Vite application

From the authorized worktree, install the existing locked client dependencies if
needed (`npm ci --ignore-scripts` in `client`). Existing server dependencies must
also be present because the mock adapter imports the Gate 3A/3B JavaScript domain.
No Supabase credentials are required for the preview.

PowerShell, from `client`:

```powershell
$env:VITE_SHOPPING_ADMIN_PREVIEW='1'
npm run dev -- --host 127.0.0.1 --port 5192 --strictPort
```

Open `http://127.0.0.1:5192/__shopping-preview`. When the flag is enabled, the
existing Settings → Shopping page also offers a preview link. The direct preview
entry avoids importing the normal authentication/API graph. Existing application
routes keep their existing authentication and behavior. Stop Vite to reset all
synthetic edits. No mock changes are saved to disk or represented as real data.

The Vite plugin runs only for `serve` with the explicit process flag. It rejects
non-loopback peers/Host values, cross-origin requests and missing preview markers.
The browser transport has a fixed same-origin preview prefix, omits credentials,
rejects redirects and requires a preview response marker. The separate HTTP
adapter is restricted to the isolated same-origin development gateway.
`import.meta.env.DEV` excludes the entry and Settings link from production builds,
even if the preview flag is accidentally set during a build.

## Boundaries and files

- `settings/`: category, product and list-type screens; scoped RTL CSS.
- `components/`: iterative/paged tree, searchable identity selector and reusable
  edit dialog using the existing shared Dialog, Alert, fields and buttons.
- `hooks/`: explicit discard and browser-navigation protection.
- `services/catalogApi.js`: approved mutation path/method mapping, strong revision
  headers, UUID keys and safe error/retry handling. Preview reads use an aggregate
  `/snapshot` endpoint and `/visibility-preview/:id`; these are development-only
  transport conveniences, **not proposals for new production HTTP endpoints**.
- `preview/`: Node-only memory adapter, public taxonomy fixture and artificial
  product allocation. Uses the existing server `createCatalogCommands`, hierarchy,
  product planning and visibility functions; there is no second browser domain
  engine. The synthetic actor and unconditional mock authorizer cannot authorize
  a real user. In-memory replay is not evidence of durable database persistence.

Fixture totals are 99 categories (74 active, 25 synthetic historical), 173 products
and 21 links. The six initial visibility pairs are 57/144, 11/19, 1/1, 10/21, 9/12,
11/21, derived by the server domain. Product fields, IDs and placement are synthetic;
this is not a production migration or a private catalog snapshot. Duplicate name
groups are review suggestions only, with no merge/delete action.

Category and product removal means deactivation. Historical identities remain
inspectable; inactive ancestors hide descendants from new product selection. The
tree renders only expanded/search/filter rows, in pages of 100, without recursive
components or a logical depth limit. Visual indentation is capped for readability;
full paths and accessibility levels retain actual ancestry. Products paginate by 50.
Direct/subtree counts explicitly count active catalog products even when their
category is hidden; type visibility counts exclude ineffective categories.

Dialogs freeze the revision at draft creation. Focus refresh updates displayed
facts without rebasing drafts. Stale writes require refresh and explicit review;
unknown outcomes retain the exact key/body/revision and disable draft editing until
resolved. There are no optimistic catalog mutations or automatic write retries.
Draft branch selections survive tab/type changes. Cancel/leave requires explicit
discard when dirty. Browser refresh can preserve drafts only if the user chooses
to stay; there is no private draft storage.

## Verification

```powershell
# Focused frontend and Node-only mock tests; no database
npm test -- --run src/features/shopping --maxWorkers=2
npm run build
```

Existing full frontend tests import the normal Supabase singleton. Use dummy
loopback-only values, not credentials, when running them in this worktree:

```powershell
$env:VITE_SUPABASE_URL='http://127.0.0.1:1'
$env:VITE_SUPABASE_ANON_KEY='synthetic-test-only-not-a-credential'
$env:VITE_API_URL='http://127.0.0.1:1'
npm test -- --maxWorkers=2
```

Gate 3A/3B tests remain intact. Gate 3C.2's separately guarded PostgreSQL/HTTP
tests are documented in the integration guide above.

## Production integration still requires owner authorization

1. Activate the approved Express controllers only after the coordinated migration,
   writer/permission cutover and recovery gates. Preserve existing HTTP array shapes.
2. The isolated HTTP adapter now uses category-tree, catalog, list-type, branch,
   visibility and duplicate endpoints, with server paths/counts/scoped ETags.
   Supply reviewed production historical provenance and administrator membership.
3. Existing authentication is connected in isolated mode. Synthetic preview
   responses remain separate from real local persistence evidence.
4. Coordinate external writers and shared invalidation with normal Shopping
   lists/receipts before enabling production UI routes.
5. Complete owner desktop/mobile visual acceptance. Test-DOM keyboard/RTL checks
   do not establish browser rendering, screen-reader or touch-device acceptance.

No release version is reserved or bumped. This dormant development preview has no
released product impact; the eventual integrated feature retains its proposed
Major compatibility impact pending release review on Issue #102.
