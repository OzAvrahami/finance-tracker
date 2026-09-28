# Finance Tracker v1.4.0 — prepared / unpublished

> Historical record: dated statements, commands, acceptance and production claims below describe their original checkpoint. They are not current operating status. See the [documentation index](../README.md) and linked GitHub evidence before use.

Prepared 2026-09-28 under the owner's explicit release-preparation instruction. Coordinator: [#50](https://github.com/OzAvrahami/finance-tracker/issues/50). This is a release of the **actual main tree**, not a claim that the APY or FlowLink initiatives have finished. No final release commit or tag exists from this preparation yet.

## Release notes

- Monthly Budget transaction review now retains its originating month through filtering and editing, with a Hebrew return action and safe category/section restoration (#50).
- The backend gains auditable transaction-source provenance, atomic idempotent ingestion and conservative reconciliation foundations, preserving legacy external-ID API behavior (#80).
- FlowLink foundations add owner-authorized device pairing, independently revocable credentials, explicit multi-card bindings and owner Settings management (#87/#88). The native companion foundation includes Keychain recovery and approved binding discovery (#89), independently versioned **0.1.0 / build 1**.
- **Experimental implementation is also present:** the superseded complex Shortcut adapter (#81), native Wallet App Intent/capture queue and QR onboarding correction (#90). These are not accepted production Wallet-ingestion capabilities. Real-charge verification, locked/background behavior and remaining physical QR/enrollment checks are outstanding. Both ingestion flags must remain false; this release does not activate ingestion or distribute an iOS application.
- CAL producer reconciliation (#82), reconciliation review UI (#83), integrated APY verification (#84) and native E2E verification (#91) are unfinished. Neither parent #78 nor #85 is complete.

## Exact baseline and scope

Published stable baseline: [v1.3.1](https://github.com/OzAvrahami/finance-tracker/releases/tag/v1.3.1), annotated tag object `0d9f118f547984123c26727ac415e71fb0458ca9`, peeled commit **`c600dc036b03f5ae3f9266eb1b9de935b8683d38`**. GitHub reports stable, non-draft publication on 2026-09-18. Earlier prepared/unpublished text in its changelog/runbook is historical evidence, not current publication state.

Intended implementation tree: **`0bd74dc35d8d91440059acd1a460229c121fd4bd`**, independently verified as remote main on 2026-09-28. The delta contains 11 commits / 92 changed files. The final release target will be the **owner's subsequent integrated preparation commit**, not this pre-version-bump SHA. Verify that final SHA and its deployment before tagging/publication.

| Commit | Included change | Acceptance / scope treatment |
| --- | --- | --- |
| `034bc068701bb1547d4c20724f331cf8f190ac8e` | APY-01 #79 contract | Accepted documentation; no independent feature claim |
| `2b01db85f11a509dc7dc2a4a36b9961483ac52ca` | APY-02 #80 foundation / migration 036 | Accepted, Closed / Done |
| `98efa80f45b4d2006b2601a9e1fdd620b797a459` | APY-03 #81 HTTP adapter | Open / Verify; Shortcut UX superseded, owner acceptance Pending |
| `15c358e7a4de93c293a8bf5e6255a84b115bb471` | FlowLink planning #85 | Historical direction, not completed initiative |
| `e128fdb6478e77e13a27398d3495818dea1d3914` | FLI-01 #86 contract | Accepted documentation |
| `75cf49dab8e55d8529547ed9c01f1a73a4c32519` | FLI-02 #87 enrollment / migration 037 | Accepted, Closed / Done |
| `9cd7e5f8d94d44364830ceea3e8841543bfb8362` | FLI-03 #88 bindings / migration 038 | Accepted, Closed / Done |
| `787291d815002b2ef002b755d002b705eacf53ad` | FLI-04 #89 native foundation | Accepted, Closed / Done; no distribution claim |
| `f7b1e7003d1f9d272dda5cc34c0282089f62bf4a` | FLI-05 #90 App Intent / held captures | Open / Verify; real Wallet-charge/E2E acceptance outstanding |
| `ede60ae0eff5161e642199ef35e697bfd2319353` | #90 QR onboarding correction | Included preview; owner/device acceptance Pending |
| `0bd74dc35d8d91440059acd1a460229c121fd4bd` | #50 Budget-origin navigation | Accepted, Closed / Done |

Runtime candidate membership is **#50, #80, #81, #87, #88, #89, #90**, with accepted and experimental status exactly as above. Contracts/planning from #79/#85/#86 are included supporting history. Moving these entries into the release section records code inclusion, not completion of the open issues. No future #82/#83/#84/#91 implementation is included or promised. The two uncommitted #64 documents, all MTU implementation and unrelated local `__pycache__` files are excluded.

### SemVer and unfinished work

**Minor / 1.4.0** is the highest delivered impact: additive Budget navigation and APY/FlowLink foundations, with legacy APIs preserved and additive schema history. No unavoidable breaking consumer contract was identified in the intervening implementation records. The existing QR dependency addition (`react-qr-code@2.2.0`, from #90) belongs to the implementation baseline; release preparation does not change it or any dependency tree.

#84's v1.4.0 was explicitly proposed, not reserved. This owner-authorized release uses that number for the current tree; #84 must re-evaluate the appropriate subsequent candidate for remaining APY/FlowLink scope against the then-published line. This does not execute #84's incomplete integrated-verification checklist, close #81/#90, or grant owner acceptance. No new release tracker or milestone is created.

There is **no identified blocker to preparing the version/notes for this bounded release**. There are explicit blockers to advertising or enabling completed Wallet ingestion: #90 real runtime amount/merchant/date evidence, real-charge/locked-device/E2E verification and owner acceptance; #91's integrated validation; legacy CAL duplicate protection until #82; and #81's explicit transition/acceptance decision. Do not turn these into implied passes because deployment or version synchronization succeeded. QR UI/native code is visible preview functionality, not hidden by the financial-ingestion flags; its physical scan/enrollment acceptance remains pending.

## Existing evidence reused, not rerun

Counts are per recorded implementation checkpoint, not a new aggregate release test run. See linked records for commands, intermediate failures and limitations.

| Scope | Recorded evidence |
| --- | --- |
| [#50 navigation](https://github.com/OzAvrahami/finance-tracker/issues/50#issuecomment-5874847323) | 186/186 focused; final additional utility/router run 48/48; client build and focused lint passed. Full client run 606 passed / 4 failed before the final four cases were added; the four Import failures reproduced on the starting baseline. |
| [#80 APY](https://github.com/OzAvrahami/finance-tracker/issues/80#issuecomment-5789967559) | Server/API 355/355; APY disposable PostgreSQL 31/31; selected Savings 39/39; client build passed. |
| [#81 adapter](https://github.com/OzAvrahami/finance-tracker/issues/81#issuecomment-5790494536) | Server 375/375 including 20 Apple unit/HTTP tests; real disposable Apple persistence 14/14. These tests are not owner E2E acceptance. |
| [#87 devices](https://github.com/OzAvrahami/finance-tracker/issues/87#issuecomment-5848021758) | Server 397/397; 27 distinct FlowLink database cases across the main and added-case runs; 45 distinct APY/Apple database cases including corrected migration-chain rerun; Savings 39/39. |
| [#88 bindings](https://github.com/OzAvrahami/finance-tracker/issues/88#issuecomment-5848956778) | Server 408/408; FlowLink PostgreSQL 54/54; APY/Apple PostgreSQL 45/45; Savings 39/39; focused client 49/49 and build passed. |
| [#89 native foundation](https://github.com/OzAvrahami/finance-tracker/issues/89#issuecomment-5849173537) | Debug/Release simulator builds; 33 unit + 2 UI tests passed. Physical-device/security limitations preserved. |
| [#90 capture hold](https://github.com/OzAvrahami/finance-tracker/issues/90#issuecomment-5858174652) | 58 unit + 2 UI; 33 HTTP and 27 disposable binding DB tests; 15 migration-rehearsal checks. Disabled responses remain held until confirmed manual retry. |
| [#90 QR correction](https://github.com/OzAvrahami/finance-tracker/issues/90#issuecomment-5872084188) | 37 focused web, 33 server, 62 native unit + 3 UI tests passed; client and native builds passed. Full client 562 passed / 4 baseline-reproduced Import failures. Optical scan/device enrollment and real Wallet runtime remain unaccepted. |

The four known Import failures concern table-scoped queries for portalled category controls; they were independently reproduced, not dismissed as unexplained failures. No dependency remediation, assertions or application code are changed in this preparation. Existing bundle-size advisories remain. #50's owner approval was of local appearance; it does not assert exhaustive device/theme/production scenarios.

## Deployment, database and safety boundary

GitHub commit statuses for implementation SHA `0bd74dc35d8d91440059acd1a460229c121fd4bd` independently report Vercel and Railway success. Deployment status is not runtime testing, a live flag inspection or proof that a later preparation commit deployed.

Repository migration range is through **038**. Owner-recorded [APY-03 production evidence](https://github.com/OzAvrahami/finance-tracker/issues/81#issuecomment-5847181997) should be read from the current #81 record; [FlowLink rollout history](../operations/FLOWLINK_OWNER_ROLLOUT.md) records 037/038 deployed/verified and both flags false on 2026-09-28. This preparation performs no production access or SQL and does not independently re-prove that database state. The source contains disabled defaults and explicit guards for `APPLE_PAY_INGESTION_ENABLED` and `FLOWLINK_INGESTION_ENABLED`; they remain untouched. For an installation missing 036–038, use the existing separately authorized migration/recovery runbooks, not a blind version-bump migration command.

No new migration is needed for this release-preparation diff. Preserve APY source/observation history and FlowLink identities: once these exist, do not drop provenance or revert to code that hard-deletes managed financial history. Disable ingestion and forward-fix under the existing runbooks if necessary. Do not automatically retry held native captures or enable CAL reconciliation as part of releasing version metadata.

Normal production deployment is associated with main in the observed commit statuses; Railway/Vercel trigger settings are external and were not inspected. A main push **may auto-deploy**. Do not promise it is manual or that a feature-branch push is a supported safe preview. Owner checks provider settings before pushing; no provider configuration was changed here.

## Preparation verification and owner handoff

Separate worktree: `D:\code\finance-tracker-release-1.4.0`, branch `release/1.4.0`, based on the verified `origin/main` SHA above. The original worktree remains on `chore/multi-user-architecture-64` with both #64 documents and unrelated bytecode preserved.

Prepared files only: `package.json`, `client/package.json`, `client/package-lock.json`, `server/package.json`, `server/package-lock.json`, `CHANGELOG.md`, `README.md`, and this file. Seven product-version fields are **1.4.0**. All other JSON values, dependency/resolution trees and the independent native project/version remain byte-for-byte or structurally unchanged as appropriate. Retain Unreleased; historical release sections are untouched. No suites/builds are repeated because this diff changes only release metadata/documentation.

Owner sequence: review exact diff, commit these eight paths on `release/1.4.0`, push that branch, then integrate into main using the normal owner workflow after checking deployment triggers. If main advances, review the new delta and candidate membership before integration; do not tag an outdated preparation. Verify final remote main SHA, all seven fields and matching deployment statuses. Only afterward create the annotated tag and publish the GitHub Release against that verified final commit under separate authorization. This task supplies no tag/publish command and performs no Git write beyond local branch/worktree preparation and edits.

## Release / Version gate

- Release impact: **Yes** — accepted Budget navigation and additive APY/FlowLink foundations; experimental inclusion disclosed.
- SemVer impact: **Minor** — backward-compatible delivered scope relative to v1.3.1.
- Candidate release: **v1.4.0, prepared / unpublished**.
- Grouping / included release candidate: **#50 coordinates #50/#80/#81/#87/#88/#89/#90** as the current tree; acceptance distinctions above. Supporting #79/#85/#86 documentation is included; unfinished parent initiatives are not declared complete.
- CHANGELOG status: **Finalized in the prepared 1.4.0 section**; Unreleased retained; historical records preserved.
- Version-bump status: **Synchronized to 1.4.0 in all seven authoritative fields**, uncommitted; native 0.1.0 / build 1 unchanged.
- Publication status: **Pending owner commit/integration, final-SHA/deployment verification, annotated tag and GitHub Release**; no tag or release created.
- Owner verification / acceptance status: **Accepted for #50/#80/#87/#88/#89** and historical contracts; **Pending for #81/#90 and this prepared release review**. #64 remains independently Open / Verify, acceptance Pending.
- Production operations in this preparation: **None**; no deployment, SQL, ingestion enablement, configuration or secret changes.
