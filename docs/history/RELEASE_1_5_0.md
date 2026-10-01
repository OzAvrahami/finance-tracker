# Finance Tracker v1.5.0 — prepared, unpublished

Prepared 2026-09-30. This is not a publication or production verification record.

## Candidate and acceptance

- Feature: `13c425baec91684974ab2893407159a0b5633400` (`feat(shopping): add purchase habits and receipt reconciliation (#92)`). The owner committed release preparation as `fab1ad84e86a00d758921aea9f46699783a77f59`. The packaging correction still requires the owner's commit on `feat/shopping-habits-receipts-92`; the final integrated release SHA must be verified later.
- Baseline: published v1.4.0, `9b84a3cd112f28886d96cea249947371de6f5ac9`.
- Coordinated scope: [#92](https://github.com/OzAvrahami/finance-tracker/issues/92). The owner accepted the name-approval, personal-item mapping and draft-persistence workflow. This does not imply every receipt, financial scenario or production installation has been verified. Keep the issue open pending integration/release completion; Project fields remain automation-owned.
- Actual intervening tree also contains #46 documentation/database-check organization (`71faa5c`) and #90 native corrections (`52abba4`, `97556f8`, `2e25f38`), already on main. #46 has no product SemVer impact. On 2026-10-01 the owner reports that #90 was successfully tested on the phone and the transaction was saved in the app. Record that specific successful evidence without inferring a particular backend financial state or every device scenario. #90 is not a blocker for #92; preserve its working configuration. Its separately tracked CHANGELOG entries remain under Unreleased. This is a release of the complete integrated tree, not a selective exclusion of those commits.
- #81 and unfinished APY CAL/review/E2E work and FlowLink #91 are not completed by this candidate. Preserve the existing ingestion settings rather than changing them for Shopping. Multi-user drafts and work remain outside this release, deferred to v2.0.0.

## Release notes

Finance Tracker adds Shopping purchase habits and receipt reconciliation in the existing Hebrew RTL workflow:

- Maintain regular personal items and usual quantities; generate editable lists and explained suggestions from confirmed purchase occasions. First-use and sparse-history flows do not pretend to know pantry stock.
- Extract one receipt from ordered photos, resolve confident adjacent-photo overlaps, and review a compact editable table. Preserve genuinely repeated purchase occurrences and show uncertain readings for correction.
- Review original unit prices, whole-row discounts, net unit prices and final totals. Keep printed evidence separate from calculated values, weighted quantities intact, and discrepancies visible.
- Save durable revision-checked drafts, including corrections and deletions. Reprocessing preserves recoverable drafts and bounded attempts; retry safeguards prevent duplicate confirmation and checkout effects.
- Retain exact commercial identifiers and receipt names; propose sourced catalog names for explicit approval. Link several commercial products to one personal shopping need through owner-approved mappings and compatible quantity conversions, without conflating product identity with purchase occurrence.
- Preserve the original plan and historical mapping snapshots. Scanning, name approval, mapping and draft saving do not confirm purchases or create expenses. Only confirmed purchases inform habits; explicit checkout atomically records the financial effect.

External catalog coverage is incomplete, including household products and retailer-specific codes. Exact-code results can still require owner review; absent matches retain receipt names. OCR, overlap resolution and quantity conversions are not perfect: uncertain values and total discrepancies need review. Isolated testing and the owner's accepted review workflows do not establish universal extraction quality or production readiness.

The tree retains existing Apple/FlowLink infrastructure. The owner reports successful #90 phone execution with the transaction saved in the app; its working configuration is preserved. This does not complete the separate unfinished APY initiative. No native distribution or multi-user capability is included in this release decision.

## Evidence reused and release-only verification

The feature handoff records server **473/473**, Shopping client **46/46**, and disposable PostgreSQL **29/29** tests, plus targeted client lint and a successful client build. These are implementation evidence for the feature commit, not newly executed release-preparation suites. Isolated desktop/mobile review and an initial owner live-extraction success are limited evidence, not full production acceptance.

Release-preparation verification: **7/7** JSON version fields at 1.5.0; all other manifest/lockfile data identical to the feature commit; **12** changed files valid UTF-8; **87** local Markdown links/anchors resolve; **83** protected files unchanged (native files, migrations, environment files and unrelated drafts/cache). `npm run build --prefix client` passed (2,621 modules; existing large-chunk advisory). Working and staged `git diff --check` passed. No additional OCR, application mutation, production access or feature-suite rerun occurred. FlowLink's independent version/build and all migration bytes remain unchanged.

## Owner deployment and publication boundary

Follow the [039–044 deployment runbook](../operations/SHOPPING_RECEIPTS.md#v150-deployment-preparation). Production application of these migrations is **not verified or performed** by this preparation. Do not deploy the new Shopping runtime before the complete schema upgrade, or leave old Shopping writers active during cutover. The normal environment files are untouched.

1. Review and commit the staged preparation; then perform owner-managed integration/push. First account for any automatic deployment trigger so schema prerequisites cannot be bypassed.
2. Authorize and perform the documented backup, write pause, preflight, ordered migration, postflight, configuration and deployment sequence. Verify the exact integrated SHA and deployment statuses separately.
3. Reconfirm all seven fields at that final SHA and that v1.5.0 is still available. Only then separately authorize annotated tag/push and stable GitHub Release publication using **Release notes** above, excluding this preparation record.

The later read-only integration review found a concrete deployment blocker: Railway's `/server` source root omits the new root `shared/` modules. The packaging correction adds repository-root Docker packaging with a locked server-only install, explicit startup/health/watch configuration, and explicit Vercel install/build/output commands. Local clean-export Linux validation passed **7/7** checks (backend startup/shared imports, frontend build and server-secret sentinel exclusion); see the [exact provider settings and controlled hold](../operations/SHOPPING_RECEIPTS.md#packaging-correction-and-provider-settings).

The local correction does not change live settings. On 2026-10-01 the owner authorized hosting configuration, pending migrations, integration/push and ordered deployment, with **a mandatory pause for the owner's packaging commit before deployment holds or production modifications**. After that commit, control unwanted preview/production triggers rather than creating a new preview environment, apply the root/context correction and Vercel source inclusion, and execute the existing cutover. Migrations 039–044, production deployment and final integrated SHA verification remain outstanding. The recorded workflow acceptance is unchanged; no additional OCR or financial test is implied.

## Release / Version gate

| Field | Prepared state |
| --- | --- |
| Release impact | Yes — Shopping capability |
| SemVer impact | Minor — backward-compatible capability; schema-before-runtime deployment required |
| Candidate | v1.5.0, unpublished |
| Grouping | Standalone #92 coordination; actual #46/#90 tree carryover disclosed above |
| CHANGELOG | #92 moved to prepared v1.5.0 section; unrelated Unreleased entries preserved |
| Version bump | Synchronized locally: seven fields at 1.5.0; dependencies/native versions unchanged |
| Publication | Pending owner integration, final SHA verification, tag and release authorization |
| Owner acceptance | Accepted for name approval, personal-item mapping and draft persistence; broader production verification outstanding |
| Migration/deployment | Authorized 2026-10-01; pending owner packaging commit, then controlled cutover; none performed here |
