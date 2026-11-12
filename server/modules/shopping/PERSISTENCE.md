# Gate 3B.1 persistence foundation

Gate 3B.2b aligns all administration responses and optional create-and-link;
see [the complete contract matrix](../../../docs/operations/SHOPPING_ADMINISTRATION_CONTRACT.md).
Use `shared/catalogResponse.js` for the future HTTP boundary, including fail-closed
handling of legacy records. The original foundation notes below are historical.

Historical foundation notes below. Gate 3B.2a extends category commands and durable
responses; see [the category contract](../../../docs/operations/SHOPPING_CATEGORY_CONTRACT.md).

Local contracts only; no live caller imports this foundation. No RPC has been
created, no schema migrated and no permission revoked. Existing Supabase JS is
injected by a future composition root; these modules neither create another
client nor import credentials. Gate 3A files remain unchanged.

## Components and trusted boundaries

- `shared/repository.js`: one `shopping_state(p_scope,p_ids)` snapshot, raw
  categories/products/types/links including inactive history, database revisions
  and opaque tokens. `catalogView` delegates ancestry, paths and visibility to
  Gate 3A. There is no paginated REST absence proof or SQL visibility filter.
- `shared/httpContracts.js`: authenticated actor from existing `req.user`, single
  strong quoted If-Match token, UUID Idempotency-Key, case-insensitive names and
  operation-specific mandatory headers. Existing requireAuth/getUser must run
  before this service. An explicit injected authorizer must approve each action;
  there is no default allow, client-supplied actor or new tenancy model.
- `shared/catalogCommands.js`: strict internal public-intent representation,
  authenticated durable replay before missing preconditions, JavaScript decisions,
  and one atomic commit request. No HTTP route/controller is registered. Future
  controllers must translate existing HTTP fields to these internal operations;
  `category.change` is a domain intent, not a replacement HTTP request schema.
- `catalog/catalogService.js`: exact product identity, active target validation,
  create/edit/deactivation and whole-batch reassignment. Final exact
  `(category_id,name)` collisions include inactive products and members within the
  batch. No merging, fuzzy reuse or implicit catalog name/unit rewriting.
  Decimal strings retain scale; numeric zero becomes decimal text `"0"`, never
  null. No financial arithmetic or checkout/receipt effects are accepted.
- `shared/persistence.js`: closed typed effects and a private in-process prepared
  command capability, then only `shopping_catalog_commit`. This capability is
  not a sandbox against trusted code. SQL must independently validate the fixed
  schema, actor, expected facts and integrity. No arbitrary table/column writer,
  REST mutation, old RPC fallback, compensation or automatic retry exists.
- `shared/persistenceErrors.js`: stable 400/401/403/404/409/428/503 mapping without
  returning SQL messages, details, tokens or private rows. Unknown transport or
  malformed successful commit response means outcome uncertainty, never proof of
  rollback. The caller retains the SAME UUID and original intent for retry.
- `shared/migrationReadiness.js`: offline fingerprint/checksum/adoption and SQL
  inventory checks. It has no filesystem or database side effect. Even successful
  validation returns `migrationExecutable:false`.

## Wire contract for later isolated SQL implementation

This concretizes the Gate 1 RPC argument signatures; it does not introduce a new
RPC. The version-1 JSON envelope is not deployed and must be implemented and
rehearsed together with these adapters before use.

`shopping_state({p_scope:'catalog',p_ids:{actor,request_key,operation,id,product_ids}})`
must execute one MVCC-consistent read statement returning:

```js
{
  version: 1, scope: 'catalog', operation, complete: true,
  expected: { catalog_revision: 'decimal text', token: 'DB canonical opaque token' },
  etag: '"server-issued operation-scoped token"',
  categories: [], products: [], listTypes: [], links: [],
  counts: { categories: 0, products: 0, listTypes: 0, links: 0 },
  command: null // or {actor,key,intent,result,catalog_revision} from durable ledger
}
```

All category/product/type rows include decimal-text entity `revision`. IDs and
numeric values must use lossless text where JavaScript numbers cannot preserve
them. Entire catalog/link facts, including inactive rows, are required. Counts
are the total prescribed set, not the returned page length. A capacity failure
must fail visibly; complete/count assertions are not permission to truncate.
The token binds the fixed operation/read set, actor/scope and source facts; the
caller cannot choose omitted tables. Do not derive PostgreSQL tokens with JS JSON
serialization. Command records are immutable and scoped by actor plus UUID.

`shopping_catalog_commit(p_actor,p_key,p_intent,p_expected,p_decision)` returns
`{committed:true,replayed:boolean,result,catalog_revision}`. Result is the recorded
public payload; future controllers unwrap it and preserve approved HTTP envelopes.
Bulk result is `{updated:N,product_ids:[canonical decimal IDs in numeric order]}`.
Partial successes are not a valid response. The SQL ledger stores the exact
original intent and result/catalog revision in the same transaction as effects.
Replay returns that result, even if a target is later inactive or a supplied old
ETag is stale. Syntax/auth and exact intent checks still apply. A new deliberate
action uses a new key; edits after 409 require reload/reconfirmation.

Supported internal operations: category.create/change; product.create/edit/
deactivate/bulk-category; branches.replace. Category change supports Gate 3A's
rename/reparent/activate/deactivate/delete plans; delete means deactivation.
Branch replacement preserves one explicit system-neutral link. Category
icon/order editing, optional create-and-link orchestration, type CRUD and all
list/receipt/commercial/checkout workflows remain integration work. Existing
production HTTP bodies and behavior are unchanged by this package.

## Exact required locking and permissions

Catalog commands use **K -> C-X -> entity rows in fixed table and numeric ID
order**, with no C-S to C-X upgrade. K is a namespaced transaction advisory lock
for authenticated actor/request UUID, backed by a durable unique ledger key.
C-X is `shopping_private.catalog_state FOR UPDATE`; advance its revision exactly
once with the effects. After waiting for locks, VOLATILE commit statements reread
fresh READ COMMITTED facts, check replay before expected state, then verify exact
catalog/entity revisions and tokens. Category races use the full graph revision;
FK/self/cycle/neutral and sibling uniqueness remain DB integrity. Bulk locks all
up to 100 distinct IDs numerically and commits all rows/revisions/result or none.

The full approved protocol for later packages remains:
**F when checkout -> K -> C-S or C-X chosen upfront -> R when receipt -> L sorted
-> child/entity rows**. R=390092; lookup uses K -> Q=420092 -> cache key order and
never C/R/L/F. Catalog-only commands here require no receipt/list/financial lock.
Do not substitute JS mutexes or table-wide runtime serialization. Proposed 3s
lock/15s statement bounds still require real PostgREST hoisted-setting validation.

Future public facades: privileged owner, fixed qualified search_path, EXECUTE
service_role only; private helpers/metadata not directly accessible. Preserve
legitimate reads; replace broad ALL policies with SELECT-only policies; revoke
direct table/sequence writes only after ALL legacy writers move and are fenced.
No current ACL/RLS change is made. The service credential remains inside the
trusted boundary; no claim to resist a malicious privileged administrator.

## Tests and remaining proof

Run `node --test server/test/shoppingPersistenceFoundation.test.js` and
`npm --prefix server test`. The fake Supabase transaction model verifies JS
requests, replay, stale handling and failure behavior. **It is not evidence of
PostgreSQL locks, atomic rollback, effective privileges or recovery.**

The optional `shared/preservation.local.test.js` reads owner-controlled paths from
SHOPPING_GATE2_MANIFEST and SHOPPING_PRESERVATION_ADOPTION; prints no rows; fails on
unapproved/tampered evidence. Its fingerprint input comes from adopted evidence;
a separately authorized fresh database read remains mandatory before execution.
No test snapshot or private rows belong in Git.

The Docker allowlist includes only runtime JS in the four current module
directories, excluding colocated tests and fixtures. No live import is added.
The existing deployment verifier exports HEAD, so it cannot prove these untracked
sources were packaged; do not stage merely to satisfy that verifier. Verify a
reviewed local context, then the eventual owner-committed artifact before cutover.
