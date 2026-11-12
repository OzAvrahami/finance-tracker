# Shopping administration persistence contract — Gate 3B.2b

Local persistence only: no HTTP controllers or frontend activation. Gate 1 R2
section 11 and the owner-authorized 3B.2b correction govern this package.
Apply 060 → 061 → 062 only through the guarded disposable harness. 060/061 remain
unchanged. Hosted latest 059 was verified read-only at preparation; verify again
before any future migration authorization.

## Complete mutation matrix

E = If-Match; K = Idempotency-Key. New UI actions always send K. Optional K does
not permit blind retries of an unknown unkeyed write.

| Operation | Fields and atomic scope | E / K | Recorded status/body/ETag | Before 062 |
| --- | --- | --- | --- | --- |
| Category create | name, explicit nullable parent_id; optional icon, is_active, display_order, list_type_id. One insertion plus optional initial type/neutral links and type revision | Optional / optional | 201, full category + JS path/effective_active/counts; category.edit ETag | Ordinary create aligned by 061; composite unsupported |
| Combined category edit | Nonempty subset of name, icon, parent_id, is_active, display_order; one final-state validation/UPDATE | Required / optional | 200, full category; category.edit ETag | Aligned by 061 |
| Reparent | parent_id through edit, or legacy category.change reparent | Required / optional | 200, full category; command-family ETag | Aligned by 061 |
| Activate/deactivate | is_active or legacy action; own flag only | Required / optional | 200, full category; command-family ETag | Aligned by 061 |
| Category DELETE | category.change delete; deactivation, never physical deletion | Required / optional | 200, full category; category.change ETag | Aligned by 061 |
| Product create | name, category_id; optional default_unit, default_price, is_active; one insertion | Optional / required | 201, full stored product; product.edit ETag | Identity-only; no HTTP metadata |
| Product metadata edit | Nonempty subset of the five product fields; one UPDATE | Required / required | 200, full stored product; product.edit ETag | Identity-only; no HTTP metadata |
| Single reassignment | category_id, optionally with metadata; same product.edit transaction | Required / required | Same product response | Identity-only; no HTTP metadata |
| Product DELETE | Empty body, product.deactivate; identity retained | Required / required | 200, full product; product.edit ETag | Identity-only; no HTTP metadata |
| Bulk reassignment | product_ids: 1–100 distinct IDs, category_id; whole batch | Required / required | 200, `{updated,product_ids}` sorted lossless IDs; bulk-scoped ETag | Correct body; missing HTTP metadata |
| Branch replacement | categoryIds; complete set plus protected neutral link, one type revision | Required / optional | 200, existing `{linked: categoryIds.length}`; branches.replace ETag | Identity-only; no HTTP metadata |

Optional category creation with one initial list type is explicitly required by
Gate 1's legacy contract and is one RPC/transaction. No arbitrary link array,
implicit parent, second commit or new endpoint is introduced. Type CRUD,
hard deletion, merging and list/receipt/checkout writer conversion are outside
this package. Completion evidence/classifications are recorded on Issue #102.

## Fields and business authority

Unknown/immutable fields and undefined values are rejected. Edits preserve omitted
fields; null clears only category icon/parent and product unit/price. Creation
defaults unit/price to null and activity to true. IDs/revisions and decimal prices
use lossless text. Zero remains zero and stored decimal scale is preserved.

JS validates the final tree, sibling uniqueness, neutral restrictions, product
collision keys and effective activity. Products can use active intermediate nodes
or neutral; inactive ancestry is unavailable for new assignments. Existing
historical references remain. Category DELETE deactivates even unreferenced rows;
no implicit historical reactivation or descendant flag rewrite occurs. Initial
links require an existing type; no new type-activity policy is invented.
Descendant inheritance and overlap deduplication remain in JS, without cloning.

Verified req.user plus an explicitly injected authorizer precede reads/replay.
Body fields cannot choose the actor. No new admin-role/tenant schema is invented.
Actual Express getUser/authorization composition belongs to Gate 3C.2. Privileged
Supabase stays server-only; browser roles cannot execute commit, and service_role
cannot directly write Shopping tables or execute private helpers.

## Atomic revisions and request identity

Lock order remains K(actor/key) → C-X → deterministic affected rows. Under C-X,
fresh full-fact tokens bind actor/operation/target/selected products. Composite
create checks/locks the type revision before inserting the new category. Each
accepted mutation advances catalog revision once, including same-value edits;
replay advances nothing. There is no lock upgrade or second write transaction.

Syntax/auth precede replay; replay precedes missing/new/stale preconditions.
Canonical request identity preserves omission/null. Object key order, numeric or
string IDs, selection ordering and equivalent numeric price spelling do not change
identity. Selection multiplicity remains significant for the legacy linked count;
bulk duplicates are rejected. Other strings and explicit defaults remain distinct
request values. Canonicalization never changes first-result fields or stored price.

JS compares canonical objects. SQL computes the same canonical object and stores
SHA-256 of PostgreSQL jsonb text as request_hash in the mutation transaction. It
also compares canonical objects, not hash equality alone. The hash is internal,
not a browser-generated ETag. Existing records keep null hashes and use canonical
comparison without a backfill.

## Durable response boundary

The same transaction captures commands.result and commands.http. JS supplies
category projections; SQL captures actual stored row fields. Products capture the
stored row with text price/IDs/revision. Bulk and branches keep approved envelopes.
The post-mutation ETag is generated before releasing C-X. Only ETag is a durable
application header; Content-Type, Date and connection framing are transport
concerns. Cookies, authorization and arbitrary caller headers are never replayed.

Future controllers must use `catalogHttpResponse(commit,intent)`. It validates
the family/status/header allowlist and returns detached recorded status/body/ETag
without querying current records. Missing historical HTTP metadata produces 409
shopping_legacy_result_unavailable for every family. The internal RPC may return
a pre-061/062 identity-only command record; the HTTP boundary must fail closed.
No response is manufactured from current data.

Stable mappings remain 400 invalid input, 401 unauthenticated, 403 forbidden,
404 missing, 409 stale/key/uniqueness/protection/legacy-response conflicts,
428 missing E/K and 503 busy/unavailable/unknown commit result. Unknown outcomes
require same-key retry, never unkeyed retry or compensating REST writes.

## React and integration boundaries

Current panels use supported fields, IDs, branch arrays and stable retry keys.
Their synthetic preview envelope/tokens remain development-only. Gate 3C.2 must
implement the authenticated adapter, scoped read tokens, response mapping,
conflict feedback and unsaved draft handling. No preview flag activates these
persistence primitives. Persistence PASS does not claim browser/Express acceptance.

## Isolation and verification

The harness requires SHOPPING_ISOLATED_TEST, rejects remote Docker contexts and
creates a labelled internal-only DB network, no published DB port, loopback-only
PostgREST port and fresh local credentials. It reads no dotenv/hosted credentials.
062 requires the matching isolated DB marker before DDL. Tests use synthetic
rows, optionally with checksum-bound approved classification topology only.

062 rejects absent marker/setting explicitly (including both NULL). The preserved
060/061 SQL guards alone do not establish isolation when both values are NULL;
never invoke those scripts manually against an unverified endpoint. The harness's
independent Docker/network/credential proof and explicit identity setup remain
mandatory for the complete sequence. No hosted execution is authorized.

Tests cover fresh/upgrade convergence, failed migration rollback, each response
family, replay after later writes, simultaneous keys, stale decisions, 100-row
batches, late failures, role/ACL boundaries, bounded timeouts, restart and
dump/restore replay. Current production ledger/writer/grant/recovery verification
and coordinated cutover require separate authorization. No production readiness
claim follows from isolated tests.
