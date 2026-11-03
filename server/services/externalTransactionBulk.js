'use strict';

// Extend the established POST /api/v1/transactions single-item contract, not a new
// public protocol. Each row uses the same controller path, including the existing
// CAL/APY guard and historical external_id reservations.
const LIMITS = Object.freeze({ maxItems: 50, maxBytes: 1024 * 1024, maxItemBytes: 16 * 1024 });
const statusError = (status, error) => ({ status, body: { error } });
const BULK_FIELDS = new Set([
  'type', 'amount', 'date', 'description', 'charge_date', 'category_id',
  'payment_source_id', 'payment_source_name', 'currency', 'original_amount',
  'exchange_rate', 'notes', 'tags', 'external_id', 'dry_run', 'status',
  'installment_number', 'installment_count', 'cal_contract',
]);

function validateEnvelope(body, rawBytes) {
  if (!body || Array.isArray(body) || typeof body !== 'object'
      || Object.keys(body).length !== 1 || !Array.isArray(body.items)) {
    return statusError(400, 'invalid_bulk_envelope');
  }
  if (body.items.length < 1 || body.items.length > LIMITS.maxItems) {
    return statusError(400, 'invalid_item_count');
  }
  if ((rawBytes ?? Buffer.byteLength(JSON.stringify(body))) > LIMITS.maxBytes) {
    return statusError(413, 'request_too_large');
  }
  return null;
}

function captureResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function validateBulkItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return 'invalid_item';
  if (Buffer.byteLength(JSON.stringify(item)) > LIMITS.maxItemBytes) return 'item_too_large';
  if (Object.keys(item).some(field => !BULK_FIELDS.has(field))) return 'unsupported_field';
  // Durable identities are mandatory for batches. They remain optional on the
  // unchanged single-item API for backwards compatibility.
  if (typeof item.external_id !== 'string' || !item.external_id.length
      || item.external_id.length > 255 || item.external_id.trim() !== item.external_id) return 'external_id_required';
  if (item.status !== undefined && item.status !== 'completed') return 'transaction_not_completed';
  if (!Number.isFinite(item.amount) || item.amount <= 0 || !/^\d+(?:\.\d{1,2})?$/.test(String(item.amount))) {
    return 'invalid_amount';
  }
  if (item.payment_source_id == null && item.payment_source_name == null) return 'payment_source_required';
  if (item.payment_source_id != null && item.payment_source_name != null) return 'ambiguous_payment_source';
  const a = item.installment_number, b = item.installment_count;
  if ((a == null) !== (b == null) || (a != null && (!Number.isInteger(a) || !Number.isInteger(b)
      || a < 1 || b < 2 || a > b || b > 999))) return 'invalid_installment';
  if (a != null && item.type !== 'expense') return 'unsupported_installment_type';
  // An account explicitly routed to the existing CAL v1 adapter still has that
  // adapter's supported event boundary. Do not silently bypass it.
  return null;
}

function classify(status, body) {
  if (body?.dry_run === true) return { result: 'previewed' };
  if (status === 409 && body?.error === 'already_exists') return { result: 'existing' };
  if (status === 409 && body?.error === 'cancelled_record_exists') return { result: 'failed', reason: 'cancelled_record_exists' };
  if (status === 201 && body?.financial_posted !== false) return { result: 'created' };
  if (status >= 200 && status < 300 && body?.financial_posted === true) {
    return { result: body?.outcome === 'reconciled' ? 'reconciled' : 'existing' };
  }
  if (status === 202 || body?.review_required === true || (status >= 200 && status < 300)) {
    return { result: 'review_required', reason: body?.reason_code || body?.error || 'not_financially_posted' };
  }
  const reason = body?.error || body?.reason_code || 'transaction_rejected';
  // 500/503 may occur after an uncertain database command. Stop rather than
  // reporting non-posting as a fact or sending later rows after a lost ACK.
  if (status >= 500 && !['general_adapter_required', 'cal_adapter_required'].includes(reason)) {
    return { result: 'uncertain', reason };
  }
  return { result: 'failed', reason };
}

function emptySummary(total) {
  return { total, succeeded: 0, failed: 0, created: 0, already_exists: 0, reconciled: 0,
    review_required: 0, previewed: 0, uncertain: 0, not_attempted: 0, errors: [] };
}

function add(summary, index, externalId, outcome) {
  switch (outcome.result) {
    case 'created': summary.created++; summary.succeeded++; break;
    case 'existing': summary.already_exists++; summary.succeeded++; break;
    case 'reconciled': summary.reconciled++; summary.succeeded++; break;
    case 'previewed': summary.previewed++; break;
    case 'review_required': summary.review_required++; break;
    case 'uncertain': summary.uncertain++; break;
    case 'not_attempted': summary.not_attempted++; break;
    default: summary.failed++;
  }
  if (!['created', 'existing', 'reconciled', 'previewed'].includes(outcome.result)) {
    summary.errors.push({ index, external_id: externalId,
      reason: outcome.reason || outcome.result,
      status: outcome.result,
      retryable: ['uncertain', 'not_attempted'].includes(outcome.result) });
  }
}

async function runBulk(req, res, handleSingle) {
  const bad = validateEnvelope(req.body, req.transactionBodyBytes);
  if (bad) return res.status(bad.status).json(bad.body);

  const items = req.body.items;
  const summary = emptySummary(items.length);
  const seen = new Set();
  let interrupted = false;
  for (const [index, item] of items.entries()) {
    const externalId = typeof item?.external_id === 'string' ? item.external_id : null;
    if (interrupted) {
      add(summary, index, externalId, { result: 'not_attempted', reason: 'batch_interrupted' });
      continue;
    }
    const reason = validateBulkItem(item);
    if (reason) { add(summary, index, externalId, { result: 'failed', reason }); continue; }
    if (seen.has(externalId)) { add(summary, index, externalId, { result: 'failed', reason: 'duplicate_in_batch' }); continue; }
    seen.add(externalId);

    // status is an optional producer fact, never a legacy transaction column.
    const { status: _sourceStatus, ...transaction } = item;
    const one = captureResponse();
    try {
      await handleSingle({ ...req, body: transaction }, one);
      const outcome = classify(one.statusCode, one.body);
      add(summary, index, externalId, outcome);
      if (outcome.result === 'uncertain') interrupted = true;
    } catch {
      add(summary, index, externalId, { result: 'uncertain', reason: 'persistence_result_unknown' });
      interrupted = true;
    }
  }
  return res.status(200).json(summary);
}

module.exports = { LIMITS, validateEnvelope, validateBulkItem, classify, runBulk };
