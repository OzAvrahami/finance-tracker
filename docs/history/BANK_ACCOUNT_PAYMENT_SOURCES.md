# Bank account payment sources — local implementation

Date: 2026-11-05. Base commit: `49eb140`. Owner acceptance: Pending.

## Scope

Add `bank_account` as a seventh payment-source method. It identifies a specific
bank account; `bank_transfer` remains a separate existing method. No existing
source, transaction or identifier is reclassified. In particular, production
source IDs 8 (cash) and 9 (bank_transfer) must remain unchanged.

The existing settings page offers **חשבון בנק**, a bank icon and themed badge,
display name, bank/issuer, last four account digits and owner. Creation retains
the existing active-by-default behavior; editing and soft-deactivation retain
the existing active/inactive controls. Account digits remain limited to four
in the UI and displayed as an LTR technical value inside the RTL page. No full
account-identifier field or Bank Data Sync account mapping is introduced.

Settings create/update accept the new method through the existing allowlist;
list, authorization and soft-delete behavior are unchanged. Transaction source
selectors already consume active source records without filtering by method.
Transaction history still displays the stored source name; reconciliation now
labels bank-account evidence in Hebrew.

The Discount example (`בנק דיסקונט - 5297`, issuer `Discount`, last4 `5297`)
exists only as synthetic test data. PostgreSQL assigns its test ID. Frontend
fixtures mock server-returned IDs, not proposed production identities. The real
account is created later by the owner and receives a new database-assigned ID.

## Migration and ingestion safety

`055_bank_account_payment_sources.sql` requires migration 054. In one transaction
it extends `payment_sources_method_check` and replaces only
`ingest_external_transaction` and `ingest_owned_transaction`, adding
`bank_account` to the existing bank-transfer/check semantics hold. The two
function bodies otherwise retain 054 behavior, security-definer search paths
and service-role-only execution grants. The append-only `full_schema.sql`
contains the identical migration. A five-second lock timeout fails closed;
the migration takes the existing ingestion lock order before source-table DDL.

There is no seed, ledger schema change, historical update, identity reset,
trigger removal, RLS change or public single/Bulk contract change. The 38
synthetic historical CAL receipts, transactions, observations and reconciliation
events are checked before and after both forward migrations.

External and CSV bank-account expense/income observations retain review evidence
and `bank_event_semantics_required`, with no financial transaction. Replays reuse
the observation; changed payloads conflict. The review UI cannot offer a separate
posting for these holds, and directly attempting that decision is rejected by
`apy_create_cash` with `evidence_correction_required`. Merely accepting the new
payment method does not support bank income, reversals, loan repayments or
internal transfers. Manual entry continues through existing owner-controlled
domain writers. Loans, Savings, refund/FX/installment guards, identity and
cancellation rules are not redesigned.

## Verification

Node `v24.11.1`; disposable, portless `postgres:16-alpine`; synthetic data only.

| Check | Final result |
| --- | --- |
| Canonical backend, serial TAP run | 575 passed, 0 failed |
| Unified ingestion / migration 055 PostgreSQL | 20 passed, 0 failed |
| Savings manual PostgreSQL | 14 passed, 0 failed |
| Savings core PostgreSQL | 11 passed, 0 failed |
| Frontend full suite | 751 passed across 51 files, 0 failed |
| Frontend lint | Passed |
| Frontend production build | Passed; existing chunk-size advisory remains |
| `git diff --check` | Passed |

The canonical backend includes loans, Savings, LEGO, import and reconciliation
regressions. The unified PostgreSQL suite runs the new functions after 055 and
retains all 16 original cases, including CAL 2755, another CAL card, MAX, FX,
installments, cross-source ordering, owner edits/cancellation, unknown commit,
8-success/2-failure Bulk and a 50-item batch. Four new PostgreSQL cases cover
the bank method, migration rollback/preservation, API/CSV safety, manual behavior,
fresh/upgrade parity and execution privileges. UI tests cover create/edit,
Hebrew/RTL/last-four presentation, selection, historical display and review.

Initial runs exposed a stopped Docker daemon, an existing Savings harness
startup race, a transient Shopping test-process failure and frontend timeouts
under high concurrency. The Shopping file passed independently (9/9), and the
full backend rerun passed 575/575. Savings rerun passed 11/11. Frontend uses
`--maxWorkers=2` without extending timeouts and passed 751/751. New test setup was corrected for
the mock response status, inherited HTML RTL direction, required category and
the existing SQL exception on prohibited review posting; application behavior
was not changed to satisfy those assertions.

Reproduction commands (PowerShell, repository root):

```powershell
Push-Location server
$tests = @(Get-ChildItem test -Recurse -Filter '*.test.js' |
  Where-Object { $_.Name -notlike '*.local.test.js' } |
  Sort-Object FullName | ForEach-Object FullName)
node --require ./test/setup.js --test --test-concurrency=1 --test-reporter=tap @tests
node --test test/unifiedIngestionPostgres.local.test.js
node --test test/savingsManualPostgres.local.test.js
node --test test/savingsPostgres.local.test.js
Pop-Location
Push-Location client
npm test -- --maxWorkers=2 --reporter=dot
npm run lint
npm run build
Pop-Location
git diff --check
```

No production database, producer, financial transaction or deployment is involved.
SHA-256 comparisons confirm the pre-existing APY reconciliation document,
MULTI_USER documents and operations `__pycache__` file are unchanged. Dependency
manifests/lockfiles, seven version fields and migration 054 are unchanged; the
index remains empty.

## Files changed

- `server/migrations/055_bank_account_payment_sources.sql` — additive constraint and guarded intake definitions.
- `server/full_schema.sql` — identical append-only migration snapshot.
- `server/controllers/settingsController.js` — method allowlist.
- `client/src/pages/Settings/PaymentSourcesTab.jsx` — method option, bank icon and account labels.
- `client/src/pages/Settings/Settings.css` — themed bank-account badge.
- `client/src/pages/Transactions/Reconciliation.jsx` — Hebrew method label.
- `server/test/settingsPaymentSources.test.js` — create/list/update/soft-delete and old-method validation.
- `server/test/unifiedIngestionPostgres.local.test.js` — latest migration coverage and original ingestion regressions.
- `client/src/pages/Settings/Settings.test.jsx` — account creation/editing and RTL presentation.
- `client/src/pages/AddTransaction/AddTransaction.test.jsx` — source selection and submitted identity.
- `client/src/pages/Transactions/Transactions.test.jsx` — bank/cash/transfer historical display.
- `client/src/pages/Transactions/Reconciliation.test.jsx` — Hebrew held evidence and no posting choice.
- `CHANGELOG.md` — additive Unreleased entry; unrelated entries preserved.
- `docs/architecture/UNIFIED_TRANSACTION_INGESTION.md` — bank-account hold boundary.
- `docs/history/BANK_ACCOUNT_PAYMENT_SOURCES.md` — this verification and owner handoff.

## Remaining production steps

1. Owner reviews and accepts the local feature and test evidence. Review the
   feature diff separately from unrelated local owner files.
2. Confirm the actual deployed migration/backend boundary. If 054 and the unified
   backend are not deployed, complete their separately approved coordinated
   cutover first; this feature does not authorize that cutover.
3. Obtain a current private backup and verify recovery under the owner's approved
   operational process. Backup availability/currentness is not assumed or
   verified by this task; a paid Supabase plan is not required by this feature.
4. During an approved maintenance window, apply only migration 055 with stop-on-error
   behavior. Its constraint and guards commit together. Verify all seven allowed
   methods, unchanged IDs 8/9 and historical counts, function grants/RLS and both
   bank-account holds. The new UI/backend must not precede the database migration.
5. Deploy the matching backend and frontend. A pre-feature unified backend can
   continue existing intake after 055 but cannot create/update `bank_account` via
   its old settings allowlist. Do not offer creation until the new backend is live.
6. Owner creates the Discount account through Settings and verifies the newly
   assigned ID, name, issuer, last4, owner and active state. Do not repurpose IDs
   8/9. Bank Data Sync mapping requires separate approval; keep delivery disabled
   while bank transaction semantics remain unsupported. FlowLink stays paused.
7. Finalize release grouping/version, prepare the canonical version fields and
   release documentation in a separately authorized step. Owner commits/pushes;
   deployments and publication remain separately authorized actions.

Recovery: retain the additive schema and safety guards if rolling back the UI or
backend. An older settings backend rejects the new method on create/update; it
does not justify deleting or reclassifying accounts. Do not drop the constraint
value while records use it, remove guards, or run a destructive down migration.

Readiness: **GO for local owner review**; no remaining test failures. **NO-GO
for production execution in this task**: owner acceptance, migration/backend
boundary verification, recovery readiness and deployment authorization remain
outstanding. Automatic bank transaction delivery remains **NO-GO** until bank
financial semantics are explicitly supported and separately approved.

## Release / Version gate

- Release impact: Yes — a new user-visible payment-source capability and required ingestion safety coverage.
- SemVer impact: Minor — backward-compatible method addition; all old method values and API shapes remain supported.
- Candidate release: Pending (TBD) — owner selection tracked in this handoff; no version number changed.
- Grouping / included release candidate: Pending (TBD) — owner to decide grouping with the existing unified-ingestion Unreleased scope. A combined candidate must retain that scope's higher Major impact if included relative to the published baseline.
- CHANGELOG status: Updated under Unreleased, Added — Bank account payment sources.
- Version-bump status: Deferred — owner release preparation after acceptance and candidate selection; seven canonical fields unchanged.
- Publication status: Out of scope — no staging, commit, push, tag, publication or deployment performed.
- Owner verification / acceptance status: Pending review — automated tests do not establish owner acceptance.
