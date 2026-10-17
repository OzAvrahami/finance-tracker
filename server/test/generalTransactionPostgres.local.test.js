// Portless disposable PostgreSQL. No dotenv, credentials, collectors or external financial API.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { item, envelope, producerFixtures } = require('./fixtures/generalTransaction');
const { processSubmission } = require('../services/generalTransactionIngestion');
const container = `finance-general96-${process.pid}`;
const full = fs.readFileSync(path.join(__dirname, '../full_schema.sql'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../migrations/052_general_transaction_contract.sql'), 'utf8');
const resolutionMigration = fs.readFileSync(path.join(__dirname, '../migrations/053_general_receipt_resolution.sql'), 'utf8');
let started = false, sequence = 0;
function run(args, input, allow = false) {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60000, maxBuffer: 32e6 });
  if (!allow) assert.equal(r.status, 0, r.stderr || r.error?.message);
  return r;
}
const sql = (db, text, allow = false) => run(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq'], text, allow);
const scalar = (db, text) => sql(db, text).stdout.trim();
const json = (db, text) => JSON.parse(scalar(db, text));
const quote = v => `'${String(typeof v === 'object' ? JSON.stringify(v) : v).replaceAll("'", "''")}'`;
const evidence = raw => { const { client_id, ...e } = raw; return e; };
const statement = (raw, account = 'synthetic-account') => `SET ROLE service_role; SELECT ingest_general_transaction(${quote(account)},${quote(evidence(raw))});`;
const call = (db, raw, account) => json(db, statement(raw, account));
const count = (db, table = 'transactions') => Number(scalar(db, `SELECT count(*) FROM ${table};`));
const asyncSql = (db, text) => new Promise((resolve, reject) => {
  const p = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq']);
  let out = '', err = ''; p.stdout.on('data', b => { out += b; }); p.stderr.on('data', b => { err += b; });
  p.on('error', reject); p.on('close', status => resolve({ status, out, err })); p.stdin.end(text);
});
const client = db => ({ rpc: async (name, args) => {
  assert.ok(['ingest_general_transaction','get_general_receipt','resolve_general_receipt'].includes(name));
  const values=name==='ingest_general_transaction'?[args.p_account,args.p_item]:name==='get_general_receipt'?[args.p_receipt]:[args.p_request_key,args.p_command];
  const r = await asyncSql(db, `SET ROLE service_role; SELECT ${name}(${values.map(quote).join(',')});`);
  return r.status ? { error: { code: '23514' } } : { data: JSON.parse(r.out.trim()) };
} });
function make(options = {}) {
  const db = `case_${++sequence}`;
  sql('postgres', `CREATE DATABASE ${db} TEMPLATE general_clean;`);
  sql(db, `INSERT INTO payment_sources(id,name,slug,method,is_active,last4) VALUES
   (1,'Synthetic card','synthetic','credit_card',true,'1234'),(2,'Other card','other','debit_card',true,'1234'),(3,'Inactive','inactive','credit_card',false,'9999');`);
  const cfg = { payment_source_ids: options.payments || ['1'], card_mappings: [], aliases: [], time_verified: false, verified_references: [] };
  const s = json(db, `SELECT configure_ingestion_source(${quote(randomUUID())},${quote({ source_kind: 'cal', instance_key: 'general-test', configuration: cfg, actor: 'synthetic test' })});`);
  sql(db, `INSERT INTO transaction_api_registrations(account_key,source_id,enabled,history_reviewed,installment_date_policy)
   VALUES('synthetic-account',${s.source_id},true,${options.history !== false},${quote(options.policy || 'billing')});`);
  return { db, sid: s.source_id };
}
const installment = (n = 1, changes = {}) => item({ key: `installment-${n}`, event: { ...item().event, basis: 'installment', purchase_key: 'purchase-group', installment: { current: n, total: 3 } },
  dates: { purchase: '2026-08-01', mapped: `2026-${String(8 + n).padStart(2, '0')}-01`, billing: `2026-${String(8 + n).padStart(2, '0')}-10` }, ...changes });
const readReceipt=(db,r)=>json(db,`SET ROLE service_role; SELECT get_general_receipt(${r.receipt_id});`);
function resolution(db,r,raw,extra={}) {
 const view=readReceipt(db,r);
 return {receipt_id:r.receipt_id,expected_revision:view.revision,review_token:view.review_token,item:evidence(raw),
  actor:'owner:11111111-1111-4111-8111-111111111111',reason:'Synthetic provider evidence verified',relationship:{kind:'same_identity'},...extra};
}
const resolveStatement=(command,key=randomUUID())=>`SET ROLE service_role; SELECT resolve_general_receipt(${quote(key)},${quote(command)});`;
const resolve=(db,command,key)=>json(db,resolveStatement(command,key));
function apple(db, amount = '32.70', date = '2026-08-01') {
  const s = json(db, `SELECT configure_ingestion_source(${quote(randomUUID())},${quote({ source_kind: 'apple_pay', instance_key: 'apple', configuration: { payment_source_ids: ['1'] }, actor: 'synthetic' })});`);
  return json(db, `SELECT ingest_observation(${s.source_id},${quote({ idempotency_key: randomUUID(), merchant: 'Synthetic Shop', accounting_amount: amount, currency: 'ILS', movement_type: 'expense', transaction_date: date, payment_source_id: '1' })});`);
}
before(async () => {
  run(['run', '-d', '--rm', '--name', container, '--label', 'finance.disposable=general96', '-e', 'POSTGRES_PASSWORD=local_test_only', 'postgres:16-alpine']); started = true;
  const info = JSON.parse(run(['inspect', container]).stdout)[0];
  assert.equal(info.Config.Labels['finance.disposable'], 'general96'); assert.deepEqual(info.HostConfig.PortBindings || {}, {});
  for (let i = 0; i < 60; i++) { if (run(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], undefined, true).status === 0) break; await new Promise(r => setTimeout(r, 200)); }
  sql('postgres', 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE DATABASE general_clean; CREATE DATABASE general_before;');
  sql('general_clean', full); sql('general_before', full.split('-- Migration 052:')[0]);
});
after(() => { if (started) run(['rm', '-f', container]); });

test('052 then 053 upgrade matches full schema; failed upgrades roll back; private grants and immutable receipts hold', () => {
  assert.notEqual(sql('general_before', migration.replace('COMMIT;', 'SELECT 1/0; COMMIT;'), true).status, 0);
  assert.equal(scalar('general_before', "SELECT to_regclass('transaction_api_receipts') IS NULL;"), 't');
  sql('general_before', migration);
  assert.notEqual(sql('general_before', resolutionMigration.replace('COMMIT;', 'SELECT 1/0; COMMIT;'), true).status, 0);
  assert.equal(scalar('general_before', "SELECT to_regclass('transaction_api_resolutions') IS NULL;"), 't');
  sql('general_before',"INSERT INTO payment_sources(id,name,slug,method,is_active) VALUES(1,'Upgrade synthetic','upgrade','credit_card',true);");
  const source=json('general_before',`SELECT configure_ingestion_source(${quote(randomUUID())},${quote({source_kind:'cal',instance_key:'upgrade',configuration:{payment_source_ids:['1']},actor:'synthetic upgrade'})});`);
  sql('general_before',`INSERT INTO transaction_api_registrations(account_key,source_id,enabled,history_reviewed) VALUES('synthetic-account',${source.source_id},true,true);`);
  const held=item({key:'pre053-pending',event:{...item().event,status:'pending'}});
  const oldReceipt=call('general_before',held);call('general_before',item());
  const prior=json('general_before','SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM transaction_api_receipts r;');
  sql('general_before', resolutionMigration);
  assert.deepEqual(json('general_before','SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM transaction_api_receipts r;'),prior);
  assert.equal(count('general_before'),1);assert.equal(call('general_before',item()).outcome,'replay');
  assert.equal(readReceipt('general_before',oldReceipt).revision,0);
  assert.equal(resolve('general_before',resolution('general_before',oldReceipt,{...held,event:item().event})).outcome,'created');
  assert.equal(count('general_before'),2);
  const defs = db => json(db, "SELECT jsonb_object_agg(proname,replace(pg_get_functiondef(oid),chr(13),'')) FROM pg_proc WHERE pronamespace='public'::regnamespace;");
  assert.deepEqual(defs('general_before'), defs('general_clean'));
  for (const role of ['anon','authenticated']) assert.equal(scalar('general_clean', `SELECT has_function_privilege('${role}','ingest_general_transaction(text,jsonb)','execute');`), 'f');
  assert.equal(scalar('general_clean', "SELECT has_table_privilege('service_role','transaction_api_receipts','INSERT');"), 'f');
  assert.equal(scalar('general_clean', "SELECT bool_and(relrowsecurity) FROM pg_class WHERE relname IN ('transaction_api_receipts','transaction_api_registrations');"), 't');
  const { db } = make(); const r = call(db, item());
  assert.notEqual(sql(db, `DELETE FROM transaction_api_receipts WHERE id=${r.receipt_id};`, true).status, 0);
  for(const role of ['anon','authenticated'])assert.equal(scalar(db,`SELECT has_function_privilege('${role}','resolve_general_receipt(uuid,jsonb)','EXECUTE');`),'f');
  assert.equal(scalar(db,"SELECT has_function_privilege('service_role','evaluate_general_transaction(text,jsonb,bigint)','EXECUTE');"),'f');
  assert.equal(scalar(db,"SELECT has_table_privilege('service_role','transaction_api_resolutions','INSERT');"),'f');
});
test('exact money and dates persist atomically; batch/single replay and equal-looking purchases are distinct', async () => {
  const { db } = make();
  const first = await processSubmission(client(db), envelope(item()));
  assert.equal(first.body.results[0].outcome, 'created');
  assert.equal((await processSubmission(client(db), envelope([item()]))).body.results[0].outcome, 'replay');
  assert.equal(call(db, item({ key: 'second' })).outcome, 'created');
  assert.equal(count(db), 2);
  const row = json(db, 'SELECT to_jsonb(t) FROM transactions t ORDER BY id LIMIT 1;');
  assert.equal(row.transaction_date, '2026-10-01'); assert.equal(row.charge_date, '2026-11-02'); assert.equal(row.external_id, null);
  assert.equal(scalar(db, 'SELECT sum(total_amount)*100=2180 FROM transactions;'), 't');
  const stored = json(db, 'SELECT evidence FROM transaction_api_receipts ORDER BY id LIMIT 1;');
  assert.deepEqual(stored.dates, item().dates);
});
test('mixed valid/invalid batch commits valid items independently; failed receipt insertion rolls one whole item back', async () => {
  const { db } = make();
  sql(db, "CREATE FUNCTION fail_general_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.item_key='fail' THEN RAISE EXCEPTION 'synthetic' USING ERRCODE='23514'; END IF; RETURN NEW; END $$; CREATE TRIGGER injected BEFORE INSERT ON transaction_api_receipts FOR EACH ROW EXECUTE FUNCTION fail_general_receipt();");
  const r = await processSubmission(client(db), envelope([item({ key: 'one' }), item({ key: 'fail' }), item({ key: 'bad', charged: 'bad' }), item({ key: 'two' })]));
  assert.deepEqual(r.body.results.map(x => x.outcome), ['created','retryable_failure','rejected','created']);
  assert.equal(count(db), 2); assert.equal(count(db, 'transaction_api_receipts'), 2);
  assert.equal(scalar(db, "SELECT count(*) FROM transaction_source_observations WHERE idempotency_key='fail';"), '0');
  assert.equal(scalar(db, "SELECT count(*) FROM transaction_reconciliation_events WHERE event_kind='created';"), '2');
});
test('concurrent duplicates and lost-response replay have one cash effect; changed content cannot overwrite owner fields', async () => {
  const { db } = make();
  const results = await Promise.all([asyncSql(db, statement(item())), asyncSql(db, statement(item()))]);
  const values = results.map(r => { assert.equal(r.status, 0, r.err); return JSON.parse(r.out); });
  assert.deepEqual(values.map(x => x.outcome).sort(), ['created','replay']);
  assert.equal(count(db), 1); assert.equal(count(db, 'transaction_api_receipts'), 1);
  // The first response is deliberately discarded; same key/content recovers its receipt.
  const replay = call(db, item()); assert.equal(replay.outcome, 'replay');
  sql(db, `UPDATE transactions SET description='Owner name',notes='Owner note',tags='kept' WHERE id=${replay.transaction_id};`);
  assert.equal(call(db, item({ merchant: 'Changed producer content' })).reason_code, 'identity_content_changed');
  assert.equal(scalar(db, `SELECT notes FROM transactions WHERE id=${replay.transaction_id};`), 'Owner note');
  assert.equal(count(db), 1);
});
test('cancelled identities remain reserved and replay reports current cancelled state', () => {
  const { db } = make(), r = call(db, item());
  const d = json(db, `SELECT get_ingestion_observation(${r.observation_id});`);
  const cmd = { transaction_id: r.transaction_id, expected_revision: d.decision_revision, expected_transaction_fingerprint: d.expected_transaction_fingerprint, actor: 'synthetic owner', reason: 'Synthetic cancellation' };
  const cancel = json(db, `SELECT cancel_ingested_transaction(${quote(randomUUID())},${quote(cmd)});`); assert.equal(cancel.disposition, 'cancelled');
  const retry = call(db, item()); assert.equal(retry.outcome, 'replay'); assert.equal(retry.financial_posted, false); assert.equal(retry.disposition, 'cancelled');
  assert.equal(count(db), 1);
});
test('pending, unknown, missing original date, FX-only and refunds are durable explicit review with no cash', () => {
  const { db } = make();
  const cases = [
    [item({ event: { ...item().event, status: 'pending' } }), 'source_not_completed'],
    [item({ event: { ...item().event, kind: 'unknown' } }), 'unsupported_event_kind'],
    [item({ dates: { purchase: null, mapped: '2026-10-01', billing: '2026-11-01' } }), 'accounting_date_evidence_required'],
    [item({ charged: { amount: '1.00', currency: 'USD', scale: 2 } }), 'exact_ils_charge_required'],
    [item({ charged: { amount: '-1.00', currency: 'ILS', scale: 2 }, event: { ...item().event, kind: 'refund' } }), 'unsupported_event_kind'],
    [item({ identity_basis: 'unresolved' }), 'identity_unresolved'],
  ];
  for (const [i, [raw, reason]] of cases.entries()) {
    raw.key = `review-${i}`;
    const r = call(db, raw); assert.equal(r.reason_code, reason); assert.equal(r.accepted, true); assert.equal(r.financial_posted, false);
    assert.equal(call(db, raw).outcome, 'replay');
  }
  assert.equal(count(db), 0); assert.equal(count(db, 'transaction_api_receipts'), cases.length);
  assert.equal(call(db, item({ key: 'review-0' })).outcome, 'conflict'); // pending -> completed is an amendment, never a silent rewrite
});

test('pending to completed owner revision: concurrent resolutions, original/completed retries and lost response produce one cash row',async()=>{
 const {db}=make(), pending=item({event:{...item().event,status:'pending'}}),r=call(db,pending);
 assert.equal(count(db),0);assert.equal(count(db,'transaction_source_observations'),0);
 assert.equal(call(db,item()).reason_code,'identity_content_changed');
 const command=resolution(db,r,item()),key=randomUUID();
 const values=await Promise.all([asyncSql(db,resolveStatement(command,key)),asyncSql(db,resolveStatement(command,key))]);
 for(const v of values)assert.equal(v.status,0,v.err);
 assert.deepEqual(values.map(v=>JSON.parse(v.out).outcome).sort(),['created','replay']);
 const retry=resolve(db,command,key);assert.equal(retry.outcome,'replay');
 assert.equal(call(db,pending).matched_revision,0);assert.equal(call(db,item()).matched_revision,1);
 assert.equal(call(db,item()).financial_posted,true);
 assert.equal(count(db),1);assert.equal(count(db,'transaction_source_observations'),1);
 assert.equal(count(db,'transaction_api_receipts'),1);assert.equal(count(db,'transaction_api_resolutions'),1);
 const view=readReceipt(db,r);assert.equal(view.original_evidence.event.status,'pending');assert.equal(view.evidence.event.status,'completed');
 assert.equal(view.history.length,1);assert.equal(view.result.original_outcome,'review_required');
 assert.notEqual(sql(db,'DELETE FROM transaction_api_resolutions;',true).status,0);
 assert.equal(resolve(db,command).reason_code,'stale_review');
 assert.equal(resolve(db,resolution(db,r,item())).reason_code,'observation_review_required');
 const d=json(db,`SELECT get_ingestion_observation(${retry.observation_id});`);
 const cancel={transaction_id:retry.transaction_id,expected_revision:d.decision_revision,expected_transaction_fingerprint:d.expected_transaction_fingerprint,actor:'synthetic',reason:'Synthetic cancellation'};
 json(db,`SELECT cancel_ingested_transaction(${quote(randomUUID())},${quote(cancel)});`);
 assert.equal(resolve(db,command,key).disposition,'cancelled');assert.equal(call(db,pending).financial_posted,false);
 assert.equal(resolve(db,resolution(db,r,item())).reason_code,'observation_review_required');assert.equal(count(db),1);
});

test('mapping resolution revalidates current facts; failed revision insertion rolls cash and observation back',()=>{
 const {db,sid}=make({payments:[]}),raw=item(),r=call(db,raw),stale=resolution(db,r,raw);
 assert.equal(r.reason_code,'mapping_missing');
 sql(db,`UPDATE transaction_ingestion_sources SET configuration=jsonb_set(configuration,'{payment_source_ids}','["1"]') WHERE id=${sid};`);
 assert.equal(resolve(db,stale).reason_code,'stale_review');assert.equal(count(db),0);
 const command=resolution(db,r,raw),key=randomUUID();
 sql(db,"CREATE FUNCTION fail_resolution() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic' USING ERRCODE='23514'; END $$; CREATE TRIGGER injected BEFORE INSERT ON transaction_api_resolutions FOR EACH ROW EXECUTE FUNCTION fail_resolution();");
 assert.notEqual(sql(db,resolveStatement(command,key),true).status,0);
 assert.equal(count(db),0);assert.equal(count(db,'transaction_source_observations'),0);assert.equal(count(db,'transaction_api_resolutions'),0);
 sql(db,'DROP TRIGGER injected ON transaction_api_resolutions;');
 const result=resolve(db,command,key);assert.equal(result.outcome,'created');assert.equal(count(db),1);
 sql(db,`UPDATE transactions SET description='Owner correction',notes='Retained' WHERE id=${result.transaction_id};`);
 assert.equal(resolve(db,resolution(db,r,item({merchant:'Replacement'}))).reason_code,'observation_review_required');
 assert.equal(scalar(db,`SELECT notes FROM transactions WHERE id=${result.transaction_id};`),'Retained');
 assert.equal(resolve(db,{...command,reason:'Different retry content'},key).reason_code,'command_key_conflict');
});

test('provider identity changes need explicit guarded relationship; new delivery keys and policy bypasses are refused',()=>{
 const {db}=make(),pending=item({event:{...item().event,status:'pending'}}),r=call(db,pending);
 const complete=item({provider_reference:{provider:'cal',type:'transaction',scope:'synthetic-account',value:'completed-provider-id'}});
 assert.equal(resolve(db,resolution(db,r,complete)).reason_code,'identity_relationship_required');
 assert.equal(resolve(db,resolution(db,r,{...complete,key:'new-key'})).reason_code,'delivery_key_change_forbidden');
 const related=resolution(db,r,complete,{relationship:{kind:'provider_link',evidence_reference:'Synthetic provider transition reference P-001'}});
 assert.equal(resolve(db,related).financial_posted,true);assert.equal(count(db),1);
 const fx=item({key:'fx',charged:{amount:'2.00',currency:'USD',scale:2}}),fr=call(db,fx);
 assert.equal(resolve(db,resolution(db,fr,fx)).reason_code,'exact_ils_charge_required');
 assert.equal(resolve(db,resolution(db,fr,{...fx,charged:item().charged})).reason_code,'known_currency_change_forbidden');
 const refund=item({key:'refund',event:{...item().event,kind:'refund'},charged:{amount:'-2.00',currency:'ILS',scale:2}}),rr=call(db,refund);
 assert.equal(resolve(db,resolution(db,rr,refund)).reason_code,'unsupported_event_kind');
 assert.equal(resolve(db,resolution(db,rr,item({key:'refund'}))).reason_code,'known_event_change_forbidden');
 assert.equal(count(db),1);
});

test('producer-shaped installment lacks original purchase date; explicit raw-date evidence resolves once at confirmed billing date',()=>{
 const {db}=make();
 // Current CAL public mapper exposes adjusted date and completed processedDate only.
 const source={type:'installments',status:'completed',identifier:'synthetic-cal-2',date:'2026-09-01T00:00:00.000Z',processedDate:'2026-10-10T00:00:00.000Z',installments:{number:2,total:3}};
 const missing=installment(2,{dates:{purchase:null,mapped:source.date.slice(0,10),billing:source.processedDate.slice(0,10)}});
 const r=call(db,missing);assert.equal(r.reason_code,'installment_purchase_date_required');assert.equal(count(db),0);
 // Prospective allowlisted projection of raw trnPurchaseDate, NOT current producer output.
 const completed={...missing,dates:{...missing.dates,purchase:'2026-08-01'}};
 const command=resolution(db,r,completed),key=randomUUID(),result=resolve(db,command,key);
 assert.equal(result.outcome,'created');assert.equal(scalar(db,`SELECT transaction_date FROM transactions WHERE id=${result.transaction_id};`),'2026-10-10');
 assert.equal(resolve(db,command,key).outcome,'replay');assert.equal(call(db,completed).outcome,'replay');assert.equal(count(db),1);
 assert.equal(call(db,installment(3,{dates:{purchase:'2026-08-01',mapped:'2026-10-01',billing:'2026-11-10'}})).outcome,'created');
 assert.equal(count(db),2); // one row per observed installment, never expansion of total=3
 assert.equal(apple(db).reason_code,'general_installment_purchase_review');assert.equal(count(db),2);
});
test('charged ILS and original currencies remain distinct; income is not an expense or refund', () => {
  const { db } = make();
  const raw = item({ original: { amount: '2.345', currency: 'KWD', scale: 3 }, event: { ...item().event, kind: 'income' } });
  const r = call(db, raw); assert.equal(r.outcome, 'created');
  assert.equal(scalar(db, `SELECT movement_type FROM transactions WHERE id=${r.transaction_id};`), 'income');
  assert.equal(scalar(db, `SELECT accepted_payload->>'original_amount' FROM transaction_source_observations WHERE id=${r.observation_id};`), '2.345');
  assert.equal(scalar(db, `SELECT exchange_rate IS NULL FROM transactions WHERE id=${r.transaction_id};`), 't');
});
test('mapping requires registration and one account; inactive cards and unreviewed history do not disappear', () => {
  for (const [options, reason] of [[{ payments: [] }, 'mapping_missing'], [{ payments: ['1','2'] }, 'mapping_ambiguous'], [{ payments: ['3'] }, 'inactive_card_review'], [{ history: false }, 'historical_transition_review']]) {
    const { db } = make(options); const r = call(db, item({ hints: { last4: '1234' } }));
    assert.equal(r.reason_code, reason); assert.equal(count(db), 0); assert.equal(count(db, 'transaction_api_receipts'), 1);
  }
  const { db } = make(); assert.equal(call(db, item(), 'unregistered').reason_code, 'registration_required'); assert.equal(count(db, 'transaction_api_receipts'), 0);
});
test('historical global external IDs are not adopted or replayed under new observation keys', () => {
  const { db } = make();
  sql(db, "DELETE FROM transaction_api_registrations; INSERT INTO transactions(total_amount,movement_type,transaction_date,payment_source_id,external_id) VALUES(10.9,'expense','2026-10-01',1,'historical'); INSERT INTO transaction_api_registrations(account_key,source_id,enabled,history_reviewed) SELECT 'synthetic-account',id,true,true FROM transaction_ingestion_sources WHERE instance_key='general-test';");
  const r = call(db, item({ legacy_external_id: 'historical' })); assert.equal(r.reason_code, 'historical_identity_reserved'); assert.equal(count(db), 1);
  assert.equal(scalar(db, "SELECT count(*) FROM transaction_source_observations WHERE evidence_origin='source';"), '0');
});
test('registration prevents legacy bypass while manual cash and unrelated legacy accounts remain compatible', () => {
  const { db } = make();
  const legacy = "INSERT INTO transactions(total_amount,movement_type,transaction_date,payment_source_id,external_id) VALUES(1,'expense','2026-10-01',1,'bypass');";
  assert.notEqual(sql(db, legacy, true).status, 0);
  sql(db, 'UPDATE transaction_api_registrations SET enabled=false;');
  assert.notEqual(sql(db, legacy, true).status, 0);
  sql(db, "INSERT INTO transactions(total_amount,movement_type,transaction_date,payment_source_id) VALUES(1,'expense','2026-10-01',1); INSERT INTO transactions(total_amount,movement_type,transaction_date,payment_source_id,external_id) VALUES(1,'expense','2026-10-01',2,'unrelated');");
  assert.equal(count(db), 2);
});
test('valid observed installments post individually under explicit consumer policy, never expand or post whole total', () => {
  for (const policy of ['billing']) {
    const { db } = make({ policy });
    const whole = installment(1, { key: 'whole', charged: { amount: '32.70', currency: 'ILS', scale: 2 }, event: { ...installment().event, basis: 'whole_purchase' } });
    assert.equal(call(db, whole).reason_code, 'whole_purchase_not_posted');
    const first = call(db, installment()); assert.equal(first.outcome, 'created'); assert.equal(count(db), 1);
    assert.equal(scalar(db, `SELECT transaction_date::text FROM transactions WHERE id=${first.transaction_id};`), '2026-09-10');
    assert.equal(call(db, installment(2)).outcome, 'created'); assert.equal(count(db), 2);
    assert.equal(call(db, installment(1, { key: 'same-ordinal-new-key' })).reason_code, 'purchase_identity_reserved');
    assert.equal(scalar(db, 'SELECT sum(total_amount)*100=2180 FROM transactions;'), 't');
  }
});
test('installment counters and unselected policy hold explicitly; neither whole/individual arrival order double-posts', () => {
  const held = make({ policy: 'review' }); assert.equal(call(held.db, installment()).reason_code, 'installment_policy_required');
  for (const counters of [null, { current: 0, total: 0 }, { current: null, total: 3 }]) {
    const { db } = make({ policy: 'billing' });
    assert.equal(call(db, installment(1, { event: { ...installment().event, installment: counters } })).reason_code, 'installment_evidence_required'); assert.equal(count(db), 0);
  }
  const unknownPurchase = make();
  assert.equal(call(unknownPurchase.db, installment(1, { dates: { purchase: null, mapped: '2026-09-01', billing: '2026-09-10' } })).reason_code, 'installment_purchase_date_required');
  const unknownBilling = make();
  assert.equal(call(unknownBilling.db, installment(1, { dates: { purchase: '2026-08-01', mapped: '2026-09-01', billing: null } })).reason_code, 'accounting_date_evidence_required');
  const before = make({ policy: 'billing' }); assert.equal(apple(before.db).outcome, 'created');
  assert.equal(call(before.db, installment()).reason_code, 'installment_existing_purchase_review'); assert.equal(count(before.db), 1);
  const after = make({ policy: 'billing' }); assert.equal(call(after.db, installment()).outcome, 'created');
  const a = apple(after.db); assert.equal(a.reason_code, 'general_installment_purchase_review'); assert.equal(a.transaction_id, null); assert.equal(count(after.db), 1);
  const sameSource = make({ policy: 'billing' }); assert.equal(call(sameSource.db, installment()).outcome, 'created');
  const full = call(sameSource.db, item({ key: 'whole-as-single', dates: { purchase: '2026-08-01', mapped: null, billing: null }, charged: { amount: '32.70', currency: 'ILS', scale: 2 } }));
  assert.equal(full.reason_code, 'general_installment_purchase_review'); assert.equal(count(sameSource.db), 1);
});
test('ordinary evidence still reconciles through APY and preserves owner edits and stale review guards', () => {
  const { db } = make(); const a = apple(db, '10.90', '2026-10-01');
  sql(db, `UPDATE transactions SET description='Owner retained',notes='Owner note' WHERE id=${a.transaction_id};`);
  const r = call(db, item()); assert.equal(r.outcome, 'reconciled'); assert.equal(r.transaction_id, a.transaction_id); assert.equal(count(db), 1);
  assert.equal(scalar(db, `SELECT description FROM transactions WHERE id=${a.transaction_id};`), 'Owner retained');
  const pending = call(db, item({ key: 'different', merchant: 'Other text' })); assert.equal(pending.outcome, 'review_required');
  const cmd = { observation_id: pending.observation_id, expected_revision: '1', expected_candidate_fingerprints: {}, action: 'separate', actor: 'synthetic', reason: 'Test stale' };
  assert.equal(json(db, `SELECT review_reconciliation(${quote(randomUUID())},${quote(cmd)});`).reason_code, 'stale_review'); assert.equal(count(db), 1);
});
test('actual controller/auth over loopback HTTP processes PostgreSQL-backed mixed batch', async t => {
  const { db } = make(); const express = require('express');
  const controller = require('./helpers/fakeSupabase').loadControllerWithFake('../../controllers/v1/transactionController', client(db));
  const prior = process.env.EXTERNAL_API_KEY; process.env.EXTERNAL_API_KEY = 'synthetic-http-key';
  t.after(() => { if (prior === undefined) delete process.env.EXTERNAL_API_KEY; else process.env.EXTERNAL_API_KEY = prior; });
  const app = express(); app.use(express.json({ limit: '2mb' }));
  app.post('/api/v1/transactions', require('../middleware/apiKeyAuth').apiKeyAuth, controller.createTransaction);
  const server = app.listen(0, '127.0.0.1'); await require('node:events').once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const body = envelope([item(),item({ charged: 'bad' }),item({ key: 'second' })]);
  const send = () => fetch(`http://127.0.0.1:${server.address().port}/api/v1/transactions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-http-key' }, body: JSON.stringify(body) });
  const r = await send(); assert.equal(r.status, 200); assert.deepEqual((await r.json()).results.map(x => x.outcome), ['created','rejected','created']);
  assert.deepEqual((await (await send()).json()).results.map(x => x.outcome), ['replay','rejected','replay']); assert.equal(count(db), 2);
});

test('owner receipt HTTP procedure validates, reads, resolves and retries against PostgreSQL',async t=>{
 const {db}=make(),express=require('express'),owner='11111111-1111-4111-8111-111111111111';
 const pending=item({event:{...item().event,status:'pending'}}),r=call(db,pending),app=express();
 app.use(express.json());app.use((req,res,next)=>{if(req.headers.authorization==='Bearer synthetic-owner')req.user={id:owner};next();});
 app.use('/api/reconciliation',require('../routes/reconciliationRoutes').createReconciliationRouter({db:client(db),env:()=>({FLOWLINK_OWNER_USER_IDS:JSON.stringify([owner])})}));
 const server=app.listen(0,'127.0.0.1');await require('node:events').once(server,'listening');
 t.after(()=>new Promise(done=>{server.close(done);server.closeAllConnections();}));
 const url=`http://127.0.0.1:${server.address().port}/api/reconciliation/receipt/${r.receipt_id}`;
 const headers={Authorization:'Bearer synthetic-owner','Content-Type':'application/json'};
 assert.equal((await fetch(url)).status,401);
 const view=await(await fetch(url,{headers})).json();
 const command={request_key:randomUUID(),expected_revision:view.revision,review_token:view.review_token,item:item(),reason:'Synthetic completed evidence verified',relationship:{kind:'same_identity'}};
 const send=body=>fetch(`${url}/resolve`,{method:'POST',headers,body:JSON.stringify(body)});
 assert.equal((await send({...command,item:{...item(),charged:{amount:10.9,currency:'ILS',scale:2}}})).status,400);
 assert.equal(count(db),0);assert.equal(count(db,'transaction_api_resolutions'),0);
 const accepted=await send(command);assert.equal(accepted.status,200);assert.equal((await accepted.json()).financial_posted,true);
 assert.equal((await(await send(command)).json()).outcome,'replay');assert.equal(count(db),1);
 assert.equal((await send({...command,request_key:randomUUID()})).status,409);
});

test('exported producer handoff vectors match real isolated persistence and ordered response projections',async()=>{
 const expectedCash={single:1,batch:2,partial:1,pending:0,'completed-needs-owner-resolution':0,'exact-replay':1,'changed-content':1,
  'complete-installment':1,'producer-missing-original-date':0,'missing-confirmed-billing':0,refund:0,'unresolved-fx':0};
 for(const c of producerFixtures().cases){
  const {db}=make();for(const before of c.before)await processSubmission(client(db),before);
  const actual=await processSubmission(client(db),c.request);
  assert.equal(actual.status,200,c.id);assert.equal(actual.body.contract,c.expectedResponse.contract,c.id);
  assert.equal(actual.body.results.length,c.expectedResponse.results.length,c.id);
  c.expectedResponse.results.forEach((projection,i)=>{
   for(const [key,value] of Object.entries(projection))assert.deepEqual(actual.body.results[i][key],value,`${c.id}.${i}.${key}`);
  });
  assert.equal(count(db),expectedCash[c.id],c.id);
  if(c.id==='complete-installment')assert.equal(scalar(db,'SELECT transaction_date FROM transactions;'),'2026-10-10');
 }
});
