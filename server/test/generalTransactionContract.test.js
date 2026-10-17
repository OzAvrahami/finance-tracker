const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const { item, envelope, producerFixtures } = require('./fixtures/generalTransaction');
const { validateItem, LIMITS, envelope:validateEnvelope, CONTRACT } = require('../services/generalTransactionContract');
const { processSubmission } = require('../services/generalTransactionIngestion');
const { loadControllerWithFake } = require('./helpers/fakeSupabase');
const { apiKeyAuth } = require('../middleware/apiKeyAuth');
const created = { outcome: 'created', accepted: true, financial_posted: true, receipt_id: '1', transaction_id: '1' };
const fake = () => { const calls = []; return { calls, rpc: async (name, args) => { calls.push({ name, args }); return { data: created }; } }; };

test('exported producer fixtures preserve contract validation, ordering and source date gaps without persistence',()=>{
  const bundle=producerFixtures();assert.equal(bundle.contract,CONTRACT);
  assert.equal(new Set(bundle.cases.map(c=>c.id)).size,bundle.cases.length);
  for(const c of bundle.cases){
    const parsed=validateEnvelope(c.request);assert.ok(!parsed.error,c.id);
    assert.deepEqual(parsed.items.map(i=>!!validateItem(i).item),c.validItems,c.id);
    assert.deepEqual(c.expectedResponse.results.map(r=>[r.index,r.client_id,r.key]),parsed.items.map((r,i)=>[i,r.client_id,r.key]),c.id);
    for(const before of c.before)assert.ok(!validateEnvelope(before).error);
  }
  const missing=bundle.cases.find(c=>c.id==='producer-missing-original-date').request.item;
  assert.equal(missing.dates.purchase,null);assert.equal(missing.dates.mapped,'2026-09-01');assert.equal(missing.dates.billing,'2026-10-10');
  const conflict=bundle.cases.find(c=>c.id==='completed-needs-owner-resolution');
  assert.equal(conflict.before[0].item.key,conflict.request.item.key);assert.equal(conflict.before[0].item.event.status,'pending');
  assert.equal(conflict.request.item.event.status,'completed');
});

test('single and one-item batch use exactly the same validated evidence command', async () => {
  const db = fake();
  const single = await processSubmission(db, envelope(item()));
  const batch = await processSubmission(db, envelope([item()]));
  assert.deepEqual(single, batch); assert.deepEqual(db.calls[0], db.calls[1]);
  assert.equal(db.calls[0].name, 'ingest_general_transaction');
  assert.equal(db.calls[0].args.p_item.client_id, undefined);
});
test('mixed item validation never strips meaningful fields and preserves input order', async () => {
  const db = fake();
  const r = await processSubmission(db, envelope([item(), item({ payment_source_id: '99' }), item({ key: 'second' }), null]));
  assert.equal(db.calls.length, 2);
  assert.deepEqual(r.body.results.map(x => x.outcome), ['created','rejected','created','rejected']);
  assert.deepEqual(r.body.results.map(x => x.index), [0,1,2,3]);
  assert.deepEqual(r.body.results[1].fields, ['']);
});
test('malformed envelopes, unknown versions, count and raw byte bounds fail before persistence', async () => {
  for (const body of [[], {}, { ...envelope(item()), contract: 'v2' }, { ...envelope(item()), items: [] }, envelope([]), envelope(Array(51).fill(item()))]) {
    const db = fake(); assert.equal((await processSubmission(db, body)).status, 400); assert.equal(db.calls.length, 0);
  }
  const db = fake(); assert.equal((await processSubmission(db, envelope(item()), { rawBytes: LIMITS.bytes + 1 })).status, 413);
  assert.equal(db.calls.length, 0);
});
test('exact money, ISO scales, date meaning, timestamp and signs are validated without float conversion', () => {
  assert.ok(validateItem(item({ charged: { amount: '99999999999999999999.99', currency: 'ILS', scale: 2 } })).item);
  for (const money of [{ amount: 0.1, currency: 'ILS', scale: 2 }, { amount: '0.001', currency: 'ILS', scale: 3 }, { amount: '1.00', currency: 'ZZZ', scale: 2 }, { amount: '-1.00', currency: 'ILS', scale: 2 }]) assert.ok(validateItem(item({ charged: money })).reason);
  for (const original of [{ amount: '100', currency: 'JPY', scale: 0 }, { amount: '1.001', currency: 'KWD', scale: 3 }]) assert.ok(validateItem(item({ original })).item);
  const refund = item({ event: { ...item().event, kind: 'refund' }, charged: { amount: '-1.00', currency: 'ILS', scale: 2 } });
  assert.ok(validateItem(refund).item);
  assert.ok(validateItem(item({ dates: { ...item().dates, purchase: '2026-02-30' } })).reason);
  assert.ok(validateItem(item({ dates: { purchase: null, mapped: '2026-10-01', billing: null, occurred_at: '2026-10-01T12:15:00+03:00', timezone: 'Asia/Jerusalem' } })).item);
  assert.equal(validateItem(item({ dates: { ...item().dates, occurred_at: '2026-10-01T12:15:00Z', timezone: 'Asia/Jerusalem' } })).reason, 'contradictory_timezone');
});
test('maximum batch size is processed, oversized items reject independently, and evidence remains frozen', async () => {
  const db = fake();
  const items = Array.from({ length: LIMITS.items }, (_, i) => item({ key: `key-${i}`, client_id: `row-${i}` }));
  const before = JSON.stringify(items);
  const r = await processSubmission(db, envelope(items));
  assert.equal(r.body.results.length, LIMITS.items); assert.equal(db.calls.length, LIMITS.items); assert.equal(JSON.stringify(items), before);
  const large = await processSubmission(db, envelope([item({ merchant: 'x'.repeat(LIMITS.itemBytes) }), item()]));
  assert.equal(large.body.results[0].reason_code, 'item_too_large'); assert.equal(large.body.results[1].outcome, 'created');
});
test('absent/zero installment evidence is preserved, contradictory and malformed counters reject', () => {
  for (const installment of [null, { current: 0, total: 0 }, { current: null, total: 3 }, { current: 1, total: 3 }]) {
    assert.ok(validateItem(item({ event: { ...item().event, basis: 'installment', installment } })).item);
  }
  for (const installment of [{ current: 4, total: 3 }, { current: '1', total: 3 }, { current: -1, total: 3 }]) assert.ok(validateItem(item({ event: { ...item().event, basis: 'installment', installment } })).reason);
  assert.equal(validateItem(item({ event: { ...item().event, installment: { current: 1, total: 3 } } })).reason, 'contradictory_installments');
});
test('definite rolled-back item failure does not block independent valid item', async () => {
  let calls = 0;
  const r = await processSubmission({ rpc: async () => ++calls === 1 ? { error: { code: '55P03' } } : { data: created } }, envelope([item(),item({ key: 'two' })]));
  assert.equal(r.body.results[0].commit_state, 'rolled_back'); assert.equal(r.body.results[1].outcome, 'created');
});
test('lost acknowledgements/timeouts are indeterminate; unstarted items are explicitly retryable', async () => {
  let calls = 0;
  const r = await processSubmission({ rpc: () => { calls++; return new Promise(() => {}); } }, envelope([item(),item({ key: 'two' })]), { commandMs: 5 });
  assert.equal(calls, 1); assert.equal(r.body.results[0].commit_state, 'unknown'); assert.equal(r.body.results[0].financial_posted, null);
  assert.equal(r.body.results[1].commit_state, 'not_attempted');
  const db = fake(); const expired = await processSubmission(db, envelope([item()]), { durationMs: 0 });
  assert.equal(db.calls.length, 0); assert.equal(expired.body.results[0].reason_code, 'batch_deadline');
});
test('existing authenticated endpoint selects general contract explicitly and safely handles bad JSON', async t => {
  const db = fake(), controller = loadControllerWithFake('../../controllers/v1/transactionController', db);
  const before = process.env.EXTERNAL_API_KEY; process.env.EXTERNAL_API_KEY = 'synthetic-test-key';
  t.after(() => { if (before === undefined) delete process.env.EXTERNAL_API_KEY; else process.env.EXTERNAL_API_KEY = before; });
  const app = express();
  app.use(express.json({ limit: '2mb', verify: (req, res, buffer) => { req.transactionBodyBytes = buffer.length; } }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.post('/api/v1/transactions', apiKeyAuth, controller.createTransaction);
  app.use((err, req, res, next) => res.status(err.type === 'entity.too.large' ? 413 : 400).json({ error: 'invalid_request' }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const send = (body, auth = 'synthetic-test-key', contentType = 'application/json') => fetch(`http://127.0.0.1:${server.address().port}/api/v1/transactions`, { method: 'POST', headers: { 'Content-Type': contentType, Authorization: `Bearer ${auth}` }, body });
  assert.equal((await send(JSON.stringify(envelope(item())), 'wrong')).status, 401);
  assert.equal(db.calls.length, 0);
  assert.equal((await send(JSON.stringify(envelope(item())))).status, 200);
  assert.equal((await send('{')).status, 400);
  assert.equal((await send(' '.repeat(LIMITS.bytes) + JSON.stringify(envelope(item())))).status, 413);
  assert.equal((await send(' '.repeat(2 * LIMITS.bytes) + '{}')).status, 413);
  assert.equal((await send('[]')).status, 400);
  assert.equal((await send('contract=finance.transactions.v1', 'synthetic-test-key', 'application/x-www-form-urlencoded')).status, 415);
});
