# Unified transaction ingestion

Local implementation, 2026-11-04. Requires forward migration **054** and a coordinated backend upgrade. Neither migration nor deployment is authorized by this document. FlowLink remains paused. Financial Data Bridge is retired; its repository is not a dependency.

## Request to database

```text
API key -> POST /api/v1/transactions -> single validation / sequential Bulk
                                           |
                                  unifiedTransactionIngestion
                                           |
                                  ingest_external_transaction
                                           |
JWT manual / CSV -> ingest_owned_transaction -> unified_ingest
FlowLink existing authenticated/bound RPC ----> ingest_observation --^
                                           |
                  durable source key + immutable request fingerprint
                                           |
                  existing payment_sources + reconciliation evidence
                      /                    |                    \
                exact replay       hold/conflict for review    eligible posting
                no new cash             no new cash             apy_create_cash
                                                                 |
                                                       transactions + observation
                                                       + audit event, one commit
```

The private core serializes decisions under the existing transaction-table lock. It retains source observations, cancellation state, owner edits, immutable evidence and review revisions. Browser roles cannot execute posting commands or mutate provenance; service credentials cannot execute the private core. API and owned commands have bounded transport waits. Unknown commit results never mean “failed to save”: retry a frozen external key/payload, or inspect the retained manual draft/history.

Existing `payment_sources` identify cards and accounts. Issuer names do not select a writer. Three internal channel records replace card registrations: external v1, manual entry and CSV. These are not account aliases or per-card registrations. Existing device bindings remain necessary for FlowLink authentication and compatibility.

Forward migration 055 adds the distinct `bank_account` payment-source method without reclassifying existing cash or bank-transfer sources. External and CSV observations using it remain held with `bank_event_semantics_required`, just like bank transfers and checks; this method does not enable automatic bank-event posting. Settings stores only the existing display metadata and last-four field, not a full account identifier. See [implementation, verification and release prerequisites](../history/BANK_ACCOUNT_PAYMENT_SOURCES.md).

## Identity and reconciliation

- The existing global `external_id` namespace remains. Producers must use stable, namespaced IDs; a different producer's equal ID is not proof of the same purchase. No public producer field was added.
- Exact source-key/fingerprint replay returns the existing observation, including pending/cancelled state. Changed content conflicts without replacing accepted data. Historical CAL receipts, general receipts and transaction IDs reserve their original keys.
- Merchant/date/amount tuples only produce review candidates. They never automatically merge cash. Automatic linking requires independently verified provider references or verified, compatible precision-time evidence, with all existing protection checks. Legacy v1 cannot supply those extra proofs; it is therefore conservative across sources.
- Distinct external keys on the same intake channel remain distinct purchases. CSV document hash plus row ordinal distinguishes two identical rows in one file and makes a frozen re-upload repeat-safe. Overlapping files require review. Legacy CSV clients without these preview IDs receive a weaker random delivery identity; candidate review still prevents blind cross-source posting.
- Manual commands enter the shared decision before their normal domain processing. Explicit owner “separate” approval of a held manual observation posts no cash; saving the **unchanged draft** resumes its original observation and normal manual processing. Candidate fingerprints are rechecked before resumption. Manual items, LEGO and installment siblings remain with their existing controller; explicit Loan accounting uses its existing atomic RPC. Savings uses its existing explicit domain writer and protections; it is not converted to generic imported cash. Later imported observations see protected domain transactions as review evidence.
- Managed cancellation retains the financial row as voided, reverses manual Loan accounting through existing rules, and reserves identity. Existing Savings, captured Budget, domain and ownership protections remain.

## Preserved public contract and limits

The endpoint, API-key authentication, legacy single request and `{ "items": [...] }` Bulk shape remain. Bulk retains 1–50 items, per-item payment source, partial success, actionable indexed failures, existing optional fields, and its concise summary. `status: completed` remains a Bulk transport convenience; pending delivery does not post. No request field was added.

`amount` remains the actual ILS accounting charge. `currency` and `original_amount` preserve the original-currency evidence under the established ledger convention; no exchange rate or fee is invented. Purchase `date` and `charge_date` stay separate. Unsupported precision is rejected, not rounded.

The existing fields **do not cover every required economic distinction**:

| Missing evidence | Safe behavior |
| --- | --- |
| Shared independent cross-source identity / verified time | Retain plausible matches for owner review; never infer equality from the tuple |
| Purchase-series reference and whole-versus-installment basis | Hold imported installment evidence; explicit separate approval can post only that observed ordinal, never future siblings |
| Refund relationship and transfer / loan repayment semantics | Imported income and bank-transfer/check sources remain held; use explicit domain workflows for authoritative classification |
| Original amount for a foreign purchase | Hold until evidence is corrected; generic separate review cannot invent it |
| Missing, inactive or ambiguous payment source | Retain unresolved observation; no guessed mapping |

Until a series identity is available, a payment source with installment evidence conservatively holds subsequent imports for series review. This intentionally broad rule can create substantial review volume. It avoids guessing that a whole purchase and individual installments are different cash. The ordinary v1 payload cannot express a pending-to-posted amendment, refund relation or transfer legs. Changed payloads under one key remain conflicts; do not mint another ID to escape a conflict. Contract expansion requires separate owner approval.

## Retirement and migration

- Production CAL-specific and general-envelope JavaScript intake services are removed. Historical protocol copies live only under `server/test/fixtures` for migration compatibility tests.
- `generalTransactionContract` remains solely for historical receipt review/resolution. Old SQL definitions and migrations remain historical; service-role execution of the obsolete CAL/general intake RPCs is revoked.
- Migration 054 atomically replaces `cal_external_identity` / `general_external_identity` with the generic `unified_external_identity` guard (`PING1`). Direct external-ID insertion cannot bypass the observation command. Historical reservations and the global unique index remain enforced.
- Migration 054 extends allowed source kinds, permits unresolved unposted observations, replaces the shared matching/posting functions, generalizes the existing owner review surface and preserves domain-aware cancellation. It does not delete, rewrite or backfill historical financial/receipt rows. `full_schema.sql` includes the same forward migration for clean installs.
- The 38 historical CAL receipt identities and all transaction, observation, reconciliation and cancellation history must remain unchanged at cutover. Synthetic upgrade tests compare full row snapshots, and an injected migration failure proves transactional rollback. This is not production verification or a recovery guarantee.

Removing the previously accepted `contract` / `cal_contract` envelopes is an intentional compatibility break for those retired protocols; they return `retired_ingestion_contract`. Registered producers must not be restarted against that old format. Legacy v1 and legacy-shaped Bulk remain supported. The release policy classifies this combined operational/API retirement as **Major**; version selection is deferred to the owner.

## Verification and operational boundary

Synthetic PostgreSQL tests cover CAL 2755, another CAL card, MAX, bank holds, ILS/FX, installment review, exact replay/conflict, two legitimate equal-looking purchases, both Wallet/API and manual/CSV arrival orders, strong evidence, owner edits/cancellation, concurrent delivery, lost response after commit, 8-success/2-failure and 50-item Bulk, manual domain resumption and Loan reversal. The 38-receipt upgrade fixture uses synthetic data only. Backend unit, frontend, FlowLink backend and Savings/Shopping disposable regression results are recorded in the implementation handoff. Native FlowLink and live producer acceptance are not exercised.

Before production: owner acceptance of conservative review behavior and retired envelopes; inspect the current deployed schema/ACLs and source identities; arrange a bounded writer pause and coordinated migration/backend cutover; rehearse against an authorized isolated copy; verify row/receipt counts, grants and guard definitions before and after; then perform separately authorized synthetic smoke checks. An old backend must not keep writing after its RPC privileges are revoked. An old backend rollback alone is not a database rollback.

**Backup/recovery availability is unverified.** Earlier acceptance of preparation risk is not approval to apply this migration. A production recovery decision, migration authorization, deployment authorization and any producer activation require separate owner action. No producer activation is part of this change. Preserve paused FlowLink delivery.

Remaining operational limits: table-wide financial serialization reduces throughput; long contention returns retryable/unknown outcomes. Manual item/LEGO/sibling side effects retain their existing multi-request boundary after the atomic cash decision; failures need inspection and must not be retried by inventing identities. The held manual draft must remain available to resume unchanged. Review-only contract gaps are not live Bank Data Sync acceptance.

## Local verification record

Working base: `3471333d901d61eba62c67e5576217f97e2b083e`. No production migration, bank access, real transaction delivery, native FlowLink work or activation was performed. Package/lockfile version and dependency metadata are unchanged; all seven version fields remain `1.8.0`.

| Check | Result |
| --- | --- |
| Canonical backend tests, serial execution to avoid native-image test process instability | 573 passed |
| Frontend tests | 747 passed across 51 files |
| Unified ingestion, disposable PostgreSQL 16 | 16 passed |
| FlowLink authenticated backend/binding PostgreSQL suite | 26 passed initially; the remaining pagination check passed after correcting a test-only stale keepalive socket. 27 scenarios covered; no production/native activation |
| Frontend production build and lint | Passed; existing large-bundle warning remains |
| Broader Budget, Savings and Shopping PostgreSQL suites | Final baseline-repair rerun: **239 passed, 0 failed, 0 skipped** across the same 13 test files |
| Migration/full-schema synchronization and `git diff --check` | Passed |

Final regression triage reproduced **all 14 failures** against `3471333` in a detached worktree and against the unified working tree, with matching fixture bytes, Node, dependencies and PostgreSQL image. The owner then authorized test-only baseline repairs: six Budget cases now use the database's current/previous/next Asia/Jerusalem months; Savings fixtures normalize CRLF to canonical LF and compare matching historical schema boundaries. All original assertions and strict fingerprints remain. **All 14 cases now pass; the complete broader suite is 239/239, unified PostgreSQL is 16/16, and backend is 573/573, with no failures or skips.** Application code, migrations, production guards and unrelated owner files are unchanged by this repair. See the [14-test repair matrix, original baseline evidence and final verification record](../history/UNIFIED_INGESTION_REGRESSION_TRIAGE.md).

The backend, unified PostgreSQL and broader PostgreSQL rows were rerun for this repair. Frontend and authenticated FlowLink backend rows retain the earlier implementation verification evidence; those suites were not rerun for this test-only change. The requested regression gate is clear; owner acceptance, production recovery and deployment authorization remain separate.

Reproduction commands (synthetic fixtures only):

```powershell
# From server: canonical suite with constrained concurrency
$tests = @(rg --files test | Where-Object { $_ -match '\.test.js$' -and $_ -notmatch '\.local.test.js$' })
node --require ./test/setup.js --test --test-concurrency=1 $tests

# From repository root: current shared path and paused-channel compatibility
node --test server/test/unifiedIngestionPostgres.local.test.js
node --test server/test/flowlinkBindingsPostgres.local.test.js
$domainTests = @(rg --files server/test | Where-Object { $_ -match '(savings|shopping|fundedBudget).*Postgres.local.test.js$' })
node --test --test-concurrency=2 $domainTests

npm --prefix client test
npm --prefix client run lint
npm --prefix client run build
git diff --check
```

Historical CAL/general protocol fixtures are retained for their old migration contracts. They are not alternative production intake implementations or evidence that the retired HTTP envelopes remain supported. Never run the optional retired producer audit that reads an external repository.

Release / Version gate: Release impact **Yes**; SemVer **Major** (retired envelopes and coordinated operational cutover); candidate **Pending (TBD)**; grouping **Pending (TBD)**; CHANGELOG **Updated under Unreleased**; version bump **Deferred to owner release preparation**; publication **Out of scope**; owner verification/acceptance **Pending review**. The requested automated regression gate is clear. Production **NO-GO** pending owner acceptance, an explicit recovery decision and a separately authorized coordinated cutover. The baseline repair itself has Release impact **No** / SemVer **None**; its full gate is recorded in the linked triage report.

## Local change inventory

- `CHANGELOG.md` ? updated.
- `client/src/hooks/useTransactionForm.js` ? updated.
- `client/src/pages/Import/Import.jsx` ? updated.
- `client/src/pages/Import/Import.test.jsx` ? updated.
- `client/src/pages/Transactions/Reconciliation.jsx` ? updated.
- `docs/README.md` ? updated.
- `docs/architecture/EXTERNAL_TRANSACTION_BULK.md` ? updated.
- `docs/architecture/GENERAL_TRANSACTION_API.md` ? updated.
- `docs/architecture/UNIFIED_TRANSACTION_INGESTION.md` ? added.
- `server/controllers/importController.js` ? updated.
- `server/controllers/transactionController.js` ? updated.
- `server/controllers/v1/transactionController.js` ? updated.
- `server/full_schema.sql` ? updated.
- `server/migrations/054_unified_transaction_ingestion.sql` ? added.
- `server/routes/reconciliationRoutes.js` ? updated.
- `server/services/calIngestionService.js` ? removed from runtime; historical fixture retained.
- `server/services/externalTransactionBulk.js` ? updated.
- `server/services/generalTransactionIngestion.js` ? removed from runtime; historical fixture retained.
- `server/services/ingestionCommand.js` ? added.
- `server/services/transactionIngestionService.js` ? updated.
- `server/services/unifiedTransactionIngestion.js` ? added.
- `server/test/calIngestion.test.js` ? updated.
- `server/test/calProducerContract.local.test.js` ? updated.
- `server/test/calReconciliationPostgres.local.test.js` ? updated.
- `server/test/externalTransactionBulkController.test.js` ? updated.
- `server/test/externalTransactionContract.test.js` ? updated.
- `server/test/fixtures/calIngestionService.js` ? added.
- `server/test/fixtures/generalTransactionIngestion.js` ? added.
- `server/test/flowlinkBindingsPostgres.local.test.js` ? updated.
- `server/test/generalTransactionContract.test.js` ? updated.
- `server/test/generalTransactionPostgres.local.test.js` ? updated.
- `server/test/helpers/fakeSupabase.js` ? updated.
- `server/test/helpers/flowlinkHttp.js` ? updated.
- `server/test/reconciliationReviewPostgres.local.test.js` ? updated.
- `server/test/transactionIngestion.test.js` ? updated.
- `server/test/transactionLoanPayments.test.js` ? updated.
- `server/test/unifiedIngestionControllers.test.js` ? added.
- `server/test/unifiedIngestionPostgres.local.test.js` ? added.

The pre-existing APY operations document, multi-user documents and operations `__pycache__` are excluded from this inventory and were preserved. No staging, commits, pushes, tags or deployment were performed.
