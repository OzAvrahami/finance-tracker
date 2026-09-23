const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { authenticate, sourceConfiguration } = require('../config/applePay');
const { observationFromRequest, safeResult, normalizeWalletAmountText, preferredMerchant } = require('../services/applePayIngestionService');
const { harness, listen, token, digest, environment, configuration, purchase, created, PATH } = require('./helpers/applePayHttp');

test('Apple credential is dedicated, disabled by default, constant digest and rotation scoped', () => {
  const a=token(),b=token(),env=environment(a);
  assert.equal(authenticate({},`Bearer ${a}`),'apple_ingestion_disabled');
  for(const value of [undefined,'',`Bearer ${b}`,'Bearer broad-owner-or-external-key']) assert.equal(authenticate(env,value),'unauthorized');
  assert.equal(authenticate(env,`Bearer ${a}`),null);
  env.APPLE_PAY_PREVIOUS_TOKEN_SHA256=digest(b);assert.equal(authenticate(env,`Bearer ${b}`),null);
  delete env.APPLE_PAY_PREVIOUS_TOKEN_SHA256;assert.equal(authenticate(env,`Bearer ${b}`),'unauthorized');
  env.APPLE_PAY_TOKEN_SHA256='bad';assert.equal(authenticate(env,`Bearer ${a}`),'apple_configuration_invalid');
});

test('Apple configuration binds only apple_pay, rejects ambiguous mappings and full card numbers', () => {
  const config=configuration(),env=environment(token(),config),parsed=sourceConfiguration(env);
  assert.equal(parsed.command.source_kind,'apple_pay');assert.equal(parsed.command.configuration.time_verified,false);
  for(const bad of [{...config,source_id:'2'},{...config,card_mappings:[...config.card_mappings,...config.card_mappings]},
    {...config,card_mappings:[{card_reference:'4111 1111 1111 1111',payment_source_id:'1'}]},
    {...config,card_mappings:[]},{...config,request_key:'bad'},{...config,expected_revision:2}]) {
    assert.throws(()=>sourceConfiguration({...env,APPLE_PAY_SOURCE_CONFIG:JSON.stringify(bad)}),/apple_configuration_invalid/);
  }
});

test('Apple adapter preserves exact decimal strings, original merchant and safe card evidence', () => {
  const body=purchase({amount:'9007199254740993.01',merchant:' WOLT - 24 '});
  const o=observationFromRequest(body,'phone');assert.equal(o.accounting_amount,body.amount);assert.equal(o.merchant,body.merchant);
  assert.deepEqual(o.payment_evidence,{card_reference:body.payment_method});assert.equal(o.movement_type,'expense');
  assert.equal(o.provider_reference,undefined);assert.equal(o.occurred_at,undefined);assert.equal(o.payment_source_id,undefined);
});

test('Apple optional time is not manufactured; missing dates and false precision fail safely', () => {
  const p=purchase({transaction_date:undefined,occurred_at:'2026-09-22T23:59+03:00'});
  assert.equal(observationFromRequest(p,'phone').occurred_at,p.occurred_at);
  assert.equal(observationFromRequest(purchase({occurred_at:null}),'phone').occurred_at,undefined);
  assert.equal(observationFromRequest(purchase({occurred_at:'2026-09-22T08:30'}),'phone').occurred_at,'2026-09-22T08:30');
  for(const extra of [{transaction_date:undefined},{transaction_date:undefined,occurred_at:'2026-09-22T08:30'},
    {occurred_at:'2026-02-30T08:30Z'},{occurred_at:'today'},{transaction_date:'2026-02-30'}]) assert.throws(()=>observationFromRequest(purchase(extra),'phone'));
});

test('Apple rejects unsupported amounts/currencies, missing merchants, field escalation and unsafe IDs', () => {
  for(const extra of [{amount:84.9},{amount:undefined},{amount:'0'},{amount:'-1'},{amount:'84,90'},{amount:'ILS 84.90'},
    {amount:'1.234'},{currency:'USD'},{currency:undefined},{merchant:''},{merchant:'x'.repeat(513)},
    {merchant:undefined},{payment_method:'4111111111111111'},{payment_method:''},{provider_reference:'4111111111111111'},
    {idempotency_key:'merchant-date-amount'},{source_id:'1'},{transaction_id:'2'},{category_id:'3'},{movement_type:'income'},
    {action:'cancel'},{source_metadata:{secret:'x'}},{client_capture_time:'now'}]) assert.throws(()=>observationFromRequest(purchase(extra),'phone'));
});

test('Apple provider reference is optional unverified evidence independent of UUID retry identity', () => {
  const p=purchase({provider_reference:'optional-reference'}),o=observationFromRequest(p,'phone');
  assert.equal(o.idempotency_key,p.idempotency_key);assert.deepEqual(o.provider_reference,{provider:'apple_wallet',type:'unverified',scope:'phone',value:'optional-reference'});
});

test('Verified coerced Wallet ILS text is exact; native objects and unsupported representations reject', () => {
  // These fixtures model the observed textual coercion result, not Wallet's unknown native type.
  assert.deepEqual(normalizeWalletAmountText('\u20aa4.00'), { amount: '4.00', currency: 'ILS' });
  assert.deepEqual(normalizeWalletAmountText('\u20aa9007199254740993.01'), { amount: '9007199254740993.01', currency: 'ILS' });
  for (const value of ['Attachment.txt', { text: '\u20aa4.00' }, { filename: 'Attachment.txt' },
    4, ['\u20aa4.00'], '$4.00', 'EUR4.00', 'ILS4.00', '4.00', '\u20aa4,00', '\u20aa4.001', '\u20aa0.00', '\u20aa-4.00', '\u20aa 4.00', '\u20aa4.00\n']) {
    assert.throws(() => normalizeWalletAmountText(value));
  }
  const o = observationFromRequest(purchase({ amount: '\u20aa4.00', occurred_at: null, provider_reference: null }), 'phone');
  assert.equal(o.accounting_amount, '4.00');assert.equal(o.currency, 'ILS');
  assert.equal(o.occurred_at, undefined);assert.equal(o.provider_reference, undefined);
  assert.throws(() => observationFromRequest(purchase({ amount: '\u20aa4.00', currency: 'USD' }), 'phone'));
});

test('Merchant wins over Name; only empty/missing Merchant falls back and unusable values reject', () => {
  assert.equal(preferredMerchant('Israel Post', 'Different name'), 'Israel Post');
  for (const merchant of ['', '  ', null, undefined]) assert.equal(preferredMerchant(merchant, 'Israel Post'), 'Israel Post');
  for (const pair of [[null, null], ['', ''], ['!!!', 'Israel Post'], [{ text: 'Israel Post' }, 'name'],
    ['Attachment.txt', 'name'], ['', { filename: 'Attachment.txt' }], ['merchant', ['name']]]) {
    assert.throws(() => preferredMerchant(...pair));
  }
  const o = observationFromRequest(purchase({ merchant: '', name: 'Israel Post' }), 'phone');
  assert.equal(o.merchant, 'Israel Post');
});

test('Single-card source configuration is server bound and mutually exclusive with client-label mappings', () => {
  const config = { instance_key: 'bound-iphone', request_key: randomUUID(), payment_source_id: '2' };
  const env = environment(token(), config), parsed = sourceConfiguration(env);
  assert.equal(parsed.bound, true);
  assert.deepEqual(parsed.command.configuration.payment_source_ids, ['2']);
  assert.deepEqual(parsed.command.configuration.card_mappings, [{ card_reference: 'apple-shortcut-selected-card', payment_source_id: '2' }]);
  for (const extra of [{ payment_source_id: ['1','2'] }, { payment_source_id: 2 }, { payment_source_id: null },
    { card_mappings: [] }]) assert.throws(() => sourceConfiguration(environment(token(), { ...config, ...extra })));
});

test('Bound HTTP credential rejects client card/source overrides and attachment objects before RPC', async t => {
  const credential = token(), config = { instance_key: 'bound-iphone', request_key: randomUUID(), payment_source_id: '2' };
  const h = await harness(t, { credential, env: environment(credential, config) });
  const p = purchase({ payment_method: undefined, amount: '4.00', merchant: '', name: 'Israel Post' });
  for (const extra of [{ payment_method: '1234' }, { payment_method: null }, { payment_source_id: '1' },
    { source_id: '1' }, { amount: { filename: 'Attachment.txt' } }, { merchant: { text: 'Israel Post' } },
    { name: { filename: 'Attachment.txt' } }]) assert.equal((await h.send({ ...p, ...extra })).status, 400);
  assert.equal(h.calls.length, 0);
  assert.equal((await h.send(p)).status, 201);
  assert.equal(h.calls.find(c => c.name === 'ingest_observation').args.p_observation.payment_evidence.card_reference, 'apple-shortcut-selected-card');
  assert.equal((await h.send(p, { headers: { Authorization: `Bearer ${token()}` } })).status, 401);
});

test('Apple safe response projection cannot disclose candidate/source/payload details', () => {
  const r=safeResult(created({candidate_ids:[7],source_id:'8',secret:'hidden',reason_code:'secret stack text'}));
  assert.equal(r.status,201);assert.equal(r.body.reason_code,'ingestion_rejected');
  for(const key of ['candidate_ids','source_id','secret']) assert.equal(key in r.body,false);
  for(const [outcome,status]of [['created',201],['reconciled',200],['already_observed',200],['ambiguous',202],['conflict',409],['rejected',422]]) assert.equal(safeResult(created({outcome})).status,status);
});

test('Apple real HTTP auth rejects missing/invalid/revoked tokens before any RPC', async t => {
  const h=await harness(t);
  for(const Authorization of ['',`Bearer ${token()}`,'Bearer test-external-key']) assert.equal((await h.send(purchase(),{headers:{Authorization}})).status,401);
  assert.equal(h.calls.length,0);h.env.APPLE_PAY_INGESTION_ENABLED='false';assert.equal((await h.send()).status,503);assert.equal(h.calls.length,0);
});

test('Apple real HTTP delegates to shared ingestion and stable server-selected bootstrap', async t => {
  const h=await harness(t),p=purchase();assert.equal((await h.send(p)).status,201);assert.equal((await h.send(p)).status,201);
  assert.equal(h.calls.filter(c=>c.name==='configure_ingestion_source').length,1);
  const calls=h.calls.filter(c=>c.name==='ingest_observation');assert.equal(calls.length,2);
  assert.equal(calls[0].args.p_source_id,'1');assert.deepEqual(calls[0].args,calls[1].args);
  assert.equal(calls[0].args.p_observation.idempotency_key,p.idempotency_key);
});

test('Apple HTTP validates body, query, origin, method, size and encoding without writes', async t => {
  const h=await harness(t);
  const cases=[ [{source_id:'2'}, {},400], [{transaction_id:'2'}, {},400], [{currency:'USD'}, {},422],
    [{merchant:'x'.repeat(9000)}, {},413], [{}, {raw:'{"broken"'},400], [{}, {raw:'[]'},400],
    [{}, {headers:{'Content-Type':'text/plain'}},415], [{}, {headers:{'Content-Encoding':'gzip'}},415],
    [{}, {headers:{Origin:'https://attacker.invalid'}},403], [{}, {path:PATH+'?token=do-not-log'},400],
    [{}, {method:'GET'},404], [{}, {path:PATH+'/cancel'},404] ];
  for(const [extra,opts,status]of cases) assert.equal((await h.send(purchase(extra),opts)).status,status);
  assert.equal(h.calls.length,0);
});

test('Apple post-auth rate limit counts retries and rotation together, returns safe 429', async t => {
  const h=await harness(t,{limits:{source:2}}),p=purchase();await h.send(p);await h.send(p);
  const rotated=token();h.env.APPLE_PAY_PREVIOUS_TOKEN_SHA256=digest(rotated);
  const r=await h.send(p,{headers:{Authorization:`Bearer ${rotated}`}});assert.equal(r.status,429);assert.equal(r.body.reason_code,'rate_limited');assert.ok(r.headers.get('retry-after'));
});

test('Apple invalid-token abuse is bounded independently of successful-source limit', async t => {
  const h=await harness(t,{limits:{ip:2}});for(let n=0;n<2;n++)assert.equal((await h.send(purchase(),{headers:{Authorization:''}})).status,401);
  assert.equal((await h.send(purchase(),{headers:{Authorization:''}})).status,429);assert.equal(h.calls.length,0);
});

test('Apple RPC failures and logs cannot leak headers, tokens, merchant or query strings', async t => {
  const secret='raw-sensitive-error';const h=await harness(t,{db:{rpc:async()=>{throw new Error(secret);}}});
  const r=await h.send(purchase({merchant:'private merchant'}));assert.equal(r.status,503);
  await h.send(purchase(),{path:PATH+'?credential='+h.credential});
  const all=JSON.stringify({body:r.body,logs:h.logs});for(const forbidden of [secret,h.credential,'private merchant','credential=']) assert.ok(!all.includes(forbidden));
});

test('Apple request errors and bootstrap failures never become cached successful setup', async t => {
  let setups=0;const h=await harness(t,{db:{rpc:async name=>{
    if(name==='configure_ingestion_source'&&++setups===1)return {error:{code:'PGRST202',message:'missing migration'}};
    return {data:name==='configure_ingestion_source'?{source_id:'1'}:created()};
  }}});const p=purchase();assert.equal((await h.send(p)).status,503);assert.equal((await h.send(p)).status,201);
});

test('Apple malformed or ambiguous server configuration fails closed without bootstrap', async t => {
  const h=await harness(t);h.env.APPLE_PAY_SOURCE_CONFIG='{"secret":"never echo"}';
  const r=await h.send();assert.equal(r.status,503);assert.equal(r.body.reason_code,'apple_configuration_invalid');assert.equal(h.calls.length,0);
});

test('Actual application mounts Apple before generic parser/logger/JWT and preserves legacy boundaries', async t => {
  const Module=require('node:module'),paths=[require.resolve('../config/supabase'),require.resolve('dotenv'),require.resolve('../index'),require.resolve('@supabase/supabase-js')];
  const previous=paths.map(p=>require.cache[p]),originalEnv={...process.env},oldLog=console.info,logs=[];
  const credential=token(),env=environment(credential);
  Object.assign(process.env,env,{SUPABASE_URL:'http://127.0.0.1:1',SUPABASE_KEY:'test-only',EXTERNAL_API_KEY:'external-only',LOAN_JOB_SECRET:'test-only'});
  const db={rpc:async name=>({data:name==='configure_ingestion_source'?{source_id:'1'}:created()}),auth:{getUser:async()=>({error:{message:'unauthorized'}})}};
  for(const [p,exports]of [[paths[0],db],[paths[1],{config:()=>({})}],[paths[3],{createClient:()=>db}]]){require.cache[p]=new Module(p);require.cache[p].loaded=true;require.cache[p].exports=exports;}
  delete require.cache[paths[2]];console.info=record=>logs.push(record);
  t.after(()=>{console.info=oldLog;for(const k of Object.keys(process.env))if(!(k in originalEnv))delete process.env[k];Object.assign(process.env,originalEnv);paths.forEach((p,i)=>{if(previous[i])require.cache[p]=previous[i];else delete require.cache[p];});});
  const app=require('../index'),base=await listen(t,app);
  const r=await fetch(base+PATH,{method:'POST',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify(purchase())});
  assert.equal(r.status,201);assert.ok(r.headers.get('x-content-type-options'));assert.equal((await r.json()).outcome,'created');
  const large=await fetch(base+PATH,{method:'POST',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify({merchant:'x'.repeat(9000)})});assert.equal(large.status,413);
  const other=await fetch(base+'/api/v1/transactions',{method:'POST',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:'{}'});assert.equal(other.status,401);
  const jwt=await fetch(base+'/api/transactions',{headers:{Authorization:`Bearer ${credential}`}});assert.equal(jwt.status,401);
  assert.ok(logs.every(l=>!l.includes(credential)));assert.equal((await fetch(base+'/health')).status,200);
});
