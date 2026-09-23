const { test } = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/transactionIngestionService');
const input = extra => ({ idempotency_key: 'capture-A', merchant: 'AROMA', accounting_amount: '84.90', currency: 'ILS', movement_type: 'expense', transaction_date: '2026-09-22', ...extra });

test('APY exact decimal amounts preserve cents beyond JS precision without rounding', () => {
  assert.deepEqual(service.money('84.9'), { amount: '84.90', minor: '8490' });
  assert.deepEqual(service.money('9007199254740993.01'), { amount: '9007199254740993.01', minor: '900719925474099301' });
  for (const amount of [84.9, '0', '-1', '1.001', 'NaN', '1e2', ' 1', '.5']) assert.throws(() => service.money(amount), { code: 'APY_INPUT' });
});
test('APY merchant normalization retains Hebrew, diacritics and store digits', () => {
  assert.equal(service.normalizeMerchant('  ＡＲＯＭＡ - 123! '), 'aroma 123');
  assert.equal(service.normalizeMerchant('\u200fוולט  ישראל'), 'וולט ישראל');
  assert.equal(service.normalizeMerchant('Café + 9'), 'café 9');
  assert.notEqual(service.normalizeMerchant('WOLT'),service.normalizeMerchant('וולט'));
});
test('APY time evidence is optional and never obtains precision from receipt time', () => {
  assert.deepEqual(service.timeEvidence(null), { raw: null, precision: null, comparable: false });
  assert.deepEqual(service.timeEvidence('2026-09-22T08:30+03:00'), { raw:'2026-09-22T08:30+03:00',precision:'minute',comparable:true });
  assert.equal(service.timeEvidence('2026-09-22T08:30:00.125Z').precision,'fractional_3');
  assert.equal(service.timeEvidence('2026-09-22T08:30').comparable,false);
  for (const value of ['2026-02-30T08:30Z','2026-09-22T25:01Z','2026-09-22T08:00+14:01']) assert.throws(()=>service.timeEvidence(value));
});
test('APY provider ID absent is valid; unknown fields and non-ILS accounting fail safely', () => {
  assert.equal(service.normalizeObservation(input()).provider_reference,undefined);
  for (const extra of [{Authorization:'secret'},{currency:'USD'},{idempotency_key:''},{idempotency_key:' x'},{transaction_date:'2026-02-30'},{payment_source_id:1}]) assert.throws(()=>service.normalizeObservation(input(extra)));
});
test('APY service passes trusted source separately, preserving decimal/BIGINT strings', async () => {
  let received;
  const db={rpc:async(name,args)=>{received={name,args};return {data:{outcome:'created',observation_id:'9007199254740993'}};}};
  const result=await service.ingestObservation(db,'9007199254740993',input({accounting_amount:'84.9'}));
  assert.equal(result.observation_id,'9007199254740993');assert.equal(received.name,'ingest_observation');assert.equal(received.args.p_source_id,'9007199254740993');assert.equal(received.args.p_observation.accounting_amount,'84.90');
});
test('APY malformed input never calls persistence and returns stable rejected envelope', async () => {
  const result=await service.ingestObservation({rpc:()=>assert.fail('must not write')},'1',input({accounting_amount:1}));
  assert.equal(result.outcome,'rejected');assert.equal(result.observation_id,null);assert.equal(result.transaction_id,null);assert.equal(result.replayed,false);
});
test('APY database domain outcomes pass through without exposing exception payloads', async () => {
  for(const outcome of ['created','reconciled','already_observed','ambiguous','conflict','rejected']) {
    const expected={outcome,observation_id:'1',transaction_id:null,disposition:'pending'};
    assert.deepEqual(await service.ingestObservation({rpc:async()=>({data:expected})},'1',input()),expected);
  }
  await assert.rejects(service.ingestObservation({rpc:async()=>({error:{code:'23514',message:'SECRET INPUT'}})},'1',input()),e=>e.message==='APY command failed'&&!e.message.includes('SECRET'));
});
test('APY transient locks retry at most twice using identical command arguments', async () => {
  const calls=[];const db={rpc:async(name,args)=>{calls.push(args);return calls.length===1?{error:{code:'40P01'}}:{data:{outcome:'already_observed'}};}};
  assert.equal((await service.ingestObservation(db,'1',input())).outcome,'already_observed');assert.equal(calls.length,2);assert.strictEqual(calls[0],calls[1]);
  let attempts=0;await assert.rejects(service.ingestObservation({rpc:async()=>{attempts++;return {error:{code:'55P03'}};}},'1',input()),e=>e.retryable===true);assert.equal(attempts,2);
});
test('APY command service preserves request key for amendment/review/cancellation', async () => {
  const key='00000000-0000-4000-8000-000000000001',command={observation_id:'2',expected_revision:'3'};
  for(const [method,name] of [['amendObservation','amend_observation'],['resolveObservation','resolve_observation'],['cancelIngestedTransaction','cancel_ingested_transaction']]){
    await service[method]({rpc:async(n,args)=>{assert.equal(n,name);assert.equal(args.p_request_key,key);assert.strictEqual(args.p_command,command);return {data:{}};}},key,command);
  }
});
test('legacy adapter preserves exact insert, projection and Supabase errors without source protocol', async () => {
  const row={total_amount:1.234,external_id:' legacy '},result={data:null,error:{code:'23505'}};
  const db={from:table=>{assert.equal(table,'transactions');return {insert:payload=>{assert.strictEqual(payload,row);return {select:projection=>{assert.equal(projection,'id, external_id, created_at');return {single:async()=>result};}};}};}};
  assert.strictEqual(await service.insertLegacyTransaction(db,row),result);
});
