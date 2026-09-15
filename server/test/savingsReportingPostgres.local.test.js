// Real disposable PostgreSQL. Never loads .env or production credentials.
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const container = `finance-sav07-tests-${process.pid}`;
const read = p => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const migration = read('server/migrations/035_savings_reporting.sql');
const baseline = read('server/full_schema.sql').split('-- Migration 035:')[0];
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
  sql('postgres', `CREATE DATABASE ${db} TEMPLATE sav07_baseline;`); sql(db, migration);
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
  run(['run', '-d', '--rm', '--name', container, '--label', 'finance.disposable=sav07-test', '-e', 'POSTGRES_PASSWORD=local_test_only', 'postgres:16-alpine']); created = true;
  const i = JSON.parse(run(['inspect', container]).stdout)[0];
  assert.equal(i.Config.Labels['finance.disposable'], 'sav07-test'); assert.equal(i.Config.Image, 'postgres:16-alpine'); assert.equal(Object.keys(i.HostConfig.PortBindings || {}).length, 0);
  for (let n = 0; n < 60; n++) { if (run(['exec', container, 'pg_isready', '-U', 'postgres'], undefined, true).status === 0) break; await wait(200); }
  sql('postgres', 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE DATABASE sav07_baseline;');
  sql('sav07_baseline', baseline);
  sql('sav07_baseline', 'GRANT SELECT,INSERT,DELETE ON transactions TO service_role; GRANT SELECT ON categories,payment_sources,loan_payments TO service_role; GRANT INSERT,UPDATE ON loan_payments TO service_role; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;');
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
const report = (db, from='2020-01-01', to=today(db), id=null) => call(db,'get_savings_report',[from,to,id]);
const capitalize = (db,n,amount='10',date=today(db)) => call(db,'post_savings_event',[key(n),{ action:'noncash',account_id:'1',expected_revision:account(db).account.revision,event_kind:'interest_capitalized',amount,effective_date:date }]);
const page = (db,kind,extra='') => json(db,`SET ROLE service_role; SELECT transactions_page(p_savings_flow=>${quote(kind)},p_include_totals=>true${extra});`);

test('authoritative 1200 + 100 + 300 - 50 + 10 = 1560, payout 5 is earnings/cash only',()=>{
 const db=make();open(db,'1200');seed(db);apply(db);
 const dates={effective_date:today(db),charge_date:today(db)};
 post(db,30,'deposit','100',dates);post(db,31,'withdrawal','50',dates);capitalize(db,32);post(db,33,'interest_payout','5',dates);
 const r=report(db,month(db)+'-01');
 assert.equal(r.current_balance,'1560.00');assert.deepEqual(r.period,{deposits:'400.00',withdrawals:'50.00',capitalized_interest:'10.00',paid_out_interest:'5.00',realized_interest:'15.00'});
 assert.deepEqual(r.cash,{expenses:'1100.00',income:'55.00',ordinary_expenses:'700.00',other_income:'0.00',deposits:'400.00',funded_deposits:'300.00',withdrawals:'50.00',paid_out_interest:'5.00'});
 assert.equal(scalar(db,`SET ROLE service_role; SELECT sum(total_amount)::numeric(30,2)::text FROM budget_actual_transactions('${month(db)}-01','${today(db)}');`),'800.00');
 assert.equal(r.accounts[0].target_amount,null);assert.equal(report(db,'2020-01-01','2020-01-31').period.deposits,'0.00');
 assert.equal(scalar(db,'SELECT current_balance::numeric(30,2)::text FROM loans WHERE id=1;'),'1000.00');
 const a=account(db).account;call(db,'update_savings_account',['1',a.revision,key(34),{status:'archived'}]);
 assert.deepEqual(report(db).period,r.period);assert.equal(report(db).accounts[0].status,'archived');
 assert.equal(report(db,month(db)+'-01',today(db),'1').cash.expenses,'400.00');
});

test('cross-month funded provenance changes the source envelope but uses cash/event month in reports',()=>{
 const db=make();open(db);seed(db,previous(db));const c=transferCommand(db,{source_month:previous(db)});apply(db,20,c);
 assert.equal(report(db,previous(db)+'-01',previous(db)+'-28').cash.deposits,'0.00');
 const r=report(db,month(db)+'-01');assert.equal(r.period.deposits,'300.00');assert.equal(r.cash.funded_deposits,'300.00');
 assert.equal(scalar(db,`SELECT coalesce(sum(total_amount),0)::text FROM budget_actual_transactions('${month(db)}-01','${today(db)}');`),'0');
 assert.equal(report(db,'2020-01-01','2020-12-31').current_balance,'300.00');
});

test('cash classification precedes pagination and totals for every sort; metadata stays exact',()=>{
 const db=make();open(db,'1200');post(db,2);post(db,3,'deposit','120');post(db,4,'withdrawal','50');post(db,5,'interest_payout','5');
 sql(db,"INSERT INTO transactions(description,total_amount,movement_type,transaction_date,category_id) VALUES('ordinary',37,'expense','2020-01-02',100),('other income',20,'income','2020-01-02',101);");
 for(const sort of ['transaction_date','total_amount','description'])for(const direction of ['asc','desc']){
  const r=page(db,'deposit',`,p_limit=>1,p_sort_by=>'${sort}',p_sort_direction=>'${direction}'`);
  assert.equal(r.data.length,1);assert.equal(r.data[0].cash_flow,'deposit');assert.equal(r.has_more,true);assert.equal(r.totals.count,2);assert.equal(r.totals.expense,220);
 }
 assert.equal(page(db,'ordinary_expense').data[0].total_amount,'37');assert.equal(page(db,'ordinary_income').totals.income,20);
 assert.equal(page(db,'withdrawal').totals.income,50);assert.equal(page(db,'interest_payout').totals.income,5);
 assert.notEqual(sql(db,"SET ROLE service_role;SELECT transactions_page(p_savings_flow=>'made_up');",true).status,0);
});

test('corrections move period flows, cancellation excludes tombstones and detached live cash is ordinary',()=>{
 const db=make();open(db,'1200');const r=post(db,2);correct(db,3,r.transaction_id,{amount:'150',effective_date:'2021-02-03',charge_date:'2021-02-03'});
 assert.equal(report(db,'2020-01-01','2020-12-31').period.deposits,'0.00');assert.equal(report(db,'2021-02-01','2021-02-28').period.deposits,'150.00');
 assert.equal(report(db).cash.deposits,'150.00');
 correct(db,4,r.transaction_id,{action:'detach',category_id:'100',effective_date:'2021-02-03',charge_date:'2021-02-03'});
 assert.equal(report(db).current_balance,'1200.00');assert.equal(report(db).cash.deposits,'0.00');assert.equal(report(db).cash.ordinary_expenses,'150.00');
 assert.equal(report(db,'2020-01-01',today(db),'1').cash.expenses,'0.00');assert.equal(cash(db,r.transaction_id).cash_flow,'ordinary_expense');
 const t=cash(db,r.transaction_id);call(db,'void_detached_savings_transaction',[key(5),String(r.transaction_id),t.transaction_fingerprint,'cancel detached']);
 assert.equal(report(db).cash.expenses,'0.00');assert.equal(cash(db,r.transaction_id).cash_flow,'cancelled');assert.equal(report(db).current_balance,'1200.00');
});

test('interest correction does not double earnings; withdrawal never recognizes interest again',()=>{
 const db=make();open(db,'1200');const r=post(db,2,'interest_payout','40');
 const t=cash(db,r.transaction_id);call(db,'correct_savings_event',[key(3),t.savings.entry_id,t.savings.revision,{action:'noncash',account_id:'1',transaction_id:String(r.transaction_id),expected_transaction_fingerprint:t.transaction_fingerprint,event_kind:'interest_capitalized',amount:'40',effective_date:'2020-01-02'},'retain interest']);
 let x=report(db);assert.equal(x.current_balance,'1240.00');assert.equal(x.period.realized_interest,'40.00');assert.equal(x.cash.income,'0.00');
 post(db,4,'withdrawal','40');x=report(db);assert.equal(x.current_balance,'1200.00');assert.equal(x.period.realized_interest,'40.00');assert.equal(x.cash.withdrawals,'40.00');
 const payout=post(db,5,'interest_payout','5');cancel(db,6,payout.transaction_id);assert.equal(report(db).period.realized_interest,'40.00');assert.equal(report(db).cash.paid_out_interest,'0.00');
});

test('empty periods, archived goals, exact large amounts and narrow report permissions',()=>{
 const db=make();assert.equal(report(db).current_balance,'0.00');assert.deepEqual(report(db).accounts,[]);
 open(db,'9007199254740993.01');call(db,'update_savings_account',['1',account(db).account.revision,key(2),{target_amount:'100',status:'archived'}]);
 const r=report(db,'2000-01-01','2000-12-31');assert.equal(r.current_balance,'9007199254740993.01');assert.equal(r.accounts[0].target_remaining,'0.00');assert.equal(r.period.deposits,'0.00');
 for(const role of ['anon','authenticated'])assert.notEqual(sql(db,`SET ROLE ${role};SELECT get_savings_report('2020-01-01','2020-12-31');`,true).status,0);
 assert.notEqual(invoke(db,'get_savings_report',['2020-02-01','2020-01-01'],true).status,0);assert.notEqual(invoke(db,'get_savings_report',['2020-01-01','2020-12-31','999'],true).status,0);
 assert.notEqual(sql(db,"SET ROLE service_role;SELECT savings_post_event_locked('00000000-0000-4000-8000-000000000099','{}');",true).status,0);
 sql(db,"SET ROLE service_role; SELECT * FROM budget_category_composition;SELECT * FROM budget_month_category_actuals;");
});

test('034 upgrade and clean snapshot preserve history, relations and all write/Loan definitions',()=>{
 sql('postgres','CREATE DATABASE upgrade_035 TEMPLATE sav07_baseline;');const db='upgrade_035';open(db,'1200');const before=financial(db);
 const definitions="SELECT jsonb_object_agg(oid::regprocedure::text,md5(pg_get_functiondef(oid))) FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f' AND proname NOT IN ('transactions_filtered','transactions_page','get_savings_report');";
 const pre=json(db,read('docs/MIGRATION_035_PRODUCTION_PREFLIGHT.sql'));assert.equal(pre.result,'MIGRATION_035_PREFLIGHT_PASS',JSON.stringify(pre));const defs=json(db,definitions);sql(db,migration);const after=json(db,read('docs/MIGRATION_035_PRODUCTION_POSTFLIGHT.sql'));assert.equal(after.result,'MIGRATION_035_POSTFLIGHT_PASS',JSON.stringify(after));assert.deepEqual(after.evidence,pre.evidence);assert.deepEqual(financial(db),before);assert.deepEqual(json(db,definitions),defs);
 assert.equal(scalar(db,"SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r';"),'28');assert.equal(scalar(db,"SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='v';"),'10');
 sql('postgres','CREATE DATABASE clean_035;');sql('clean_035',read('server/full_schema.sql'));
 const reports="SELECT jsonb_object_agg(oid::regprocedure::text,md5(pg_get_functiondef(oid))) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('transactions_filtered','transactions_page','get_savings_report');";
 assert.deepEqual(json(db,reports),json('clean_035',reports));assert.equal(scalar('clean_035','SELECT count(*) FROM savings_accounts;'),'0');
});
