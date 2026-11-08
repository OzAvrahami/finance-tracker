'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalize,instantMicros,storedMinor}=require('../services/ingestion/normalization');
const core=require('../services/ingestion/core');
const {prepare}=require('../services/ingestion/policy');
const {match,protectedCash}=require('../services/ingestion/reconciliation');
const facts=()=>({hash:'opaque-postgres-hash',source_id:'1',sources:[{id:'1',source_kind:'external_api',instance_key:'unified:v1',is_active:true,revision:'1',configuration:{}}],
  payments:[{id:'6',name:'CAL',method:'debit_card',issuer:'CAL',last4:'2755',is_active:true},{id:'14',name:'Discount',method:'bank_account',last4:'5297',is_active:true}],
  categories:[{id:100,type:'expense',is_active:true,savings_role:null,keywords:['store']}],transactions:[],observations:[],events:[],installments:[]});
const request=(extra={})=>({type:'expense',amount:557.55,date:'2026-11-08',description:'Synthetic store',payment_source_id:6,currency:'ILS',external_id:'synthetic',...extra});
const scope=(extra={})=>{const r=request(extra);return{channel:'external',request:r,key:r.external_id || "synthetic-transport-key",hash_input:r,date:r.date};};
const observation=(extra={})=>({idempotency_key:'synthetic',merchant:'Synthetic',accounting_amount:'557.55',currency:'ILS',movement_type:'expense',transaction_date:'2026-11-08',payment_source_id:'6',...extra});

test('merchant canonicalization preserves the historical repertoire across ICU versions', () => {
  const { normalizeMerchant } = require('../services/ingestion/normalization');
  // Unicode 17 adds a symbol, a case pair and a compatibility letter here.
  // They were opaque in the historical SQL tables, not punctuation/lowercase/S.
  assert.equal(normalizeMerchant('  SHOP \u20c1 \uA7CE \uA7F1  '), 'shop \u20c1 \uA7CE \uA7F1');
  assert.equal(normalizeMerchant('A\u030A \u0130 \uFF21\uFF22\uFF23 \u2122!'), '\u00e5 i\u0307 abc tm');
  assert.equal(normalizeMerchant('a!\u20c1?b'), 'a \u20c1 b');
});

test('exact money and microsecond evidence never pass through floating-point arithmetic',()=>{
  const n=normalize(observation({accounting_amount:'90071992547409.91',occurred_at:'2026-11-08T12:00:00.000001+02:00'}));
  assert.equal(n.amount_minor,'9007199254740991');assert.equal(n.width_micros,'1');
  assert.equal(instantMicros('2026-11-08T12:00:00.000002+02:00')-instantMicros(n.instant),1n);
  assert.equal(n.input.original_amount,null);assert.equal(n.input.provider_reference,null);
});
test('stored NUMERIC scale is exact; sub-cent history is never rounded into a candidate',()=>{
  assert.equal(storedMinor('150.0000000000000000'),15000n);
  assert.equal(storedMinor('-557.55000000000000'),-55755n);
  assert.equal(storedMinor('150.001'),null);
  assert.equal(storedMinor('90071992547409.910000000'),9007199254740991n);
});
for(const change of [{accounting_amount:'-557.55'},{accounting_amount:'1.001'},{accounting_amount:557.55},{transaction_date:'2026-02-30'},
  {provider_reference:{provider:'a',scope:'b',value:'c'}},{payment_evidence:{account_number:'must-not-be-public'}},
  {source_metadata:{arbitrary:true}},{original_amount:'1.123',original_currency:'USD',original_scale:2}])
  test(`normalization rejects ambiguous/noncanonical evidence ${JSON.stringify(change)}`,()=>assert.throws(()=>normalize(observation(change))));

for(const method of ['bank_account','credit_card','debit_card','cash','bank_transfer','check','digital_wallet'])
  test(`explicit refund eligibility is independent of ${method}; income is separately restricted`,()=>{
    const f=facts();f.payments[0].method=method;
    const r=core.decideIngestion(f,scope({type:'refund'}));
    assert.equal(r.outcome,'created');assert.equal(r.normalized.amount_minor,'-55755');assert.equal(r.posting.bank_movement,'refund');
    assert.equal(r.posting.movement_type,'expense');assert.equal(r.posting.total_amount,'-557.55');assert.equal(r.posting.installment_count,undefined);
    const income=core.decideIngestion(f,scope({type:'income'}));assert.equal(income.outcome,method==='bank_account'?'created':'ambiguous');
  });

test('refund missing identity, unmapped payment and unsupported FX do not acquire posting authority',()=>{
  assert.equal(core.decideIngestion(facts(),scope({type:'refund',external_id:undefined})).reason,'identity_evidence_required');
  assert.equal(core.decideIngestion(facts(),scope({type:'refund',payment_source_id:999})).reason,'payment_source_not_found');
  assert.throws(()=>core.decideIngestion(facts(),scope({type:'refund',currency:'USD',original_amount:10})),e=>e.reason==='refund_currency_unsupported');
});
test('payment selection handles new records without issuer routing and rejects ambiguous last4',()=>{
  const f=facts();f.payments.push({id:'20',name:'New MAX',method:'credit_card',issuer:'MAX',last4:'2755',is_active:true});
  assert.equal(core.decideIngestion(f,scope({payment_source_id:20})).payment,'20');
  assert.equal(core.decideIngestion(f,scope({payment_source_id:undefined,payment_source_name:'2755'})).reason,'payment_source_ambiguous');
});
test('category policy excludes Savings and wrong financial direction, preserving keyword priority',()=>{
  const f=facts();assert.equal(prepare(f,scope()).row.category_id,100);
  f.categories[0].savings_role='contribution';assert.equal(prepare(f,scope()).row.category_id,undefined);
  assert.throws(()=>prepare(f,scope({category_id:100})),e=>e.reason==='invalid_category');
});
test('historical replay preserves category validation without acquiring a new source mapping',()=>{
  const f=facts();f.historical_replay={outcome:'already_observed',transaction_id:'7',replayed:true};f.sources=[];
  assert.deepEqual(core.decideIngestion(f,scope()).result,f.historical_replay);
  f.categories[0].is_active=false;
  assert.throws(()=>core.decideIngestion(f,scope({category_id:100})),e=>e.reason==='invalid_category');
});
test('overflow and pending cross-source evidence hold observations without a cash target',()=>{
  const f=facts(), draft=prepare(f,scope());
  assert.deepEqual(match({...f,overflow:true},draft),{outcome:'ambiguous',reason:'candidate_overflow',target:null,candidate_ids:[]});
  f.observations.push({source_id:'2',transaction_id:null,payment_source_id:'6',amount_minor:'55755',movement_type:'expense',source_transaction_date:'2026-11-08'});
  const r=match(f,draft);assert.equal(r.reason,'pending_observation_review');assert.equal(r.target,null);
});
test('domain-linked, FX and installment cash is protected from generic reconciliation',()=>{
  const plain={total_amount:'557.55',currency:'ILS',links:[]};assert.equal(protectedCash(plain),false);
  for(const extra of [{links:['loan']},{links:['lego']},{links:['shopping']},{links:['savings']},{installment_count:3},{original_amount:'1.00'},{loan_id:1}])
    assert.equal(protectedCash({...plain,...extra}),true);
});
test('unknown commit returns once without fallback or a second posting attempt',async()=>{
  const f=facts(),calls=[];
  const db={rpc:async(name)=>{calls.push(name);if(name==='ingestion_core_snapshot')return{data:{token:'opaque',facts:f}};throw Error('lost acknowledgement');}};
  const r=await core.external(db,request());assert.equal(r.commit_state,'unknown');
  assert.deepEqual(calls,['ingestion_core_snapshot','ingestion_core_commit']);
});
test('a bounded timeout is unknown, never a claim of rollback or an automatic second post',async()=>{
  const calls=[],db={rpc:name=>{calls.push(name);return name==='ingestion_core_snapshot'?{data:{token:'opaque',facts:facts()}}:new Promise(()=>{});}};
  const r=await core.external(db,request(),false,{commandMs:5});
  assert.equal(r.commit_state,'unknown');assert.equal(r.financial_posted,null);
  assert.deepEqual(calls,['ingestion_core_snapshot','ingestion_core_commit']);
});
