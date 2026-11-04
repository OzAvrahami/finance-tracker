const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadControllerWithFake, createMockResponse } = require('./helpers/fakeSupabase');

test('a held manual draft never writes items, LEGO or scheduled siblings', async () => {
  const calls = [];
  const db = { unifiedIngestion: true, from: () => assert.fail('held draft must not run domain writes'),
    rpc: async (name, args) => { calls.push({ name, args }); return { data: { outcome: 'ambiguous', observation_id: '12', transaction_id: null } }; } };
  const controller = loadControllerWithFake('../../controllers/transactionController', db);
  const body = { transaction: { description: 'Synthetic purchase', movement_type: 'expense', total_amount: 300,
    transaction_date: '2026-11-04', payment_source_id: 6, installment_count: 3 }, items: [] };
  const res = createMockResponse(); await controller.createTransaction({ body }, res);
  assert.equal(res.statusCode, 202); assert.equal(res.body.review_required, true);
  assert.equal(calls.length, 1); assert.equal(calls[0].name, 'ingest_owned_transaction');
  assert.deepEqual(calls[0].args.p_evidence, body); assert.equal(calls[0].args.p_row.total_amount, 100);
});

test('CSV preserves preview identity and reports replay/conflict/cancellation without keyword or cash insertion', async () => {
  const calls = [], results = [
    { outcome: 'already_observed', transaction_id: '1', replayed: true },
    { outcome: 'conflict', transaction_id: '1', reason_code: 'idempotency_key_conflict' },
    { outcome: 'already_observed', transaction_id: '2', replayed: true, disposition: 'cancelled' },
  ];
  const db = { from: () => assert.fail('no direct import writes or keyword updates for these outcomes'),
    rpc: async (name, args) => { calls.push({ name, args }); return { data: results.shift() }; } };
  const controller = loadControllerWithFake('../../controllers/importController', db), res = createMockResponse();
  const rows = [0, 1, 2].map(i => ({ id: `csv:${'a'.repeat(64)}:${i}`, description: 'Synthetic',
    movement_type: 'expense', total_amount: 50, transaction_date: '2026-11-04', currency: 'ILS' }));
  await controller.saveImport({ body: { payment_source_id: 6, transactions: rows } }, res);
  assert.equal(res.body.success, false); assert.equal(res.body.count, 1); assert.equal(res.body.review_required, 2);
  assert.deepEqual(calls.map(c => c.args.p_key), rows.map(r => r.id));
  assert.ok(calls.every(c => c.name === 'ingest_owned_transaction' && c.args.p_channel === 'csv'));
});
