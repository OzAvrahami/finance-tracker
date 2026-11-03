'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadControllerWithFake, createMockResponse } = require('./helpers/fakeSupabase');

function fakeDatabase() {
  const state = { inserted: [], ids: new Map() };
  return { state,
    from(table) {
      // The real legacy controller looks up category keywords before inserting.
      // An empty category list is valid; don't mistake this expected query
      // for an unexpected transaction-table access.
      if (table === 'categories') {
        return { select: async () => ({ data: [], error: null }) };
      }
      assert.equal(table, 'transactions');
      return {
        select() { return { eq(field, value) {
          assert.equal(field, 'external_id');
          return { maybeSingle: async () => ({ data: state.ids.get(value) || null }) };
        } }; },
        insert(row) {
          state.inserted.push(row);
          const record = { id: state.inserted.length, external_id: row.external_id,
            created_at: '2026-10-01T00:00:00Z' };
          state.ids.set(row.external_id, record);
          return { select() { return { single: async () => ({ data: record, error: null }) }; } };
        },
      };
    },
  };
}

const item = (n, extra = {}) => ({ type: 'expense', amount: 42.5, date: '2026-10-01',
  payment_source_id: 6, description: 'Synthetic Merchant',
  external_id: `synthetic-${n}`, ...extra });

test('bulk wraps existing v1 handler without changing existing single transaction behavior', async () => {
  const db = fakeDatabase();
  const controller = loadControllerWithFake('../../controllers/v1/transactionController', db);
  const r = createMockResponse();
  await controller.createTransaction({ body: { items: [item(1), item(2)] } }, r);
  assert.equal(r.statusCode, 200);
  assert.deepEqual([r.body.total, r.body.succeeded, r.body.created, r.body.failed], [2, 2, 2, 0]);
  assert.deepEqual(db.state.inserted.map(row => row.external_id), ['synthetic-1', 'synthetic-2']);
  const single = createMockResponse();
  await controller.createTransaction({ body: item(3) }, single);
  assert.equal(single.statusCode, 201);
  assert.equal(single.body.external_id, 'synthetic-3');
});

test('legacy FX fields and one installment ordinal are written to existing transaction columns', async () => {
  const db = fakeDatabase();
  const controller = loadControllerWithFake('../../controllers/v1/transactionController', db);
  const r = createMockResponse();
  await controller.createTransaction({ body: { items: [
    item('FX', { amount: 275.82, currency: 'USD', original_amount: 87,
      charge_date: '2026-10-02', exchange_rate: 3.17 }),
    item('inst2', { amount: 727.39, installment_number: 2, installment_count: 36,
      charge_date: '2026-11-02' }),
  ] } }, r);
  assert.equal(r.body.created, 2);
  assert.equal(db.state.inserted[0].currency, 'USD');
  assert.equal(db.state.inserted[0].total_amount, 275.82);
  assert.equal(db.state.inserted[0].original_amount, 87);
  assert.equal(db.state.inserted[0].exchange_rate, 3.17);
  assert.equal(db.state.inserted[1].installment_number, 2);
  assert.equal(db.state.inserted[1].installment_count, 36);
  assert.equal(db.state.inserted[1].installments_info, '2/36');
  assert.equal(db.state.inserted.length, 2, 'no future installment siblings created');
});

test('replay of posted single-item external_id is counted as successful existing in bulk', async () => {
  const db = fakeDatabase();
  const controller = loadControllerWithFake('../../controllers/v1/transactionController', db);
  const first = createMockResponse();
  await controller.createTransaction({ body: item('stable') }, first);
  assert.equal(first.statusCode, 201);
  const bulk = createMockResponse();
  await controller.createTransaction({ body: { items: [item('stable'), item('fresh')] } }, bulk);
  assert.equal(bulk.body.created, 1);
  assert.equal(bulk.body.already_exists, 1);
  assert.equal(bulk.body.succeeded, 2);
  assert.equal(db.state.inserted.length, 2);
});
