// Disposable, portless PostgreSQL only. Never loads .env or a network DB URL.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config/flowlink');
const { harness, claim, token, ownerId, otherOwnerId } = require('./helpers/flowlinkHttp');
const full = fs.readFileSync(path.join(__dirname, '../full_schema.sql'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../migrations/045_cal_reconciliation.sql'), 'utf8');
const baseline = full.split('-- Migration 045:')[0];
const container = `finance-cal04-${process.pid}`;
let started = false, sequence = 0;
const run = (args, input, allow = false) => {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60000, maxBuffer: 32e6 });
  if (!allow) assert.equal(r.status, 0, r.stderr || r.error?.message);
  return r;
};
const sql = (db, text, allow = false) => run(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq'], text, allow);
const scalar = (db, text) => sql(db, text).stdout.trim();
const json = (db, text) => JSON.parse(scalar(db, text));
const quote = v => v === null ? 'NULL' : `'${String(typeof v === 'object' ? JSON.stringify(v) : v).replaceAll("'", "''")}'`;
const signatures = {
  ingest_cal_v1: ['p_request_key','p_source','p_observation','p_request'],
  resolve_observation: ['p_request_key','p_command'], get_ingestion_observation: ['p_observation_id'],
  cancel_ingested_transaction: ['p_request_key','p_command'],
  create_flowlink_binding: ['p_owner_id', 'p_request_key', 'p_command'],
  update_flowlink_binding: ['p_owner_id', 'p_request_key', 'p_command'],
  list_flowlink_owner_bindings: ['p_device_id', 'p_cursor'], list_flowlink_payment_sources: ['p_cursor'],
  list_flowlink_bindings: ['p_credential_sha256'], ingest_flowlink_observation: ['p_credential_sha256', 'p_request'],
  configure_ingestion_source: ['p_request_key', 'p_command'], ingest_observation: ['p_source_id', 'p_observation'],
  create_flowlink_pairing: ['p_owner_id', 'p_pairing_id', 'p_secret_sha256', 'p_command'],
  redeem_flowlink_pairing: ['p_pairing_id', 'p_secret_sha256', 'p_redemption_id', 'p_credential_sha256'],
  cancel_flowlink_pairing: ['p_owner_id', 'p_pairing_id'], revoke_flowlink_device: ['p_owner_id', 'p_device_id'],
  get_flowlink_device: ['p_credential_sha256'], list_flowlink_devices: ['p_cursor'], cleanup_flowlink_pairings: [],
};
const statement = (name, args) => {
  assert.ok(signatures[name]);return `SET ROLE service_role; SELECT public.${name}(${signatures[name].map(k => quote(args[k])).join(',')});`;
};
const parallelSql = (db, text) => new Promise((resolve, reject) => {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq']);
  let out = '', err = '';child.stdout.on('data', b => { out += b; });child.stderr.on('data', b => { err += b; });
  child.on('error', reject);child.on('close', status => resolve({ status, out, err }));child.stdin.end(text);
});
const client = db => ({ rpc: async (name, args) => {
  const r = await parallelSql(db, `SET lock_timeout='10s';${statement(name, args)}`);
  if (r.status) throw new Error(`Disposable SQL failed: ${r.err}`);
  return { data: JSON.parse(r.out.trim()) };
} });
const call = (db, name, args) => json(db, statement(name, args));
const count = (db, table) => Number(scalar(db, `SELECT count(*) FROM ${table};`));
const financialSnapshot = db => json(db, `SELECT jsonb_build_object(
 'transactions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM transactions t),
 'sources',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM transaction_ingestion_sources t),
 'observations',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM transaction_source_observations t),
 'events',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM transaction_reconciliation_events t),
 'savings',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM savings_entries t),
 'loans',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM loan_payments t),
 'budget',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM budget_operations t));`);
async function make(t, options = {}) {
  const db = `case_${++sequence}`;sql('postgres', `CREATE DATABASE ${db} TEMPLATE flowlink_clean;`);
  sql(db, "INSERT INTO payment_sources(id,name,slug,method,is_active) VALUES(1,'Card A','a','credit_card',true),(2,'Card B','b','debit_card',true),(3,'Old','old','credit_card',false);");
  options.env ||= { FLOWLINK_OWNER_USER_IDS: JSON.stringify([ownerId]), FLOWLINK_INGESTION_ENABLED: 'true' };
  const h = await harness(t, { db: client(db), ...options });
  return { ...h, client: h.db, db };
}
const pair = async (c, body = { purpose: 'enroll', label: 'Test phone' }) => {
  const r = await c.send('/owner/pairings', body);assert.equal(r.status, 201, JSON.stringify(r.body));return r.body;
};
const enroll = async c => {
  const pairing = await pair(c), body = claim(pairing), r = await c.send('/pairings/redeem', body);
  assert.equal(r.status, 201, JSON.stringify(r.body));return { pairing, body, result: r.body };
};
const auth = value => ({ headers: { Authorization: `Bearer ${value}` } });
const storedPair = (db, age, status = 'pending') => {
  const p = config.newPairing();
  sql(db, `INSERT INTO flowlink_pairing_capabilities(id,secret_sha256,purpose,device_label,created_by,created_at,expires_at,status)
   VALUES(${quote(p.id)},${quote(config.digest(p.text))},'enroll','Expired test',${quote(ownerId)},
   statement_timestamp()-interval ${quote(age)},statement_timestamp()-interval ${quote(age)}+interval '10 minutes',${quote(status)});`);
  return { pairing_id: p.id, pairing_text: p.text };
};
before(async () => {
  run(['run', '-d', '--rm', '--name', container, '--label', 'finance.disposable=cal04', '-e', 'POSTGRES_PASSWORD=local_test_only', 'postgres:16-alpine']);started = true;
  const info = JSON.parse(run(['inspect', container]).stdout)[0];assert.equal(info.Config.Labels['finance.disposable'], 'cal04');
  assert.equal(info.Config.Image, 'postgres:16-alpine');assert.deepEqual(info.HostConfig.PortBindings || {}, {});
  for (let i = 0; i < 60; i++) { if (run(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], undefined, true).status === 0) break; await new Promise(r => setTimeout(r, 200)); }
  sql('postgres', 'CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE DATABASE flowlink_clean;CREATE DATABASE flowlink_baseline;');
  sql('flowlink_baseline', baseline);sql('flowlink_clean', full);
});
after(() => { if (started) run(['rm', '-f', container]); });

const binding = async (c, e, payment = '1') => {
  const body = { request_id: randomUUID(), label: 'My card', payment_source_id: payment };
  const r = await c.send(`/owner/devices/${e.result.device_id}/bindings`, body);
  assert.equal(r.status, 201, JSON.stringify(r.body));return { ...r.body, command: body };
};
const setup = async t => { const c = await make(t), e = await enroll(c), b = await binding(c, e);return { c, e, b }; };
const purchase = b => ({ binding_id: b.id, idempotency_key: randomUUID(), amount: '4.00', currency: 'ILS', merchant: 'Israel Post', transaction_date: '2026-09-26' });
const send = (c, e, p) => c.send('/wallet-transactions', p, auth(e.body.device_credential));
const patch = (c, b, changes, command) => c.send(`/owner/bindings/${b.id}`, command || { request_id: randomUUID(), expected_revision: b.revision, ...changes }, { method: 'PATCH' });
const nativeArgs = (e, p) => ({ p_credential_sha256: config.digest(e.body.device_credential), p_request: p });
const cash = c => json(c.db, "SELECT jsonb_build_object('count',count(*),'amount',coalesce(sum(total_amount),0)::text) FROM transactions WHERE voided_at IS NULL;");

const calService = require('../services/calIngestionService');
const profile = () => ({ instance_key: 'test-cal-card', request_key: randomUUID(), payment_source_name: 'Synthetic card', payment_source_id: '1' });
const calBody = (extra = {}) => ({ type: 'expense', amount: 4, date: '2026-09-26', description: 'Israel Post',
 charge_date: '2026-09-28', payment_source_name: 'Synthetic card', currency: 'ILS', original_amount: 4,
 external_id: randomUUID(), ...extra });
const calSend = (c, p, body) => calService.handleCal({ ...c.client,
 from: table => { assert.equal(table,'categories'); return {select: async()=>({data:json(c.db, "SELECT coalesce(jsonb_agg(c),'[]') FROM categories c;")})}; }
}, p, body);
const cashRow = (c, id) => json(c.db, `SELECT to_jsonb(t) FROM transactions t WHERE id=${Number(id)};`);
const sourceCount = c => Number(scalar(c.db,"SELECT count(*) FROM transaction_source_observations WHERE evidence_origin='source';"));

for (const appleFirst of [true,false]) test(`CAL adapter / native both arrival orders: appleFirst=${appleFirst}`, async t => {
 const {c,e,b}=await setup(t),p=profile(),body=calBody(),capture=purchase(b);
 const first=appleFirst ? await send(c,e,capture) : await calSend(c,p,body);
 const second=appleFirst ? await calSend(c,p,body) : await send(c,e,capture);
 assert.equal(first.status,201);assert.equal(second.status,200);assert.equal(second.body.outcome,'reconciled');
 assert.equal(cash(c).count,1);assert.equal(sourceCount(c),2);
 const row=cashRow(c,first.body.transaction_id);assert.equal(row.external_id,null);
 assert.equal(scalar(c.db,`SELECT external_id FROM cal_ingestion_receipts WHERE observation_id IN (SELECT id FROM transaction_source_observations WHERE transaction_id=${first.body.transaction_id});`),body.external_id);
 assert.equal(row.transaction_date,'2026-09-26');assert.equal(row.charge_date,'2026-09-28');
 assert.equal(row.description,'Israel Post');assert.equal(row.payment_source_id,1);
 assert.equal(Number(row.total_amount),4);assert.equal(row.category_id,null);
 assert.equal(scalar(c.db,"SELECT sum(total_amount)::numeric(18,2) FROM budget_actual_transactions('2026-09-01','2026-09-30');"),'4.00');
 assert.equal(scalar(c.db,"SELECT count(*) FROM transactions_filtered(p_from=>'2026-09-01',p_to=>'2026-09-30');"),'1');
 const retry=await calSend(c,p,body);assert.equal(retry.status,409);assert.equal(retry.body.error,'already_exists');
 assert.equal((await send(c,e,capture)).body.outcome,'already_observed');assert.equal(cash(c).count,1);
});

for (const appleFirst of [true,false]) test(`differing provider names retain pending review, appleFirst=${appleFirst}`, async t => {
 const {c,e,b}=await setup(t),p=profile(),body=calBody({amount:10,original_amount:10,description:"\u05e0\u05d9\u05e0\u05d2'\u05d4 \u05e1\u05d8\u05d0\u05e8"}),capture={...purchase(b),amount:'10.00',merchant:'Ninja Star Ltd'};
 const first=appleFirst ? await send(c,e,capture) : await calSend(c,p,body);
 const second=appleFirst ? await calSend(c,p,body) : await send(c,e,capture);
 assert.equal(second.status,202);assert.equal(second.body.outcome,'ambiguous');assert.equal(second.body.transaction_id,null);
 assert.equal(cash(c).count,1);assert.equal(sourceCount(c),2);
 const repeat=appleFirst ? await calSend(c,p,body) : await send(c,e,capture);
 assert.equal(repeat.body.replayed,true);assert.equal(cash(c).count,1);
 assert.equal(cashRow(c,first.body.transaction_id).description,appleFirst?'Ninja Star Ltd':body.description);
});

test('two legitimate equal purchases remain two cash rows; two CAL keys stay independently pending',async t=>{
 const {c,e,b}=await setup(t),p=profile();
 const a=await send(c,e,{...purchase(b),amount:'6.00'}),bb=await send(c,e,{...purchase(b),amount:'6.00'});
 assert.notEqual(a.body.transaction_id,bb.body.transaction_id);
 const bodies=[calBody({amount:6,original_amount:6,description:'Nayax provider text',external_id:'1234567890abcdef'}),
 calBody({amount:6,original_amount:6,description:'Nayax provider text',external_id:'1234567890abcdef|#2'})];
 for(const body of bodies){assert.equal((await calSend(c,p,body)).status,202);assert.equal((await calSend(c,p,body)).status,202);}
 assert.equal(cash(c).count,2);assert.equal(sourceCount(c),4);assert.equal(Number(cash(c).amount),12);
});

test('CAL-only occurrence suffixes create separate purchases and preserve initial category/notes/tags',async t=>{
 const c=await make(t),p=profile();sql(c.db,"INSERT INTO categories(id,name,type) VALUES(101,'Food','expense');");
 const a=calBody({category_id:101,notes:'source note',tags:['one','two'],external_id:'1234567890abcdef'});
 assert.equal((await calSend(c,p,a)).status,201);assert.equal((await calSend(c,p,{...a,external_id:a.external_id+'|#2'})).status,201);
 assert.equal(cash(c).count,2);const row=json(c.db,'SELECT to_jsonb(t) FROM transactions t ORDER BY id LIMIT 1;');
 assert.equal(row.notes,'source note');assert.equal(row.tags,'one,two');assert.equal(row.category_id,101);
 assert.equal((await calSend(c,p,{...a,amount:5,original_amount:5})).status,422);assert.equal(cash(c).count,2);
});

test('concurrent arrivals and concurrent same-key deliveries keep one financial effect',async t=>{
 const {c,e,b}=await setup(t),p=profile(),body=calBody(),capture=purchase(b);
 const r=await Promise.all([send(c,e,capture),calSend(c,p,body),calSend(c,p,body)]);
 assert.deepEqual(r.map(x=>x.status).sort(),[200,201,409]);assert.equal(cash(c).count,1);assert.equal(sourceCount(c),2);
});

test('owner edits survive attachment and charge-date overrides are not overwritten',async t=>{
 const {c,e,b}=await setup(t),p=profile(),created=await send(c,e,purchase(b));
 sql(c.db,`UPDATE transactions SET description='Owner corrected',notes='owner',tags='kept',charge_date='2026-10-01' WHERE id=${created.body.transaction_id};`);
 const r=await calSend(c,p,calBody({notes:'provider',tags:['replace']}));
 assert.equal(r.status,200);assert.equal(r.body.review_required,true);
 const row=cashRow(c,created.body.transaction_id);assert.equal(row.description,'Owner corrected');assert.equal(row.notes,'owner');assert.equal(row.tags,'kept');assert.equal(row.charge_date,'2026-10-01');
});

test('historical legacy and manual cash are review sentinels, never automatically reclassified',async t=>{
 const {c,e,b}=await setup(t);
 sql(c.db,"INSERT INTO transactions(total_amount,movement_type,transaction_date,charge_date,description,payment_source_id,external_id) VALUES(4,'expense','2026-09-26','2026-09-28','Old CAL',1,'old-cal');");
 assert.equal((await send(c,e,purchase(b))).status,202);assert.equal(cash(c).count,1);
 assert.equal((await calSend(c,profile(),calBody({external_id:'old-cal'}))).status,409);
 assert.equal(scalar(c.db,"SELECT count(*) FROM transaction_source_observations WHERE evidence_origin='legacy_insert';"),'1');
});

test('dry run performs no source/observation/cash writes; foreign accounting fails instead of legacy fallthrough',async t=>{
 const c=await make(t),p=profile(),before=financialSnapshot(c.db);
 assert.equal((await calSend(c,p,calBody({dry_run:true}))).body.matching_deferred,true);
 assert.deepEqual(financialSnapshot(c.db),before);
 await assert.rejects(calSend(c,p,calBody({currency:'USD'})),e=>e.calCode==='cal_supported_ils_purchase_required');
 assert.deepEqual(financialSnapshot(c.db),before);
});

test('registered CAL cannot fall back to legacy writes and pending external IDs stay reserved',async t=>{
 const {c,e,b}=await setup(t);await send(c,e,purchase(b));const body=calBody({description:'Different'});
 assert.equal((await calSend(c,profile(),body)).status,202);
 const r=sql(c.db,`INSERT INTO transactions(total_amount,movement_type,transaction_date,payment_source_id,external_id) VALUES(4,'expense','2026-09-26',1,${quote(body.external_id)});`,true);
 assert.notEqual(r.status,0);
 const bypass=sql(c.db,"INSERT INTO transactions(total_amount,movement_type,transaction_date,payment_source_id,external_id) VALUES(4,'expense','2026-09-26',1,'new-legacy-key');",true);assert.notEqual(bypass.status,0);
 assert.equal(cash(c).count,1);
});

test('pending owner link/separate use existing revision/fingerprint RPC and replay no cash',async t=>{
 const {c,e,b}=await setup(t),p=profile(),a=await send(c,e,purchase(b));
 const pending=await calSend(c,p,calBody({description:'Different'}));
 const detail=call(c.db,'get_ingestion_observation',{p_observation_id:pending.body.observation_id});
 const args={p_request_key:randomUUID(),p_command:{observation_id:pending.body.observation_id,expected_revision:detail.decision_revision,action:'link',transaction_id:a.body.transaction_id,
 expected_transaction_fingerprint:scalar(c.db,`SELECT public.apy_cash_fingerprint(${a.body.transaction_id});`),reason:'Owner verified receipt',actor:'test owner'}};
 assert.equal(call(c.db,'resolve_observation',args).outcome,'reconciled');assert.equal(call(c.db,'resolve_observation',args).replayed,true);assert.equal(cash(c).count,1);
 const extra=await calSend(c,p,calBody({description:'Another separate',notes:'new note'}));
 const d=call(c.db,'get_ingestion_observation',{p_observation_id:extra.body.observation_id});
 const sep={p_request_key:randomUUID(),p_command:{observation_id:extra.body.observation_id,expected_revision:d.decision_revision,action:'separate',expected_candidate_fingerprints:d.candidate_fingerprints,reason:'Owner verified different purchase',actor:'test owner'}};
 const result=call(c.db,'resolve_observation',sep);assert.equal(result.outcome,'created');assert.equal(cash(c).count,2);assert.equal(cashRow(c,result.transaction_id).notes,'new note');
 assert.equal(call(c.db,'resolve_observation',sep).replayed,true);assert.equal(cash(c).count,2);
});

test('045 upgrade/rerun is additive; RLS/private grants/immutable registry and rollback verified',async t=>{
 const db='upgrade';sql('postgres',`CREATE DATABASE ${db} TEMPLATE flowlink_baseline;`);
 const before=financialSnapshot(db);assert.notEqual(sql(db,migration.replace('COMMIT;','SELECT 1/0;COMMIT;'),true).status,0);
 assert.equal(scalar(db,"SELECT to_regclass('cal_ingestion_receipts') IS NULL;"),'t');
 sql(db,migration);sql(db,migration);assert.deepEqual(financialSnapshot(db),before);
 const defs=d=>json(d,"SELECT jsonb_object_agg(proname,pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace;");
 assert.deepEqual(defs(db),defs('flowlink_clean'));
 for(const role of ['anon','authenticated']) assert.equal(scalar(db,`SELECT has_function_privilege('${role}','ingest_cal_v1(uuid,jsonb,jsonb,jsonb)','execute');`),'f');
 assert.equal(scalar(db,"SELECT has_table_privilege('service_role','cal_ingestion_receipts','INSERT');"),'f');
 assert.equal(scalar(db,"SELECT relrowsecurity FROM pg_class WHERE oid='cal_ingestion_receipts'::regclass;"),'t');
});


test('approved synthetic aliases match without replacing owner description; no alias is learned',async t=>{
 const {c,e,b}=await setup(t),p=profile();
 const src=json(c.db,`SELECT to_jsonb(s) FROM transaction_ingestion_sources s WHERE id=${b.source_id};`);
 const cfg={...src.configuration,aliases:[{merchant:'Wallet Store',key:'approved-store',payment_source_id:'1'}]};
 call(c.db,'configure_ingestion_source',{p_request_key:randomUUID(),p_command:{source_kind:'apple_pay',instance_key:src.instance_key,expected_revision:String(src.revision),configuration:cfg,actor:'test explicit alias approval'}});
 const a=await send(c,e,{...purchase(b),merchant:'Wallet Store'});
 p.aliases=[{merchant:'Official Store',key:'approved-store'}];
 const r=await calSend(c,p,calBody({description:'Official Store'}));assert.equal(r.body.outcome,'reconciled');
 assert.equal(cashRow(c,a.body.transaction_id).description,'Wallet Store');assert.equal(cash(c).count,1);
 assert.equal(scalar(c.db,"SELECT merchant FROM transaction_source_observations WHERE source_id IN (SELECT id FROM transaction_ingestion_sources WHERE source_kind='cal');"),'Official Store');
});

test('independent CAL instances retain distinct keys; global external ID cannot impersonate another source',async t=>{
 const {c,e,b}=await setup(t);await send(c,e,purchase(b));const p=profile(),body=calBody();
 assert.equal((await calSend(c,p,body)).status,200);
 const other={...profile(),instance_key:'other-cal'};
 assert.equal((await calSend(c,other,body)).status,422);
 assert.equal((await calSend(c,other,{...body,external_id:randomUUID()})).status,200);
 assert.equal(cash(c).count,1);assert.equal(sourceCount(c),3);
});

test('late CAL after APY cancellation cannot resurrect or create replacement expense',async t=>{
 const {c,e,b}=await setup(t),a=await send(c,e,purchase(b));
 const d=call(c.db,'get_ingestion_observation',{p_observation_id:a.body.observation_id});
 const cancelled=call(c.db,'cancel_ingested_transaction',{p_request_key:randomUUID(),p_command:{transaction_id:a.body.transaction_id,
 expected_revision:d.decision_revision,expected_transaction_fingerprint:d.expected_transaction_fingerprint,reason:'Synthetic owner cancellation',actor:'test owner'}});
 assert.equal(cancelled.disposition,'cancelled');
 const r=await calSend(c,profile(),calBody());assert.equal(r.status,422);assert.equal(r.body.reason_code,'cancelled_record_exists');assert.equal(cash(c).count,0);
 assert.equal(count(c.db,'transactions'),1);
});

test('CAL receipt failure rolls source registration, observation and canonical cash back together',async t=>{
 const c=await make(t),p=profile(),before=financialSnapshot(c.db);
 sql(c.db,"CREATE FUNCTION fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'injected';END$$;CREATE TRIGGER fail_receipt BEFORE INSERT ON cal_ingestion_receipts FOR EACH ROW EXECUTE FUNCTION fail_receipt();");
 await assert.rejects(calSend(c,p,calBody()),e=>e.calCode==='cal_unavailable');
 assert.deepEqual(financialSnapshot(c.db),before);assert.equal(count(c.db,'cal_ingestion_receipts'),0);
});

test('actual v1 HTTP controller and external authentication use the atomic CAL RPC against PostgreSQL',async t=>{
 const {c,e,b}=await setup(t);const a=await send(c,e,purchase(b)),p=profile();
 const old=process.env.CAL_INGESTION_SOURCES,oldKey=process.env.EXTERNAL_API_KEY;
 process.env.CAL_INGESTION_SOURCES=JSON.stringify([p]);process.env.EXTERNAL_API_KEY='isolated-cal-key';
 t.after(()=>{if(old===undefined)delete process.env.CAL_INGESTION_SOURCES;else process.env.CAL_INGESTION_SOURCES=old;
 if(oldKey===undefined)delete process.env.EXTERNAL_API_KEY;else process.env.EXTERNAL_API_KEY=oldKey;});
 const db={...c.client,from:table=>{assert.equal(table,'categories');return {select:async()=>({data:[]})};}};
 const controller=require('./helpers/fakeSupabase').loadControllerWithFake('../../controllers/v1/transactionController',db);
 const express=require('express'),app=express();app.use(express.json());app.post('/api/v1/transactions',require('../middleware/apiKeyAuth').apiKeyAuth,controller.createTransaction);
 const server=app.listen(0,'127.0.0.1');await require('node:events').once(server,'listening');t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const body=calBody();const callHttp=()=>fetch(`http://127.0.0.1:${server.address().port}/api/v1/transactions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer isolated-cal-key'},body:JSON.stringify(body)});
 const first=await callHttp();assert.equal(first.status,200);assert.equal((await first.json()).transaction_id,a.body.transaction_id);
 assert.equal((await callHttp()).status,409);assert.equal(cash(c).count,1);assert.equal(sourceCount(c),2);
});


test('disabled CAL source rejects even known retries; source identity is not silently reactivated',async t=>{
 const c=await make(t),p=profile(),body=calBody();await calSend(c,p,body);
 sql(c.db,"UPDATE transaction_ingestion_sources SET is_active=false WHERE source_kind='cal';");
 assert.equal((await calSend(c,p,body)).status,503);assert.equal((await calSend(c,p,calBody())).status,503);assert.equal(cash(c).count,1);
});
test('separate review becomes stale when new weak manual evidence arrives',async t=>{
 const {c,e,b}=await setup(t);await send(c,e,purchase(b));
 const r=await calSend(c,profile(),calBody({description:'Different'})),d=call(c.db,'get_ingestion_observation',{p_observation_id:r.body.observation_id});
 sql(c.db,"INSERT INTO transactions(total_amount,movement_type,transaction_date,payment_source_id,description) VALUES(4,'expense','2026-09-26',1,'New manual evidence');");
 const out=call(c.db,'resolve_observation',{p_request_key:randomUUID(),p_command:{observation_id:r.body.observation_id,expected_revision:d.decision_revision,
 action:'separate',expected_candidate_fingerprints:d.candidate_fingerprints,reason:'Stale test',actor:'test'}});
 assert.equal(out.reason_code,'stale_review');assert.equal(cash(c).count,2);
});


test('two CAL-first equal purchases remain two expenses after two differing-name native captures',async t=>{
 const {c,e,b}=await setup(t),p=profile();
 for(const key of ['1122334455667788','1122334455667788|#2']) assert.equal((await calSend(c,p,calBody({amount:6,original_amount:6,description:'Nayax provider text',external_id:key}))).status,201);
 for(let n=0;n<2;n++) assert.equal((await send(c,e,{...purchase(b),amount:'6.00'})).status,202);
 assert.equal(cash(c).count,2);assert.equal(Number(cash(c).amount),12);assert.equal(sourceCount(c),4);
});
test('historical identity edits and installment linkage hold evidence instead of duplicating cash',async t=>{
 const {c,e,b}=await setup(t);
 sql(c.db,"INSERT INTO transactions(total_amount,movement_type,transaction_date,payment_source_id,description,external_id) VALUES(4,'expense','2026-09-26',1,'Old CAL','edited-old');UPDATE transactions SET total_amount=5 WHERE external_id='edited-old';");
 const a=await send(c,e,purchase(b));assert.equal(a.body.reason_code,'identity_edited');assert.equal(cash(c).count,1);
 sql(c.db,"UPDATE transactions SET total_amount=4,installment_count=2 WHERE external_id='edited-old';");
 const r=await calSend(c,profile(),calBody());assert.equal(r.status,422);assert.equal(r.body.reason_code,'protected_transaction');assert.equal(cash(c).count,1);
});
