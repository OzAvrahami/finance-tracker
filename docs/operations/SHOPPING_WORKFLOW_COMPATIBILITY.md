# Shopping workflow compatibility — Issue #102, Gate 3E.1

Local implementation only. Nothing in this package registers a replacement in
`server/index.js`, applies a hosted migration, or authorizes production cutover.
The existing deployed controllers remain unchanged. They **cannot** run after
060; switching the writer composition is a mandatory coordinated release step.

## Inventory and contract matrix

Sources: `server/routes/shoppingRoutes.js`, `shoppingIntelligenceRoutes.js`,
`settingsRoutes.js`; `server/controllers/shoppingController.js` and
`shoppingSettingsController.js`; `client/src/services/api.js` and the existing
Shopping/Settings pages. All paths below are under `/api/shopping` except
settings paths under `/api/settings/shopping`. The final Issue report records
execution counts; test names below identify reproducible assertions, not mocks.

Every new route authenticates with the existing Supabase `getUser` middleware
and invokes a mandatory server authorizer before facts or persistence. The
current model is a shared household, not per-list ownership: schema has no list
owner column. Two authorized household actors may work on the same lists; a
third actor is rejected, and a token from one actor cannot authorize another.
Production household/admin configuration remains an activation prerequisite.

`E` below means an actor/operation/resource-bound If-Match from displayed facts;
`K` means Idempotency-Key. Optional K still provides exact durable replay when
supplied. A replay returns original status/body/ETag, even after later edits.
Legacy identity-only records are never fabricated into historical full results.

| Operation / existing caller | Legacy dependency | Replacement and request/response contract | Atomicity, evidence and executable coverage | Result |
|---|---|---|---|---|
| List creation — ShoppingLists/Dialog, POST `/lists` | Direct list INSERT | `lists/listService.header` + `shopping_list_commit`; title/type and optional store/link/date, 201 row; E/K optional | C-S then sorted L; one insertion and ledger. `list create, metadata edit and exact replay after later changes`; normal React browser | PASS: named isolated evidence |
| Metadata/status — detail/Dialog, PUT `/lists/:id` | Direct list UPDATE | Same primitive, only supplied title/type/store/link/date/status; 200 row, E required, K optional | Aggregate revision once; cannot manufacture checked_out. Same test; stale/actor cases | PASS: named isolated evidence |
| Delete — ShoppingLists, DELETE `/lists/:id` | `shopping_delete_draft` | JS dependency decision, fixed delete effect; E required/K optional; 200 success | Draft/active only, no plans/receipts/confirmed/checkouts; cascade removes only eligible list items. `regular preferences, suggestion presence and active-list deletion...`, receipt-history rejection | PASS: named isolated evidence |
| Catalog item addition — QuickEntry, POST `/lists/:id/items` | Direct catalog SELECT/INSERT and list INSERT; optional obsolete name trigger | JS visibility and selected product; `shopping_list_commit`, 201 enriched row; E/K optional | Catalog creation, category creation and list append are one transaction; catalog identity is reused, never edited by list edit. `catalog/custom/name-first appends...`, `invalid atomic append...` | PASS: named isolated evidence |
| Custom/name-first addition — QuickEntry, same POST | `shopping_add_planned_item`, category resolution/flat SQL | JS literal name resolution, explicit category IDs/eligible parent; name-first remains list-only unless save requested | Reject ambiguous repeated names; no invented root; inactive new selection rejected. Same append tests and nested-scope test | PASS: named isolated evidence |
| Edit/remove — ItemRow, PUT/DELETE `/lists/:id/items/:itemId` | Direct list-item UPDATE/DELETE | JS closed field allowlist; quantity/unit/notes/price/planned name/category; 200 row/success; E required/K optional | Matching list/item identity; no global catalog edits. `item editing, reversible keyed toggle...`, competing edits | PASS: named isolated evidence |
| Purchase mark/unmark — ItemRow, PATCH `.../toggle` | Read-then-write direct table race | JS target boolean from frozen facts, fixed persistence; E and K required | One aggregate revision, timestamp on mark/null on unmark, same-key retry never flips twice. Five simultaneous identical requests + competing edits | PASS: named isolated evidence |
| Quantity, controlled/legacy units, prices | Direct item updates; truthiness/default pitfalls | Exact decimal validation, null/omission rules; preserve zero; existing nonstandard unit may be retained | Append/edit/browser zero checks; checkout zero remains a numeric zero | PASS: named isolated evidence |
| Categories/history/neutral — detail and QuickEntry GET `/catalog-categories` | Flat link filtering, `shopping_resolve_entry_category`, category-name trigger | Gate 3A tree/visibility, stable IDs, full paths; historical existing rows rendered, excluded from new selection | Unlimited depth, descendants, intermediate nodes, deduplication; 85-row snapshot equality; new historical assignment rejection | PASS: named isolated evidence |
| Catalog search — QuickEntry GET `/catalog-items` | Flat category membership | JS visible products before search/pagination; existing default suggestion limit 8 and max 20 retained | Gate 3D's 8-versus-144 observation included pagination and was not alone proof of incorrect visibility. Category scope tests and catalog append checks | PASS: named isolated evidence |
| Public category create — QuickEntry POST `/catalog-categories` | Separate category/link writes | JS parent selection + `shopping_catalog_commit` entry.category, 201 row; E/K optional | Eligible parent required; initial type link in same transaction. `list-type metadata and public category creation...` | PASS: named isolated evidence |
| List-type metadata — Settings GET/POST/PUT/DELETE `/list-types` | Direct table writes; dependency check outside transaction | JS `typeCommands` + catalog primitive, 201 create/200 change; E required for edit/deactivate, K optional | C-X compares complete list-reference facts; new types get neutral link, cannot deactivate a type referenced by nonarchived lists. Displayed per-row tokens preserved by settings | PASS: named isolated evidence |
| Category/product administration and branch mappings — existing new panels | Old settings direct writes and separate link replacement | Existing 060–062 Gate 3C.2 administration router, unchanged category/product business engine | `063 preserves 062 administrative bulk and branch atomic contracts`; full 66-case DB suite and prior HTTP suite. Flat settings editor replaced by hierarchy-editor link only in isolated integration mode | PASS: named isolated evidence |
| Regular products — Intelligence PUT/DELETE `/regular-products/:id` | Direct preference table writes | JS catalog eligibility + list primitive regular effect; E required/K optional | Fixed preference persistence and ledger; no catalog mutation. `regular preferences, suggestion presence...` | PASS: named isolated evidence |
| Accept suggestion — Intelligence POST `/lists/:id/suggestions` | `shopping_accept_suggestion` | JS catalog/visibility and existing-row decision + list primitive; E/K optional, 200 row | Repeated acceptance returns existing row without duplicates. Same preference/suggestion test | PASS: named isolated evidence |
| Intelligence read — ReceiptDialog GET `/lists/:id/intelligence` | Snapshot/context/commercial-detail SQL and raw table reads | Raw state + JS list projection, matching, habits, commercial hydration; retained duplicate reader; canonical context helper | Old receipt JSONB/MD5 byte format retained, no new token substituted. `canonical legacy receipt projection bytes...`; receipt flows | PASS: named isolated evidence |
| Receipt upload/progress/reprocess — ReceiptDialog multipart POST `/lists/:id/receipt`, GET progress | `shopping_receipt_command`, `shopping_snapshot` | Same upload limits/extractor, JS list projection and hydration, `shopping_receipt_commit`; body attempt/lease/reprocess-key protocols retained | Receipt identity, immutable plan and previous drafts retained; provider call outside DB locks. Multipart/progress test and draft/reprocess test; provider transport is synthetic, not live OCR evidence | PASS: named isolated evidence |
| Receipt draft — PUT `/lists/:id/receipt/draft` | Retained `shopping_save_receipt_draft` | Receipt primitive takes R/L first, invokes retained draft integrity helper, preserves `{revision}` | Body attempt/revision controls; stale rejected; K replay optional. Draft/reprocess test | PASS: named isolated evidence |
| Receipt confirm — POST `/lists/:id/receipt/confirm` | Retired receipt/commercial engines | Existing JS confirmation/matching/unit/price services through raw-facts adapter, explicit typed commercial effects, receipt primitive | Frozen request, identity, mapping snapshots and confirmed purchases persist atomically. Existing historical product reference allowed; new historical selection rejected. Confirm/replay/history tests; confirmation alone creates no cash | PASS: named isolated evidence |
| Receipt move/duplicate review — POST receipt/move or duplicates | `shopping_move_receipt`; retained duplicates reader | JS source/target projection and canonical context; receipt primitive; duplicate reader unchanged | R then both L IDs sorted, no item deletion, target plan frozen; move test and checkout duplicate checks | PASS: named isolated evidence |
| Commercial lookup — POST `/products/lookup` | `shopping_claim_product_lookup`, direct cache finalize | JS provider/environment, budget, TTL and lease decision; `shopping_lookup_commit` | K then Q only, no catalog/list locks across provider call; stale lease cannot finalize. Lookup/cache/lease tests | PASS: named isolated evidence |
| Approve/map commercial identity — POST products/approve, products/map; GET personal-items/:id/products | approve/detail/command/unit-factor SQL | JS identifier, package/unit conversion, catalog eligibility, raw-facts detail; `shopping_commercial_commit` | Approval E required/K optional; map expected_revision/request_key required, header K must agree. Mapping and optional personal-item create atomic; full HTTP-shaped result stored in transaction. Approval/map/replay test; existing old mapping request semantics retained | PASS: named isolated evidence |
| Checkout — detail POST `/lists/:id/checkout` | `shopping_checkout` | JS frozen projection + narrow checkout primitive; E required for new checkout, K optional; existing natural list replay precedes E | F→K→C-S→R→L; private retained financial tail derives cash from locked table evidence, not JS-supplied money. Zero, concurrent one-cash, receipt-backed cash, malformed-projection and post-insert rollback tests | PASS: named isolated evidence |
| Financial/refund boundary | Transactions, confirmed purchases, receipts, 059 refund classification | No financial module or refund implementation changed | Existing financial regression suite and 059 definition comparison; synthetic Shopping checkout tested. External bank/provider ingestion is not exercised here | PASS: Shopping boundary; external ingestion not applicable |
| Background/external writers | Receipt extraction callbacks, lookup claim/finalize; old backend routes remain registered | Callback replacements above; no additional in-repository scheduled Shopping writer found in source search | Known callbacks covered; hosted schedules, third-party callers and unknown browser versions remain **BLOCKED for cutover** pending complete inventory/fencing | BLOCKED: external coverage; callback tests pass |
| Direct browser Supabase Shopping writes | No such call found in current client source | Browser continues authenticated Express; never receives service role | Real anon/authenticated direct table and six mutation-RPC attempts denied. External or older clients remain unverified | PASS: named isolated evidence |

## Persistence and safety

063 is forward-only after untouched 060/061/062. Hosted ledger remains 055/056/
059 (the applied manual-refund 059 differs from this checkout's historical 059).
The authoring identifier was obtained with Supabase-compatible CLI tooling;
neither an existing migration nor its identifier is reused. Guarded tests use
the verified private 059 definition, without publishing its production evidence.

The new fixed five-argument primitives are list, commercial, receipt, checkout
and lookup commit. The catalog primitive delegates existing 062 operations and
adds only typed list-type metadata and explicit-parent entry-category effects.
They accept no arbitrary table/column names or SQL. Raw readers return facts;
JavaScript decides hierarchy, visibility, matching and conversion. SQL retains
FK/uniqueness, lock-time compare-and-swap, receipt integrity and the explicitly
approved financial-tail exception. All private helpers are revoked, public
commit RPCs are service-role-only, and direct legacy write grants are not restored.

Lock order is F→K→C-S/C-X→R→ascending L→rows. Lock mode is chosen before mutation,
never upgraded. Lookup uses K→Q without C/R/L/F. Every applicable effect and replay
record commits in one transaction. Unknown transport outcomes are reported as
unknown; the frontend preserves exact body/key/token and offers explicit retry.

The normal frontend receives additive operation tokens in displayed reads. It
does not fetch a fresh token at save time to hide a stale draft. Names remain
presentation, never identity. A late list-type load no longer erases a list title
being entered. Receipt-specific attempt/draft/context/reprocess contracts remain
separate from catalog revisions.

## Reproduce safely

Use a local Docker Desktop context and installed project dependencies. No `.env`
is read by the DB harness. Set `SHOPPING_ISOLATED_TEST=issue-102-disposable` and
`SHOPPING_059_BASELINE` to the verified private 059 evidence, then run:

```powershell
node --test server/test/shoppingWorkflow.local.test.js
node --test server/test/shoppingHierarchyPostgres.local.test.js
node --test server/test/shoppingAdministrationHttp.local.test.js
npm test --prefix server
npm test --prefix client
npm run lint --prefix client
npm run build --prefix client
```

For browser coverage set `SHOPPING_PLAYWRIGHT_MODULE` to the installed Playwright
module and `SHOPPING_BROWSER_EVIDENCE` to a directory **outside** this repository.
The harness launches the normal React `/shopping` page, existing Auth and an
isolated Express gateway. It prints the actual dynamic loopback endpoint; never
assume a persistent URL. Optional private mapping topology can be verified with
`SHOPPING_GATE2_MANIFEST`; public test rows use synthetic names and values only.
Frontend tests/builds may require explicit synthetic Vite Supabase configuration
(`http://127.0.0.1:1`, dummy anon key); never supply hosted keys for these checks.

Before writes the harness verifies local Docker transport, unique disposable
labels, internal DB network, no DB port publication/bind mounts, DB identity,
fresh generated credentials, and loopback-only Auth/PostgREST. 063 additionally
requires a matching DB-comment/session guard. Its guarded authoring form is not
a production runner. Release-specific execution guards and writer fencing must
be approved before any hosted migration; 060/061 standalone limitations remain.

## Classification and remaining release dependencies

PASS means the named isolated test demonstrated the path, not production
activation or blanket acceptance of untested variants. The Issue report is the
execution record. External consumer discovery, production identity/RLS and
role configuration, real provider integration, owner UX acceptance, source
checkpoint, release runner, final backup/restore and final mutable-data
reconciliation remain cutover blockers. No private baseline is overwritten.

The deployed old router and flat settings must be fenced and replaced together
with permissions/schema/React during a separately authorized cutover. They must
not coexist as active writers on the migrated schema. No retired SQL engine is
reinstalled to bridge them. Receipt extractor and financial/refund modules stay
in their mature locations; their external integrations are not redesigned here.

## Release / Version gate

- Release impact: Yes — migrates existing Shopping workflows to the hierarchy contracts.
- SemVer impact: Major — incompatible SQL/permission retirement and coordinated client revision requirements.
- Candidate release: Pending (TBD), owner-controlled follow-up in #102; no number reserved.
- Grouping / included release candidate: Pending under #102 with the accumulated hierarchy work.
- CHANGELOG status: Updated under Unreleased, #102.
- Version-bump status: Deferred to owner-authorized release preparation in #102; no metadata changed.
- Publication status: Out of scope; no tag, release, deployment or Git write.
- Owner verification / acceptance status: Pending review; isolated tests are not owner acceptance.
