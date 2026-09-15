const { test } = require('node:test');
const assert = require('node:assert/strict');
const savings = require('../services/savingsService');
const { createMockResponse, loadControllerWithFake } = require('./helpers/fakeSupabase');
const key = '00000000-0000-4000-8000-000000000001';

test('Savings API sends exact amounts and IDs to account-only RPCs', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: { account: { id: '9007199254740993' } } }; } };
  const body = { request_key: key, account: { name: 'חיסכון', target_amount: '9007199254740993.01' }, opening_amount: '9007199254740993.01', legacy_overlap_amount: '0' };
  await savings.createAccount(client, body);
  await savings.updateAccount(client, '9007199254740993', { request_key: key, expected_revision: '2', account: { target_amount: null, notes: 'חדש' } });
  await savings.getAccount(client, '9007199254740993', { before: '9007199254740994' });
  assert.deepEqual(calls.map((x) => x.name), ['create_savings_account', 'update_savings_account', 'get_savings_account']);
  assert.equal(calls[0].args.p_opening_amount, '9007199254740993.01');
  assert.equal(calls[0].args.p_legacy_overlap_amount, '0.00');
  assert.equal(calls[1].args.p_account_id, '9007199254740993');
  assert.equal(calls[1].args.p_account.target_amount, null);
  assert.equal(calls[2].args.p_before_entry_id, '9007199254740994');
});

test('Savings refuses lossy money/IDs, omitted overlap and malformed request keys before RPC', () => {
  const client = { rpc() { assert.fail('invalid request reached DB'); } };
  for (const value of [1.2, '1.001', '-1', 'NaN', '1e3', '10000000000000000', undefined]) {
    assert.throws(() => savings.createAccount(client, { request_key: key, account: {}, opening_amount: value, legacy_overlap_amount: '0' }));
  }
  assert.throws(() => savings.createAccount(client, { request_key: key, opening_amount: '0' }));
  assert.throws(() => savings.getAccount(client, 9007199254740993));
  assert.throws(() => savings.getAccount(client, '1', { from: '2026-02-29' }));
  assert.throws(() => savings.getAccount(client, '1', { from: '09/12/2026' }));
  assert.throws(() => savings.updateAccount(client, '1', { expected_revision: '1', request_key: 'bad', account: {} }));
});

test('historical transaction detail retains the tombstone as read-only without a Loan payment', async () => {
  const row = { id: 100, total_amount: '100.00', description: 'בוטלה', voided_at: '2026-09-12T00:00:00Z', void_reason: 'ביטול מפורש', transaction_items: [] };
  const client = { rpc: async () => ({ data: [{ row_json: row }] }), from(table) { return { select() { return this; }, eq() { return this; }, async single() { assert.equal(table, 'transactions'); return { data: row }; }, async maybeSingle() { assert.equal(table, 'loan_payments'); return { data: null }; } }; } };
  const controller = loadControllerWithFake('../../controllers/transactionController', client);
  const res = createMockResponse(); await controller.getTransactionById({ params: { id: '100' } }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.read_only, true); assert.equal(res.body.void_reason, row.void_reason); assert.equal(res.body.loan_payment, null);
});

test('Savings controller preserves Hebrew validation, hides SQL internals and distinguishes conflicts/not-found', async () => {
  for (const [error, status, text] of [
    [{ code: '22023', message: 'יש לבחור מקור פעיל' }, 422, 'יש לבחור מקור פעיל'],
    [{ code: '23514', message: 'secret_constraint_name' }, 422, 'פרטי החיסכון אינם תקינים'],
    [{ code: '40001', message: 'retry' }, 409, 'הנתונים השתנו'],
    [{ code: 'P0002', message: 'חשבון החיסכון לא נמצא' }, 404, 'לא נמצא'],
  ]) {
    const controller = loadControllerWithFake('../../controllers/savingsController', { rpc: async () => ({ error }) });
    const res = createMockResponse();
    await controller.get({ params: { id: '1' }, query: {} }, res);
    assert.equal(res.statusCode, status); assert.ok(res.body.error.includes(text));
  }
});

test('Savings list casts identifiers in PostgreSQL and does not truncate at a default page', async () => {
  const ranges = []; let selection;
  const client = { from(name) {
    assert.equal(name, 'savings_account_summary');
    return { select(s) { selection = s; return this; }, order() { return this; }, async range(start, end) { ranges.push([start, end]); return { data: start === 0 ? Array.from({ length: 500 }, (_, id) => ({ account_id: String(id + 1) })) : [{ account_id: '9007199254740993' }] }; } };
  } };
  const rows = await savings.listAccounts(client);
  assert.equal(rows.length, 501); assert.equal(rows[500].account_id, '9007199254740993');
  assert.match(selection, /account_id::text/); assert.deepEqual(ranges, [[0, 499], [500, 999]]);
});
test('Savings reports validate inclusive calendar ranges and retain exact account IDs', async () => {
  let called;
  const client = { rpc: async (name, args) => { called = { name, args }; return { data: { current_balance: '9007199254740993.01' } }; } };
  const result = await savings.getReport(client, { from: '2024-02-01', to: '2024-02-29', accountId: '9007199254740993' });
  assert.equal(result.current_balance, '9007199254740993.01');
  assert.deepEqual(called, { name: 'get_savings_report', args: { p_from: '2024-02-01', p_to: '2024-02-29', p_account_id: '9007199254740993' } });
  for (const query of [{}, {from:'2023-02-29',to:'2023-03-01'}, {from:'2024-03-01',to:'2024-02-01'}, {from:'2024-01-01',to:'2024-12-31',accountId:'-1'}]) {
    assert.throws(() => savings.getReport(client, query));
  }
});
