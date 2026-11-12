# Issue #102 — Gate 3B.2a atomic category contract

Local correction only. No HTTP routes, frontend adapter, hosted migration or
production cutover is activated. Gate 3C.2 remains separately authorized work.
Gate 1 R2 section 11 and the owner's Gate 3B.2a authorization govern this contract.

## Supported category fields

| Field | Create | Combined edit | Semantics |
| --- | --- | --- | --- |
| `name` | Required | Optional | Existing NFKC/whitespace/ASCII sibling identity policy; never identity by name alone. |
| `icon` | Optional | Optional | String or null; existing JS trim, empty/null clears; no icon enumeration or NFKC conversion. |
| `parent_id` | Required, nullable | Optional, nullable | Explicit null is a root; otherwise a valid ordinary category ID. |
| `is_active` | Defaults true | Optional boolean | Changes this row only; inactive ancestors hide descendants without rewriting child flags. |
| `display_order` | Defaults zero | Optional integer | Approved sibling ordering; PostgreSQL signed integer range, zero preserved. |

These are the complete editable fields. IDs, system marker, timestamps and
revisions are immutable to callers. Edit requires at least one field. Omission
preserves the stored value; explicit undefined, unknown fields and invalid nulls
are rejected. No product fields, links or historical list references are edited.
The protected neutral category cannot be edited, including icon/order. Historical
inactive identities remain stored; there is no automatic reactivation or cascade.

The new internal `category.edit` intent contains the combined field object. It
is not a new HTTP endpoint. `category.create` now supports icon. Existing internal
`category.change` rename/reparent/activity/delete intents remain compatible;
delete still means deactivate. Future controllers translate the approved HTTP
fields, and use `category.edit` for a combined PUT, without splitting RPC calls.
Optional create-and-link, type CRUD and other workflows remain outside this fix.

`planCategoryEdit` validates the complete final graph once. This permits a valid
rename+move even if an intermediate rename alone would collide. The tree domain
remains authoritative for normalization, eligibility, cycles and sibling rules.
PostgreSQL retains referential/unique/cycle/neutral integrity and typed persistence.

## Revisions, authorization and atomic response

Existing verified `req.user` plus an explicit authorizer are mandatory. No default
allow, admin-role invention or browser-supplied actor is added. If-Match is required
for edits, optional for create; supplied values must be strong operation-scoped
server tokens. Category Idempotency-Key remains optional for legacy callers; new
UI actions must supply UUID keys. No keyed guarantee exists for an unkeyed retry.

The command locks K(actor/key), then C-X, then the target entity row. It checks
durable replay before stale/missing preconditions, binds the decision to fresh
complete catalog facts, applies all fields in one UPDATE, and advances entity and
catalog revisions once. Even an accepted same-value edit is one new revision;
replay is not. Invalid requests/failures cannot commit fields, timestamps,
revisions or ledger entries partially.

JavaScript supplies the final `path`, `effective_active` and `counts` projection.
Counts are `direct_active`, `direct_total`, `subtree_active`, `subtree_total`;
active counts count product activity flags, while effective visibility remains a
separate list-type projection. Paths are ordered `{id,name}` arrays, with literal
slashes kept as name content. For create, SQL substitutes only the allocated ID
into the supplied final path entry; SQL does not traverse or classify the tree.

Under the same C-X lock/transaction SQL captures the complete stored category row
(name, icon, activity, parent, display order, system marker, timestamps, revision
and identity), overlays the validated JavaScript projection, and stores it as
`commands.result`. IDs/revisions retain the established lossless decimal-text
wire convention. `commands.http` stores status (201 create, 200 edit/deactivate)
and the exact strong ETag. Create/edit responses have a `category.edit`-scoped
ETag for that actor/target; legacy `category.change` responses retain that scope.

`categoryHttpResponse(commit)` returns `{status,headers,body}` from the recorded
result only. It never rereads a category after commit. Replay returns the original
body, timestamps, entity/catalog revisions, status and ETag even after later edits,
deactivation or ancestor changes. A replayed ETag may consequently be stale for a
new action: reload and reconfirm, never silently rebase an existing draft.
The `replayed` envelope flag is diagnostic, not a different HTTP response body.

Keys are actor scoped. Same key and identical intent (JSON member order is not
significant) replays; different fields/values conflict. Cosmetic differences in
the original submitted values are not silently treated as a different safe retry.
Product and branch result bodies, locks, preconditions and replay semantics are
unchanged. Their new nullable `http` metadata is null; this does not claim their
future HTTP integration is complete.

## Forward-only migration and old ledger records

Migration 060 is byte-preserved (SHA-256
`0d088ec3c0851c1f38badcef6afa32381cfc1b3b075226975af26a193e0aa66e`).
On 2026-11-11 the read-only hosted ledger listed 055, 056 and 059, latest
`20261109184027`; remote migration files end at 059. Local candidates therefore
remain 060 followed by 061. Supabase CLI generated authoring identity
`20261111175902` outside the worktree. No applied identifier is reused.

061 adds nullable response metadata to the private ledger and replaces the same
two service-only RPC definitions. No additional public mutation facade is added.
One private immutable helper verifies icon canonical bytes; it is not executable
by PUBLIC/anon/authenticated/service_role. Ownership, qualified search paths,
3-second lock/15-second statement timeouts, RLS and table grants remain intact.
The migration has the same fail-closed disposable database identity guard as 060,
one transaction, schema-cache notification and no CASCADE.

Pre-061 ledger entries remain unchanged with null HTTP metadata. It is impossible
to recover their original row from an ID alone. They can still replay their old
internal result; the future HTTP helper rejects them with
`shopping_legacy_result_unavailable` (409), with no write or fabricated response.
Do not automatically retry with a new key. There are no deployed 060/061 production
commands under this gate. The upgrade test verifies old ledger preservation.

## Verification and remaining integration

Use the existing guarded disposable Docker/PostgreSQL/PostgREST suite documented
in `SHOPPING_ISOLATED_PERSISTENCE.md`. It now applies baseline → 060 → 061 for both
fresh and upgrade paths. All previous checks remain, plus combined field cases,
persisted icons/revisions, concurrency, exact replay, 061 transaction rollback,
permission boundaries and synthetic restore. No production data is imported.

Canonical domain tests include `categoryContract.test.js`; integration cases live
in `server/test/helpers/shoppingCategoryContractCases.js`. The existing isolated
entry point registers them. Test harness/admin SQL is never application persistence.

Gate 3C.2 still needs authenticated controllers, scoped read tokens, response-helper
wiring and browser-to-API tests. The mock preview remains separate. Legacy
writers/routes must not be connected to the migrated schema prematurely. Hosted
drift, backup/restore, external consumers and coordinated permission/writer/app
cutover still require explicit authorization. This fix proves no production readiness.
