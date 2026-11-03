'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LIMITS, validateBulkItem, runBulk } = require('../services/externalTransactionBulk');

const row = (n, changes = {}) => ({ type: 'expense', amount: 12.5,
  date: '2026-10-01', description: 'Store', payment_source_id: 6,
  external_id: `source-account-${n}`, ...changes });
const response = () => ({ statusCode: 200, body: null,
  status(value) { this.statusCode = value; return this; },
  json(value) { this.body = value; return this; } });
const submit = async (items, single) => {
  const res = response();
  await runBulk({ body: { items } }, res, single);
  return res;
};
const created = async (_req, res) => res.status(201).json({ success: true, id: 42 });

test('one and ten legacy-shaped transactions are accepted and counted', async () => {
  const one = await submit([row(0)], created);
  assert.equal(one.statusCode, 200);
  assert.equal(one.body.total, 1);
  assert.equal(one.body.succeeded, 1);
  assert.equal(one.body.created, 1);
  assert.deepEqual(one.body.errors, []);

  const ten = await submit(Array.from({ length: 10 }, (_, i) => row(i)), created);
  assert.deepEqual([ten.body.total, ten.body.succeeded, ten.body.failed, ten.body.created], [10, 10, 0, 10]);
});

test('maximum batch size of fifty succeeds, fifty-one rejects before processing', async () => {
  let calls = 0;
  const single = async (_req, res) => { calls++; return created(_req, res); };
  const result = await submit(Array.from({ length: LIMITS.maxItems }, (_, i) => row(i)), single);
  assert.equal(result.body.created, 50);
  const oversized = await submit(Array.from({ length: 51 }, (_, i) => row(i)), single);
  assert.equal(oversized.statusCode, 400);
  assert.equal(oversized.body.error, 'invalid_item_count');
  assert.equal(calls, 50);
});

test('eight succeeded and two failed produce only two error entries', async () => {
  const items = Array.from({ length: 10 }, (_, i) => row(i));
  const r = await submit(items, async (req, res) => req.body.external_id.endsWith('3') || req.body.external_id.endsWith('6')
    ? res.status(400).json({ error: 'validation_error' }) : created(req, res));
  assert.deepEqual([r.body.total, r.body.succeeded, r.body.failed], [10, 8, 2]);
  assert.deepEqual(r.body.errors.map(e => e.external_id), ['source-account-3', 'source-account-6']);
});

test('exact legacy input, including FX and installments, passes unmodified except optional status', async () => {
  const input = row(1, { status: 'completed', amount: 275.82, currency: 'USD', original_amount: 87,
    exchange_rate: 3.170344, installment_number: 2, installment_count: 6,
    charge_date: '2026-11-02', category_id: 2, notes: 'test', tags: ['shopping'] });
  let forwarded;
  const result = await submit([input], async (req, res) => { forwarded = req.body; return created(req, res); });
  assert.equal(result.body.created, 1);
  const { status, ...expected } = input;
  assert.deepEqual(forwarded, expected);
});

test('pending and incomplete events never become inserted transactions', async () => {
  let count = 0;
  const result = await submit([row(1, { status: 'pending' }), row(2)], async (req, res) => {
    count++; return created(req, res);
  });
  assert.equal(count, 1);
  assert.equal(result.body.failed, 1);
  assert.equal(result.body.created, 1);
  assert.equal(result.body.errors[0].reason, 'transaction_not_completed');
});

test('stable external_id is mandatory in bulk and same-batch duplicates do not write twice', async () => {
  let calls = 0;
  const r = await submit([row(1, { external_id: undefined }), row(2), row(3, { external_id: 'source-account-2' })], async (req, res) => {
    calls++; return created(req, res);
  });
  assert.equal(calls, 1);
  assert.deepEqual([r.body.succeeded, r.body.failed], [1, 2]);
  assert.deepEqual(r.body.errors.map(e => e.reason), ['external_id_required', 'duplicate_in_batch']);
});

test('idempotent already-existing ID counts as handled, not newly created', async () => {
  const r = await submit([row(1), row(2)], async (req, res) => req.body.external_id.endsWith('1')
    ? res.status(409).json({ error: 'already_exists' }) : created(req, res));
  assert.deepEqual([r.body.succeeded, r.body.created, r.body.already_exists, r.body.failed], [2, 1, 1, 0]);
});

test('cancelled IDs never count as successful duplicates', async () => {
  const r = await submit([row(1)], async (_req, res) => res.status(409).json({ error: 'cancelled_record_exists' }));
  assert.equal(r.body.failed, 1);
  assert.equal(r.body.succeeded, 0);
});

test('review-required evidence is not counted as financial success', async () => {
  const r = await submit([row(1)], async (_req, res) => res.status(202).json({ review_required: true, reason_code: 'ambiguous' }));
  assert.equal(r.body.review_required, 1);
  assert.equal(r.body.succeeded, 0);
  assert.equal(r.body.errors[0].reason, 'ambiguous');
});

test('timeout/uncertain server state interrupts and marks untouched inputs for safe retry', async () => {
  let calls = 0;
  const r = await submit([row(1), row(2), row(3)], async (_req, res) => {
    calls++;
    return res.status(503).json({ error: 'cal_unavailable' });
  });
  assert.equal(calls, 1);
  assert.deepEqual([r.body.uncertain, r.body.not_attempted, r.body.failed], [1, 2, 0]);
  assert.equal(r.body.errors.length, 3);
  assert.equal(r.body.errors[0].retryable, true);
});

test('configuration failure is a definite item failure; later rows still run', async () => {
  const r = await submit([row(1), row(2)], async (req, res) => req.body.external_id.endsWith('1')
    ? res.status(503).json({ error: 'cal_adapter_required' }) : created(req, res));
  assert.deepEqual([r.body.failed, r.body.created], [1, 1]);
});

test('invalid installments and ambiguous payment source cannot be silently inserted', () => {
  for (const value of [
    row(1, { installment_number: 2 }),
    row(1, { installment_number: 3, installment_count: 2 }),
    row(1, { installment_number: 1, installment_count: 1 }),
    row(1, { payment_source_name: 'Cal 2755' }),
    row(1, { payment_source_id: null }),
  ]) assert.ok(validateBulkItem(value));
  assert.equal(validateBulkItem(row(1, { installment_number: 2, installment_count: 6 })), null);
  assert.equal(validateBulkItem(row(1, { original_currency: 'USD' })), 'unsupported_field');
});

test('invalid envelopes are rejected and have no side effects', async () => {
  for (const body of [{}, { items: [] }, { items: [row(1)], account: 'x' }, { items: 'x' }]) {
    let invoked = false;
    const res = response();
    await runBulk({ body }, res, async () => { invoked = true; });
    assert.equal(res.statusCode, 400);
    assert.equal(invoked, false);
  }
});

test('dry-run is tracked without pretending financial insertion', async () => {
  const r = await submit([row(1, { dry_run: true })], async (_req, res) => res.status(200).json({ dry_run: true, would_insert: {} }));
  assert.equal(r.body.previewed, 1);
  assert.equal(r.body.succeeded, 0);
  assert.equal(r.body.failed, 0);
});
