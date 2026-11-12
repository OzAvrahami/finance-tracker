# Shopping JavaScript foundation (Issue #102, Gate 3A)

These modules are pure domain calculations. Existing routes do not import them
yet. There is no database connection, persistence adapter, HTTP handler or cache.
Gate 1 R2 and Gate 2 R2 remain the integration/design authority.

## Interfaces

- `categories/hierarchy.js`: `buildHierarchy(categoryRows)` validates the complete
  forest and returns an immutable snapshot. `get`, `path`, `ancestorIds`,
  `descendantIds`, `childrenIds` and `isDescendant` use category identities only.
  `rootIds` excludes neutral; `categoryIds` includes it last.
  `categories()` hides effectively inactive nodes; `{ includeInactive: true }`
  is the explicit administration/history view. `get` and `path` always permit
  historical reads, including categories unavailable for new selection.
- `categories/categoryService.js`: `planCategoryCreate(tree, input)` validates
  a new name and explicit parent without inventing an ID.
  `planCategoryChange(tree, intent)` supports `rename`, `reparent`, `activate`,
  `deactivate` and `delete`. Plans contain only proposed field changes and the
  inspected domain state. **Delete means deactivate; hard deletion is rejected**
  even when there are no references. No descendant flags, products, mappings,
  list rows or frozen evidence are modified.
- `list-types/listTypeService.js`: `createVisibilityEngine(tree, facts)` accepts
  complete `listTypes`, `links` and `products` arrays. `forListType(id)` returns
  distinct, deterministic branch/root/category/product IDs and a `categoryPath`
  resolver. `validateBranchSelection(tree, ids)` validates proposed ordinary
  branches, including inactive branches, and deduplicates their IDs. Neutral is
  not an ordinary branch; existing explicit neutral links are accepted as raw
  facts and its category availability never depends on those links.
- `shared/contracts.js` reuses the existing category normalization helpers and
  validates identities and scalar input. `shared/errors.js` supplies explicit
  `ShoppingDomainError.code` values; HTTP mapping belongs to integration.

## Raw facts and policies

Category rows require `id`, `name`, explicit nullable `parent_id` and boolean
`is_active`. `is_neutral` defaults to false and `display_order` to zero. Exactly
one marked, active, parentless neutral row must be supplied. Its actual identity
is retained, including a negative ID. Nothing can be parented beneath neutral.
Ordinary category, product and list-type IDs are positive. Safe integer numbers
or canonical decimal strings are accepted; output IDs are canonical decimal
strings within PostgreSQL bigint range. Unsafe numbers, zero, padded strings
and exponent forms fail instead of losing identity precision.

Product facts require `id`, `category_id` and boolean `is_active`. Type facts
require `id` and boolean `is_active`. Links require `list_type_id` and
`category_id`. All references are validated, including inactive/out-of-scope
products. The engine projects only identity/activity facts; it neither alters
nor supplies defaults for prices, units or other catalog fields. Inactive types
can be previewed and return their activity flag. Whether a new list may use an
inactive type is a separate list-service eligibility decision.

NFKC, the existing explicit Unicode whitespace set and ASCII-only case folding
define sibling uniqueness. Inactive siblings reserve names. Different parents
may contain equal names. Snapshot paths preserve original stored display names;
only explicit create/rename plans choose a normalized display name. Slashes are
literal name content, never path separators.

Inactive ancestors hide all descendants, even explicitly mapped descendants.
Activation changes only the chosen node; it does not activate parents/children.
Reparenting beneath an inactive parent is permitted and makes the subtree
effectively unavailable without changing its stored activity flags. Neutral
cannot be renamed, reparented, deleted or deactivated through category plans.

Siblings sort by `display_order`, then normalized key using ordinal comparison,
then numeric ID. Enumeration uses preorder, with neutral last. Product IDs sort
by category enumeration then numeric ID. No locale or input-array ordering
affects results. Shared scope returns the same identities, without cloning.

Effective roots have no visible parent. Their `display_path` contains full
ancestry for context. Descendants' `display_path` omits that root context;
`relative_path` includes the visible root, and `path` always contains full
breadcrumbs. Ancestors used only as context do not become selectable or counted.

## Complexity and integration requirements

Construction uses O(N) storage and O(N log N) worst-case sibling sorting.
Traversal is iterative, with no logical depth cap. Full paths are computed on
demand in O(depth); descendant reads cost O(returned nodes). Subtree membership
uses preorder intervals. There is no quadratic all-path materialization.
Mutation validation rebuilds a detached tree. Visibility indexes raw facts once
and sorts products in O(P log P); each type calculation costs O(N + P).
Inputs and returned objects are detached/frozen. Costs still scale with input
and requested output; this is not a guarantee against unbounded resource use.

Gate 3B must supply authoritative, complete raw facts using existing Supabase JS,
attach the approved catalog/entity revision and command identity, authorize
intent, and atomically validate expected state before persisting any plan.
`requiresCatalogRevision` is a requirement, not an implemented concurrency guard.
The returned `before` object is a domain projection, not a database revision
token or a full row suitable for replacement. Never persist a caller-supplied
plan blindly. No If-Match/Idempotency-Key enforcement is implemented here.

Later authorized packages must integrate routes and invalidation, preserve
history/financial boundaries, implement narrow RPC persistence and the approved
SQL/ACL retirement, and verify fresh/upgrade/concurrency cases. The existing
Docker allowlist does not yet package `server/modules`; packaging must be updated
and verified before a live caller imports these modules. No deployment change
is part of Gate 3A.

## Verification

Run from the repository root:

```powershell
node --test server/test/shoppingHierarchyFoundation.test.js
npm --prefix server test
```

The small canonical test entry point registers the colocated suites without
changing the existing test runner. The committed taxonomy fixture contains only
the approved public tree/branch sets and synthetic product IDs/distributions.
It is not a production catalog snapshot.

For the owner-supplied private R2 manifest, set `SHOPPING_GATE2_MANIFEST` to its
local path and run:

```powershell
node --test server/modules/shopping/list-types/gate2Visibility.local.test.js
```

This opt-in test verifies the approved canonical SHA-256 and derives counts from
the checksum-bound arrays. It reads no database and prints no private rows. It
is skipped when the environment variable is absent; a skip is not a pass.
