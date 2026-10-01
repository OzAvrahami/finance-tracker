# APY integrated readiness (#84)

## Coordinated local correction — 2026-10-01

**The demonstrated FX wire-contract gap is corrected locally. Commit readiness and
disabled deployment readiness are separate from account activation.** The focused
finding below narrows the remaining activation gate; a missing installment sample is
not itself proof of a regression in the intended account.
No versions were bumped: Finance Tracker 1.5.0 / Bridge 3.0.3. Proposed Finance Tracker
v1.6.0 remains deferred. The earlier audit below is retained as historical evidence.

### Exact stream selection correction (current)

The global Bridge version selector is replaced by `finance.v2Streams`, default `[]`.
Each entry is `{provider:"cal", providerAccountId:"<exact source-account ID>",
paymentSourceName:"<exact outgoing accountId/payment_source_name>"}`. All three must
match; only the provider enum is case-normalized. No card-name trimming, case folding,
last4 matching or merging. Add/remove rows in desktop **CAL reconciliation streams
(v2)** settings and save through existing settings IPC. Nonselected streams keep legacy
bodies. Malformed/duplicate selections fail without saving; obsolete global
`contractVersion:2` fails visibly instead of selecting every stream.

Selection reaches desktop IPC, sync orchestration, the ledger-aware engine and file
export. New requests resolve their version per stream; a frozen body always wins.
Deselecting cannot downgrade a failed/uncertain v2 request. Known rejected legacy FX
upgrades retain the existing narrowly defined archive/transition rule. Missing
registration and unsupported-event 422 responses remain failed, not sent; no automatic
legacy fallback. The already-sent 5746 fee is untouched.

Consumer registration still uses exact `payment_source_name`. Verify it matches the
selected full name and is unambiguous across active source accounts. A mixed batch
containing an unselected account with that same exact name fails before any ledger
write or HTTP call, because the consumer cannot distinguish those streams. This is an
explicit configuration error, not a last4 alias or silent routing change.

Verification: **69/69** focused Bridge selection/settings/desktop/file-export tests,
**9/9** existing sync regressions, and **17/17** Finance Tracker exporter/consumer tests.
The targeted disposable persistence rerun could not start because the local Docker
Linux engine was unavailable; no database test ran in that attempt. Prior 30-scenario
persistence evidence is retained for unchanged SQL. Desktop visual/owner settings
acceptance remains pending; no live sync or actual settings file was changed.

Commit readiness: ready for owner review. Disabled deployment readiness: ready for
separately authorized consumer-first migration/deployment. Activation: stream-scoping
implementation is complete, but exact production registration/selection must still be
verified after deployment. Unsupported installment handling remains a conditional
coverage limit; no real installment failure on 2755 is claimed. The historical global
selector blocker below is superseded by this correction.

### Implemented contract and transition

Bridge's exact stream selection defaults to **Legacy v1 for every stream**. Selecting a stream
adds this bounded `cal_contract` object to the existing `/api/v1/transactions` body
(example amounts are synthetic):

```json
{
  "version": 2,
  "billed": { "amount": "370.00", "currency": "ILS", "scale": 2 },
  "original": { "amount": "100.00", "currency": "USD", "scale": 2 },
  "event": { "kind": "purchase", "basis": "full_purchase", "provider_type": "רגילה" }
}
```

- Decimal strings come from printed provider fields, not multiplication/division of
  JavaScript numbers. Original currency/precision remain separate; missing originals
  stay null. Billed ILS is authoritative accounting money. No inferred exchange rate,
  timestamp or reference. `date` remains purchase date; `charge_date` remains billing
  date. Existing outer numeric fields remain the legacy compatibility envelope only.
- Classification uses CAL's actual type label, never amount equality/name/hash:
  ordinary (`רגיל`/`רגילה`), immediate (`מיידית`) and recurring (`הוראת קבע`) purchases
  map to full purchases. Unknown types remain unknown. Explicit refund labels remain
  refunds. Installment labels remain parts; a printed `תשלום N מתוך M` preserves N/M,
  while purchase-group identity remains null because it is not available in the
  inspected source. No invented installment schedule or full-purchase amount.
- Finance Tracker validates v2 before the existing atomic APY RPC. Known billed-ILS
  FX and ordinary/online purchases use the same matcher and single accounting path.
  Original FX evidence stays in immutable provenance; canonical accounting stays ILS.
  Migration **047_cal_billing_contract.sql** extends the immutable CAL receipt with
  contract version, exact billing evidence and legacy request hash. RLS/private grants,
  source instance (`v1-cal:<instance>`), external IDs, both source observations and
  owner fields are preserved. No backfill, rate lookup or historical financial rewrite.
- Unregistered v2 requests fail `cal_registration_required`; they cannot fall through
  to legacy cash writes. Unversioned registered requests retain the original strict
  simple-ILS rules. Missing billing currency, unsupported event, refund and installment
  requests return explicit 422 errors without falsely claiming saved evidence or cash.
- The Bridge freezes the whole body and its content hash in its existing local ledger
  **before HTTP**, then saves each response immediately. Lost responses and subsequent
  source changes retry that exact body/key. Existing successful ledger entries never
  resend. An uncertain old attempt keeps the legacy shape; a known old 4xx rejection
  with no frozen payload may adopt v2. Frozen legacy FX/amount-basis requests may
  adopt v2 only after an explicit known non-accepting 422 and an unchanged legacy
  envelope; the rejected body is archived and the replacement saved before HTTP.
  Other frozen requests stay unchanged.
- Server-side exact legacy/v2 replay compatibility returns the existing observation;
  it does not upgrade its payload or rewrite history. Conflicting bodies remain 422.
  The Bridge stops automatic payload-conflict retries and records a review-needed
  reason rather than repeatedly sending or generating a new key. Pre-upgrade failed
  ledger entries lack their old payload: reconstruction cannot recover changed old
  values; a conflict requires review of saved source/remote evidence. Never clear the
  ledger or edit a frozen body to force success.
- A 202 is durable acceptance **without cash**, saved as `financialPosted=false` with
  observation/disposition in the ledger and JSON/CSV report. The desktop summary says
  accepted and separately counts pending review. Open the existing Finance Tracker
  reconciliation queue; do not resend accepted pending evidence. A previous report is
  not a live query of a later review decision.

### Actual saved-data coverage and remaining requirement

Read-only actual exporter + injected transport + actual consumer validation on the
same four saved exports: **330 / 331 eligible appearances now accepted**, including
**all 148 FX appearances**. Snapshots overlap; these are not unique-purchase counts.
One positive ILS row labelled **`שרותים`** remains `cal_event_semantics_required`.
That generic label alone was not silently treated as proof of a full purchase.

There are no saved real installment/refund examples. The inspected modal/export
extractors expose no verified purchase-level identifier to associate a part with a
full Wallet capture; N/M parsing is synthetic-tested only. Installment posting is
therefore **not implemented/accepted**: the explicit part representation fails with
`cal_installment_identity_required`, preventing full purchase plus parts from becoming
extra spending or replaying Loan/Savings/Budget effects. Refunds remain outside initial
automatic APY posting; existing negative/zero upstream skips are not new refund support.

Safe part handling still needs the actual billed-row accounting basis (part versus
full purchase) and how that row can be associated with a full Wallet purchase without
double spending. If no group identity exists, an explicit association/accounting policy
is required; amount/date/name cannot replace identity. No additional export, purchase,
live importer execution or phone retry is requested here.
Rejected legitimate imports are still a coverage gap, not successful reconciliation.
Frozen rejected unknown/part payloads stay recoverable in the Bridge ledger; a later
explicit recovery must distinguish proven rejection from an uncertain accepted request.

### Earlier focused activation finding (global selection now superseded)

The sole saved `שרותים` record in Bridge `runtime/exports/cal_2026-06-19.json` is:

| Field | Saved value |
| --- | --- |
| Transaction date / charge date | 2026-06-03 / 2026-06-03 |
| Provider merchant text | עמלת פירעון |
| Billed / original | ILS 60.00 / ILS 60.00 |
| Card context | Ending 5746, **not 2755** |
| Exact field | `raw.transactionType`, copied to normalized `transactionType` |

The modal adapter `packages/bridge-core/src/providers/cal/extractor.js` assigns that
field from CAL's **סוג העסקה**. **ענף בית העסק** maps separately to `expenseType`,
which is empty for this record. Thus `שרותים` is a provider transaction-type label,
not a parser substitution of the merchant category. Neither the saved record nor the
adapter supplies an authoritative definition making it an ordinary full purchase.
The merchant text denotes a fee; it does not authorize a global classification rule.
No mapping was changed.

The exact occurrence has a local ledger entry `sent`, HTTP 201, one attempt, dated
2026-06-22. This is historical local delivery evidence, not a fresh production readback.
The old producer omitted type and sent an ILS 60 expense; the old consumer stored
`amount` as `total_amount`. A focused injected-transport check accepts its legacy
registered payload but rejects v2 with `cal_event_semantics_required`. Already-sent
history is skipped, not resent or lost. A **fresh equivalent delivery** would lose
coverage under v2. This is not an observed 2755 rejection.

Installments: the old exporter sent every completed positive billed row, irrespective
of type, as an expense with billed amount and original amount as metadata. It sent no
installment number/count/group ID and created no installment schedule. Legacy consumer
storage likewise omitted installment fields. Existing synthetic cases demonstrate
that legacy-compatible positive parts can be sent, while registered v1 rejects
different original/billed amounts and v2 rejects explicit parts. That conditional
behavior change is real; **no actual installment rejection on 2755 was observed**.
Real installment validation remains a limitation, not proof the account has regressed.

There is also a concrete activation-scope prerequisite: the desktop `finance.contractVersion`
selector is global, while Finance Tracker registration is by exact payment-source name.
An all-account run forwards that version to every considered row. Unregistered v2 rows
fail `cal_registration_required`; registering 2755 alone does not make that global run
safe. Before activation, scope v2 emission explicitly to registered streams (preserving
frozen bodies), or verify the actual run contains only registered streams. Never infer
registration from last4 or bypass the registered reconciliation path. This turn also
fixed a discovered desktop handoff that dropped `contractVersion`; its 23 focused
orchestration tests passed. No actual sync was run.

| Readiness | Result |
| --- | --- |
| Commit tested local correction | Ready for owner review/commit; limitations explicit, default remains legacy |
| Deploy capability with activation disabled | Ready for separately authorized controlled migration/deployment; do not register CAL or select v2 as a side effect |
| Activate intended CAL stream | Not cleared: resolve exact stream/version scope and the applicable unsupported-event policy; the 5746 fee is not evidence of a failed 2755 purchase |

Next implementation step is explicit producer stream scoping before activation, not
a new installment-management system or another purchase/export. Fee and installment
support must remain explicit: safe rejection is not preserved import coverage.

### Verification of this correction

The owner reports no additional local installment export/detail is known. Real
installment validation remains pending; it is not replaced by synthetic evidence.

- Bridge focused contract/sync/rate-limit/409/ledger/report/settings tests: **63/63**.
- Finance Tracker consumer and actual-exporter contract tests: **17/17** with
  `CAL_BRIDGE_AUDIT_ROOT=D:/code/financial-data-bridge` and injected transport.
- Disposable PostgreSQL suite: **30 distinct passing scenarios** across the main run
  and focused reruns, not a single 30/30 run. The initial run passed 28/29; its schema
  equivalence assertion compared CRLF against LF. Normalizing line endings only in
  that assertion passed the schema case. The added concurrent old/new case passed;
  the final four billing/replay/migration/exporter cases also passed after the last
  compatibility guard. No financial assertion was removed.
- Persistence covers both arrival orders, equal-value independent occurrences,
  owner edits/cancellation, lost responses, old/new concurrent retries, immutable
  billing evidence, migration upgrade/rerun/rollback/private grants and rejection of
  unsupported semantics without cash or domain effects.
- Read-only owner-fixture check still shows three expenses totaling ILS 22, the ILS 10
  report linked and both ILS 6 reports pending. No owner fixture or Shopping draft was
  mutated; migration 047 ran only in disposable databases.
- Both indexes remain empty. Task files pass UTF-8, JavaScript syntax, local Markdown
  target and whitespace checks. Existing migration bytes, the schema-reference prefix,
  dependency manifests/locks and version fields are unchanged. No native, desktop UI,
  production-posting or real installment acceptance is claimed by these checks.

Commands for the focused producer/consumer checks (run from the respective repository):

```powershell
# Bridge
node --test tests/unit/application/financeContract.test.js tests/unit/application/syncTransactionsToFinance.test.js tests/unit/application/financeRateLimit.test.js tests/unit/application/finance409Duplicate.test.js tests/unit/infrastructure/financeLedger.test.js tests/unit/infrastructure/financeReport.test.js tests/unit/config/appSettings.test.js
# Finance Tracker; tests inject transport and create disposable PostgreSQL containers
$env:CAL_BRIDGE_AUDIT_ROOT='D:/code/financial-data-bridge'
node --test server/test/calProducerContract.local.test.js server/test/calIngestion.test.js
node --test server/test/calReconciliationPostgres.local.test.js
Remove-Item Env:CAL_BRIDGE_AUDIT_ROOT
```

### Coordinated rollout (not performed)

1. Complete the remaining semantic gate and owner review before whole-account activation.
   Keep both repositories' changes uncommitted for the owner; no automatic version bump.
2. Follow the established deployment controls below: backup/verify the database, apply
   only pending **045 → 046 → 047**, verify immutable receipts/grants and original
   financial snapshots, and reload PostgREST. Never edit already-applied migrations.
3. Deploy the consumer first, keeping both native/legacy Apple flags false. Verify v1
   compatibility and registered v2 dry-run against the authorized target. Registration
   is a separate approved account-stream transition, not inferred from a deployment.
4. Ship Bridge with default Legacy v1 intact. After verified consumer/account readiness,
   select only the exact registered streams under **CAL reconciliation streams (v2)**
   and save existing settings. Coordinate no finance
   sync in flight across that transition; no general CAL disable/exclusion workaround.
   Preserve credentials, ledger, occurrence keys and already accepted deliveries.
5. Inspect accepted/pending/rejected report outcomes. Resolve pending evidence through
   the owner review UI. Do not reset/replay sent history; payload conflicts require
   evidence review. Production native activation and one controlled phone action remain
   separate under #91, after duplicate/readiness checks.
6. If failures occur, retain schema/provenance/ledger and forward-fix. Returning a
   registered stream to unrestricted legacy writes is not a rollback strategy.

### Version impact

Finance Tracker: **Yes / Minor**, coordinated proposed v1.6.0 (#82/#83/#84), still
blocked on the above coverage gate. Bridge: **Yes / Minor**, opt-in protocol + durable
request/review reporting; its own release number is **TBD**. Both changelogs are under
Unreleased, version bumps deferred, publication out of scope. The accepted #83 UI/link
scenario stays accepted; this correction and broader production/phone scenarios remain
pending owner acceptance. No production action occurred.

## Earlier #84 audit (before the coordinated correction)

Checkpoint: 2026-10-01. **Whole-account CAL activation is blocked.** The proposed
coordinated #82/#83 Minor is **v1.6.0**; it is not finalized, versioned or published.
All seven product fields remain 1.5.0. No runtime change or new migration was made
in this readiness pass: missing producer information cannot safely be reconstructed.

## Verified scope and acceptance

- Published stable v1.5.0 and remote main: `8063330e55763c586af95c4446218ffae684f5ce`.
- #82: `e4dbf0118987d1ecee105a74f724e9e1074eb2f4`.
- #83 / remote feature head: `3861684c9815120a64bf82353b105f03edc7bb8a`.
- `feat/reconciliation-review-83` is two commits ahead, zero behind main. Its 35-file
  difference is #82/#83: adapter/private RPCs, migrations 045/046, review API/UI,
  amount-presentation fix, tests and documentation. Existing #46/#90 work is already
  on main, not a new candidate member or newly accepted capability.
- Owner accepted the refined interface as clearer/better and successfully linked the
  synthetic ILS 10 report without increasing the ILS 22 total. Both ILS 6 expenses
  remain distinct. This is acceptance of that interface/link scenario, not all mobile,
  concurrency, production-phone or real later-CAL scenarios.
- Real phone local capture is established separately under #90. Backend production
  posting and later real CAL reconciliation remain pending under #91. No purchase or
  held-capture retry is requested by this preparation.

## Actual producer coverage, not spreadsheet assumptions

Read-only Bridge checkout: `D:/code/financial-data-bridge`, version 3.0.3, commit
`d8f8580d36e68727d9eecbbf767c41a9b81d8597`. Relevant paths inside that checkout:

- `packages/bridge-core/src/application/exportToFinanceSystem.js`: actual payload
  builder, positive-original fallback, response/retry classification.
- `application/syncTransactionsToFinance.js` under the same `src`: desktop filter and
  ledger suppression. Completed positive charges qualify; previously sent keys are
  suppressed, even if later content changed (reported separately by the producer).
- `providers/cal/normalizer.js`, `providers/cal/exportParser.js`, `schema/transaction.js`:
  internal original/billed amount/currency and transaction-type evidence.
- `infrastructure/dedup.js`: opaque hash plus occurrence suffix. Billing date/amount/
  currency are mutable content, not part of the base retry identity. The transaction
  type contributes to the hash but cannot be recovered from it.

Wire fields: `type=expense`, `amount=chargeAmount`, `currency=original currency`,
`original_amount`, transaction/charge dates, merchant, account label and external key.
**Neither chargeCurrency nor transactionType/part identity is transmitted.** Existing
Finance Tracker legacy handling of this shape is not proof of a correct APY ILS basis.
An account label or four card digits does not establish billing currency.

| Record type | Bridge behavior / registered-account outcome |
| --- | --- |
| Ordinary positive completed ILS, original equals charge | Shared APY path accepts; CAL-only creates cash or holds/attaches according to evidence. |
| Online/non-contactless purchase | No online/contactless discriminator or exclusion in exporter. Same supported ILS conditions work; online FX has the FX gap below. |
| Positive completed foreign purchase | Sent, including real USD rows. Current adapter rejects with 422 `cal_supported_ils_purchase_required`; no provenance/cash saved. This is lost registered-stream coverage, not preserved compatibility. |
| Positive differing ILS original/charge | Sent. Adapter rejects `cal_unsupported_amount_basis`. Could be a part, fee, discount or another basis; differences alone do not establish which. |
| Installment with equal exported original/charge | Can look like an ordinary purchase and pass the adapter. Type and part identity are missing; this is not verified installment support. Existing Loan/installment guards cannot classify an otherwise unmarked payload. |
| Negative/zero refund or pending row | Skipped before send by both helper and desktop engine. Pre-existing producer limitation, not new #82 coverage; no automatic refund support is claimed. |
| Positive magnitude with refund classification | Hypothetical boundary test: exporter still emits expense and drops classification. No such saved sample was found; never claim safe refund interpretation. |

### Representative saved evidence

Read only `runtime/exports/cal_2026-*.json`; no sessions, credentials or live importer
were accessed. Invoked the actual exporter with an injected in-memory fetch, not an
HTTP destination. Output retained only aggregate classifications, not merchant/account
details. Older snapshots lacking assigned keys used a synthetic audit key solely to
check accounting validation; actual producer keys are assigned before real sending.

| Saved snapshot | Rows | Positive completed before ledger suppression | ILS accepted by accounting validation | USD rejected by registered adapter |
| --- | ---: | ---: | ---: | ---: |
| 2026-06-19 | 84 | 84 | 71 | 13 |
| 2026-06-22 | 13 | 12 | 11 | 1 |
| 2026-07-24 | 32 | 31 | 7 | 24 |
| 2026-07-25 | 204 | 204 | 94 | 110 |

These snapshots overlap: **331 eligible row appearances, not unique purchases**.
All 148 foreign appearances have internal ILS billing evidence, but that field is lost
on the wire. Two distinct saved account-label forms containing the owner-provided 2755
suffix include 147 foreign appearances in total; do not auto-collapse those labels or
infer the production registration name from last4. No negative/refund or installment
examples were present in these snapshots. Synthetic contract tests cover those limits
without claiming real importer evidence for them.

## Concrete blocker and smallest required follow-up

Registration redirects the exact account's entire stream, not just Wallet purchases.
Unregistered compatibility and safe 422 rejection do not preserve registered coverage.
Real FX examples rule out assuming this is an ILS-only account. Keeping the wider CAL
automation running unchanged while rejecting those purchases is not acceptable rollout.

The producer owner must supply a versioned, explicit billing/economic-event contract:

1. Verified billed currency and exact billed decimal amount; separate original decimal
   amount/currency and its scale. For known ILS charges, the existing APY accounting
   basis can be used without inferring FX or an exchange rate. Internal historical ILS
   values alone do not guarantee every future payload's basis.
2. Explicit full-purchase versus installment/fee/credit classification. For installments,
   identify the billed occurrence/part and purchase-level relationship where actually
   available. Define purchase-total versus billed-part accounting with the owner before
   matching a full Wallet capture to a part; never generate a schedule from a guess.
3. Retain existing external identities and freeze retry payloads. Coordinate old-key
   replay/version transition: adding fields to previously accepted requests currently
   changes their immutable request fingerprint. Do not reset the Bridge ledger, regenerate
   keys or resend already accepted history to force a transition.
4. Preserve source evidence for unsupported events, with a reviewed handling contract;
   current negative-refund suppression is not silently solved by this change. Automatic
   refund/reversal posting is outside the accepted initial APY contract.

A documented, owner-approved per-account billing guarantee could pin ILS basis, but
would not recover missing installment/event semantics by itself. No such guarantee
or restricted-stream policy was assumed here. The read-only Bridge boundary prevents
implementing the necessary producer changes in this task. No legacy direct-write
bypass, aliases, invented timestamps/rates, broad automation disable or silent discard
was added. Version preparation remains deferred until supported account coverage and
the paired producer/server transition are verified.

## Integrated evidence matrix

| #84 scenarios | Evidence / outstanding boundary |
| --- | --- |
| 1–5, 43–44 | Actual phone local capture verified; production canonical cash/Budget/phone scenarios pending #91. |
| 6–9 | Both arrival orders in isolated persistence tests; accepted synthetic ILS 10 owner link leaves total 22. Real later CAL confirmation still pending. |
| 10–12, 33 | Ordinary/online ILS path verified; registered FX and ambiguous installment basis are activation blockers above. |
| 13–17, 41 | Reuse #82/#83 exact replay, independent keys, simultaneous arrivals/decisions, stale fingerprint and two legitimate equal-purchase evidence. No new real-device concurrency claim. |
| 18–23 | Source timestamp semantics preserved when supplied; Bridge supplies dates only. No invented purchase time. Date-only differing-name ambiguity goes to explicit review. |
| 24–31 | Existing persistence evidence preserves dates, owner fields, protected/void history and single cash effect. Synthetic owner check verifies total 22; not all production reports. |
| 32, 34–36 | Reuse recorded #82 regressions and #83 Transactions/navigation tests. Two documented failures reproduced on v1.5.0 remain separate, not counted as passes. |
| 37–40 | Reuse native credential/security and authenticated owner-review evidence. No secret or device configuration changes. |
| 42 | 045/046 upgrade/rerun/rollback/private grants tested in disposable PostgreSQL; local review setup completed. Production preflight/backup/deployment remain separate. |

Additional focused checks in this pass:

```powershell
$env:CAL_BRIDGE_AUDIT_ROOT = 'D:/code/financial-data-bridge'
node --test server/test/calProducerContract.local.test.js
Remove-Item Env:CAL_BRIDGE_AUDIT_ROOT
node --test --test-name-pattern='registered stream coverage gate' server/test/calReconciliationPostgres.local.test.js
```

Results: producer-contract **6/6**; disposable persistence **1/1**. The latter confirms
online ILS creates cash once while rejected FX/partial retries save neither cash nor a
CAL receipt. Passing the test proves the gap; it does not mark that coverage complete.
No broad suite/build/OCR rerun was necessary for tests/documentation-only changes.
Current isolated owner fixtures and Shopping corrections were not mutated.

## Conditional deployment sequence — not authorization to activate

This sequence becomes executable only after the blocker is resolved and separate
production authorization is given. Deployment and financial activation are separate gates.

1. Finalize #82/#83 plus the reviewed compatibility correction; verify the release line
   still makes 1.6.0 appropriate. Move only those Unreleased entries, synchronize seven
   fields without dependency changes, and have the owner commit. Existing #90 entries
   are carryover, not acceptance of #91 or additional release scope.
2. Use existing GitHub-triggered Vercel and connected Railway workflows. Read back and
   control current automatic deployment triggers before integration; keep the live app
   running during preparation. No Vercel CLI login/new integration/preview environment.
   Owner performs operations that create commits; do not force-push.
3. Confirm database/project identity, recoverable backup, schema through 044 or actual
   later applied baseline, and financial/domain/provenance counts/totals. Coordinate a
   brief financial-write maintenance window for migration locks. Inventory current CAL
   profiles/sources; do not assume repository presence means production application.
4. Apply only pending **045 then 046**, unchanged and transactionally. No 047 exists or
   is required by this audit. Any later compatibility schema correction must use a new
   forward migration and its own tests. Verify private grants/RLS/guards, original cash
   and domain snapshots, then reload PostgREST schema cache. Do not backfill CAL history
   by merchant/amount/date or drop applied APY schema on failure.
5. Keep `FLOWLINK_INGESTION_ENABLED=false` and `APPLE_PAY_INGESTION_ENABLED=false`.
   Deploy backend first from the verified final SHA using the existing root-context
   `Dockerfile.backend` / `railway.json` (`npm ci --prefix server --omit=dev --no-audit --no-fund`,
   `npm --prefix server start`). Preserve root `shared/`. Verify health and authenticated
   read-only `/api/reconciliation/summary`; owner authority uses existing strict
   `FLOWLINK_OWNER_USER_IDS`, not a phone/source credential.
6. Integrate/main push only after backend/schema readiness and controlled triggers;
   deploy matching frontend through the existing Vercel Git connection and client config.
   Verify exact SHA, eventual version 1.6.0, API/Auth targets and owner read-only review.
   Use GitHub deployment statuses/public checks; do not claim uninspected dashboard settings.
7. Restore normal app writes/triggers after checks. **Do not register the CAL account as
   a deployment side effect.** Explicit exact-account registration affects all its future
   imports and installs a database bypass guard. Verify producer coverage, existing
   transactions/ledger and replay transition before any registration/ingestion activation.
8. Under #91's separate controlled activation, fresh duplicate checks and one owner phone
   action must establish posting and later CAL reconciliation. Do not retry all captures
   or request another purchase during preparation. Before those results, no unrestricted
   ongoing native ingestion claim. Retain provenance and forward-fix failures; removing
   CAL configuration must not restore an unsafe legacy bypass.

## Release / Version gate

- Release impact: **Yes for coordinated #82/#83**; this audit adds tests/docs only,
  with no independent runtime impact.
- SemVer: **Minor proposed** for backward-compatible reconciliation/review; no unsafe
  producer-contract change is hidden in that assessment.
- Candidate: **v1.6.0 proposed, blocked**, not prepared/published; v1.4.0 is obsolete.
- Grouping: **#82 + #83**, coordinated by #84/#78; necessary compatibility work must
  be finalized before candidate membership is frozen.
- CHANGELOG: #82/#83 remain **under Unreleased**, activation limitation clarified.
- Version bump: **Deferred** to owner-coordinated preparation after coverage resolution
  under #84; all seven remain 1.5.0, dependencies/native version unchanged.
- Publication: **Out of scope**; no tag/release created.
- Owner acceptance: refined UI and synthetic ILS 10 link **accepted for that scope**;
  broader integrated/production/device acceptance **pending**.
- Deployment: **Not performed or authorized in this readiness task**.
