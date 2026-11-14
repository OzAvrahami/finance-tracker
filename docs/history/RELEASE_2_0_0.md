# v2.0.0 — prepared release candidate

Prepared on **2026-11-14**. **Unpublished; local metadata and documentation only.**

The published stable baseline is [v1.8.0](https://github.com/OzAvrahami/finance-tracker/releases/tag/v1.8.0), published 2026-10-30 and reverified as Latest on 2026-11-14. The source baseline for this preparation is `a8691382e98704ed470f678f7f8181234c06fa74`, the separate production-activation checkpoint on `feat/shopping-category-hierarchy`. It follows integrated checkpoint `81b2de6e34f7e4b0a2c1429aa5722262607b56d1` and includes the #99 manual-refund merge and historical ingestion-test fixture correction. This preparation creates no commit, tag, deployment or GitHub Release.

## Candidate scope

[Issue #102](https://github.com/OzAvrahami/finance-tracker/issues/102) coordinates this **Major** candidate. The included #99 scope is specifically the manual-refund entry correction from `7061064`, integrated through `81b2de6`. It is not in the published v1.8.0 release notes; its existing Unreleased entry moves here once, without rewriting earlier ingestion release history or claiming completion of all of #99.

The source tree also inherits earlier changes since v1.8.0, including unified ingestion, bank-account sources/credits, refund editing and ingestion Package 1. Their unrelated Unreleased entries and acceptance limitations remain in place. This scoped release record does not remove that inherited code from the artifact, newly authorize producer activation, or imply acceptance of those other packages. Native FlowLink work and its independent version/build are not part of this candidate.

### Shopping hierarchy and administration

- Unlimited-depth category relationships, stable identities, full administration paths, sibling-scoped names, protected neutral category and explicit historical/inactive views.
- Category creation, combined edits, reparenting and activity management; catalog search, creation/editing and atomic category reassignment for up to 100 products. Duplicate candidates remain review suggestions, never automatic merges.
- Editable list-type branch assignments inherit descendants, deduplicate overlapping selections and expose effective category/product counts without cloning products.
- Hebrew RTL administration within Settings. Shopper-facing category paths omit only the top-level root; full administration paths and stored identities remain unchanged.
- JavaScript-owned list, item, purchase marking, receipt, commercial-mapping and checkout workflows, backed by narrow atomic persistence. Revision conflicts and durable idempotent HTTP replay preserve all-or-nothing behavior.
- Historical categories, list references, purchase flags/timestamps, quantities, prices, notes, receipt evidence, frozen plans and financial identities remain preserved. Zero monetary values stay zero.

### Integrated manual-refund correction (#99)

The ordinary expense form accepts negative amounts for new refunds and owner-editable existing expenses, including rows without a prior refund marker. Authenticated JavaScript commands derive the classification and preserve exact negative expense amounts and null installments. Protected links, imported evidence, duplicate review and financial identity remain guarded. Unrelated card installment schedules no longer block manual refunds. Migration 059 precedes the matching application update; deployed 058 is not rewritten. See the [original correction record](../architecture/INGESTION_PACKAGE_1.md#manual-refund-entry-correction-2026-11-09).

## Breaking compatibility and upgrade requirements

The Major increment reflects **schema, SQL permissions and coordinated HTTP compatibility**, not a change to financial classification semantics or a promise of tenant isolation.

1. Verify the actual migration ledger and current preservation evidence, including the existing 059 state. Do not reuse identifiers or overwrite newer user edits to force historical counts.
2. Fence and drain Shopping writers before changing the schema, while keeping unrelated financial functionality available where safe. Old receipt callbacks, direct database writers and old application instances must not coexist as incompatible writers.
3. Use the pinned production-compatible execution bundle derived from immutable 060–063. The original 060/061 disposable identity guards are not a standalone production execution path. The derived bundle validates production identity, ledger and preservation evidence, uses a bounded transaction, and replaces nontransactional sequence adjustment with an equivalent transactional restart. Keep private catalog mapping outside source control and deployment artifacts.
4. Coordinate 060 hierarchy/SQL retirement, 061 combined category edits, 062 complete durable administration replay, and 063 workflow persistence with the matching Express/React code. The additional `20261114152838_shopping_owner_http_read_boundary.sql` restricts Shopping reads to the backend service role. Required financial permissions and manual-refund behavior are preserved.
5. Refresh PostgREST metadata, verify preservation/permissions and matching backend readiness, then admit new Shopping writes. Browser writes carry `X-Shopping-Contract: hierarchy-v1`; old clients receive 426 and must reload/upgrade. Administration requires server-side owner authorization, revisions and idempotency contracts; client preview flags grant no authority.

**These migrations were already applied to the verified production environment on 2026-11-14. Do not rerun them as a version-bump step.** See the [activation procedure](../operations/SHOPPING_PRODUCTION_ACTIVATION.md) and [persisted production report](https://github.com/OzAvrahami/finance-tracker/issues/102#issuecomment-6879810548). A prior application deployment is not a schema rollback. After a committed migration failure, fence Shopping and use a compatible forward fix; no unverified restore/reset is authorized.

## Recorded production evidence — 2026-11-14

This is evidence from the completed activation, not a new production test or deployment during release preparation.

| Evidence | Verified activation result |
| --- | --- |
| Backend | Railway `dcf63a16-5d78-4fa4-a74c-e35090894a3d`; healthy matching runtime |
| Frontend | Vercel `dpl_8anP2gS27p1AY6aV9NwTB1YHhm1h`; matching production artifact |
| Categories | 99 total: 74 active, 25 historical inactive |
| Catalog / links / lists | 173 preserved product identities, 21 branch links, six list types, five lists, 85 original list rows |
| Preservation | Original list-row fingerprints, purchase states, receipts, frozen plans, checkout/mapping evidence and financial fingerprints unchanged |
| SQL retirement | 15 obsolete function signatures and obsolete category-name trigger absent; seven approved functions retained |
| Permissions | All 15 Shopping tables retain RLS; anonymous table reads and privileged RPC probes reject; owner-authorized Express reads succeed |
| Browser smoke | Existing lists, disposable list/item creation, purchase mark/unmark, owner administration and visibility preview; zero product price persisted through HTTP/DB and browser reload |

Temporary smoke records were removed using exact identity/dependency checks. No original purchase state was toggled for testing. Category edit inspection was cancelled and approved branch mappings were not altered by smoke tests. The activation report records exact SQL signatures, ledger entries and prior regression counts. The deployed artifacts were uploaded before the checkpoint commit; that report's uncommitted-source description remains historical. The subsequent checkpoint now exists locally at the SHA above.

## Known limitations and acceptance

- The owner explicitly waived a mandatory verified pre-migration backup. Hosted backup access, recoverability and restoration have **not** been demonstrated; the waiver accepts risk rather than solving it.
- No real-provider/OCR receipt flow, irreversible production checkout or real refund transaction was triggered for testing. Isolated regressions and preserved production evidence do not establish live-provider acceptance.
- External clients were not exhaustively discovered. Retired SQL/direct-write paths reject them; compatibility is not promised for unidentified historical clients.
- Initial ordinary Shopping and administrative access is restricted to the existing configured owner account. Service-role credentials remain backend-only. This is not a multi-tenant authorization release.
- Final owner production acceptance is **Pending**. Earlier visual-direction approval and automated/browser checks do not replace it.
- At preparation, the feature remote still points to `81b2de6` and main to `7061064`; the activation checkpoint is one local commit ahead of its remote. Prevent older-main automatic deployment against the migrated schema. Owner-controlled source publication/integration and reviewed deployment configuration remain prerequisites for subsequent deployments.

## Local release-preparation verification

The seven fields in root/client/server manifests and the two lockfile root records are synchronized to **2.0.0**. Dependency versions/trees, engines, runtime code, FlowLink, migrations and activation code are unchanged. No root lockfile is created. Settings imports the client manifest version directly; a new build displays `v2.0.0` in About. Existing deployed artifacts still carry 1.8.0 until a separately authorized matching build/deployment.

| Check executed for this preparation | Result |
| --- | --- |
| `npm test --prefix server` | 717 passed, 0 failed, 0 skipped |
| `npm test --prefix client` | 848 passed, 0 failed, 0 skipped; 60 test files, including Settings/About and Shopping |
| `npm run lint --prefix client` | Passed |
| `npm run build --prefix client` | Passed; Vite reports a chunk-size warning (App bundle exceeds 500 kB) |
| `node --check` for tracked server JavaScript | 243 files passed, 0 failed |
| Version/dependency comparison against HEAD | Seven version fields equal 2.0.0; every other parsed JSON value unchanged; no root lockfile |
| Settings build inspection | Built Settings/About code embeds 2.0.0; development preview route absent |
| Preservation / complete diff review | No runtime, migration, activation or FlowLink changes; old CHANGELOG sections and unrelated Unreleased entries unchanged (Git line-ending normalization accounted for) |
| `git diff --check` | Passed |

Frontend tests used synthetic loopback Supabase configuration only within their test process. No hosted request, migration or deployment was performed. The Express server has no separate build or lint script; its canonical tests and syntax checks ran. Isolated database, Docker, provider and production smoke results are not claimed as rerun for this metadata/documentation-only preparation. Both existing Git stashes remain unchanged; all nine preparation files are unstaged.

### Files prepared

Version metadata: `package.json`, `client/package.json`, `client/package-lock.json`, `server/package.json`, `server/package-lock.json`.

Documentation: `CHANGELOG.md`, `README.md`, `docs/github-development-standard.md`, and this new `docs/history/RELEASE_2_0_0.md` record. README no longer implies that v2.0.0 delivers multi-user isolation. Earlier dated release notes remain historical.

Owner-executable commands after reviewing the diff (not executed during preparation):

```powershell
Set-Location 'D:\code\finance-tracker-worktree\finance-tracker-shopping'
git diff --check
git diff -- package.json client/package.json client/package-lock.json server/package.json server/package-lock.json CHANGELOG.md README.md docs/github-development-standard.md
Get-Content docs/history/RELEASE_2_0_0.md -Encoding UTF8
git add -- package.json client/package.json client/package-lock.json server/package.json server/package-lock.json CHANGELOG.md README.md docs/github-development-standard.md docs/history/RELEASE_2_0_0.md
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "chore(release): prepare v2.0.0 candidate (#102, #99)"
```

Review the staged content before executing the final command. Push, integration, deployment, tagging and publication require separate owner action/authorization.

## Publication prerequisites and owner handoff

1. Review this candidate, the complete preparation diff, outstanding production limitations and final owner acceptance. Keep #102 Open / Verify until that acceptance.
2. Commit only the reviewed metadata/documentation paths; preserve stashes and unrelated work. Push only with owner authorization and verify the remote commit. No merge to main is performed by this preparation.
3. If version display is to change in production, separately authorize a coordinated build/deployment of the matching source. Verify Settings/About and backend/frontend revisions; do not rerun data migrations for metadata changes.
4. Separately authorize an annotated `v2.0.0` tag at the verified release commit and GitHub Release publication from these reviewed notes. Verify the peeled commit, release URL, non-draft/non-prerelease flags and intended Latest status. Do not use automatic all-commit notes to imply acceptance of unrelated Unreleased work.

## Release / Version gate

- Release impact: **Yes** — Shopping functionality and operational compatibility changes, plus the scoped manual-refund correction.
- SemVer impact: **Major** — intentional schema, SQL permission and HTTP contract changes requiring coordinated upgrade; the #99 correction itself is Patch-level.
- Candidate release: **v2.0.0, prepared and unpublished**.
- Grouping / included release candidate: **#102 coordinates #102 plus the integrated #99 manual-refund entry correction only**; other Unreleased packages retain their status.
- CHANGELOG status: **Prepared 2.0.0 section**, dated as preparation; historical sections and unrelated Unreleased entries preserved.
- Version-bump status: **Synchronized — 2.0.0 in all seven inventoried fields**.
- Publication status: **Deferred / outside this task's authorization** — owner-controlled commit/push, tag, deployment and publication remain separate.
- Owner verification / acceptance status: **Pending final production and release review**.
