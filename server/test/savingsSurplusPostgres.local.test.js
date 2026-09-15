// Real disposable PostgreSQL. Never loads .env or production credentials.
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const container = `finance-sav05-tests-${process.pid}`;
const read = p => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const migration = read('server/migrations/033_savings_funded_surplus.sql');
const baseline = read('server/full_schema.sql').split('-- Migration 033:')[0];
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
  sql('postgres', `CREATE DATABASE ${db} TEMPLATE sav05_baseline;`); sql(db, migration);
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
  run(['run', '-d', '--rm', '--name', container, '--label', 'finance.disposable=sav05-test', '-e', 'POSTGRES_PASSWORD=local_test_only', 'postgres:16-alpine']); created = true;
  const i = JSON.parse(run(['inspect', container]).stdout)[0];
  assert.equal(i.Config.Labels['finance.disposable'], 'sav05-test'); assert.equal(i.Config.Image, 'postgres:16-alpine'); assert.equal(Object.keys(i.HostConfig.PortBindings || {}).length, 0);
  for (let n = 0; n < 60; n++) { if (run(['exec', container, 'pg_isready', '-U', 'postgres'], undefined, true).status === 0) break; await wait(200); }
  sql('postgres', 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE DATABASE sav05_baseline;');
  sql('sav05_baseline', baseline);
  sql('sav05_baseline', 'GRANT SELECT,INSERT,DELETE ON transactions TO service_role; GRANT SELECT ON categories,payment_sources,loan_payments TO service_role; GRANT INSERT,UPDATE ON loan_payments TO service_role; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;');
});
after(() => { if (created) run(['rm', '-f', container]); });

const month = db => scalar(db,"SELECT to_char(timezone('Asia/Jerusalem',statement_timestamp()),'YYYY-MM');");
const previous = db => scalar(db,"SELECT to_char(timezone('Asia/Jerusalem',statement_timestamp())-interval '1 month','YYYY-MM');");
const today = db => scalar(db,"SELECT timezone('Asia/Jerusalem',statement_timestamp())::date;");
const seed = (db, m=month(db), spending='700', amount='1000', category=100, n=10) => {
  call(db,'add_manual_budget_funding',[m,amount,'isolated funds',key(n)]);
  call(db,'establish_funded_budget',[m,String(category),amount,'manual',key(n+1)]);
  sql(db,`INSERT INTO transactions(description,total_amount,movement_type,transaction_date,charge_date,category_id,payment_source_id) VALUES('ordinary',${spending},'expense','${m}-02','${m}-02',${category},1);`);
};
const transferCommand = (db,extra={}) => ({source_month:month(db),category_id:'100',account_id:'1',amount:'300',payment_source_id:'1',cash_date:today(db),...extra});
const preview = (db,c=transferCommand(db)) => call(db,'get_savings_surplus_preview',[c.source_month,c.category_id,c.account_id,c.amount,c.payment_source_id,c.cash_date]);
const apply = (db,n=20,c=transferCommand(db),p=preview(db,c),allow=false) => invoke(db,'apply_savings_surplus',[key(n),p.fingerprint,c],allow);
const state = (db,m=month(db)) => call(db,'get_funded_budget_month',[m]);
const financial = db => json(db,"SELECT jsonb_build_object('accounts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM savings_accounts a),'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM savings_entries e),'cash',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM transactions t),'operations',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM budget_operations o),'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM budget_operation_items i),'reserve',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM budget_savings_entries r));");
const reverseArgs = (db,n=21) => {const h=state(db).savings_transfer_history[0];return [key(n),h.operation_id,h.fingerprint,'isolated reversal'];};

test('same-month exact reconciliation, cash authority and whole-operation reversal',()=>{
  const db=make();open(db);seed(db);const result=JSON.parse(apply(db).stdout);
  let s=state(db);assert.deepEqual(s.cash_bridge,{envelope_actuals:'700.00',cash_expenses:'1000.00',funded_savings_transfers:'300.00',manual_savings_deposits:'0.00'});
  assert.equal(s.funding.available,'700.00');assert.equal(s.funding.total_allocated,'700.00');assert.equal(balance(db),'300.00');
  assert.equal(cash(db,result.transaction_id).savings.source_kind,'budget_surplus');
  const args=reverseArgs(db);call(db,'reverse_savings_surplus',args);assert.equal(call(db,'reverse_savings_surplus',args).replayed,true);
  s=state(db);assert.equal(s.funding.available,'1000.00');assert.equal(s.funding.total_allocated,'1000.00');assert.equal(s.cash_bridge.cash_expenses,'700.00');assert.equal(balance(db),'0.00');
});
test('cross-month source funding changes while cash month funding is untouched',()=>{
  const db=make();open(db);seed(db,previous(db));const c=transferCommand(db,{source_month:previous(db)});apply(db,20,c);
  assert.equal(state(db,previous(db)).funding.available,'700.00');assert.equal(state(db).funding.available,'0.00');assert.equal(state(db).cash_bridge.cash_expenses,'300.00');assert.equal(state(db).cash_bridge.envelope_actuals,'0.00');assert.equal(balance(db),'300.00');
});
test('idempotent retries and duplicate/overcapacity rejection preserve all effects',()=>{
  const db=make();open(db);seed(db);const c=transferCommand(db),p=preview(db,c);apply(db,20,c,p);const before=financial(db);
  assert.equal(JSON.parse(apply(db,20,c,p).stdout).replayed,true);assert.deepEqual(financial(db),before);
  assert.notEqual(apply(db,21,c,p,true).status,0);assert.notEqual(apply(db,20,{...c,amount:'299'},p,true).status,0);assert.deepEqual(financial(db),before);
});
test('preview invalidates after spending, funding, account and policy changes',()=>{
  for(const change of ['spending','funding','account','policy']){
    const db=make();open(db);seed(db);const c=transferCommand(db),p=preview(db,c);
    if(change==='spending')sql(db,'UPDATE transactions SET total_amount=701 WHERE id=1;');
    if(change==='funding')call(db,'add_manual_budget_funding',[month(db),'1','changed',key(12)]);
    if(change==='account')call(db,'update_savings_account',['1',account(db).account.revision,key(12),{name:'changed'}]);
    if(change==='policy')call(db,'set_budget_unused_balance_policy',['100','savings_account','1']);
    const before=financial(db);assert.notEqual(apply(db,20,c,p,true).status,0,change);assert.deepEqual(financial(db),before);
  }
});
test('invalid destination, cutoff, amounts and close blockers roll back',()=>{
  const db=make();open(db);seed(db);for(const extra of [{account_id:'999'},{amount:'300.001'},{amount:'301'},{amount:'NaN'},{cash_date:'2099-01-01'},{payment_source_id:'999'}])assert.notEqual(invoke(db,'get_savings_surplus_preview',Object.values(transferCommand(db,extra)),true).status,0);
  call(db,'update_savings_account',['1',account(db).account.revision,key(12),{status:'archived'}]);assert.notEqual(invoke(db,'get_savings_surplus_preview',Object.values(transferCommand(db)),true).status,0);
  call(db,'update_savings_account',['1',account(db).account.revision,key(13),{status:'active'}]);
  sql(db,`INSERT INTO categories(id,name,type) VALUES(102,'unbudgeted','expense');INSERT INTO transactions(description,total_amount,movement_type,transaction_date,charge_date,category_id,payment_source_id) VALUES('blocker',1,'expense',current_date,current_date,102,1);`);
  assert.notEqual(invoke(db,'get_savings_surplus_preview',Object.values(transferCommand(db)),true).status,0);
});
test('parallel requests consume surplus once; waiting spending change stales preview',async()=>{
  const db=make();open(db);seed(db);const c=transferCommand(db),p=preview(db,c),body=quote(JSON.stringify(c));
  const results=await Promise.all([20,21].map(n=>concurrent(db,`SET ROLE service_role;SELECT apply_savings_surplus('${key(n)}','${p.fingerprint}',${body});`)));
  assert.equal(results.filter(r=>r.status===0).length,1,JSON.stringify(results));assert.equal(balance(db),'300.00');
  const db2=make();open(db2);seed(db2);const c2=transferCommand(db2),p2=preview(db2,c2);
  const writer=concurrent(db2,'BEGIN;UPDATE transactions SET total_amount=701 WHERE id=1;SELECT pg_sleep(1);COMMIT;');await wait(250);
  const consumer=concurrent(db2,`SET ROLE service_role;SELECT apply_savings_surplus('${key(20)}','${p2.fingerprint}',${quote(JSON.stringify(c2))});`);
  assert.equal((await writer).status,0);assert.notEqual((await consumer).status,0);assert.equal(balance(db2),'0.00');
});
test('consumed Savings prevents reversal; generic edit/detach/cancel paths cannot orphan provenance',()=>{
  const db=make();open(db);seed(db);const result=JSON.parse(apply(db).stdout),id=result.transaction_id;
  const args=reverseArgs(db);post(db,30,'withdrawal','300',{effective_date:today(db),charge_date:today(db)});
  const before=financial(db);assert.notEqual(invoke(db,'reverse_savings_surplus',args,true).status,0);assert.deepEqual(financial(db),before);
  const t=cash(db,id);assert.notEqual(invoke(db,'cancel_savings_event',[key(31),t.savings.entry_id,t.savings.revision,'void','not allowed'],true).status,0);
  assert.notEqual(sql(db,`SET ROLE service_role;UPDATE transactions SET description='changed' WHERE id=${id};`,true).status,0);
  assert.notEqual(invoke(db,'reverse_funded_budget_operation',[result.operation_id,key(32),'not allowed'],true).status,0);assert.deepEqual(financial(db),before);
});
test('manual deposits remain envelope actuals; generated deposits cannot become surplus sources',()=>{
  const db=make();open(db);seed(db);apply(db);post(db,30,'deposit','10',{effective_date:today(db),charge_date:today(db)});
  const s=state(db);assert.equal(s.cash_bridge.envelope_actuals,'710.00');assert.equal(s.cash_bridge.cash_expenses,'1010.00');assert.equal(s.cash_bridge.manual_savings_deposits,'10.00');
  const id=scalar(db,"SELECT id FROM categories WHERE savings_role='deposit';");assert.notEqual(invoke(db,'set_budget_unused_balance_policy',[id,'savings_account','1'],true).status,0);
});
test('month close requires every cash confirmation, posts all destinations atomically and protects closed history',()=>{
  const db=make();open(db);seed(db,previous(db));call(db,'set_budget_unused_balance_policy',['100','savings_account','1']);
  const p=call(db,'get_budget_month_disposition_preview',[previous(db)]),c=transferCommand(db,{source_month:previous(db)}),cp=preview(db,c);
  assert.notEqual(invoke(db,'apply_budget_month_disposition',[previous(db),key(20),p.fingerprint,null],true).status,0);
  const confirmations=[{category_id:c.category_id,account_id:c.account_id,amount:cp.amount,payment_source_id:c.payment_source_id,cash_date:c.cash_date,preview_fingerprint:cp.fingerprint}];
  const result=call(db,'apply_budget_month_disposition',[previous(db),key(20),p.fingerprint,null,confirmations]);assert.equal(balance(db),'300.00');assert.equal(state(db).funding.available,'0.00');
  assert.equal(call(db,'apply_budget_month_disposition',[previous(db),key(20),p.fingerprint,null,confirmations]).batch_id,result.batch_id);
  assert.notEqual(invoke(db,'reverse_budget_month_disposition',[String(result.batch_id),key(21),'not allowed'],true).status,0);
});

test('upgrade from 032 preserves reserve retirement, every financial row and object boundary; clean snapshot matches',()=>{
 const db='upgrade_032';sql('postgres',`CREATE DATABASE ${db} TEMPLATE sav05_baseline;`);
 sql(db,"INSERT INTO categories(id,name,type) VALUES(100,'ordinary','expense');INSERT INTO payment_sources(id,name,slug,method) VALUES(1,'local','local','bank_transfer');");
 seed(db,previous(db),'0','500');call(db,'set_budget_unused_balance_policy',['100','savings']);
 const p=call(db,'get_budget_month_disposition_preview',[previous(db)]);call(db,'apply_budget_month_disposition',[previous(db),key(12),p.fingerprint,null]);
 call(db,'create_savings_account',[key(1),{name:'confirmed opening',opened_on:'2020-01-01',tracking_start_date:'2020-01-01'},'1200','300','confirmed overlap']);
 assert.equal(balance(db),'1200.00');assert.equal(scalar(db,'SELECT balance_text FROM budget_savings_state;'),'200.00');
 const before=financial(db),pre=json(db,read('docs/MIGRATION_033_PRODUCTION_PREFLIGHT.sql'));assert.equal(pre.result,'MIGRATION_033_PREFLIGHT_PASS',JSON.stringify(pre.checks));
 sql(db,migration);assert.deepEqual(financial(db),before);
 const after=json(db,read('docs/MIGRATION_033_PRODUCTION_POSTFLIGHT.sql'));assert.equal(after.result,'MIGRATION_033_POSTFLIGHT_PASS',JSON.stringify(after.checks));assert.deepEqual(after.evidence,pre.evidence);
 assert.equal(scalar(db,"SELECT count(*) FROM budget_savings_entries WHERE entry_kind='account_opening_retirement';"),'1');assert.equal(scalar(db,'SELECT count(*) FROM transactions;'),'1'); // only the isolated zero-spend fixture, never fabricated cash
 sql('postgres','CREATE DATABASE sav05_clean;');sql('sav05_clean',read('server/full_schema.sql'));
 for(const name of ['apply_savings_surplus(uuid,text,jsonb)','reverse_savings_surplus(uuid,bigint,text,text)','apply_budget_month_disposition(text,uuid,text,text,jsonb)','budget_actual_transactions(date,date)'])assert.equal(scalar(db,`SELECT pg_get_functiondef('${name}'::regprocedure);`),scalar('sav05_clean',`SELECT pg_get_functiondef('${name}'::regprocedure);`));
 assert.equal(scalar('sav05_clean','SELECT count(*) FROM savings_accounts;'),'0');
 for(const role of ['anon','authenticated','service_role'])assert.equal(scalar(db,`SELECT has_function_privilege('${role}','savings_apply_surplus_locked(uuid,jsonb)','EXECUTE');`),'f');
 assert.equal(scalar(db,"SET ROLE service_role;SELECT count(*)>=0 FROM budget_month_category_actuals;"),'t');
});

test('multiple close destinations share one atomic root, and invalid confirmation leaves no batch',()=>{
 const db=make();open(db);seed(db,previous(db));sql(db,"INSERT INTO categories(id,name,type) VALUES(102,'second','expense');");seed(db,previous(db),'50','100',102,30);
 for(const cat of ['100','102'])call(db,'set_budget_unused_balance_policy',[cat,'savings_account','1']);
 const p=call(db,'get_budget_month_disposition_preview',[previous(db)]);
 const confirmations=['100','102'].map(category_id=>{const c=transferCommand(db,{source_month:previous(db),category_id,amount:category_id==='100'?'300':'50'}),v=preview(db,c);return {...c,amount:v.amount,preview_fingerprint:v.fingerprint};}).map(({source_month,...c})=>c);
 const before=financial(db);assert.notEqual(invoke(db,'apply_budget_month_disposition',[previous(db),key(40),p.fingerprint,null,confirmations.slice(0,1)],true).status,0);assert.deepEqual(financial(db),before);
 const result=call(db,'apply_budget_month_disposition',[previous(db),key(40),p.fingerprint,null,confirmations]);assert.equal(balance(db),'350.00');
 assert.equal(scalar(db,`SELECT count(*) FROM budget_operation_items WHERE operation_id=${result.batch_id} AND item_kind='savings_transfer';`),'2');
 assert.equal(state(db).cash_bridge.cash_expenses,'350.00');
});

test('legacy return-to-unallocated and reserve policies retain noncash behavior',()=>{
 for(const policy of ['return_to_unallocated','savings']){const db=make();open(db);seed(db,previous(db));call(db,'set_budget_unused_balance_policy',['100',policy]);const p=call(db,'get_budget_month_disposition_preview',[previous(db)]);call(db,'apply_budget_month_disposition',[previous(db),key(20),p.fingerprint,null]);assert.equal(balance(db),'0.00');assert.equal(scalar(db,'SELECT count(*) FROM transactions;'),'1');assert.equal(state(db).funding.available,policy==='return_to_unallocated'?'300.00':'0.00');assert.equal(scalar(db,'SELECT balance_text FROM budget_savings_state;'),policy==='savings'?'300.00':'0.00');}
});

test('carry-forward and legacy reserve deficit use retain consolidated accounting without cash',()=>{
 const db=make();open(db);seed(db,previous(db));call(db,'set_budget_unused_balance_policy',['100','carry_forward']);
 call(db,'establish_funded_budget',[month(db),'100','0','manual',key(12)]);
 const p=call(db,'get_budget_month_disposition_preview',[previous(db)]);call(db,'apply_budget_month_disposition',[previous(db),key(13),p.fingerprint,null]);
 assert.equal(state(db).funding.available,'300.00');assert.equal(state(db).categories.find(c=>c.category_id===100).final_funded,'300.00');assert.equal(balance(db),'0.00');assert.equal(scalar(db,'SELECT count(*) FROM transactions;'),'1');
 const db2=make();open(db2);seed(db2,previous(db),'0','500');call(db2,'set_budget_unused_balance_policy',['100','savings']);const p2=call(db2,'get_budget_month_disposition_preview',[previous(db2)]);call(db2,'apply_budget_month_disposition',[previous(db2),key(13),p2.fingerprint,null]);
 seed(db2,month(db2),'530','400',100,20);const legs=[{source_kind:'savings',amount:'130.00'}];const deficit=call(db2,'get_budget_deficit_resolution_preview',[month(db2),'100',legs]);
 call(db2,'apply_budget_deficit_resolution',[month(db2),'100',legs,key(22),deficit.fingerprint]);assert.equal(state(db2).categories.find(c=>c.category_id===100).final_funded,'530.00');assert.equal(scalar(db2,'SELECT balance_text FROM budget_savings_state;'),'370.00');assert.equal(balance(db2),'0.00');assert.equal(scalar(db2,'SELECT count(*) FROM transactions;'),'2');
});

test('manual correction remains available after an open-month surplus transfer',()=>{
 const db=make();open(db);seed(db);apply(db);const deposit=post(db,30,'deposit','10',{effective_date:today(db),charge_date:today(db)});
 correct(db,31,deposit.transaction_id,{amount:'20',effective_date:today(db),charge_date:today(db)});
 assert.equal(state(db).cash_bridge.manual_savings_deposits,'20.00');assert.equal(state(db).cash_bridge.funded_savings_transfers,'300.00');assert.equal(balance(db),'320.00');
});
test('eligible correction is a whole reversal followed by a separately intended partial transfer',()=>{
 const db=make();open(db);open(db,'0',2);seed(db);apply(db);call(db,'reverse_savings_surplus',reverseArgs(db));
 apply(db,22,transferCommand(db,{account_id:'2',amount:'200'}));
 assert.equal(balance(db),'0.00');assert.equal(account(db,'2').summary.current_balance,'200.00');assert.equal(state(db).funding.available,'800.00');assert.equal(state(db).cash_bridge.cash_expenses,'900.00');assert.equal(state(db).savings_transfer_history.length,2);
});
test('surplus money beyond JavaScript integer precision preserves its final cent',()=>{
 const db=make();open(db);seed(db,month(db),'0','9007199254740993.01');apply(db,20,transferCommand(db,{amount:'9007199254740993.01'}));
 assert.equal(balance(db),'9007199254740993.01');assert.equal(state(db).funding.available,'0.00');assert.equal(state(db).cash_bridge.cash_expenses,'9007199254740993.01');
});
