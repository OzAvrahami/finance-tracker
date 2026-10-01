# Finance Tracker v1.6.0 candidate

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

- Release impact: Yes; SemVer: Minor, additive opt-in reconciliation/review.
- Candidate: v1.6.0, prepared/unpublished; grouped #82/#83 plus compatibility work under #84.
- CHANGELOG: candidate entries moved to prepared 1.6.0; unrelated #90 entries retained.
- Version bump: seven fields synchronized locally; dependencies/native versions unchanged.
- Publication: pending final integration/deployment verification and separate authorization.
- Owner acceptance: refined #83 UI/synthetic link accepted; remaining integrated,
  Bridge visual and production-phone criteria pending. Issues remain open.
