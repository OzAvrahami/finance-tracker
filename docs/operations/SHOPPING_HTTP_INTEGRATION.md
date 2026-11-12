# Shopping administration HTTP integration — Gate 3C.2

Local, disposable integration only. The normal `server/index.js` does **not**
register the new router. Production activation, hosted migrations, writer/permission
cutover and Gate 3D require separate owner authorization.

## Contract audit and routes

The [complete Gate 3B.2b matrix](SHOPPING_ADMINISTRATION_CONTRACT.md) remains the
mutation contract. No persistence mismatch or migration change was needed here.
Every mutation uses `createCatalogCommands` and `catalogHttpResponse`: one atomic
RPC and the original recorded status/body/ETag. Legacy identity-only results fail
with 409; controllers never reconstruct an old response from today's row.

All paths below have `/api` prefix and require a verified, authorized administrator.

| Route | Behavior |
| --- | --- |
| GET `/shopping/category-tree` | Full paths, ancestry, descendants, counts; `include_inactive=true` for administration |
| GET `/settings/shopping/catalog-categories` and `/:id` | Category arrays/details; scoped read revision |
| POST `/settings/shopping/catalog-categories` | Create, including optional single `list_type_id`, one transaction; 201 |
| PUT `/settings/shopping/catalog-categories/:id` | Combined name/icon/parent/activity/display order edit; 200 |
| DELETE `/settings/shopping/catalog-categories/:id` | Approved deactivation with identity/dependency protections; 200 |
| GET `/settings/shopping/catalog-items` | Array; search, category/descendants, list type, uncategorized, activity filters |
| GET `/settings/shopping/catalog-items/duplicate-candidates` | Review suggestions only |
| POST `/settings/shopping/catalog-items` | Product creation; 201 |
| PUT `/settings/shopping/catalog-items/:id` | Metadata and/or category in one edit; 200 |
| DELETE `/settings/shopping/catalog-items/:id` | Deactivate, preserving identity; 200 |
| POST `/settings/shopping/catalog-items/bulk-category` | 1–100 products, all-or-nothing; 200 |
| GET `/settings/shopping/list-types` | Existing list-type array |
| GET/PUT `/settings/shopping/list-types/:id/categories` | Branch array/replacement; PUT keeps `{linked}` response |
| GET `/settings/shopping/list-types/:id/visibility` | JS-derived effective IDs/counts; optional `categoryIds` previews a draft without writes |

Category reparenting and activity actions translate to the combined PUT. No extra
business endpoints, hard deletion, merging or type CRUD are introduced. Product
fields, zero/null/omission behavior, If-Match/Idempotency-Key requirements and
400/401/403/404/409/428/503 mappings remain those in the persistence matrix.

Read requests can select an approved `operation` (and product `id` or bulk
`product_ids`) to obtain the existing scoped ETag. Tokens bind actor, operation,
target, selection and current catalog facts. They are concurrency evidence, **not
authentication credentials**. They become stale on catalog change; they have no
invented wall-clock TTL. Auth JWT expiration is independently checked by Supabase
`getUser`. Replay checks the authenticated actor and canonical request before
evaluating new preconditions. No secret headers are stored or replayed.

## Authentication and production isolation

The existing Bearer/getUser middleware is factored into an injectable factory;
legacy responses remain unchanged. The isolated launcher uses fresh local GoTrue
users and explicitly supplies two administrator IDs; a third ordinary user is
denied. Shared catalog scope does not imply new per-user catalog ownership. Client
actor/scope fields cannot select privileges or reuse another actor/entity's token.

The router rejects production mode, non-loopback requests and cross-origin browser
requests. It requires verified disposable identity and an explicit authorizer.
The browser only calls the same-origin authenticated API, never privileged RPCs.
Only the isolated launcher mounts it; no client flag mounts production routes.
The local Auth gateway allows login/refresh, getUser, logout and settings only.
Service-role credentials remain in the isolated server/harness.

Production admin membership and historical-category provenance must be supplied
from separately reviewed server configuration at cutover; synthetic IDs are never
production defaults. Existing routes, frontend purchase writes and legacy SQL
consumers remain unchanged and must be coordinated with the retirement migration.
They are not mounted against the migrated test database as unsafe parallel writers.
Canonical regressions/source comparison verify current-route compatibility; this
does not claim that legacy SQL consumers work after their functions are retired.

## React integration and owner startup

`/__shopping-integration` uses the existing Login, AuthProvider, shared UI and three
administration panels. The HTTP adapter reads approved arrays, checks catalog
revision coherence, acquires scoped ETags and preserves draft revisions. Unknown
outcomes retain the same key/body/token. There are no automatic mutation retries
or optimistic writes. Combined category metadata includes icon/display order;
all saves reload persisted state. A 401 preserves the administration draft instead
of redirecting silently. The independent `__shopping-preview` stays in memory.

Requirements: local Docker Desktop and existing locked client/server dependencies;
cached PostgreSQL 17, PostgREST 16.5 and GoTrue v2.197.0 images. No hosted credentials.
From the authorized worktree in PowerShell:

```powershell
$env:SHOPPING_ISOLATED_TEST='issue-102-disposable'
$env:SHOPPING_059_BASELINE='D:\code\finance-tracker-private-evidence\issue-102\gate3b2b\059_manual_owner_refunds.sql'
$env:SHOPPING_OWNER_EVIDENCE='D:\code\finance-tracker-private-evidence\issue-102\gate3c2-integration\owner'
node server/test/shoppingAdministrationOwner.local.js
```

Use the **actual URL printed by the launcher**, and the generated synthetic login
file outside Git. Ports and credentials are fresh per launch. Ctrl+C destroys only
that launcher's labelled disposable containers/data. Existing Docker objects are
not reset. This creates a new isolated test database and applies 060→061→062 only
after Docker/network/database identity proof. It never loads hosted `.env` keys.
The reviewed 059 file is checksum-verified; no applied identifier is reused.

The Vite gateway proxies only to this loopback server; integration Auth/API URLs
must be same-origin before the auth module loads. Both development entries are
tree-shaken from production even when their VITE flags are set during build.

## Reproducible checks

```powershell
# Same guard and 059 baseline variables as above
node --test server/test/shoppingAdministrationHttp.local.test.js
# Add an existing Playwright module and external evidence directory for real browser checks
$env:SHOPPING_PLAYWRIGHT_MODULE='<absolute installed playwright-core directory>'
$env:SHOPPING_BROWSER_EVIDENCE='D:\code\finance-tracker-private-evidence\issue-102\gate3c2-integration\browser'
node --test server/test/shoppingAdministrationHttp.local.test.js
node --test server/test/shoppingHierarchyPostgres.local.test.js
```

The browser case is explicitly skipped without Playwright; this is not a pass.
It uses real GoTrue login, Express, PostgREST and PostgreSQL, verifies category,
product and branch saves after browser reload, and preserves a stale draft.
Outbound browser traffic is blocked (including the existing Google Fonts CSS).
Screenshots contain synthetic data only and stay outside the repository.
The existing PostgreSQL suite covers fresh/upgrade, migration rollback, SQL/ACL
retirement, concurrency, restart and backup/restore. HTTP mocks are not DB evidence.

Initial synthetic acceptance totals are 99 categories (74 active/25 historical),
173 products, 21 links and 85 preserved list rows. Visibility pairs remain
57/144, 11/19, 1/1, 10/21, 9/12, 11/21. Test writes then deliberately change totals;
the original 85 historical rows remain byte-for-byte unchanged.

Before production: fresh schema/data/ledger/writer/consumer verification, reviewed
production admin authorizer and history provenance, coordinated legacy writer and
permission cutover, verified recovery, separately authorized migration/deployment,
and final owner UX acceptance. No version is reserved or bumped by this package.
