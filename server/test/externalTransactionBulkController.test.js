const test = require('node:test');
const assert = require('node:assert/strict');
const { loadControllerWithFake, createMockResponse } = require('./helpers/fakeSupabase');
const item=(key,extra={})=>({type:'expense',amount:42.5,date:'2026-11-04',payment_source_id:6,external_id:key,...extra});
test('single and mixed-source Bulk call the same atomic command without per-card routing',async()=>{
 const calls=[],db={rpc:async(name,args)=>{calls.push({name,args});return {data:{outcome:'created',transaction_id:String(calls.length)}};}};
 const controller=loadControllerWithFake('../../controllers/v1/transactionController',db),res=createMockResponse();
 await controller.createTransaction({body:{items:[item('cal'),item('max',{payment_source_id:8,currency:'USD',original_amount:12}),item('part',{installment_number:2,installment_count:6})]}},res);
 assert.equal(res.body.succeeded,3);assert.ok(calls.every(c=>c.name==='ingest_external_transaction'));
 assert.equal(calls[1].args.p_request.original_amount,12);assert.equal(calls[2].args.p_request.installment_number,2);
 const one=createMockResponse();await controller.createTransaction({body:item('one')},one);assert.equal(one.statusCode,201);
});
test('Bulk distinguishes exact replay, changed-content conflict and actionable review',async()=>{
 const results=[{outcome:'already_observed',transaction_id:'1',replayed:true},{outcome:'conflict',reason_code:'idempotency_key_conflict'},
  {outcome:'ambiguous',transaction_id:null,reason_code:'installment_series_required'}];
 const db={rpc:async()=>({data:results.shift()})},c=loadControllerWithFake('../../controllers/v1/transactionController',db),res=createMockResponse();
 await c.createTransaction({body:{items:[item('a'),item('b'),item('c')]}},res);
 assert.equal(res.body.already_exists,1);assert.equal(res.body.failed,1);assert.equal(res.body.review_required,1);
});
