// Real isolated PostgreSQL; no .env, network DB URLs or production credentials.
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const container = `finance-apy02-${process.pid}`;
const read = f => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
const full = read('server/full_schema.sql');
const baseline = full.split('-- Migration 036:')[0];
const migration = read('server/migrations/036_transaction_ingestion_foundation.sql');
let created = false, sequence = 0, commandSequence = 0;
const run = (args, input, allow = false) => {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 32e6, timeout: 60000 });
  if (!allow) assert.equal(r.status, 0, r.stderr || r.error?.message);
  return r;
};
const sql = (db, input, allow = false) => run(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq'], input, allow);
const scalar = (db, text) => sql(db, text).stdout.trim();
const json = (db, text) => JSON.parse(scalar(db, text));
const quote = x => x === null ? 'NULL' : `'${String(typeof x === 'object' ? JSON.stringify(x) : x).replaceAll("'", "''")}'`;
const statement = (fn, args) => `SET ROLE service_role; SELECT ${fn}(${args.map(quote).join(',')});`;
const call = (db, fn, args) => json(db, statement(fn, args));
const key = () => `00000000-0000-4000-8000-${String(++commandSequence).padStart(12, '0')}`;
const payload = (id, extra = {}) => ({ idempotency_key: id, merchant: 'AROMA', accounting_amount: '24.00', currency: 'ILS', movement_type: 'expense', transaction_date: '2026-09-22', payment_source_id: '1', category_id: '100', ...extra });
const reference = value => ({ provider: 'test', type: 'purchase', scope: 'card-1', value });
const configuration = { payment_source_ids: ['1'], time_verified: true, verified_references: [{ provider: 'test', type: 'purchase', scope: 'card-1' }], aliases: [{ merchant: 'WOLT', key: 'wolt' }, { merchant: '\u05d5\u05d5\u05dc\u05d8 \u05d0\u05e0\u05d8\u05e8\u05e4\u05e8\u05d9\u05d9\u05d6\u05e1 \u05d9\u05e9\u05e8\u05d0\u05dc', key: 'wolt' }] };
const configure = (db, kind, config = configuration, extra = {}) => call(db, 'configure_ingestion_source', [key(), { source_kind: kind, instance_key: 'test', actor: 'test-owner', configuration: config, ...extra }]);
const ingest = (ctx, kind, p) => call(ctx.db, 'ingest_observation', [ctx[kind], p]);
const detail = (ctx, id) => call(ctx.db, 'get_ingestion_observation', [id]);
const totals = db => json(db, "SELECT jsonb_build_object('count',count(*),'amount',coalesce(sum(total_amount),0)::text) FROM transactions WHERE voided_at IS NULL;");
const make = () => {
  const db = `case_${++sequence}`;sql('postgres', `CREATE DATABASE ${db} TEMPLATE apy_clean;`);
  sql(db, "INSERT INTO categories(id,name,type) VALUES(100,'ordinary','expense'),(101,'income','income'); INSERT INTO payment_sources(id,name,slug,method,last4) VALUES(1,'card','card','credit_card','1234');");
  return { db, apple: configure(db, 'apple_pay').source_id, cal: configure(db, 'cal').source_id };
};
const concurrent = (db, input) => new Promise((resolve, reject) => {
  const p = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq']);
  let out = '', err = '';p.stdout.on('data', b => { out += b; });p.stderr.on('data', b => { err += b; });p.on('error', reject);p.on('close', status => resolve({ status, out, err }));p.stdin.end(input);
});
const race = async (ctx, commands) => {
  const results = await Promise.all(commands.map(([source, p]) => concurrent(ctx.db, `BEGIN; SET LOCAL lock_timeout='5s'; SELECT pg_sleep(0.2); ${statement('ingest_observation', [source, p])} COMMIT;`)));
  for (const r of results) assert.equal(r.status, 0, r.err);
  return results.map(r => JSON.parse(r.out.trim()));
};
before(async () => {
  run(['run', '-d', '--rm', '--name', container, '--label', 'finance.disposable=apy02', '-e', 'POSTGRES_PASSWORD=local_test_only', 'postgres:16-alpine']);created = true;
  const target = JSON.parse(run(['inspect', container]).stdout)[0];
  assert.equal(target.Config.Labels['finance.disposable'], 'apy02');assert.equal(target.Config.Image, 'postgres:16-alpine');assert.deepEqual(target.HostConfig.PortBindings || {}, {});
  for (let n = 0; n < 60; n++) { if (run(['exec', container, 'pg_isready', '-U', 'postgres'], undefined, true).status === 0) break; await new Promise(r => setTimeout(r, 200)); }
  sql('postgres', 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE DATABASE apy_baseline; CREATE DATABASE apy_clean;');
  sql('apy_baseline', baseline);sql('apy_clean', full);
  // Existing application grants only: never grant blanket access to APY objects.
  for (const db of ['apy_baseline','apy_clean']) sql(db, 'GRANT SELECT,INSERT,DELETE ON transactions TO service_role; GRANT SELECT ON categories,payment_sources TO service_role; GRANT USAGE,SELECT ON SEQUENCE transactions_id_seq TO service_role;');
});
after(() => { if (created) run(['rm', '-f', container]); });

test('035 upgrade and clean 036 install agree; backfill/rerun preserve historical cash exactly', () => {
  const db = 'upgrade';sql('postgres', `CREATE DATABASE ${db} TEMPLATE apy_baseline;`);
  sql(db, "INSERT INTO transactions(transaction_date,charge_date,total_amount,movement_type,external_id) VALUES('2026-01-01','2026-02-01',84.90123,'expense','legacy'),('2026-01-02','2026-02-02',24,'expense',''),('2026-01-03','2026-01-03',25,'expense',NULL);");
  const cash = scalar(db,'SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM transactions t;');
  sql(db,migration);sql(db,migration);
  assert.equal(scalar(db,'SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM transactions t;'),cash);
  assert.deepEqual(json(db,"SELECT jsonb_build_object('count',count(*),'origin',min(evidence_origin),'occurred',count(occurred_at),'minor',count(amount_minor)) FROM transaction_source_observations;"),{count:1,origin:'legacy_backfill',occurred:0,minor:0});
  const definitions = d => json(d,"SELECT jsonb_object_agg(proname,pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'apy_%' OR proname IN ('ingest_observation','savings_guard_transaction'));");
  assert.deepEqual(definitions(db),definitions('apy_clean'));
});
test('provider reference absent: new cash is live, receipt immutable, same-key replay adds nothing', () => {
  const c=make(),p=payload('A'),a=ingest(c,'apple',p),before=detail(c,a.observation_id),b=ingest(c,'apple',p);
  assert.equal(a.outcome,'created');assert.equal(b.outcome,'already_observed');assert.equal(a.transaction_id,b.transaction_id);
  assert.equal(before.provider_reference,null);assert.equal(before.occurred_at,null);assert.equal(before.observed_at,detail(c,a.observation_id).observed_at);
  assert.deepEqual(totals(c.db),{count:1,amount:'24.0000000000000000'});
  assert.equal(scalar(c.db,'SELECT count(*) FROM transaction_source_observations;'),'1');
});
test('same-key changed amount conflicts without rewriting accepted cash or observation', () => {
  const c=make();ingest(c,'apple',payload('A'));const r=ingest(c,'apple',payload('A',{accounting_amount:'24.01'}));
  assert.equal(r.outcome,'conflict');assert.equal(r.reason_code,'idempotency_key_conflict');assert.equal(scalar(c.db,'SELECT amount_minor FROM transaction_source_observations;'),'2400');assert.equal(totals(c.db).count,1);
});
test('real concurrent same-source deliveries create one observation and one cash row', async () => {
  const c=make(),p=payload('A');const r=await race(c,[[c.apple,p],[c.apple,p]]);
  assert.deepEqual(r.map(x=>x.outcome).sort(),['already_observed','created']);assert.equal(r[0].observation_id,r[1].observation_id);assert.equal(totals(c.db).count,1);
});
test('real concurrent conflicting same-key delivery commits one winner, one deterministic conflict', async () => {
  const c=make();const r=await race(c,[[c.apple,payload('A')],[c.apple,payload('A',{accounting_amount:'24.01'})]]);
  assert.deepEqual(r.map(x=>x.outcome).sort(),['conflict','created']);assert.equal(totals(c.db).count,1);assert.equal(scalar(c.db,'SELECT count(*) FROM transaction_source_observations;'),'1');
});
test('real concurrent cross-source common reference serializes to one canonical purchase', async () => {
  const c=make(),extra={provider_reference:reference('purchase-1')};const r=await race(c,[[c.apple,payload('A',extra)],[c.cal,payload('B',extra)]]);
  assert.deepEqual(r.map(x=>x.outcome).sort(),['created','reconciled']);assert.equal(r[0].transaction_id,r[1].transaction_id);assert.equal(totals(c.db).count,1);
});
test('minute precision distinguishes repeated purchases; date-only ambiguity and retries add zero cash', () => {
  const c=make(),a=ingest(c,'apple',payload('A',{occurred_at:'2026-09-22T08:30+03:00'}));
  ingest(c,'apple',payload('B',{occurred_at:'2026-09-22T16:00+03:00'}));
  const time=ingest(c,'cal',payload('C',{occurred_at:'2026-09-22T08:31+03:00'}));assert.equal(time.transaction_id,a.transaction_id);assert.equal(time.reason_code,'precision_time');
  const noTime=ingest(c,'cal',payload('D'));assert.equal(noTime.outcome,'ambiguous');assert.equal(noTime.transaction_id,null);
  assert.equal(ingest(c,'cal',payload('D')).disposition,'pending');assert.equal(totals(c.db).count,2);
  const d=detail(c,a.observation_id);assert.equal(d.occurred_at_raw,'2026-09-22T08:30+03:00');assert.equal(d.time_precision,'minute');
});
test('CAL-first ambiguous Apple stays pending: Budget/Reports retain two purchases, never a third', async () => {
  const c=make();ingest(c,'cal',payload('C1'));ingest(c,'cal',payload('C2'));
  const before=totals(c.db),r=await race(c,[[c.apple,payload('A')],[c.apple,payload('A')]]);
  assert.deepEqual(r.map(x=>x.outcome).sort(),['already_observed','ambiguous']);assert.ok(r.every(x=>x.transaction_id===null));assert.deepEqual(totals(c.db),before);
  assert.equal(scalar(c.db,"SELECT sum(total_amount)::numeric(18,2) FROM budget_actual_transactions('2026-09-01','2026-09-30');"),'48.00');
  assert.equal(scalar(c.db,"SELECT count(*) FROM transactions_filtered(p_from=>'2026-09-01',p_to=>'2026-09-30');"),'2');
});
test('approved aliases and date-only matching attach; provisional charge enrichment preserves user fields', () => {
  const c=make(),a=ingest(c,'apple',payload('A',{merchant:'WOLT',accounting_amount:'84.90'}));
  sql(c.db,`UPDATE transactions SET description='my title',notes='my notes',tags='mine',category_id=NULL WHERE id=${a.transaction_id};`);
  const b=ingest(c,'cal',payload('B',{merchant:configuration.aliases[1].merchant,accounting_amount:'84.90',charge_date:'2026-10-10'}));assert.equal(b.outcome,'reconciled');assert.equal(b.transaction_id,a.transaction_id);
  assert.deepEqual(json(c.db,`SELECT jsonb_build_object('description',description,'notes',notes,'tags',tags,'category',category_id,'charge',charge_date) FROM transactions WHERE id=${a.transaction_id};`),{description:'my title',notes:'my notes',tags:'mine',category:null,charge:'2026-10-10'});
});
test('unverified provider references are non-unique evidence, not global or same-source identity', () => {
  const c=make(),ref={provider:'unknown',type:'authorization',scope:'unverified',value:'reused'};
  const a=ingest(c,'apple',payload('A',{provider_reference:ref})),b=ingest(c,'apple',payload('B',{provider_reference:ref}));assert.notEqual(a.transaction_id,b.transaction_id);
  assert.equal(scalar(c.db,'SELECT count(DISTINCT provider_reference) FROM transaction_source_observations;'),'1');assert.equal(totals(c.db).count,2);
});
test('payment resolution rejects multiple last4 matches, supports approved device mapping, checks conflicts', () => {
  const c=make();sql(c.db,"INSERT INTO payment_sources(id,name,slug,method,last4) VALUES(2,'other','other','credit_card','1234');");
  configure(c.db,'apple_pay',{...configuration,payment_source_ids:['1','2'],card_mappings:[{card_reference:'device-token',payment_source_id:'2'}]},{expected_revision:'1'});
  const noId=payload('A',{payment_source_id:null,payment_evidence:{last4:'1234'}});
  assert.equal(ingest(c,'apple',noId).reason_code,'payment_source_ambiguous');assert.equal(totals(c.db).count,0);
  const mapped=ingest(c,'apple',{...noId,payment_evidence:{card_reference:'device-token',last4:'1234'}});assert.equal(mapped.outcome,'created');
  assert.equal(scalar(c.db,'SELECT payment_source_id FROM transactions;'),'2');
  assert.equal(ingest(c,'apple',payload('B',{payment_evidence:{card_reference:'device-token'}})).reason_code,'payment_source_conflict');
  assert.equal(ingest(c,'apple',payload('C',{payment_source_id:null,payment_evidence:{last4:'9999'}})).reason_code,'payment_source_not_found');
});
test('exact huge amounts, foreign original evidence and decimal validation never round matching values', () => {
  const c=make();const p=payload('large',{accounting_amount:'9007199254740993.01',original_amount:'35.000',original_currency:'KWD',original_scale:'3'});
  assert.equal(ingest(c,'apple',p).outcome,'created');assert.equal(scalar(c.db,'SELECT amount_minor FROM transaction_source_observations;'),'900719925474099301');
  assert.equal(scalar(c.db,'SELECT total_amount::numeric(30,2) FROM transactions;'),'9007199254740993.01');
  for(const extra of [{accounting_amount:'1.001'},{accounting_amount:84.9},{currency:'USD'},{source_metadata:{Authorization:'forbidden'}},{secret:'forbidden'}]) assert.equal(ingest(c,'apple',payload('invalid',extra)).outcome,'rejected');
  assert.equal(totals(c.db).count,1);
});
test('source normalization matches Node; timestamps preserve unknown zones and midnight accounting date', () => {
  const c=make(),{normalizeMerchant}=require('../services/transactionIngestionService');
  for(const merchant of [' ＡＲＯＭＡ - 123! ','\u200fוולט  ישראל','Café + 9']) assert.equal(scalar(c.db,`SELECT apy_merchant(${quote(merchant)});`),normalizeMerchant(merchant));
  const a=ingest(c,'apple',payload('A',{occurred_at:'2026-09-22T23:59:40+03:00',provider_reference:reference('midnight')}));
  const b=ingest(c,'cal',payload('B',{transaction_date:'2026-09-23',provider_reference:reference('midnight')}));assert.equal(a.transaction_id,b.transaction_id);assert.equal(scalar(c.db,'SELECT transaction_date FROM transactions;'),'2026-09-22');
  const naive=ingest(c,'apple',payload('naive',{occurred_at:'2026-09-22T16:00'}));assert.equal(detail(c,naive.observation_id).occurred_at,null);
});
test('identity edit-away-and-back remains sticky; charge override never overwritten by CAL', () => {
  const c=make(),a=ingest(c,'apple',payload('A'));
  sql(c.db,`UPDATE transactions SET total_amount=25 WHERE id=${a.transaction_id};UPDATE transactions SET total_amount=24 WHERE id=${a.transaction_id};`);
  assert.equal(ingest(c,'cal',payload('B')).reason_code,'identity_edited');assert.equal(totals(c.db).count,1);
  const other=make(),b=ingest(other,'apple',payload('A'));
  sql(other.db,`UPDATE transactions SET charge_date='2026-09-23' WHERE id=${b.transaction_id};UPDATE transactions SET charge_date='2026-09-22' WHERE id=${b.transaction_id};`);
  const r=ingest(other,'cal',payload('B',{charge_date:'2026-10-10'}));assert.equal(r.outcome,'reconciled');assert.equal(r.reason_code,'enrichment_conflict');assert.equal(r.review_required,true);assert.equal(scalar(other.db,'SELECT charge_date FROM transactions;'),'2026-09-22');
});
test('amendment receipt enriches provisional charge date without changing original replay fingerprint', () => {
  const c=make();ingest(c,'apple',payload('A'));const b=ingest(c,'cal',payload('B')),request=key();
  const cmd={source_id:c.cal,observation_id:b.observation_id,expected_revision:b.decision_revision,charge_date:'2026-10-10',actor:'cal-adapter'};
  const r=call(c.db,'amend_observation',[request,cmd]);assert.equal(r.review_required,false);assert.equal(scalar(c.db,'SELECT charge_date FROM transactions;'),'2026-10-10');
  assert.equal(call(c.db,'amend_observation',[request,cmd]).replayed,true);assert.equal(ingest(c,'cal',payload('B')).outcome,'already_observed');
  assert.equal(call(c.db,'amend_observation',[request,{...cmd,charge_date:'2026-10-11'}]).reason_code,'command_key_conflict');
});
test('review link and separate are explicit, stale-safe and replay-safe with correct cash effects', () => {
  const c=make(),a=ingest(c,'cal',payload('A'));ingest(c,'cal',payload('B'));const pending=ingest(c,'apple',payload('P'));
  const d=detail(c,pending.observation_id),fp=scalar(c.db,`SELECT apy_cash_fingerprint(${a.transaction_id});`),request=key();
  const cmd={observation_id:pending.observation_id,expected_revision:d.decision_revision,action:'link',transaction_id:a.transaction_id,expected_transaction_fingerprint:fp,reason:'owner chose receipt',actor:'owner'};
  const linked=call(c.db,'resolve_observation',[request,cmd]);assert.equal(linked.transaction_id,a.transaction_id);assert.equal(totals(c.db).count,2);assert.equal(call(c.db,'resolve_observation',[request,cmd]).replayed,true);
  const p2=ingest(c,'apple',payload('P2')),view=detail(c,p2.observation_id),separate={observation_id:p2.observation_id,expected_revision:view.decision_revision,action:'separate',expected_candidate_fingerprints:view.candidate_fingerprints,reason:'a third purchase',actor:'owner'};
  sql(c.db,`UPDATE transactions SET notes='changed since review' WHERE id=${a.transaction_id};`);
  assert.equal(call(c.db,'resolve_observation',[key(),separate]).reason_code,'stale_review');assert.equal(totals(c.db).count,2);
  separate.expected_candidate_fingerprints=detail(c,p2.observation_id).candidate_fingerprints;const separateKey=key();
  assert.equal(call(c.db,'resolve_observation',[separateKey,separate]).outcome,'created');assert.equal(call(c.db,'resolve_observation',[separateKey,separate]).replayed,true);assert.equal(totals(c.db).count,3);
});
test('APY cancellation is explicit, audited, idempotent, and later CAL/retry cannot resurrect history', () => {
  const c=make(),a=ingest(c,'apple',payload('A')),d=detail(c,a.observation_id),request=key();
  assert.notEqual(sql(c.db,`DELETE FROM transactions WHERE id=${a.transaction_id};`,true).status,0);
  const cmd={transaction_id:a.transaction_id,expected_revision:d.decision_revision,expected_transaction_fingerprint:d.expected_transaction_fingerprint,reason:'owner cancelled',actor:'owner'};
  assert.equal(call(c.db,'cancel_ingested_transaction',[request,cmd]).disposition,'cancelled');assert.equal(call(c.db,'cancel_ingested_transaction',[request,cmd]).replayed,true);
  assert.equal(ingest(c,'apple',payload('A')).disposition,'cancelled');assert.equal(ingest(c,'cal',payload('B')).reason_code,'cancelled_record_exists');assert.equal(totals(c.db).count,0);
  assert.equal(scalar(c.db,'SELECT count(*) FROM transactions;'),'1');
});
test('private grants, no direct provenance mutations, append-only audit and no spoofed void receipt', () => {
  const c=make(),a=ingest(c,'apple',payload('A'));
  for(const role of ['anon','authenticated','service_role'])for(const table of ['transaction_ingestion_sources','transaction_source_observations','transaction_reconciliation_events'])assert.notEqual(sql(c.db,`SET ROLE ${role};DELETE FROM ${table};`,true).status,0);
  for(const role of ['anon','authenticated'])assert.notEqual(sql(c.db,`SET ROLE ${role};SELECT ingest_observation(${c.apple},${quote(payload('forbidden'))});`,true).status,0);
  assert.notEqual(sql(c.db,`SET ROLE service_role;SELECT apy_create_cash(${a.observation_id});`,true).status,0);
  assert.notEqual(sql(c.db,'UPDATE transaction_reconciliation_events SET reason_code=reason_code;',true).status,0);
  assert.notEqual(sql(c.db,`UPDATE transactions SET voided_at=now(),void_request_key=${quote(key())},void_fingerprint='fake',void_reason='fake' WHERE id=${a.transaction_id};`,true).status,0);
});
test('failure after cash creation rolls back observation, canonical row and decision receipt', () => {
  const c=make();sql(c.db,"CREATE FUNCTION fail_apy_test() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event_kind='created' THEN RAISE EXCEPTION 'test rollback';END IF;RETURN NEW;END$$;CREATE TRIGGER test_rollback BEFORE INSERT ON transaction_reconciliation_events FOR EACH ROW EXECUTE FUNCTION fail_apy_test();");
  assert.notEqual(sql(c.db,statement('ingest_observation',[c.apple,payload('A')]),true).status,0);assert.equal(totals(c.db).count,0);assert.equal(scalar(c.db,'SELECT count(*) FROM transaction_source_observations;'),'0');
  sql(c.db,'DROP TRIGGER test_rollback ON transaction_reconciliation_events;');assert.equal(ingest(c,'apple',payload('A')).outcome,'created');
});
test('legacy insert mirrors atomically; missing/blank IDs and legacy deletion preserve old behavior', () => {
  const c=make();const insert=id=>`INSERT INTO transactions(transaction_date,charge_date,total_amount,movement_type,external_id) VALUES('2026-09-22','2026-09-22',1.234,'expense',${quote(id)});`;
  sql(c.db,insert('legacy'));assert.equal(scalar(c.db,"SELECT count(*) FROM transaction_source_observations WHERE evidence_origin='legacy_insert';"),'1');
  assert.notEqual(sql(c.db,insert('legacy'),true).status,0);sql(c.db,insert(null)+insert(null)+insert(''));
  assert.notEqual(sql(c.db,insert(''),true).status,0);assert.equal(scalar(c.db,'SELECT count(*) FROM transaction_source_observations;'),'1');
  sql(c.db,"DELETE FROM transactions WHERE external_id='legacy';");sql(c.db,insert('legacy'));assert.equal(scalar(c.db,'SELECT count(*) FROM transaction_source_observations;'),'1');
});
test('source configuration/revocation is audited; accepted replay ignores later card resolution changes', () => {
  const c=make(),a=ingest(c,'apple',payload('A'));configure(c.db,'apple_pay',{...configuration,payment_source_ids:[]},{expected_revision:'1'});
  assert.equal(ingest(c,'apple',payload('A')).observation_id,a.observation_id);assert.equal(ingest(c,'apple',payload('B')).reason_code,'payment_source_not_found');
  configure(c.db,'apple_pay',configuration,{expected_revision:'2',is_active:false});assert.equal(ingest(c,'apple',payload('A')).reason_code,'source_unavailable');
});
test('domain-protected Loan and itemized cash cannot use generic APY cancellation', () => {
  const c=make(),a=ingest(c,'apple',payload('A'));
  sql(c.db,"INSERT INTO loans(id,name,original_amount,current_balance) VALUES(1,'loan',1000,1000);");sql(c.db,`UPDATE transactions SET loan_id=1 WHERE id=${a.transaction_id};`);
  const d=detail(c,a.observation_id);assert.equal(call(c.db,'cancel_ingested_transaction',[key(),{transaction_id:a.transaction_id,expected_revision:d.decision_revision,expected_transaction_fingerprint:d.expected_transaction_fingerprint,reason:'attempt',actor:'owner'}]).reason_code,'protected_transaction');
  const loanDefinitions=db=>scalar(db,"SELECT jsonb_object_agg(oid::regprocedure::text,pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE '%loan%';");assert.equal(loanDefinitions(c.db),loanDefinitions('apy_baseline'));
  sql(c.db,`UPDATE transactions SET loan_id=NULL WHERE id=${a.transaction_id};INSERT INTO transaction_items(transaction_id,item_name) VALUES(${a.transaction_id},'item');`);
  const item=detail(c,a.observation_id);assert.equal(call(c.db,'cancel_ingested_transaction',[key(),{transaction_id:a.transaction_id,expected_revision:item.decision_revision,expected_transaction_fingerprint:item.expected_transaction_fingerprint,reason:'attempt',actor:'owner'}]).reason_code,'protected_transaction');
});
test('ordered 029 foundation through 030-036 equals clean installation; failed upgrade rolls back', () => {
  const db='ordered',broken='interrupted';sql('postgres',`CREATE DATABASE ${db}; CREATE DATABASE ${broken} TEMPLATE apy_baseline;`);
  sql(db,full.split('-- Migration 030: Savings foundation')[0]);
  for(const f of fs.readdirSync(path.join(__dirname,'../migrations')).filter(f=>/^03[0-6]_.*\.sql$/.test(f)).sort())sql(db,read('server/migrations/'+f));
  const inventory=d=>json(d,"SELECT jsonb_build_object('functions',(SELECT jsonb_object_agg(oid::regprocedure::text,pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f'),'indexes',(SELECT jsonb_object_agg(indexname,indexdef) FROM pg_indexes WHERE schemaname='public'),'constraints',(SELECT jsonb_object_agg(conrelid::regclass::text||'.'||conname,pg_get_constraintdef(oid)) FROM pg_constraint WHERE connamespace='public'::regnamespace),'triggers',(SELECT jsonb_object_agg(tgname||tgrelid::regclass::text,pg_get_triggerdef(oid)) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)));");
  assert.deepEqual(inventory(db),inventory('apy_clean'));
  assert.notEqual(sql(broken,migration.replace(/COMMIT;\s*$/,'SELECT 1/0;\nCOMMIT;'),true).status,0);
  assert.equal(scalar(broken,"SELECT to_regclass('transaction_source_observations') IS NULL;"),'t');sql(broken,migration);
});
test('observed_at/input are immutable and supplied date/instant discrepancy is retained', () => {
  const c=make(),r=ingest(c,'apple',payload('A',{transaction_date:'2026-09-23',occurred_at:'2026-09-22T23:59:40+03:00'}));assert.equal(detail(c,r.observation_id).date_discrepancy,true);
  assert.notEqual(sql(c.db,`UPDATE transaction_source_observations SET observed_at=observed_at-interval '1 minute' WHERE id=${r.observation_id};`,true).status,0);
  assert.notEqual(sql(c.db,`UPDATE transaction_source_observations SET accepted_payload='{}' WHERE id=${r.observation_id};`,true).status,0);
});
test('v1 controller uses real persistence: 201/409/dry-run/missing IDs and mirrored deletion remain compatible', async () => {
  const c=make(),{loadControllerWithFake,createMockResponse}=require('./helpers/fakeSupabase');
  // Only the Supabase transport is replaced; every lookup/INSERT goes to PostgreSQL.
  const db={from:table=>{assert.equal(table,'transactions');return {
    select:()=>({eq:(column,value)=>({maybeSingle:async()=>({data:json(c.db,`SELECT coalesce((SELECT jsonb_build_object('id',id,'voided_at',voided_at) FROM transactions WHERE ${column}=${quote(value)}),'null'::jsonb);`)})})}),
    insert:row=>({select:()=>({single:async()=>{
      const cols=Object.keys(row),values=cols.map(k=>quote(row[k]));
      const r=sql(c.db,`SET ROLE service_role; WITH t AS (INSERT INTO transactions(${cols.join(',')}) VALUES(${values.join(',')}) RETURNING id,external_id,created_at) SELECT row_to_json(t) FROM t;`,true);
      if(r.status!==0)return {data:null,error:{code:r.stderr.includes('duplicate key')?'23505':'DB_ERROR'}};
      return {data:JSON.parse(r.stdout.trim()),error:null};
    }})})
  };}};
  const controller=loadControllerWithFake('../../controllers/v1/transactionController',db);
  const invoke=async extra=>{const res=createMockResponse();await controller.createTransaction({body:{type:'expense',amount:1.234,date:'2026-09-22',...extra}},res);return res;};
  assert.equal((await invoke({external_id:'real-v1'})).statusCode,201);const duplicate=await invoke({external_id:'real-v1'});assert.equal(duplicate.statusCode,409);assert.equal(duplicate.body.error,'already_exists');
  const count=totals(c.db).count;const dry=await invoke({external_id:'dry',dry_run:true});assert.equal(dry.statusCode,200);assert.equal(dry.body.dry_run,true);assert.equal(totals(c.db).count,count);
  assert.equal((await invoke({})).statusCode,201);assert.equal((await invoke({})).statusCode,201);assert.equal((await invoke({external_id:null})).statusCode,400);
  assert.equal(scalar(c.db,'SELECT count(*) FROM transaction_source_observations;'),'1');
});
test('Savings-linked legacy cash backfills unchanged and cancelled legacy API identity stays reserved', async () => {
  const db='savings_legacy';sql('postgres',`CREATE DATABASE ${db} TEMPLATE apy_baseline;`);
  sql(db,"INSERT INTO payment_sources(id,name,slug,method) VALUES(1,'local','local','bank_transfer');");
  const a=call(db,'create_savings_account',[key(),{name:'test',opened_on:'2020-01-01',tracking_start_date:'2020-01-01'},'0','0',null]);
  const account=call(db,'get_savings_account',['1']),category=scalar(db,"SELECT id FROM categories WHERE savings_role='deposit';");
  const posted=call(db,'post_savings_event',[key(),{action:'create_cash',account_id:'1',expected_revision:account.account.revision,event_kind:'deposit',amount:'50.00',effective_date:'2020-01-02',charge_date:'2020-01-02',description:'deposit',category_id:category,payment_source_id:'1'}]);
  sql(db,`UPDATE transactions SET external_id='saved-history' WHERE id=${posted.transaction_id};`);
  const cash=json(db,`SELECT row_json FROM transactions_filtered(p_transaction_id=>${posted.transaction_id});`);
  call(db,'cancel_savings_event',[key(),cash.savings.entry_id,cash.savings.revision,'void','owner cancelled']);
  const before=scalar(db,'SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM transactions t;'),entries=scalar(db,'SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM savings_entries e;');sql(db,migration);
  assert.equal(scalar(db,'SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM transactions t;'),before);assert.equal(scalar(db,'SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM savings_entries e;'),entries);
  assert.equal(scalar(db,"SELECT count(*) FROM transaction_source_observations o JOIN transactions t ON t.id=o.transaction_id WHERE t.voided_at IS NOT NULL AND o.idempotency_key='saved-history';"),'1');
  assert.notEqual(sql(db,`DELETE FROM transactions WHERE id=${posted.transaction_id};`,true).status,0);
  assert.notEqual(sql(db,"INSERT INTO transactions(transaction_date,charge_date,total_amount,movement_type,external_id) VALUES('2020-01-02','2020-01-02',50,'expense','saved-history');",true).status,0);
  assert.equal(a.account.id,'1');
  const {loadControllerWithFake,createMockResponse}=require('./helpers/fakeSupabase');
  const transport={from:table=>{assert.equal(table,'transactions');return {select:()=>({eq:(column,value)=>({maybeSingle:async()=>({data:json(db,`SELECT jsonb_build_object('id',id,'voided_at',voided_at) FROM transactions WHERE ${column}=${quote(value)};`)})})})};}};
  const controller=loadControllerWithFake('../../controllers/v1/transactionController',transport),response=createMockResponse();
  await controller.createTransaction({body:{type:'expense',amount:50,date:'2020-01-02',external_id:'saved-history'}},response);
  assert.equal(response.statusCode,409);assert.equal(response.body.error,'cancelled_record_exists');
});
test('manual row-first edit and APY table-first ingest contend without deadlock or stale attach', async () => {
  const c=make(),a=ingest(c,'apple',payload('A'));
  const editing=concurrent(c.db,`BEGIN;SET LOCAL lock_timeout='5s';SELECT id FROM transactions WHERE id=${a.transaction_id} FOR UPDATE;SELECT pg_sleep(0.6);UPDATE transactions SET total_amount=25 WHERE id=${a.transaction_id};COMMIT;`);
  await new Promise(r=>setTimeout(r,150));const arriving=concurrent(c.db,`SET lock_timeout='5s';${statement('ingest_observation',[c.cal,payload('B')])}`);
  const [edit,ingested]=await Promise.all([editing,arriving]);assert.equal(edit.status,0,edit.err);assert.equal(ingested.status,0,ingested.err);
  assert.equal(JSON.parse(ingested.out.trim()).reason_code,'identity_edited');assert.equal(totals(c.db).count,1);
});

test('pending CAL amendment is retained through separate/link review without overwriting manual charge dates', () => {
  for (const action of ['separate','link']) {
    const c=make(),a=ingest(c,'apple',payload('A'));ingest(c,'apple',payload('B'));
    const p=ingest(c,'cal',payload('P'));
    call(c.db,'amend_observation',[key(),{source_id:c.cal,observation_id:p.observation_id,expected_revision:p.decision_revision,charge_date:'2026-10-10',actor:'test-cal'}]);
    const d=detail(c,p.observation_id),cmd={observation_id:p.observation_id,expected_revision:d.decision_revision,action,actor:'owner',reason:'verified receipt'};
    if(action==='separate')cmd.expected_candidate_fingerprints=d.candidate_fingerprints;
    else {cmd.transaction_id=a.transaction_id;cmd.expected_transaction_fingerprint=scalar(c.db,`SELECT apy_cash_fingerprint(${a.transaction_id});`);}
    const result=call(c.db,'resolve_observation',[key(),cmd]);
    assert.equal(scalar(c.db,`SELECT charge_date FROM transactions WHERE id=${result.transaction_id};`),'2026-10-10');
    assert.equal(ingest(c,'cal',payload('P')).outcome,'already_observed');
    assert.equal(totals(c.db).count,action==='link'?2:3);
  }
  const c=make();ingest(c,'apple',payload('A'));ingest(c,'apple',payload('B'));
  const p=ingest(c,'cal',payload('P',{charge_date:'2026-10-10'}));
  const manual=scalar(c.db,"INSERT INTO transactions(description,total_amount,currency,movement_type,transaction_date,charge_date,payment_source_id) VALUES('manual',24,'ILS','expense','2026-09-22','2026-09-25',1) RETURNING id;");
  const r=call(c.db,'resolve_observation',[key(),{observation_id:p.observation_id,expected_revision:p.decision_revision,action:'link',transaction_id:manual,expected_transaction_fingerprint:scalar(c.db,`SELECT apy_cash_fingerprint(${manual});`),actor:'owner',reason:'explicit enrollment'}]);
  assert.equal(r.reason_code,'enrichment_conflict');assert.equal(r.review_required,true);
  assert.equal(scalar(c.db,`SELECT charge_date FROM transactions WHERE id=${manual};`),'2026-09-25');
});

test('verified reference disagreement cannot create or overwrite cash', () => {
  const c=make();ingest(c,'apple',payload('A',{provider_reference:reference('same-purchase')}));
  const r=ingest(c,'cal',payload('B',{provider_reference:reference('same-purchase'),accounting_amount:'24.01'}));
  assert.equal(r.outcome,'conflict');assert.equal(r.reason_code,'reference_conflict');assert.equal(r.transaction_id,null);assert.equal(totals(c.db).count,1);
});

test('merchant Unicode evidence stays deterministic between service and database', () => {
  const c=make(),{normalizeMerchant}=require('../services/transactionIngestionService');
  for(const merchant of ['A\u20aa24','\u05d0\u05b8\u05e8\u05d5\u05de\u05d4','Tea\ud83c\udf75Shop','i\u0307stanbul','\u0130STANBUL','\u039f\u03a3','\u{10400}','A\u00a0B']) {
    assert.equal(scalar(c.db,`SELECT apy_merchant(${quote(merchant)});`),normalizeMerchant(merchant),merchant);
  }
});

test('captured Budget history blocks APY cancellation and provisional charge enrichment', () => {
  const c=make(),a=ingest(c,'apple',payload('A'));
  sql(c.db,`INSERT INTO budget_months(month_start) VALUES('2026-09-01');INSERT INTO budget_operations(budget_month_id,request_key,request_fingerprint,operation_type,effective_date) SELECT id,${quote(key())},'test-captured','month_close','2026-09-30' FROM budget_months;`);
  const r=call(c.db,'cancel_ingested_transaction',[key(),{transaction_id:a.transaction_id,expected_revision:a.decision_revision,expected_transaction_fingerprint:scalar(c.db,`SELECT apy_cash_fingerprint(${a.transaction_id});`),reason:'attempt after capture',actor:'owner'}]);
  assert.equal(r.reason_code,'protected_transaction');assert.equal(totals(c.db).count,1);
  const confirmed=ingest(c,'cal',payload('B',{charge_date:'2026-10-10'}));assert.equal(confirmed.reason_code,'enrichment_conflict');
  assert.equal(scalar(c.db,'SELECT charge_date FROM transactions;'),'2026-09-22');
});
