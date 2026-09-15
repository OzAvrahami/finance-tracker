// Real disposable PostgreSQL. Never loads .env or production credentials.
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const container = `finance-sav04-tests-${process.pid}`;
const read = p => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const migration = read('server/migrations/032_savings_realized_interest.sql');
const baseline = read('server/full_schema.sql').split('-- Migration 032:')[0];
let created = false; let sequence = 0;
const run = (args, input, allow = false) => {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 20e6, timeout: 60000 });
  if (!allow) assert.equal(r.status, 0, r.stderr || r.error?.message);
  return r;
};
const sql = (db, input, allow = false) => run(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq'], input, allow);
const scalar = (db, input) => sql(db, input).stdout.trim();
const json = (db, input) => JSON.parse(scalar(db, input));
const quote = x => `'${String(x).replaceAll("'", "''")}'`;
const key = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const invoke = (db, fn, args, allow = false) => sql(db, `SET ROLE service_role; SELECT ${fn}(${args.map(a => a === null ? 'NULL' : quote(typeof a === 'object' ? JSON.stringify(a) : a)).join(',')});`, allow);
const call = (db, fn, args) => JSON.parse(invoke(db, fn, args).stdout.trim());
const make = () => {
  const db = `case_${++sequence}`;
  sql('postgres', `CREATE DATABASE ${db} TEMPLATE sav04_baseline;`); sql(db, migration);
  sql(db, "INSERT INTO categories(id,name,type) VALUES(100,'ordinary','expense'),(101,'income','income'); INSERT INTO payment_sources(id,name,slug,method) VALUES(1,'local','local','bank_transfer'); INSERT INTO loans(id,name,original_amount,current_balance,total_installments,remaining_installments,calculation_mode) VALUES(1,'local loan',1000,1000,10,10,'loan_payments');");
  return db;
};
const open = (db, amount = '0', n = 1) => call(db, 'create_savings_account', [key(n), { name: 'בדיקה מקומית', opened_on: '2020-01-01', tracking_start_date: '2020-01-01' }, amount, '0', null]);
const account = (db, id = '1') => call(db, 'get_savings_account', [id]);
const balance = db => account(db).summary.current_balance;
const cash = (db, id) => json(db, `SET ROLE service_role; SELECT row_json FROM transactions_filtered(p_transaction_id=>${id});`);
const command = (db, kind = 'deposit', amount = '100', extra = {}) => ({
  action: 'create_cash', account_id: '1', expected_revision: account(db).account.revision,
  event_kind: kind, amount, effective_date: '2020-01-02', charge_date: '2020-01-02',
  description: 'תנועת בדיקה', category_id: scalar(db, `SELECT id::text FROM categories WHERE savings_role=${quote(kind)};`), payment_source_id: '1', ...extra,
});
const post = (db, n, kind = 'deposit', amount = '100', extra = {}) => call(db, 'post_savings_event', [key(n), command(db, kind, amount, extra)]);
const replacement = (db, id, extra = {}) => {
  const t = cash(db, id);
  return command(db, t.savings.event_kind, t.total_amount, { transaction_id: String(id), expected_transaction_fingerprint: t.transaction_fingerprint, ...extra });
};
const correct = (db, n, id, extra = {}) => { const t = cash(db, id); return call(db, 'correct_savings_event', [key(n), t.savings.entry_id, t.savings.revision, replacement(db, id, extra), 'תיקון בדיקה']); };
const cancel = (db, n, id) => { const t = cash(db, id); return call(db, 'cancel_savings_event', [key(n), t.savings.entry_id, t.savings.revision, 'void', 'ביטול בדיקה']); };
const concurrent = (db, input) => new Promise(resolve => {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq']);
  let out = '', err = ''; child.stdout.on('data', x => { out += x; }); child.stderr.on('data', x => { err += x; }); child.on('close', status => resolve({ status, out, err })); child.stdin.end(input);
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
before(async () => {
  run(['run', '-d', '--rm', '--name', container, '--label', 'finance.disposable=sav04-test', '-e', 'POSTGRES_PASSWORD=local_test_only', 'postgres:16-alpine']); created = true;
  const i = JSON.parse(run(['inspect', container]).stdout)[0];
  assert.equal(i.Config.Labels['finance.disposable'], 'sav04-test'); assert.equal(i.Config.Image, 'postgres:16-alpine'); assert.equal(Object.keys(i.HostConfig.PortBindings || {}).length, 0);
  for (let n = 0; n < 60; n++) { if (run(['exec', container, 'pg_isready', '-U', 'postgres'], undefined, true).status === 0) break; await wait(200); }
  sql('postgres', 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE DATABASE sav04_baseline;');
  sql('sav04_baseline', baseline);
  sql('sav04_baseline', 'GRANT SELECT,INSERT,DELETE ON transactions TO service_role; GRANT SELECT ON categories,payment_sources,loan_payments TO service_role; GRANT INSERT,UPDATE ON loan_payments TO service_role; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;');
});
after(() => { if (created) run(['rm', '-f', container]); });

const interest = (db, kind = 'interest_capitalized', amount = '40', extra = {}) => {
  const c = command(db, kind, amount, extra);
  if (kind === 'interest_capitalized') { c.action = 'noncash'; delete c.category_id; delete c.payment_source_id; delete c.charge_date; }
  return c;
};
const earn = (db, n, kind, amount, extra) => call(db, 'post_savings_event', [key(n), interest(db, kind, amount, extra)]);
const entry = (db, id) => json(db, `SELECT to_jsonb(e)||jsonb_build_object('id',id::text,'amount',amount::text) FROM savings_entries e WHERE id=${id};`);
const correctionArgs = (db, n, id, kind, amount='40', extra={}) => {
  const e=entry(db,id), c=interest(db,kind,amount,extra);
  if(e.transaction_id) { c.transaction_id=String(e.transaction_id); c.expected_transaction_fingerprint=cash(db,e.transaction_id).transaction_fingerprint; }
  return [key(n),String(id),account(db,String(e.account_id)).account.revision,c,'תיקון ריבית מקומי'];
};
const revise = (db,n,id,kind,amount,extra) => call(db,'correct_savings_event',correctionArgs(db,n,id,kind,amount,extra));
const cancelEntry = (db,n,id,allow=false) => { const e=entry(db,id); return invoke(db,'cancel_savings_event',[key(n),String(id),account(db,String(e.account_id)).account.revision,e.transaction_id?'void':'none','ביטול בדיקה'],allow); };
const latest = result => result.entry_ids.at(-1);
const financial = db => json(db,"SELECT jsonb_build_object('accounts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM savings_accounts a),'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM savings_entries e),'cash',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM transactions t));");

test('032 upgrade preserves all rows, object counts, Loan definitions/grants; clean snapshot agrees',()=>{
  const db='upgrade_031';sql('postgres',`CREATE DATABASE ${db} TEMPLATE sav04_baseline;`);
  sql(db,"INSERT INTO payment_sources(id,name,slug,method) VALUES(1,'local','local','bank_transfer');");
  open(db,'10000'); post(db,2,'deposit','500');
  const pre=json(db,read('docs/MIGRATION_032_PRODUCTION_PREFLIGHT.sql')); assert.equal(pre.result,'MIGRATION_032_PREFLIGHT_PASS',JSON.stringify(pre.checks));
  const before=financial(db); sql(db,migration); assert.deepEqual(financial(db),before);
  const after=json(db,read('docs/MIGRATION_032_PRODUCTION_POSTFLIGHT.sql'));assert.equal(after.result,'MIGRATION_032_POSTFLIGHT_PASS',JSON.stringify(after.checks));assert.deepEqual(after.evidence,pre.evidence);
  const objects="SELECT jsonb_object_agg(relkind,n) FROM (SELECT relkind,count(*) n FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','v') GROUP BY relkind) x;";
  assert.equal(scalar(db,objects),scalar('sav04_baseline',objects));
  const loans="SELECT jsonb_agg(jsonb_build_object('definition',pg_get_functiondef(oid),'acl',proacl) ORDER BY oid::regprocedure::text) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE '%loan%';";
  assert.equal(scalar(db,loans),scalar('sav04_baseline',loans));
  sql('postgres','CREATE DATABASE sav04_clean;'); sql('sav04_clean',read('server/full_schema.sql'));
  for(const fn of ['savings_post_event_locked(uuid,jsonb)','get_savings_account(bigint,date,date,bigint,integer)']) assert.equal(scalar(db,`SELECT pg_get_functiondef('${fn}'::regprocedure);`),scalar('sav04_clean',`SELECT pg_get_functiondef('${fn}'::regprocedure);`));
  assert.equal(scalar('sav04_clean','SELECT count(*) FROM savings_accounts;'),'0');
});
test('exact numerical contract separates deposits, held Savings, both earnings destinations and withdrawal',()=>{
  const db=make(); open(db,'10000'); post(db,2,'deposit','500'); earn(db,3,'interest_capitalized','40');
  let s=account(db).summary; assert.equal(s.current_balance,'10540.00');assert.equal(s.deposits_total,'500.00');assert.equal(s.realized_interest_total,'40.00');
  const payout=earn(db,4,'interest_payout','40');s=account(db).summary;assert.equal(s.current_balance,'10540.00');assert.equal(s.realized_interest_total,'80.00');assert.equal(cash(db,payout.transaction_id).total_amount,'40.00');
  post(db,5,'withdrawal','40');s=account(db).summary;assert.equal(s.current_balance,'10500.00');assert.equal(s.realized_interest_total,'80.00');assert.equal(s.withdrawals_total,'40.00');
  assert.equal(scalar(db,"SELECT count(*) FROM transactions WHERE movement_type='income' AND category_id=(SELECT id FROM categories WHERE savings_role='interest_payout');"),'1');
});
test('explicit existing income linkage preserves cash identity and rejects duplicate/implicit earnings',()=>{
  const db=make();open(db);sql(db,"INSERT INTO transactions(description,total_amount,movement_type,transaction_date,charge_date,category_id,payment_source_id,external_id) VALUES('imported',40,'income','2020-01-02','2020-01-03',101,1,'interest-import');");
  assert.equal(account(db).summary.realized_interest_total,'0.00');
  const c=interest(db,'interest_payout','40',{action:'link_cash',transaction_id:'1',expected_transaction_fingerprint:cash(db,1).transaction_fingerprint,charge_date:'2020-01-03'});
  call(db,'post_savings_event',[key(2),c]);assert.equal(scalar(db,'SELECT count(*) FROM transactions;'),'1');assert.equal(account(db).summary.realized_interest_total,'40.00');
  assert.equal(call(db,'post_savings_event',[key(2),c]).replayed,true);
  assert.notEqual(invoke(db,'post_savings_event',[key(3),{...c,expected_revision:account(db).account.revision}],true).status,0);
});
for(const from of ['interest_capitalized','interest_payout'])for(const to of ['interest_capitalized','interest_payout'])test(`atomic correction ${from} -> ${to} preserves exactly one earning and correct cash`,()=>{
  const db=make();open(db,'100');const original=earn(db,2,from,'40');const args=correctionArgs(db,3,latest(original),to,'40');
  const corrected=call(db,'correct_savings_event',args), s=account(db).summary;
  assert.equal(s.realized_interest_total,'40.00');assert.equal(s.current_balance,to==='interest_capitalized'?'140.00':'100.00');
  assert.equal(scalar(db,"SELECT count(*) FROM transactions WHERE voided_at IS NULL;"),to==='interest_payout'?'1':'0');
  if(from==='interest_payout'&&to==='interest_payout')assert.equal(corrected.transaction_id,original.transaction_id);
  if(from==='interest_payout'&&to==='interest_capitalized'){assert.ok(cash(db,original.transaction_id).voided_at);assert.deepEqual(corrected.affected_transaction_ids,[original.transaction_id]);}
  assert.equal(call(db,'correct_savings_event',args).replayed,true);
  const changed=revise(db,4,latest(corrected),to,'50');assert.equal(account(db).summary.realized_interest_total,'50.00');
  cancelEntry(db,5,latest(changed));assert.equal(balance(db),'100.00');assert.equal(account(db).summary.realized_interest_total,'0.00');
  assert.equal(scalar(db,'SELECT count(*) FROM transactions WHERE voided_at IS NULL;'),'0');
});
test('stable same-day repeated correction and consumed capitalization enforce prefixes and complete rollback',()=>{
  const db=make();open(db);const first=earn(db,2,'interest_capitalized','100');post(db,3,'withdrawal','80');
  const second=revise(db,4,latest(first),'interest_capitalized','150');assert.equal(balance(db),'70.00');
  const third=revise(db,5,latest(second),'interest_capitalized','160');assert.equal(balance(db),'80.00');
  for(const [kind,amount] of [['interest_capitalized','70'],['interest_payout','160']]) {const before=financial(db);assert.notEqual(invoke(db,'correct_savings_event',correctionArgs(db,6,latest(third),kind,amount),true).status,0);assert.deepEqual(financial(db),before);}
  const before=financial(db);assert.notEqual(cancelEntry(db,7,latest(third),true).status,0);assert.deepEqual(financial(db),before);
});
test('cutoff/exact amount/archived references and unsupported direction conversions reject atomically',()=>{
  const db=make();open(db,'100');
  for(const extra of [{amount:'1.001'},{amount:40},{amount:'NaN'},{effective_date:'2019-12-31'},{effective_date:'2020-01-01'},{effective_date:'2099-01-01'},{effective_date:'2020-02-30'}])assert.notEqual(invoke(db,'post_savings_event',[key(2),interest(db,'interest_capitalized','40',extra)],true).status,0);
  earn(db,3,'interest_capitalized','0.01',{effective_date:'2020-01-01',cutoff_confirmed:true});
  const deposit=post(db,4,'deposit','10');assert.notEqual(invoke(db,'correct_savings_event',correctionArgs(db,5,latest(deposit),'interest_payout','10'),true).status,0);
  assert.notEqual(invoke(db,'post_savings_event',[key(6),{...command(db,'deposit','10'),action:'noncash'}],true).status,0);
  sql(db,"UPDATE payment_sources SET is_active=false WHERE id=1;");assert.notEqual(invoke(db,'post_savings_event',[key(6),interest(db,'interest_payout','40')],true).status,0);
  call(db,'update_savings_account',['1',account(db).account.revision,key(7),{status:'archived'}]);assert.notEqual(invoke(db,'post_savings_event',[key(8),interest(db,'interest_capitalized','40')],true).status,0);
});
test('interest account/date corrections reconcile both accounts; cancelled reinstatement never unvoids',()=>{
  const db=make();open(db,'100');open(db,'0',2);let r=earn(db,3,'interest_capitalized','40');
  r=revise(db,4,latest(r),'interest_capitalized','50',{account_id:'2',expected_destination_revision:account(db,'2').account.revision,effective_date:'2020-01-03'});
  assert.equal(balance(db),'100.00');assert.equal(account(db,'2').summary.current_balance,'50.00');cancelEntry(db,5,latest(r));
  r=revise(db,6,latest(r),'interest_capitalized','50',{account_id:'2',reinstate:true});assert.equal(account(db,'2').summary.realized_interest_total,'50.00');
  const payout=earn(db,7,'interest_payout','40');cancelEntry(db,8,latest(payout));const restored=revise(db,9,latest(payout),'interest_payout','40',{reinstate:true});
  assert.notEqual(restored.transaction_id,payout.transaction_id);assert.ok(cash(db,payout.transaction_id).voided_at);assert.equal(scalar(db,'SELECT count(*) FROM transactions WHERE voided_at IS NULL;'),'1');
});
test('payout detach then dedicated void changes no second earning; live detached cash requires explicit reuse',()=>{
  const db=make();open(db);const r=earn(db,2,'interest_payout','40');correct(db,3,r.transaction_id,{action:'detach',category_id:'101'});
  assert.equal(account(db).summary.realized_interest_total,'0.00');const count=scalar(db,'SELECT count(*) FROM savings_entries;'), rev=account(db).account.revision;
  const t=cash(db,r.transaction_id),args=[key(4),r.transaction_id,t.transaction_fingerprint,'ביטול הכנסה מנותקת'];call(db,'void_detached_savings_transaction',args);assert.equal(call(db,'void_detached_savings_transaction',args).replayed,true);
  assert.equal(scalar(db,'SELECT count(*) FROM savings_entries;'),count);assert.equal(account(db).account.revision,rev);assert.equal(scalar(db,"SET ROLE service_role; SELECT count(*) FROM transactions_filtered();"),'0');
  const again=earn(db,5,'interest_payout','20');correct(db,6,again.transaction_id,{action:'detach',category_id:'101'});
  assert.notEqual(invoke(db,'correct_savings_event',correctionArgs(db,7,latest(again),'interest_payout','20',{reinstate:true}),true).status,0);
  revise(db,8,latest(again),'interest_payout','20',{reinstate:true,action:'link_cash'});assert.equal(account(db).summary.realized_interest_total,'20.00');
});
test('service commands retain narrow privileges and Budget reads; direct role/void and Loan linking cannot bypass interest boundary',()=>{
  const db=make();open(db);const r=earn(db,2,'interest_payout','40');
  assert.equal(scalar(db,"SELECT has_function_privilege('service_role','post_savings_event(uuid,jsonb)','EXECUTE'),has_function_privilege('authenticated','post_savings_event(uuid,jsonb)','EXECUTE'),has_function_privilege('service_role','savings_post_event_locked(uuid,jsonb)','EXECUTE');"),'t|f|f');
  assert.notEqual(sql(db,"SET ROLE service_role; UPDATE transactions SET voided_at=now();",true).status,0);
  assert.notEqual(sql(db,"SET ROLE service_role; INSERT INTO savings_entries(account_id) VALUES(1);",true).status,0);
  scalar(db,'SET ROLE service_role; SELECT count(*) FROM budget_category_composition; SELECT count(*) FROM budget_month_category_actuals;');
  assert.notEqual(sql(db,`SET ROLE service_role; INSERT INTO loan_payments(loan_id,transaction_id,payment_date,principal_amount,interest_amount) VALUES(1,${r.transaction_id},'2020-01-02',30,10);`,true).status,0);
});
test('concurrent capitalization cancellation versus withdrawal serializes; duplicate payout retries create one cash',async()=>{
  const db=make();open(db);const r=earn(db,2,'interest_capitalized','100'),rev=account(db).account.revision;
  const first=concurrent(db,`BEGIN; SET ROLE service_role; SELECT cancel_savings_event('${key(3)}','${latest(r)}','${rev}','none','cancel race'); SELECT pg_sleep(0.3); COMMIT;`);
  await wait(100);const withdrawal=interest(db,'withdrawal','80',{expected_revision:rev});
  const second=concurrent(db,`SET ROLE service_role; SELECT post_savings_event('${key(4)}','${JSON.stringify(withdrawal)}');`);
  const results=await Promise.all([first,second]);assert.equal(results.filter(x=>x.status===0).length,1);assert.equal(balance(db),'0.00');
  const c=interest(db,'interest_payout','40'),query=`SET ROLE service_role; SELECT post_savings_event('${key(5)}','${JSON.stringify(c)}');`;
  const retries=await Promise.all([concurrent(db,query),concurrent(db,query)]);assert.ok(retries.every(x=>x.status===0),JSON.stringify(retries));assert.equal(scalar(db,'SELECT count(*) FROM transactions;'),'1');assert.equal(account(db).summary.realized_interest_total,'40.00');
});

test('captured Budget months permit noncash corrections but reject cash conversion with complete rollback',()=>{
  const db=make();open(db,'100');
  const month=scalar(db,"SELECT to_char(date_trunc('month',timezone('Asia/Jerusalem',now()))-interval '1 month','YYYY-MM');");
  let cap=earn(db,2,'interest_capitalized','40',{effective_date:month+'-01'});
  const payout=earn(db,3,'interest_payout','40',{effective_date:month+'-01',charge_date:month+'-01'});
  call(db,'add_manual_budget_funding',[month,'100','test',key(20)]);call(db,'establish_funded_budget',[month,'100','100','manual',key(21)]);
  call(db,'set_budget_unused_balance_policy',['100','return_to_unallocated']);
  const preview=call(db,'get_budget_month_disposition_preview',[month]);call(db,'apply_budget_month_disposition',[month,key(22),preview.fingerprint]);
  cap=revise(db,4,latest(cap),'interest_capitalized','50',{effective_date:month+'-01'});assert.equal(balance(db),'150.00');
  for(const [id,kind] of [[latest(cap),'interest_payout'],[latest(payout),'interest_capitalized']]){const before=financial(db);assert.notEqual(invoke(db,'correct_savings_event',correctionArgs(db,5,id,kind,'40',{effective_date:month+'-01'}),true).status,0);assert.deepEqual(financial(db),before);}
});

test('realized earnings range is exact even when payouts leave held balance zero',()=>{
  const db=make();open(db);earn(db,2,'interest_payout','9999999999999999.99');
  assert.equal(balance(db),'0.00');assert.equal(account(db).summary.realized_interest_total,'9999999999999999.99');
  for(const kind of ['interest_payout','interest_capitalized']){const before=financial(db);assert.notEqual(invoke(db,'post_savings_event',[key(3),interest(db,kind,'0.01')],true).status,0);assert.deepEqual(financial(db),before);}
});
