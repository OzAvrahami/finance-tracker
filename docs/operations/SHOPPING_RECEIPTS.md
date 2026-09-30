# Shopping habits and receipt reconciliation (#92)

Implementation guide. Release-preparation checkpoint (2026-09-30): the owner accepted the name-approval, personal-item mapping and draft-persistence workflow. Earlier pending-acceptance statements below record their dated implementation checkpoints. The initial successful owner extraction and isolated desktop/mobile review are not full OCR or production acceptance. No production migration, configuration or deployment has been performed by this release preparation.

## v1.5.0 deployment preparation

The [prepared release record](../history/RELEASE_1_5_0.md) identifies the exact feature commit and reused tests. The following is an **owner-operated future runbook**, not an executed production procedure. Migrations 039–044 passed isolated/disposable verification only. Repository SQL presence is not an applied-state ledger; see the [database guide](DATABASE.md).

### Prerequisites and cutover order

1. Verify the intended production project and recorded schema through 038 using existing operational evidence and the live catalog. Confirm existing Shopping tables (`shopping_catalog_items`, `shopping_lists`, `shopping_list_items`, `shopping_checkouts`), canonical transactions/categories/payment sources, Savings guards, UUID support and Supabase roles. If any 039–044 objects already exist, reconcile the actual partial state before proceeding; do not blindly rerun files. There is no generic from-empty migration procedure or authoritative repository migration ledger.
2. Obtain a restorable backup/PITR checkpoint and record a rollback decision boundary. Capture read-only before counts/totals and relevant row fingerprints for canonical transactions, Savings, Loans, Budget, Shopping lists/items/checkouts and existing APY provenance. Record any pre-existing receipt/identifier data if upgrading a partial installation. Counts alone are not a backup.
3. Coordinate the owner-managed merge/push and deployment trigger **before** cutover. Automatic Railway/Vercel behavior must be checked in their current settings; this run does not inspect/change them. Pause Shopping mutations and keep old clients from writing throughout migration/backend/frontend cutover, using an owner-controlled maintenance/access window. No Shopping maintenance environment flag is implemented. The old checkout performs multiple writes and must not remain available as a fallback against the upgraded schema.
4. Apply each complete, unchanged SQL file below in ascending order as the database owner through the approved SQL execution path. Submit one full file per transaction. Stop on any error. Earlier successful files remain committed; a failing file rolls back its own transaction. Do not run `full_schema.sql` against production.
5. Perform the postflight below after **all six** migrations. Reload PostgREST's schema cache after successful verification (owner-operated `NOTIFY pgrst, 'reload schema';`). Keep writes paused until the new runtime and schema are both ready.
6. Configure only the documented server variables below through a separately authorized operation. Deploy the backend including the repository-root `shared/` modules it imports, then the matching frontend from the same integrated release commit. Verify `/health`, exact deployment SHA, authenticated read-only Shopping/catalog/list/review routes and existing draft readability. Force old clients to reload before lifting the write pause. Do not use checkout or history confirmation as a casual smoke test.
7. Reopen normal Shopping access only after these checks. Any live OCR, purchase-history confirmation or financial checkout test requires a separate deliberate owner action. Keep both existing Apple/FlowLink ingestion flags unchanged and disabled. Record actual migration/deployment outcomes separately from this preparation.

### Exact migration sequence and effects

Every file explicitly wraps its commands in `BEGIN` / `COMMIT`. Except 043, these are single-run schema upgrades, not idempotent deployment scripts.

| File | Effect and compatibility boundary |
| --- | --- |
| [039](../../server/migrations/039_shopping_purchase_receipts.sql) | Adds regular items, frozen purchase plans, receipts and confirmed purchases; item-write lock trigger and private atomic receipt/checkout/suggestion/deletion commands. Existing checkboxes are not backfilled as confirmed history. |
| [040](../../server/migrations/040_shopping_receipt_photos.sql) | Adds ordered image-hash arrays, constraints/index and updated receipt command. Existing one-image receipts become one-element sets. |
| [041](../../server/migrations/041_shopping_receipt_reprocessing.sql) | Adds reprocessing request identity and bounded previous-draft archive; replaces receipt command, preserving five-attempt and financial safeguards. |
| [042](../../server/migrations/042_shopping_product_identity_prices.sql) | Adds string identifiers, lookup cache, durable draft/revision fields and private lookup/draft/name commands; receipt/checkout replacements retain exact discount handling. |
| [043](../../server/migrations/043_shopping_draft_archive.sql) | Replaces receipt command so live submitted edits take precedence in archives and identical request replay precedes stale-revision rejection. Function-only/repeatable SQL; no reason to rerun routinely. |
| [044](../../server/migrations/044_shopping_personal_commercial.sql) | Adds commercial products and immutable mapping revisions; links existing identifiers, preserving legacy approved names and personal IDs without guessing conversion factors. Extends cache key to provider/environment/code; replaces lookup signature and makes old name-approval signature delegate to name-only approval. Does not rewrite confirmed snapshots or financial rows. |

### Postflight before lifting the write pause

- Verify all eight new relations: `shopping_regular_products`, `shopping_purchase_plans`, `shopping_receipts`, `shopping_confirmed_purchases`, `shopping_product_identifiers`, `shopping_product_lookup_cache`, `shopping_commercial_products`, `shopping_product_mappings`.
- Compare columns, constraints and indexes with the six files: receipt per-list/image identities, 1–6 image hashes, five-attempt bound, draft revision/archive, exact string identifier key, provider/environment/code cache key, immutable commercial/revision primary key and unique mapping request key. Verify `shopping_item_write_lock` on `shopping_list_items` and the **latest** function bodies, not just their names.
- Verify final private RPC signatures, including `shopping_receipt_command(bigint,text,jsonb)`, `shopping_checkout(bigint,bigint,bigint,jsonb)`, `shopping_save_receipt_draft(bigint,integer,integer,jsonb)`, `shopping_claim_product_lookup(text,text,text)` and `shopping_commercial_command(jsonb,uuid)`. The superseded two-argument lookup signature must be absent. Verify the remaining snapshot/duplicate/suggestion/deletion/name helpers against the SQL.
- Verify RLS and no PUBLIC/anon/authenticated access to new tables or private commands; service-role access only through the trusted backend. Mappings permit service-role SELECT/INSERT, not UPDATE/DELETE. Do not mistake the intentionally pure `shopping_gtin_valid(text)` helper for a privileged command. RLS does not constrain service-role authority.
- Compare before/after financial, APY and existing Shopping data snapshots: migration itself creates no cash, confirmed purchases or new Shopping checkouts. Existing receipt photo arrays must preserve image identity; existing drafts/history must remain intact. For an installation with 042-approved identifiers, verify 044's linked commercial records/revision-1 legacy mappings; conversion factors remain unknown, and original catalog IDs/approved names are preserved.
- Stop for unexpected differences, missing privileges/objects, stale PostgREST schema or partial upgrade. Record pass/fail and target identity in an owner-controlled operational record; do not infer success from a deployment health response alone.

### Server configuration

| Variable | Requirement and safe handling |
| --- | --- |
| `SHOPPING_RECEIPT_OPENAI_KEY` | Required for extraction only. Server secret in the owner's deployment secret store; never frontend, repository, URL or logs. No value is generated/changed here. |
| `SHOPPING_RECEIPT_MODEL` | Required for extraction; image input and strict structured JSON support on Chat Completions. Isolated `gpt-5.2` succeeded for tested receipts; verify model access/project budget before enabling production use. |
| `SHOPPING_PRODUCT_LOOKUP_ENV` | Explicitly choose `staging` (default Food Facts `.net`) or `production` (public Food Facts `.org`). Provider/environment caches remain separate. The explicitly selected Open Products Facts adapter uses its public `.org` catalog regardless of Food Facts staging selection. No private catalog key required. |

Existing server Supabase/auth configuration remains unchanged. Complete catalog provider API-use declaration and retain attribution/licensing before public rollout. Extraction sends receipt images to the configured provider; configure project spending limits. One scan can make up to six per-photo provider calls, not one call for the complete receipt. JPEG/PNG limits are 8 MiB each, 24 MiB total, six images; retry/reprocess has five persisted attempts. `store:false` is implemented but is not a promise about all provider retention policies. Missing OCR configuration leaves extraction unavailable with an actionable configuration error; it does not require disabling ordinary lists or draft/catalog workflows.

### Recovery

Before first new feature writes, retain the upgraded schema and keep Shopping unavailable while correcting migration/deployment failures. A backup restore is a separately reviewed owner operation, not an automatic script. Never retry a single-run migration without first establishing whether it committed.

After any receipt, confirmation, mapping or atomic checkout data exists, retain schema, drafts, occurrence identities, archives and history and forward-fix the runtime. Do not drop the new relations, reset attempts, clear owner corrections, replay confirmation with a new key, or revert to old non-atomic checkout/deletion behavior. A financial discrepancy requires stopping further Shopping writes and reconciling the existing identifiers/transaction, not creating a replacement expense blindly.

## Personal items and commercial products — current model

The existing `shopping_catalog_items` are **personal planning items**, retaining their category, preferred name/default unit, regular-product settings and usual quantity. They are not a SKU catalog. Migration [044](../../server/migrations/044_shopping_personal_commercial.sql) adds exact commercial products and revisioned owner-approved relationships; it does not create a second personal catalog or identifier system.

| Structure | Meaning and compatibility |
| --- | --- |
| `shopping_commercial_products` | UUID identity, receipt name, separately approved full name, brand, optional known package quantity/unit, bounded provenance and current mapping revision. An unidentified receipt line can remain unresolved without creating any catalog record. |
| Existing `shopping_product_identifiers` | String code, GTIN or retailer-scoped internal SKU, unique by kind/scope/code, now referencing a commercial product. Existing approval columns remain legacy evidence. No barcode is a purchase-occurrence identity. |
| `shopping_product_mappings` | Immutable `(commercial_product_id, revision)` snapshots of personal item, name, planning unit, receipt unit and optional conversion factor. Owner audit and unique request UUID support safe retries. Several products may point to one personal item. |
| Existing receipt drafts/history | Every occurrence retains its stable row ID, original text/code, source evidence, raw/chosen price breakdown and optional frozen mapping revision. Migration does not rewrite receipt JSON, confirmed history, original plans or cash. |

`shopping_commercial_command` serializes name/mapping commands with the existing Shopping command lock. Name approval creates/updates only the commercial product; linking creates a mapping (and a personal item only when explicitly requested). Neither creates a regular-product setting, confirms a purchase nor posts an expense. RLS/revokes prohibit direct browser access; private commands remain service-role only behind existing shared application authentication. No multi-user authority is introduced. Old identifier approvals are backfilled into commercial products and legacy mapping revisions with **unknown conversion**; old catalog IDs and old confirmed JSON are unchanged. 044 is a single-run transactional forward migration after 043, applied only to isolated/disposable databases. Do not edit applied migrations or remove evidence on rollback; retain schema and forward-fix.

### Mapping and quantity decisions

- Only explicit owner selection links a product. Exact-name candidates are suggestions, never automatic grouping; lactose-free, plant-based, dietary/flavor variants remain separate unless explicitly grouped.
- Equivalent canonical units convert exactly (`ml/l`, `g/kg`). Unit/package to volume/weight needs known single-package contents, or an explicit owner factor. Multipack descriptions are not guessed. Missing/incompatible conversions remain unresolved and editable; receipt quantity/money never changes through mapping.
- Two one-liter cartons of one brand plus one of another can fulfill three liters of one personal milk item. All three purchase occurrences survive. Confirmed history aggregates compatible quantities per personal item **once per trip**, not once per brand/row. Sparse/unknown quantity history is labelled honestly; no pantry stock is inferred.
- Mappings are frozen on new extraction and preserved in saved/confirmed snapshots. Changing a mapping affects future captures and explicitly remapped unconfirmed rows only. It does not rewrite existing saved reconciliation or confirmed history. A previously unmapped legacy row can acquire the current approved mapping on read until its draft is saved. Confirmation validates the stored revision/code and recomputes planning quantity from the immutable revision; it does not trust client conversion totals.
- Name approval, linking and purchase confirmation remain three independent actions. Explicit owner name corrections win over catalog enrichment. Changing a lookup code clears the row's stale proposal/mapping, retaining its original printed code and all prices.

### Compact interface and APIs

The eight-column editable table remains primary. **איתור שמות מוצרים** requests exact-code proposals with a visible progress/stop control. **אישור שם** approves one proposal; it does not link the product. Existing row details contain **שיוך לפריט אישי**, with existing/new personal-item selection and conversion controls. **המוצרים המקושרים לפריטים שלי** in Shopping lists current linked commercial products and permits explicit future mapping changes. No per-row modal or compulsory metadata panel is introduced.

- `POST /api/shopping/products/lookup`: approved local names first, then bounded external lookup. Proposed external names are not automatically applied/approved.
- `POST /api/shopping/products/approve`: name-only commercial approval, preserving personal names/regular settings/history.
- `POST /api/shopping/products/map`: exact identifier, personal ID or explicit new-item request, expected mapping revision, request UUID and conversion evidence. Same request replays; conflicting/stale requests fail.
- `GET /api/shopping/personal-items/:id/products`: current links, safe product/mapping details. Existing draft/confirmation/checkout routes retain their separate boundaries.

### Provider evidence and coverage

The [official API documentation](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/) specifies API v3, identification and usage requirements. The [complementary-products documentation](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/scanning-cosmetics-pet-food-and-other-products/) documents Open Products Facts for non-food products. Both adapters send only an exact barcode and requested public fields, use the shared 12/minute DB lease, timeout and exact-code checks, and retain source/license attribution. Complete the provider usage declaration before production rollout. No paid service or scraping dependency was added.

Food Facts uses `SHOPPING_PRODUCT_LOOKUP_ENV` (default **staging**, `.net`; deliberate public-catalog selection `.org`). Products Facts has no verified/documented `.net` staging endpoint (DNS lookup failed), so its explicitly selected adapter uses its documented **public `.org` catalog**, labelled `production` **catalog environment**, not the application database. It sends no staging Authorization header. Caches are partitioned by provider/environment/code. This does not access Finance Tracker production. All application data remains isolated. Food staging results are not presented as production coverage.

Measured against latest draft revision 2: **69 rows / 68 unique codes / 57 valid GTINs**. Local approved matches: **0**. Food Facts **staging**: **32 exact external results, 15 usable Hebrew names, 17 original-language names, 25 missing, 0 failed**. Eleven codes are ineligible for global lookup (short retailer codes or invalid GTIN); none has been repaired or guessed. No row lacks a code. A complementary read of wipes `7290109060385` on Products Facts public `.org` returned **404**; household coverage remains unproven, not successful. Retailer codes require explicit retailer scope and owner knowledge.

Representative proposals, none approved by this run:

| Code | Sourced proposal | Mapping decision |
| --- | --- | --- |
| `5711953148347` | גבינת שמנת בטעם טבעי · Arla (Food Facts staging, Hebrew) | Owner may select an appropriate personal cream-cheese item; no automatic name-based grouping. |
| `7622210453327` | Cookies Sensations · Milka, Mondelez · 156 g (staging) | Preserve this exact product; do not merge with the next cookie. |
| `7622300356767` | Choco Cookie · Milka · 168g (staging) | Separate commercial identity; sharing a personal item is an explicit owner choice. |
| `4823077633317` | Lovita Classic Cookies Dark Cocoa · Roshen · 150g (staging) | Preserve each separately printed purchase occurrence. |

### Current owner draft and verification

The newer owner-saved draft supersedes earlier totals/decision lists below: **revision 2, 69 rows, attempt 5/5, total 1,262.21, printed 1,262.21, discrepancy 0.00**. Its entire persisted receipt, raw extraction, owner edits/deletions, original plan, confirmed-history and cash fingerprints were preserved. No old pending correction was reapplied.

Focused evidence: server/API/habits/overlap/extractor 63/63, then updated provider tests 11/11 and HTTP tests 18/18; disposable PostgreSQL 29/29 through 044 (including concurrent mapping replay, historical snapshots and unchanged checkout); client 25/25, then mapping/table follow-up 6/6 (one added test); production client build and targeted ESLint passed. Actual isolated app desktop 1440×1000/mobile 390×844 displays 9/7 editable rows immediately, supports Tab into quantity, horizontal scrolling, sticky product/header, Escape/focus return, and leaves confirmation disabled until deliberate review. New owner mapping/name approval still requires owner acceptance; none was performed on the owner receipt. No OCR/LLM, rescan, attempt reset, financial operation or production change.

Owner test: open **http://localhost:5173**, Shopping, existing list, **בדיקת קבלה**. Inspect sourced name proposals and their details; optionally approve a name separately. In row details link two known one-liter products to one personal milk item; verify planning liters while actual rows/prices remain separate. Inspect/change links under **המוצרים המקושרים לפריטים שלי**. Save the draft to preserve intentional review changes. Do not rescan at 5/5. History confirmation and checkout remain separate owner actions, not required to inspect this increment.

## Earlier identifier/draft increment (historical evidence)

The following records describe the previous implementation checkpoint. The personal/commercial separation and latest draft evidence above supersede its catalog-approval semantics and remaining-decision list.

Migration [042](../../server/migrations/042_shopping_product_identity_prices.sql) follows the already test-applied 039–041 without rewriting them. It is applied only to the isolated application/disposable test databases. It adds `shopping_product_identifiers` (approved local catalog mapping), `shopping_product_lookup_cache` (bounded provider lease/results), and receipt `review_draft`/`draft_revision`. Tables use RLS with no PUBLIC/anon/authenticated access; private functions are service-role only. Existing shared-user authentication remains unchanged. There is no data backfill or financial write merely from migration.

`shopping_save_receipt_draft` serializes with existing Shopping commands, checks extraction attempt and draft revision, and returns the same revision on identical replay. A conflicting tab receives `receipt_stale`; its local edits stay visible. Saved drafts retain deletions, owner-edited fields, source readings, stable occurrence IDs, product attribution and prices. Reprocessing archives the complete current draft; it still requires photos and an available attempt. Preserve the schema/drafts on forward recovery; do not drop evidence or reset attempts. The migration is single-run and transactionally rejects a rerun. The consolidated schema includes the same definition for disposable verification.

[Migration 043](../../server/migrations/043_shopping_draft_archive.sql) is a forward function correction after the test-applied 042: newer submitted on-screen edits take precedence over the last saved draft when archiving; saved state is the fallback only if no live draft is supplied. Same-key replay precedes current-draft revision checks, including when a newer draft has since been saved. New/replacement attempts still reject a stale draft revision. No data rewrite, attempt reset or OCR occurs. 043 uses `CREATE OR REPLACE` transactionally and is repeatable; 042's bytes remain unchanged. Applied only to isolated/disposable databases.

### Identifiers and full names

- Printed `product_code` and `original_name` remain source evidence. `lookup_code`, `resolved_product`, lookup source, and explicit owner overrides are separate. Codes are strings, including leading zeros. A product code is **not** a purchase-occurrence ID: repeated printed purchases are never merged by lookup.
- GTIN-8/12/13/14 requires exact length/check digit. No digits are repaired or added. A checksum is only syntactic evidence; the owner still checks product/variant/package identity. Retailer codes require explicit `retailer` kind and a normalized retailer scope; they never fall through to a global barcode search.
- Lookup checks approved local mappings first. The small [provider boundary](../../server/services/shoppingProductLookup.js) uses Open Food Facts **API v3**, a fixed origin and exact returned code. It prefers an available Hebrew name; otherwise it retains the provider's original-language name, brand and package size without inventing translations. Unsupported/missing products retain the receipt name. Owner-edited names and explicit catalog matches win over automatic read enrichment.
- In row details, **חיפוש שם מלא** requests a lookup; **אישור שם וקוד לקטלוג** explicitly persists the owner-approved name and identifier (select a category for a new catalog product). This is catalog approval, not purchase-history approval. Future lists use that catalog name. Conflicting existing mappings are rejected rather than silently moved to another product.
- Requests: `POST /api/shopping/products/lookup`, `POST /api/shopping/products/approve`, and `PUT /api/shopping/lists/:id/receipt/draft`. Authenticated application only; no public mobile credential surface. Lookup sends only the code and requested public fields, never receipt photos, prices or purchase history.

Official references: [API usage/rate limits](https://openfoodfacts.github.io/openfoodfacts-server/api/) and [v3 product endpoint](https://openfoodfacts.github.io/documentation/docs/Product-Opener/v3/products/get-api-v3-product-code/). The implementation identifies Finance Tracker in its User-Agent, uses an eight-second timeout, rejects redirects and mismatched codes, and caps shared outbound requests at **12/minute** (below the documented 15 read requests/min/IP). Concurrent same-code calls share a DB lease. Found results cache for 30 days, missing results for one day, transient failures for five minutes. GET review enrichment uses only existing cache/local mappings, with no outbound lookup. Row details retain source links and ODbL/DbCL attribution; follow the provider's reuse/attribution/share-alike requirements and complete its API-use declaration before production use.

`SHOPPING_PRODUCT_LOOKUP_ENV=staging` is the safe default (public provider test endpoint `.net`); use `production` only for deliberate production configuration (`.org`). No private API key is required. Staging/production caches are separate. This setting is independent from `SHOPPING_RECEIPT_OPENAI_KEY` and `SHOPPING_RECEIPT_MODEL`; this increment made **no OCR/LLM calls**.

Actual lookup evidence: eight barcode-only HTTP calls total (four boundary checks and four normal application requests to populate the cache). Two of the four distinct exact identifiers were found on the provider's staging endpoint:

| Exact code | Result |
| --- | --- |
| `7622210453327` | Cookies Sensations · Milka, Mondelez · 156 g; no Hebrew name supplied |
| `7622300356767` | Choco Cookie · Milka · 168g; no Hebrew name supplied |
| `7290109060385` | Missing; owner-corrected wipes name retained |
| `7290112349736` | Missing; receipt sauce name retained |

This is 2/4 coverage for this tested subset, not a claim of full receipt/production coverage. Open Food Facts is food-focused; household products are not reliably covered. No actual owner catalog approval was performed during verification.

### Price meaning and editing

The compact RTL table has eight columns: product, quantity, unit, original unit price, **discount for the entire row**, net unit price, final total, actions. Raw printed gross/discount/percentage/promotion are separate from derived values and available through row details. Unknown does not mean zero. Existing saved `price` remains **net unit price** (`legacy_net`); displaying a printed discount never subtracts it twice. Name enrichment changes none of these values.

The shared [exact pricing module](../../shared/receiptPricing.mjs) uses decimal strings/BigInt (quantity thousandths, money cents). Legacy totals retain sum-then-round behavior. Editing original unit price or whole-row discount selects `line_discount`: printed gross (or explicitly edited original unit price × quantity) minus the row discount yields final total. Unit prices are derived only if exactly representable to cents. Weighted rows with an exact final total but nonrepresentable net unit price keep that unit cell unresolved and retain the valid final total for confirmation/checkout. Editing net unit price explicitly returns to legacy net arithmetic. Clearing a value preserves unknown state. Discount exceeding gross rejects; inconsistent chosen net values show a compact source discrepancy marker without overwriting owner edits.

Future extraction can retain printed percentages/promotion text and receipt-wide adjustments separately. Percentages/promotions are not guessed into monetary values. Unallocated receipt-wide adjustments remain visible in receipt details and block the UI's history confirmation pending explicit reconciliation; automatic allocation is not implemented. Never insert a balancing adjustment. Confirmed line-discount totals are recomputed server-side and checked in the private command; checkout uses those final totals once. Receipt confirmation after checkout still cannot rewrite/duplicate the existing expense.

### Current owner draft and remaining decisions

The owner's locally exported draft was verified before frontend refresh and saved through the normal authenticated isolated draft API: **70 rows**, attempt **5/5**, draft revision **1**, no confirmation. Original rows 59/60 remain removed; all five edited rows and chosen name/quantity/unit/net-price values were compared exactly. Original extraction still has 72 source candidates. Current chosen total is **1,308.21**, printed **1,262.21**, excess **46.00**. Earlier totals below are historical checkpoints.

| Stable occurrence / source | Current owner values | Evidence-supported proposal, not applied |
| --- | --- | --- |
| `a5:p3l20-p4l3`, `7622210453327`, chocolate-chip cookies; photo 3 occurrence 20 / photo 4 occurrence 3 | quantity 2 × net 13.00 = 26.00 | One printed pack, gross 16.90 − discount 3.90 = 13.00; quantity 1 would reduce total by 13.00 |
| `a5:p3l21-p4l4`, `7622300356767`, chocolate cookies; photo 3 occurrence 21 / photo 4 occurrence 4 | quantity 2 × net 13.00 = 26.00 | Separate product, one printed pack; quantity 1 would reduce total by 13.00 |
| `a5:p3l26-p4l9`, `7290109060385`, owner name `מטליות לחות לניקוי רצפות פרפקט` | quantity 2 × net 7.50 = 15.00; discount unresolved | Printed gross 30.20 − whole-row discount 15.20; original unit price 15.10, no change to current final total |
| `a5:p2l1`, clipped sauce copy | quantity 2 × net 10.00 = 20.00 | Possible duplicate of retained `a5:p1l13`, code `7290112349736`; removal only after owner confirmation would reduce total by 20.00 |

Conditional bridge: **1,308.21 − 13.00 − 13.00 − 20.00 = 1,262.21**; no unexplained remainder if the owner accepts these evidence-supported decisions. None was applied. Both different cookie products and both genuinely printed Lovita occurrences (`a5:p3l18`, `a5:p3l19`) remain separate. No additional rows were deleted, attempts reset, purchase history confirmed or checkout performed.

Owner review: open the same isolated list at **http://localhost:5173** and **בדיקת קבלה**. Saved corrections/deletions now survive reopening. Inspect full names and source details; review original/net prices and whole-row discounts. Save draft to preserve further changes. Do not rescan at attempt 5/5. History confirmation and financial checkout remain separate deliberate actions.

Verification for this increment: focused server/API/habits **54/54**, Shopping disposable PostgreSQL **23/23** through 042, then the focused forward-upgrade/archive checks through 043 **2/2**; focused client **22/22**. Client production build passed with the existing chunk-size advisory; targeted ESLint passed. Real isolated browser inspection at 1440×1000 and 390×844 showed 13/11 immediately visible rows, Tab from product to quantity, horizontal scrolling/sticky header/product, Escape/focus return, and unchecked confirmation disabled. Owner export vs saved draft values/deletions compared exactly; raw receipt/attempt/backups/timestamps, cash, confirmed history and original-plan fingerprints remain unchanged. No new OCR/LLM calls, confirmation, checkout or production operation. Full acceptance remains pending. One older provider-fixture assertion was updated to verify the already-implemented extraction usage metadata separately while retaining exact candidate-data equality; the passing result does not depend on a live OCR request.

## Existing flow and confirmed history

[Shopping controller](../../server/controllers/shoppingController.js) previously created a transaction, checkout row and closed status in three independent writes. List membership and `is_purchased`/`purchased_at` are checklist state, not reliable historical proof. Existing checkouts prove financial checkout but have no immutable line snapshot: **no historical checkbox backfill is attempted**.

The existing shared authenticated application remains the ownership boundary (`requireAuth` before `/api/shopping` in [server/index.js](../../server/index.js)). This does not implement tenancy. New tables/private RPCs deny PUBLIC/anon/authenticated access and allow the trusted service role.

## User flow and limitations

Inside a Shopping list, regular products and suggestions remain in the expandable panel. Use the separate **סריקת קבלה** / **בדיקת קבלה** entry point to open the receipt dialog. Select regular catalog products with usual quantities/units; new products use the existing add-item/catalog flow. Edit/accept suggestions individually, generate them together, or skip them for the current visit. Remove accepted suggestions through ordinary item removal. Regular settings persist; skipped suggestions reset when leaving the list.

Suggestions use the latest **500 explicitly confirmed shopping events**, not checkbox timestamps. A regular setting overrides the last confirmed quantity/unit. One/two distinct dates produce a sparse-history explanation; three or more produce the median interval between distinct purchase dates. Non-regular products are suggested when due; explicit regulars remain available. No household stock is inferred. Unmatched receipt products do not train catalog suggestions. Catalog scope follows list-type/category links.

Select 1–6 JPEG/PNG photos of **one** receipt, each <=8 MiB and combined <=24 MiB. Add more before scanning, remove or reorder via labeled buttons and previews. Each section is transcribed independently, then adjacent printed sequences are reconciled into one result in the displayed order (maximum two simultaneous provider requests). Camera photos may be selected from the photo picker; HEIC/PDF are unsupported. The first upload or checkout freezes the current list in `shopping_purchase_plans`. This is the plan **at that checkpoint**, not a reconstructed earlier list. Later edits cannot rewrite it; historical lists first reviewed now cannot recover an unavailable pre-shopping snapshot.

Extracted names, quantities, units, **unit prices** and catalog matches are editable. Exact unique normalized-name matches remain suggestions requiring review. Shared significant words flag possible substitutions only. Missing planned lines mean *not recognized*, not proof of non-purchase. Add missed lines/remove false ones. Supply the actual purchase date and missing prices (zero only if genuinely free), then explicitly confirm. Unsaved corrections remain local form state. Switching photo/review views preserves them. Save draft, or explicitly save on close, persists the complete retained-row set and corrections without confirmation. Reload restores the saved draft; unsaved changes still require saving before leaving (browser unload warning where supported). Draft revision and extraction attempt checks reject stale tabs without overwriting either draft. The dialog has a scrollable body, action footer/line total, desktop wide layout and full-screen mobile layout. It reuses the existing focus trap/return-focus/confirmation components. Original extraction remains in the database.

Confirmation records **one purchase-history event per list**, without an expense. Original extraction, frozen plan and confirmed actuals remain separate. Confirmation is final: identical retries return the same result; conflicting retries reject. Financial checkout remains a separate dialog and uses confirmed receipt lines when available, otherwise checked list items. After checkout, confirmation replaces only the history snapshot; the existing expense is neither changed nor duplicated. Financial corrections use the existing Transactions workflow.

Initial boundary: **one trip/receipt per list, ILS receipts only**. Exact image hashes are globally unique across lists; identical reuploads reuse the receipt or reject a different-list association. Different photos are compared using all three printed fields: merchant/branch label, receipt number, and printed purchase date. Extraction preserves these nullable fields; the owner can correct them before confirmation. A match is only a **likely duplicate warning**, not identity proof. The UI displays the other list title/ID, reference/date, confirmed-history state, and existing checkout expense/total. Confirmation AND checkout require explicit acknowledgment of the displayed receipt IDs as distinct purchases. If it is the same purchase, stop and use the original list. Missing/unreadable/differently transcribed identifiers cannot reliably detect duplicate photos; this limitation is also visible in both dialogs. Receipt review never silently merges purchases. No merchant/date/amount fingerprint is a unique purchase identity. Multi-photo sections are supported, but post-confirmation amendments, pantry inventory and ordering integrations are not implemented. Adjacent-photo printed-code sequences now resolve confident physical overlap automatically (algorithm and evidence below). Genuine repeated printed lines are retained. Uncertain overlaps retain candidate lines and source evidence under a compact row marker for review; no global name/price deduplication is applied.

## Persistence and concurrency

[Migration 039](../../server/migrations/039_shopping_purchase_receipts.sql) adds:

| Relation | Identity and purpose |
| --- | --- |
| `shopping_regular_products` | Catalog product PK, positive usual quantity/unit |
| `shopping_purchase_plans` | List PK/FK, original JSON line snapshot |
| `shopping_receipts` | UUID PK; unique list and SHA-256 image hash; extraction attempts, original extraction, final confirmation |
| `shopping_confirmed_purchases` | List PK/FK; date/lines, checkout or receipt basis, unique receipt FK |

`shopping_receipt_command` and `shopping_checkout` first acquire transaction advisory lock `390092`, then the list row. This small shared-household boundary serializes cross-list extraction/confirmation/checkout decisions; all candidate checks are repeated inside the write transaction. Newly discovered candidates cause `receipt_duplicate_review_required` (409) instead of accepting a stale screen acknowledgment. Same-result retries return before the new review check because they have zero new effects. Checkout waits for extraction to finish (`receipt_processing`) rather than outrunning identifier detection. `shopping_receipt_duplicates` is a private read-only comparison RPC; merchant whitespace/case and reference case are normalized, never punctuation/digits/fuzzy amounts. `shopping_receipt_command` also serializes commands on the list row. No network call occurs inside a database transaction. Processing leases last two minutes; attempt numbers reject stale workers; maximum five attempts. Failed extraction can retry/replace the image while retaining the plan. Image bytes are held in browser memory for previews/retry and server memory during the request, **not persisted** to disk/in DB; reselect all sections after refresh/restart. Blob previews are revoked when no longer displayed. Requests accept at most six bounded files; combined size is validated before any RPC/provider request.

`shopping_checkout` locks the same list, validates ordinary expense category/payment source, uses PostgreSQL NUMERIC totals, and atomically inserts transaction + checkout + missing purchase snapshot + closed status. Existing unique checkout/list identity remains. Same financial-link replay returns the original transaction; conflicting links reject. No Loan/Savings/APY commands or Budget allocations run. Readers consume one canonical expense. `shopping_item_write_lock` serializes item edits with checkout and blocks closed-row changes. Existing transaction guards remain; a financial void is not interpreted as a grocery return/refund.

`shopping_accept_suggestion` locks the list and returns an existing catalog item without adding/incrementing it. Legacy duplicate rows are not deleted. `shopping_delete_draft` rejects deleting lists with plan/checkout evidence; archive them instead. Nothing cascades away confirmed history.

## APIs (authenticated `/api/shopping`)

- `GET /lists/:id/intelligence`: scoped catalog, regulars, suggestions, frozen plan, receipt/reconciliation.
- `PUT /regular-products/:product`: `{quantity, unit}`; `DELETE` removes the preference.
- `POST /lists/:id/suggestions`: `{catalog_item_id, quantity, unit}`; idempotent add.
- `POST /lists/:id/receipt`: multipart repeated `receipt` fields in display order plus `expected_attempt` (0 initially, current attempts when replacing). Explicit reprocessing adds `reprocess=true`, UUID `reprocess_key`, and a bounded JSON `review_draft` snapshot (items/identity/purchase_date); 10 uploads / 15 minutes / IP, plus existing API limits.
- `POST /lists/:id/receipt/duplicates`: `{identity?: {merchant, receipt_number, purchase_date}}`; nullable printed fields, defaults to saved receipt. Returns candidates only; no history/cash writes. Merchant <=200, reference <=100, real printed date YYYY-MM-DD.
- `POST /lists/:id/receipt/confirm`: `{purchase_date: "YYYY-MM-DD", reviewed: true, extraction_attempt: 1, items: [{name, quantity, unit, price, catalog_item_id}]}`. Optional `identity` holds corrected printed fields; `duplicate_reviewed_ids` is a bounded array of UUIDs explicitly acknowledged as distinct purchases. Checkout accepts the same optional acknowledgment list and independently rechecks. Catalog ID may be null. Exact decimal text: positive quantity <=10000/3 decimals, nonnegative price <=10000/2 decimals; name <=200, unit <=30, 1–200 lines. Unknown fields reject.
- Existing `POST /lists/:id/checkout` delegates to the atomic command, retaining `checkout`, `transaction_id`, `total_amount`, with additive `replay`.

Validation 400; unsupported image 415; upload limits 413; conflicts/processing/attempt exhaustion 409; unreadable extraction 422; rate limit 429; provider failure 502; unconfigured/service unavailable 503. No credentials, images or provider exceptions in responses/logs. Missing migration fails closed, without unsafe checkout fallback.

## Provider configuration, privacy and cost

No OCR integration existed. [shoppingReceiptExtractor.js](../../server/services/shoppingReceiptExtractor.js) calls OpenAI Chat Completions over HTTPS with image input, strict structured output and `store: false`, using Node fetch. No dependency/microservice was added.

Server-only variables in [server/.env.example](../../server/.env.example):

- `SHOPPING_RECEIPT_OPENAI_KEY`: owner-provisioned provider key; never client-side/tracked.
- `SHOPPING_RECEIPT_MODEL`: explicitly selected image + structured-output-compatible model (for example `gpt-4o-mini`, if available to the owner's project). No silent model fallback.

Both blank disables extraction with `receipt_provider_unconfigured`. Each photo has a maximum 60-second timeout and 7,000-output-token cap; the entire photo set shares a 90-second deadline, below the two-minute extraction lease. Photo/line counts are bounded; there is no tool execution. Image instructions are data; output is untrusted until validation/human review. Upload only necessary receipt information. Images leave the server only after explicit upload; `store: false` does not promise zero provider retention.

This is **paid API usage**, with model/resolution/length-dependent image/input/output token charges. Retries may incur cost. Set provider project spending limits before enabling. See [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [image inputs](https://developers.openai.com/api/docs/guides/images-vision), [pricing](https://openai.com/api/pricing/) and [data controls](https://platform.openai.com/docs/guides/your-data). Authorized live provider diagnostics have now been performed with the owner-supplied photos; see the dated evidence below. One scan now makes one paid request per photo, up to six, with no automatic provider retry or model fallback. This can cost more than the earlier combined-image request. Accuracy and cost remain owner review gates.

## Migration, verification and recovery

039 follows current 038. [Migration 040](../../server/migrations/040_shopping_receipt_photos.sql) is a separate forward extension for already-applied 039: adds `shopping_receipts.image_hashes` (1–6) and a GIN overlap index, backfills each old single-image hash, and replaces only `shopping_receipt_command`, preserving service-only grants. It does not rewrite plans, confirmed history or financial rows. Do not rerun/edit 039 to upgrade. Apply 040 once before this client/server; rerun fails and rolls back. The isolated database was upgraded and cash/history/plan fingerprints stayed unchanged.

040 uses an ordered photo-set digest (single photo retains its original digest), plus per-photo hashes to preserve exact-image cross-list protection even inside a multi-photo set. Reordering/replacing sections advances `attempts`, clears stale extracted data, and requires the current expected revision. A completed same-set replay returns its existing extraction. Confirmations require `extraction_attempt`; stale workers/review screens fail closed. Confirmed receipts are immutable. A local photo edit immediately blocks confirmation until extraction of that selection succeeds. A re-extraction requires explicit acknowledgment before discarding corrections. The original plan remains frozen across replacements; five total extraction attempts remain the bound.

039 is one explicit transaction, intentionally single-run: rerun stops at existing relations and rolls back. Do not rerun after success or edit previous migrations. [full_schema.sql](../../server/full_schema.sql) includes identical SQL as a reference, not evidence of production application. No existing cash/history backfill or rewrite.

Apply only after separately authorized owner preflight; schema precedes the new runtime. Once evidence exists, retain relations and atomic checkout and forward-fix. Do not drop history or return to non-atomic checkout. Disabling OCR config is a separate owner operation and does not remove reviewed records.

```powershell
node --test server/test/shoppingIntelligence.test.js server/test/shoppingReceiptHttp.test.js server/test/shoppingListFields.test.js
node --test server/test/shoppingPurchasePostgres.local.test.js
npm test --prefix server
npm test --prefix client -- --run src/pages/Shopping/Shopping.test.jsx src/pages/Shopping/ShoppingIntelligence.test.jsx
npm run build --prefix client
```

PostgreSQL tests use a disposable Docker container, no host ports/application `.env`, covering final-schema installation/038 upgrade, rollback, confirmation/checkout races, plan preservation, exact-image dedupe, post-checkout history replacement and grants. Provider HTTP is substituted only in tests. Owner review separately covers real receipt quality, discounts/quantity interpretation, Hebrew RTL/mobile/themes and deliberate checkout.

## Owner testing environment — 2026-09-30

A separate disposable Supabase project **finance-shopping92** was prepared at `%TEMP%\finance-shopping92`. It uses API **55421**, database **55422** (not LifeOS 54321/54322), local Supabase Auth and real PostgREST. The schema reference through 038 and migrations 039 then 040 were installed on this isolated database only, with synthetic catalog/list data and zero initial financial transactions. This is a verified test installation, not a production migration procedure/ledger. Existing LifeOS containers and the normal `.env` files were left unchanged.

The normal application runs at **http://localhost:5173**, backend **http://localhost:5050**. Launchers explicitly load ignored `server/shopping92.env.local` and `client/shopping92.env.local`; they refuse a non-local Supabase URL. These files are **not** loaded by normal `npm run dev` automatically. Normal `.env` still targets a non-loopback Supabase and must not be used for these tests.

- Local-only login details: open `%TEMP%\finance-shopping92\owner-login.txt` on this computer. Do not use production credentials.
- Both provider variables are now configured in the isolated test environment (presence checked, values not disclosed). For future setup only: Privately edit **server/shopping92.env.local**, setting `SHOPPING_RECEIPT_OPENAI_KEY` and `SHOPPING_RECEIPT_MODEL` to an authorized image-input + strict-JSON-output model. Never paste the key in chat/Git/client settings. Then run `powershell -NoProfile -File "$env:TEMP\finance-shopping92\restart-server.ps1"`.
- Launchers/logs: `%TEMP%\finance-shopping92\start-server.cjs` and `start-client.cjs`; `restart-server.ps1` restarts only this isolated backend. Local stack restart: `npx --yes supabase@2.118.0 start --workdir "$env:TEMP\finance-shopping92" -x realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor`. This command requires Docker and may pull images; never run a reset/stop command against LifeOS.
- If the UI has stopped: `node "$env:TEMP\finance-shopping92\start-client.cjs" --host 127.0.0.1 --port 5173 --strictPort`. Do not run a second copy while the current port is occupied.
- Both ingestion flags are false for these local processes; production configuration was never inspected or changed. Authenticated local list/intelligence and health requests returned 200. Owner evidence: one tested receipt extracted correctly. The subsequent four-photo diagnostic and browser verification below supersede the earlier multi-photo technical-verification gap. Broader Hebrew accuracy/overlap correctness still require owner review; the initial single-photo success is not acceptance.

Testing: sign in locally, open the seeded Shopping list, maintain regular products/generate the plan, upload a real redacted Hebrew JPEG/PNG receipt. Check every extracted line, unit price, quantity, date and printed identifier; confirm **history only** and inspect Transactions to see no new expense. Only **סגירת קנייה ויצירת תנועה** creates local test cash. Repeat confirmation/checkout to verify stable results. A different photo in another list with the same readable reference/merchant/date must display the previous list and warn before either confirmation or checkout; do not acknowledge distinct purchases when it is the same receipt. A missing identifier is an explicit detection limitation, not proof that a purchase is new. A prior checkout without a receipt has no merchant reference to compare across lists. Existing same-list checkout still protects against repeated cash and receipt confirmation replaces history only.

## Two-section owner test

1. Open http://localhost:5173 and a **new test list** for a new purchase; keep any already-confirmed receipt unchanged. Add planned products first.
2. Photograph the top and bottom of one long Hebrew supermarket receipt, keeping 2–3 printed lines visible in both sections. Avoid full card/payment details.
3. Choose **סריקת קבלה**, select the top JPEG/PNG, then add the bottom photo. Verify both previews; test reorder/remove and restore top-to-bottom order.
4. Choose **סריקת התמונות** once. The server transcribes both images separately and resolves the adjacent sequence. Review row details/source references for any uncertain rows; make sure repeated *photographs of the same line* are counted once and separate printed repeated purchases remain separate.
5. Correct product matches, quantities, units and unit prices; compare the displayed sum against the receipt. Switch to photos and back; edits must remain. Close/keep draft/reopen and verify it is retained on this list.
6. If changing the photo set, confirmation must disable until an explicitly approved new scan. Check duplicate warnings and the original planned list before confirming **history only**.
7. Inspect Transactions: no expense from scan/review/history confirmation. Only deliberately use the existing checkout dialog when testing local financial posting. Do not confirm the same real purchase across separate lists merely to test overlap behavior.

Remaining gates: owner review of multi-image result quality, overlap identification, missing quantities/units/prices, broader theme/device usability and final acceptance. Technical four-photo extraction and desktop/mobile browser inspection are recorded below.

## Four-photo failure diagnosis and correction — 2026-09-30

Reproduced with the owner's four original JPEGs in the order recorded by the isolated receipt's hashes. All four reached one provider request. The configured provider returned HTTP 200, `finish_reason=stop`, 2,212 completion tokens out of 7,000, and valid JSON. Application validation rejected empty quantity strings. A follow-up exposed unresolved units too. The provider schema had allowed unrestricted strings while the application required numeric quantities/nonempty units; the catch-all mapped those validation failures to an inaccurate image-quality error. Original requests had only HTTP 422 logs; this diagnosis comes from live reproduction, not recovery of their raw responses. Reversed photo order or blur was not established as the cause.

- The provider schema now constrains exact decimal text and explicitly allows unknown quantity/unit as `null`. Empty quantity/unit text is normalized only to unknown, never to an invented quantity/unit. Unknown values remain editable and block confirmation. Positive quantity, currency, price precision and confirmation validation remain enforced; no rounding/FX conversion or aggressive overlap deduplication.
- Errors distinguish transport/timeout, provider configuration/quota, refusal, output truncation, malformed JSON, unsupported currency, no readable items, field validation and invalid photo references. Safe failure logs contain a random diagnostic ID, stage/code, image count, HTTP/finish status, completion-token count and allowlisted validation field names/count only. No raw provider body, image, receipt text or credentials are logged. The UI displays the safe diagnostic ID when supplied.
- Styled upload control shows actual selected count. Numbers govern submission order; image 1 should show the header, continuing down the receipt. RTL desktop order begins on the right. Reorder controls never guess from filenames. Compact filenames retain the full name in `title` and image accessible text.
- A failed scan preserves selected photos and correction rows, refreshes only current server state/revision for safe retries, and prevents stale confirmation. Retained totals are labeled **previous draft, not current scan**. No extracted rows means no valid scan total; unknown quantities/prices yield an explicitly partial sum. The reported ₪362.40 path was the client's retained review-row sum, not a newly successful extraction or confirmed purchase.

Verification: direct extraction with the original photo order passed after the correction. An additional real browser upload through `localhost:5173` → isolated backend `localhost:5050` → provider → disposable persistence returned HTTP 200 / `review`, with 51 candidate rows and overlap warnings. Transaction and confirmed-history counts were unchanged. This verifies the pipeline, not line-by-line OCR correctness: repeated runs produced different candidate counts and unresolved fields, so compare every line to the original receipt. No confirmation or checkout was performed. The local receipt is now at attempt **4 of 5**; do not reset evidence or create duplicate lists to evade the limit. Review the existing extraction first; one rescan remains if needed.

Actual dialog inspected in headless Edge at 1440×1000 and 390×844 in dark upload/review and light item-card views in the running application, using genuine isolated Supabase Auth (no synthetic preview). Desktop/mobile upload and review screens had no horizontal overflow; mobile filled the viewport. The Windows native inspection helper was unavailable; browser automation provided this review instead. Escape closed the review and returned focus to its entry button; confirmation remained disabled with unresolved fields. Physical-device and owner acceptance remain pending.

Focused commands: `node --test server/test/shoppingReceiptExtractor.test.js server/test/shoppingIntelligence.test.js server/test/shoppingReceiptHttp.test.js` (22 passing); `npx vitest run src/pages/Shopping/ShoppingReceiptDialog.test.jsx` from `client` (7 passing); targeted client ESLint and client build passed. No migration/financial commands changed; previous disposable DB duplicate/checkout evidence remains applicable. This correction requires no new migration beyond the existing isolated 039/040 setup.

## Compact table and printed-sequence overlap — 2026-09-30

This supersedes the earlier item-card layout and combined-image extraction described in the historical verification record above. No migration, confirmation RPC or financial checkout contract changed.

### Review interface

The dialog opens existing review data directly as a compact RTL table: **מוצר | כמות | יחידה | מחיר ליחידה | סה״כ | פעולות**. Inline cells follow DOM/Tab order; missing values are highlighted in place. The header and product column remain sticky inside deliberate mobile horizontal scrolling. Add/remove actions are small. Catalog matching, planned quantity/substitution information, printed codes and source photo/occurrence numbers are available through each row's details action. Merchant and confirmed purchase date remain compact; receipt number, printed date, original plan and secondary evidence are collapsed under **פרטי קבלה**.

The confirmed purchase date initially uses the extracted printed date when present (otherwise local date), but remains separately editable. Changing one never silently rewrites the other. The footer shows the reviewed total, incomplete-state marker, and a compact difference against a known printed payable total. No value is fabricated to reconcile a discrepancy. Financial checkout remains separate. Duplicate candidates still require explicit review, and changing printed identity requires rechecking; the frozen plan and confirmed receipts are unchanged.

Totals retain the existing quantity × unit-price checkout contract: decimal/BigInt arithmetic, up to three quantity decimals and two price decimals, aggregate then round to cents. Printed discounts become a net unit price only when exactly representable in this contract. Otherwise price stays missing for correction; do not silently round a weighted/discounted line to force agreement. Gross printed line amount and discount remain visible in row details. A future explicit line-adjustment accounting model is outside this change.

### Deterministic overlap boundary

[Extractor](../../server/services/shoppingReceiptExtractor.js) requests every product occurrence independently per photo, including barcode/SKU, ordinal, quantity/unit, gross line amount and attached discount. Supporting multiplier/discount lines belong to their product, not separate purchases. A footer-only photo can contribute identity/total with an on-demand note that it contains no product rows; an all-empty photo set rejects. Model-generated pixel coordinates proved unreliable and are not used as confidence evidence.

[Overlap resolver](../../server/services/shoppingReceiptOverlap.js) compares only the previous photo's suffix with the next photo's prefix, in user-selected order. Automatic resolution requires one unambiguous alignment of at least three consecutive printed codes with at least two distinct codes, located at the end/start portions of the respective sequences. Up to two leading clipped code-less rows can precede the readable overlap; those rows remain explicitly uncertain and are never dropped automatically. Identical-only, short, missing-code and interior matches are not sufficient. No filename sorting, global name/price deduplication or purchase identity inference occurs.

Aligned physical occurrences retain both photo/ordinal references. Separately printed repeated products stay separate, including repeats inside the aligned sequence. Conflicting quantity/unit/price/gross/discount readings become missing fields with compact conflict markers and both readings available on demand; they cannot silently become authoritative money. Unaligned possible overlaps retain their rows and source references. Correct line transcription remains a model dependency: this is conservative automatic resolution, not a promise of perfect OCR.

### Actual four-photo evidence and remaining limitation

The owner's original photos were inspected against the printed product lines, ordered header through footer. Diagnostic per-photo transcription with **gpt-5.2** yielded 17/22/26/21 occurrences. The resolver collapsed **15 repeated photographed occurrences** across boundaries (4 + 4 + 7), leaving 71 candidate rows. The two separately printed identical cookie purchases each remained quantity 1 / printed 9.50, rather than becoming one quantity-2 row. Two clipped rows remain uncertain and two merged occurrences had conflicting readings. These are review candidates, not 71 certified purchases; no confirmation/checkout occurred.

At that earlier table-verification checkpoint the isolated model was **gpt-4.1-mini** (the subsequent authorized reprocessing below switches it). It produced materially weaker transcription on this long receipt (supporting lines mistaken for products and missed/aggregated occurrences); gpt-4.1 diagnostic comparison was not reliable either. The stronger-model comparison did not change configuration and is not evidence that the configured mini model has equivalent accuracy. The owner may select a more capable available model privately in `server/shopping92.env.local`, review cost, and restart only the isolated backend. No key or provider configuration was changed by this increment.

Before the explicit reprocessing below, the saved list review was the earlier 51-row extraction, at attempt **4/5**. It is intentionally preserved for UI review, not retroactively rewritten by this algorithm. The new direct provider diagnostics did not invoke receipt persistence or consume an application scan attempt. A same-photo-set upload returns its saved extraction by design, so it is **not** a force-rescan command. Do not create duplicate lists or rearrange images merely to evade idempotency/attempt limits. Fresh extraction verification must use a genuinely new receipt or a separately reviewed reprocessing workflow; the existing one remaining attempt is not silently consumed here.

Actual-app Edge checks at 1440×1000 and 390×844, light and dark: 13 fully visible editable rows immediately, product/header sticky while scrolling, numeric Tab order, no dialog overflow, Escape returns focus, and confirmation disabled for incomplete saved extraction. Screenshots are local test artifacts, not tracked receipt data. These are desktop browser viewport checks, not physical-phone acceptance.

Focused regressions cover adjacent boundaries, repeated printed purchases, clipped unknown rows, ambiguous/identical-only sequences, conflicting readings, exact weighted/discount amounts, ordered per-photo provider requests, shared deadline and existing validation/duplicate/confirmation HTTP behavior. No production calls, history confirmation or checkout were performed by this increment.

Current focused evidence: `node --test server/test/shoppingReceiptExtractor.test.js server/test/shoppingReceiptOverlap.test.js server/test/shoppingIntelligence.test.js server/test/shoppingReceiptHttp.test.js` **34/34**; `npm test --prefix client -- --run src/pages/Shopping/ShoppingReceiptDialog.test.jsx src/pages/Shopping/ReceiptReviewTable.test.jsx src/pages/Shopping/ShoppingIntelligence.test.jsx` **16/16**; targeted ESLint, client build (existing chunk-size advisory), whitespace/UTF-8/local links passed. Existing disposable database financial/duplicate evidence is reused because the commands/schema were not changed.

## Explicit reprocessing in the isolated application — 2026-09-30

**Historical post-scan checkpoint (superseded by the owner draft below):** `SHOPPING_RECEIPT_MODEL=gpt-5.2` only in ignored `server/shopping92.env.local`; key preserved, normal environment files unchanged. Backend restarted only at localhost:5050. The existing list **בדיקת קבלה — סביבה מבודדת** now contains a newly saved **72-row** extraction at **attempt 5/5**, not the former 51-row response. Receipt UUID and original plan remain the same. Reloading the actual app independently displayed the persisted new result.

### Command and recovery

[Migration 041](../../server/migrations/041_shopping_receipt_reprocessing.sql) is a forward-only additive change after 040. It adds `reprocess_key UUID` and bounded `previous_drafts JSONB` (maximum four archived attempts) to `shopping_receipts`, and replaces the existing private command without changing its grants. Applied and verified **only in disposable/local databases**. 039/040 were not edited; full_schema includes the same 041 reference. Single-run migration; rerun fails transactionally. Retain archive/evidence on forward recovery; never drop receipts/history to reset attempts.

Ordinary same-set upload still returns the saved result. **סריקה מחדש** explicitly submits current expected revision + one UUID per processing request. Inside the existing advisory/list/receipt locks, the command archives the old extraction and the submitted owner correction draft before advancing the attempt. Identical replay returns the same attempt with `processing_replay`; a still-running replay returns HTTP 202 and never launches another provider call. Stale/concurrent different-key requests reject. Replay after completion returns the saved result, including after lost response. UUID retries are retained in the current browser session; a reload obtains current server state, and must not silently start another scan.

At the 041 checkpoint, correction snapshots included editable name/quantity/unit/price/catalog ID, identity and actual date (bounded 200 rows / 128 KiB field). No image bytes are archived. **פרטי קבלה → שחזור טיוטה מניסיון 4** offers an explicit confirmation before copying the archived corrections into the review screen. This does not revert the extraction, confirm history or post cash; it clears review/duplicate acknowledgments. Other browser tabs' unsent edits are not magically captured by this request. Existing unsaved-close warning remains.

The five-attempt bound is unchanged: this real scan consumed the one remaining attempt. Do not reset the counter or create a duplicate list to bypass it. Owner can review/correct this saved result and recover the prior draft without further OCR. No purchase history confirmation or financial checkout was performed.

### Complete real scan evidence

One deliberate browser upload through the normal UI → authenticated application route → configured provider → private persistence command:

| Measurement | Observed |
| --- | --- |
| Application upload requests | 1 |
| Provider calls | 4 (one per ordered photo, maximum 2 concurrent) |
| Model | gpt-5.2 |
| HTTP / saved state | 200 / review, attempt 5 |
| Provider pipeline wall time | 32,849 ms |
| End-to-end request latency | 33,351 ms |
| Input tokens | 17,136 |
| Output tokens | 4,730 |
| Total tokens | 21,866 |
| New candidate rows | 72 |
| Automatically merged photographed occurrences | 15 |
| Uncertain overlap rows | 3 |
| Rows with conflicting readings | 11 |

Token counts are provider-reported, summed over all four calls, and saved as safe `extraction_run` metadata with model/call count/duration. No diagnostic output was copied into the database.

Compared against original printed sequences: all three confident boundaries merge (4 + 4 + 7 occurrences); the two separately printed identical cookie purchases each remain quantity 1, gross 9.50. Three clipped, code-less rows stay marked. Of the eleven conflict markers, **eight are conservative unit-spelling differences** (`יח׳` versus `יח'`); **three are substantive quantity/price/discount disagreements**. They are not eleven proven financial contradictions. Formatting-equivalent unit normalization remains a concrete refinement; this saved evidence is not silently rewritten. All source readings are available in row details.

The current table shows **₪1,169.58 partial**, printed payable **₪1,262.21**, difference **−₪92.63**. Eleven missing prices, three missing quantities and eight missing units still require review; this partial sum is not a reconciled purchase total. No invented values or payment amount adjustment. Existing catalog-match markers are separate from overlap uncertainty.

Cash, confirmed-history and frozen-plan fingerprints remained identical before/after migration and scan. UI verified anew after reload at desktop/mobile widths; selected receipt/model/72 rows persisted. Only isolated test data was written.

Owner steps: open http://localhost:5173 → Shopping → **בדיקת קבלה — סביבה מבודדת** → **בדיקת קבלה**. Existing open tabs may need to leave/reopen the list; preserve any unsent edits before refreshing. Under **פרטי קבלה**, verify `gpt-5.2`, attempt 5/5 and the recovery action for attempt 4. Review row markers/details and partial-vs-printed total. Do not scan again, confirm history or check out merely to inspect this result.

Focused reprocessing checks: `node --test server/test/shoppingReceiptExtractor.test.js server/test/shoppingReceiptHttp.test.js server/test/shoppingReceiptOverlap.test.js` **27/27**; `node --test server/test/shoppingPurchasePostgres.local.test.js` **17/17**, including forward 041 upgrade, grant preservation, concurrent same/conflicting keys, archive recovery and unchanged limit; `npm test --prefix client -- --run src/pages/Shopping/ShoppingReceiptDialog.test.jsx` **10/10**, including lost-response key reuse and explicit draft restoration. Targeted ESLint, client build (bundle-size advisory), diff/UTF-8/local-link checks passed. Product versions remain 1.4.0.

## Attempt-5 unit normalization and amount reconciliation — no OCR, 2026-09-30

The eight punctuation-only unit conflicts are resolved automatically in both newly extracted rows and the **read projection of existing unconfirmed extractions**. [shoppingReceiptUnits.js](../../server/services/shoppingReceiptUnits.js) uses closed aliases for existing Shopping labels (`יח׳`, `ק״ג`, `גרם`, `ליטר`, `מ״ל`, `חבילה`, `מארז`); whitespace/quote variants do not change unit meaning. Grams/kilograms, ml/litres, unit/package and pack sizes remain distinct; no conversion factor is inferred. Unknown units are preserved. There was no centralized unit enum to reuse; existing free-form Shopping labels remain compatible.

Original saved JSON/source readings remain untouched. Equivalent conflicts move to on-demand resolved evidence in the derived review row. Exact net unit price is restored only when the **sole** blocker was equivalent units and printed gross/discount/quantity determine it exactly (including zero discount). Genuine conflicts and unrepresentable amounts stay unresolved. Confirmed items, archived owner drafts and explicitly edited fields are never recalculated. New photo resolution retains both original unit spellings. In the editor, entering a corrected quantity/net price clears only the corresponding obsolete marker; original readings remain visible. No migration, provider request, attempt increment, or financial command is involved.

The saved per-photo JSON files from the earlier diagnostic are **not the attempt-5 raw provider responses**. This audit uses actual attempt-5 saved merged readings/conflict values/source ordinals and the original four photos. No diagnostic output was substituted into the receipt.

### Exact bridge from the old partial sum

Row numbers below refer to the unchanged 72-row attempt-5 order, before any removal. Values are ILS. Source photos are ordered header to footer.

| Cause / existing rows | Change to old partial total | Evidence |
| --- | ---: | --- |
| Unit-only rows 14, 15 | +10.00 each | Soy/garlic sauces: 13.90 − 3.90 each |
| Unit-only rows 16, 17 | +12.00 each | Cereal snacks: 15.10 − 3.10 each |
| Unit-only row 33 | +10.00 | Red Bull: 2 units, 12.20 − 2.20 |
| Unit-only row 34 | +15.90 | Raspberry drink: 15.90, no discount |
| Unit-only rows 35, 36 | +7.50 each | JOY washes: 12.90 − 5.40 each |
| **Automatically restored subtotal** | **+84.90** | **8 false conflicts removed** |
| Row 52, code 7622210453327 | +13.00 after review | Photo 3 occurrence 20 / photo 4 occurrence 3: one pack, 16.90 − 3.90; promotion text “2 for 26” is not a quantity multiplier |
| Row 53, code 7622300356767 | +13.00 after review | Photo 3 occurrence 21 / photo 4 occurrence 4: one pack, 16.90 − 3.90 |
| Row 58, code 7290109060385 | +15.00 after review | Photo 4 occurrence 9 explicitly prints 2 × 15.10, then −15.20; photo 3 cuts off the multiplier/discount |
| Row 18, code-less photo-2 head | −20.00 after duplicate review | Cropped continuation of row 13 (tomato sauce), not another purchase; printed 26.20 − 6.20 |
| Row 59, code-less photo-4 head | −6.64 after duplicate review | Copy of first chocolate Lovita row 50. Its 2.86 discount reading borrowed the preceding cocoa-cookie discount; original chocolate discount is 2.87 |
| Row 60, code-less photo-4 head | −6.63 after duplicate review | Copy of second chocolate Lovita row 51 |

`1,169.58 + 84.90 + 13.00 + 13.00 + 15.00 − 20.00 − 6.64 − 6.63 = 1,262.21`.

**Historical normalization checkpoint: visible sum was 1,254.48 partial**, printed total 1,262.21, gap **7.73**. That residual is exactly **41.00 missing conflicted lines − 33.27 included overlap copies**. There is **0.00 unexplained** after the evidence-supported review decisions; this does not mean the still-partial review has been confirmed or automatically balanced.

Remaining targeted owner decisions:

- Row 52: quantity **1**, net unit price **13.00**.
- Row 53: quantity **1**, net unit price **13.00**.
- Row 58: quantity **2**, net unit price **7.50** (15.20 printed discount is source evidence; do not subtract it again).
- Review/remove duplicate candidates **60, then 59, then 18** to avoid shifting earlier row numbers while editing. Preserve genuine rows **50 and 51**: both separate chocolate-cookie purchases, net **6.63 each**. Cocoa-cookie row 49 (net 6.64) also remains.

These six decisions remain explicit review choices because the saved source readings conflict or lack codes; they were not silently hardcoded into generic matching logic. The photos provide targeted values; another provider call is unnecessary. Handling fee **35.90** (row 71) and bags **15 × 0.10 = 1.50** (row 72) are already included. Beverage deposits marked “included” are not extra charges. Attached discounts were applied once; no receipt-level adjustment/VAT plug or rounding difference was invented to balance the total. Weighted products retain exact quantity arithmetic and the existing aggregate-rounding boundary.

Open the same isolated list and reopen **בדיקת קבלה** to load the normalized projection. Preserve any unsent edits before navigating. **⋯** shows row number, affected source fields and photo/occurrence evidence. Attempt remains **5/5**, all 72 source candidates remain, previous draft retained, history/financial/original plan unchanged. No automatic deletion of genuine purchases or manual evidence rewrite.

Verification for this cleanup: `node --test server/test/shoppingReceiptOverlap.test.js server/test/shoppingReceiptExtractor.test.js server/test/shoppingReceiptHttp.test.js` **33/33**; `npm test --prefix client -- --run src/pages/Shopping/ReceiptReviewTable.test.jsx src/pages/Shopping/ShoppingReceiptDialog.test.jsx` **13/13**. Covers alias boundaries/no scale conversion, saved/new projections, exact restoration including zero discount, source immutability, confirmed/owner-value preservation and clearing only edited-field markers. Targeted ESLint, client build (existing bundle-size warning), whitespace/UTF-8 (11 files), local links (10) passed. Actual isolated UI reloaded at desktop/mobile; displayed 1,254.48 partial / −7.73, compact scrolling/focus behavior preserved. Raw receipt including timestamp/attempt/extraction/backups, financial/history/plan fingerprints unchanged. **Zero provider calls, no migration or database write** during this cleanup.
