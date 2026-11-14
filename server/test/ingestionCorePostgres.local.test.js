// Synthetic, disposable and portless. Never loads dotenv or production clients.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const core = require('../services/ingestion/core');
const container = `finance-core-${process.pid}`;
let started = false, sequence = 0;
const run = (args, input, allow = false) => {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 90000, maxBuffer: 32e6 });
  if (!allow) assert.equal(r.status, 0, r.stderr || r.error?.message);
  return r;
};
const sql = (db, input, allow = false) => run(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq'], input, allow);
const scalar = (db, input) => sql(db, input).stdout.trim();
const json = (db, input) => JSON.parse(scalar(db, input));
const quote = value => value == null ? 'NULL' : `'${String(Array.isArray(value) ? '{'+value.join(',')+'}' : typeof value === 'object' ? JSON.stringify(value) : value).replaceAll("'", "''")}'`;
const migration = fs.readFileSync(path.join(__dirname, '../migrations/058_ingestion_application_boundary.sql'), 'utf8');
// Compare fresh and upgraded schemas at 058, excluding later migrations.
const schemaSections = fs.readFileSync(path.join(__dirname, '../full_schema.sql'), 'utf8').split('-- Migration 059:');
assert.equal(schemaSections.length, 2, 'Historical 058 fixture requires exactly one "-- Migration 059:" marker');
const schema058 = schemaSections[0];
const baseline = schema058.split('-- Migration 058:')[0];
const call = (db, name, args) => json(db, `SET ROLE service_role; SELECT ${name}(${args.map(quote).join(',')});`);
const dbClient = db => ({ coreProtocol: true, rpc: async (name, args) => new Promise((resolve, reject) => {
  const p = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-Atq']);
  let out = '', err = ''; p.stdout.on('data', b => { out += b; }); p.stderr.on('data', b => { err += b; });
  p.on('error', reject); p.on('close', status => {
    if (status && !/stale_ingestion_snapshot/.test(err)) console.error(err);
    resolve(status ? { error: { code: err.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] || 'TEST_SQL', message: err } } : { data: JSON.parse(out.trim()) });
  });
  p.stdin.end(`SET ROLE service_role; SELECT ${name}(${Object.values(args).map(quote).join(',')});`);
}) });
const createCase = (old = false) => { const db = `case_${++sequence}`; sql('postgres', `CREATE DATABASE ${db} TEMPLATE ${old ? 'core_old' : 'core_clean'};`); return db; };
const item = (key, extra = {}) => ({ type: 'expense', amount: 150, date: '2026-11-08', charge_date: '2026-11-08',
  description: 'Synthetic Shop', payment_source_id: 6, currency: 'ILS', external_id: key, ...extra });
const ingest = (db, body) => core.external(dbClient(db), body);
const count = db => Number(scalar(db, 'SELECT count(*) FROM transactions WHERE voided_at IS NULL;'));
before(async () => {
  run(['run', '-d', '--rm', '--name', container, '--label', 'finance.disposable=core', '-e', 'POSTGRES_PASSWORD=local_test_only', 'postgres:16-alpine']); started = true;
  const info = JSON.parse(run(['inspect', container]).stdout)[0];
  assert.equal(info.Config.Labels['finance.disposable'], 'core'); assert.deepEqual(info.HostConfig.PortBindings || {}, {});
  for (let i = 0; i < 60; i++) { if (run(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], undefined, true).status === 0) break; await new Promise(r => setTimeout(r, 200)); }
  sql('postgres', 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE DATABASE core_old;');
  sql('core_old', baseline);
  sql('core_old', `INSERT INTO payment_sources(id,name,slug,method,issuer,last4) VALUES
    (6,'CAL 2755','cal-2755','debit_card','CAL','2755'),(7,'Other CAL','cal-other','credit_card','CAL','2002'),
    (8,'MAX','max','credit_card','MAX','8888'),(9,'Transfer','transfer','bank_transfer','Discount',NULL),
    (14,'Synthetic Discount','discount','bank_account','Discount','5297'),(15,'Cash','cash','cash',NULL,NULL),(16,'Check','check','check',NULL,NULL);
    INSERT INTO categories(id,name,type) VALUES(100,'Ordinary','expense'),(101,'Income','income');`);
  sql('postgres', 'CREATE DATABASE core_clean TEMPLATE core_old;'); sql('core_clean', migration);
});

test('058 fresh schema and upgrade agree; failed migration rolls back and existing identities/fingerprints are unchanged', async () => {
  const db = createCase(true), old = call(db, 'ingest_external_transaction', [item('historical-refund', { type:'refund', payment_source_id:14 }), false]);
  const snapshot = () => scalar(db, `SELECT jsonb_build_object('cash',(SELECT jsonb_agg(to_jsonb(t)) FROM transactions t),
    'observations',(SELECT jsonb_agg(to_jsonb(o)) FROM transaction_source_observations o),
    'events',(SELECT jsonb_agg(to_jsonb(e)) FROM transaction_reconciliation_events e),
    'fingerprints',(SELECT jsonb_agg(row_json->>'transaction_fingerprint') FROM transactions_filtered()));`);
  const before = snapshot();
  assert.notEqual(sql(db, migration.replace('COMMIT;', 'SELECT 1/0; COMMIT;'), true).status, 0);
  assert.equal(snapshot(), before); assert.equal(scalar(db,"SELECT to_regprocedure('ingest_external_transaction(jsonb,boolean)') IS NOT NULL;"),'t');
  sql(db,migration); assert.equal(snapshot(),before);
  assert.equal((await ingest(db,item('historical-refund',{type:'refund',payment_source_id:14}))).transaction_id,old.transaction_id);
  const fresh = 'fresh_058'; sql('postgres',`CREATE DATABASE ${fresh};`);
  sql(fresh,schema058);
  const definitions = d => scalar(d,"SELECT jsonb_object_agg(oid::regprocedure::text,replace(pg_get_functiondef(oid),chr(13),'')) FROM pg_proc WHERE pronamespace='public'::regnamespace;");
  assert.equal(definitions(db),definitions(fresh));
  const catalog = d => json(d, `SELECT jsonb_build_object(
    'relations',(SELECT jsonb_object_agg(c.relname,jsonb_build_array(c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text)) FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','v','S')),
    'columns',(SELECT jsonb_object_agg(c.relname||'.'||a.attname,jsonb_build_array(format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid))) FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','v') AND a.attnum>0 AND NOT a.attisdropped),
    'constraints',(SELECT jsonb_object_agg(conrelid::regclass::text||'.'||conname,pg_get_constraintdef(oid)) FROM pg_constraint WHERE connamespace='public'::regnamespace),
    'indexes',(SELECT jsonb_object_agg(indexname,indexdef) FROM pg_indexes WHERE schemaname='public'),
    'triggers',(SELECT jsonb_object_agg(tgrelid::regclass::text||'.'||tgname,pg_get_triggerdef(oid)) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)),
    'views',(SELECT jsonb_object_agg(viewname,definition) FROM pg_views WHERE schemaname='public'),
    'policies',(SELECT jsonb_object_agg(tablename||'.'||policyname,to_jsonb(p)-'schemaname') FROM pg_policies p WHERE schemaname='public'),
    'function_access',(SELECT jsonb_object_agg(oid::regprocedure::text,jsonb_build_array(prosecdef,proacl::text,proconfig)) FROM pg_proc WHERE pronamespace='public'::regnamespace));`);
  assert.deepEqual(catalog(db), catalog(fresh));
  assert.notEqual(sql(db,`SET ROLE service_role; SELECT ingest_external_transaction(${quote(item('old-backend'))},false);`,true).status,0);
  const unavailable = await ingest(createCase(true),item('new-backend-old-schema'));
  assert.equal(unavailable.outcome,'retryable_failure');
});

test('historical general receipt correction uses JavaScript decisions, retains original evidence and atomically replays', async () => {
  const db=createCase(true), sid=configure(db,'cal');
  sql(db,`INSERT INTO transaction_api_registrations(account_key,source_id,enabled,history_reviewed,installment_date_policy) VALUES('synthetic-account',${sid},true,true,'billing');`);
  const {client_id,...raw}=require('./fixtures/generalTransaction').item();
  const pending={...raw,event:{...raw.event,status:'pending'}};
  // Historical command is executed as the disposable fixture owner, never exposed to the new runtime.
  const r=json(db,`SELECT ingest_general_transaction('synthetic-account',${quote(pending)});`);
  const before=scalar(db,'SELECT jsonb_agg(to_jsonb(r)) FROM transaction_api_receipts r;');
  sql(db,migration);
  const view=call(db,'get_general_receipt',[r.receipt_id]);
  const c={receipt_id:r.receipt_id,expected_revision:view.revision,review_token:view.review_token,item:raw,
    actor:'owner:synthetic',reason:'Verified completed evidence',relationship:{kind:'same_identity'}};
  assert.equal((await core.general(dbClient(db),randomUUID(),{...c,review_token:'stale'})).reason_code,'stale_review');
  sql(db,'UPDATE transaction_api_registrations SET enabled=false;');
  c.review_token=call(db,'get_general_receipt',[r.receipt_id]).review_token;
  assert.equal((await core.general(dbClient(db),randomUUID(),c)).reason_code,'registration_required');assert.equal(count(db),0);
  sql(db,'UPDATE transaction_api_registrations SET enabled=true;');
  c.review_token=call(db,'get_general_receipt',[r.receipt_id]).review_token;
  const key=randomUUID(), result=await core.general(dbClient(db),key,c);
  assert.equal(result.outcome,'created',JSON.stringify(result));assert.equal(result.financial_posted,true);assert.equal(count(db),1);
  assert.equal((await core.general(dbClient(db),key,c)).transaction_id,result.transaction_id);assert.equal(count(db),1);
  assert.equal((await core.general(dbClient(db),key,{...c,reason:'Changed command'})).reason_code,'command_key_conflict');assert.equal(count(db),1);
  assert.equal(scalar(db,'SELECT jsonb_agg(to_jsonb(r)) FROM transaction_api_receipts r;'),before);
  assert.equal(scalar(db,'SELECT count(*) FROM transaction_api_resolutions;'),'1');
});

test('existing Bulk contract posts 8/10 and 50 mixed-source items with actionable failures and stable retries', async () => {
  const {runBulk}=require('../services/externalTransactionBulk'), {submitExternal}=require('../services/unifiedTransactionIngestion');
  const db=createCase(), client=dbClient(db);
  const batch=async items=>{
    const response={status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
    await runBulk({body:{items}},response,async(req,res)=>{const r=await submitExternal(client,req.body);return res.status(r.status).json(r.body);});
    return response.body;
  };
  const rows=Array.from({length:10},(_,i)=>item(`partial-${i}`,{amount:i<8?150:-1,payment_source_id:i%2?14:6}));
  const partial=await batch(rows);assert.equal(partial.succeeded,8);assert.equal(partial.failed,2);assert.equal(partial.errors.length,2);assert.equal(count(db),8);
  const fifty=Array.from({length:50},(_,i)=>item(`fifty-${i}`,{payment_source_id:[6,7,8,14][i%4]}));
  const first=await batch(fifty);assert.equal(first.created,50);assert.equal(first.failed,0);assert.equal(count(db),58);
  const replay=await batch(fifty);assert.equal(replay.already_exists,50);assert.equal(count(db),58);
});

test('imported installments remain reviewable individual charges; no future siblings and whole-purchase overlap stays held', async () => {
  const db=createCase(), r=await ingest(db,item('series-1',{installment_number:1,installment_count:3}));
  assert.equal(r.reason_code,'installment_series_required');assert.equal(count(db),0);
  const approved=await core.command(dbClient(db),'resolve',randomUUID(),review(db,r.observation_id),true);
  assert.equal(approved.outcome,'created',JSON.stringify(approved));assert.equal(count(db),1);
  assert.deepEqual(json(db,'SELECT jsonb_build_array(installment_number,installment_count,parent_transaction_id) FROM transactions;'),[1,3,null]);
  assert.equal((await ingest(db,item('whole-purchase',{amount:450}))).reason_code,'installment_series_review');assert.equal(count(db),1);
});

test('canonical observation hashes preserve Unicode, exact decimals, FX provenance and subsecond timestamps', async () => {
  for(const merchant of ['WHOP','ＡＲＯＭＡ ™','חנות — בדיקה','İSTANBUL']) {
    const old=createCase(true),db=createCase(),a=configure(old,'cal'),b=configure(db,'cal');
    const observation={idempotency_key:'canonical',merchant,accounting_amount:'90071992547409.91',currency:'ILS',movement_type:'expense',
      transaction_date:'2026-11-08',payment_source_id:'6',occurred_at:'2026-11-08T11:00:00.123456+02:00',
      original_amount:'123.456789',original_currency:'USD',original_scale:6};
    call(old,'ingest_observation',[a,observation]);await core.observation(dbClient(db),b,observation);
    const projection=d=>scalar(d,"SELECT jsonb_agg(jsonb_build_array(accepted_payload,payload_fingerprint,normalized_merchant,amount_minor,occurred_at,time_width)) FROM transaction_source_observations WHERE evidence_origin='source';");
    assert.equal(projection(db),projection(old));
    assert.equal(scalar(db,'SELECT total_amount::numeric(30,2)::text FROM transactions;'),'90071992547409.91');
  }
});
after(() => { if (started) run(['rm', '-f', container]); });

test('application decision posts exact cash and preserves replay, conflict and separate same-source purchases', async () => {
  const db = createCase(), r = await ingest(db, item('first'));
  assert.equal(r.outcome, 'created', JSON.stringify(r)); assert.equal(count(db), 1);
  assert.equal((await ingest(db, item('first'))).replayed, true);
  assert.equal((await ingest(db, item('first', { amount: 151 }))).reason_code, 'idempotency_key_conflict');
  assert.equal((await ingest(db, item('second'))).outcome, 'created'); assert.equal(count(db), 2);
});

test('approved refund change supports every method without broadening income; WHOP is ordinary synthetic evidence', async () => {
  for (const payment of [6, 7, 8, 9, 14, 15, 16]) {
    const db = createCase();
    const refund = await ingest(db, item(`refund-${payment}`, { type: 'refund', amount: 557.55, description: 'WHOP', payment_source_id: payment }));
    assert.equal(refund.outcome, 'created', JSON.stringify(refund));
    assert.deepEqual(json(db, `SELECT jsonb_build_object('amount',total_amount::numeric(14,2)::text,'type',movement_type,'refund',bank_movement,'installments',installment_count) FROM transactions WHERE id=${refund.transaction_id}`),
      { amount: '-557.55', type: 'expense', refund: 'refund', installments: null });
    const income = await ingest(db, item('income', { type: 'income', payment_source_id: payment }));
    assert.equal(income.outcome, payment === 14 ? 'created' : 'ambiguous');
  }
});

test('baseline parity for expenses, FX, holds and canonical accepted evidence', async () => {
  const bodies = [item('cal'), item('discount', { payment_source_id: 14 }), item('fx', { currency: 'USD', original_amount: 40 }),
    item('parts', { installment_number: 1, installment_count: 3 }), item('mapping', { payment_source_id: 999 }),
    item('income', { type: 'income', payment_source_id: 14 }), item('refund', { type: 'refund', payment_source_id: 14 })];
  for (const body of bodies) {
    const old = createCase(true), db = createCase();
    const a = call(old, 'ingest_external_transaction', [body, false]), b = await ingest(db, body);
    for (const field of ['outcome', 'reason_code', 'transaction_id', 'review_required', 'disposition']) assert.equal(b[field], a[field], `${body.external_id}: ${field}`);
    const evidence = target => scalar(target, "SELECT jsonb_agg(jsonb_build_array(payload_fingerprint,accepted_payload) ORDER BY id) FROM transaction_source_observations WHERE evidence_origin='source';");
    assert.equal(evidence(db), evidence(old), body.external_id);
  }
});

const configure = (db, kind = 'apple_pay', extra = {}) => call(db, 'configure_ingestion_source', [randomUUID(), {
  source_kind: kind, instance_key: `synthetic-${randomUUID()}`, configuration: { payment_source_ids: ['6'], ...extra }, actor: 'synthetic' }]).source_id;
const wallet = (db, sid, key, extra = {}) => core.observation(dbClient(db), String(sid), { idempotency_key: key,
  merchant: 'Synthetic Shop', accounting_amount: '150.00', currency: 'ILS', movement_type: 'expense', transaction_date: '2026-11-08', payment_source_id: '6', ...extra });
const owned = (db, channel, key) => {
  const row = { description: 'Synthetic Shop', movement_type: 'expense', total_amount: 150, payment_source_id: 6, transaction_date: '2026-11-08', charge_date: '2026-11-08', currency: 'ILS' };
  return core.owned(dbClient(db), channel, row, key, row, null);
};
const review = (db, id, changes = {}) => {
  const f = call(db, 'ingestion_core_snapshot', [{ command: { observation_id: id } }]).facts;
  const o = f.observations.find(o => o.id === id);
  return { observation_id: id, expected_revision: o.decision_revision, expected_candidate_fingerprints: o.review_fingerprints,
    reason: 'Synthetic owner review', actor: 'owner:synthetic', action: 'separate', ...changes };
};

test('cross-source weak matches hold in both orders, including manual and CSV; identical CSV rows stay distinct', async () => {
  for (const channel of ['wallet', 'manual', 'csv']) for (const first of [true, false]) {
    const db = createCase(), sid = configure(db);
    const a = () => channel === 'wallet' ? wallet(db, sid, 'wallet') : owned(db, channel, 'csv:document:0');
    const b = () => ingest(db, item('bank'));
    await (first ? a : b)(); const r = await (first ? b : a)();
    assert.equal(r.transaction_id, null); assert.equal(r.review_required, true); assert.equal(count(db), 1);
  }
  const db = createCase(); await owned(db, 'csv', 'csv:document:0'); await owned(db, 'csv', 'csv:document:1');
  assert.equal(count(db), 2); assert.equal((await owned(db, 'csv', 'csv:document:0')).replayed, true);
});

test('strong reference and microsecond time evidence link; distinct precise times do not collapse purchases', async () => {
  const db = createCase(), cfg = { time_verified: true, verified_references: [{ provider: 'synthetic', type: 'purchase', scope: 'fixture' }] };
  const a = configure(db, 'apple_pay', cfg), b = configure(db, 'cal', cfg);
  const ref = { provider: 'synthetic', type: 'purchase', scope: 'fixture', value: 'shared-purchase' };
  const first = await wallet(db, a, 'ref-a', { provider_reference: ref });
  const linked = await wallet(db, b, 'ref-b', { provider_reference: ref });
  assert.equal(linked.transaction_id, first.transaction_id); assert.equal(linked.reason_code, 'verified_reference');
  assert.equal((await wallet(db, b, 'ref-conflict', { provider_reference: ref, accounting_amount: '151.00' })).reason_code, 'reference_conflict');
  const t = createCase(), x = configure(t, 'apple_pay', cfg), y = configure(t, 'cal', cfg);
  const one = await wallet(t, x, 'time-a', { occurred_at: '2026-11-08T09:00:00.000001Z' });
  assert.equal((await wallet(t, y, 'time-b', { occurred_at: '2026-11-08T09:00:00.000001Z' })).transaction_id, one.transaction_id);
  assert.equal((await wallet(t, y, 'time-c', { occurred_at: '2026-11-08T09:00:00.000004Z' })).outcome, 'created');
});

test('review, stale fingerprints, manual domain resumption and cancellation preserve identities', async () => {
  const db = createCase(); await ingest(db, item('bank'));
  const held = await owned(db, 'manual', 'manual-draft'); assert.equal(count(db), 1);
  const command = review(db, held.observation_id), key = randomUUID();
  const approval = await core.command(dbClient(db), 'resolve', key, command, true);
  assert.equal(approval.reason_code, 'manual_domain_approved'); assert.equal(count(db), 1);
  assert.equal((await core.command(dbClient(db), 'resolve', key, command, true)).replayed, true);
  const resumed = await owned(db, 'manual', 'another-transport-key'); assert.equal(resumed.outcome, 'created'); assert.equal(count(db), 2);
  const sid = configure(db), pending = await wallet(db, sid, 'pending');
  const stale = review(db, pending.observation_id);
  sql(db, `UPDATE transactions SET notes='Owner note' WHERE id=${resumed.transaction_id};`);
  assert.equal((await core.command(dbClient(db), 'resolve', randomUUID(), stale, true)).reason_code, 'stale_review');
  const facts = call(db, 'ingestion_core_snapshot', [{ command: { transaction_id: resumed.transaction_id } }]).facts;
  const t = facts.transactions.find(t => t.id === resumed.transaction_id), o = facts.observations.find(o => o.transaction_id === t.id && o.evidence_origin === 'source');
  const cancel = { transaction_id: t.id, expected_revision: o.decision_revision, expected_transaction_fingerprint: t.cash_fingerprint, actor: 'owner:synthetic', reason: 'Synthetic cancellation' };
  assert.equal((await core.command(dbClient(db), 'cancel', randomUUID(), cancel)).disposition, 'cancelled');
  assert.equal((await owned(db, 'manual', 'manual-draft')).disposition, 'cancelled');
});

test('CAL charge-date amendment is append-only, respects owner edits and replays the original capture', async () => {
  const db = createCase(), sid = configure(db, 'cal');
  const first = await wallet(db, sid, 'amend');
  const c = { source_id: String(sid), observation_id: first.observation_id, expected_revision: '1', charge_date: '2026-12-01', actor: 'synthetic' };
  const before = scalar(db, `SELECT accepted_payload::text FROM transaction_source_observations WHERE id=${first.observation_id};`);
  const amended = await core.command(dbClient(db), 'amend', randomUUID(), c);
  assert.equal(amended.review_required, false);
  assert.equal(scalar(db, `SELECT charge_date FROM transactions WHERE id=${first.transaction_id};`), '2026-12-01');
  assert.equal(scalar(db, `SELECT accepted_payload::text FROM transaction_source_observations WHERE id=${first.observation_id};`), before);
  assert.equal((await wallet(db, sid, 'amend')).replayed, true);
  sql(db, `UPDATE transactions SET charge_date='2026-12-02' WHERE id=${first.transaction_id};`);
  const revision = scalar(db, `SELECT decision_revision FROM transaction_source_observations WHERE id=${first.observation_id};`);
  assert.equal((await core.command(dbClient(db), 'amend', randomUUID(), { ...c, expected_revision: revision })).reason_code, 'enrichment_conflict');
});

test('stale snapshots reject mapping changes, concurrent duplicate delivery posts once, and unknown commit recovers by identity', async () => {
  const db = createCase(), body = item('concurrent');
  const scope = { channel: 'external', request: body, key: body.external_id, hash_input: body, date: body.date };
  const snapshot = call(db, 'ingestion_core_snapshot', [scope]);
  const decision = core.decideIngestion(snapshot.facts, scope);
  sql(db, "UPDATE payment_sources SET is_active=false WHERE id=6;");
  assert.notEqual(sql(db, `SET ROLE service_role; SELECT ingestion_core_commit(${quote(scope)},${quote(snapshot.token)},${quote(decision)});`, true).status, 0);
  assert.equal(count(db), 0); sql(db, 'UPDATE payment_sources SET is_active=true WHERE id=6;');
  const results = await Promise.all([ingest(db, body), ingest(db, body)]);
  assert.deepEqual(results.map(r => r.replayed).sort(), [false, true]); assert.equal(count(db), 1);
  const client = dbClient(db); let lost = false;
  const transport = { rpc: async (name, args) => { const result = await client.rpc(name, args);
    if (name === 'ingestion_core_commit' && !lost) { lost = true; throw new Error('synthetic lost ACK'); } return result; } };
  const unknown = await core.external(transport, item('unknown'));
  assert.equal(unknown.commit_state, 'unknown');
  assert.equal((await ingest(db, item('unknown'))).replayed, true); assert.equal(count(db), 2);
});

test('failure after cash insertion rolls back cash, observation and event; forgery and private calls cannot bypass invariants', async () => {
  const db = createCase();
  sql(db, `CREATE FUNCTION synthetic_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$;
    CREATE TRIGGER synthetic_failure BEFORE INSERT ON transaction_reconciliation_events FOR EACH ROW EXECUTE FUNCTION synthetic_fail();`);
  assert.equal((await ingest(db, item('rollback'))).outcome, 'retryable_failure');
  assert.equal(count(db), 0); assert.equal(scalar(db, "SELECT count(*) FROM transaction_source_observations WHERE evidence_origin='source';"), '0');
  sql(db, 'DROP TRIGGER synthetic_failure ON transaction_reconciliation_events;');
  const body = item('forgery'), scope = { channel: 'external', request: body, key: body.external_id, hash_input: body, date: body.date };
  const s = call(db, 'ingestion_core_snapshot', [scope]), d = core.decideIngestion(s.facts, scope);
  d.posting.total_amount = '900';
  assert.notEqual(sql(db, `SET ROLE service_role; SELECT ingestion_core_commit(${quote(scope)},${quote(s.token)},${quote(d)});`, true).status, 0);
  assert.equal(count(db), 0);
  for (const role of ['anon', 'authenticated']) assert.notEqual(sql(db, `SET ROLE ${role}; SELECT ingestion_core_snapshot('{}');`, true).status, 0);
  assert.equal(scalar(db, "SELECT has_function_privilege('service_role','ingestion_core_apply(jsonb,jsonb,jsonb)','EXECUTE');"), 'f');
  assert.equal(scalar(db, "SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('unified_ingest','apy_create_cash','ingest_external_transaction','resolve_general_receipt');"), '0');
  assert.equal(scalar(db,"SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosrc ~ 'public[.](unified_ingest|apy_create_cash|apy_normalize|apy_payment_source|apy_enrich|ingest_observation|ingest_external_transaction|ingest_owned_transaction|ingest_flowlink_observation|review_reconciliation|resolve_observation|amend_observation|cancel_ingested_transaction|resolve_general_receipt|evaluate_general_transaction|ingest_cal_v1|ingest_general_transaction)[(]';"),'0');
  assert.equal(scalar(db,"SELECT count(*) FROM pg_trigger WHERE tgrelid='transactions'::regclass AND tgfoid='unified_external_guard()'::regprocedure;"),'1');
});

test('card refund category/notes edit retains signed cash, null installments, receipt identity and net expense totals', async () => {
  const db = createCase(), body = item('refund-edit', { type: 'refund', amount: 557.55 });
  const r = await ingest(db, body);
  const before = scalar(db, `SELECT accepted_payload::text||payload_fingerprint FROM transaction_source_observations WHERE id=${r.observation_id};`);
  call(db, 'update_transaction_with_manual_loan_payment', [r.transaction_id, { description: 'Owner refund title', movement_type: 'expense', total_amount: -557.55,
    payment_source_id: 6, category_id: 100, transaction_date: body.date, charge_date: body.date, currency: 'ILS', installment_count: null, notes: 'Owner review' }, null]);
  const row = json(db, `SELECT row_json FROM transactions_filtered(p_transaction_id=>${r.transaction_id});`);
  assert.equal(row.bank_movement, 'refund'); assert.equal(row.total_amount, '-557.55'); assert.equal(row.installment_count, null);
  assert.equal(row.category_id, '100'); assert.equal(row.notes, 'Owner review'); assert.equal(row.external_id, body.external_id);
  assert.equal(scalar(db, `SELECT accepted_payload::text||payload_fingerprint FROM transaction_source_observations WHERE id=${r.observation_id};`), before);
  assert.equal(scalar(db, "SELECT coalesce(sum(total_amount) FILTER(WHERE movement_type='income'),0) FROM transactions;"), '0');
  assert.equal((await ingest(db, body)).transaction_id, r.transaction_id);
});

test('38 historical CAL receipts, cancelled identities and reconciliation history survive 058 byte-for-byte', async () => {
  const db=createCase(true), sid=configure(db,'cal');
  for(let i=0;i<38;i++) {
    const r=call(db,'ingest_observation',[sid,{idempotency_key:`old-${i}`,merchant:'Historical synthetic',accounting_amount:'10.00',currency:'ILS',movement_type:'expense',transaction_date:'2026-11-08',payment_source_id:'6'}]);
    sql(db,`INSERT INTO cal_ingestion_receipts(external_id,source_id,observation_id,request_hash,creation_fields) VALUES('historical-${i}',${sid},${r.observation_id},repeat('a',64),'{}');`);
  }
  call(db,'delete_transaction_with_loan_payment',[1]);
  const history=()=>scalar(db,"SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM transactions t),(SELECT jsonb_agg(to_jsonb(r) ORDER BY external_id) FROM cal_ingestion_receipts r),(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM transaction_source_observations o),(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM transaction_reconciliation_events e));");
  const before=history();sql(db,migration);assert.equal(history(),before);
  assert.equal((await ingest(db,item('historical-0'))).reason_code,'historical_identity_reserved');assert.equal(count(db),37);
  const replay=await wallet(db,sid,'old-0',{merchant:'Historical synthetic',accounting_amount:'10.00'});
  assert.equal(replay.disposition,'cancelled');assert.equal(count(db),37);
});

test('manual Loan writer remains atomic; protected links prevent generic reconciliation or cancellation', async () => {
  const db=createCase(), day=scalar(db,'SELECT current_date;');
  sql(db,`INSERT INTO loans(id,name,original_amount,current_balance,monthly_payment,total_installments,remaining_installments,start_date,next_payment_date,calculation_mode,payment_source_id)
    VALUES(1,'Synthetic loan',1000,1000,150,10,10,'${day}','${day}','loan_payments',9);`);
  const row={description:'Loan payment',movement_type:'expense',total_amount:150,transaction_date:day,charge_date:day,payment_source_id:9,loan_id:1,currency:'ILS'};
  const domain={loan_payment:{principal_amount:140,interest_amount:10,other_amount:0,next_scheduled_due_date:scalar(db,"SELECT (current_date+interval '1 month')::date;")}};
  const r=await core.owned(dbClient(db),'manual',row,'loan',row,domain);assert.equal(r.outcome,'created',JSON.stringify(r));assert.ok(r.accounting.loanPayment);
  assert.equal(scalar(db,'SELECT count(*) FROM loan_payments;'),'1');
  const v=call(db,'ingestion_core_snapshot',[{command:{transaction_id:r.transaction_id}}]).facts;
  const o=v.observations.find(o=>o.evidence_origin==='source'), t=v.transactions.find(t=>t.id===r.transaction_id);
  const cancelled=await core.command(dbClient(db),'cancel',randomUUID(),{transaction_id:r.transaction_id,expected_revision:o.decision_revision,expected_transaction_fingerprint:t.cash_fingerprint,actor:'owner',reason:'Generic cancellation forbidden'});
  assert.equal(cancelled.reason_code,'protected_transaction');assert.equal(count(db),1);
  call(db,'delete_transaction_with_loan_payment',[r.transaction_id]);assert.equal(count(db),0);assert.equal(scalar(db,'SELECT count(*) FROM loan_payments;'),'0');
  assert.equal((await core.owned(dbClient(db),'manual',row,'loan',row,domain)).disposition,'cancelled');
});

test('owner HTTP review uses JavaScript eligibility and one atomic link, rejecting stale or changed decisions',async t=>{
  const db=createCase();await ingest(db,item('external'));
  const pending=await wallet(db,configure(db),'wallet');
  assert.equal(pending.outcome,'ambiguous',JSON.stringify(pending));
  assert.ok((await require('../services/ingestion/readers').read(dbClient(db),'observation',[],pending.observation_id)).candidates);
  const express=require('express'),app=express();app.use(express.json());
  app.use((req,res,next)=>{if(req.headers.authorization==='Bearer synthetic-owner')req.user={id:'11111111-1111-4111-8111-111111111111'};next();});
  app.use('/review',require('../routes/reconciliationRoutes').createReconciliationRouter({db:dbClient(db),env:()=>({FLOWLINK_OWNER_USER_IDS:'["11111111-1111-4111-8111-111111111111"]'})}));
  const server=app.listen(0,'127.0.0.1');await require('node:events').once(server,'listening');t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}/review`,headers={Authorization:'Bearer synthetic-owner','Content-Type':'application/json',Connection:'close'};
  assert.equal((await fetch(base+'/pending')).status,401);
  const view=await(await fetch(`${base}/observation/${pending.observation_id}`,{headers})).json();
  assert.ok(view.candidates,JSON.stringify(view));assert.equal(view.candidates.length,1);assert.equal(view.candidates[0].can_link,true);assert.equal(count(db),1);
  const target=view.candidates[0],payload={request_key:randomUUID(),action:'link',expected_revision:view.observation.revision,
    expected_candidate_fingerprints:view.candidate_fingerprints,transaction_id:target.id,expected_transaction_fingerprint:target.fingerprint};
  for(let i=0;i<2;i++)assert.equal((await fetch(`${base}/observation/${pending.observation_id}/resolve`,{method:'POST',headers,body:JSON.stringify(payload)})).status,200);
  assert.equal(count(db),1);assert.equal((await(await fetch(base+'/pending',{headers})).json()).items.length,0);
});

test('058 lock timeout aborts the complete migration without removing old writers',async()=>{
  const db=createCase(true);
  const blocker=new Promise((resolve,reject)=>{
    const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-Atq']);
    child.stdout.resume();child.stderr.resume();child.on('error',reject);child.on('close',resolve);
    child.stdin.end("SET application_name='core058-blocker'; BEGIN; LOCK TABLE transactions IN EXCLUSIVE MODE; SELECT pg_sleep(6); COMMIT;");
  });
  let ready=false;
  for(let i=0;i<30;i++) {
    ready=scalar(db,"SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name='core058-blocker' AND l.relation='transactions'::regclass AND l.mode='ExclusiveLock' AND l.granted);")==='t';
    if(ready)break;await new Promise(resolve=>setTimeout(resolve,30));
  }
  assert.equal(ready,true);const result=sql(db,migration,true);assert.notEqual(result.status,0);assert.match(result.stderr,/lock timeout/);
  assert.equal(await blocker,0);assert.equal(scalar(db,"SELECT to_regprocedure('ingestion_core_commit(jsonb,text,jsonb)') IS NULL;"),'t');
  assert.equal(call(db,'ingest_external_transaction',[item('after-abort'),false]).outcome,'created');assert.equal(count(db),1);
});

for (const field of ['date', 'currency', 'notes']) test(`review: persistence binds ${field} to the frozen request`, async () => {
    const db = createCase(), body = item(`tampered-${field}`);
    const scope = { channel: 'external', request: body, hash_input: body, key: body.external_id, date: body.date };
    const s = call(db, 'ingestion_core_snapshot', [scope]), d = core.decideIngestion(s.facts, scope);
    if (field === 'date') { d.normalized.date = '2026-11-09'; d.posting.transaction_date = '2026-11-09'; }
    else { d.posting[field] = field === 'currency' ? 'USD' : 'not supplied by owner'; }
    const r = sql(db, `SET ROLE service_role; SELECT ingestion_core_commit(${quote(scope)},${quote(s.token)},${quote(d)});`, true);
    assert.notEqual(r.status, 0, `${field} must remain bound to immutable request/evidence`);
    assert.equal(count(db), 0);
    assert.equal(scalar(db, "SELECT count(*) FROM transaction_source_observations WHERE evidence_origin='source';"), '0');
});

test('review: malformed internal link cannot bypass protected transaction integrity', async () => {
  const db = createCase(), first = await ingest(db, item('protected-target')), sid = configure(db);
  sql(db, `INSERT INTO transaction_items(transaction_id,item_name) VALUES(${first.transaction_id},'protected item');`);
  const observation = { idempotency_key: 'forged-link', merchant: 'Synthetic Shop', accounting_amount: '150.00', currency: 'ILS',
    movement_type: 'expense', transaction_date: '2026-11-08', payment_source_id: '6' };
  const n = require('../services/ingestion/normalization').normalize(observation);
  const scope = { channel: 'observation', source_id: String(sid), observation, key: observation.idempotency_key, hash_input: n.input, date: n.date };
  const s = call(db, 'ingestion_core_snapshot', [scope]), d = core.decideIngestion(s.facts, scope);
  assert.equal(d.reason, 'protected_transaction');
  d.outcome = 'reconciled'; d.target = first.transaction_id;
  const r = sql(db, `SET ROLE service_role; SELECT ingestion_core_commit(${quote(scope)},${quote(s.token)},${quote(d)});`, true);
  assert.notEqual(r.status, 0, 'protected cash cannot receive a forged reconciliation link');
  assert.equal(count(db), 1);
  assert.equal(scalar(db, `SELECT count(*) FROM transaction_source_observations WHERE source_id=${sid};`), '0');
});

test('review: malformed enrichment cannot overwrite an owner charge-date decision', async () => {
  const db = createCase(), sid = configure(db, 'cal'), first = await wallet(db, sid, 'protected-charge');
  sql(db, `UPDATE transactions SET charge_date='2026-11-10' WHERE id=${first.transaction_id};`);
  const command = { source_id: String(sid), observation_id: first.observation_id,
    expected_revision: scalar(db, `SELECT decision_revision FROM transaction_source_observations WHERE id=${first.observation_id}`),
    charge_date: '2026-11-11', actor: 'synthetic' };
  const scope = { command_kind: 'amend', request_key: randomUUID(), command };
  const s = call(db, 'ingestion_core_snapshot', [scope]), d = core.decideCommand(s.facts, scope);
  assert.equal(d.reason, 'enrichment_conflict');
  d.enrichment = { ok: true, transaction_id: first.transaction_id, creator_id: first.observation_id, charge_date: command.charge_date };
  const r = sql(db, `SET ROLE service_role; SELECT ingestion_core_commit(${quote(scope)},${quote(s.token)},${quote(d)});`, true);
  assert.notEqual(r.status, 0, 'enrichment must not bypass sticky owner override');
  assert.equal(scalar(db, `SELECT charge_date FROM transactions WHERE id=${first.transaction_id}`), '2026-11-10');
});

test('review: historical resolution binds nested financial evidence to the owner command', async () => {
  const db = createCase(true), sid = configure(db, 'cal');
  sql(db, `INSERT INTO transaction_api_registrations(account_key,source_id,enabled,history_reviewed,installment_date_policy) VALUES('synthetic-account',${sid},true,true,'billing');`);
  const { client_id, ...item } = require('./fixtures/generalTransaction').item();
  const receipt = json(db, `SELECT ingest_general_transaction('synthetic-account',${quote({...item,event:{...item.event,status:'pending'}})});`);
  sql(db, migration);
  const view = call(db, 'get_general_receipt', [receipt.receipt_id]);
  const command = { receipt_id: receipt.receipt_id, expected_revision: view.revision, review_token: view.review_token, item,
    actor: 'owner:synthetic', reason: 'Verified source evidence', relationship: { kind: 'same_identity' } };
  const scope = { command_kind: 'general', request_key: randomUUID(), command, date: item.dates.purchase };
  const s = call(db, 'ingestion_core_snapshot', [scope]);
  const d = require('../services/ingestion/historicalReceipts').decide(s.facts, scope, core.decideIngestion);
  assert.equal(d.nested.outcome, 'created');
  // Keep the fabricated nested scope/observation internally congruent. Only the
  // outer immutable owner command exposes the forged amount.
  d.nested.normalized.amount_minor = '99900'; d.nested.normalized.input.accounting_amount = '999.00';
  d.nested.posting.total_amount = '999.00';
  d.nested_scope.observation.accounting_amount = '999.00'; d.nested_scope.hash_input.accounting_amount = '999.00';
  const r = sql(db, `SET ROLE service_role; SELECT ingestion_core_commit(${quote(scope)},${quote(s.token)},${quote(d)});`, true);
  assert.notEqual(r.status, 0, 'nested financial effect must match owner-approved evidence');
  assert.equal(count(db), 0); assert.equal(scalar(db, 'SELECT count(*) FROM transaction_api_resolutions;'), '0');
});

test('review: outstanding 057 owner decisions and committed command replays survive 058', async () => {
  for (const commitBeforeUpgrade of [false, true]) {
    const db = createCase(true), sid = configure(db), first = call(db, 'ingest_external_transaction', [item('existing'), false]);
    const pending = call(db, 'ingest_observation', [sid, { idempotency_key: 'pending', merchant: 'Synthetic Shop', accounting_amount: '150.00',
      currency: 'ILS', movement_type: 'expense', transaction_date: '2026-11-08', payment_source_id: '6' }]);
    const view = call(db, 'read_reconciliation', ['observation', [], pending.observation_id]), key = randomUUID();
    const command = { observation_id: pending.observation_id, expected_revision: view.observation.revision,
      expected_candidate_fingerprints: view.candidate_fingerprints, action: 'link', transaction_id: first.transaction_id,
      expected_transaction_fingerprint: view.candidates[0].fingerprint, actor: 'owner:synthetic', reason: 'Verified independent evidence' };
    if (commitBeforeUpgrade) call(db, 'review_reconciliation', [key, command]);
    sql(db, migration);
    if (!commitBeforeUpgrade) {
      const after = await require('../services/ingestion/readers').read(dbClient(db), 'observation', [], pending.observation_id);
      assert.deepEqual(after.candidate_fingerprints, view.candidate_fingerprints);
      assert.equal(after.candidates[0].fingerprint, view.candidates[0].fingerprint);
    }
    const result = await core.command(dbClient(db), 'resolve', key, command, true);
    assert.equal(result.transaction_id, first.transaction_id);
    assert.equal(result.replayed, commitBeforeUpgrade);
    assert.equal((await core.command(dbClient(db), 'resolve', key, command, true)).replayed, true);
    assert.equal((await core.command(dbClient(db), 'resolve', key, {...command,reason:'Changed owner command'}, true)).reason_code, 'command_key_conflict');
    assert.equal(count(db), 1);
  }
});

test('review: merchant repertoire remains equal to the retained SQL canonicalizer', () => {
  const db = createCase(), { normalizeMerchant } = require('../services/ingestion/normalization');
  for (const value of ['SHOP \u20c1 \uA7CE \uA7F1', 'a!\u20c1?b', 'A\u030A \u0130 \uFF21\u2122', 'A\u{1e030}B']) {
    assert.equal(normalizeMerchant(value), scalar(db, `SELECT apy_merchant(${quote(value)});`));
  }
});
