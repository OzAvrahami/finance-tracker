const test = require('node:test');
const assert = require('node:assert/strict');
const { processDueSavingsDeposits } = require('../services/dueSavingsDepositService');
const { requireSavingsJobSecret } = require('../middleware/savingsJobAuth');
const { createProcessDueSavingsHandler } = require('../controllers/savingsJobController');
const { getJerusalemDate } = require('../services/dueLoanPaymentService');

const db = (rows, responses = []) => {
  const calls = [], filters = [];
  const client = { calls, filters, from(table) {
    assert.equal(table, 'savings_account_summary');
    const q = { select() { return q; }, eq(...v) { filters.push(v); return q; }, lte(...v) { filters.push(v); return q; }, order() { return q; },
      range(start, end) { return Promise.resolve({ data: rows.slice(start, end + 1), error: null }); } };
    return q;
  }, async rpc(name, args) { calls.push({ name, args }); return responses.shift() || { data: { transaction_id: '5' }, error: null }; } };
  return client;
};
test('Savings job captures one oldest tuple per account and preserves exact BIGINT identity', async () => {
  const client = db([{ account_id: '9007199254740993', next_due_date: '2026-01-31', plan_revision: '0' }]);
  const r = await processDueSavingsDeposits({ supabaseClient: client });
  assert.equal(r.processed, 1); assert.equal(client.calls.length, 1);
  assert.deepEqual(client.calls[0].args.p_command, { action: 'due', account_id: '9007199254740993', occurrence_month: '2026-01-01', expected_due_date: '2026-01-31', plan_revision: '0' });
  assert(client.filters.some(([k,v]) => k === 'auto_deposit_enabled' && v === true));
  assert(client.filters.some(([k,v]) => k === 'next_due_date' && v === getJerusalemDate()));
});
test('bounded transient retry keeps its receipt, reports claimed/stale/failure without raw secrets', async () => {
  const rows = [1,2,3,4].map(n => ({ account_id: String(n), next_due_date: '2026-01-31', plan_revision: '2' }));
  const client = db(rows, [{ error: { code:'40P01' } }, { data:{ transaction_id:'8' } }, { data:{ status:'already_claimed' } },
    { error:{ code:'40001', details:'SAVINGS_PREVIEW_STALE' } }, { error:{ message:'secret credential', details:'internal SQL credential' } }]);
  const r = await processDueSavingsDeposits({ supabaseClient:client });
  assert.equal(r.processed,1);assert.equal(r.alreadyClaimed,1);assert.equal(r.skipped,1);assert.equal(r.failed,1);
  assert.deepEqual(client.calls[0],client.calls[1]);assert(!JSON.stringify(r).includes('credential'));
});
test('separate scheduler requires explicit enable and its own secret', () => {
  const old = { enabled:process.env.SAVINGS_JOB_ENABLED, secret:process.env.SAVINGS_JOB_SECRET };
  const res = { status(n) { this.code=n;return this; },json(body) { this.body=body;return this; } }; let allowed=0;
  try {
    process.env.SAVINGS_JOB_SECRET='isolated-test';delete process.env.SAVINGS_JOB_ENABLED;
    requireSavingsJobSecret({headers:{authorization:'Bearer isolated-test'}},res,()=>allowed++);assert.equal(res.code,503);
    process.env.SAVINGS_JOB_ENABLED='true';requireSavingsJobSecret({headers:{authorization:'Bearer wrong'}},res,()=>allowed++);assert.equal(res.code,401);
    requireSavingsJobSecret({headers:{authorization:'Bearer isolated-test'}},res,()=>allowed++);assert.equal(allowed,1);
  } finally { for(const [name,value] of [['SAVINGS_JOB_ENABLED',old.enabled],['SAVINGS_JOB_SECRET',old.secret]]){if(value===undefined)delete process.env[name];else process.env[name]=value;} }
});
test('job HTTP status reports failures and never serializes connection errors', async () => {
  const res={status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
  await createProcessDueSavingsHandler(async()=>({failed:1}))({},res);assert.equal(res.code,500);
  await createProcessDueSavingsHandler(async()=>{throw Error('secret connection');})({},res);assert(!JSON.stringify(res.body).includes('secret'));
  await createProcessDueSavingsHandler(async()=>({failed:0}))({},res);assert.equal(res.code,200);
});
