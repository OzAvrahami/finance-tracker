const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { once } = require('node:events');
const { profiles, selectProfile, request, handleCal, exactNumber } = require('../services/calIngestionService');
const { loadControllerWithFake } = require('./helpers/fakeSupabase');
const { apiKeyAuth } = require('../middleware/apiKeyAuth');
const profile = {instance_key:'cal-test',request_key:'11111111-1111-4111-8111-111111111111',payment_source_name:'Approved card',payment_source_id:'6'};
const body = {type:'expense',amount:10,date:'2026-09-30',description:'Ninja Star Ltd',charge_date:'2026-10-01',payment_source_name:'Approved card',currency:'ILS',original_amount:10,external_id:'0123456789abcdef'};
const env = {CAL_INGESTION_SOURCES:JSON.stringify([profile])};
const result = (outcome='created',extra={}) => ({outcome,observation_id:'12',transaction_id:'10',disposition:'created',reason_code:'no_candidate',decision_revision:'1',...extra});
const fake = r => ({from:()=>({select:async()=>({data:[]})}),rpc:async()=>({data:r})});

test('CAL registration is explicit, exact and fail-closed without source guessing',()=>{
 assert.deepEqual(profiles({}),[]);assert.equal(selectProfile(body,{}),null);assert.deepEqual(selectProfile(body,env),profile);
 assert.equal(selectProfile({...body,payment_source_name:'approved card'},env),null);
 for(const value of ['{','{}','[]',JSON.stringify([profile,profile]),JSON.stringify([{...profile,payment_source_id:6}]),JSON.stringify([{...profile,request_key:'bad'}])])
 assert.throws(()=>profiles({CAL_INGESTION_SOURCES:value}),e=>e.calCode==='cal_configuration_invalid');
});
test('CAL exact decimal translation preserves source key, independent dates and original evidence',()=>{
 const r=request(profile,{...body,amount:84.9,original_amount:84.9,external_id:'0123456789abcdef|#2'});
 assert.equal(r.observation.accounting_amount,'84.90');assert.equal(r.observation.idempotency_key,'0123456789abcdef|#2');
 assert.equal(r.observation.charge_date,'2026-10-01');assert.equal(r.observation.transaction_date,'2026-09-30');
 assert.equal(r.observation.provider_reference,undefined);assert.equal(r.observation.occurred_at,undefined);
 assert.deepEqual(r.source.configuration.payment_source_ids,['6']);assert.equal(r.source.configuration.time_verified,false);
 assert.equal(r.observation.original_amount,'84.90');assert.equal(r.observation.original_currency,'ILS');
});
test('unsafe accounting, forged mapping, unsupported fields and malformed dates never fall through',()=>{
 for(const value of [0,-1,0.001,NaN,Infinity,'10.00',Number.MAX_SAFE_INTEGER]) assert.throws(()=>exactNumber(value));
 for(const patch of [{amount:0.001},{original_amount:30},{currency:'USD'},{payment_source_id:7},{source_id:'1'},{transaction_id:1},{date:'2026-02-30'},
  {description:''},{external_id:' x'},{external_id:''},{dry_run:'false'},{type:'income'},{notes:{}},{exchange_rate:1}]) assert.throws(()=>request(profile,{...body,...patch}));
});
test('dry run makes zero RPCs and explicitly defers the atomic match decision',async()=>{
 const db=fake(null);db.rpc=()=>{throw Error('dry run cannot call RPC');};
 const r=await handleCal(db,profile,{...body,dry_run:true});assert.equal(r.status,200);assert.equal(r.body.would_insert,null);assert.equal(r.body.matching_deferred,true);
});
test('pending acceptance has no cash ID; replay remains pending; key conflicts cannot look like accepted 409',async()=>{
 for(const outcome of ['ambiguous','already_observed']){
 const r=await handleCal(fake(result(outcome,{transaction_id:null,disposition:'pending',review_required:true,replayed:outcome==='already_observed'})),profile,body);
 assert.equal(r.status,202);assert.equal(r.body.id,null);assert.equal(r.body.financial_posted,false);assert.equal(r.body.review_required,true);
 }
 const conflicting=await handleCal(fake(result('conflict',{reason_code:'idempotency_key_conflict'})),profile,body);assert.equal(conflicting.status,422);
 const changed=await handleCal(fake(result('rejected',{reason_code:'cal_payload_changed'})),profile,body);assert.equal(changed.status,422);
 const replay=await handleCal(fake(result('already_observed')),profile,body);assert.equal(replay.status,409);assert.equal(replay.body.error,'already_exists');
});
test('v1 real HTTP boundary retains external API auth and routes only the registered producer to APY',async t=>{
 const prior=process.env.CAL_INGESTION_SOURCES, priorKey=process.env.EXTERNAL_API_KEY;
 process.env.CAL_INGESTION_SOURCES=env.CAL_INGESTION_SOURCES;process.env.EXTERNAL_API_KEY='test-only-cal-key';
 t.after(()=>{if(prior===undefined)delete process.env.CAL_INGESTION_SOURCES;else process.env.CAL_INGESTION_SOURCES=prior;
 if(priorKey===undefined)delete process.env.EXTERNAL_API_KEY;else process.env.EXTERNAL_API_KEY=priorKey;});
 const calls=[],db=fake(null);db.rpc=async(name,args)=>{calls.push({name,args});return{data:result()};};
 const controller=loadControllerWithFake('../../controllers/v1/transactionController',db);
 const app=express();app.use(express.json({limit:'2mb'}));app.post('/api/v1/transactions',apiKeyAuth,controller.createTransaction);
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const send=auth=>fetch(`http://127.0.0.1:${server.address().port}/api/v1/transactions`,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:auth}:{})},body:JSON.stringify(body)});
 assert.equal((await send()).status,401);assert.equal(calls.length,0);
 const response=await send('Bearer test-only-cal-key');assert.equal(response.status,201);assert.equal((await response.json()).id,10);
 assert.equal(calls.length,1);assert.equal(calls[0].name,'ingest_cal_v1');assert.equal(calls[0].args.p_request.external_id,body.external_id);
 assert.equal(calls[0].args.p_source.instance_key,'v1-cal:cal-test');assert.equal(JSON.stringify(calls).includes('test-only-cal-key'),false);
});
test('CAL transport failure is sanitized and retries the same RPC after a serialization failure',async()=>{
 const seen=[];const db=fake(null);db.rpc=async(n,a)=>{seen.push(a);return seen.length===1?{error:{code:'40001'}}:{data:result()};};
 assert.equal((await handleCal(db,profile,body)).status,201);assert.equal(seen.length,2);assert.deepEqual(seen[0],seen[1]);
 db.rpc=async()=>{throw Error('secret diagnostic');};await assert.rejects(handleCal(db,profile,body),e=>e.calCode==='cal_unavailable'&&!e.message.includes('secret'));
});
