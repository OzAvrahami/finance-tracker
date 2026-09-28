# Repository organization and #46 audit

Audited 2026-09-28 at published v1.4.0 commit
`9b84a3cd112f28886d96cea249947371de6f5ac9`, in the existing checkout on
`chore/repository-cleanup-46`. The [pre-change audit/proposal](https://github.com/OzAvrahami/finance-tracker/issues/46#issuecomment-5876618041)
was recorded before restructuring. This is a file-organization audit, not a claim
that all financial code is defect-free or all externally callable code is unused.

## Maintained and local inventory

Baseline: 454 tracked files (216 client, 152 server, 43 docs, 29 iOS, 7 .github,
2 Supabase CLI metadata and 5 root files). Source responsibility follows existing
domain boundaries; this cleanup does not introduce a new runtime folder architecture.

| Area | Actual consumers / responsibility | Decision |
| --- | --- | --- |
| Root package, README, CHANGELOG, AGENTS, .gitignore | npm server start/postinstall, human/agent entry points, history and local exclusions | Shorten README; keep package behavior and policy paths |
| client/src/pages, components, hooks, context, services, utils, styles | App.jsx route imports; main.jsx/provider composition; shared UI barrel; api.js calls; CSS, icon components and browser events | Keep active feature structure, including canonical Add/Edit Transaction and Budget context |
| client tests/config | Vite test globs/setup, colocated Testing Library tests; ESLint; Vercel SPA fallback | Keep discovery, scripts and deployment paths |
| client/public and src/assets | index.html actively requests /vite.svg; no tracked react.svg reference found, no import.meta.glob found | Keep favicon; retain react.svg as an isolated low-value removal candidate, not inferred runtime breakage |
| server/routes, controllers, services, middleware, config, utils | Explicit mounts in index.js; HTTP/JWT/API-key/jobs and early Apple/FlowLink routers; helpers and domain RPCs | Keep all runtime files/exports; source comments can describe earlier stages, so use actual route mounts |
| server/test | Recursive canonical discovery; explicit disposable PostgreSQL suites; generated final-Savings runner | Update SQL paths only, including dynamic 030–035 interpolation and generated-runner injection |
| server/scripts | Supabase role and anonymous-access diagnostics; operator-invoked/networked, not server imports | Retain; update audit SQL guidance; do not execute against configured services |
| server/migrations, full_schema.sql | Tests slice/read schema and migration markers; migration scripts alter existing objects | Preserve bytes, names and order; no squash/bootstrap claims |
| docs | Domain contracts, guides, SQL, dated releases and repeated status | Group architecture/operations/history; one entry point and compatibility pointers |
| ios/FlowLink | Xcode project/shared scheme, Swift source, Info plists, native unit/UI tests and app guide | Preserve target-relative file paths, signing, independent version/build and Wallet evidence boundaries |
| .github | Issue forms link canonical policy; release labels config; process-due-loans.yml calls protected endpoint | Preserve exact workflow/form paths and execution behavior |
| supabase/.temp | Two tracked CLI cache/link metadata files; not a schema runner or migration ledger | Retain pending an owner-reviewed CLI unlink/cache-hygiene decision; contents/secrets not inspected |
| node_modules, client/dist, build/IDE output | Installed dependencies/generated assets, ignored by existing rules | No deletion/regeneration or dependency upgrade |
| .claude, ignored CLAUDE.md, design-reference/finance-v2 | Local tooling/design material outside maintained tracked source | Preserve; do not claim unused or inspect private local config |
| .git | Existing repository metadata | Same checkout; normal branch only |
| #64 drafts and docs/operations/__pycache__ | Pre-existing untracked local files | Byte-identical preservation; drafts unaccepted, multi-user deferred to v2.0.0 |

## Resulting documentation layout

```text
README.md                         concise product/local-start entry
docs/README.md                    documentation index and authority map
docs/github-development-standard.md  canonical workflow/release policy (stable URL)
docs/REPOSITORY_ORGANIZATION.md    this audit and retained uncertainties
docs/architecture/                current accounting/navigation/identity contracts
docs/operations/                  setup, database and owner runbooks, Python tools
docs/operations/sql/              stage-specific checks, exact original SQL bytes
docs/history/                     dated release, verification and planning evidence
```

Twenty-one existing Markdown documents are relocated: six technical contracts,
five operator/implementation guides and ten historical records. Two extra dated
snapshots preserve the old README and architecture overview. Nineteen SQL checks
move into operations/sql (eighteen from docs root and the FlowLink snapshot).
No SQL statement is changed. Six old Markdown paths remain short pointer pages for
demonstrated Issue/draft links; fifteen unnecessary pointers were removed after the
focused reference audit below. Maintained links use canonical locations.

The root README no longer repeats historical acceptance, the full environment table,
database lineage, roadmap or Project board. Current setup moves to DEVELOPMENT;
schema semantics move to DATABASE; releases/acceptance come from GitHub and the
small index caveat, not multiple competing live status documents. Decision records
and domain contracts are retained; only the overview is refreshed from current code.
The historical record remains accessible for details of superseded object generations.

## Exact relocation inventory

Only the six exceptions below retain old Markdown paths; the other old Markdown
paths and all old SQL paths are removed after updating their consumers. Relocated
content remains at the maintained destinations. The two extra historical snapshots
and new index/setup/database/audit pages are described above.

| Previous path (under docs/) | Maintained destination |
| --- | --- |
| `ARCHITECTURE.md` | [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) |
| `DECISIONS.md` | [architecture/DECISIONS.md](architecture/DECISIONS.md) |
| `APPLE_PAY_TRANSACTION_RECONCILIATION.md` | [architecture/APPLE_PAY_TRANSACTION_RECONCILIATION.md](architecture/APPLE_PAY_TRANSACTION_RECONCILIATION.md) |
| `FLOWLINK_NATIVE_INGESTION_CONTRACT.md` | [architecture/FLOWLINK_NATIVE_INGESTION_CONTRACT.md](architecture/FLOWLINK_NATIVE_INGESTION_CONTRACT.md) |
| `SAVINGS_V1_3_0_SPEC.md` | [architecture/SAVINGS_V1_3_0_SPEC.md](architecture/SAVINGS_V1_3_0_SPEC.md) |
| `BUDGET_TRANSACTION_CONTEXT.md` | [architecture/BUDGET_TRANSACTION_CONTEXT.md](architecture/BUDGET_TRANSACTION_CONTEXT.md) |
| `APY_02_INGESTION_FOUNDATION.md` | [operations/APY_02_INGESTION_FOUNDATION.md](operations/APY_02_INGESTION_FOUNDATION.md) |
| `FLI_02_DEVICE_ENROLLMENT.md` | [operations/FLI_02_DEVICE_ENROLLMENT.md](operations/FLI_02_DEVICE_ENROLLMENT.md) |
| `FLI_03_CARD_BINDINGS.md` | [operations/FLI_03_CARD_BINDINGS.md](operations/FLI_03_CARD_BINDINGS.md) |
| `FLOWLINK_OWNER_ROLLOUT.md` | [operations/FLOWLINK_OWNER_ROLLOUT.md](operations/FLOWLINK_OWNER_ROLLOUT.md) |
| `FUNDED_BUDGET_MIGRATION_RUNBOOK.md` | [operations/FUNDED_BUDGET_MIGRATION_RUNBOOK.md](operations/FUNDED_BUDGET_MIGRATION_RUNBOOK.md) |
| `APY_03_APPLE_PAY_SHORTCUT.md` | [history/APY_03_APPLE_PAY_SHORTCUT.md](history/APY_03_APPLE_PAY_SHORTCUT.md) |
| `FLOWLINK_NATIVE_INGESTION_PLAN.md` | [history/FLOWLINK_NATIVE_INGESTION_PLAN.md](history/FLOWLINK_NATIVE_INGESTION_PLAN.md) |
| `SAVINGS_FOUNDATION.md` | [history/SAVINGS_FOUNDATION.md](history/SAVINGS_FOUNDATION.md) |
| `PATCH_1_3_1_REVIEW.md` | [history/PATCH_1_3_1_REVIEW.md](history/PATCH_1_3_1_REVIEW.md) |
| `RELEASE_1_2_0.md` | [history/RELEASE_1_2_0.md](history/RELEASE_1_2_0.md) |
| `RELEASE_1_3_0.md` | [history/RELEASE_1_3_0.md](history/RELEASE_1_3_0.md) |
| `RELEASE_1_3_1.md` | [history/RELEASE_1_3_1.md](history/RELEASE_1_3_1.md) |
| `RELEASE_1_4_0.md` | [history/RELEASE_1_4_0.md](history/RELEASE_1_4_0.md) |
| `PROJECT_STATUS.md` | [history/PROJECT_STATUS.md](history/PROJECT_STATUS.md) |
| `ROADMAP.md` | [history/ROADMAP.md](history/ROADMAP.md) |
| `MIGRATION_028_PRODUCTION_POSTFLIGHT.sql` | [operations/sql/MIGRATION_028_PRODUCTION_POSTFLIGHT.sql](operations/sql/MIGRATION_028_PRODUCTION_POSTFLIGHT.sql) |
| `MIGRATION_028_PRODUCTION_PREFLIGHT.sql` | [operations/sql/MIGRATION_028_PRODUCTION_PREFLIGHT.sql](operations/sql/MIGRATION_028_PRODUCTION_PREFLIGHT.sql) |
| `MIGRATION_029_POSTFLIGHT.sql` | [operations/sql/MIGRATION_029_POSTFLIGHT.sql](operations/sql/MIGRATION_029_POSTFLIGHT.sql) |
| `MIGRATION_029_PREFLIGHT.sql` | [operations/sql/MIGRATION_029_PREFLIGHT.sql](operations/sql/MIGRATION_029_PREFLIGHT.sql) |
| `MIGRATION_030_PRODUCTION_POSTFLIGHT.sql` | [operations/sql/MIGRATION_030_PRODUCTION_POSTFLIGHT.sql](operations/sql/MIGRATION_030_PRODUCTION_POSTFLIGHT.sql) |
| `MIGRATION_030_PRODUCTION_PREFLIGHT.sql` | [operations/sql/MIGRATION_030_PRODUCTION_PREFLIGHT.sql](operations/sql/MIGRATION_030_PRODUCTION_PREFLIGHT.sql) |
| `MIGRATION_031_PRODUCTION_POSTFLIGHT.sql` | [operations/sql/MIGRATION_031_PRODUCTION_POSTFLIGHT.sql](operations/sql/MIGRATION_031_PRODUCTION_POSTFLIGHT.sql) |
| `MIGRATION_031_PRODUCTION_PREFLIGHT.sql` | [operations/sql/MIGRATION_031_PRODUCTION_PREFLIGHT.sql](operations/sql/MIGRATION_031_PRODUCTION_PREFLIGHT.sql) |
| `MIGRATION_032_PRODUCTION_POSTFLIGHT.sql` | [operations/sql/MIGRATION_032_PRODUCTION_POSTFLIGHT.sql](operations/sql/MIGRATION_032_PRODUCTION_POSTFLIGHT.sql) |
| `MIGRATION_032_PRODUCTION_PREFLIGHT.sql` | [operations/sql/MIGRATION_032_PRODUCTION_PREFLIGHT.sql](operations/sql/MIGRATION_032_PRODUCTION_PREFLIGHT.sql) |
| `MIGRATION_033_PRODUCTION_POSTFLIGHT.sql` | [operations/sql/MIGRATION_033_PRODUCTION_POSTFLIGHT.sql](operations/sql/MIGRATION_033_PRODUCTION_POSTFLIGHT.sql) |
| `MIGRATION_033_PRODUCTION_PREFLIGHT.sql` | [operations/sql/MIGRATION_033_PRODUCTION_PREFLIGHT.sql](operations/sql/MIGRATION_033_PRODUCTION_PREFLIGHT.sql) |
| `MIGRATION_034_PRODUCTION_POSTFLIGHT.sql` | [operations/sql/MIGRATION_034_PRODUCTION_POSTFLIGHT.sql](operations/sql/MIGRATION_034_PRODUCTION_POSTFLIGHT.sql) |
| `MIGRATION_034_PRODUCTION_PREFLIGHT.sql` | [operations/sql/MIGRATION_034_PRODUCTION_PREFLIGHT.sql](operations/sql/MIGRATION_034_PRODUCTION_PREFLIGHT.sql) |
| `MIGRATION_035_PRODUCTION_POSTFLIGHT.sql` | [operations/sql/MIGRATION_035_PRODUCTION_POSTFLIGHT.sql](operations/sql/MIGRATION_035_PRODUCTION_POSTFLIGHT.sql) |
| `MIGRATION_035_PRODUCTION_PREFLIGHT.sql` | [operations/sql/MIGRATION_035_PRODUCTION_PREFLIGHT.sql](operations/sql/MIGRATION_035_PRODUCTION_PREFLIGHT.sql) |
| `SAVINGS_RELEASE_POSTFLIGHT.sql` | [operations/sql/SAVINGS_RELEASE_POSTFLIGHT.sql](operations/sql/SAVINGS_RELEASE_POSTFLIGHT.sql) |
| `audit_003_readonly.sql` | [operations/sql/audit_003_readonly.sql](operations/sql/audit_003_readonly.sql) |
| `operations/flowlink_snapshot.sql` | [operations/sql/flowlink_snapshot.sql](operations/sql/flowlink_snapshot.sql) |

## Compatibility pointer exceptions

Refined before owner review on 2026-09-28. Authenticated GitHub CLI readback covered
89 open/closed Issue/PR bodies and 93 comments, including absolute, relative and
reference-style Markdown links. Maintained repository links already target canonical
locations; only the protected #64 architecture draft retains six local old-path links.
Plain historical filename mentions are not live links. No historical GitHub text was
rewritten.

| Retained docs-root pointer | Demonstrated reason |
| --- | --- |
| `APPLE_PAY_TRANSACTION_RECONCILIATION.md` | Linked by the protected `MULTI_USER_ARCHITECTURE.md` draft |
| `APY_02_INGESTION_FOUNDATION.md` | Linked by the same protected draft |
| `ARCHITECTURE.md` | Linked by the protected draft and a [live main-branch link in #36](https://github.com/OzAvrahami/finance-tracker/issues/36) |
| `FLI_02_DEVICE_ENROLLMENT.md` | Linked by the protected draft |
| `FLI_03_CARD_BINDINGS.md` | Linked by the protected draft |
| `FLOWLINK_NATIVE_INGESTION_CONTRACT.md` | Linked by the protected draft |

The links from #79 to the APY contract and from #31/#32/#33/#35 to the old status or
Budget runbook target immutable commit SHAs. Those historical files remain reachable
in Git and do not require a pointer on current main. No other live old-path Issue
link was found in the inspected corpus. External links outside that corpus cannot be
proven absent; no known link is deliberately broken.

Removed pointers (canonical documents retained): `APY_03_APPLE_PAY_SHORTCUT.md`,
`BUDGET_TRANSACTION_CONTEXT.md`, `DECISIONS.md`, `FLOWLINK_NATIVE_INGESTION_PLAN.md`,
`FLOWLINK_OWNER_ROLLOUT.md`, `FUNDED_BUDGET_MIGRATION_RUNBOOK.md`,
`PATCH_1_3_1_REVIEW.md`, `PROJECT_STATUS.md`, `RELEASE_1_2_0.md`,
`RELEASE_1_3_0.md`, `RELEASE_1_3_1.md`, `RELEASE_1_4_0.md`, `ROADMAP.md`,
`SAVINGS_FOUNDATION.md` and `SAVINGS_V1_3_0_SPEC.md`.

The docs root now contains **11 files**: six justified pointers, `README.md`,
`REPOSITORY_ORGANIZATION.md`, `github-development-standard.md`, and the two protected
unaccepted drafts `MULTI_USER_ARCHITECTURE.md` / `MULTI_USER_INVENTORY.md`.
The latter remain outside #46's intended commit and outside the release. When the
owner resumes v2.0.0 work, review their references before considering removal of the
five draft-only pointers; #36's external link remains a separate requirement.

Focused refinement checks: 78 affected local links resolved, no maintained links
point to the 15 removed files, and three referenced immutable Git targets remain
present. All other file hashes matched the pre-refinement snapshot (including
migrations, schema, drafts and runtime). UTF-8 and whitespace checks passed. No
application suites or version changes were performed.

## Usage evidence and path handling

Inspection included package scripts, server mounts, App.jsx, Vite globs, Node test
discovery, dynamic imports/requires, shared component exports, asset/HTML/CSS paths,
Xcode source paths, the due-loan workflow, SQL file reads, generated runners and the
FlowLink rehearsal's `Path(__file__).parents[2]`. Runtime/config/assets do not move.

Operational SQL has real consumers: `path.join` for 028; literal strings for
029–035; template interpolation in the Savings release suite; injected SQL in
run-savings-release.cjs; and the FlowLink Python snapshot reader. Each is updated,
not just Markdown links. Python tools stay in place so root derivation/imports work.
All commands in docs are interpreted relative to their documented repository root;
Markdown links are relative to the document. Historical commit URLs remain immutable.

## Intentionally retained / follow-up findings

- No maintained runtime module, dependency or asset is deleted. Static import absence
  is not proof against HTTP, job, operator or dynamic use. Vite's favicon is live;
  removing/replacing it would be a separate visible design choice.
- Item/LEGO/keyword/import/Shopping transaction logic has overlapping responsibilities
  and multi-call atomicity boundaries. Consolidating it is a financial change requiring
  domain-specific regression work, not safe textual deduplication. APY adapters do
  not yet replace every importer. Preserve accounting contracts.
- Client/server money/pricing and native normalization are separate runtime boundaries;
  similar functions do not justify a new shared package or changing exact-money semantics.
- Tracked Supabase CLI `.temp`, globally ignored LICENSE patterns and unusual ignore
  entries merit focused future hygiene review. No CLI link change, license decision,
  dependency removal or local-file cleanup is authorized by inferred obsolescence.
- A production bootstrap/ledger and generic CI are absent. Existing disposable
  rehearsals are useful but do not supply either; adding them is substantive follow-up.
- Large controllers/hooks and legacy Loan modes remain. No abandoned alternative was
  proven removable without behavior risk. Keep uncertain items explicit rather than
  expanding #46 into a financial rewrite.
- Protected #64 draft source line references are historical and can become stale;
  preserved compatibility pointers keep document targets reachable. Revalidate those
  unaccepted drafts only when the owner resumes v2.0.0 work.

## Validation scope

Check UTF-8/local Markdown targets and referenced anchors, root/relative operational
paths (including generated/dynamic consumers), unchanged runtime entry points,
all 38 migration hashes, full-schema hash and every relocated SQL hash. Verify
protected local files, version manifests/locks and native project are unchanged.
Run syntax/path-load checks for the changed test/script consumers without invoking
database/network operations. Application suites are not needed when their assertions,
SQL contents, runtime and build configuration remain unchanged. Record actual results
on #46; do not reuse historical counts as fresh execution.

Executed for this diff: 13 changed JS/CJS/Python consumers passed syntax checks and
an exact path-substitution-only comparison. All 34 literal/expanded SQL references
loaded. An offline VM smoke loaded nine disposable test modules (208 registrations
not executed) and exercised/compiled five generated Savings runners, including the
postflight injection; database/process calls were blocked. No application suites,
builds, Docker databases or production diagnostics ran. All 38 migration hashes,
full-schema hash and protected local-file hashes matched. All 19 relocated SQL files
matched the original Git blob or its checkout line endings with no content change.
Local Markdown links/anchors, strict UTF-8, new-file whitespace and git diff --check
passed; the index is empty and versions/dependencies/native configuration are unchanged.

## Release / Version gate

- Release impact: **No** — internal organization, documentation and equivalent check paths.
- SemVer impact: **None** — no runtime/API/accounting change.
- Candidate release: **Not applicable**; no product release for this cleanup.
- Grouping / included release candidate: **Standalone #46**, outside APY/FlowLink and deferred multi-user scope.
- CHANGELOG status: **Not applicable** for this non-product change; existing historical links and publication-status annotation updated.
- Version-bump status: **Not applicable**; seven fields remain 1.4.0, native 0.1.0/build 1 unchanged.
- Publication status: **Out of scope**.
- Owner verification / acceptance status: **Pending review**.
