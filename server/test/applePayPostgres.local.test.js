// HTTP -> actual adapter/service -> PostgreSQL RPC. Only Supabase transport is
// replaced by psql against this labeled, portless, disposable synthetic database.
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { harness, purchase, environment, configuration, token } = require('./helpers/applePayHttp');
const ingestion = require('../services/transactionIngestionService');
const container = `finance-apy03-${process.pid}`;
let started = false, sequence = 0;
const run = (args, input, allow = false) => {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60000, maxBuffer: 16e6 });
  if (!allow) assert.equal(r.status, 0, r.stderr || r.error?.message);
  return r;
};
const quote = x => `'${String(typeof x === 'object' ? JSON.stringify(x) : x).replaceAll("'", "''")}'`;
const sql = (db, input) => run(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq'], input).stdout.trim();
const json = (db, input) => JSON.parse(sql(db, input));
const signatures = {
  configure_ingestion_source: ['p_request_key', 'p_command'], ingest_observation: ['p_source_id', 'p_observation'],
  cancel_ingested_transaction: ['p_request_key', 'p_command'],
};
const dbClient = db => ({ rpc: (name, args) => new Promise(resolve => {
  assert.ok(signatures[name]);
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq']);
  let out = '';child.stdout.on('data', chunk => { out += chunk; });child.stderr.resume();
  child.on('error', () => resolve({ error: { code: 'TEST_TRANSPORT' } }));
  child.on('close', code => resolve(code === 0 ? { data: JSON.parse(out.trim()) } : { error: { code: 'TEST_SQL' } }));
  child.stdin.end(`SET ROLE service_role; SET lock_timeout='10s'; SELECT ${name}(${signatures[name].map(k => quote(args[k])).join(',')});`);
}) });
const make = async (t, extra = {}) => {
  const db = `case_${++sequence}`;sql('postgres', `CREATE DATABASE ${db} TEMPLATE apy03_clean;`);
  sql(db, "INSERT INTO payment_sources(id,name,slug,method,last4) VALUES(1,'physical card one','one','credit_card','1234'),(2,'physical card two','two','credit_card','1234'); INSERT INTO categories(id,name,type) VALUES(100,'ordinary','expense');");
  const client = dbClient(db), h = await harness(t, { db: client, ...extra });return { ...h, db, client };
};
const totals = c => json(c.db, "SELECT jsonb_build_object('count',count(*),'amount',sum(total_amount)::numeric(30,2)::text) FROM transactions WHERE voided_at IS NULL;");
const cal = async (c, count=1, extra={}) => {
  const source = await ingestion.configureSource(c.client, randomUUID(), { source_kind:'cal',instance_key:'test-cal',actor:'fixture',configuration:{payment_source_ids:['1'],time_verified:true} });
  const results=[];for(let n=0;n<count;n++)results.push(await ingestion.ingestObservation(c.client,source.source_id,{
    idempotency_key:randomUUID(),merchant:'AROMA',accounting_amount:'84.90',currency:'ILS',movement_type:'expense',transaction_date:'2026-09-22',payment_source_id:'1',category_id:'100',...extra,
  }));return results;
};
before(async () => {
  run(['run','-d','--rm','--name',container,'--label','finance.disposable=apy03','-e','POSTGRES_PASSWORD=local_test_only','postgres:16-alpine']);started=true;
  const info=JSON.parse(run(['inspect',container]).stdout)[0];assert.equal(info.Config.Labels['finance.disposable'],'apy03');assert.equal(info.Config.Image,'postgres:16-alpine');assert.deepEqual(info.HostConfig.PortBindings||{},{});
  for(let i=0;i<60;i++){if(run(['exec',container,'pg_isready','-U','postgres'],undefined,true).status===0)break;await new Promise(r=>setTimeout(r,200));}
  sql('postgres','CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE DATABASE apy03_clean;');
  sql('apy03_clean',fs.readFileSync(path.join(__dirname,'../full_schema.sql'),'utf8'));
});
after(()=>{if(started)run(['rm','-f',container]);});

test('Apple HTTP new purchase without provider ID creates one immediately live Budget/report transaction', async t => {
  const c=await make(t),r=await c.send();assert.equal(r.status,201);assert.equal(r.body.outcome,'created');assert.deepEqual(totals(c),{count:1,amount:'84.90'});
  assert.equal(sql(c.db,"SELECT count(*) FROM transactions_filtered(p_from=>'2026-09-01',p_to=>'2026-09-30');"),'1');
  assert.equal(sql(c.db,"SELECT sum(total_amount)::numeric(30,2) FROM budget_actual_transactions('2026-09-01','2026-09-30');"),'84.90');
  assert.deepEqual(json(c.db,"SELECT jsonb_build_object('provider',provider_reference,'occurred',occurred_at,'observed',observed_at IS NOT NULL) FROM transaction_source_observations WHERE evidence_origin='source';"),{provider:null,occurred:null,observed:true});
  for(const table of ['savings_entries','loan_payments','transaction_items','shopping_checkouts','budget_operations'])assert.equal(sql(c.db,`SELECT count(*) FROM ${table};`),'0');
});

test('Apple actual HTTP replay and changed-key payload return stable IDs / deterministic conflict', async t => {
  const c=await make(t),p=purchase(),a=await c.send(p),b=await c.send(p),conflict=await c.send({...p,amount:'84.91'});
  assert.equal(b.status,200);assert.equal(b.body.outcome,'already_observed');assert.equal(b.body.transaction_id,a.body.transaction_id);assert.equal(conflict.status,409);assert.equal(conflict.body.reason_code,'idempotency_key_conflict');
  assert.deepEqual(totals(c),{count:1,amount:'84.90'});assert.equal(sql(c.db,'SELECT count(*) FROM transaction_source_observations;'),'1');
});

test('Apple lost response after committed RPC can retry same invocation UUID without second cash', async t => {
  const c=await make(t),original=c.client.rpc;let lose=true;
  c.client.rpc=async(name,args)=>{const result=await original(name,args);if(name==='ingest_observation'&&lose){lose=false;throw new Error('simulated lost response');}return result;};
  const p=purchase();assert.equal((await c.send(p)).status,503);assert.equal(totals(c).count,1);
  const retried=await c.send(p);assert.equal(retried.status,200);assert.equal(retried.body.replayed,true);assert.equal(totals(c).count,1);
});

test('Apple concurrent HTTP delivery of one UUID commits one cash and observation', async t => {
  const c=await make(t),p=purchase(),results=await Promise.all([c.send(p),c.send(p)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);assert.equal(results[0].body.observation_id,results[1].body.observation_id);assert.equal(totals(c).count,1);
});

test('Apple independent invocation UUIDs for equal purchases remain separate', async t => {
  const c=await make(t);assert.equal((await c.send()).status,201);assert.equal((await c.send()).status,201);assert.deepEqual(totals(c),{count:2,amount:'169.80'});
});

test('Apple strong CAL-first candidate attaches with zero new cash and preserves user category/description', async t => {
  const c=await make(t),[prior]=await cal(c);sql(c.db,`UPDATE transactions SET description='owner correction',notes='keep' WHERE id=${prior.transaction_id};`);
  const r=await c.send();assert.equal(r.status,200);assert.equal(r.body.outcome,'reconciled');assert.equal(r.body.transaction_id,prior.transaction_id);assert.equal(totals(c).count,1);
  assert.deepEqual(json(c.db,'SELECT jsonb_build_object(\'description\',description,\'notes\',notes,\'category\',category_id::text) FROM transactions;'),{description:'owner correction',notes:'keep',category:'100'});
});

test('Apple CAL-first ambiguous HTTP capture and retry create no avoidable financial duplicate', async t => {
  const c=await make(t);await cal(c,2);const p=purchase(),r=await c.send(p),replay=await c.send(p);
  assert.equal(r.status,202);assert.equal(r.body.transaction_id,null);assert.equal(r.body.review_required,true);assert.equal(replay.status,200);assert.equal(replay.body.disposition,'pending');
  assert.equal('candidate_ids' in r.body,false);assert.equal('source_id' in r.body,false);assert.deepEqual(totals(c),{count:2,amount:'169.80'});
  assert.equal(sql(c.db,"SELECT sum(total_amount)::numeric(30,2) FROM budget_actual_transactions('2026-09-01','2026-09-30');"),'169.80');
});

test('Apple cancelled candidate is conflict without resurrection; identity edits remain conflict', async t => {
  const c=await make(t),[prior]=await cal(c),fingerprint=sql(c.db,`SELECT apy_cash_fingerprint(${prior.transaction_id});`);
  await ingestion.cancelIngestedTransaction(c.client,randomUUID(),{transaction_id:prior.transaction_id,expected_revision:prior.decision_revision,expected_transaction_fingerprint:fingerprint,actor:'test-owner',reason:'cancelled'});
  const r=await c.send();assert.equal(r.status,409);assert.equal(r.body.reason_code,'cancelled_record_exists');assert.equal(totals(c).count,0);assert.equal(sql(c.db,'SELECT count(*) FROM transactions;'),'1');
  const second=await make(t),[edited]=await cal(second);sql(second.db,`UPDATE transactions SET total_amount=85 WHERE id=${edited.transaction_id};`);
  const conflict=await second.send();assert.equal(conflict.status,409);assert.equal(conflict.body.reason_code,'identity_edited');assert.deepEqual(totals(second),{count:1,amount:'85.00'});
});

test('Apple mapping is exact Wallet identity, not physical last4 or first matching card', async t => {
  const credential=token(),config=configuration();config.card_mappings.push({card_reference:'Other Wallet card',payment_source_id:'2'});
  const c=await make(t,{credential,env:environment(credential,config)});
  for(const payment_method of ['1234','unknown card']){const r=await c.send(purchase({payment_method}));assert.equal(r.status,422);assert.equal(r.body.reason_code,'payment_source_not_found');}
  assert.equal(totals(c).count,0);assert.equal((await c.send(purchase({payment_method:'Other Wallet card'}))).status,201);
  assert.equal(sql(c.db,'SELECT payment_source_id FROM transactions;'),'2');
});

test('Apple occurrence precision/offset/date-only evidence is retained without receipt-time substitution', async t => {
  const c=await make(t),p=purchase({occurred_at:'2026-09-22T23:59:40.123456+03:00'});await c.send(p);
  assert.equal(sql(c.db,'SELECT occurred_at_raw FROM transaction_source_observations;'),p.occurred_at);
  assert.equal(sql(c.db,'SELECT time_precision FROM transaction_source_observations;'),'fractional_6');
  const r=await c.send(purchase({transaction_date:undefined,occurred_at:'2026-09-22T22:30Z'}));assert.equal(r.status,201);
  assert.equal(sql(c.db,`SELECT transaction_date FROM transactions WHERE id=${r.body.transaction_id};`),'2026-09-23');
  await c.send(purchase({occurred_at:'2026-09-22T10:15'}));assert.equal(sql(c.db,"SELECT count(*) FROM transaction_source_observations WHERE occurred_at IS NULL AND occurred_at_raw IS NOT NULL;"),'1');
});

test('Apple capture-date fallback keeps local accounting day, null source time and immutable retry evidence', async t => {
  const c = await make(t);
  // Synthetic Shortcut output: local 00:02 on Sept 23, while UTC is still Sept 22.
  // This verifies the server protocol, not execution of the owner's Shortcut.
  const p = purchase({ transaction_date: '2026-09-23', occurred_at: null, provider_reference: null });
  const before = sql(c.db, 'SELECT clock_timestamp();');
  const first = await c.send(p);
  assert.equal(first.status, 201);
  const after = sql(c.db, 'SELECT clock_timestamp();');
  const evidence = () => json(c.db, `SELECT jsonb_build_object(
    'date', source_transaction_date, 'occurred', occurred_at, 'raw', occurred_at_raw,
    'precision', time_precision, 'provider', provider_reference,
    'observed', observed_at, 'receipt_in_window', observed_at BETWEEN ${quote(before)}::timestamptz AND ${quote(after)}::timestamptz
  ) FROM transaction_source_observations WHERE id=${first.body.observation_id};`);
  const original = evidence();
  assert.equal(original.date, '2026-09-23');
  for (const key of ['occurred', 'raw', 'precision', 'provider']) assert.equal(original[key], null);
  assert.equal(original.receipt_in_window, true);
  assert.equal(sql(c.db, `SELECT transaction_date FROM transactions WHERE id=${first.body.transaction_id};`), '2026-09-23');
  // A next-day resubmission must reuse the original payload, not recompute Current Date.
  const restarted = await harness(t, { db: c.client, credential: c.credential, env: c.env });
  const replay = await restarted.send(p);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.transaction_id, first.body.transaction_id);
  assert.deepEqual(evidence(), original);
  const changedDate = await restarted.send({ ...p, transaction_date: '2026-09-24' });
  assert.equal(changedDate.status, 409);
  assert.equal(changedDate.body.reason_code, 'idempotency_key_conflict');
  assert.deepEqual(totals(c), { count: 1, amount: '84.90' });
  // An adjacent-day, date-only card observation must not silently attach or add cash.
  const [card] = await cal(c);
  assert.equal(card.outcome, 'ambiguous');
  assert.equal(card.transaction_id, null);
  assert.deepEqual(totals(c), { count: 1, amount: '84.90' });
});

test('Apple registered-source revocation blocks a cached adapter; token rotation retains source/retry identity', async t => {
  const c=await make(t),p=purchase(),a=await c.send(p),credential=token();c.env.APPLE_PAY_TOKEN_SHA256=require('./helpers/applePayHttp').digest(credential);
  const replay=await c.send(p,{headers:{Authorization:`Bearer ${credential}`}});assert.equal(replay.status,200);assert.equal(replay.body.observation_id,a.body.observation_id);
  const sid=sql(c.db,"SELECT id FROM transaction_ingestion_sources WHERE source_kind='apple_pay';");
  await ingestion.configureSource(c.client,randomUUID(),{source_kind:'apple_pay',instance_key:'test-iphone',expected_revision:'1',is_active:false,configuration:{payment_source_ids:['1']},actor:'test-owner'});
  const rejected=await c.send(p,{headers:{Authorization:`Bearer ${credential}`}});assert.equal(rejected.status,503);assert.equal(rejected.body.reason_code,'source_unavailable');assert.equal(totals(c).count,1);assert.ok(sid);
});

test('Bound source posts coerced text/fallback merchant to one configured card; replay and overrides are safe', async t => {
  const credential = token();
  const config = { instance_key: 'bound-iphone', request_key: randomUUID(), payment_source_id: '2' };
  const c = await make(t, { credential, env: environment(credential, config) });
  const p = purchase({ payment_method: undefined, amount: '\u20aa4.00', merchant: '', name: 'Israel Post', occurred_at: null, provider_reference: null });
  const first = await c.send(p);assert.equal(first.status, 201);
  assert.deepEqual(json(c.db, "SELECT jsonb_build_object('source',payment_source_id::text,'amount',total_amount::numeric(30,2)::text,'merchant',description) FROM transactions;"),
    { source: '2', amount: '4.00', merchant: 'Israel Post' });
  assert.equal(sql(c.db, 'SELECT count(*) FROM transaction_source_observations WHERE occurred_at IS NULL AND provider_reference IS NULL;'), '1');
  const replay = await c.send(p);assert.equal(replay.status, 200);assert.equal(replay.body.observation_id, first.body.observation_id);
  assert.equal((await c.send({ ...p, amount: '4.01' })).status, 409);
  for (const extra of [{ payment_source_id: '1' }, { payment_method: '1234' }, { payment_method: 'physical card one' },
    { source_id: '1' }, { amount: { filename: 'Attachment.txt' } }]) assert.equal((await c.send({ ...p, ...extra })).status, 400);
  assert.deepEqual(totals(c), { count: 1, amount: '4.00' });
  // A separate valid invocation uses the same binding and Merchant wins, even when Name differs.
  const next = await c.send({ ...p, idempotency_key: randomUUID(), merchant: 'Preferred merchant', name: 'Other name' });
  assert.equal(next.status, 201);
  assert.equal(sql(c.db, `SELECT description FROM transactions WHERE id=${next.body.transaction_id};`), 'Preferred merchant');
  const restarted = await harness(t, { db: c.client, credential, env: c.env });
  assert.equal((await restarted.send(p)).body.transaction_id, first.body.transaction_id);
});

test('Apple restart bootstraps idempotently and accepted retry survives a later card mapping change', async t => {
  const c=await make(t),p=purchase(),a=await c.send(p),other=await harness(t,{db:c.client,credential:c.credential,env:c.env});
  assert.equal((await other.send(p)).body.observation_id,a.body.observation_id);assert.equal(sql(c.db,"SELECT count(*) FROM transaction_reconciliation_events WHERE event_kind='source_configuration';"),'1');
  await ingestion.configureSource(c.client,randomUUID(),{source_kind:'apple_pay',instance_key:'test-iphone',expected_revision:'1',configuration:{payment_source_ids:['2'],card_mappings:[{card_reference:'Wallet test card',payment_source_id:'2'}]},actor:'test-owner'});
  assert.equal((await c.send(p)).body.transaction_id,a.body.transaction_id);const fresh=await c.send();assert.equal(fresh.status,201);assert.equal(sql(c.db,`SELECT payment_source_id FROM transactions WHERE id=${fresh.body.transaction_id};`),'2');
});
