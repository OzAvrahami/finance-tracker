# Issue #102 — Gate 3E.2 readiness and cutover rehearsal

Prepared 2026-11-12. **BLOCKED for production cutover; local owner acceptance can
proceed.** This is a dated audit, not deployment authorization. No hosted data,
permission, migration, deployment, Git index or version was changed. Earlier
reports remain historical evidence; this document does not overwrite them.

## Checkpoint and fresh evidence

Worktree: `D:\code\finance-tracker-worktree\finance-tracker-shopping`, branch
`feat/shopping-category-hierarchy`, HEAD
`43dc936600038da07a808a8b52627491ca722987`. Entry status: 17 modified tracked files,
90 untracked files, zero staged. All 107 bytes/hash sets match the Gate 3E.1 final
inventory. Both stashes remain unchanged. See
[the explicit checkpoint inventory and owner commands](SHOPPING_GATE_3E2_CHECKPOINT.md).

Read-only remote verification finds main at
`70610646da8f5b26755ac3387484b28416401135`, one commit ahead of this baseline.
The manual-refund commit touches 19 paths; only CHANGELOG overlaps the dirty
paths, but ingestion/refund semantics, `full_schema.sql` and deployed 059 are
integration dependencies. No fetch, pull, merge or rebase was performed. GitHub
deployment records identify both the frontend Production and Railway backend
production deployments at that newer SHA. The backend is one Railway replica;
its current route composition still uses the old Shopping controllers.

Fresh hosted inspection found:

- Ledger: `20261106060748/055_bank_account_payment_sources`,
  `20261106202058/056_external_bank_account_expenses`,
  `20261109184027/059_manual_owner_refunds`. No 060–063 applied. This ledger is
  not a complete record of the consolidated schema's history. Never replay all
  old numbered files based solely on ledger absence.
- 125 Shopping columns, 80 constraints, six non-internal triggers, 15 RLS table
  settings, seven policies, 308 table privilege rows and 26 relevant function
  definitions/ACLs match the Gate 3E.1 capture. The 26 are 22 Shopping functions
  plus four financial callers. No Shopping-dependent view was found. Function
  source search covered non-system schemas, not only public function names.
- All 15 complete Shopping table fingerprints match the adopted baseline:
  27 categories, 173 products, six types, 33 old links, five lists, 85 list rows,
  one receipt and one frozen plan; other seven tables empty. Original Gate 2
  mapping and separate adoption hashes were reverified. The 50 previously
  approved purchase-state changes remain exactly as adopted. No new drift was
  accepted or normalized. Receipt/plan full-row fingerprints also match.
- No Edge Functions, installed cron jobs or pg_net queue were found. Six event
  triggers are Supabase extension/access and PostgREST schema watchers. Preloaded
  cron/net workers do not demonstrate configured jobs. Available 24-hour logs
  contained no Shopping calls; this short observation cannot establish that an
  external writer does not exist.
- Supabase organization is Free. A production backup object, accessible export,
  restore credentials, retention and restoration procedure were **not verified**.
  Local pg_dump/restore success is not proof of hosted recovery readiness.
- One Auth user exists; no `app_metadata.role` is present. Neither fact approves
  an administrator or proves the absence of other authorization configuration.
  The inspected Railway variable names contain no new Shopping admin/household
  activation configuration. Secret values were not retrieved.

The fresh security advisor reports 38 informational RLS-without-policy findings
(eight Shopping evidence/cache tables), three mutable-function-search-path warnings
outside Shopping, and disabled leaked-password protection. These are existing
configuration findings, not changes made by E2. RLS with no policy denies ordinary
role access; it is not a reason to add a permissive policy. Review the
[RLS advisory](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
[function search-path advisory](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)
and [Auth password guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
with the owner; no permissions or Auth settings were changed.

## Writer and consumer matrix

`Migrated` below means demonstrated in the disposable environment, not deployed.
Every production caller must be assigned an owner and fence/activation action.
Detailed operation/contract cases remain in
[the E1 compatibility matrix](SHOPPING_WORKFLOW_COMPATIBILITY.md).

| Entry point / location | Operations and old dependency | Replacement, evidence and ordering | Classification |
|---|---|---|---|
| Express `shoppingRoutes` / `shoppingController`, Railway | List create/edit/delete; catalog/custom add; item update/delete; purchase toggles; direct DML and add-planned/delete-draft SQL | `workflowRouter`, list JS commands and list atomic commit; 22 workflow tests include persisted values, races and replay. Drain old routes before 060; mount replacement only after postconditions | Verified migrated locally; production composition blocked |
| Express settings controller, Railway | Type/category writes and separate category-link updates | Type commands and administration catalog commit; combined category/links and branch replacement tests. Replace old settings handlers with matching client | Verified migrated locally; production activation blocked |
| Intelligence routes, Railway | Regular products, suggestion acceptance, commercial approval/mapping and receipt lifecycle; old suggestion/commercial/receipt RPCs | Workflow intelligence router, JS commercial/receipt logic, narrow commits; real DB state and rollback assertions | Verified migrated locally |
| Receipt extractor callbacks, backend process | In-flight progress/extracted/failed callbacks after external OCR; frozen plans and receipt drafts | Typed receipt persistence, stale lease/attempt rejection, draft/confirm/move tests. Drain running extraction and prevent re-entry before final snapshot | Verified migrated locally; real provider smoke remains pending |
| Product lookup callback, backend process | Claim SQL and direct cache finalize | JS lookup lease + narrow claim/finalize; late lease and untrusted effect tests. Drain provider callbacks, preserve cache/identifiers | Verified migrated locally; real provider smoke pending |
| Commercial product hydration/confirmation services | Legacy detail/context SQL; identifiers/mappings | Authoritative immutable facts adapter, JS hydration/mapping, retained receipt algorithms; mapping and frozen-evidence tests | Verified migrated locally; old fallback must never be used after cutover |
| Checkout endpoint, Railway | Old checkout business RPC, transactions and checkout identity | JS projection + approved atomic financial tail; duplicate/concurrent replay, zero amounts, injected post-cash failure rollback | Verified migrated locally |
| `apy_protected`, ingestion snapshot/commit, savings link guard, hosted SQL | Financial references to checkout/transaction identities | Four definitions unchanged in fresh audit; 059 baseline verified in isolated tests. Preserve F-before-Shopping locking and financial semantics | Verified unaffected by this feature; newer-main integration review still required |
| React Shopping, Receipt and Settings pages, frontend deployment | Existing authenticated Express callers, revised token/key contracts | Normal React browser → Auth → Express → DB → reload, admin and workflow suites. Deploy matching frontend while writes fenced; invalidate older writer clients | Verified migrated locally; release pairing pending |
| Current React direct Supabase access | Auth and unrelated finance reads/writes; no Shopping table/RPC mutation found in source | No privileged browser key; real anon/authenticated table and commit-RPC denial tests. Do not revoke unrelated finance permissions | Verified unaffected for current source; old/external clients unknown |
| GitHub due-loan scheduler | Dedicated internal loan endpoint; daily job, not a Shopping writer | Source inspected, dedicated auth remains unchanged. Financial maintenance coordination still needed for shared transaction locks | Verified unaffected in repository |
| Supabase Edge Functions / cron / net | Potential independent writers | Fresh deployed inventory: no functions, cron relation or net queue. Six event triggers inspected | Verified absent in this inspected project; not evidence about other hosts |
| Railway bank-data-sync service | Financial ingestion API; no Shopping references in inspected integration source | Current source integration targets `/api/v1/transactions`; no cron configured in Railway service. Published deployed artifact/source equivalence and owner-run scripts are not fully established | Source verified unaffected; deployed/external coverage unknown |
| Migration, maintenance and owner SQL tools | Consolidated schema, old migrations, diagnostic scripts, Supabase console | No canonical production runner exists. Reviewed test-only runner below; maintenance sessions must be explicitly fenced and audited | Blocked pending approved runner and operator inventory |
| External APIs, older browsers, owner tools, other scheduled hosts | Direct table privileges or obsolete RPCs may remain in use | Log window/repository searches cannot enumerate dormant consumers. Require named consumer attestation and verified fencing, including service credentials | Unknown — production blocker |

No obsolete engine is restored. Current live routes remain unchanged and must
not be used on the migrated schema. The isolated suites cover creation, metadata,
catalog/custom items, arbitrary-depth visibility, category/product administration,
branches, reversible purchase marking, quantity/unit/zero prices, receipt
upload/draft/reprocess/confirm/move, mappings, plans, checkout, financial identity,
stale revisions, exact replay and unauthorized/cross-scope failures. OCR/lookup
responses are synthetic; external providers and every historical receipt variant
are not claimed verified.

## Immutable migrations and production runner boundary

060–063 remain byte-identical. Hosted 059 is the manual-refund migration; the
test harness requires its SHA-bound private baseline, not this branch's old
same-number file. Fresh and production-shaped upgrade paths and recovery are
covered in the PostgreSQL suite.

**Known guard limitations are not production approval.** 060/061's standalone
guard has a both-NULL case: `NULL IS DISTINCT FROM NULL OR NULL NOT LIKE ...`
does not enter the IF. 062/063 fail closed. The E2 outer harness rejects absent
or mismatched database identity, enforces the explicit disposable flag, validates
the Docker environment again, pins all four file hashes and requires a drained
writer fence before executing any file. It never accepts a hosted endpoint.
Do not bypass this by setting a hosted database comment to `shopping102-*`.

Each existing file commits independently. The isolated failure rehearsal proves
060 can remain committed when 061 fails, with the writer fence still closed and
recovery from a verified pre-cutover backup possible. It **does not** prove the
approved production one-bounded-transaction envelope. The original architecture
requires a coordinated, bounded migration transaction. A release-specific
execution envelope reconciling these transaction wrappers and guards is still
required. This changes execution semantics and requires separate owner review;
E2 does not rewrite or splice the approved files into an unapproved hosted runner.

Production execution is therefore **not executable/ready**. Required reviewed
runner contract, before a production command can be issued:

1. Bind explicit target project/database identity, expected server identity and
   pinned TLS endpoint; accept no ambient URL/key fallback. Verify a separately
   recorded, time-bounded owner cutover authorization tied to source artifact,
   migration bundle and mapping/adoption hashes. Missing values fail closed.
2. Verify exact real ledger plus schema definitions/ACLs and source integration
   with current main. Allocate/reconcile hosted ledger entries through the
   approved migration mechanism; do not reuse 059 or assume numeric filenames
   are already hosted ledger identifiers. Existing files stay immutable.
3. Enumerate every writer and credential context; block new writes at all entry
   points and direct database/RPC access, stop background/provider work, drain
   admitted operations and inspect active DB transactions/locks. An HTTP fence
   alone cannot fence console, external service-role or old direct clients.
4. Under the fence, capture a consistent full-field preservation snapshot and
   approved mapping inputs. Reconcile only explicitly evidenced purchase-field
   changes using the adoption policy; never reset newer edits. Any unexplained
   change stops execution before DDL.
5. Obtain a fresh recoverable database backup plus required roles/configuration
   and object storage/external receipt assets. Hash, secure and restore it in an
   approved isolated target; compare complete Shopping, receipt, checkout,
   financial and authorization evidence and demonstrate old-app compatibility.
   Establish RPO/RTO and operator access. A backup filename alone is insufficient.
6. Review the release-specific fail-closed guard and single-transaction envelope
   separately. Load private mapping via the same connection's temporary inputs,
   not public RPCs or Git fixtures. Apply equivalent 060→061→062→063 DDL in the
   approved envelope with bounded lock/statement timeouts, explicit ledger
   recording and postcondition assertions. No `DROP ... CASCADE`.
7. Verify 99/74/25 categories, 173 stable products, 21 links, 85 preserved original
   list rows; exact full-field receipts/plans/purchases/financial references;
   six counts 57/144, 11/19, 1/1, 10/21, 9/12, 11/21; all 15 retired signatures
   and the category-name trigger absent, all seven retained functions semantically
   intact, and no private-schema copy of the old engine. Verify RLS/GRANT denial
   using actual anon/authenticated/service roles, not only catalog inspection.
8. Commit only on successful assertions, refresh PostgREST schema cache, and
   verify actual exposed signatures and permissions before activating the
   matching backend. Pair the frontend version and reject incompatible clients.
   Production composition must replace, never dual-mount, old Shopping writers.
9. Under controlled admission, test admin edits, list edits, purchase undo/redo,
   receipt/plan preservation, mapping and exactly-once checkout; then monitor
   errors, locks and replay conflicts. Explicit owner acceptance and release
   authorization remain separate decisions.

Stop points: before fencing (any missing approval/inventory/recovery evidence),
before DDL (any drift/drain failure), before commit (any invariant failure), and
before admission (any schema-cache/auth/runtime/version failure). Never remove
the fence merely because a process exited. If deployment fails after schema
commit, keep writes fenced: either use a verified compatible forward fix, or
recover the backup with the matching old application. Do not roll back only the
application onto the retired schema. After any new writes, restoration can lose
data; require an explicitly reconciled recovery plan, not a blind restore.

## Isolated rehearsal and recovery evidence

`shoppingCutover.local.test.js` and `helpers/shoppingCutoverRehearsal.js` are
test-only and excluded from Docker. They prove a local HTTP maintenance model,
not a deployed multi-host fence. The old admitted write finishes, later writes
receive 503, and snapshot/backup occur only after drain. A restore is verified
before DDL. Four immutable migrations run in order; early activation/order
violations are rejected. Old direct writes are denied afterward, the old HTTP
path returns 410, and JavaScript commands persist through local PostgREST with
exact replay. An injected DDL failure leaves the gate fenced; restore to a
separate local database retains rows, purchase timestamps, plan/receipt and
financial identities and supports the old writer. Drain timeout fails closed.

All test databases have unique disposable labels and comments, fresh local-only
credentials, an internal Docker DB network, no published DB port or host bind
mounts, and loopback Auth/PostgREST ports. No `.env` or hosted credentials are
consulted. Only the test's own labeled containers are removed. Docker Desktop
was initially stopped; the first run reported 103 setup failures with no test
DB writes. Starting the existing local engine and rerunning resolved this.

## Security and production configuration requirements

Use existing Supabase `getUser` authentication. Configure explicit server-side
household actors and a separately approved nonempty admin identity set. The
schema is shared-household, not per-user list tenancy; do not invent ownership
from client-supplied IDs. The service role stays backend-only. Scope/read tokens
remain actor/operation/resource bound and checked against authoritative facts;
payload identities, revisions and idempotency keys cannot grant privilege.

Require HTTPS, same-origin/CORS policy, normal request-size limits (ordinary JSON
64 KiB, receipt draft/confirmation 2 MiB, existing image/file limits), safe error
translation and protected logs. Keep exact durable status/body/ETag without secret
headers; incomplete legacy replay returns an explicit error. Preserve F→K→C→R→L
lock order and provider calls outside locks. Anonymous/authenticated direct
writes and privileged RPC invocation must fail; private helpers remain inaccessible.

Current production feature gates intentionally reject production in router
constructors, and `server/index.js` still registers legacy routes. Browser flags
cannot enable new server routes. Both dev flags set during production build
still exclude preview/integration-only code. Future production composition,
approved actor configuration, historical-category identity configuration,
client/version fencing and monitoring need a separately authorized package.
No security controls were weakened to make the rehearsal work.

## Owner acceptance — normal integrated local application

Use Docker Desktop's local Linux context, installed repository dependencies and
the approved offline 059 evidence. Supply an existing external private directory
for generated synthetic credentials. No dependency update or hosted key is needed.

```powershell
Set-Location 'D:\code\finance-tracker-worktree\finance-tracker-shopping'
$env:SHOPPING_ISOLATED_TEST = 'issue-102-disposable'
$env:SHOPPING_059_BASELINE = Read-Host 'Absolute path to approved offline 059 SQL evidence'
$env:SHOPPING_OWNER_EVIDENCE = Read-Host 'Absolute private evidence directory outside the worktree'
node server/test/shoppingWorkflowOwner.local.js
```

Read the actual printed dynamic URL and generated login JSON privately. Open
`/shopping`, sign in with the generated synthetic user, and use
`/__shopping-integration` for administration. This is the normal React app and
real local Auth/Express/PostgreSQL, not the in-memory preview. The independent
`/__shopping-preview` remains dev-only. Ctrl+C cleans up that launcher's instance;
data is disposable. Real OCR/provider connectivity is deliberately not configured
for owner testing. Receipt lifecycle/persistence uses synthetic-provider automated
tests; real provider acceptance remains pending.

The launcher was smoke-tested on an actual dynamic port; all three React entry
paths returned 200, real local Auth succeeded, and synthetic lookup succeeded
with non-loopback fetches explicitly forbidden. External OCR and lookup transport
are disabled in this launcher even if ambient provider credentials exist.
Those test instances were closed; no fixed localhost URL is
promised. The browser suites also verified actual login, category/icon/product/
branch edits and reload, ordinary list/custom item/zero-price/purchase persistence,
checkout, stale-draft retention and 1440/390 px screenshots. No page errors were
recorded; external font requests were blocked. Screenshots stay outside Git.

Owner checklist (all explicit owner acceptance **Pending**):

- Desktop Hebrew RTL and mobile scrolling/focus/labels; inspect tree indentation,
  expansion, deep paths, search and keyboard operation.
- Create/rename/move category; verify repeated names across branches and sibling/
  cycle feedback; inspect neutral protection and historical/inactive filters.
- Create/edit/reassign product, preserve zero/null, bulk up to 100, and review
  duplicate suggestions without merging.
- Change list-type branches; check descendants, overlap deduplication and visible
  category/product counts; save, reload and compare.
- Create/edit list, add catalog/custom items, change quantity/unit/notes/price,
  purchase and unpurchase, then reload and verify saved values.
- Checkout a synthetic purchase once, repeat safely and verify one financial
  effect; review receipt/plan screens against the separately documented coverage.
- Cancel edits, retain unsaved drafts on failures, exercise stale conflicts with
  two tabs and verify authorization errors. Do not substitute automated checks
  for the owner's visual/usability decision.

## Quality execution and limitations

| Group | Pass | Fail | Skip | Evidence boundary |
|---|---:|---:|---:|---|
| Canonical server | 713 | 0 | 0 | Domain, adapters, legacy and financial regressions; includes focused unit groups |
| Full frontend, 59 files | 819 | 0 | 0 | Includes focused Shopping component/transport tests |
| Isolated PostgreSQL | 66 | 0 | 0 | Fresh/upgrade, roles, concurrency, restart, backup/restore, replay |
| Real admin HTTP | 15 | 0 | 0 | Includes one browser-to-DB test; do not count it twice |
| Real workflow HTTP | 22 | 0 | 0 | Includes one normal Shopping browser-to-DB test |
| New fence/migration/recovery | 4 | 0 | 0 | Two real isolated DB rehearsals plus guard/drain tests |
| Private mapping/preservation | 2 | 0 | 0 | Read-only owner evidence; no private rows emitted |

Total distinct final automated cases: **1,641 passed, 0 failed, 0 skipped**.
The initial 103 Docker-unavailable setup failures are retained in evidence and
superseded by the successful 103-case rerun, not added to this total.
Additional procedural checks: adoption/mapping/full fingerprint validation,
owner-launcher HTTP smoke, lint, production build with both dev flags set,
Linux Docker imports/production-denial/package exclusions, syntax and diff checks.
Build emitted its existing large-chunk warning. No live OCR, bank/provider,
hosted recovery, distributed production fence or production deployment test is
claimed. Full regression execution is on the feature baseline, not merged main.

Independent second-pass review covered the accumulated inventory/diff, migration
hashes, route registration, authentication injection, request/replay boundaries,
frontend dev gates, receipt/financial calls and new test harness. No runtime source
or migration was changed in E2. Existing 107 files remain byte-identical. New
files are tests/helpers, the normal-app owner launcher and readiness/checkpoint
documentation. Secret-pattern and fixture checks found no credential/private-row
snapshot in the proposed checkpoint; ignored artifacts stay outside staging.

## Ranked blockers and recommendation

1. **Critical — production execution/recovery:** approved fail-closed release
   envelope and one-transaction semantics, real backup access/restore/operator
   proof, private mapping delivery and real hosted ledger recording are pending.
2. **Critical — unknown writers and fence:** external/direct/owner clients and
   distributed in-flight operations are not exhaustively attested. Local gateway
   drain is not a production-wide fence.
3. **High — activation/security configuration:** matching backend/frontend
   composition, old-client exclusion, admin/household identity approval and live
   provider verification are pending. New routes intentionally cannot run in
   production yet.
4. **High — source integration/checkpoint:** owner must review/checkpoint the
   entire feature, integrate newer main under separate authorization and rerun
   affected financial/schema tests. No Git writes performed here.
5. **High — owner acceptance/release:** manual UX acceptance, cutover window,
   recovery decision, release candidate and publication remain owner-controlled.

Recommendation: **BLOCKED for production; ready to offer the isolated local
application for owner acceptance.** The next package should close the production
runner/backup/writer inventory and source-integration prerequisites, with explicit
scope. Do not treat this report as authorization for another gate or cutover.

## Release / Version gate

- Release impact: Yes for the integrated #102 feature; E2 itself adds internal
  tests and readiness documentation, not an independently released capability.
- SemVer impact: Major for the integrated candidate — SQL/permission retirement,
  hierarchy schema and revision contracts require coordinated client/server and
  database upgrade. E2-only tooling/documentation has None impact.
- Candidate release: Pending (TBD), owner review in #102; no number reserved.
- Grouping / included release candidate: Pending under #102, accumulated hierarchy
  and workflow work; candidate membership to be finalized by the owner.
- CHANGELOG status: Existing #102 Unreleased entry already covers 060–063 and
  coordinated cutover; unchanged in E2. Preserve newer main's additional entry.
- Version-bump status: Deferred to owner-authorized release preparation; all
  seven fields across five files remain 1.8.0 and must later be synchronized together.
- Publication status: Out of scope. Published stable baseline v1.8.0 was freshly
  verified at https://github.com/OzAvrahami/finance-tracker/releases/tag/v1.8.0
  (published 2026-10-30, not draft/prerelease). The dated old CHANGELOG publication
  note is historical, not current release state.
- Owner verification / acceptance status: Pending review; no final UX acceptance
  or production approval claimed. Issue remains Open / Backlog / P1, labels intact.
