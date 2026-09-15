// Real disposable PostgreSQL. Never loads .env or production credentials.
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const container = `finance-sav06-tests-${process.pid}`;
const read = p => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const migration = read('server/migrations/034_savings_monthly_deposits.sql');
const baseline = read('server/full_schema.sql').split('-- Migration 034:')[0];
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
  sql('postgres', `CREATE DATABASE ${db} TEMPLATE sav06_baseline;`); sql(db, migration);
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
  run(['run', '-d', '--rm', '--name', container, '--label', 'finance.disposable=sav06-test', '-e', 'POSTGRES_PASSWORD=local_test_only', 'postgres:16-alpine']); created = true;
  const i = JSON.parse(run(['inspect', container]).stdout)[0];
  assert.equal(i.Config.Labels['finance.disposable'], 'sav06-test'); assert.equal(i.Config.Image, 'postgres:16-alpine'); assert.equal(Object.keys(i.HostConfig.PortBindings || {}).length, 0);
  for (let n = 0; n < 60; n++) { if (run(['exec', container, 'pg_isready', '-U', 'postgres'], undefined, true).status === 0) break; await wait(200); }
  sql('postgres', 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE DATABASE sav06_baseline;');
  sql('sav06_baseline', baseline);
  sql('sav06_baseline', 'GRANT SELECT,INSERT,DELETE ON transactions TO service_role; GRANT SELECT ON categories,payment_sources,loan_payments TO service_role; GRANT INSERT,UPDATE ON loan_payments TO service_role; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;');
});
after(() => { if (created) run(['rm', '-f', container]); });
const today = db => scalar(db,"SELECT timezone('Asia/Jerusalem',statement_timestamp())::date;");
const configure = (db,n,changes) => call(db,'update_savings_account',['1',account(db).account.revision,key(n),changes]);
const plan = (db,extra={}) => configure(db,2,{monthly_amount:'100',monthly_day:'31',plan_start_date:'2026-01-01',default_payment_source_id:'1',...extra});
const occurrence = (db,extra={}) => {const a=account(db).account;return {action:'due',account_id:'1',occurrence_month:a.next_due_date.slice(0,7)+'-01',expected_due_date:a.next_due_date,plan_revision:a.plan_revision,...extra};};
const execute = (db,n,c=occurrence(db)) => call(db,'post_savings_event',[key(n),c]);
const financial = db => json(db,"SELECT jsonb_build_object('a',(SELECT jsonb_agg(to_jsonb(x)) FROM savings_accounts x),'e',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM savings_entries x),'t',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM transactions x));");

test('oldest due only, nominal day restored after February, today cash and durable retries',()=>{
 const db=make();open(db);plan(db,{auto_deposit_enabled:true});const first=occurrence(db);const r=execute(db,3,first);
 assert.equal(cash(db,r.transaction_id).transaction_date,today(db));assert.equal(account(db).account.next_due_date,'2026-02-28');
 assert.equal(execute(db,3,first).replayed,true);assert.equal(execute(db,4,first).status,'already_claimed');
 execute(db,5);assert.equal(account(db).account.next_due_date,'2026-03-31');assert.equal(balance(db),'200.00');
 assert.equal(scalar(db,'SELECT count(*) FROM transactions;'),'2');
});
test('future, disabled, pause/archive/restore and stale requests cannot post',()=>{
 const db=make();open(db);plan(db);const c=occurrence(db);assert.notEqual(invoke(db,'post_savings_event',[key(3),c],true).status,0);
 configure(db,4,{auto_deposit_enabled:true});configure(db,5,{auto_deposit_enabled:false});assert.notEqual(invoke(db,'post_savings_event',[key(6),c],true).status,0);
 configure(db,7,{auto_deposit_enabled:true});configure(db,8,{status:'archived'});assert.equal(account(db).account.auto_deposit_enabled,false);configure(db,9,{status:'active'});assert.equal(account(db).account.auto_deposit_enabled,false);assert.equal(account(db).account.next_due_date,c.expected_due_date);
 const db2=make();open(db2);plan(db2,{plan_start_date:'2099-01-01',auto_deposit_enabled:true});const before=financial(db2);assert.notEqual(invoke(db2,'post_savings_event',[key(3),occurrence(db2)],true).status,0);assert.deepEqual(financial(db2),before);
});
test('explicit skip, overdue edit gate and skip restoration retain month identity',()=>{
 const db=make();open(db);plan(db);assert.notEqual(invoke(db,'update_savings_account',['1',account(db).account.revision,key(3),{monthly_day:'15'}],true).status,0);
 const c=occurrence(db,{action:'skip',expected_revision:account(db).account.revision,reason:'דילוג מאושר'});const s=execute(db,4,c);assert.equal(balance(db),'0.00');assert.equal(account(db).account.next_due_date,'2026-02-28');
 const payload=command(db,'deposit','100',{effective_date:today(db),charge_date:today(db),reinstate:true});delete payload.expected_revision;
 call(db,'correct_savings_event',[key(5),s.entry_id,account(db).account.revision,payload,'החזרה מפורשת']);assert.equal(balance(db),'100.00');assert.equal(execute(db,6,{...c,action:'due'}).status,'already_claimed');
});
test('manual/imported fulfillment reuses cash and already linked deposits without another balance effect',()=>{
 for(const linked of [false,true]){const db=make();open(db);plan(db);let id;
 if(linked)id=post(db,3,'deposit','100',{effective_date:today(db),charge_date:today(db)}).transaction_id;
 else id=scalar(db,`INSERT INTO transactions(description,total_amount,movement_type,transaction_date,charge_date,category_id,payment_source_id,external_id) VALUES('import',100,'expense','${today(db)}','${today(db)}',100,1,'manual-identity') RETURNING id;`);
 const t=cash(db,id);const c={...command(db,'deposit','100',{action:'link_cash',effective_date:t.transaction_date,charge_date:t.charge_date,transaction_id:String(id),expected_transaction_fingerprint:t.transaction_fingerprint}),...occurrence(db),action:'link_cash'};
 execute(db,4,c);assert.equal(balance(db),'100.00');assert.equal(scalar(db,'SELECT count(*) FROM transactions;'),'1');assert.equal(account(db).account.next_due_date,'2026-02-28');assert.equal(execute(db,4,c).replayed,true);
 }
});
test('cancellation and repeated corrections retain claim, explicit reinstatement creates new live cash',()=>{
 const db=make();open(db);plan(db,{auto_deposit_enabled:true});const c=occurrence(db),r=execute(db,3,c);correct(db,4,r.transaction_id,{amount:'150',effective_date:today(db),charge_date:today(db)});correct(db,5,r.transaction_id,{amount:'160',effective_date:today(db),charge_date:today(db)});assert.equal(balance(db),'160.00');
 cancel(db,6,r.transaction_id);assert.equal(balance(db),'0.00');assert.equal(execute(db,7,c).status,'already_claimed');const t=cash(db,r.transaction_id),payload=replacement(db,r.transaction_id,{amount:'160',effective_date:today(db),charge_date:today(db),reinstate:true});delete payload.expected_revision;
 call(db,'correct_savings_event',[key(8),t.savings.entry_id,t.savings.revision,payload,'החזרה מפורשת']);assert.equal(balance(db),'160.00');assert.equal(scalar(db,'SELECT count(*) FROM transactions WHERE voided_at IS NULL;'),'1');
});
test('two jobs and manual versus job race claim once with atomic rollback',async()=>{
 for(const manual of [false,true]){const db=make();open(db);plan(db,{auto_deposit_enabled:true});const c=occurrence(db),m={...command(db,'deposit','100',{effective_date:today(db),charge_date:today(db)}),...c,action:'create_cash'};
 const requests=[c,manual?m:c];const results=await Promise.all(requests.map((x,i)=>concurrent(db,`SET ROLE service_role; SELECT post_savings_event('${key(i+3)}',${quote(JSON.stringify(x))});`)));
 assert(results.some(r=>r.status===0),JSON.stringify(results));assert.equal(balance(db),'100.00');assert.equal(scalar(db,'SELECT count(*) FROM transactions;'),'1');assert.equal(account(db).account.next_due_date,'2026-02-28');}
});
test('inactive source fails without claim or advancement and same request succeeds after repair',()=>{
 const db=make();open(db);plan(db,{auto_deposit_enabled:true});const c=occurrence(db);sql(db,'UPDATE payment_sources SET is_active=false WHERE id=1;');const before=financial(db);assert.notEqual(invoke(db,'post_savings_event',[key(3),c],true).status,0);assert.deepEqual(financial(db),before);sql(db,'UPDATE payment_sources SET is_active=true WHERE id=1;');execute(db,3,c);assert.equal(balance(db),'100.00');
});
test('calendar leap/year boundary, future plan edit and plain manual deposits do not advance',()=>{
 const db=make();open(db);plan(db,{plan_start_date:'2023-12-01',auto_deposit_enabled:true});execute(db,3);assert.equal(account(db).account.next_due_date,'2024-01-31');execute(db,4);assert.equal(account(db).account.next_due_date,'2024-02-29');execute(db,5);assert.equal(account(db).account.next_due_date,'2024-03-31');
 const oldDue=account(db).account.next_due_date;post(db,6);assert.equal(account(db).account.next_due_date,oldDue);
 const db2=make();open(db2);plan(db2,{plan_start_date:'2099-01-20'});configure(db2,3,{monthly_day:'15'});assert.equal(account(db2).account.next_due_date,'2099-02-15');assert.equal(account(db2).account.auto_deposit_enabled,false);
});
test('explicit override, early fulfillment, account moves and historical solvency are enforced',()=>{
 const db=make();open(db);plan(db);const c={...command(db,'deposit','150',{effective_date:today(db),charge_date:today(db)}),...occurrence(db),action:'create_cash'};
 const before=financial(db);assert.notEqual(invoke(db,'post_savings_event',[key(3),c],true).status,0);assert.deepEqual(financial(db),before);
 const r=execute(db,3,{...c,plan_override:true,reason:'סכום שהתקבל בפועל'});post(db,4,'withdrawal','140',{effective_date:today(db),charge_date:today(db)});
 const old=financial(db),t=cash(db,r.transaction_id),p=replacement(db,r.transaction_id,{amount:'130',effective_date:today(db),charge_date:today(db)});delete p.expected_revision;
 assert.notEqual(invoke(db,'correct_savings_event',[key(5),t.savings.entry_id,t.savings.revision,p,'תיקון'],true).status,0);assert.deepEqual(financial(db),old);
 open(db,'0',6);const dest=account(db,'2');assert.notEqual(invoke(db,'correct_savings_event',[key(7),t.savings.entry_id,t.savings.revision,{...p,amount:'150',account_id:'2',expected_destination_revision:dest.account.revision},'העברה'],true).status,0);
});
test('pause and archive serialize with a waiting worker without stale cash',async()=>{
 for(const field of ['pause','archive']){const db=make();open(db);plan(db,{auto_deposit_enabled:true});const c=occurrence(db),change=field==='pause'?{auto_deposit_enabled:false}:{status:'archived'};
 const config=concurrent(db,`BEGIN;SET ROLE service_role;SELECT update_savings_account('1','${account(db).account.revision}','${key(3)}',${quote(JSON.stringify(change))});SELECT pg_sleep(1);COMMIT;`);await wait(200);
 const worker=concurrent(db,`SET ROLE service_role;SELECT post_savings_event('${key(4)}',${quote(JSON.stringify(c))});`);assert.equal((await config).status,0);assert.notEqual((await worker).status,0);assert.equal(balance(db),'0.00');}
});
test('034 upgrade and clean snapshot preserve all history, privileges, Loan functions and relation counts',()=>{
 sql('postgres','CREATE DATABASE upgrade_034 TEMPLATE sav06_baseline;');const db='upgrade_034';sql(db,"INSERT INTO payment_sources(id,name,slug,method) VALUES(1,'local','local','bank_transfer');");open(db,'1200');
 const pre=json(db,read('docs/MIGRATION_034_PRODUCTION_PREFLIGHT.sql'));assert.equal(pre.result,'MIGRATION_034_PREFLIGHT_PASS',JSON.stringify(pre));const before=financial(db);sql(db,migration);
 const after=json(db,read('docs/MIGRATION_034_PRODUCTION_POSTFLIGHT.sql'));assert.equal(after.result,'MIGRATION_034_POSTFLIGHT_PASS',JSON.stringify(after));assert.deepEqual(after.evidence,pre.evidence);assert.deepEqual(financial(db),before);assert.equal(after.evidence.public_tables,28);assert.equal(after.evidence.public_views,10);
 sql('postgres','CREATE DATABASE clean_034;');sql('clean_034',read('server/full_schema.sql'));
 const defs="SELECT jsonb_object_agg(proname,md5(prosrc)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('savings_post_event_locked','savings_validate_account','savings_assert_links','update_savings_account','get_savings_account');";
 assert.deepEqual(json(db,defs),json('clean_034',defs));assert.equal(scalar('clean_034','SELECT count(*) FROM savings_accounts;'),'0');
 for(const role of ['anon','authenticated'])assert.notEqual(sql(db,`SET ROLE ${role};SELECT post_savings_event('${key(7)}','{}');`,true).status,0);
 assert.notEqual(sql(db,`SET ROLE service_role;SELECT savings_post_event_locked('${key(7)}','{}');`,true).status,0);
});
test('cancelled skip restores once and detached scheduled cash is reused explicitly',()=>{
 const db=make();open(db);plan(db);const skipped=execute(db,3,occurrence(db,{action:'skip',expected_revision:account(db).account.revision,reason:'דילוג'}));
 call(db,'cancel_savings_event',[key(4),skipped.entry_id,account(db).account.revision,'none','ביטול דילוג']);
 const c=command(db,'deposit','100',{reinstate:true,effective_date:today(db),charge_date:today(db)});delete c.expected_revision;
 const r=call(db,'correct_savings_event',[key(5),skipped.entry_id,account(db).account.revision,c,'החזרה']);assert.equal(balance(db),'100.00');
 correct(db,6,r.transaction_id,{action:'detach',category_id:'100',effective_date:today(db),charge_date:today(db)});assert.equal(balance(db),'0.00');const t=cash(db,r.transaction_id),p=replacement(db,r.transaction_id,{action:'link_cash',reinstate:true,effective_date:today(db),charge_date:today(db)});delete p.expected_revision;
 call(db,'correct_savings_event',[key(7),t.savings.entry_id,t.savings.revision,p,'החזרה של אותו כסף']);assert.equal(balance(db),'100.00');assert.equal(scalar(db,'SELECT count(*) FROM transactions;'),'1');assert.equal(scalar(db,"SELECT count(*) FROM savings_entries WHERE occurrence_month='2026-01-01' AND occurrence_root_id IS NULL AND entry_action='post';"),'1');
});
