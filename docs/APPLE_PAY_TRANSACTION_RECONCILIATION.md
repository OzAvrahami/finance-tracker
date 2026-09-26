# APY transaction ingestion and reconciliation contract

> **2026-09-26 adapter direction:** native FlowLink planning
> [#85](https://github.com/OzAvrahami/finance-tracker/issues/85) supersedes the complex
> APY-03 user-authored Shortcut client. The accepted canonical/source identity,
> optional source-time/reference, exact-money, ambiguity and compatibility rules in
> this document remain authoritative. Device credentials and server-owned per-card
> bindings are a future authorization adapter over this foundation, not a second
> financial ingestion system. See [the planning record](FLOWLINK_NATIVE_INGESTION_PLAN.md);
> FLI-01 is not started or accepted, and #81 owner acceptance remains Pending.

APY-01 ([#79](https://github.com/OzAvrahami/finance-tracker/issues/79)), under
[APY #78](https://github.com/OzAvrahami/finance-tracker/issues/78). Design complete
for owner review; acceptance **Pending**. Audited 2026-09-22 at
`c600dc036b03f5ae3f9266eb1b9de935b8683d38`, published v1.3.1.
Owner review corrections: ambiguous Apple evidence never creates extra cash while
plausible canonical candidates exist; optional provider references are separate
from required ingestion retry identity. Overall architecture feedback does not
constitute final acceptance of this revised contract.

**Status of statements:** §1 describes existing repository behavior. §§2–16 are
the chosen **future contract**, not existing tables, routes or functionality.
No runtime, schema, configuration or production changes accompany this document.
APY-02 implements the foundation; APY-03/04 integrate sources; APY-05 adds review.
Do not reopen identity/compatibility decisions merely because an adapter lacks an
optional field: use the defined missing-evidence outcome. Actual device capability
and external CAL adapter evidence remain separate verification tasks (§15).

## 1. Current-state audit

### Writers and trust boundaries

Every application cash writer found in controllers/services and every transaction
INSERT in the effective consolidated schema is covered below. An RPC's existence
is not evidence that a current HTTP route calls it. No production schema inspection
or private automation/credential inspection was performed.

| Path / entry point | Creation boundary; retry / external ID behavior | Resolution and accounting behavior | APY disposition |
| --- | --- | --- | --- |
| External `POST /api/v1/transactions` | [v1 controller](../server/controllers/v1/transactionController.js), [route](../server/routes/v1/transactionRoutes.js); `EXTERNAL_API_KEY` Bearer auth before user JWT. Direct INSERT. Global external ID precheck plus 23505 handling; no cross-source matching. Missing ID has no retry identity. | Explicit category or first same-type non-Savings keyword match. Explicit source ID or first active name/last4 match; no cardinality check. Simple cash only; Savings input/roles rejected; no Loan linkage/items/installment/LEGO creation. | Shared service **legacy mode**, preserving §3. Source-aware automation explicitly opts into a new adapter. |
| Excel `POST /api/import/preview`, `/save` | [import controller](../server/controllers/importController.js), [routes](../server/routes/importRoutes.js), user JWT. Preview writes nothing. Save bulk INSERTs; no request key or external_id persisted, no duplicate detection. | [CAL/debit/MAX profiles](../server/config/importProfiles.js); browser selects category and one payment source for batch. Missing source can be null. Preview keywords suggest categories; save mutates category keywords afterward. Savings input rejected; no Loan/items/installment expansion. | Shared service compatibility path; source-aware CAL/import adapter adds provenance without silently changing legacy save semantics. |
| Ordinary `POST /api/transactions` | [transaction controller](../server/controllers/transactionController.js); JWT. Direct cash INSERT followed by separate item, LEGO, keyword and installment writes. No generic receipt, external_id absent from payload. | Explicit category/source; category keyword learning; item/discount pricing. Loan/Savings branches dispatch separately before ordinary writes. | Remains manual/domain-specific. Do not run it when merely attaching evidence. |
| Ordinary installment generation | Same create handler; non-Loan `installment_count > 1` inserts first installment then siblings. No retry key. | Each row carries allocated amount, month-advanced transaction/charge dates and parent linkage; rounding remainder on last sibling. No external_id. | Preserve; a purchase-total observation is not identity for all installment rows. Explicit review only (§12). |
| Manual Loan-linked create/edit | `loanPaymentService` -> `create_transaction_with_manual_loan_payment` / `update_transaction_with_manual_loan_payment`, [migration 015](../server/migrations/015_manual_loan_repayments.sql); JWT. | Explicit category/source and Loan command. Link-only differs from repayment; atomic cash/payment reconciliation and schedule constraints. No general request-key/external_id dedup. No future siblings for Loan-linked form entry. | Preserve domain commands; provenance attachment cannot create/sync a loan_payment. |
| Scheduled Loan cash | `/api/internal/jobs/process-due-loans`, dedicated `LOAN_JOB_SECRET`; [due service](../server/services/dueLoanPaymentService.js) -> `create_due_loan_payment`. | Server chooses active expense Loan category; source from Loan; expected due date/installment and Loan lock guard repeat processing. One transaction + payment + schedule transition. No external_id; never generic amount/date dedup. | Domain writer, not an APY adapter. |
| Retained Loan RPC | `create_transaction_with_loan_payment(JSONB,BOOLEAN)` in full schema, service_role execution; no current HTTP create caller found. | Inserts cash and optionally synchronizes legacy Loan payment. Explicit references; no external_id or generic receipt. Early-payoff/irregular helpers affect loan_payments; their mere presence does not establish another HTTP purchase-ingestion path. | Preserve compatibility; do not call from APY. |
| Manual Savings cash, existing-cash link, correction/reinstatement | JWT form `savings_handling` or `/api/savings/events` and correction endpoints; [service](../server/services/savingsTransactionService.js) -> `post_savings_event` / `correct_savings_event`; final implementation in [034](../server/migrations/034_savings_monthly_deposits.sql). | `create_cash` inserts; `link_cash` uses existing cash; correction can update live cash or create replacement cash when reinstating voided history. UUID command receipt/fingerprint, expected revisions and transaction fingerprints; explicit category role/source/account; exact ILS simple cash, no Loan/items/installments. No external_id manufactured. | Preserve atomic domain owner, including recorded imported cash linked later by explicit user action. |
| Savings monthly deposit | `/api/internal/jobs/process-due-savings`, dedicated `SAVINGS_JOB_SECRET`; [due service](../server/services/dueSavingsDepositService.js) -> `post_savings_event(action=due)`. | Independent request key plus permanent account/month occurrence claim, plan revision, due date, configured source and Savings role category; cash created atomically. | Preserve; APY cannot create a second scheduled deposit or claim. |
| Savings realized interest | Savings events, [032](../server/migrations/032_savings_realized_interest.sql), final 034 dispatcher. | Payout can create/link income cash; capitalized interest/opening balances do **not** create cash. Explicit role/source; command receipts and revisions. | Preserve; never infer payout merely from imported income. |
| Funded Budget surplus -> Savings | JWT `/api/savings/surplus`, [033](../server/migrations/033_savings_funded_surplus.sql), `apply_savings_surplus` / `savings_apply_surplus_locked`. | One cash transaction plus Savings and Budget records, exact amount, request receipt and stale-preview fingerprint. Category/source explicit/validated by preview. No external_id. Ordinary Budget allocations/deficit resolution create no cash. | Preserve; attaching evidence must not execute transfer or charge Budget twice. |
| Shopping checkout | JWT checkout route -> [checkoutList](../server/controllers/shoppingController.js), direct transaction INSERT, then checkout/list writes. | Explicit category/source; purchased-item total. Existing checked_out guard is not an atomic cross-request receipt. Savings roles/payloads rejected. No external_id, Loan linkage or transaction_items/LEGO synchronization. | Remains domain/manual flow; do not infer APY identity from list title/total. |

Common Budget effect: live expenses feed transaction-date-based actuals, with the
explicit funded-surplus exclusion below; live income affects cash summaries.
Uncategorized rows still appear in Transactions and financial totals. Reconciliation
does not allocate Budget funding. Existing category inference, date fallback,
currency/amount conversion and direct cash insertion are duplicated across v1,
import, manual and checkout paths. Converge **external ingestion** first; do not
refactor all domain writers into generic purchase creation.

### Cancellation, readers, schema and test evidence

- [Normal delete](../server/services/loanPaymentService.js) calls
  `delete_transaction_with_loan_payment` (015): ordinary cash is physically deleted
  along with items/LEGO; eligible manual Loan payments are reversed with schedule
  checks, protected generated/history cases rejected. Consequently ordinary legacy
  deletion can free an external ID. Do not describe all deletion as a tombstone.
- Savings commands preserve cash history with `voided_at`, `void_request_key`,
  `void_fingerprint`, `void_reason`. These fields/check constraint originate in
  [030](../server/migrations/030_savings_foundation.sql). Final
  `savings_guard_transaction` (033) prohibits changing old voided rows, deleting
  Savings history, and **ordinary non-Savings voids**. APY cannot simply start
  writing voided_at without an explicit, narrowly bounded guard change (§11).
- Final [035 readers](../server/migrations/035_savings_reporting.sql)
  `transactions_filtered`/`transactions_page` expose live rows and exclude voided
  rows except explicit transaction detail. Their transaction fingerprint hashes
  the transaction JSON excluding updated_at/void fields. Adding observation data
  to transactions would perturb that contract; keep provenance separate.
- [Dashboard](../server/controllers/dashboardController.js) uses
  `dashboard_summary`/`dashboard_monthly_series`; [annual Budget reporting](../server/controllers/budgetController.js)
  also consumes live cash via `transactions_filtered`. Final
  `budget_actual_transactions` in 033 filters live expense by transaction_date
  and excludes the specifically reconciled funded-surplus Savings transfer.
  No reader currently has a reconciliation-confirmation prerequisite. Avoid
  one-to-many joins that multiply cash rows when exposing provenance.
- [Schema](../server/full_schema.sql): transactions.id is SERIAL/integer;
  payment_source_id/category_id reference BIGINT IDs. Money is NUMERIC, not an
  asserted universal two-decimal/currency contract. `currency` can describe the
  original transaction while `total_amount` is the ILS charge (CAL profiles and
  Import test fixture). `transaction_date`/`charge_date` are DATE; created_at is
  timestamp **without** timezone. It is not purchase-time evidence. payment_sources
  has unique slug, method, issuer, owner, is_active, optional non-unique last4.
- Migration audit after [016](../server/migrations/016_external_transaction_contract.sql):
  017–028 establish/replace Budget actuals and operation invariants, not an
  external observation model; 029 changes Shopping optional fields; 030 adds
  Savings/void guards and replaces readers; 031 cash link/correction/cancel;
  032 interest cash; 033 surplus cash/guards/exclusion; 034 monthly cash/receipts;
  035 reporting only. Earlier 003 readers and 008–015 Loan writers were inspected
  against their later replacements, not assumed to remain authoritative unchanged.
- [External contract tests](../server/test/externalTransactionContract.test.js)
  cover persistence, 409 duplicate/cancelled IDs, dry-run, TEXT tags, migration
  shape and log hygiene. [Import UI tests](../client/src/pages/Import/Import.test.jsx)
  cover preview/save, including ILS charge versus USD original metadata; no
  standalone canonical server import test file was found. Relevant additional
  evidence: [Loan transaction tests](../server/test/transactionLoanPayments.test.js),
  [pricing](../server/test/transactionPricing.test.js),
  [Savings path tests](../server/test/savingsTransactions.test.js),
  [Savings SQL cases](../server/test/savingsManualPostgres.local.test.js),
  [monthly Savings](../server/test/savingsMonthlyPostgres.local.test.js),
  [pagination](../server/test/transactionsPagination.test.js),
  [Budget](../server/test/budgetController.test.js),
  [Dashboard](../server/test/dashboardController.test.js).
- [Auth/mounting](../server/index.js): external v1 uses API-key auth before JWT;
  ordinary APIs use [requireAuth](../server/middleware/auth.js); internal jobs use
  dedicated secrets. Shared /api IP throttling and 2 MB JSON limit exist. These
  are not proof of a scoped Shortcut credential. No secrets were read.
- No active Wallet/Shortcut or CAL crawler implementation/configuration was found
  in tracked runtime files. CAL spreadsheet profiles are not a crawler. Historical
  ignored CLAUDE.md descriptions of a WhatsApp writer and missing schema/tests are
  stale: no tracked server/src WhatsApp writer/current mount exists. Current code
  and the canonical development standard govern this audit. Existing external
  automation clients/payloads must be inspected with the owner in APY-03/04.

## 2. Identity and proposed persistence boundary

**Canonical transaction:** existing `transactions` row, the sole financial event.
**Observation:** an external assertion about a purchase, not another expense.
**Source instance:** server-registered producer namespace, independent of card or
credential rotation. One canonical transaction can have many observations.

Choose these **proposed** relations; none exists yet:

| Relation | Required fields and constraints |
| --- | --- |
| `transaction_ingestion_sources` | BIGINT id; `source_kind` (`apple_pay`, `cal`, `legacy_api`, `file_import`); stable `instance_key`; UNIQUE(source_kind,instance_key); active flag; revision; bounded approved adapter configuration (field capabilities, card mappings, merchant aliases, amount basis). Credential hashes/bindings are separate security configuration owned by APY-03, never observation data. |
| `transaction_source_observations` | Internally generated BIGINT id (API observation_id); source_id FK; required idempotency_key; UNIQUE(source_id,idempotency_key) with exact case-sensitive equality; optional provider_reference with provider/type/scope metadata (not globally unique); nullable transaction_id INTEGER FK; immutable input evidence, payload_fingerprint, normalization_version, match values, observed_at; outcome/reason, decision_revision and accounting disposition; link/create decision snapshots. Pending observation can have null transaction_id. APY-managed cash is RESTRICT on delete, no cascading evidence loss; legacy-only exception in §3. |
| `transaction_reconciliation_events` | Append-only BIGINT id; source_id; nullable observation_id; event kind; UUID request_key; command fingerprint; decision/revision; before/after transaction references; actor kind/ID, timestamp, reason and evidence references. UNIQUE(request_key); no money rows. Receipts cover review, cancellation, deliberate provider amendments and source-configuration changes. Observation commands require observation_id; configuration events target source_id and retain approved before/after configuration revisions. |

In the **new protocol**, IDs cross JSON as decimal strings (including references
to existing transaction IDs); legacy response representations remain unchanged. Do not
coerce source IDs or BIGINT IDs through JS Number. `idempotency_key` is an opaque,
nonempty string up to 255 characters; preserve exact case/punctuation/leading zeros.
Reject surrounding whitespace in **new** protocols rather than silently trimming.
Source credentials select source_id; callers cannot impersonate a different source.
The idempotency key identifies one logical ingestion event across delivery attempts;
it is not a provider-reference requirement, candidate signature or financial identity.
The internally generated observation_id identifies the accepted observation independently
of both its retry key and its optional provider reference. A transaction_id is assigned
only when creating or attaching a canonical financial record.

| Source evidence / delivery case | Required behavior |
| --- | --- |
| Stable provider reference, verified unique within the registered source and event scope | The adapter may derive idempotency_key deterministically from that scoped reference. Retain provider_reference independently; record the verified namespace/event-kind rules. CAL may support this; do not assume it without inspecting the producer. |
| Provider reference absent | Accept provider_reference=NULL. The protocol still requires a stable producer-side idempotency_key, independent of provider data. A persisted capture UUID is one possible strategy, not an asserted Wallet capability. APY-03 verifies the actual iPhone payload and selects/verifies the safest feasible producer strategy. |
| Provider reference present but reused or uniqueness unverified | Retain it as scoped matching/audit evidence, without a global UNIQUE constraint. Use a separately stable ingestion key; derive one from a larger provider tuple only when that tuple's uniqueness is verified. Reference equality alone is not retry identity or proof of purchase identity. |
| Same source + same idempotency_key + same accepted payload | Return already_observed with the existing internally generated observation_id, current disposition and transaction_id if linked. No new observation, financial row or side effect. |
| Same source + same idempotency_key + conflicting payload | Return conflict: idempotency_key_conflict. Preserve the original observation/cash and record bounded conflict evidence. Use explicit amendment/review, not automatic overwrite or key rotation to evade the conflict. |

The producer must reuse its selected key after a lost response, across retries and
restart where promised. Missing key is rejected by the new protocol; server-generated
observation_id cannot make a lost first response retry-safe by itself. If the iPhone
cannot preserve a suitable key, APY-03 records that gap and constrains/defers automatic
retry support rather than inventing a Wallet reference or claiming exactly-once capture.
New captures require independent keys, even for equal-value purchases. Neither a
coarse signature nor a hash of merchant/date/amount is a unique observation identity.

Proposed source configuration stores explicit card mapping tuples (provider/device
identifier -> payment_source_id) and approved merchant alias groups, versioned and
audited. Bound these lists, not arbitrary executable rules. No new merchant master,
global preferences, tenant subsystem or notification engine is needed. #52/#63 are
context only; if ownership is implemented later, trusted scope must qualify these
keys then, without making either initiative an APY blocker now.

## 3. Existing external_id: keep the public contract

1. **Keep transactions.external_id and its partial UNIQUE index unchanged.** It is
   a legacy API deduplication key, not universal real-world purchase identity.
2. Source observations become authoritative **for source-aware ingestion**. A new
   Apple/CAL idempotency_key is never copied into external_id or allowed to steal
   an existing legacy ID. New APY-created rows normally have external_id=NULL.
3. Keep `/api/v1/transactions` payload, key authentication, validation behavior and
   response contract. Internally it may use shared ingestion in `legacy_insert`
   mode; it does **not** infer source_kind from an ID prefix or auto-match purchases.
   Unchanged clients continue working, including differing IDs creating differing
   rows. Opt-in APY adapters must not submit the same event to both protocols.
4. Exact legacy behavior: IDs are optional strings, max 255, no current trim or
   minimum length. Truthy IDs are prechecked; empty string skips precheck but still
   meets the non-null DB unique index. Whitespace/case remain literal. Absent ID
   permits another insertion on retry. JSON numeric positive amount, default ILS,
   date-regex validation, charge-date fallback and comma-separated tag storage are
   retained; stricter new-source validation does not silently harden the old route.
5. Preserve 201 `{success,id,external_id,created_at}`; 409 `already_exists` or
   `cancelled_record_exists`; precheck `id` and race variants (including optional
   `existing_id`) remain accepted shapes. Same ID/different payload still returns
   the old 409 rather than updating money. Dry-run stays 200, no receipt/row write,
   with would_insert/resolved/duplicate including cancelled evidence. Existing
   400 validation/FK/source errors, 422 Savings refusal and 500 errors stay distinct.
6. Mirror a legacy row into source `legacy_api/default`, idempotency_key exactly
   external_id, only where one exists; mark `legacy_unverified` and not auto-matchable.
   Missing/empty legacy IDs do not gain an invented stable event identity. Blank ID
   uniqueness remains enforced solely by the old index. Backfill never invents
   occurred_at, original source type or original observed_at (§4).
7. Legacy-only mirror lifecycle follows the legacy row: ordinary hard deletion may
   remove that mirror and release its ID, preserving existing reimport behavior.
   Retained voided rows remain reserved. Use a conditional delete guard plus explicit
   mirror cleanup; do not apply a blanket FK/receipt tombstone policy to all old rows.
   Pure legacy mirrors have no APY decision events until enrollment; their cleanup
   must not cascade/delete an APY audit event. Any such event makes deletion protected.
   Once explicitly enrolled/linked into APY, use its audit-preserving cancellation
   path; enrollment must disclose the changed deletion semantics to the owner.
8. Existing CAL clients can keep sending unchanged v1 payloads with unchanged
   behavior, but cannot gain reliable source identity or cross-source reconciliation
   by magic. APY-04 switches the actual producer, explicitly, to the source-aware
   endpoint with a server-bound `cal` namespace and exact source mapping. It may
   wrap the old payload to preserve its fields, but supplies a stable event key and
   capabilities. Atomically enroll known legacy rows by exact recorded external ID
   mapping if needed; no bulk guessed matching of history. Maintain the legacy
   external_id as-is. Repeated enrollment returns the existing mapping; conflicts
   stop for review. Pause that producer during the switch to prevent double delivery.

There is **no required removal/scoping migration of the existing unique index**.
Additive tables/indexes and explicit adapters are backward compatible. Legacy mode
must work for rows whose NUMERIC scale/metadata cannot be normalized for APY; record
unsupported matching evidence, not a new rejection of previously accepted input.

## 4. Four independent times

| Field | Contract |
| --- | --- |
| transaction_date | Existing effective/accounting DATE; immutable during automated reconciliation. Use explicit source purchase date on creation. If absent, derive from a timezone-qualified occurred_at in the source's verified business timezone (Asia/Jerusalem for the Israeli adapter). Otherwise reject new automatic purchase creation, except for the explicit owner-authorized Apple capture-date policy below. Never silently substitute server today. |
| occurred_at | Optional source actual purchase instant, stored on the observation as TIMESTAMPTZ plus original timestamp text, original offset/zone and precision (`second`, `minute`, fractional digits, or unknown). No time means NULL, not midnight. A timestamp without a resolvable timezone is retained only as non-comparable source text; no guessed offset or DST fold. |
| observed_at | Server timestamp when a successfully accepted observation is first recorded. Replays keep it. Use a separate event timestamp for later receipt/amendment, not overwrite. Legacy backfill uses migration-recording time with `evidence_origin=legacy_backfill`; original receipt time is unknown, not transactions.created_at reinterpreted as UTC. |
| charge_date | Existing bank/card charge DATE, not candidate purchase date. New Apple cash defaults it to transaction_date solely because current schema requires it; record origin `provisional_purchase_date`. CAL may replace that provisional value once with explicit charge date under §9; no claim the fallback is real settlement. |

**APY-03 owner-device clarification:** the owner's iOS 27.0 Transaction picker has
no purchase-date/time property. For this Apple Shortcut flow only, the owner
authorizes the automation to capture its execution date once in the user's local
timezone and supply that DATE as `transaction_date` when no source date exists.
This is an accounting fallback, **not provider purchase-date/time evidence**.
Keep `occurred_at` null and server `observed_at` independent. Persist/retry the
original DATE and invocation UUID unchanged; no server-receipt-date substitution.
Delayed execution across midnight or travel can yield a different accounting day
from the purchase: do not automatically shift dates or widen matching to compensate.
Use explicit owner correction/review when known; adjacent-day date-only evidence
remains review-only. See the [APY-03 guide](APY_03_APPLE_PAY_SHORTCUT.md) for the
verified picker evidence, pending runtime mapping and capture procedure. This is
a narrow owner-authorized clarification, not a change to other source contracts.

Validate actual calendar dates. Preserve explicit provider DATE even when an instant
converts to an adjacent Jerusalem date: record both and a discrepancy flag. Retrieval
uses source purchase dates ±1 calendar day to cover midnight/processing adjacent-day
display. This is a conservative product boundary, not a claim about CAL settlement
latency; charge_date never supplies that window. More distant evidence needs an
explicit review/reference lookup, not broader automatic matching.

Example: 2026-09-22T23:59:40+03:00 has transaction_date 22 September. CAL showing
23 September can match with strong compatible time/reference evidence. Do not move
the canonical accounting date to the 23rd automatically. A date-only adjacent-day
candidate is review-only. Ambiguous/nonexistent local DST times are not disambiguated
by observed_at. Preserve source precision; no invented seconds or milliseconds.

## 5. Exact money and currency basis

New protocols accept decimal **strings**, not JSON floating-point amounts. The
normalized key is `(movement_type, amount_minor, currency_code, amount_basis)`.
`amount_minor` is an exact integer string / PostgreSQL NUMERIC(precision,0), never JS
float; 84.90 ILS -> 8490. Reject extra significant precision rather than round for
matching. Direction is independent from positive magnitude; zero/negative purchase
input or reversal events use §11 rather than matching an expense to income.

For this initiative, automatic canonical creation/matching supports **a known exact
ILS accounting amount, scale 2**. This does not require settlement or CAL confirmation:
the supported ILS purchase amount from Apple creates active cash immediately when
no plausible existing canonical candidate represents it (§8).
This is the smallest supported subset consistent with current
reporting, which sums total_amount without currency conversion. Existing foreign
metadata/manual/import behavior is preserved by compatibility paths. Record optional
original purchase amount/currency independently; do not label ILS charge 129 as USD
because original_amount=35 and currency=USD in an import row.

Adapters must supply exact `accounting_amount` in ILS and indicate evidence basis;
new APY cash writes total_amount from that value. If only a foreign purchase amount
is available, retain a bounded unsupported-input diagnostic and return rejected
`accounting_amount_required`; do not invent an exchange rate or create falsely
priced immediate cash. APY-03 must disclose this unsupported subset before enabling
that device/source. This limitation does not defer supported ILS Apple purchases.

For provenance, store foreign decimal text losslessly with provider currency and
declared scale; do not apply the ILS x100 helper to zero-/three-decimal currencies.
No ISO currency registry or broad multicurrency accounting exists in this feature.
Non-ILS comparisons are disabled until a separately reviewed adapter pins currency
scale and an exact comparable accounting basis. Exchange-rate equality is never
purchase identity. High-precision legacy values remain untouched and ineligible for
automatic APY normalization where they are not exact cents.

## 6. Payment source and merchant evidence

Resolve payment source in this order, with no silent fall-through on conflicting
evidence: (1) server-bound explicit payment_source_id allowed for the producer;
(2) approved provider/device card mapping; (3) active source intersection of exact
last4 plus supplied issuer/method/owner/name evidence. Explicit/mapped conflicts
with supplied metadata are rejected. Last4 alone may resolve only if exactly one
permitted active source remains; it is never globally unique. Zero matches ->
rejected `payment_source_not_found`; multiple -> rejected
`payment_source_ambiguous`, no money write, owner fixes source mapping then retries.
Do not create a payment source automatically. A Wallet/device card number must not
be assumed to equal physical-card last4; APY-03 verifies this mapping.

Merchant normalization version 1: Unicode NFKC, remove bidi formatting controls,
trim/collapse Unicode whitespace, invariant lowercase, replace punctuation/symbol
separators with spaces, collapse again. **Keep letters, diacritics and all digits**
(including store numbers); do not strip Hebrew suffixes, transliterate, remove
generic words, perform substring/fuzzy edit distance or reuse category keywords.
Keep raw source merchant text (bounded) and canonical user description separately.

Approved alias groups map exact normalized strings to one versioned merchant key,
optionally scoped by source and payment source. WOLT and וולט אנטרפרייזס ישראל are
not automatically equivalent: an explicit approved alias makes them compatible.
Contradictory/overlapping mappings fail configuration validation. Persist approved
aliases in source configuration; never learn them from a single auto-match, user
category keyword or observation ordering. Audit approval/change with the revision;
do not retroactively relink existing observations when aliases change.

## 7. Two-stage reconciliation: executable decision rules

Only registered `apple_pay` ↔ `cal` purchase observations auto-reconcile initially.
Other source pairs, manual/domain rows and unverified legacy history are review-only.
Two **different ingestion keys** from Apple or two from CAL never auto-merge
with each other. One purchase can have at most one accepted purchase observation
per source instance; provider amendments are separate explicit commands (§10), not
second purchases under the same idempotency_key.

### Stage A: candidates, not identities

Under the commit lock (§10), retrieve by resolved payment_source_id, direction,
exact ILS amount_minor, purchase-date ±1 day, and exact/approved-alias merchant
compatibility, with an observation from the allowed opposite source kind. A row
containing only a different event from the incoming source is not an eligible
cross-source candidate; equal-value same-source purchases remain independent.
Use immutable accepted observation evidence as well as current cash
snapshot so user edits do not make a known purchase invisible. Include voided or
identity-edited matches as **conflict sentinels**, not eligible live candidates.
No evidence from received-at proximity substitutes for purchase evidence.

Candidate index: non-unique `(payment_source_id, movement_type, currency_code,
amount_minor, source_transaction_date)` on observations, then merchant/source-state
filter. A cached signature is non-unique and disposable; it is not an idempotency
key. Do not silently truncate a large candidate set and choose a winner: above a
bounded retrieval limit return ambiguous `candidate_overflow`, no automatic attach.
Initial implementation limit: 100 candidate transactions; the limit only stops
automation and never proves confidence.

Perform a second reference/conflict lookup even if coarse amount/date differs:
an exact known provider purchase reference pointing to conflicting money/card/type,
a reused source ID, voided target or protected/edited target is conflict, not an
excuse to create a new purchase. Distinct compatible records already carrying a
different observation from this source are saturated; no-time overlap with these
is review, not automatically a fresh CAL purchase.

### Stage B: lexicographic evidence, no invented numeric score

Apply in order; never break a tie by transaction ID, arrival order or newest row:

1. **Reference-confirmed:** exact, source-profile-verified common purchase reference
   (provider + reference type + value), with all hard money/card/direction checks
   compatible and no competing target. A source-local record ID or unverified
   authorization code is not such a reference. Merchant discrepancy here can be
   retained as provider text; it never creates an alias automatically.
   A reference found outside the ±1-day window requires review, not automatic
   movement of accounting dates or widening of the candidate window.
2. **Time-confirmed:** a single compatible time candidate among the coarse set.
   Each timestamp represents its actual stated precision interval; a minute value
   is `[minute, next minute]` for conservative boundary comparison, a second value
   `[second, next second]`, fractional precision accordingly. Interval intersection
   or touching is compatible. Adjacent 08:30/08:31 minute observations therefore
   compete strongly; 16:00 does not. This is a chosen quantization-boundary policy,
   not a measured source clock tolerance. Do not downgrade precise timestamps to
   minutes to make them match. No additional clock-skew threshold is assumed.
   A source with unverified/inconsistent timezone/precision cannot use this tier.
   If exactly one time-compatible candidate exists and every competitor has valid
   non-compatible time, attach it. Any undated-time competitor remains plausible
   and prevents time-only dominance. Two compatible candidates -> ambiguous.
3. **Unique date-only confirmation:** if time is absent on either source, exactly
   one live, unedited, unsaturated APY candidate, same purchase DATE, exact card,
   direction, ILS cents and approved merchant identity, with no conflict/saturated
   sentinel or pending competing observation, may attach. This is an explicit
   conservative uniqueness assumption across multiple independent fields, **not
   proof from merchant/date alone**. It supports WOLT with one Apple event and a
   later date-only CAL event. Log reason `unique_purchase_tuple`; no adjacent-day
   auto-match on this tier. If both have valid but incompatible time, do not erase
   that negative evidence by falling back to this tier.
4. Remaining plausible candidates -> ambiguous. No plausible candidates or sentinel
   -> create. If both times conclusively distinguish another purchase, no reference
   conflicts exist and no no-time competitor remains, treat it as a separate
   purchase even if the coarse signature is identical.

Exact merchant spelling does not outrank a valid alias into a forced winner. Source
arrival order and confirmation state restrict eligibility, not prove identity.
Provider references may differ or be absent. Precision/clock capability changes require a
versioned adapter configuration and regression evidence, not permanent arbitrary
weights hidden in implementation. Cases requiring wider clock skew remain review
unless a verified common reference resolves them.

## 8. Outcome and ambiguity/accounting policy

| Situation | Decision / cash effect |
| --- | --- |
| No plausible candidate/sentinel | `created`: one immediately live transaction and attached observation. |
| One strong candidate / one clearly dominant by §7 | `reconciled`: attach observation, safe enrichment only, zero new financial event. |
| Ambiguous **CAL** evidence | `ambiguous`: persist observation with transaction_id NULL and candidate IDs/reasons; no new cash. Apple cash stays active. Explicit review links A/B or creates a separate purchase. |
| Ambiguous **Apple** evidence against already-live CAL candidates | `ambiguous`: persist the Apple observation with transaction_id NULL, disposition `pending`, review_required=true and candidate IDs/reasons. Create no financial transaction. Existing candidates retain their accounting effects; review later links the observation or confirms a genuinely separate purchase. |
| Reused identity, confirmed-reference contradiction, edited/voided/protected target | `conflict`: persist bounded conflict event against known observation or a pending new observation, no cash mutation, explicit review. |
| Invalid/unsupported input, card not safely resolved | `rejected`: no accepted observation or cash; safe diagnostic, not a successful capture. |

**Accounting invariant:** reconciliation ambiguity must never create an avoidable
second financial representation of a purchase already plausibly represented by
existing canonical transactions. Apple is financially immediate when it represents
previously unrecorded activity: no plausible candidate creates live cash immediately;
a strong candidate receives evidence without new cash; multiple plausible candidates
without a safe winner leave the observation unresolved, without creating another row.
The same hold applies to a single plausible candidate with insufficient confidence.
Pending provenance does not suppress the candidates' existing Budget/Report activity.
Only explicit review may establish that an unresolved observation is a separate
purchase and create its canonical transaction exactly once. A **reconciled** purchase
has one live cash row; missing evidence is not permission to knowingly double-count.
Supported high-confidence normal captures do not ask for user approval.

APY-05 review uses expected decision_revision, current transaction fingerprints and
a UUID request key. Options for either source: link a pending observation to a chosen
live candidate, or explicitly confirm a separate purchase (create exactly once).
Recheck current candidates/revision under lock before either action. Replays of a
pending Apple observation must remain pending with no money effect. Ordinary-row
consolidation is only for independently existing historical duplicates, never a
routine consequence of ambiguous ingestion. It requires reviewed survivor/duplicate
IDs and previews the financial delta; retain all observations, void the duplicate
through §11, keep immutable prior links in audit events, then attach to the survivor.
Do not automatically copy conflicting user fields. Never consolidate linked
Loan/Savings, installment/itemized or Shopping/LEGO-associated rows through this
generic action. Those require the existing domain correction workflow; return
`protected_transaction`. Cancellation of the review UI writes nothing.

## 9. Field precedence and user-edit protection

| Field | Owner and reconciliation rule |
| --- | --- |
| description | User-owned after creation. Initial merchant-based default is allowed; CAL official merchant goes in observation evidence. Never automatically replace canonical description, even if unchanged from default. |
| normalized merchant | Derived matching evidence on each observation; raw merchant immutable. Approved alias/config revision recorded. User description edits do not rewrite source merchant history. |
| amount / movement_type | Financial identity. No automated correction of canonical total/direction. Mismatch against current **or** captured original -> conflict, never another debit through enrichment. |
| currency / original_amount / exchange_rate | Exact accounting basis immutable automatically. Source original/charge details retained separately. Unknown or changed basis -> conflict/unsupported, not silent conversion. |
| transaction_date | Accounting identity. Keep original canonical date; compatible adjacent provider date stays source evidence. User correction requires review before automatic attach. |
| occurred_at | Per-observation source evidence. Do not overwrite another source's timestamp; displayed best evidence is a projection with provenance, not a new canonical accounting date. |
| observed_at | Server-owned first recorded receipt; immutable on replay. |
| charge_date | CAL may replace only APY's marked provisional date, on a simple unedited APY purchase, once. If user ever edited it, another provider confirmed it, or domain/closed-history guard blocks it: retain source value and return enrichment conflict/review; do not overwrite. |
| category_id | Initial explicit/ordinary keyword suggestion allowed, excluding Savings roles; later reconciliation never changes it. No keyword learning on attach. |
| payment_source_id | Financial identity resolved at entry. Changed/contradictory source is conflict, no silent remap or fallback to first last4. |
| notes / tags | User-owned; no automatic replacement/union. Existing TEXT tag encoding unchanged. |
| provider/card references | Append bounded source evidence; never overwrite conflicting authoritative value or expose full card data. |
| reconciliation state | Server-derived from linked observations/conflicts; never a filter for financial activity. |
| raw metadata | Immutable allowlisted/redacted evidence, versioned amendments via audit; no arbitrary object overwrite. |

Record initial financial snapshot and charge_date origin on the creating observation.
APY-02 must add a narrowly scoped transaction UPDATE audit hook for APY-managed rows:
changed identity/charge-date fields set sticky user/unknown-writer override flags and
append change evidence. Default all non-APY writes to user/unknown; do not trust a
client-supplied "automated" flag. APY RPC carries a transaction-local context only
after server authorization. This catches edit-away-and-back as well as races; equality
with original value alone is insufficient user-intent evidence. Other user fields
are never enriched, so need no overwrite heuristic. Lock and recheck snapshot plus
flags at commit. Even a valid source match must not bypass Savings fingerprints or
Budget captured-history rules for a charge-date update; attach evidence without
unsafe enrichment and expose the conflict.

## 10. Provenance, receipts and concurrency

Retain on each observation: internally generated observation_id, source_id/kind/instance,
exact idempotency_key, optional provider_reference and its scope, nullable
transaction_id, immutable safe merchant text, original and accounting amount/currency
with basis, source transaction/charge dates, optional occurred_at/raw timezone/precision,
server observed_at, safe provider reference tuples, normalized card/money/merchant/time
evidence, normalization/config versions, payload fingerprint, outcome/reason and
decision revision. Keep candidate IDs and rule reason, not just an unexplained score.
Creating observation stores initial canonical financial snapshot and charge-date
origin; later observations do not acquire ownership of user fields.

No full raw HTTP body, headers, credentials, PAN, bank login, session/cookie or device
secret is stored or logged. Allowlisted `source_metadata` JSON has a UTF-8 encoded
limit of 8 KiB; merchant text max 512 characters, safe individual references max 255,
at most 16 reference tuples. Unknown fields rejected by new protocol; oversize input
rejected, never silently truncate an identity. Source mapping may use an approved
opaque provider identifier, never a full card number. Logs contain outcome, internal
observation ID, source kind and safe error code only. Durable conflict events store
safe changed-field names/digests, not unbounded rejected payloads.

Fingerprint the normalized **allowlisted input** with SHA-256 and a versioned,
canonical JSON serialization (sorted keys, normalized decimal strings, explicit nulls).
Exclude receipt time, retry count and transport metadata. Preserve normalized raw
merchant/source references in that fingerprint; changed evidence is not a replay.
After source authentication and bounded envelope validation, look up
`(source_id, idempotency_key)` before resolving current card/alias configuration.
Compare replay input using that
observation's original fingerprint version; derived aliases, resolved IDs and changed
configuration are not input-hash fields. Thus an alias/mapping update or an inactive
card does not turn an identical accepted retry into a new event/conflict. Revoked
credentials still fail authentication. Fresh observations use current configuration.
Never use this hash as unique purchase identity. No automatic retention purge in
v1.4.0: keep minimum identity/tombstone and decision evidence for replay/audit;
optional metadata retention/redaction is a later explicit policy, not permission
to delete financial identities. Exclude all credentials even before hashing/logging.

**One atomic PostgreSQL command** owns observation lookup, normalization revalidation,
candidate decision, cash create/safe enrich and audit receipt. Node validates/translates
but does not perform query-then-insert as separate Supabase calls. Choose
`READ COMMITTED` and acquire the transaction table first:
`LOCK TABLE public.transactions IN EXCLUSIVE MODE`. Then lock command receipt,
source configuration rows by ID, observations, and affected transaction rows by ID.
This deliberately serializes the small current single-owner ingestion workload,
including both requests that initially saw no candidate; optimize only after evidence.
This preserves ordinary SELECT readers while excluding both writers and SELECT FOR
UPDATE on transactions ([PostgreSQL lock compatibility](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-TABLES)).
It follows Savings' table-first order but deliberately uses a stronger mode: the
manual edit/delete RPCs in 015 first SELECT FOR UPDATE, then write. SHARE ROW EXCLUSIVE
alone permits that row-lock step and can form a row/table upgrade deadlock with APY.
Acquire the chosen mode before any APY receipt/configuration/row lock; never upgrade
from a weaker mode after locking a row. No network/provider calls while locked.
Keep the same table-first order for APY review, void and amendments; validate
contention and abort/retry behavior with current Savings/Budget/Loan commands.

The unique observation key is the final same-source race guard. Under lock, identical
key/fingerprint returns `already_observed` with original result, current disposition
and replay flag; no new observation/cash/domain event, no observed_at overwrite.
Lost-response retry is safe with the same key. Pending ambiguity remains pending;
replay is not a request to recompute a new match against a changed candidate set.
Same key/different fingerprint -> `conflict: idempotency_key_conflict`, unchanged cash
and original evidence, bounded conflict event. Incorrect ID reuse is never a second
purchase. Caller must correct an erroneous request or identify a genuinely distinct
source event, not rotate the key to evade conflict.

CAL updates to the same provider record (e.g. charge_date arrives later) use an
explicit `amend_observation` command with UUID request_key, expected revision, original
source key and evidence patch. Only safe enrichment fields may amend; original
purchase money/type/card/date identity cannot silently change. Append revision evidence,
apply §9, and record the receipt atomically. Same command key/different content is
conflict; duplicates replay. Source adapters must not keep changing the ingest payload
under an already-used idempotency_key and call that idempotency.

Database rollback, lock timeout or serialization/deadlock failure returns a retryable
service failure without a success receipt. Bounded server retry (at most two attempts)
uses the same key; after that caller retries with that key and backoff. Cross-source
serialization does not manufacture evidence: insufficient evidence still returns
the ambiguity policy, not a guessed reconciliation.

## 11. Void, cancellation and reversal

APY-managed **simple ordinary cash** gains an explicit `cancel_ingested_transaction`
command (future APY-02 persistence requirement). It accepts transaction ID, UUID
request_key, expected current fingerprint/revision and reason; marks all four existing
void receipt fields atomically with an APY reconciliation event, without deleting the
row or source keys. A narrow future amendment to `savings_guard_transaction` permits
this only with a valid APY cancellation receipt, no Savings history, no Loan/payment,
no installment/item/Shopping/LEGO linkage and no captured Budget-history conflict.
Preserve all existing Savings guards and immutable-old-void behavior. Do not disable
the trigger or use bare UPDATE as the API. Existing ordinary legacy deletion remains
unchanged until explicit APY enrollment; APY-managed deletion must route to this
command with a user-confirmed reason, not fall back to hard delete.

| Event | Required behavior |
| --- | --- |
| Apple cash cancelled before CAL | Retain row/key/evidence. Later matching CAL observation gets conflict `cancelled_record_exists`, no resurrection or replacement cash. May retain pending evidence for review without declaring the voided purchase active. |
| Cancel after confirmation | Void the one canonical row once; all source links remain auditable and canonical disposition becomes cancelled. No separate source-level debit/credit. |
| Replay of observation whose row is voided | `already_observed` plus disposition `cancelled`, same IDs and zero money effect; legacy v1 continues its 409 cancelled response. |
| Provider refund/reversal | Different economic event, never negative enrichment of the original. Preserve safe `related_provider_reference` evidence. Automatic refund/reversal posting is outside initial APY; return rejected `unsupported_event_kind`, no mutation. Existing manual income/refund behavior remains available. |
| Restoring a mistaken manual void | Explicit owner/domain correction only; do not unvoid an immutable row. Any approved replacement row retains a supersession audit and reserved original observation identity. No automatic restoration by source retry. |

Reference-conflict lookup and original observation evidence must still find voided
candidates. A weak candidate to a cancelled purchase is review/conflict, not proof
of a fresh transaction. Truly distinct same-source events with different timestamps
can be new purchases; cancellation is not a global blacklist of merchant/amount/day.

## 12. Domain side effects and reader contract

Shared ingestion creates **simple ordinary cash** with no items, Loan/Savings command,
installment expansion, LEGO synchronization or category keyword writes. An attach
operation performs **no cash creation** and never calls the manual controller,
`create_due_loan_payment`, Loan sync, `post_savings_event`, surplus transfer, checkout
or installment generation. Those are separate financial operations, not convenient
helpers for making a transaction exist.

Auto-reconciliation targets only simple APY purchase cash. If a user later links it
to Savings/Loan, adds items/instalments or a checkout/collection association, preserve
its observation identity but stop automatic canonical enrichment/consolidation.
An exact safe existing observation can remain attached as evidence; new conflicting
evidence requires domain-aware review. Generic review cannot reverse ledger links,
split an installment purchase across rows or erase associated records. Contract
tests must cover ordinary manual transactions as distinct records, not automatically
deduplicate them because their description/amount resembles an import.

An Apple row created for previously unrepresented activity is financially active on
commit: `voided_at IS NULL` and normal existing
movement/category/source/date values. `awaiting_confirmation`, `confirmed`,
`card_only`, `review_required` are **derived provenance metadata**, never filters
on Transactions, Budget, Dashboard, annual reports or income/expense totals.
Join provenance through a one-row-per-transaction projection (or separate detail
request); never SUM cash after joining observation rows. Ordinary uncategorized
cash remains visible; preserve the special Budget surplus/Savings exclusion and
all existing filters. Invalidation/refetch after a real change uses the current
transaction/Budget/report refresh paths. Source confirmation alone does not debit
money again or create another domain event/notification event.
An unresolved Apple observation against plausible existing candidates is provenance
only, not an additional transaction. Keep existing candidate totals unchanged; do
not create or sum a synthetic pending cash row to display the observation.

## 13. Service and API outcome contract

Proposed Node boundary: `server/services/transactionIngestionService.js` with
`ingestObservation`, `amendObservation`, `resolveObservation`,
`cancelIngestedTransaction` and the isolated legacy compatibility adapter. Proposed
privileged RPCs of the corresponding snake_case names implement the atomic commands.
These names are **planned**, not functions discovered in the audit. APY-02 adds no
Shortcut UI/credential yet; APY-03 mounts a new source-aware
`POST /api/ingestion/observations` endpoint behind scoped source authentication.
Source kind/instance are selected server-side. APY-04 switches CAL explicitly.
Existing `/api/v1/transactions` and import routes keep old result shapes in legacy mode.

New response envelope: `{ outcome, original_outcome, observation_id, transaction_id,
disposition, review_required, reason_code, replayed, decision_revision }`.
`original_outcome` is set on replay and otherwise null. IDs are strings or
null. Disposition: `created`, `attached`, `pending` or
`cancelled`. A source caller gets only its own safe result; detailed competing IDs
and financial records are exposed only to authenticated owner review, not Shortcut
credentials. Errors never echo arbitrary input or secrets.

| Outcome | New API HTTP | IDs / review / retry |
| --- | --- | --- |
| created | 201 | Both IDs; live cash; no review. Retry same key safe. |
| reconciled | 200 | Both IDs; zero new cash; review false unless enrichment conflict is separately flagged. |
| already_observed | 200 | Original observation ID and linked transaction ID if any; current disposition and original outcome included; review stays as recorded. Retry safe, no recomputation. |
| ambiguous | 202 | Observation ID; transaction_id null for both Apple and CAL, disposition pending, review true, no new cash. Retrying does not resolve it or create cash. |
| conflict | 409 | Known/pending observation ID when persisted, transaction ID only when safe and known; review true. Replay same input cannot cure a conflict; explicit amendment/review required. |
| rejected | 400 invalid syntax; 422 unsupported/unsafe mapping | No accepted observation/cash IDs; caller fixes input/mapping before retry. Auth 401/403, rate limit 429 and body-size 413 remain distinct. |
| transient service failure | 503 | No claimed committed result; same-key retry safe even if delivery status uncertain. |

Owner review endpoints (APY-05) require user auth and current revision/fingerprint;
source-only credentials cannot select arbitrary canonical targets, cancel cash,
approve aliases, change card mappings or resolve ambiguity. No public direct writes
to observation/event tables; revoke PUBLIC/anon/authenticated mutations and expose
only required service-role RPCs. APY-02's integration tests must prove these grants
on the final schema; do not infer effective grants from one old migration.

## 14. Worked decisions and APY-02 test vectors

All values below are synthetic examples, not evidence from an iPhone/provider.

| Case | Decision and invariant |
| --- | --- |
| WOLT 84.90 ILS, Apple A at 19:40+03:00; later CAL B, Hebrew merchant, date-only, charge date later | With an approved alias, same resolved card, exact 8490 ILS cents, same purchase date and one eligible candidate: unique_purchase_tuple reconciles B to A; one cash row. CAL replaces only provisional charge_date. Without alias/ref evidence, no automatic assertion that texts are the same merchant. |
| Apple A at 08:30, Apple B at 16:00, AROMA 24 ILS, same card/date | Distinct source keys create two live purchases (4800 cents total), not one globally unique signature. |
| Above plus CAL C at 08:31, **minute precision**, same card/date/money/merchant | Only A's minute-precision interval touches C; B's does not. A wins time tier. No third financial row. Precise seconds with a real 60-second gap would instead require verified reference/skew evidence or review; do not fabricate minute precision. |
| Above plus CAL C with no time | Two plausible candidates: C pending/ambiguous, transaction_id null; both Apple rows retained and totals remain 4800 cents. Owner later links C to A/B or creates a separate purchase explicitly. |
| One date-only source, one eligible same-date candidate | Exact source/card/ILS cents/type/merchant and absence of competitors permit tier 3; time is optional. Adjacent-date-only evidence remains review. |
| Apple 23:59:40+03:00 on Sept 22, CAL Sept 23 with matching common provider purchase reference | Attach; canonical transaction_date remains Sept 22, provider Sept 23 retained. Charge date remains independent. No date-only auto-merge over midnight. |
| Same Apple event A replayed after lost success, including concurrent request | UNIQUE(source_id,A) plus atomic receipt returns same observation/transaction; no second cash, no Savings/Loan/keyword effects. |
| A delivered with changed 84.91 amount | idempotency_key_conflict conflict, original observation/cash unchanged. A legitimate correction requires explicit command, not a new random retry key. |
| Concurrent Apple A / CAL B, same proven purchase | Table-first serialization: winner creates, loser sees committed evidence and attaches; one cash row. Insufficient evidence follows ambiguity, never a race-based blind insert/merge. |
| User changes category/description then CAL confirms | Attach provider evidence; category and description remain exactly user values. |
| User changes amount/card/date before CAL confirms original evidence | Original snapshot/reference finds the record; identity-edited conflict, no automatic restore or fresh duplicate debit. |
| User changes charge_date away and back before CAL | Sticky override blocks CAL overwrite even if value again equals provisional date. |
| Apple cash voided, CAL observes original | Conflict/cancelled evidence; zero resurrection and retained IDs. A retry of Apple A reports cancelled disposition. |
| CAL-only online purchase, no candidate | Create ordinary live cash. CAL coverage stays operational. |
| CAL-first two AROMA cash rows, 24 ILS each, later ambiguous Apple A | Persist A as pending/review_required with transaction_id null. Keep two rows and 4800 cents in Budget/Reports; no third 2400-cent row. Same-key retries/concurrent deliveries remain zero cash effects. Review links A to either row, or explicitly confirms a separate purchase and creates one 2400-cent row exactly once. |
| Apple with no plausible existing candidate | Create one live canonical transaction immediately, irrespective of absent CAL confirmation or absent provider_reference when a valid ingestion key is present. |
| CAL-first one sufficiently strong candidate, later Apple A | Attach A to the existing canonical row; no new row or Budget/Report amount. |
| Apple has no provider reference, capture uses verified durable key K | Store provider_reference NULL and internally generated observation_id; repeat K with identical input returns that observation. No provider ID is fabricated. |
| Two genuine events have the same unverified/non-unique provider reference but independent keys | Preserve two observations; the reference is non-unique evidence. Apply candidate rules without treating reference equality as replay or automatic merge. |
| Two active payment sources share last4 | Reject ambiguous mapping, no guessing. Explicit approved mapping permits retry. |
| Foreign USD 35 with only estimated FX but no exact ILS charge | Unsupported automatic accounting; reject accounting_amount_required, no invented conversion. Existing legacy/manual foreign flow unchanged. |
| Legacy external_id K replay / null / empty string | Existing K -> old 409; absent ID may insert again; empty string still subject to original unique index even though precheck is skipped. No stricter APY normalization imposed on legacy input. |
| Import/Loan/Savings/itemized/checkout row resembles Apple | Not automatic APY identity. Review/domain handling preserves records; attaching evidence cannot replay protected side effects. |

These vectors are requirements for future behavioral tests, not tests of a feature
that exists now. APY-02 should use real disposable PostgreSQL for concurrent
same-source/cross-source cases, edit/cancel races, grant enforcement, full rollback,
duplicate receipt conflicts, full final Savings schema and legacy index preservation.
Mandatory behavioral assertions: CAL-first ambiguous Apple ingestion and its retries
leave canonical row count, Budget actuals and report totals unchanged; the unresolved
observation remains queryable for review. Link review adds no cash; separate-purchase
review adds exactly one row with a replay-safe receipt. No-candidate Apple creation
remains immediate. Cover absent/stable/non-unique provider references independently
from same-key replay/conflict tests, including concurrent requests.

## 15. Migration, compatibility and implementation sequence

APY-02 next: create the three additive relations and non-unique candidate indexes;
implement private atomic ingestion/decision commands and receipt tests before
exposing adapters. Keep existing transaction columns/readers unchanged except the
narrow APY-managed audit/cancel guards. Add no new provenance columns to transactions
that silently change Savings fingerprints. No migration is included in APY-01.

1. Reconfirm current main/schema, all effective writer/reader grants and version line.
   Build from complete final 035 schema, not a minimal external-API/028 fixture.
2. Add schema/RPCs behind unmounted source-aware adapters. Backfill only exact
   nonempty legacy external IDs as unverified mirrors with explicit backfill provenance;
   preserve all cash IDs, totals, dates, voids, keys and domain links. Mirror creation
   plus legacy INSERT must eventually be atomic under the legacy service adapter.
3. Verify old payload/201/409/dry-run/error compatibility before switching the v1
   handler internally. Preserve numeric acceptance and missing-ID behavior in legacy
   mode. Do not make the existing external key a source-aware credential by inference.
4. Add APY cancellation/audit guards before allowing any APY financial rows. Test
   deadlocks/rollback with existing Savings/Loan/Budget commands. With only legacy
   callers active, ordinary delete behavior must remain unchanged.
5. APY-03 verifies actual iPhone fields and reference availability, chooses and proves
   the safest feasible producer-side idempotency strategy and scope/rotation/rate
   policy, then opts in supported **ILS simple purchase** automation. Confirm
   precise versus minute time, offset availability, card/device mapping, merchant and
   amount availability. No repository fact proves Wallet exposes any of these.
6. APY-04 inspects actual CAL automation payloads/source IDs and source capabilities;
   explicitly transitions producer to new protocol, including existing-ID enrollment
   and no simultaneous old/new submissions. Spreadsheet source-aware mode uses a
   stable upload session plus row ordinal when no provider key exists, reused on save
   retry; file row identity is not cross-file purchase identity. A new upload is a new
   source event and requires matching/review, not hash-based automatic suppression.
   Preserve legacy import defaults/response and category learning only for newly
   created legacy rows; APY attachment must never relearn keywords or repost cash.
7. APY-05 implements the already-defined review commands. APY-06 validates the normal
   local frontend/backend plus separately recorded owner iPhone acceptance, rechecks
   compatibility and candidate version and prepares rollout/recovery guidance.

Rollback before opt-in can disable adapters and retain additive unused objects.
After source-aware cash exists, do **not** roll back to code that hard-deletes it or
drop receipts/provenance: disable new ingestion, retain audited readers/cancellation,
and forward-fix or restore a reviewed full backup consistently. Rehearse interruption,
partial backfill and restart on disposable data. Production execution is separately
authorized; architecture approval does not authorize migrations or secrets changes.

**Remaining evidence, not undecided core architecture:** actual iPhone payload,
optional provider-reference availability and safest feasible producer retry strategy;
CAL producer location and scoped ID/time/reference
semantics; real alias/card mappings; whether these sources provide exact ILS charge
amount. Unsupported fields use the deterministic fallback/refusal/review above.
No actual iPhone, CAL crawler, authenticated end-to-end or production test is claimed.

## 16. SemVer and APY-01 handoff gate

The initiative can remain **backward compatible / Minor**, currently proposed
**v1.4.0** after published v1.3.1: existing routes, payloads, responses, external_id
index and ordinary legacy lifecycle remain compatible; new protocols are opt-in.
Architectural size alone is not Major. If implementation instead changes old API
responses/identity semantics or silently converts/deletes historical cash, reject
that implementation or reassess the specific externally observable break. Reconfirm
the published/prepared line at APY-06; do not reserve v1.4.0 blindly.

- Release impact: **No for APY-01** — design/audit documentation only, no runtime change.
- SemVer impact: **None independently**; planned APY product initiative is **Minor**.
- Candidate release: **Not applicable independently**; grouped product candidate
  remains proposed **v1.4.0**, subject to APY-06 revalidation.
- Grouping: [#78](https://github.com/OzAvrahami/finance-tracker/issues/78) coordinates
  APY-01–06 (#79–84); no per-child bump/release or milestone.
- CHANGELOG status: **Not applicable to this design-only change**, unchanged.
  Release-relevant APY-02+ implementation updates Unreleased.
- Version-bump status: **Not applicable independently**; grouped synchronization
  deferred to owner-authorized coordinated preparation. All seven fields stay 1.3.1.
- Publication status: **Out of scope**.
- Owner verification / acceptance: **Pending review of this contract**. #79 stays
  Open / Verify / P1 until owner acceptance and required commit/push are confirmed;
  deployment is Not applicable to this documentation-only issue.

Verification of this handoff: source/schema/test audit, worked decision walkthroughs,
local Markdown links, strict UTF-8, unchanged runtime/migration/version/index evidence
and diff whitespace checks. APY runtime/device behavior requires implementation and
future verification; this document is not evidence of a deployed feature.
All 33 local document links resolve; all 380 pre-existing worktree-file hashes match
the initial snapshot; all seven version fields remain 1.3.1. Existing test sources
were inspected, not rerun. No application, database, browser or device suite was run
for this documentation-only change, and no migration was applied.
