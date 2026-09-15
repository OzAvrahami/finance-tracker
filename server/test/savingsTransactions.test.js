const { test } = require('node:test');
const assert = require('node:assert/strict');
const { saveCash, cancelCash, rejectUnsupported } = require('../services/savingsTransactionService');
const { createMockResponse, loadControllerWithFake } = require('./helpers/fakeSupabase');
const key = '00000000-0000-4000-8000-000000000001';
const body = () => ({ transaction: { description: 'בדיקה', movement_type: 'expense', total_amount: '90071992547409.91', transaction_date: '2026-09-13', charge_date: '2026-09-13', category_id: '1', payment_source_id: '2', currency: 'ILS' }, items: [], savings_handling: { request_key: key, mode: 'create', account_id: '9007199254740993', expected_revision: '1', cutoff_confirmed: true } });
const fake = (role = 'deposit') => {
  const calls = [];
  return { calls, from(table) { assert.equal(table, 'categories'); return { select() { return this; }, eq() { return this; }, single: async () => ({ data: { savings_role: role, type: 'expense' } }), in: async () => ({ data: [{ savings_role: role }] }) }; },
    rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'transactions_filtered' ? [{ row_json: { savings: { entry_id: '4' }, transaction_fingerprint: 'cash-fingerprint' } }] : { transaction_id: '42' } }; } };
};
test('both transaction entry points dispatch exact manual Savings before pricing, Loan and side effects', async () => {
  const db = fake(), controller = loadControllerWithFake('../../controllers/transactionController', db), res = createMockResponse();
  await controller.createTransaction({ body: body() }, res);
  assert.equal(res.statusCode, 201); assert.equal(res.body.id, '42'); assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].name, 'post_savings_event'); assert.equal(db.calls[0].args.p_command.amount, '90071992547409.91');
  assert.equal(db.calls[0].args.p_command.account_id, '9007199254740993');
});
test('existing link and correction/detach/reinstatement select their intended commands and preserve cash identity', async () => {
  for (const mode of ['link', 'correct', 'detach', 'reinstate']) {
    const db = fake(mode === 'detach' ? null : 'deposit'), input = body();
    input.savings_handling = { ...input.savings_handling, mode, event_kind: 'deposit', entry_id: '4', expected_transaction_fingerprint: 'fp', reason: 'אושר', expected_destination_revision: '2' };
    await saveCash(db, input, '42'); const last = db.calls.at(-1);
    assert.equal(last.name, mode === 'link' ? 'post_savings_event' : 'correct_savings_event');
    const c = last.args.p_command || last.args.p_replacement;
    assert.equal(c.transaction_id, '42'); assert.equal(c.expected_transaction_fingerprint, 'fp');
    assert.equal(c.action, ['link', 'reinstate'].includes(mode) ? 'link_cash' : mode === 'detach' ? 'detach' : 'create_cash');
  }
});
test('unsupported rich/Loan/foreign and malformed Savings inputs fail before financial RPC calls', async () => {
  for (const changes of [{ currency: 'USD' }, { loan_id: '1' }, { installment_count: 2 }, { global_discount: '1' }, { total_amount: 123.45 }, { total_amount: '1.001' }, { voided_at: '2026-01-01' }]) {
    const db = fake(), input = body(); Object.assign(input.transaction, changes);
    await assert.rejects(saveCash(db, input)); assert.equal(db.calls.length, 0);
  }
  await assert.rejects(saveCash(fake(), { ...body(), items: [{ item_name: 'not allowed' }] }));
});
test('cancellation uses the entry command or dedicated detached receipt, never ordinary hard deletion', async () => {
  for (const active of [true, false]) {
    const db = fake(); await cancelCash(db, '42', { request_key: key, reason: 'ביטול', ...(active ? { entry_id: '4', expected_revision: '3' } : { expected_transaction_fingerprint: 'fp' }) });
    assert.equal(db.calls.at(-1).name, active ? 'cancel_savings_event' : 'void_detached_savings_transaction');
  }
});
test('import/external/checkout reject Savings roles and payloads rather than silently creating cash-only entries', async () => {
  await assert.rejects(rejectUnsupported(fake(), { savings_account_id: '1' }));
  await assert.rejects(rejectUnsupported(fake(), {}, ['1']));
  await rejectUnsupported(fake(null), {}, ['1']);
});

test('realized payout create/link/edit uses the shared audited boundary, never ordinary income inference', async () => {
  for (const mode of ['create', 'link', 'correct', 'detach']) {
    const input = body(); input.transaction.movement_type = 'income';
    input.savings_handling = { ...input.savings_handling, mode, event_kind: 'interest_payout', entry_id: '4', expected_transaction_fingerprint: 'fp', reason: 'תיקון' };
    const db = fake(mode === 'detach' ? null : 'interest_payout');
    await saveCash(db, input, mode === 'create' ? null : '42');
    const c = db.calls.at(-1).args.p_command || db.calls.at(-1).args.p_replacement;
    assert.equal(c.event_kind, 'interest_payout'); assert.equal(c.amount, '90071992547409.91');
  }
  const plain = body(); delete plain.savings_handling; plain.transaction.movement_type = 'income';
  const db = fake(null); assert.equal(await saveCash(db, plain), null); assert.equal(db.calls.length, 0);
  await assert.rejects(rejectUnsupported(fake('interest_payout'), {}, ['1']));
});
