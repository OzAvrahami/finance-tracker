# CAL / FlowLink reconciliation (#82)

Implementation checkpoint: 2026-10-01, based on published Finance Tracker v1.5.0
`8063330e55763c586af95c4446218ffae684f5ce`. Local implementation only; no production
migration, configuration, posting, capture retry or deployment. #90 local Wallet
capture is verified; #91 production posting and broader device acceptance remain separate.

## Inspected producer, not a spreadsheet assumption

The owner confirmed **Financial Data Bridge 3.0.3** is the running CAL importer.
Read-only code audit: `D:/code/financial-data-bridge`, commit
`d8f8580d36e68727d9eecbbf767c41a9b81d8597`; inspected exporter/dedup files have no local
changes. Nothing in that repository or running importer was modified.

- `packages/bridge-core/src/application/exportToFinanceSystem.js` posts the configured
  Finance API URL with its existing Bearer credential. Target contract is
  `POST /api/v1/transactions`. Payload: `type:expense`, numeric `amount=chargeAmount`,
  `date=transactionDate`, `description=merchantName`, `charge_date=chargeDate`,
  `payment_source_name=accountId`, `currency`, `original_amount`, `external_id=dedupKey`.
  It sends completed, positive charges. No provider timestamp/reference or installment
  classification is sent. `chargeCurrency` exists internally but is not transmitted.
- `infrastructure/dedup.js` hashes provider/account/date/merchant/original amount/
  currency/transaction type to 16 hex characters, with `|#2`, `|#3`, etc. for separate
  occurrences in extraction order. These are **producer retry keys**, not provider
  transaction IDs or a common Wallet/CAL reference. Row reordering, changed identity
  fields and incomplete fetch windows remain producer limitations. This adapter
  preserves each supplied occurrence; it cannot repair upstream key instability.
- Its FinanceLedger persists accepted sends; any HTTP 2xx is accepted, even with no
  cash ID. Its broad 409 classifier treats text containing `conflict` as a duplicate.
  Consequently this adapter returns 202 for **durably accepted pending provenance**,
  422 for real conflicts, and 409 only for already-linked exact replay/legacy IDs.
  Bridge may display a 202 as sent: **sent does not mean financially posted**.
  Review obligations are retained in Finance Tracker; #83's review UI is not implemented.

## Explicit registration and unchanged authentication

[Controller](../../server/controllers/v1/transactionController.js) selects the
[adapter](../../server/services/calIngestionService.js) only for an exact registered
`payment_source_name`. Existing external API-key authorization remains required.
The credential is still a trusted backend integration credential, never a phone key.
No inference from a hash shape, merchant, last4, category or client-supplied source ID.
Ordinary unregistered v1 calls and spreadsheet/manual import defaults stay unchanged.

Server-only, non-secret `CAL_INGESTION_SOURCES` is a bounded JSON array, for example:

```json
[{
  "instance_key": "owner-cal-debit",
  "request_key": "11111111-1111-4111-8111-111111111111",
  "payment_source_name": "EXACT IMPORTER ACCOUNT LABEL",
  "payment_source_id": "123"
}]
```

These are example values, **not production configuration**. Manually verify the
exact account label and payment-source row. IDs are decimal strings. A supplied
numeric v1 payment_source_id must agree with the registered mapping. No first-match
last4 resolution occurs on this adapter. Each card/account gets its own stable
`v1-cal:<instance_key>` source. Optional `expected_revision` is a decimal string;
optional approved `aliases` entries contain only `merchant` and `key`, scoped to
this profile's payment source. No real merchant aliases are bundled or learned.
Both sides need an approved common alias key for alias-based attachment.

The first supported request configures the source through the existing audited
`configure_ingestion_source`, in the same transaction as ingestion. Repeated request
keys do not reconfigure/reactivate it. A deliberate change needs a new configuration
request UUID and expected revision. Source identity is independent of key rotation.
Malformed configuration fails closed. The native and legacy Apple flags remain independent.

### Supported accounting boundary

Initial bridge adapter supports positive simple **ILS** expenses with exact cents.
Numeric v1 input is translated via its decimal serialization to APY decimal strings;
no floating-point matching, implicit rounding, inferred FX, purchase time or provider ID.
Original ILS amount must equal the charged amount when supplied. Foreign currency,
exchange-rate input, differing original/charged amounts (possible installments,
fees or another unsupported basis), Savings/domain fields and malformed values
reject explicitly; they **never fall through to direct legacy cash creation**.
These unsupported cases need an explicit source/domain contract before registering
an account that requires unattended coverage of them. Existing unregistered foreign
and installment/manual workflows and historical rows are unchanged. This is a concrete
rollout limitation, not a claim of complete card-site coverage.

## Atomic command, compatibility and recovery

[Migration 045](../../server/migrations/045_cal_reconciliation.sql) adds private
`cal_ingestion_receipts`: global case-sensitive external ID, source FK, unique
observation FK, request SHA-256, bounded creation-only notes/tags and server receipt time.
No credentials/raw headers. RLS is enabled and direct role writes are revoked; only
service_role executes `ingest_cal_v1`. Accepted receipts are immutable and retained.

`transactionIngestionService.ingestCalV1` calls that wrapper. It takes APY's existing
transaction-table-first EXCLUSIVE lock, resolves replay/legacy IDs, registers the
source, calls **the existing `ingest_observation`**, reserves the external ID and
returns a safe result atomically. No controller query-then-insert or second matcher.
Database errors roll back registration, observations, events, cash and receipts together.

CAL external IDs are reserved in the receipt registry and returned by the v1 adapter.
They are never copied into a new APY canonical row or another source observation.
New APY cash keeps external_id=NULL as required by the accepted contract; historical
external_id values and the existing partial uniqueness/index are intact.
Pending receipts also reserve IDs, including against direct legacy writes. The existing
APY review command links/creates the chosen cash once; the receipt continues to resolve
the original external claim through its observation.
Legacy historical IDs return the old 409 without silently enrolling history as CAL.
Source retries compare the original producer request before current inferred categories;
changed input requires explicit review/amendment, never new cash under the same key.

After source registration the database refuses external expense inserts for its payment
source that bypass the adapter. Removing an environment variable or reverting Node code
must **not** silently restore the demonstrated duplication path. This also affects other
legacy external writers on that registered payment source; inventory them before opt-in.
Ordinary manual rows without external IDs and other payment sources are not blocked.

| Response | Meaning to the current bridge / Finance Tracker |
| --- | --- |
| 201 | New canonical purchase, one accounting effect; v1 id/external_id/created_at plus APY envelope. |
| 200 | Supported evidence attached; no additional expense. |
| 202 | Accepted pending review, id/transaction_id null, financial_posted=false. Replay remains pending. |
| 409 already_exists / cancelled_record_exists | Existing linked exact replay or preserved historical external ID; no new effect. |
| 422 | Unsupported input or unresolved conflict. Deliberately not 409, to avoid the bridge's broad duplicate classifier. |
| 503 | Configuration/source/service failure; retain original key for retry. |

Dry run validates and returns `would_ingest`, `would_insert:null`,
`matching_deferred:true`; it writes no source, receipt, observation or cash. It does
not pretend that a non-atomic preview reserves a candidate. The normal legacy dry-run
shape remains unchanged outside explicit registration.

## Matching, source names and repeated purchases

Strong attachment rules remain the accepted APY reference, verified time, or unique
same-date/card/exact-money/**approved merchant identity** rules. A coarse card/amount/date
match is never sufficient. Migration 045 also retrieves differing merchant text as
**weak review evidence**. Historical/manual rows are review-only, never silently promoted
to CAL evidence. Void/protected/identity-edited candidates remain conflict sentinels.
Candidate overflow holds; it does not pick an arbitrary row. Existing pending evidence
blocks a new uniqueness inference. Owner separate-review fingerprints include newly
arriving weak candidates and prevent stale decisions.

| Owner evidence | Safe outcome with current source evidence |
| --- | --- |
| Wallet Ninja Star Ltd / CAL Hebrew Ninja label, ILS 10 | No approved alias/common reference/time: review, zero additional cash. Never transliterate into an automatic identity. |
| TWO Wallet Israel Post purchases / TWO CAL Nayax entries, ILS 6 each | Keep two first-source cash occurrences and two second-source pending observations with independent keys. No global Israel Post=Nayax alias or guessed assignment. |
| Exact/approved merchant identity, one compatible same-date candidate | Attach in either arrival order, with no additional expense. |
| CAL-only, no plausible opposite or historical candidate | Create normal cash; distinct suffix keys remain distinct purchases. |

Official CAL merchant text remains immutable observation evidence. The accepted contract
makes canonical description user-owned after creation, **even if unchanged**. Category,
notes, tags and other overrides are never replaced on attach. CAL can enrich only a
marked provisional charge_date, subject to existing sticky edit, Savings/Loan/Budget
and captured-history guards. transaction_date and frozen FlowLink bytes/UUID never change.
The wrapper invokes no installment, Loan, Savings, Shopping, LEGO, allocation or
keyword-learning side effects. Existing readers sum canonical cash once.

Backend review uses existing private `get_ingestion_observation`, `resolve_observation`
(link/separate with expected revision and fingerprints) and `amend_observation` commands.
They remain privileged owner/server operations; no source credential can submit a chosen
canonical transaction ID. This work adds no #83 UI or source-accessible review/cancel route.

## Controlled deployment prerequisites (not performed here)

1. Review account coverage, bridge 3.0.3 response semantics, exact label/payment mapping,
   historical rows and all writers on that payment source. Keep both Apple/native flags false.
2. Under separate authorization, back up the correct database; snapshot transactions and
   APY/domain counts/totals. Verify schema through 044. Apply **045 only**, transactionally.
   No inferred CAL-history backfill exists. Never edit/reapply 036 to deploy this change.
3. Verify receipt table/RLS/private grants, triggers and preserved cash/domain snapshots.
   Refresh PostgREST's schema cache. Migration rerun is tested, not an instruction to run blindly.
4. Deploy matching backend and explicitly configure the reviewed CAL profiles. Existing
   bridge URL/key/payload can remain unchanged. No runtime change is made to that importer here.
5. Verify supported CAL-only/attach/pending outcomes and review access. Only then resume
   #91's separately controlled existing-capture posting test, after a fresh duplicate check.
   These local tests do not authorize current phone retries or ongoing native activation.
6. On failure, stop native ingestion and fail the affected CAL source closed while retaining
   queued producer requests and all provenance. Forward-fix; do not delete receipts, drop APY
   schema, roll back to hard-delete code or remove the guard to make imports succeed.

## Verification and acceptance

Tests: [adapter/unit/HTTP](../../server/test/calIngestion.test.js),
[real PostgreSQL/HTTP races](../../server/test/calReconciliationPostgres.local.test.js),
existing APY/FlowLink/Apple regression and final-schema Savings release matrix.
Results and exact commands are maintained in the existing #82 implementation handoff.
The 2026-10-01 regression campaign also reproduced two unrelated failures against
unchanged release HEAD: the long synchronous owner-binding pagination fixture loses
its HTTP keep-alive connection (ECONNRESET), and a Savings reporting fixture inserts
ordinary spending on day 2 while its report ends on day 1. Neither is counted as a pass;
no assertions or unrelated runtime behavior were changed to hide them.
No new phone test, provider call, production DB operation or CAL run is implied.
Owner acceptance remains Pending. Version stays 1.5.0; a later coordinated Minor is TBD.

### Subsequent #83 local implementation

#84's initial [registered-stream audit](APY_06_RELEASE_READINESS.md) confirms a concrete
coverage blocker in saved Bridge exports: legitimate FX requests are rejected after
registration, and billing currency/event classification are missing on the wire.
Safe rejection and unregistered compatibility are not preserved account coverage.
The subsequent local v2 correction resolves the demonstrated FX wire gap; unknown
event and installment semantics still block whole-account activation/v1.6.0 preparation.
See the linked current contract and consumer-first 045 → 046 → 047 rollout.

The statements above about the absent review UI describe the #82 checkpoint.
[APY-05](APY_05_RECONCILIATION_REVIEW.md) now adds authenticated owner review, safe
source projections and Migration 046. It reuses these commands and matching rules;
it does not change CAL coverage or authorize production activation.
