# General transaction evidence API (#96)

Local implementation against v1.7.0 `1da80871f57354f6429358d37e97b0517d1efaf3`.
Owner acceptance and producer agreement are pending. No delivery, collector,
schedule, production migration or source registration was enabled.

Consumer: [#96](https://github.com/OzAvrahami/finance-tracker/issues/96).
Producer: [bank-data-sync #1](https://github.com/OzAvrahami/bank-data-sync/issues/1),
read during implementation; no producer files changed. The
[accepted APY contract](APPLE_PAY_TRANSACTION_RECONCILIATION.md) and existing
[CAL compatibility path](../operations/APY_04_CAL_RECONCILIATION.md) remain in force.
The latter includes owner edits and was deliberately left unchanged.

## Endpoint and deliberate compatibility selection

`POST /api/v1/transactions`, existing `Authorization: Bearer <integration-key>`.
This is the existing trusted integration credential, not a FlowLink device token
or a new tenant boundary. A caller cannot supply an owner, payment-source ID,
category ID, canonical transaction ID, accounting date, exchange rate or review decision.
The first enabled source kind is CAL; the public envelope is provider-neutral.
Other provider registration kinds fail closed until their consumer policy is implemented.

| Request | Selected behavior |
| --- | --- |
| No `contract`; exact registered CAL `payment_source_name` | Existing CAL v1/v2 adapter, receipts, 201/200/202/409/422 semantics and dry run. |
| No `contract`; ordinary object | Existing legacy schema/insertion and 201/409/dry run. |
| `contract: "finance.transactions.v1"` | New strict general evidence contract, same item processor for `item` and `items`. |
| Any other `contract`, array root, malformed envelope | Explicit rejection; never fallback to legacy insertion. |

Legacy required fields: `type: expense|income`, positive JSON number `amount`,
`date: YYYY-MM-DD`. Optional: `description`, `charge_date`, `category_id`,
`payment_source_id`, `payment_source_name`, `currency`, `original_amount`,
`exchange_rate`, `notes`, `tags`, `external_id`, `dry_run`. Legacy charge date
defaults to date; currency to ILS; tags serialize to TEXT. Missing external ID
has no replay guarantee. Existing name/last4 resolution remains a legacy-only
behavior, not a guarantee of unique identity. Existing unknown-field stripping
is not used by the new contract. Discount, spreadsheet and historical importers,
manual commands and FlowLink keep their separate installed contracts.

## Envelope, evidence and bounds

Use `Content-Type: application/json` (other encodings return 415). Exactly one of
`item` or `items`, plus `contract` and `account`. `account` is an
opaque server-registered account alias. It is not last4, display name or a client
chosen database ID. Unknown fields at every new-contract level reject that item
or envelope. No meaningful source facts are silently removed.

- Maximum **50 items**, **1 MiB request bytes**, **16 KiB serialized item**.
  The application-wide parser retains its existing 2 MiB ceiling, including legacy
  requests. Raw bytes include whitespace. Invalid JSON/oversize parsing returns
  safe 400/413 responses without logging body contents.
- One item at a time per request, at most two general requests per server process.
  Existing API throttling still applies. Busy returns 503 before starting work.
- 20-second batch dispatch budget; each RPC waits at most 5 seconds; DB lock wait
  is limited to 3 seconds. Timeout aborts the HTTP wait, **not proof of database
  rollback**. No more items are dispatched after an indeterminate persistence
  result. A process/network interruption can lose acknowledgements; retry frozen
  identities. No queue, automatic background delivery or collector is added.
- Constants live in `server/services/generalTransactionContract.js`. Backend/DB
  infrastructure may have shorter timeouts; these do not change replay semantics.

| Item field | Meaning / validation |
| --- | --- |
| `client_id` | Required, 1–100 characters; response correlation only. Excluded from evidence fingerprint, allowing single/batch regrouping. Index disambiguates repeated client IDs. |
| `key` | Required stable occurrence/delivery key, 1–255 characters; unique within registered source. Not a merchant/amount/date signature. |
| `identity_basis` | Required `provider`, `durable_delivery` or `unresolved`; unresolved is durably held. This is a source assertion, not proof of bank identity. |
| `legacy_external_id` | Optional original historical identifier, retained as evidence and checked against legacy/CAL reservations; never automatically adopted. |
| `merchant` | Required original source text, 1–200 characters. No filename/alias/name reconstruction. |
| `event.kind` | `expense`, `income`, `refund`, `unknown`. Expense/income use nonnegative magnitude; refunds retain negative signed evidence. Zero cannot post. Unsupported signs reject; no unconditional absolute value. |
| `event.status` | `pending`, `completed`, `unknown`, independent of review, API acceptance and cash posting. |
| `event.basis` | `single`, `installment`, `whole_purchase`, `unknown`. Explicit basis, not inferred from dates/amount differences. |
| `event.purchase_key` | Required nullable scoped purchase identity; non-null for automatic individual-installment posting. Source must preserve it across all representations. |
| `event.installment` | Required null or `{current, total}`; each counter null or integer 0–999. Missing/zero/unknown installment counters hold; strings/negative/counter contradictions reject. Single permits null or explicit 0/0, never silently converts 1/N to normal purchase. |
| `event.provider_type` | Optional bounded original string or safe integer; primitive type is preserved. Unknown CAL codes are not reclassified. |
| `dates.purchase`, `dates.mapped`, `dates.billing` | Required keys, each valid calendar date or null. Purchase means actual original purchase date; mapped means scraper-mapped date, possibly adjusted; billing is evidence, not inferred. |
| `dates.occurred_at`, `dates.timezone` | Optional nullable actual timestamp and IANA zone. Timestamp precision and supplied offset/no-offset are preserved. No timestamp is manufactured from receipt time/date. Zone is evidence; it does not silently add an offset to a naive timestamp. |
| `charged`, `original` | Required nullable `{amount, currency, scale}`. Amount is an exact signed decimal **string**, not number/exponent; scale must match decimal places and supported ISO currency scale from Node ICU. Currency must be recognized. Original currency may differ from charged; no FX rate is calculated. |
| `provider_reference`, `related_provider_reference` | Optional `{provider,type,scope,value}` bounded strings. Only `provider_reference` in an independently registered namespace can drive existing APY matching. `related_provider_reference` is retained evidence, not an automatic identity link or promotion instruction. Numeric identifiers must not be silently coerced to strings; unsupported source identity must remain unresolved until the producer contract defines its projection. |
| `hints` | Optional bounded `name` and four-digit `last4`; retained but never used to select the first matching card. |

All required nullable keys distinguish known absence from accidental omission.
No arbitrary raw payload, notes/tags/category override, domain command, dry run or
privileged reconciliation target is accepted by this contract version.

## Accounting and installment policy

Finance Tracker derives accounting values. Automatic posting requires an enabled
registered source, one active mapped payment source, reviewed historical cutover,
resolved identity, completed source status, positive exact charged ILS cents and
supported event basis. Original foreign amounts remain immutable provenance.
There is no exchange-rate invention or substitution of original for charged amount.

For simple expenses/income, original purchase date supplies `transaction_date`;
confirmed billing date supplies `charge_date` when present. The existing APY
provisional purchase-date charge fallback remains explicitly marked. Missing
purchase date does not become mapped date. A pending record is retained without
calling APY cash creation, even if it contains a processed/billing date.

The accepted APY policy excludes automatic refunds/reversals. This version retains
negative refund evidence and related references with `unsupported_event_kind`
review; it does not reinterpret refunds as income or change prior cash.

**Owner decision for #96: use confirmed billing date for individual installments.**
It supplies the accounting/reporting transaction date, never an invented original
purchase date. The server registration policy defaults to `billing`; an explicit
`review` hold is available. Registration itself remains disabled until deliberately
enabled. This choice is not delegated to producer payloads or inferred from card
type. Policy approval is not implementation acceptance or production activation.

Valid individual installment evidence requires current 1..total, total >=2 and
stable purchase key, actual original purchase date for whole-purchase comparison,
and confirmed billing date. Missing purchase/billing evidence holds explicitly;
mapped dates never fill either gap. Only the observed charged amount is posted. No siblings,
future installments, loans or purchase totals are generated. Whole-purchase
observations are evidence-only (`whole_purchase_not_posted`). Same group/ordinal
under another delivery key is held; conflicting totals hold. A normal single
purchase with the same group also reserves that group against installment posting.

Existing Wallet/manual cash can represent the whole purchase at another amount.
The wrapper holds an installment when such a transaction is near the supplied
purchase/accounting date; the existing APY matcher holds opposite-order whole
observations after general installments. This conservative hold can require review
of unrelated same-card nearby purchases; it is not a guessed match. Missing or
unstable source purchase identities cannot prove full coverage. Producers must not
present one economic purchase with unrelated keys/bases and claim duplicate safety.

## Persistence, results and retries

Migration 052 adds private registrations and immutable per-item evidence receipts.
The wrapper takes APY's transaction-table-first lock, resolves mapping/reservations,
then calls **the existing `ingest_observation`** for eligible evidence. Receipt,
observation, reconciliation events and canonical effects commit in one transaction.
One failed item rolls back its own effects; independent items remain committed.
No batch-wide transaction and no legacy insert loop exists.

Evidence not eligible for APY's complete accounting observation is retained in a
receipt with no observation/cash ID. This deliberately avoids inventing amount,
date or mapping to satisfy APY constraints. Such holds require owner-authorized
resolution; they are **not** exposed as invented entries in #83's
observation UI. Existing complete APY ambiguities continue through the owner-review
UI/commands and their revision/fingerprint protections. Migration 053 adds the
receipt resolution API documented below. Promotion is deliberate and guarded;
ordinary changed-content delivery still conflicts until that revision is approved.

Authentication failures: 401. Envelope/version/count failures: 400. Byte failures:
413. Process capacity: 503. A valid envelope returns **200 with ordered `results`**,
including mixed failures; 200 is never interpreted as “all posted”. Each entry has
`index`, `client_id`, `key`, `outcome`, `accepted`, `financial_posted`,
`review_required`, `retryable`, `reason_code`; durable outcomes include `receipt_id`.
Linked results also include observation/transaction IDs and current disposition.

| Outcome | Action |
| --- | --- |
| `created` | Accepted and posted once. Persist receipt ID. |
| `reconciled` | Accepted and attached by existing APY; no additional cash. |
| `review_required` | Durably accepted evidence; inspect posting boolean and reason, do not resend with a new identity. It can also describe an attached observation needing enrichment review. |
| `replay` | Same source/key/evidence recovered. Original outcome is retained; current APY cancellation/review disposition is reread. |
| `conflict` | Key already reserved with different content. Not accepted as a duplicate. Keep original receipt and route to owner amendment/review. |
| `rejected` | Invalid evidence or unavailable registration/source; no receipt accepted for this input. Fix validation/configuration deliberately. |
| `retryable_failure` | Retry the exact frozen key/evidence. `commit_state: rolled_back` is a definite SQL failure; `unknown` means the command may have committed; `not_attempted` identifies undispatched items. `financial_posted:null` is uncertainty, never a claim that nothing was saved. |

Fingerprint uses PostgreSQL JSONB content excluding `client_id`. Object key order
does not matter; changing a date, numeric/string representation, amount formatting,
optional evidence or pending/completed status is changed content. Do not mutate
accepted payloads to retry. Same key/content concurrency returns the same receipt.
Distinct legitimate equal-looking purchases need distinct stable occurrence keys;
they are not merged by hash. Cancelled observation identities remain reserved and
replay reports cancelled without resurrecting cash. Owner descriptions/notes/tags,
identity edits and charge-date overrides remain guarded by APY.

## Synthetic examples

Use only the isolated review instructions in the [runbook](../operations/GENERAL_TRANSACTION_API.md).
These names/IDs/values are synthetic. Responses below show relevant fields;
actual responses also contain correlation, receipt/revision and reason fields.

Successful single request:

```json
{"contract":"finance.transactions.v1","account":"synthetic-account","item":{"client_id":"row-1","key":"synthetic-purchase-1","identity_basis":"durable_delivery","merchant":"Synthetic Shop","event":{"kind":"expense","status":"completed","basis":"single","purchase_key":null,"installment":null},"dates":{"purchase":"2026-10-01","mapped":"2026-10-02","billing":"2026-11-02"},"charged":{"amount":"10.90","currency":"ILS","scale":2},"original":null}}
```

```json
{"contract":"finance.transactions.v1","results":[{"index":0,"client_id":"row-1","key":"synthetic-purchase-1","outcome":"created","accepted":true,"financial_posted":true,"review_required":false,"retryable":false,"receipt_id":"1","transaction_id":"1"}]}
```

The following reproducible JavaScript builds the remaining request examples from
the tracked synthetic fixture (run from repository root). `item()` is the complete
item above; using a spread changes only the indicated field.

```js
const {item,envelope}=require('./server/test/fixtures/generalTransaction');
const examples={
  batch: envelope([item(),item({client_id:'row-2',key:'synthetic-purchase-2'})]),
  partial: envelope([item(),item({client_id:'bad',key:'bad',charged:{amount:10.9,currency:'ILS',scale:2}})]),
  review: envelope(item({key:'pending-1',event:{...item().event,status:'pending'}})),
  replay: envelope(item()), // send after the successful single, unchanged
  conflict: envelope(item({merchant:'Changed evidence'})), // same reserved key
  retryable: envelope(item()), // same request after injected isolated transport failure
};
console.log(JSON.stringify(examples,null,2));
```

| Example | Ordered response result projections |
| --- | --- |
| Successful batch (fresh disposable database) | `[{"index":0,"outcome":"created","accepted":true,"financial_posted":true},{"index":1,"outcome":"created","accepted":true,"financial_posted":true}]` |
| Partial acceptance (fresh database) | `[{"index":0,"outcome":"created","accepted":true},{"index":1,"outcome":"rejected","accepted":false,"reason_code":"invalid_evidence"}]` |
| Review | `[{"outcome":"review_required","accepted":true,"financial_posted":false,"reason_code":"source_not_completed","receipt_id":"2"}]` |
| Exact replay | `[{"outcome":"replay","original_outcome":"created","replayed":true,"receipt_id":"1","transaction_id":"1","financial_posted":true}]` |
| Changed-content conflict | `[{"outcome":"conflict","accepted":false,"financial_posted":null,"review_required":true,"reason_code":"identity_content_changed","receipt_id":"1"}]` |
| Lost acknowledgement / retryable failure | `[{"outcome":"retryable_failure","accepted":false,"financial_posted":null,"retryable":true,"reason_code":"persistence_unavailable","commit_state":"unknown"}]` |

## Historical transition and readiness

Historical `transactions.external_id` and CAL global receipt IDs are retained.
Creating a general account registration is a deliberate cutover: the database
blocks subsequent legacy external-ID inserts for that account even if the
registration is later disabled. Manual entries without external IDs and unrelated
accounts remain compatible. Review all writers before registration; never remove
this guard merely to make old imports succeed.
Explicit legacy-ID evidence, a colliding key, or an existing APY source/key reserves
identity for review; none silently enrolls history. APY still treats nearby
historical/manual rows as weak review evidence. Registered same-source APY history
must not be replayed under new keys: amount/date matching cannot prove that cutover.

Before enabling delivery, owner/producer must agree durable occurrence keys,
purchase/ordinal identity, frozen payload storage, pending-to-completed amendments,
historical cutoff and existing importer stop/transition. Hashes, run IDs, snapshot
indexes and occurrence suffixes are not universal provider IDs. Keep coverage
limitations explicit, especially unavailable original dates, pending coverage and
the optional CAL mapped-date filter. No disappearance implies deletion.

Readiness requires reviewed mapping, the owner-selected billing policy, handling of
receipt-only holds, migration/permissions, producer response interpretation and
separately authorized owner acceptance. Consumer tests do not establish producer
agreement, complete CAL coverage or live activation. See the current runbook for
verification results, migration requirements and the Release / Version gate.

## Receipt lifecycle and guarded resolution (053)

`GET /api/reconciliation/receipt/:id` returns original evidence, current evidence,
immutable resolution history (maximum 50 revisions), `revision`, `review_token`
and current result. `POST /api/reconciliation/receipt/:id/resolve` uses the existing
authenticated owner-session gate (`FLOWLINK_OWNER_USER_IDS`), not integration API
keys or device credentials. Body (maximum 20,000 serialized bytes):

```json
{
  "request_key": "11111111-1111-4111-8111-111111111111",
  "expected_revision": 0,
  "review_token": "<64-character token from the fresh GET>",
  "item": "<complete general-contract item, including client_id>",
  "reason": "Provider has supplied verified completed evidence",
  "relationship": {"kind": "same_identity"}
}
```

The placeholder `item` must be replaced by an object, validated using the same
runtime contract as ordinary delivery. Actor and receipt ID are server-derived;
owner/payment/transaction targets cannot be supplied. Reason is 10–500 characters.
If `provider_reference` or `identity_basis` changes, require
`relationship: {"kind":"provider_link","evidence_reference":"<10–500 character provider evidence or documented owner investigation reference>"}`.
This is an explicit owner attestation after investigation, **not automatic proof**
from matching merchant, amount, dates, last4 or a producer's related-reference claim.
Do not include credentials or raw statements in the reason/reference.

The original source-scoped delivery `key` remains unchanged. An operator may link
changed provider references to that reserved occurrence; this implementation does
not merge already-ingested different delivery keys or adopt historical observations.
The producer must retain the original durable delivery key after that resolution.
If no trustworthy relationship can be established, keep the evidence held; do not
mint a completed occurrence key to avoid a conflict. Already separate receipts
require investigation, not this command's unconditional promotion.

The command locks in APY order, revalidates receipt revision and the token covering
current source/registration/payment facts, then calls the same private evaluator
and existing `ingest_observation`. It appends a resolution with request UUID,
fingerprints, evidence, actor, reason, relationship and outcome atomically with
any observation/cash effect. Original receipt bytes are never updated. A corrected
mapping can use the same item evidence; this is a recorded owner resolution,
not an identical producer retry. Still-ineligible evidence can append another
held revision without cash. Known refund/event kind, purchase grouping, charged
currency and historical identity cannot be rewritten to bypass policy.

For a pending item, original receipt revision 0 posts nothing. Completed delivery
under the same key conflicts until reviewed. Owner resolution appends revision 1;
eligible completed evidence posts once. Replaying original or approved completed
evidence returns `replay`, `matched_revision`, current `revision` and current
posting/cancellation state; `original_outcome` remains the first receipt outcome.
Unknown changed evidence still conflicts. No source-status update overwrites cash.

Resolution success returns 200 (including still-held results). Exact command UUID
and body retry returns `replay`, even after a lost response; changing that command
under the same UUID returns 409 `command_key_conflict`. A new command with stale
revision/token returns 409 `stale_review`: reread, investigate and deliberately
prepare a new UUID. Existing observations return 422 `observation_review_required`;
use existing observation review/amendment/cancellation commands with their current
fingerprints, never the receipt path to override owner edits or revive cancellation.
Other protected changes return 422 with stable reason. Invalid evidence returns
400; 401/403 remain authorization failures. Resolution uses the shared 5-second
RPC wait / 3-second lock timeout. A 503 `resolution_unavailable` reports
`commit_state` and `retry_with_same_request_key:true`; an unknown result may already
have committed. Save and retry the identical command before preparing another.

## Producer feasibility audit (synthetic, 2026-10-17)

Read-only local producer HEAD: `ce080f3e897867923e8fd778b2aeeae2eefc245f`;
scraper pin: `531c61545adb0a3809c232197ac0e63458fdcf10`.
Sources inspected: `src/cal/provider.js`, `src/shared/snapshot.js`,
`src/normalize/contract.js`, and installed scraper
`lib/scrapers/visa-cal.js:171` (`convertParsedDataToTransactions`). The optional
consumer test executes that actual exported pure mapper and producer snapshot
allowlist using synthetic objects. It does not call a collector or read snapshots.

| Consumer evidence | Actual producer mapping / readiness |
| --- | --- |
| `dates.purchase` | Raw CAL `trnPurchaseDate` exists in mapper input. For installments, normal output `date` is advanced by `current - 1` months; separate original date is lost. `includeRawTransaction:false`; snapshot allowlist rejects an added original-date field. A reviewed bounded projection and schema update are needed in producer. Never subtract months or relabel mapped date as original. |
| `dates.mapped` | Normal output `date` is available, including installment adjustment. Preserve as mapped only. |
| `dates.billing` | Completed `processedDate` comes from `debCrdDate`; pending `processedDate` comes from purchase-derived mutable date and is not billing evidence. Date-only/timezone projection must be explicit; no invented event timestamp. |
| Installment ordinal/total | Completed `curPaymentNum` / `numOfPayments` become `installments.number/total`. Pending number is assigned 1 by mapper, not independently confirmed installment evidence. Missing/zero/contradictory counters do not post. |
| Stable occurrence/purchase identity | Completed `identifier` comes from `trnIntId`; pending identifier is absent. Neither this nor a hash proves a shared whole-purchase identity or pending/completed relationship. Producer needs reviewed durable-key and purchase-group provenance. |
| Exact charged money | Mapper emits JavaScript numbers with CAL sign convention (`chargedAmount` negative for the synthetic expense); consumer requires signed-policy-aware exact decimal strings and currency scale. No production adapter/conversion agreement is established here. Pending charged currency is absent. |

Synthetic actual mapper: original `2026-08-01`, installment 2/3, confirmed billing
`2026-10-10` yields mapped `2026-09-01` and processed `2026-10-10`, **no original
purchase date field**. Consumer source-shaped fixture with purchase null is held
(`installment_purchase_date_required`, zero cash). Supplying separately verified
synthetic raw purchase evidence through owner resolution posts exactly one
installment dated **2026-10-10**; repeated resolution/delivery remains one. A
separately observed third installment creates a second row, never all three.

This proves consumer feasibility with complete evidence, not current end-to-end
producer compatibility. As-is normalized installment output cannot post safely.
bank-data-sync must agree and test the bounded original/billing date projection,
exact money/signs, purchase and occurrence keys, provider identity relationship,
and durable retry storage before enabling delivery. Even with those fields,
refunds, unresolved FX, inactive/ambiguous mappings, uncertain identity and existing
whole-purchase conflicts remain held; this follow-up adds no financial policy.

## Consumer-to-producer source-commit handoff

This is the locally verified consumer implementation for adapter development,
**not producer agreement, owner functional acceptance or live activation approval**.
The source commit keeps application metadata at 1.7.0; the API discriminator is
independent of the eventual application release. Candidate/version preparation
remains owner-deferred. The normative item field table above and runtime
`server/services/generalTransactionContract.js` define required/nullable/unsupported
fields; the adapter must not depend on legacy unknown-field stripping.

| Boundary | Producer obligation / consumer behavior |
| --- | --- |
| Wire contract | `POST /api/v1/transactions`, JSON, existing integration Bearer key; `{contract:"finance.transactions.v1",account,item}` or `{contract:"finance.transactions.v1",account,items:[...]}`. Never both. Response for a valid envelope is HTTP 200 `{contract:"finance.transactions.v1",results:[...]}` in input order. Correlate by `index`, `client_id`, `key`; inspect each outcome, `accepted`, `financial_posted`, `review_required`, `retryable` and `reason_code`. Durable receipt/observation/transaction IDs are strings. A 200 or accepted receipt does not mean posted cash. |
| Bounds | 50 items, 1 MiB raw JSON request, 16 KiB serialized item; existing global parser 2 MiB. Sequential items, at most two general requests per backend process, 20-second dispatch budget, 5-second per-RPC wait, 3-second database lock wait. Envelope/auth/content errors are separate HTTP failures; invalid items do not roll back other valid items. |
| Registration | Owner/admin registers an opaque account alias to a stable active CAL source, reviews historical cutover and configures exactly one authorized active payment source. Registration defaults disabled/history-unreviewed. No registration or financial mapping is producer-created. Names/last4 are hints; absent/ambiguous/inactive mappings hold. The producer cannot submit owner IDs, payment-source IDs or reconciliation targets. |
| Money | Required `charged` and `original` keys, each null or exact `{amount:"10.90",currency:"ILS",scale:2}`. No JSON numeric amounts or exponent notation. Use supported ISO currency/scale and explicit semantic sign mapping: expense/income nonnegative magnitude, refund nonpositive evidence. Positive charged ILS cents are required to post; zero, refunds and unresolved charged FX hold. Original foreign money is retained separately; never fabricate rates or use unconditional absolute value. Source numeric precision/sign loss needs explicit adapter review, not consumer repair. |
| Dates | Required nullable `purchase`, `mapped`, `billing`. `purchase` is original purchase evidence, `mapped` is scraper output even when adjusted, `billing` requires completed confirmed billing evidence. Pending processed date is not billing. Individual observed installments use confirmed billing date for reporting, but still require original purchase date, scoped purchase identity and valid ordinal/total. No future installment expansion. |
| Identity/retry | Persist a stable source-scoped delivery key and frozen evidence before first send. Identical source/key/content replays; a changed fingerprint conflicts. `client_id` is correlation only and is excluded from content fingerprint. Separate equal-looking purchases need separate occurrence identities; never deduplicate by amount/date/merchant. Rebatch unchanged items safely. Retry `unknown` commit outcomes with the same key/evidence; `not_attempted` items may be retried, and a definite rollback does not erase other batch successes. Never interpret timeout as nothing saved. |
| Pending/completed | Pending receipt has no financial effect. Completed evidence under its reserved key conflicts until an owner approves a guarded revision using the current review token and immutable resolution history. The producer cannot invoke owner resolution with its integration key. Keep the original delivery key when provider references change; trustworthy relationship/owner investigation is required. Different already-ingested keys are not merged automatically. |
| Historical cutover | Inventory old importers and global `external_id`/CAL receipts, agree a cutoff and stop/transition competing writers before registration. Registration blocks legacy external-ID insertion for that mapped account even when disabled. Never adopt history by generating fresh observation keys or replaying old snapshots. Cancelled identities remain reserved; owner edits remain protected. |
| Response handling | Store durable receipt IDs and response disposition. `replay` returns current cancellation/review state, not permission to recreate cash. `review_required` is a durable hold; `conflict` needs investigation. Retryable transport/persistence errors are not evidence rejection. Do not remove fields or change identities simply to obtain `created`. |

Required producer work is in **bank-data-sync**, not this repository: carry an
allowlisted original `trnPurchaseDate` projection through collection snapshot and
normalization schemas, separately from adjusted `date` and completed `debCrdDate`.
The actual mapper/allowlist test confirms the field is currently lost/rejected.
Do not turn on unrestricted raw payload storage or subtract installment months
to reconstruct missing evidence. Also agree exact decimal/sign projection,
date-only/timezone handling, scoped purchase/occurrence identity and pending-to-
completed relationships. No producer implementation or agreement is claimed here.
If a meaningful source fact cannot be represented by this contract (for example,
a charged amount whose currency is absent), retain it in the producer's existing
private evidence and hold adapter delivery for resolution. Do not invent the
currency, add unsupported raw fields or silently discard known facts merely to
pass validation. Required nullable fields express genuine missing evidence;
they are not permission to reinterpret source semantics.

### Offline adapter fixture bundle

`server/test/fixtures/generalTransaction.js` exports `producerFixtures()` and,
when run directly, emits a standalone JSON bundle with no imports of application
configuration, credentials, network or persistence. There are 12 request vectors:
single, batch, partial validation failure, pending, completed requiring owner
resolution, exact replay, changed-content conflict, complete installment, missing
original purchase date, missing confirmed billing, refund and unresolved FX.
Each supplies `request`, `validItems`, ordered `before` setup deliveries and an
`expectedResponse` **projection**. IDs/current reconciliation metadata are generated,
not fixed fixtures. A separate `transportFailure` vector documents an injected
unknown-commit result and the exact retry rule. It is not a special wire request
that asks the production server to fail.

Every vector assumes an independent fresh synthetic registration/database with
the stated preconditions. `before` is test setup, never a historical replay plan.
The complete-installment vector uses prospective complete evidence and does not
represent current producer output. Its paired missing-date vector must stay held.
Validation success is distinct from posting eligibility. The producer adapter
should compare its generated JSON against these source-contract vectors, parse
the response projections and retain held/conflicted/retryable states separately.

PowerShell export (only synthetic JSON is written outside either repository):

```powershell
Set-Location 'D:\code\finance-tracker'
$fixtureJson = node ./server/test/fixtures/generalTransaction.js | Out-String
if ($LASTEXITCODE -ne 0) { throw 'Fixture export failed' }
$fixturePath = Join-Path $env:TEMP 'finance96-producer-fixtures.json'
[IO.File]::WriteAllText($fixturePath, $fixtureJson, [Text.UTF8Encoding]::new($false))
$bundle = Get-Content -LiteralPath $fixturePath -Raw -Encoding utf8 | ConvertFrom-Json
$bundle.cases | Select-Object id, validItems
node --require ./server/test/setup.js --test server/test/generalTransactionContract.test.js
if ($LASTEXITCODE -ne 0) { throw 'Consumer offline contract checks failed' }
# Optional persisted verification uses its own portless disposable Docker database.
node --test --test-name-pattern='exported producer handoff vectors' server/test/generalTransactionPostgres.local.test.js
if ($LASTEXITCODE -ne 0) { throw 'Fixture persistence checks failed' }
```

Readiness states remain separate: consumer source/tests ready for owner review;
producer adapter/field/identity agreement pending; production schema, recoverable
backup and owner acceptance unverified; live activation separately authorized.
Future owner-operated order is **052 → 053 → backend**, followed only later by a
separate, agreed activation. Committing these files does not perform any of those
steps. See the [operator handoff](../operations/GENERAL_TRANSACTION_API.md).
