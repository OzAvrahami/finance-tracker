# External transactions: legacy-shaped bulk endpoint

`POST /api/v1/transactions` with the existing `Authorization: Bearer <EXTERNAL_API_KEY>`.

A **single transaction** remains the established v1 object, unchanged. To submit
more than one transaction in one HTTP request, wrap the same objects in `items`:

```json
{
  "items": [
    {
      "type": "expense", "amount": 39.9, "date": "2026-10-10",
      "charge_date": "2026-10-11", "description": "Example Supermarket",
      "payment_source_id": 6, "currency": "ILS",
      "external_id": "cal:card-2755:12345"
    },
    {
      "type": "expense", "amount": 275.82, "date": "2026-10-11",
      "charge_date": "2026-10-12", "description": "Example USD Purchase",
      "payment_source_id": 6, "currency": "USD", "original_amount": 87,
      "external_id": "cal:card-2755:12346"
    },
    {
      "type": "expense", "amount": 727.39, "date": "2026-10-12",
      "charge_date": "2026-11-12", "description": "Example Installment",
      "payment_source_id": 3, "currency": "ILS",
      "installment_number": 2, "installment_count": 36,
      "external_id": "cal:card-2002:purchase-123:inst:2"
    }
  ]
}
```

Values are **synthetic**. The second item uses the established v1 convention:
`amount` is the charged accounting amount and `original_amount` is the original
foreign amount; `currency` is the source transaction currency. Do **not** invent an
`exchange_rate` where the provider did not supply one. Currency semantics are
unchanged from the existing single-item API; this bulk wrapper performs no
conversion. `amount`, `original_amount` and `exchange_rate` retain the existing
v1 **JSON number** type, not a new decimal-string contract.

**Exactly the existing v1 fields:** `type`, `amount`, `date`, `description`,
`charge_date`, `category_id`, `payment_source_id`, `payment_source_name`,
`currency`, `original_amount`, `exchange_rate`, `notes`, `tags`, `external_id`,
`dry_run`; optionally `installment_number` and `installment_count`. The latter
are both required if either is supplied, with `1 <= number <= count`,
`2 <= count <= 999`, expense only. They describe the **one observed installment**;
no future installments or whole-purchase cash are generated. Its `external_id`
must be independently stable for that ordinal: a shared series/provider ID alone
is **not** sufficient.

For bulk only, `external_id` and a payment source selector are required. Use
**either** `payment_source_id` (preferred) **or** the existing uniquely resolved
`payment_source_name`. Never supply both in the same bulk item. An optional
`status` field may be `completed`; pending items are rejected without insertion.

Batch size: **1–50 items**; maximum 1 MiB total and 16 KiB per item. Batches
are processed sequentially by the existing single-item handler, so they do not
bypass API-key authentication, durable source identities, database ID uniqueness,
generic posting guards or reconciliation logic. Migration 054 is required by the unified implementation. This is **not** an atomic all-or-nothing
batch: partial success is possible. Retry only with the same `external_id` and
frozen transaction content; a replay of an already-posted ID is safe. A 409
`already_exists` is a successful idempotent replay for the bulk summary; a
cancelled external ID is not.

## Bulk result

```json
{
  "total": 10,
  "succeeded": 8,
  "failed": 2,
  "created": 7,
  "already_exists": 1,
  "reconciled": 0,
  "review_required": 0,
  "previewed": 0,
  "uncertain": 0,
  "not_attempted": 0,
  "errors": [
    { "index": 3, "external_id": "txn-4", "reason": "validation_error", "status": "failed", "retryable": false },
    { "index": 8, "external_id": "txn-9", "reason": "payment_source_not_found", "status": "failed", "retryable": false }
  ]
}
```

The top-level HTTP status is 200 for a valid batch envelope; **always read the
summary**. `succeeded` counts newly posted, reconciled, and already-existing
transactions. `failed` is definite rejection. `review_required` means accepted
source evidence needing owner resolution but not newly posted; `uncertain` means
persistence may have committed; `not_attempted` means the batch stopped before
sending an item. Those categories are separate from definite failure. The
`errors` array includes all non-successful, non-preview items and carries the
original array index and external ID. A `dry_run` item contributes to
`previewed`, never to financial success. A timeout or ambiguous server failure
stops dispatch of remaining items for safe retry.

## Unified implementation boundary

The public single/Bulk shapes are preserved. Both now use the shared internal
pipeline described in [Unified transaction ingestion](UNIFIED_TRANSACTION_INGESTION.md).
CAL-specific routing and registered general-envelope intake are retired. There
are no per-card API registrations. Historical receipts remain reserved.

Installment counters identify only the observed ordinal; they do not prove its
relationship to a whole purchase. Such evidence remains pending until explicit
review. Refunds, uncertain bank events and ambiguous cross-source observations
also remain unposted. A review outcome is not an ingestion failure or permission
to retry with a new ID. This local implementation does not authorize migration,
deployment, new bank delivery or FlowLink activation.

## Classified bank credits (migration 057)

The same single/Bulk endpoint accepts `type: expense|income|refund`, with a
positive, exact-cent accounting `amount`. Ordinary income and refunds can post
only to an active `bank_account` source, with a stable `external_id`. An
authenticated producer must explicitly classify the movement; do not guess that
an unknown credit is income. This is not an income/refund bypass for cards, checks
or transfers. Existing identity, duplicate, reconciliation, installment and
source-resolution guards remain in force. CSV ingestion is unchanged.

An ILS refund is a separate positive bank movement. The immutable request retains
its positive amount and `type: refund`. Its ledger row is explicitly marked
`bank_movement: refund`, with `movement_type: expense` and negative
`total_amount` (contra-expense). Existing signed expense totals therefore net
the refund against spending; ordinary-income totals do not increase. The
transaction list displays this marked row as a refund credit. No artificial debit
link is required. This does not edit the original debit or reconcile any manual
amount discrepancy. Foreign-currency refunds remain unsupported in this increment.

Example synthetic item (use an actually approved active bank source):

```json
{"type":"refund","amount":12.34,"date":"2026-11-07","description":"Invented reversal","payment_source_id":14,"currency":"ILS","external_id":"bank:approved-account:2026-11-07:example"}
```

The bulk response format, partial-success semantics and limits are unchanged.
Review-required observations are not posted cash. Exact replay preserves the
original recorded outcome, including observations held before this migration;
changed content under the same key conflicts. Never change a key to escape a hold.
