# Issue #102 — Gate 3B.1 migration preparation (NOT executable)

Authority: approved Gate 1 R2 and Gate 2 R2 on Issue #102. This document prepares
the forward-only migration and verification sequence. No migration file/number
is reserved, no SQL is executed by this document and no hosted mutation is
authorized. Gate 3B.2 and eventual production cutover need separate authorization.

## Reconciled baseline and private input

On 2026-11-10, production still has 27 categories, 173 products, six types, 33
links and 85 list rows. The approved mapping SHA-256 is
`7b4b0547363ebd6066aca8cee5871467cb0a1db1ed6271c36b7de80a6f8d4fdf`.
The owner separately adopted the reconciled purchase-state preservation evidence;
original Gate 2 evidence remains immutable. Never reset purchased rows to satisfy
the old fingerprint. Private source rows and before/current values stay outside
Git; public files contain only schema/algorithm/checklist material.

The hosted ledger contains 20261106060748/055_bank_account_payment_sources,
20261106202058/056_external_bank_account_expenses and
20261109184027/059_manual_owner_refunds. This checkout ends at 058. The ledger is
not complete schema history. Reconcile deployed 059 and intervening owner work,
then allocate the migration identity under the repository's actual convention;
do not assume 059 or infer the next number from this checkout.

Current 22 Shopping function definitions match the previously reviewed baseline.
Known production/fresh-schema differences remain: four timestamp attachments;
actual constraint names; CASCADE/RESTRICT/SET NULL FK actions. Production category
UNIQUE(name) is `catalog_categories_name_key`; product UNIQUE(category_id,name)
is `catalog_items_category_id_name_key`. Preserve all unrelated constraints and
exact FK actions. Production uses RLS on all 15 Shopping tables but seven original
tables retain PUBLIC ALL policies and anon/authenticated write grants. service_role
has DML on all 15; six Shopping-owned sequences have broad grants. None is revoked
while legacy paths remain live.

## Secure, reproducible data preparation

1. Supply the owner-held original manifest, proposed evidence and separate signed-
   off adoption record by explicit local paths outside Git/worktree/container build
   context. Hash exact file bytes, then verify canonical mapping arrays and the
   adoption's evidence/file hashes. `shared/migrationReadiness.js` performs offline
   checks; it never executes or emits SQL/data backfills.
2. Obtain one fresh read-only consistent snapshot with full original-column row
   fingerprints, all 85 IDs/reference tuples, frozen plan/receipt/mapping/checkout
   evidence and financial logical links. Compare to the adopted preservation
   set; stop on drift. Do not treat count equality as field preservation.
3. In later authorized isolated preparation, read only checksum-bound mapping
   arrays. Allocate new IDs in the database parent-first and record symbolic-code
   to actual-ID assignments inside the migration transaction. Never guess sequence
   values or match products by names. Keep any generated private payload outside
   Git and logs; use bound parameters or client-streamed temporary input in that
   same transaction, not a public staging RPC/table. The reviewed execution runner
   and private-input mechanism are still to be implemented/rehearsed.
4. Reconcile complete 27-category and 173-product coverage, target name/parent
   uniqueness, exact product collision checks and all references. Preserve 27
   category identities; create 72 ordinary nodes; retain 25 inactive historical
   roots; preserve all product identity fields except approved category assignment
   and necessary catalog revision metadata. No list-row update is needed.
5. Expected targets: 99 categories, 74 active, 25 inactive historical; 173 products;
   six unchanged types; 15 ordinary plus six neutral links = 21; 85 list rows with
   ALL current original-column values unchanged. Expected visible categories /
   products by type: 57/144, 11/19, 1/1, 10/21, 9/12, 11/21.

## Schema/atomic migration implementation sequence

Before authoring executable DDL: inventory actual columns/defaults/identity
sequences/positions, constraints/indexes, trigger bodies/attachments/enabled state,
all-schema functions/overloads/owners/config/ACLs, role memberships/default grants,
views and both catalog/body dependencies. Compare against captured definitions,
not names alone. Require PostgreSQL and actual PostgREST version/settings evidence.

Under separately approved writer fence and verified recovery, one bounded forward
transaction must: assert baseline; acquire reviewed DDL locks; add parent/order/
entity/list revisions, private catalog guard and command ledger; create narrow
fixed persistence facades with restrictive grants immediately; install sibling,
cycle and neutral integrity; apply private mapping; finish caller/helper rewrites;
change ACL/policies only with complete cutover; physically retire obsolete SQL;
assert preservation, target counts and zero obsolete engines; commit once.
Any dependency or integrity failure aborts the transaction. No blanket IF EXISTS
to hide drift, no DROP CASCADE, no old-engine fallback. Sequence gaps are acceptable.
Refresh PostgREST schema cache after commit and observe the expected signatures
before admitting matching application writes.

Physical cleanup checklist (callers before callees, all public signatures):

1. Detach `shopping_category_name_guard` from shopping_catalog_categories.
2. Remove shopping_receipt_command(bigint,text,jsonb).
3. Remove shopping_move_receipt(bigint,bigint,text).
4. Remove shopping_checkout(bigint,bigint,bigint,jsonb).
5. Remove shopping_approve_product_identifier(jsonb,uuid).
6. Remove shopping_add_planned_item(bigint,jsonb).
7. Remove shopping_accept_suggestion(bigint,bigint,numeric,text).
8. Remove shopping_delete_draft(bigint).
9. Remove shopping_claim_product_lookup(text,text,text).
10. Remove shopping_commercial_command(jsonb,uuid).
11. Remove shopping_receipt_context(bigint).
12. Remove shopping_resolve_entry_category(bigint,text).
13. Remove shopping_category_write_guard().
14. Remove shopping_snapshot(bigint).
15. Remove shopping_commercial_detail(uuid).
16. Remove shopping_unit_factor(text,text).

Retain exactly seven old Shopping functions for their reviewed purposes:
shopping_category_display(text), shopping_category_key(text) (actual normalization
constraint dependencies required); shopping_gtin_valid(text) (checksum constraint);
shopping_lock_item() (closed-list integrity);
shopping_save_receipt_draft(bigint,integer,integer,jsonb) (receipt CAS);
shopping_receipt_duplicates(bigint,jsonb) (out-of-scope read);
shopping_require_duplicate_review(bigint,jsonb,jsonb) (receipt acknowledgement).
Revoke unneeded direct execution during cutover. Preserve shopping_item_write_lock,
the four timestamp triggers and shared set_updated_at(). Inspect all new/private
helpers for policy leakage; names/counts do not establish zero active business
engines. Retained receipt helpers must be invoked under the approved outer lock
and revision protocol, never independently after cutover.

## Writer and consumer cutover inventory

| Existing source | Current dependency | Required coordinated destination |
| --- | --- | --- |
| shoppingController.js | direct category/link/catalog/list/item DML; add-planned-item, delete-draft, checkout RPCs | catalog/list commits; established financial tail |
| shoppingSettingsController.js | type/category DML and non-atomic link diff | catalog commit; atomic branch replacement |
| shoppingIntelligenceRoutes.js | regular DML; suggestion, commercial approve/map, receipt lifecycle/draft/context/move RPCs | list/commercial/receipt commits and raw reads |
| shoppingProductLookup.js | old claim RPC and cache update after provider response | Q/lease claim/finalize; provider stays outside transaction |
| shoppingCommercialProducts.js, shoppingReceiptConfirmation.js | commercial-detail/mapping/context reads and downstream policy | supplied authoritative facts; keep mature receipt algorithms |
| client services/api.js and Shopping/settings/receipt UI | authenticated HTTP writes; no direct Shopping table DML found | approved ETag/key/body contracts and matched frontend cutover |
| apy_protected, ingestion_core_snapshot, ingestion_core_commit, savings_assert_links | financial Shopping links/locks | retain financial semantics; verify F-before-Shopping order |
| external/direct clients, workers and owner/admin sessions | not exhaustively established by repository search | name, drain and fence; migrate or explicitly retire |

Existing requireAuth calls Supabase getUser and supplies req.user.id. Preserve
current authorized users and reads; no user_metadata authorization or fabricated
auth.uid in service RPCs. New facades are service-role-only, owned by the trusted
migration owner with fixed search_path; private schema/helpers inaccessible to
browser/service direct calls. Revoke direct DML, sequence usage/update and obsolete
RPC grants only with all writers replaced. Do not modify global public default
privileges or unrelated Finance Tracker modules.

## Evidence still required before execution

- Fresh and production-shaped upgraded disposable schemas converge, including
  exact FK actions and timestamps. Real SQL/role/PostgREST tests prove direct DML,
  private RPC and browser commit denial while authorized Express succeeds.
- Real concurrency: C-X sibling/reparent races; 100-item bulk competing with entry;
  independent list C-S writes; receipt/map/move races; checkout versus 058 finance.
  Capture latency, locks, deadlocks/timeouts and final invariants. Fake unit tests
  do not demonstrate these properties.
- Inject failures at data, revision, ledger, ACL and schema stages; verify complete
  rollback. Verify canonical receipt token/decimal/null/zero/frozen JSON parity and
  nonempty synthetic histories despite currently empty checkout/mapping tables.
- Verify matching backend/frontend packaging, routes, auth, normal local app,
  schema-cache refresh, retained helper bodies and no SQL fallback in any schema.
- Obtain a fresh private consistent backup and successful isolated restore,
  including storage assets, ACLs/functions/triggers; verify credentials, owner
  outage/recovery limits and external consumers. This evidence does not exist yet.
- Before commit: transactional rollback restores the compatible baseline. After
  commit: stay fenced; use rehearsed forward repair or separately authorized full
  coupled restore. After new writes: preserve/reconcile them before any restore.
  An application-only rollback or rerunning old migrations is not recovery.

Gate 3B.1 only prepares these materials. Migration execution, SQL retirement,
permissions, route activation, production deployment and release are not authorized.
