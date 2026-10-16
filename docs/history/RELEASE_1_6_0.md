# Finance Tracker v1.6.0 candidate

## Shipping preparation update — 2026-10-16

The owner explicitly accepted shipping the current #95 scope and authorized its
production rollout, while reserving the Git commit to the owner. This accepts the
known implementation limits; it does **not** assert that missing manual desktop,
mobile, theme or live scanned-receipt checks were performed. Further improvements
can follow separately. Tagging and formal GitHub Release publication are out of scope.

Live release readback still shows **v1.5.0** as Latest; no v1.6.0 release exists.
The additive #95 work joins the existing **v1.6.0** candidate. All seven version
fields already equal 1.6.0 and remain unchanged; no 1.7.0 bump is warranted.

Finalized candidate membership relative to published v1.5.0:

- #82: opt-in CAL reconciliation (`e4dbf01`).
- #83: owner review UI and amount formatting (`3861684`).
- #84: billing-contract compatibility (`7933ebc`).
- #93: existing collection/minifigure/search/status improvements (`38b2b8f`),
  including the additive `lego_sets.subtheme` migration 048.
- #95: Shopping PDFs/larger uploads, merchant validation, accepted generic-product
  mappings and atomic quantity fulfillment, with forward migration 049.

`5391e53` prepared the existing version fields. Main also contains native recovery
commits `8258798` and `713027c`; they remain disclosed tree carryover, without a
new native build, distribution or completion claim. Their separate Unreleased
notes and #90/#91 acceptance/activation boundaries remain intact. No FlowLink code
or configuration changes are included in this shipping preparation. Candidate
membership does not mean all pre-existing open issues are complete.

Read-only production evidence: Railway's successful deployment
`62d4e3d2-11a6-4e58-8184-a3c4e8742d62` runs main SHA
`713027cbf5cb886b3d35827cdbc56345a9bb0f29`; GitHub records Vercel Production success
at the same SHA. Thus the older "undeployed" preparation checkpoint below is
historical. Railway's effective deployment uses repository-root Docker packaging.
An active GitHub main trigger has `checkSuites=false`; a push is **not** a deployment
hold. Vercel's current trigger/build controls and aliases still require authenticated
readback. No trigger was changed during preparation.

The production PostgREST schema was inspected through the existing Railway service
credentials without returning private rows or credentials. Shopping tables, drafts,
commercial mappings and expected existing RPCs are exposed; 049's columns/context/
move RPCs are absent. CAL billing columns/RPCs and LEGO `subtheme` are exposed.
This is current schema evidence, **not proof of complete migration bodies, grants,
constraints or a recoverable backup**. Direct PostgreSQL catalog/backup access is
still required. Never rerun 039–048 based on the historical pending list below.

Reuse #95's 65 focused backend, 35 disposable PostgreSQL and 26 UI tests, targeted
lint, frontend build, private local PDF verification and synthetic local-API retry/
fulfillment evidence. Private receipt contents and credentials remain outside the
repository. No production receipt upload, purchase confirmation, expense or import
replay is part of deployment verification. Exact staged Linux artifact validation
uses `python docs/operations/verify_deployment_package.py --staged`, including
native image/PDF rendering with network disabled and synthetic input.
This check passed **8/8** on the staged candidate: clean Linux Node 22 backend and
frontend builds, native sharp/canvas and PDF text/scanned-page workers, startup
health, shared modules, secret-sentinel exclusion and unchanged lockfiles. The
frontend retains its existing bundle-size advisory. This validates the candidate
artifact locally; it is not a new production deployment or live scanned OCR test.

The reviewed ordering/recovery procedure and outstanding access requirements are
in [the #95 rollout section](../operations/SHOPPING_RECEIPTS.md#95-production-shipping-decision--2026-10-16).
No production mutation, migration or deployment has occurred for #95 at this
checkpoint. Commit, database backup/catalog checks and controlled cutover remain.

## Historical preparation checkpoint — 2026-10-01

Prepared **2026-10-01; unpublished and undeployed**. Feature branch
`feat/reconciliation-review-83` was verified locally and remotely at
`7933ebc3e42586ec7c16f48e6aa5506f42bbc248`. Relative to published v1.5.0
(`8063330e55763c586af95c4446218ffae684f5ce`), scope is #82, #83 and the
#84 billing-contract correction: three commits. Version preparation is uncommitted.
The v1.6.0 tag/release was absent during preparation.

## Release notes

- CAL/card-site imports can opt into the same atomic ingestion and reconciliation
  path as FlowLink. Independent source identities, exact retries and original
  provider evidence are retained; ambiguous associations require explicit review.
- Transactions show compact source status and an owner-only Hebrew RTL review
  workflow. Linking adds provenance without another expense; keeping a purchase
  separate uses the existing atomic command and displays its financial effect.
  Merchant evidence remains separate from owner-edited descriptions.
- Desktop/mobile transaction amounts display PostgreSQL numeric strings correctly
  with two-decimal ILS formatting, without altering financial amounts.
- The coordinated Bridge v3.1.0 contract carries exact billed ILS and separate
  original-currency evidence. Migration 047 preserves immutable billing evidence
  and old/new replay compatibility without rewriting financial history.

Requires pending migrations **045 → 046 → 047** before the matching backend and
frontend. Reconciliation management uses `FLOWLINK_OWNER_USER_IDS`; CAL registration
uses `CAL_INGESTION_SOURCES`. Bridge selects exact provider/source-account/full
payment-source streams; other streams remain legacy. Registration and activation
are separate deliberate steps, not defaults enabled by this release.

Known limits: no inferred purchase timestamp, exchange rate or universal merchant
alias; unknown events/refunds/installment parts are explicitly unsupported by the
initial automatic posting contract. Real installment behavior on card 2755 is not
verified, and no real installment failure there is claimed. A pending import means
durable evidence, not necessarily an expense. Production phone posting and later
real CAL reconciliation remain pending under #91.

Existing #46 repository organization and #90 FlowLink work are already in the
v1.5.0 baseline, not new scope. Keep the existing #90 Unreleased entries and working
configuration; this release does not infer completion of broader APY/device criteria.

## Validation and acceptance

- Reused committed #82/#83 verification and owner acceptance of the refined UI:
  linking synthetic ILS 10 left total expenses at ILS 22; two ILS 6 purchases stayed
  separate. No additional mobile or production acceptance is inferred.
- Resumed the specifically blocked disposable PostgreSQL case: **1/1 passed**,
  actual Bridge exporter → consumer persistence with saved FX evidence and
  lost-response replay. Portless disposable container only, removed by the test.
- Targeted Bridge mixed-stream/frozen-retry/registration/export checks: **4/4 passed**.
  Reused prior 69 Bridge + 9 sync + 17 consumer tests and 30 distinct persistence
  scenarios for unchanged behavior. No broad suite, live importer or OCR rerun.
- Bridge interactive stream selection/save/reload remains **unverified**: automatic
  approval review blocked the isolated Electron launch, with no specific reason.
  No fallback to the owner's normal settings was attempted. Existing automated
  settings/IPC/orchestration tests are not a substitute for this visual check.
- All seven product-version fields are locally 1.6.0; non-version manifest/lockfile
  data, native versions, migrations and schema are unchanged by preparation.
- Release-only checks passed for both repositories: 17 task files strict UTF-8,
  58 local Markdown targets, `git diff --check`, and empty indexes. All seven
  Finance Tracker and three Bridge version fields match their candidates; JSON
  comparison confirms every non-version dependency/manifest value is preserved.

## Controlled deployment, separate from activation

1. Owner reviews/commits preparation. Before integration, read back and control
   existing GitHub-triggered Vercel/Railway deployment triggers; do not push main
   before backend/schema readiness. No new preview environment or Vercel login.
2. Under separate production authorization, verify the database identity, actual
   applied baseline and recoverable backup. Capture financial/domain/provenance
   snapshots; coordinate a short financial-write pause for migration locks.
3. Apply **only pending** `045_cal_reconciliation.sql`,
   `046_reconciliation_review.sql`, `047_cal_billing_contract.sql`, in that order.
   They use explicit transactions; 045/047 take exclusive transaction-table locks.
   Verify private RPC grants/RLS, receipt/provenance structures and unchanged
   canonical totals/domain snapshots. Refresh PostgREST schema cache. Do not edit
   applied migrations, backfill by amount/date/name or replay historical imports.
4. Deploy backend first using the existing repository-root `Dockerfile.backend` and
   `railway.json`: locked server install, root `shared/`, `npm --prefix server start`.
   Preserve existing owner and ingestion configuration; do not enable flags or add
   CAL registration during this disabled deployment. Verify SHA, version and health.
5. Deploy matching frontend through the existing Git connection and
   `client/vercel.json`. Verify API/Auth targeting and authenticated read-only
   Transactions/reconciliation access. Restore paused writes only after checks pass.
6. Ship Bridge v3.1.0 only after the consumer is ready; retain legacy defaults and
   existing ledgers. Complete the isolated visual settings check before activation.
   Separately verify exact `CAL_INGESTION_SOURCES` registration, source revisions and
   `finance.v2Streams` selections. Registration names must be unambiguous across
   active accounts. No last4 inference or fallback after v2 rejection.
7. CAL/phone activation and controlled real verification remain separate under #91.
   Preserve held captures and check existing purchases before any retry. Unsupported
   legitimate events are coverage limits, not successfully preserved imports.

Recovery retains applied schema, APY provenance and Bridge frozen/sent ledger history.
Keep activation off and forward-fix. Do not return registered sources to unrestricted
legacy writes or older hard-delete behavior. No production migration, deployment,
registration or activation was performed by this preparation.

## Release / Version gate

- Release impact: Yes — expanded Shopping capabilities and existing additive candidate scope.
- SemVer impact: Minor — highest included impact relative to published v1.5.0.
- Candidate release: v1.6.0 — finalized scope, prepared and unpublished.
- Grouping / included release candidate: this record coordinates #82, #83, #84 compatibility, #93 and #95; actual native tree carryover is disclosed above.
- CHANGELOG status: finalized candidate entries under prepared 1.6.0; unrelated native Unreleased notes preserved.
- Version-bump status: Synchronized — all seven fields already 1.6.0, no additional bump; #95 dependency additions are intentional.
- Publication status: Out of scope — no tag or formal Release is authorized by this rollout.
- Owner verification / acceptance status: Accepted for shipping #95's current scope by the explicit 2026-10-16 instruction; unperformed manual checks remain unperformed. Existing #83 evidence and separate Bridge/phone limitations are unchanged. #95 remains Verify until commit/push/deployment and safe production verification complete.
