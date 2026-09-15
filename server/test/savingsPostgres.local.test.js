// Explicit disposable PostgreSQL only. Never loads application .env/credentials.
// node --test server/test/savingsPostgres.local.test.js
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const container = `finance-savings-030-${process.pid}`;
const read = (file) => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
const full = read('server/full_schema.sql');
const baseline = full.split('-- Migration 030: Savings foundation')[0];
const migration = read('server/migrations/030_savings_foundation.sql');
let created = false;
const docker = (args, input, allow = false) => {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 60000 });
  if (!allow) assert.equal(r.status, 0, r.error?.message || r.stderr);
  return r;
};
const sql = (db, input, allow = false) => docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq'], input, allow);
const scalar = (db, input) => sql(db, input).stdout.trim();
const json = (db, input) => JSON.parse(scalar(db, input));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const asyncSql = (db, input) => new Promise((resolve) => {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq']);
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (x) => { stdout += x; }); child.stderr.on('data', (x) => { stderr += x; });
  child.on('close', (status) => resolve({ status, stdout, stderr })); child.stdin.end(input);
});
let counter = 0;
const db = (upgrade = true) => {
  const name = `savings_case_${counter += 1}`;
  sql('postgres', `CREATE DATABASE ${name} TEMPLATE savings_baseline;`);
  if (upgrade) sql(name, migration);
  return name;
};
const key = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const account = (amount = '0', overlap = '0', changes = {}, n = 1) => `SELECT public.create_savings_account('${key(n)}','${JSON.stringify({ name: 'חיסכון לבדיקה', opened_on: '2020-01-01', tracking_start_date: '2020-01-01', ...changes }).replaceAll("'", "''")}'::jsonb,${amount === null ? 'NULL' : `'${amount}'`},${overlap === null ? 'NULL' : `'${overlap}'`},'אושר לצורך בדיקה');`;
const seed = (database) => sql(database, `INSERT INTO public.categories(id,name,type) VALUES(10,'רגילה','expense'),(11,'הכנסה','income'); INSERT INTO public.payment_sources(id,name,slug,method,is_active) VALUES(1,'בנק בדיקה','savings-test','bank_transfer',true); INSERT INTO public.loans(id,name,original_amount,current_balance,total_installments,remaining_installments,calculation_mode) VALUES(1,'הלוואת בדיקה',1000,1000,10,10,'loan_payments');`);
// Privileged fixture construction exercises final-state guards without adding
// downstream public mutation commands to the application just for tests.
const post = (transaction, kind, amount, entry, n) => `
 INSERT INTO public.transactions(id,transaction_date,charge_date,movement_type,total_amount,category_id,payment_source_id)
 VALUES(${transaction},'2020-01-02','2020-01-02','${kind === 'deposit' ? 'expense' : 'income'}',${amount},(SELECT id FROM public.categories WHERE savings_role='${kind}'),1);
 INSERT INTO public.savings_entries(id,account_id,command_id,command_index,command_kind,command_fingerprint,event_kind,amount,effective_date,source_kind,transaction_id,cash_movement_type,cash_category_id,cash_payment_source_id,cash_charge_date)
 SELECT ${entry},1,'${key(n)}',0,'post_savings_event','fixture','${kind}',total_amount,transaction_date,'manual',id,movement_type,category_id,payment_source_id,charge_date FROM public.transactions WHERE id=${transaction};`;
const reverse = (entry, reversal, n) => `
 INSERT INTO public.savings_entries(id,account_id,command_id,command_index,command_kind,command_fingerprint,event_kind,entry_action,amount,effective_date,source_kind,transaction_id,cash_movement_type,cash_category_id,cash_payment_source_id,cash_charge_date,reverses_entry_id,reason)
 SELECT ${reversal},account_id,'${key(n)}',0,'correct_savings_event','correction',event_kind,'reverse',amount,effective_date,source_kind,transaction_id,cash_movement_type,cash_category_id,cash_payment_source_id,cash_charge_date,id,'תיקון בדיקה' FROM public.savings_entries WHERE id=${entry};
 UPDATE public.savings_entries SET reversed_by_entry_id=${reversal} WHERE id=${entry};`;
const replaceDeposit = (entry, reversal, replacement, amount, n) => `${reverse(entry, reversal, n)}
 UPDATE public.transactions SET total_amount=${amount} WHERE id=100;
 INSERT INTO public.savings_entries(id,account_id,command_id,command_index,command_kind,command_fingerprint,event_kind,amount,effective_date,source_kind,transaction_id,cash_movement_type,cash_category_id,cash_payment_source_id,cash_charge_date,supersedes_entry_id,reason)
 SELECT ${replacement},account_id,'${key(n)}',1,'correct_savings_event','correction',event_kind,${amount},effective_date,source_kind,transaction_id,cash_movement_type,cash_category_id,cash_payment_source_id,cash_charge_date,id,'תיקון בדיקה' FROM public.savings_entries WHERE id=${entry};`;
const loanLink = (transaction) => `INSERT INTO public.loan_payments(loan_id,transaction_id,installment_number,payment_date,payment_amount,principal_amount,interest_amount,source_kind) VALUES(1,${transaction},1,'2020-01-02',100,100,0,'manual');`;

before(async () => {
  docker(['run', '--detach', '--rm', '--name', container, '--label', 'finance.disposable=savings-test', '-e', 'POSTGRES_PASSWORD=savings_test_only', 'postgres:16-alpine']);
  created = true;
  const inspected = JSON.parse(docker(['inspect', container]).stdout)[0];
  assert.equal(inspected.Config.Labels['finance.disposable'], 'savings-test');
  assert.equal(inspected.Config.Image, 'postgres:16-alpine');
  assert.equal(Object.keys(inspected.HostConfig.PortBindings || {}).length, 0);
  for (let i = 0; i < 30; i += 1) {
    if (docker(['exec', container, 'pg_isready', '-U', 'postgres'], undefined, true).status === 0) break;
    await delay(200);
  }
  sql('postgres', 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE DATABASE savings_baseline;');
  sql('savings_baseline', baseline);
  // Model Supabase's ordinary service table access before the migration, then
  // prove that migration preserves it while protecting the four new columns.
  sql('savings_baseline', 'GRANT SELECT,INSERT,UPDATE,DELETE ON public.transactions TO service_role; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;');
});
after(() => { if (created) docker(['rm', '--force', container]); });

test('clean installation and upgrade add exactly two tables/one view, preserve history and expose only three account RPCs', () => {
  const name = db(false);
  seed(name);
  sql(name, "INSERT INTO transactions(id,transaction_date,movement_type,total_amount,category_id,payment_source_id) VALUES(100,'2020-01-02','expense',20,10,1);");
  const before = scalar(name, "SELECT to_jsonb(t) FROM transactions t WHERE id=100;");
  const inventory = "SELECT jsonb_build_object('tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),'views',(SELECT count(*) FROM pg_views WHERE schemaname='public'));";
  const old = json(name, inventory);
  const preflight = json(name, read('docs/MIGRATION_030_PRODUCTION_PREFLIGHT.sql'));
  assert.equal(preflight.result, 'MIGRATION_030_PREFLIGHT_PASS');
  const loanDefinitions = "SELECT jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,'body',pg_get_functiondef(oid),'acl',proacl) ORDER BY oid::regprocedure::text) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE '%loan%';";
  const oldLoanDefinitions = scalar(name, loanDefinitions);
  sql(name, migration);
  const postflight = json(name, read('docs/MIGRATION_030_PRODUCTION_POSTFLIGHT.sql'));
  assert.equal(postflight.result, 'MIGRATION_030_POSTFLIGHT_PASS');
  assert.deepEqual(postflight.evidence.financial_history, preflight.evidence.financial_history);
  assert.equal(postflight.evidence.legacy_reserve, preflight.evidence.legacy_reserve);
  assert.equal(postflight.evidence.budget_state_fingerprint, preflight.evidence.budget_state_fingerprint);
  assert.equal(scalar(name, loanDefinitions.replace("proname LIKE '%loan%'", "proname LIKE '%loan%' AND proname<>'savings_guard_loan_payment'")), oldLoanDefinitions);
  const now = json(name, inventory);
  assert.deepEqual(now, { tables: old.tables + 2, views: old.views + 1 });
  assert.equal(scalar(name, "SELECT to_jsonb(t)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason'] FROM transactions t WHERE id=100;"), before);
  assert.equal(scalar(name, 'SELECT count(*) FROM savings_accounts; SELECT count(*) FROM savings_entries;'), '0\n0');
  assert.equal(scalar(name, "SELECT count(*) FROM pg_proc WHERE proname IN ('post_savings_event','correct_savings_event','cancel_savings_event','void_detached_savings_transaction','apply_savings_surplus');"), '0');
  sql('postgres', 'CREATE DATABASE savings_clean;'); sql('savings_clean', full);
  const columns = "SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('savings_accounts','savings_entries') ORDER BY table_name,ordinal_position;";
  assert.equal(scalar(name, columns), scalar('savings_clean', columns));
});

test('opening zero/no-goal, exact large money, safe retries, target reached and archive preserve entries', () => {
  const name = db();
  const zero = json(name, `SET ROLE service_role; ${account()}`);
  assert.equal(zero.summary.current_balance, '0.00'); assert.equal(zero.summary.target_remaining, null);
  assert.equal(json(name, `SET ROLE service_role; ${account()}`).account.id, zero.account.id);
  assert.notEqual(sql(name, account('1'), true).status, 0);
  const large = json(name, account('9007199254740993.01', '0', { target_amount: '1' }, 2));
  assert.equal(large.summary.current_balance, '9007199254740993.01'); assert.equal(large.account.status, 'active');
  const entries = scalar(name, 'SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM savings_entries e;');
  const change = `SET ROLE service_role; SELECT update_savings_account(1,1,'${key(3)}','{"name":"עודכן","status":"archived","notes":"נשמר"}');`;
  const updated = json(name, change); assert.equal(updated.account.status, 'archived'); assert.equal(updated.account.auto_deposit_enabled, false);
  assert.equal(json(name, change).account.revision, '2');
  assert.notEqual(sql(name, `SELECT update_savings_account(1,1,'${key(4)}','{"name":"ישן"}');`, true).status, 0);
  assert.equal(scalar(name, 'SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM savings_entries e;'), entries);
});

test('invalid precision/dates/unknown overlap/configuration roll back, monthly plans remain disabled', () => {
  const name = db(); seed(name);
  for (const input of [account(null), account('1', null), account('1.001'), account('NaN'), account('1','2'), account('1','0',{ tracking_start_date:'2099-01-01' }), account('1','0',{ opened_on:'2026-02-29' }), account('1','0',{ target_amount: 1.25 }), account('1','0',{ target_amount:'0' }), account('1','0',{ auto_deposit_enabled:true }), account('1','0',{ default_payment_source_id:'999' })]) {
    assert.notEqual(sql(name, input, true).status, 0, input);
    assert.equal(scalar(name, 'SELECT count(*) FROM savings_accounts;'), '0');
  }
  sql(name, 'UPDATE payment_sources SET is_active=false WHERE id=1;');
  assert.notEqual(sql(name, account('0','0',{ default_payment_source_id:'1' }), true).status, 0);
  const row = json(name, account('0','0',{ monthly_amount:'25.10', monthly_day:31, plan_start_date:'2099-02-01' }));
  assert.equal(row.account.next_due_date, '2099-02-28'); assert.equal(row.account.auto_deposit_enabled, false);
  assert.notEqual(sql(name, `SELECT update_savings_account(1,1,'${key(2)}','{"tracking_start_date":"2020-02-01"}');`, true).status, 0);
});

test('explicit 1200/500/300 overlap retires reserve atomically without inventing cash or changing funded balances', () => {
  const name = db(false); seed(name);
  const previous = "to_char(date_trunc('month',timezone('Asia/Jerusalem',now()))-interval '1 month','YYYY-MM')";
  sql(name, `SELECT add_manual_budget_funding(${previous},500,'test','${key(20)}'); SELECT establish_funded_budget(${previous},10,500,'manual','${key(21)}'); SELECT set_budget_unused_balance_policy(10,'savings');`);
  const preview = json(name, `SELECT get_budget_month_disposition_preview(${previous});`);
  sql(name, `SELECT apply_budget_month_disposition(${previous},'${key(22)}','${preview.fingerprint}');`);
  assert.equal(scalar(name, 'SELECT balance_text FROM budget_savings_state;'), '500.00');
  const historical = scalar(name, 'SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM budget_savings_entries b;');
  const funding = scalar(name, 'SELECT jsonb_agg(to_jsonb(f) ORDER BY budget_month_id) FROM budget_month_funding_state f;');
  sql(name, migration);
  const row = json(name, account('1200','300'));
  assert.equal(row.summary.current_balance,'1200.00'); assert.equal(scalar(name,'SELECT balance_text FROM budget_savings_state;'),'200.00');
  assert.equal(scalar(name, 'SELECT count(*) FROM transactions;'),'0');
  assert.equal(scalar(name, 'SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM budget_savings_entries b WHERE entry_kind<>\'account_opening_retirement\';'),historical);
  // The current audit month may be materialized with zero funding; old months' amounts stay exact.
  assert.equal(scalar(name, "SELECT jsonb_agg(to_jsonb(f) ORDER BY budget_month_id) FROM budget_month_funding_state f;"),funding);
  assert.notEqual(sql(name,account('1200','300',{},2),true).status,0);
  assert.equal(scalar(name,'SELECT count(*) FROM savings_accounts;'),'1');
});

test('same-day and repeated replacements retain original ordering; consumed deposits reject negative prefixes', () => {
  const name = db(); seed(name); sql(name,account());
  sql(name,`BEGIN; ${post(100,'deposit',100,100,2)} ${post(101,'withdrawal',80,101,3)} COMMIT;`);
  sql(name,`BEGIN; ${replaceDeposit(100,102,103,150,4)} COMMIT;`);
  assert.equal(json(name,'SELECT get_savings_account(1);').summary.current_balance,'70.00');
  assert.notEqual(sql(name,`BEGIN; ${replaceDeposit(103,104,105,70,5)} COMMIT;`,true).status,0);
  assert.equal(scalar(name,'SELECT total_amount FROM transactions WHERE id=100;'),'150');
  sql(name,`BEGIN; ${replaceDeposit(103,104,105,160,5)} COMMIT;`);
  assert.equal(json(name,'SELECT get_savings_account(1);').summary.current_balance,'80.00');
  assert.notEqual(sql(name,'UPDATE savings_entries SET amount=999 WHERE id=105;',true).status,0);
  assert.notEqual(sql(name,'DELETE FROM savings_entries WHERE id=100;',true).status,0);
});

test('service privileges preserve ordinary writes and direct Budget reads but deny protected fields/helpers/ledgers', () => {
  const name = db(); seed(name);
  sql(name, "SET ROLE service_role; INSERT INTO transactions(id,transaction_date,movement_type,total_amount,category_id) VALUES(100,'2020-01-02','expense',10,10); UPDATE transactions SET total_amount=100 WHERE id=100; SELECT * FROM budget_category_composition; SELECT * FROM budget_month_category_actuals; SELECT dashboard_summary(NULL,NULL);");
  for (const statement of ["UPDATE transactions SET voided_at=now() WHERE id=100;", "SELECT savings_assert_account(1);", "INSERT INTO savings_accounts(name) VALUES('x');", 'TRUNCATE savings_entries;']) assert.notEqual(sql(name,`SET ROLE service_role; ${statement}`,true).status,0);
  for (const role of ['anon','authenticated']) for (const statement of [account(), 'SELECT * FROM budget_actual_transactions(NULL,NULL);','SELECT * FROM savings_account_summary;']) assert.notEqual(sql(name,`SET ROLE ${role}; ${statement}`,true).status,0);
  sql(name, `SET ROLE service_role; ${loanLink(100)}`);
  assert.equal(scalar(name,'SELECT count(*) FROM loan_payments;'),'1');
});

test('detached and voided history is immutable, excluded from every live cash reader, and remains readable', () => {
  const name = db(); seed(name); sql(name,account());
  sql(name,`BEGIN; ${post(100,'deposit',100,100,2)} COMMIT;`);
  sql(name,`BEGIN; ${reverse(100,101,3)} UPDATE transactions SET category_id=10,external_id='reserved-external',tags='cancelled-tag' WHERE id=100; COMMIT;`);
  assert.equal(json(name,'SELECT transactions_page(p_include_totals=>true);').totals.expense,100);
  assert.equal(json(name,'SELECT dashboard_monthly_series(120);').find((row)=>row.month==='2020-01').expenses,100);
  sql(name,`UPDATE transactions SET voided_at=now(),void_request_key='${key(4)}',void_fingerprint='receipt',void_reason='בוטלה' WHERE id=100;`);
  assert.equal(json(name,'SELECT get_savings_account(1);').summary.current_balance,'0.00');
  assert.equal(json(name,'SELECT dashboard_summary(NULL,NULL);').count,0);
  assert.equal(scalar(name,'SELECT count(*) FROM budget_actual_transactions(NULL,NULL);'),'0');
  assert.equal(scalar(name,'SELECT count(*) FROM transactions_filtered(NULL,NULL,NULL,NULL,false,NULL);'),'0');
  assert.equal(scalar(name,'SELECT count(*) FROM get_unique_tags();'),'0');
  const page = json(name,'SELECT transactions_page(p_include_totals=>true);');
  assert.deepEqual(page.data,[]); assert.equal(page.has_more,false); assert.equal(page.totals.count,0); assert.equal(page.totals.expense,0);
  assert.equal(json(name,'SELECT dashboard_monthly_series(120);').find((row)=>row.month==='2020-01').expenses,0);
  assert.equal(scalar(name,"SELECT count(*) FROM transactions WHERE external_id='reserved-external' AND voided_at IS NOT NULL;"),'1');
  assert.notEqual(sql(name,'DELETE FROM transactions WHERE id=100;',true).status,0);
  assert.notEqual(sql(name,`SET ROLE service_role; ${loanLink(100)}`,true).status,0);
});

test('Loan-side guard rejects active and detached Savings links, including UPDATE', () => {
  const name = db(); seed(name); sql(name,account());
  sql(name,`BEGIN; ${post(100,'deposit',100,100,2)} COMMIT;`);
  assert.notEqual(sql(name,`SET ROLE service_role; ${loanLink(100)}`,true).status,0);
  sql(name,`BEGIN; ${reverse(100,101,3)} UPDATE transactions SET category_id=10 WHERE id=100; COMMIT;`);
  assert.notEqual(sql(name,`SET ROLE service_role; ${loanLink(100)}`,true).status,0);
  sql(name, "INSERT INTO transactions(id,transaction_date,movement_type,total_amount,category_id) VALUES(101,'2020-01-02','expense',100,10);");
  sql(name,loanLink(101));
  assert.notEqual(sql(name,'SET ROLE service_role; UPDATE loan_payments SET transaction_id=100;',true).status,0);
});

test('two connections serialize Loan-first and Savings-first link contention; at most one accounting link commits', async () => {
  for (const first of ['loan','savings']) {
    const name = db(); seed(name); sql(name,account());
    sql(name,"INSERT INTO transactions(id,transaction_date,charge_date,movement_type,total_amount,category_id,payment_source_id) VALUES(100,'2020-01-02','2020-01-02','expense',100,10,1);");
    const savingsLink = post(999,'deposit',100,100,2).replace(/INSERT INTO public.transactions[\s\S]*?;\s*/, "UPDATE public.transactions SET category_id=(SELECT id FROM categories WHERE savings_role='deposit') WHERE id=100; ").replace('WHERE id=999','WHERE id=100');
    const winner = first==='loan'?loanLink(100):savingsLink;
    const loser = first==='loan'?savingsLink:loanLink(100);
    const a = asyncSql(name,`BEGIN; SELECT id FROM transactions WHERE id=100 FOR UPDATE; SELECT pg_sleep(1.5); ${winner} COMMIT;`);
    let locked = false;
    for(let n=0;n<30;n+=1) { if(scalar(name,"SELECT EXISTS(SELECT 1 FROM pg_locks WHERE relation='transactions'::regclass AND mode='RowShareLock' AND granted);")==='t') { locked=true; break; } await delay(30); }
    assert.equal(locked,true,'first connection acquired cash-row lock');
    const b = asyncSql(name,`BEGIN; ${loser} COMMIT;`);
    const [won,lost] = await Promise.all([a,b]);
    assert.equal(won.status,0,won.stderr); assert.notEqual(lost.status,0,lost.stderr);
    assert.equal(scalar(name,"SELECT (SELECT count(*) FROM loan_payments)+(SELECT count(*) FROM savings_entries WHERE transaction_id=100 AND entry_action='post' AND reversed_by_entry_id IS NULL);"),'1');
  }
});

test('concurrent account retries create one opening; conflicting payload/config revisions cannot both commit', async () => {
  const name = db();
  const results = await Promise.all([asyncSql(name, `SET ROLE service_role; ${account()}`), asyncSql(name, `SET ROLE service_role; ${account()}`)]);
  for (const result of results) assert.equal(result.status, 0, result.stderr);
  assert.equal(scalar(name, 'SELECT count(*) FROM savings_accounts; SELECT count(*) FROM savings_entries;'), '1\n1');
  const competing = await Promise.all([asyncSql(name, account('100','0',{},2)), asyncSql(name, account('200','0',{},2))]);
  assert.equal(competing.filter((r) => r.status === 0).length, 1);
  const edits = await Promise.all([3,4].map((n) => asyncSql(name, `SELECT update_savings_account(1,1,'${key(n)}','{"notes":"${n}"}');`)));
  assert.equal(edits.filter((r) => r.status === 0).length, 1);
  assert.equal(scalar(name, 'SELECT revision FROM savings_accounts WHERE id=1;'), '2');
});

test('occurrence claims survive reversal, same-root reinstatement is unique, and dates/account state are guarded', () => {
  const name = db(); seed(name); sql(name,account('0','0',{monthly_amount:'100',monthly_day:2,plan_start_date:'2020-01-01'}));
  const initial = post(100,'deposit',100,100,2).replace('cash_charge_date)', 'cash_charge_date,occurrence_month,scheduled_due_date,plan_revision)').replace('charge_date FROM public.transactions','charge_date,\'2020-01-01\'::date,\'2020-01-02\'::date,0 FROM public.transactions');
  sql(name, `BEGIN; ${initial} COMMIT;`);
  const duplicate = initial.replaceAll('100','101').replaceAll(key(2),key(3));
  assert.notEqual(sql(name,`BEGIN; ${duplicate} COMMIT;`,true).status,0);
  sql(name, `BEGIN; ${reverse(100,102,4)} UPDATE transactions SET category_id=10 WHERE id=100; COMMIT;`);
  assert.notEqual(sql(name,`BEGIN; ${duplicate} COMMIT;`,true).status,0);
  sql(name, `BEGIN; UPDATE transactions SET category_id=(SELECT id FROM categories WHERE savings_role='deposit') WHERE id=100;
    INSERT INTO savings_entries(id,account_id,command_id,command_index,command_kind,command_fingerprint,event_kind,amount,effective_date,source_kind,transaction_id,cash_movement_type,cash_category_id,cash_payment_source_id,cash_charge_date,occurrence_month,scheduled_due_date,plan_revision,occurrence_root_id,supersedes_entry_id,reason)
    SELECT 103,account_id,'${key(5)}',0,'correct_savings_event','reinstate',event_kind,amount,effective_date,source_kind,transaction_id,cash_movement_type,cash_category_id,cash_payment_source_id,cash_charge_date,occurrence_month,scheduled_due_date,plan_revision,id,id,'explicit reinstate' FROM savings_entries WHERE id=100; COMMIT;`);
  assert.equal(scalar(name,'SELECT count(*) FROM transactions;'),'1');
  assert.equal(json(name,'SELECT get_savings_account(1);').summary.current_balance,'100.00');
  assert.notEqual(sql(name,`BEGIN; ${post(104,'deposit',20,104,6).replaceAll('2020-01-02','2019-12-31')} COMMIT;`,true).status,0);
  sql(name,`SELECT update_savings_account(1,1,'${key(7)}','{"status":"archived"}');`);
  assert.notEqual(sql(name,`BEGIN; ${post(104,'deposit',20,104,6)} COMMIT;`,true).status,0);
});
