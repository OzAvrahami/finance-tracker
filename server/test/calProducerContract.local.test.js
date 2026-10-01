// Opt-in read-only contract audit. Imports pure producer functions with an injected
// in-memory fetch; never runs the importer, reads credentials, or contacts a provider.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { request } = require('../services/calIngestionService');
const root = process.env.CAL_BRIDGE_AUDIT_ROOT;
const options = { skip: !root && 'Set CAL_BRIDGE_AUDIT_ROOT to the inspected Bridge checkout' };
const modules = async () => ({
  ...await import(pathToFileURL(path.join(root, 'packages/bridge-core/src/application/exportToFinanceSystem.js'))),
  ...await import(pathToFileURL(path.join(root, 'packages/bridge-core/src/infrastructure/dedup.js'))),
});
const tx = patch => ({provider:'CAL',accountId:'Synthetic card',transactionDate:'2026-09-30',chargeDate:'2026-10-01',
  merchantName:'Synthetic merchant',amount:10,currency:'ILS',chargeAmount:10,chargeCurrency:'ILS',
  status:'completed',transactionType:'regular',raw:{},...patch});
const profile = {instance_key:'audit',request_key:'84000000-0000-4000-8000-000000000001',payment_source_name:'Synthetic card',payment_source_id:'1'};
async function payload(row) {
  const m=await modules();let body;m.assignOccurrenceKeys([row]);
  const r=await m.sendTransactionToFinance(row,{apiUrl:'https://never-called.invalid',apiKey:'test-only'},
    {fetch:async(url,init)=>{body=JSON.parse(init.body);return {ok:true,status:201,json:async()=>({id:1})};}});
  assert.equal(r.ok,true);return body;
}
test('Bridge ordinary and online ILS purchases use the same supported source contract',options,async()=>{
  for(const merchantName of ['Synthetic ordinary','Synthetic online']) {
    const p=await payload(tx({merchantName}));const r=request(profile,p);
    assert.equal(r.observation.accounting_amount,'10.00');assert.equal(r.observation.currency,'ILS');
    assert.equal(r.observation.occurred_at,undefined);assert.equal(r.observation.provider_reference,undefined);
    assert.equal(r.observation.idempotency_key,p.external_id);
  }
});
test('Bridge omits charge currency: distinct billing bases serialize identically; FX rejection is a coverage gap',options,async()=>{
  const ils=await payload(tx({currency:'USD',amount:100,chargeAmount:370,chargeCurrency:'ILS'}));
  const usd=await payload(tx({currency:'USD',amount:100,chargeAmount:370,chargeCurrency:'USD'}));
  assert.deepEqual(ils,usd);assert.equal(ils.charge_currency,undefined);
  assert.throws(()=>request(profile,ils),e=>e.calCode==='cal_supported_ils_purchase_required');
});
test('Bridge partial installments are sent but their accounting basis cannot be inferred by the adapter',options,async()=>{
  const p=await payload(tx({transactionType:'installment 1 of 3',amount:240,chargeAmount:80}));
  assert.equal(p.amount,80);assert.equal(p.original_amount,240);assert.equal(p.transaction_type,undefined);
  assert.throws(()=>request(profile,p),e=>e.calCode==='cal_unsupported_amount_basis');
});
test('equal-amount installment and ordinary payloads differ only by opaque retry key, not classification',options,async()=>{
  const a=await payload(tx({transactionType:'regular'})),b=await payload(tx({transactionType:'installment 1 of 3'}));
  assert.notEqual(a.external_id,b.external_id);
  delete a.external_id;delete b.external_id;assert.deepEqual(a,b);
});
test('negative refunds and pending entries are skipped upstream; positive refund labels are lost',options,async()=>{
  const m=await modules();for(const row of [tx({chargeAmount:-10,amount:-10}),tx({chargeAmount:0}),tx({status:'pending'})])assert.equal(m.shouldSendTransaction(row),false);
  const row=tx({transactionType:'refund'});assert.equal(m.shouldSendTransaction(row),true);
  const p=await payload(row);assert.equal(p.type,'expense');assert.equal(p.transaction_type,undefined);
});
test('Bridge preserves two genuine equal-value occurrence keys for transport',options,async()=>{
  const m=await modules(),rows=[tx({amount:6,chargeAmount:6}),tx({amount:6,chargeAmount:6})];m.assignOccurrenceKeys(rows);
  const captured=[];for(const row of rows)await m.sendTransactionToFinance(row,{apiUrl:'https://never-called.invalid',apiKey:'test-only'},
   {fetch:async(url,init)=>{captured.push(JSON.parse(init.body));return {ok:true,status:201,json:async()=>({id:1})};}});
  assert.notEqual(captured[0].external_id,captured[1].external_id);assert.equal(captured[1].external_id,captured[0].external_id+'|#2');
  assert.equal(captured[0].amount,6);assert.equal(captured[1].amount,6);
});

test('explicit v2 exporter supplies exact billed ILS and original FX with no inferred conversion',options,async()=>{
 const m=await modules(),row=tx({currency:'USD',amount:100,chargeAmount:370,transactionType:'רגילה',
   raw:{transactionType:'רגילה',amountRaw:'$100.00',chargeAmountRaw:'₪370.00'}});
 m.assignOccurrenceKeys([row]);let body;
 await m.sendTransactionToFinance(row,{apiUrl:'https://never-called.invalid',apiKey:'test-only',
  v2Streams:[{provider:'cal',providerAccountId:'default',paymentSourceName:row.accountId}]},
  {fetch:async(u,i)=>{body=JSON.parse(i.body);return{ok:true,status:201,json:async()=>({id:1})};}});
 const r=request(profile,body);assert.equal(r.observation.accounting_amount,'370.00');
 assert.equal(r.observation.original_amount,'100.00');assert.equal(r.observation.original_currency,'USD');
 assert.equal(r.observation.source_metadata.provider_status,'רגילה');
 assert.equal(r.observation.idempotency_key,row.dedupKey);assert.equal(r.observation.occurred_at,undefined);
});
