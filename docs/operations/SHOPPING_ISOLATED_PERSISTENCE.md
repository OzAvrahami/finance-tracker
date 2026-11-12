# Issue #102 Gate 3B.2 isolated persistence

This package implements and rehearses catalog persistence only. It does not
activate any route, authorize a hosted mutation or complete the later Shopping
list/receipt/checkout integration. All Gate 3A/3B.1 files remain unchanged.

## Files and boundaries

- `server/migrations/060_shopping_hierarchy_persistence.sql`: forward-only,
  explicitly isolated migration candidate. It extends existing category,
  product and type tables; adds only private revision/command metadata; retires
  the approved 15 old functions and one trigger. Seven old functions remain.
- `server/test/helpers/shoppingIsolatedDatabase.js`: owned disposable Docker
  database/PostgREST lifecycle with fail-closed guards, fresh local credentials,
  strict target identities and cleanup limited to this invocation's resources.
- `server/test/shoppingHierarchyPostgres.local.test.js`: real Supabase JS /
  PostgREST / PostgreSQL schema, mapping, concurrency, security and restore tests.
- `server/test/shoppingIsolationGuard.test.js`: canonical negative opt-in test.

The existing Gate 3B.1 `createRepository`, `createPersistence` and
`createCatalogCommands` execute unchanged against these real RPCs. No `pg`
dependency/pool, second application client, production controller or frontend
change is introduced. `psql` and `pg_dump` are test administration tools executed
inside the identified disposable container, not application persistence.

## Baseline and migration identity

The authorized checkout remains at `43dc936600038da07a808a8b52627491ca722987`.
Its consolidated `server/full_schema.sql` ends at 058. The remote repository and
hosted migration ledger both contain 059 (`20261109184027`,
`059_manual_owner_refunds`). The remote file matches the hosted ledger's SQL
after CRLF normalization. Its SHA-256 is
`600d47c9eafd0bc069a7aecef2f83f58632c5035dcb885e738967cb94b1bc257`.
It replaces three unrelated financial helpers and an observation constraint;
those definitions/semantics are preserved by 060. Do not replay 059 on a host
where it is already applied.

Supabase CLI generated authoring identity `20261110200708` outside the worktree.
The candidate follows the repository's verified numbered history as 060; it does
not rewrite/add a second 059, alter the hosted ledger or reserve a release number.
Fresh and upgrade tests use the existing consolidated baseline, the exact
checksum-bound 059 source, captured production constraint/trigger differences,
then 060. Fresh tests begin with no user data; upgrade tests seed synthetic data.
Their resulting schema, functions, constraints, policies and effective grants
are compared. The existing pre-cutover consolidated snapshot is unchanged so
legacy consumers keep their current reference. A final consolidated post-cutover
snapshot and deployment runner remain later integration work.

## Isolation and reproducibility

Run from the authorized worktree in PowerShell:

```powershell
$env:SHOPPING_ISOLATED_TEST = 'issue-102-disposable'
$env:SHOPPING_059_BASELINE = '<explicit local file containing reviewed remote 059>'
# Optional: approved owner-held manifest outside Git; never copy its rows here.
$env:SHOPPING_GATE2_MANIFEST = '<private Gate 2 manifest path>'
node --test server/test/shoppingHierarchyPostgres.local.test.js
```

Without the manifest, the suite uses the existing public taxonomy/artificial
allocation fixture. With it, the suite verifies the canonical SHA-256 before
using all 27 dispositions, 173 assignments and six branch selections. All
non-taxonomy names, units, amounts, notes, timestamps and history are synthetic.
Original user rows, credentials and backups are never imported. The original
private preservation evidence is separately checked read-only by the existing
Gate 3B.1 test, not replaced by the synthetic history.

The harness rejects missing/incorrect opt-in and remote Docker contexts. It
creates UUID-named, labeled resources, an internal database network, a fresh
random database password and fresh local JWT signing material. PostgreSQL has
no published port, no bind mount and no attachment to another stack. `docker
inspect`, network properties, credentials and the database identity marker are
checked before SQL administration. The SQL migration itself also requires its
setting to match the disposable database marker; removing that guard is not
authorized by this package.

Docker Desktop does not publish ports for an internal-only network. PostgREST
therefore also joins a separate invocation-owned bridge, with an ephemeral
**127.0.0.1-only** port. The database never joins that bridge. This is local target
isolation, not a claim of a completely air-gapped gateway. The test fetch adapter
rejects every origin except the generated loopback endpoint and only removes
the Supabase gateway's `/rest/v1` prefix for direct PostgREST access. No hosted
Supabase tool performs mutations. Ambient URL/key variables are deliberately
set to unusable values in the test process; the client always receives newly
generated local values. Application dotenv/config modules are never imported.

Observed runtime: PostgreSQL 17.11 (`postgres:17-alpine`), PostgREST 16.5 and the
repository-installed Supabase JS. Tags are logged with actual server versions;
reverify/pin the eventual deployment artifact separately. Cleanup removes only
the exact labeled containers, anonymous test volume and networks created by the
invocation. Other running local stacks are not inspected for credentials or used.

## Persistence and integrity

`shopping_state(text,jsonb)` is a service-role-only STABLE raw snapshot. IDs,
revisions and numeric prices use lossless text; inactive categories remain in
the prescribed complete facts. Counts detect truncation. SQL chooses no visible
branches, catalog reuse, classifications or eligibility.

`shopping_catalog_commit(uuid,uuid,jsonb,jsonb,jsonb)` is the sole new mutation
facade here. It accepts closed operation/effect shapes and binds effects to the
original intent. Expected state binds complete catalog facts, actor, operation
and target IDs using PostgreSQL canonical JSONB bytes and SHA-256. Tokens are
concurrency checks, not a replacement for service authentication/authorization.

Each command locks K (transaction advisory actor/key namespace), then C-X
(`catalog_state FOR UPDATE`), then affected entities in deterministic table/ID
order. Replay is checked under those locks before expected-state validation.
VOLATILE commit statements reread fresh READ COMMITTED facts after waiting.
Effects, entity/global revisions and the durable actor/key result commit once
or roll back together. There is no JS mutex, catalog table lock, C-S lock upgrade,
old-engine fallback or per-item REST write. Bulk updates lock sorted IDs and
validate the entire requested set, at most 100 distinct products.

The category integrity trigger only protects identity/neutral status, hard
deletion, empty canonical names and cycles. A self FK, parent index, explicit
neutral constraints and normalized sibling UNIQUE index (including inactive
siblings and NULL root parents) enforce structure. Activity eligibility and
descendant visibility remain Gate 3A decisions. An inactive parent may retain
active descendant flags; those descendants are hidden by JavaScript. All current
history stays stored. No fixed-depth schema or traversal limit is introduced.

PostgREST hoists the RPC's 3-second lock and 15-second statement settings.
Integration tests observe a real C-X wait and an actual statement timeout,
including complete rollback. Other future command families must still obey
the approved F/K/C/R/L or K/Q ordering; this catalog-only test does not prove
their future integration or absence of all possible deadlocks.

## Migration, permissions and recovery

Nonempty upgrades require complete temporary mapping inputs in the same session.
Coverage/identity checks reject missing mappings. The transaction creates 72 new
categories, retains all 27 old identities (25 inactive), reassigns all 173 products,
and replaces links with 15 ordinary plus six neutral links. No list-row update
occurs. Expected totals are 99/74/25 categories, 173 products, 21 links, 85 rows;
effective category/product counts are 57/144, 11/19, 1/1, 10/21, 9/12, 11/21.
Identity fields and all original synthetic list fields are compared exactly;
catalog category assignment/revision/update metadata are the intended changes.

The migration physically drops every approved obsolete signature and trigger,
without CASCADE or IF EXISTS hiding drift. Existing seven retained definitions
are compared byte-for-byte, and remaining function bodies are checked for old
call sites. Semantic review of the new helpers finds raw facts, canonicalization,
integrity and persistence only. Unrelated financial function definitions remain
unchanged. Timestamp/item-lock triggers and actual FK actions are preserved.

In the isolated database only, original ALL policies become SELECT policies with
the same read predicates; direct table/sequence writes are revoked from PUBLIC,
anon, authenticated and service_role. All 15 Shopping tables and both private
metadata tables have RLS. Only service_role can execute the two public facades.
Private schema/helpers/tables are inaccessible to browser and service roles.
Privileged owners, qualified references and fixed search paths provide the
approved definer boundary. Direct execution of retained receipt write helpers
is revoked; no default public-schema privileges outside Shopping are changed.

The catalog is global/shared under the approved model. This package does not
invent per-user ownership or a tenant/admin-role schema. Ordinary browser roles
cannot mutate it directly; Express's explicit authorizer controls user actions.
Actor-scoped command keys prevent one user from reading/replaying another user's
result; actor/scope-swapped expected tokens fail. A malicious service credential
is inside the trusted boundary and is not treated as an ordinary-user threat.

The suite injects a migration failure immediately before commit, a failure after
preliminary bulk writes, a missing final bulk identity, and a timed-out write.
It verifies rows, revisions and durable command results are rolled back. Sequence
gaps are acceptable; PostgreSQL sequence advancement is not transactionally undone.
A synthetic `pg_dump` is restored into a second database in the same disposable
container. Schema/effective privileges, history, catalog facts and durable replay
are checked. Default-owner ACLs can serialize as NULL after restore; comparison
uses PostgreSQL's effective default ACL, not misleading textual inequality.

This is proof of the isolated restore, not production backup/PITR, storage asset
recovery or recovery time. Production still requires a fresh consistent private
backup, successful appropriate restore, drift checks, current external-consumer
inventory, writer fencing, complete replacement of legacy callers, matching
frontend/backend/schema artifacts and PostgREST cache validation. The actual
production private-payload runner remains unimplemented and unauthorized.

## Review and release boundary

Gate 3B.2 review covers SQL shape/integrity, lock order, fail-closed environment
selection, role grants, transaction rollback, full mapping and test assertions.
Do not connect the unchanged legacy routes to this migrated isolated schema:
their SQL endpoints were intentionally retired there and replacement workflows
belong to later authorized packages. Auth middleware/real user login, complete
receipt/checkout/financial workflows and frontend administration are not claimed
as end-to-end tested by this suite.

Release impact: No for this isolated candidate; SemVer: None for this package.
Future integrated compatibility remains proposed Major, subject to owner release
review. Candidate/version bump/CHANGELOG: not applicable to this internal package;
grouping remains pending on #102; publication is out of scope; owner acceptance
is pending. No version is reserved, and package/CHANGELOG files remain unchanged.
