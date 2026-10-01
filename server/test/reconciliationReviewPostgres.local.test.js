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
const migration = fs.readFileSync(path.join(__dirname, '../migrations/046_reconciliation_review.sql'), 'utf8');
const baseline = full.split('-- Migration 046:')[0];
const container = `finance-apy05-${process.pid}`;
let started = false, sequence = 0;
const run = (args, input, allow = false) => {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60000, maxBuffer: 32e6 });
  if (!allow) assert.equal(r.status, 0, r.stderr || r.error?.message);
  return r;
};
const sql = (db, text, allow = false) => run(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq'], text, allow);
const scalar = (db, text) => sql(db, text).stdout.trim();
const json = (db, text) => JSON.parse(scalar(db, text));
const quote = v => v === null ? 'NULL' : `'${String(Array.isArray(v) ? '{'+v.join(',')+'}' : typeof v === 'object' ? JSON.stringify(v) : v).replaceAll("'", "''")}'`;
const signatures = {
 read_reconciliation:['p_mode','p_ids','p_id'],review_reconciliation:['p_request_key','p_command'],
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
  run(['run', '-d', '--rm', '--name', container, '--label', 'finance.disposable=apy05', '-e', 'POSTGRES_PASSWORD=local_test_only', 'postgres:16-alpine']);started = true;
  const info = JSON.parse(run(['inspect', container]).stdout)[0];assert.equal(info.Config.Labels['finance.disposable'], 'apy05');
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

const readReview=(c,mode,id=null,ids=[])=>call(c.db,'read_reconciliation',{p_mode:mode,p_ids:ids,p_id:id});
const decision=(d,target)=>({p_request_key:randomUUID(),p_command:{observation_id:d.observation.id,expected_revision:d.observation.revision,
 action:target?'link':'separate',expected_candidate_fingerprints:d.candidate_fingerprints,
 ...(target?{transaction_id:target.id,expected_transaction_fingerprint:target.fingerprint}:{}),actor:`owner:${ownerId}`,reason:'Explicit isolated owner decision'}});
for(const appleFirst of [true,false])test(`safe projections and owner link preserve one real expense, appleFirst=${appleFirst}`,async t=>{
 const {c,e,b}=await setup(t),p=profile(),native={...purchase(b),amount:'10.00',merchant:'Ninja Star Ltd',transaction_date:'2026-09-30'},cal=calBody({amount:10,original_amount:10,description:'נינג\'ה סטאר',date:'2026-09-30',charge_date:'2026-10-01'});
 const first=appleFirst?await send(c,e,native):await calSend(c,p,cal);
 sql(c.db,`UPDATE transactions SET description='Owner description',notes='Keep' WHERE id=${first.body.transaction_id};`);
 const before=readReview(c,'summary',null,[Number(first.body.transaction_id)]);assert.equal(before.transactions[first.body.transaction_id].status,appleFirst?'awaiting_cal':'cal_only');
 const second=appleFirst?await calSend(c,p,cal):await send(c,e,native);assert.equal(second.status,202);
 const queue=readReview(c,'pending');assert.equal(queue.items.length,1);assert.equal(queue.items[0].transaction_id,null);
 const d=readReview(c,'observation',second.body.observation_id);assert.equal(d.candidates.length,1);assert.equal(d.candidates[0].can_link,true);
 const serialized=JSON.stringify(d);for(const forbidden of ['accepted_payload','credential','idempotency_key','source_id','provider_reference','authorization'])assert.equal(serialized.includes(forbidden),false);
 assert.equal(d.observation.occurred_at,null);assert.ok(d.observation.observed_at);assert.match(d.observation.payment_context,/credit_card/);
 const args=decision(d,d.candidates[0]),results=await Promise.all([parallelSql(c.db,statement('review_reconciliation',args)),parallelSql(c.db,statement('review_reconciliation',args))]);
 for(const r of results)assert.equal(r.status,0,r.err);
 assert.equal(results.map(r=>JSON.parse(r.out)).filter(r=>r.replayed).length,1);
 assert.equal(cash(c).count,1);assert.equal(Number(cash(c).amount),10);assert.equal(readReview(c,'pending').items.length,0);
 assert.equal(readReview(c,'summary',null,[Number(first.body.transaction_id)]).transactions[first.body.transaction_id].status,'reconciled');
 const tx=readReview(c,'transaction',first.body.transaction_id);assert.equal(tx.description,'Owner description');assert.equal(tx.observations.length,2);assert.equal(cashRow(c,first.body.transaction_id).notes,'Keep');
});
test('two legitimate 6 ILS purchases keep separate candidates; no default choice or identity collapse',async t=>{
 const {c,e,b}=await setup(t),p=profile();
 for(let n=0;n<2;n++)await send(c,e,{...purchase(b),amount:'6.00',transaction_date:'2026-09-30'});
 const pending=[];for(let n=0;n<2;n++)pending.push(await calSend(c,p,calBody({amount:6,original_amount:6,date:'2026-09-30',description:'נאייקס ישראל מכונות אוטומ…'})));
 const first=readReview(c,'observation',pending[0].body.observation_id);assert.equal(first.candidates.length,2);
 const snapshot=cash(c);readReview(c,'pending');assert.deepEqual(cash(c),snapshot);
 const race=await Promise.all(first.candidates.map(target=>parallelSql(c.db,statement('review_reconciliation',decision(first,target)))));
 for(const result of race)assert.equal(result.status,0,result.err);
 const outcomes=race.map(r=>JSON.parse(r.out));
 assert.equal(outcomes.filter(r=>r.outcome==='reconciled').length,1);
 assert.equal(outcomes.find(r=>r.outcome!=='reconciled').reason_code,'stale_review');
 const next=readReview(c,'observation',pending[1].body.observation_id);assert.equal(next.candidates.filter(x=>x.can_link).length,1);
 call(c.db,'review_reconciliation',decision(next,next.candidates.find(x=>x.can_link)));assert.equal(cash(c).count,2);assert.equal(Number(cash(c).amount),12);
});
test('stale candidate snapshot and protected history fail closed; separate retries create cash once',async t=>{
 const {c,e,b}=await setup(t);await send(c,e,purchase(b));const pending=await calSend(c,profile(),calBody({description:'Other source'}));
 const d=readReview(c,'observation',pending.body.observation_id),old=decision(d,d.candidates[0]);
 sql(c.db,`UPDATE transactions SET notes='new correction' WHERE id=${d.candidates[0].id};`);
 assert.equal(call(c.db,'review_reconciliation',old).reason_code,'stale_review');assert.equal(cash(c).count,1);
 const fresh=readReview(c,'observation',pending.body.observation_id),args=decision(fresh);
 const a=call(c.db,'review_reconciliation',args);assert.equal(a.outcome,'created');assert.equal(call(c.db,'review_reconciliation',args).replayed,true);assert.equal(cash(c).count,2);
 const different=decision(fresh);assert.equal(call(c.db,'review_reconciliation',different).reason_code,'stale_review');assert.equal(cash(c).count,2);
});
test('046 is additive and private; fresh schema equals upgrade; voided candidates cannot link',async t=>{
 const db='upgrade';sql('postgres',`CREATE DATABASE ${db} TEMPLATE flowlink_baseline;`);const snap=financialSnapshot(db);
 assert.notEqual(sql(db,migration.replace('COMMIT;','SELECT 1/0;COMMIT;'),true).status,0);sql(db,migration);sql(db,migration);assert.deepEqual(financialSnapshot(db),snap);
 for(const role of ['anon','authenticated'])for(const fn of ['read_reconciliation(text,integer[],bigint)','review_reconciliation(uuid,jsonb)'])assert.equal(scalar(db,`SELECT has_function_privilege('${role}','${fn}','EXECUTE');`),'f');
 const defs=d=>json(d,"SELECT jsonb_object_agg(proname,pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'apy_ui_%' OR proname LIKE '%reconciliation');");assert.deepEqual(defs(db),defs('flowlink_clean'));
 const {c,e,b}=await setup(t),a=await send(c,e,purchase(b));const d=call(c.db,'get_ingestion_observation',{p_observation_id:a.body.observation_id});
 call(c.db,'cancel_ingested_transaction',{p_request_key:randomUUID(),p_command:{transaction_id:a.body.transaction_id,expected_revision:d.decision_revision,expected_transaction_fingerprint:d.expected_transaction_fingerprint,actor:'test',reason:'cancel'}});
 const pending=await calSend(c,profile(),calBody()),detail=readReview(c,'observation',pending.body.observation_id);assert.equal(detail.can_separate,false);assert.equal(detail.candidates[0].can_link,false);
 assert.equal(call(c.db,'review_reconciliation',decision(detail,detail.candidates[0])).reason_code,'protected_transaction');assert.equal(cash(c).count,0);
});

test('authenticated owner HTTP read and decision reach real shared RPC; pending queue has no cash write',async t=>{
 const {c,e,b}=await setup(t);await send(c,e,purchase(b));const pending=await calSend(c,profile(),calBody({description:'Different merchant'}));
 const express=require('express'),app=express();app.use(express.json());
 app.use((req,res,next)=>{if(req.headers.authorization==='Bearer isolated-owner-session')req.user={id:ownerId};next();});
 app.use('/review',require('../routes/reconciliationRoutes').createReconciliationRouter({db:c.client,env:()=>({FLOWLINK_OWNER_USER_IDS:JSON.stringify([ownerId])})}));
 const server=app.listen(0,'127.0.0.1');await require('node:events').once(server,'listening');t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const base=`http://127.0.0.1:${server.address().port}/review`,headers={Authorization:'Bearer isolated-owner-session','Content-Type':'application/json'};
 assert.equal((await fetch(base+'/pending')).status,401);
 const d=await (await fetch(`${base}/observation/${pending.body.observation_id}`,{headers})).json();assert.equal(d.observation.transaction_id,null);assert.equal(cash(c).count,1);
 const args=decision(d,d.candidates[0]),{actor,reason,observation_id,...payload}=args.p_command;
 const body=JSON.stringify({...payload,request_key:args.p_request_key});
 for(let n=0;n<2;n++)assert.equal((await fetch(`${base}/observation/${pending.body.observation_id}/resolve`,{method:'POST',headers,body})).status,200);
 const changed={...JSON.parse(body),action:'separate'};delete changed.transaction_id;delete changed.expected_transaction_fingerprint;
 const conflict=await fetch(`${base}/observation/${pending.body.observation_id}/resolve`,{method:'POST',headers,body:JSON.stringify(changed)});
 assert.equal(conflict.status,409);assert.deepEqual(await conflict.json(),{error:'stale_review'});
 assert.equal(cash(c).count,1);assert.equal((await (await fetch(base+'/pending',{headers})).json()).items.length,0);
});
test('opt-in local review fixture is repeatable and keeps two legitimate equal purchases',async t=>{
 const c=await make(t);sql(c.db,"SELECT setval(pg_get_serial_sequence('payment_sources','id'),(SELECT max(id) FROM payment_sources));");
 const fixture=fs.readFileSync(path.join(__dirname,'fixtures/reconciliationReview.sql'),'utf8');
 assert.notEqual(sql(c.db,fixture,true).status,0);assert.equal(cash(c).count,0);
 sql(c.db,"SET apy83.local_review='yes';"+fixture);const before=financialSnapshot(c.db);
 sql(c.db,"SET apy83.local_review='yes';"+fixture);assert.deepEqual(financialSnapshot(c.db),before);
 assert.equal(cash(c).count,3);assert.equal(Number(cash(c).amount),22);assert.equal(readReview(c,'pending').items.length,3);
});
