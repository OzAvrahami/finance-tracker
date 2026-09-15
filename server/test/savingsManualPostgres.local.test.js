// Real disposable PostgreSQL. Never loads .env or production credentials.
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const container = `finance-sav03-tests-${process.pid}`;
const read = p => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const migration = read('server/migrations/031_savings_manual_transactions.sql');
const baseline = read('server/full_schema.sql').split('-- Migration 031:')[0];
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
  sql('postgres', `CREATE DATABASE ${db} TEMPLATE sav03_baseline;`); sql(db, migration);
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
  run(['run', '-d', '--rm', '--name', container, '--label', 'finance.disposable=sav03-test', '-e', 'POSTGRES_PASSWORD=local_test_only', 'postgres:16-alpine']); created = true;
  const i = JSON.parse(run(['inspect', container]).stdout)[0];
  assert.equal(i.Config.Labels['finance.disposable'], 'sav03-test'); assert.equal(i.Config.Image, 'postgres:16-alpine'); assert.equal(Object.keys(i.HostConfig.PortBindings || {}).length, 0);
  for (let n = 0; n < 60; n++) { if (run(['exec', container, 'pg_isready', '-U', 'postgres'], undefined, true).status === 0) break; await wait(200); }
  sql('postgres', 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE DATABASE sav03_baseline;');
  sql('sav03_baseline', baseline);
  sql('sav03_baseline', 'GRANT SELECT,INSERT,DELETE ON transactions TO service_role; GRANT SELECT ON categories,payment_sources,loan_payments TO service_role; GRANT INSERT,UPDATE ON loan_payments TO service_role; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;');
});
after(() => { if (created) run(['rm', '-f', container]); });

test('owner pre/postflight JSON proves 031 leaves existing foundation/cash history unchanged', () => {
  const db = `case_${++sequence}`;
  sql('postgres', `CREATE DATABASE ${db} TEMPLATE sav03_baseline;`);
  open(db, '1200');
  const pre = json(db, read('docs/MIGRATION_031_PRODUCTION_PREFLIGHT.sql'));
  assert.equal(pre.result, 'MIGRATION_031_PREFLIGHT_PASS', JSON.stringify(pre.checks));
  sql(db, migration);
  const postflight = json(db, read('docs/MIGRATION_031_PRODUCTION_POSTFLIGHT.sql'));
  assert.equal(postflight.result, 'MIGRATION_031_POSTFLIGHT_PASS', JSON.stringify(postflight.checks));
  assert.deepEqual(pre.evidence, postflight.evidence);
});

test('031 clean/upgrade inventory and grants preserve two-table/one-view boundary and Loan definitions', () => {
  const db = make();
  const objects = "SELECT jsonb_build_object('tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),'views',(SELECT count(*) FROM pg_views WHERE schemaname='public'));";
  assert.deepEqual(json(db, objects), json('sav03_baseline', objects));
  const loans = "SELECT jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,'definition',pg_get_functiondef(oid),'acl',proacl) ORDER BY oid::regprocedure::text) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE '%loan%';";
  assert.equal(scalar(db, loans), scalar('sav03_baseline', loans));
  assert.equal(scalar(db, 'SELECT count(*) FROM savings_entries;'), '0');
  assert.equal(scalar(db, "SELECT has_function_privilege('service_role','post_savings_event(uuid,jsonb)','EXECUTE'),has_function_privilege('anon','post_savings_event(uuid,jsonb)','EXECUTE'),has_function_privilege('service_role','savings_post_event_locked(uuid,jsonb)','EXECUTE');"), 't|f|f');
  assert.equal(sql(db, "SET ROLE service_role; UPDATE transactions SET voided_at=now();", true).status !== 0, true);
  scalar(db, 'SET ROLE service_role; SELECT count(*) FROM budget_category_composition; SELECT count(*) FROM budget_month_category_actuals;');
  sql('postgres', 'CREATE DATABASE sav03_clean;'); sql('sav03_clean', read('server/full_schema.sql'));
  assert.deepEqual(json('sav03_clean', objects), json(db, objects));
  assert.equal(scalar('sav03_clean', "SELECT pg_get_functiondef('post_savings_event(uuid,jsonb)'::regprocedure);"), scalar(db, "SELECT pg_get_functiondef('post_savings_event(uuid,jsonb)'::regprocedure);"));
});

test('create exact cash, replay original command after correction, reject key reuse and invalid money', () => {
  const db = make(); open(db);
  const c = command(db, 'deposit', '90071992547409.91');
  const first = call(db, 'post_savings_event', [key(2), c]);
  assert.equal(balance(db), '90071992547409.91');
  assert.equal(cash(db, first.transaction_id).total_amount, '90071992547409.91');
  assert.equal(call(db, 'post_savings_event', [key(2), c]).replayed, true);
  assert.notEqual(invoke(db, 'post_savings_event', [key(2), { ...c, amount: '10' }], true).status, 0);
  for (const amount of ['1.001', 'NaN', '-1', 10, '10000000000000000']) assert.notEqual(invoke(db, 'post_savings_event', [key(3), command(db, 'deposit', amount)], true).status, 0);
  assert.equal(scalar(db, 'SELECT count(*) FROM transactions;'), '1');
  correct(db, 4, first.transaction_id, { amount: '100' });
  assert.equal(call(db, 'post_savings_event', [key(2), c]).replayed, true);
  assert.equal(balance(db), '100.00');
});

test('existing/imported cash links once without mutation of authoritative amount/date or cash duplication', () => {
  const db = make(); open(db);
  sql(db, "INSERT INTO transactions(description,total_amount,movement_type,transaction_date,charge_date,category_id,payment_source_id,external_id) VALUES('imported',100,'expense','2020-01-02','2020-01-03',100,1,'import-identity');");
  const t = cash(db, 1), c = command(db, 'deposit', '100', { action: 'link_cash', transaction_id: '1', expected_transaction_fingerprint: t.transaction_fingerprint, charge_date: '2020-01-03' });
  assert.notEqual(invoke(db, 'post_savings_event', [key(2), { ...c, amount: '99' }], true).status, 0);
  call(db, 'post_savings_event', [key(2), c]); assert.equal(balance(db), '100.00');
  assert.notEqual(invoke(db, 'post_savings_event', [key(3), { ...c, expected_revision: '2' }], true).status, 0);
  assert.equal(scalar(db, 'SELECT count(*) FROM transactions;'), '1');
  assert.equal(cash(db, 1).external_id, 'import-identity');
});

test('same-day/repeated amount correction retains original order, date shifts and account moves validate both histories', () => {
  const db = make(); open(db); post(db, 2); post(db, 3, 'withdrawal', '80');
  correct(db, 4, 1, { amount: '150' }); assert.equal(balance(db), '70.00');
  let t = cash(db, 1);
  assert.notEqual(invoke(db, 'correct_savings_event', [key(5), t.savings.entry_id, t.savings.revision, replacement(db, 1, { amount: '70' }), 'בדיקה'], true).status, 0);
  correct(db, 6, 1, { amount: '160' }); assert.equal(balance(db), '80.00');
  t = cash(db, 1);
  assert.notEqual(invoke(db, 'correct_savings_event', [key(7), t.savings.entry_id, t.savings.revision, replacement(db, 1, { effective_date: '2020-01-03' }), 'בדיקה'], true).status, 0);
  open(db, '0', 8); t = cash(db, 1);
  assert.notEqual(invoke(db, 'correct_savings_event', [key(9), t.savings.entry_id, t.savings.revision, replacement(db, 1, { account_id: '2', expected_destination_revision: '1' }), 'בדיקה'], true).status, 0);
  cancel(db, 10, 2); correct(db, 11, 1, { account_id: '2', expected_destination_revision: '1' });
  assert.equal(balance(db), '0.00'); assert.equal(account(db, '2').summary.current_balance, '160.00');
});

test('category/direction validation preserves accepted event identity and rejects installment cash linkage', () => {
  const db=make(); open(db,'1000'); post(db,2);
  const withdrawal=scalar(db,"SELECT id::text FROM categories WHERE savings_role='withdrawal';");
  const original=cash(db,1);
  assert.notEqual(invoke(db,'correct_savings_event',[key(3),original.savings.entry_id,original.savings.revision,replacement(db,1,{event_kind:'withdrawal',category_id:withdrawal}),'wrong direction'],true).status,0);
  assert.equal(balance(db),'1100.00'); assert.equal(cash(db,1).movement_type,'expense');
  assert.equal(scalar(db,'SELECT count(*) FROM transactions;'),'1');
  correct(db,4,1,{event_kind:'deposit',category_id:scalar(db,"SELECT id::text FROM categories WHERE savings_role='deposit';")});
  assert.equal(balance(db),'1100.00'); assert.equal(cash(db,1).movement_type,'expense');
  sql(db,"INSERT INTO transactions(description,total_amount,movement_type,transaction_date,charge_date,category_id,payment_source_id,installments_info) VALUES('partial installment import',100,'expense','2020-01-02','2020-01-02',100,1,'2/3');");
  const t=cash(db,2);
  assert.notEqual(invoke(db,'post_savings_event',[key(5),command(db,'deposit','100',{action:'link_cash',transaction_id:'2',expected_transaction_fingerprint:t.transaction_fingerprint})],true).status,0);
  assert.equal(balance(db),'1100.00'); assert.equal(cash(db,2).savings,null);
});

test('detach, explicit same-cash reinstatement, detached void and retry never reverse Savings twice', () => {
  const db = make(); open(db); post(db, 2);
  correct(db, 3, 1, { action: 'detach', category_id: '100' }); assert.equal(balance(db), '0.00');
  const count = scalar(db, 'SELECT count(*) FROM savings_entries;');
  let t = cash(db, 1);
  assert.notEqual(invoke(db, 'correct_savings_event', [key(4), t.savings.entry_id, t.savings.revision, replacement(db, 1, { reinstate: true }), 'בדיקה'], true).status, 0);
  correct(db, 5, 1, { action: 'link_cash', reinstate: true }); assert.equal(balance(db), '100.00');
  assert.equal(scalar(db, 'SELECT count(*) FROM transactions;'), '1');
  correct(db, 6, 1, { action: 'detach', category_id: '100' }); t = cash(db, 1);
  const entries = scalar(db, 'SELECT count(*) FROM savings_entries;'), revision = account(db).account.revision;
  const args = [key(7), '1', t.transaction_fingerprint, 'ביטול כסף מנותק'];
  call(db, 'void_detached_savings_transaction', args); call(db, 'void_detached_savings_transaction', args);
  assert.equal(scalar(db, 'SELECT count(*) FROM savings_entries;'), entries); assert.equal(account(db).account.revision, revision);
  assert.equal(balance(db), '0.00'); assert.ok(Number(entries) > Number(count));
  assert.notEqual(invoke(db, 'void_detached_savings_transaction', [key(7), '1', t.transaction_fingerprint, 'שונה'], true).status, 0);
  assert.notEqual(sql(db, 'DELETE FROM transactions WHERE id=1;', true).status, 0);
});

test('linked void excludes live pages/totals/reports but retains historical account, fingerprint and external identity', () => {
  const db = make(); open(db); post(db, 2); post(db, 3, 'withdrawal', '25');
  const t = cash(db, 2), args = [key(4), t.savings.entry_id, t.savings.revision, 'void', 'ביטול'];
  call(db, 'cancel_savings_event', args); assert.equal(call(db, 'cancel_savings_event', args).replayed, true);
  assert.equal(balance(db), '100.00');
  const page = call(db, 'transactions_page', [null, null, null, null, false, null, 1, 'transaction_date', 'desc', null, null, null, null, null, true, '1']);
  assert.equal(page.data.length, 1); assert.equal(page.totals.count, 1); assert.equal(Number(page.totals.expense), 100); assert.equal(Number(page.totals.income), 0);
  assert.ok(cash(db, 2).voided_at); assert.equal(cash(db, 2).savings.name, 'בדיקה מקומית');
  correct(db, 5, 2, { reinstate: true }); assert.equal(balance(db), '75.00');
  assert.equal(scalar(db, 'SELECT count(*) FROM transactions;'), '3');
});

test('cutoff, inactive references and archive reject new cash; historical corrections remain available', () => {
  const db = make(); open(db, '100');
  for (const extra of [{ effective_date: '2019-12-31' }, { effective_date: '2020-01-01' }, { effective_date: '2099-01-01' }, { charge_date: '2026-02-29' }, { payment_source_id: '999' }, { event_kind: 'interest_payout' }, { occurrence_month: '2020-01-01' }]) assert.notEqual(invoke(db, 'post_savings_event', [key(2), command(db, 'deposit', '10', extra)], true).status, 0);
  post(db, 3, 'deposit', '10', { effective_date: '2020-01-01', cutoff_confirmed: true });
  call(db, 'update_savings_account', ['1', account(db).account.revision, key(4), { status: 'archived' }]);
  assert.notEqual(invoke(db, 'post_savings_event', [key(5), command(db)], true).status, 0);
  correct(db, 6, 1, { amount: '15', cutoff_confirmed: true }); assert.equal(balance(db), '115.00');
  sql(db, 'UPDATE payment_sources SET is_active=false WHERE id=1;');
  const t = cash(db, 1); assert.notEqual(invoke(db, 'correct_savings_event', [key(7), t.savings.entry_id, t.savings.revision, replacement(db, 1), 'בדיקה'], true).status, 0);
});

test('concurrent withdrawals serialize: one succeeds, stale competing request cannot overdraw or partially post', async () => {
  const db = make(); open(db, '100'); const c = command(db, 'withdrawal', '80');
  const query = n => `SET ROLE service_role; SELECT post_savings_event('${key(n)}',${quote(JSON.stringify(c))});`;
  const results = await Promise.all([concurrent(db, query(2)), concurrent(db, query(3))]);
  assert.deepEqual(results.map(r => r.status).sort(), [0, 3]); assert.equal(balance(db), '20.00'); assert.equal(scalar(db, 'SELECT count(*) FROM transactions;'), '1');
});

test('Loan/Savings contention both orders and duplicate linking allow only one accounting authority', async () => {
  for (const loanFirst of [true, false]) {
    const db = make(); open(db);
    sql(db, "INSERT INTO transactions(description,total_amount,movement_type,transaction_date,charge_date,category_id,payment_source_id) VALUES('cash',100,'expense','2020-01-02','2020-01-02',100,1);");
    const t = cash(db, 1), c = command(db, 'deposit', '100', { action: 'link_cash', transaction_id: '1', expected_transaction_fingerprint: t.transaction_fingerprint });
    const loan = "INSERT INTO loan_payments(loan_id,transaction_id,installment_number,payment_date,payment_amount,principal_amount,interest_amount,source_kind) VALUES(1,1,1,'2020-01-02',100,100,0,'manual');";
    const savings = `SELECT post_savings_event('${key(2)}',${quote(JSON.stringify(c))});`;
    const first = concurrent(db, `SET ROLE service_role; BEGIN; ${loanFirst ? loan : savings} SELECT pg_sleep(1); COMMIT;`);
    await wait(250);
    const second = concurrent(db, `SET ROLE service_role; ${loanFirst ? savings : loan}`);
    assert.equal((await first).status, 0); assert.notEqual((await second).status, 0);
    assert.equal(balance(db), loanFirst ? '0.00' : '100.00');
  }
});

test('audited opening correction reverses/replaces explicit reserve retirement atomically', () => {
  const db = make(), month = scalar(db, "SELECT to_char(date_trunc('month',timezone('Asia/Jerusalem',now()))-interval '1 month','YYYY-MM');");
  call(db, 'add_manual_budget_funding', [month, '500', 'test', key(20)]);
  call(db, 'establish_funded_budget', [month, '100', '500', 'manual', key(21)]);
  call(db, 'set_budget_unused_balance_policy', ['100', 'savings']);
  const preview = call(db, 'get_budget_month_disposition_preview', [month]);
  call(db, 'apply_budget_month_disposition', [month, key(22), preview.fingerprint]);
  call(db, 'create_savings_account', [key(1), { name: 'reserve test', opened_on: '2020-01-01', tracking_start_date: '2020-01-01' }, '1200', '300', 'independently confirmed']);
  assert.equal(scalar(db, 'SELECT balance_text FROM budget_savings_state;'), '200.00');
  const opening = account(db).history[0];
  const fp = scalar(db, "SELECT md5(coalesce(jsonb_agg(to_jsonb(b) ORDER BY id),'[]')::text) FROM budget_savings_entries b;");
  const replacement = { action: 'noncash', account_id: '1', event_kind: 'opening', amount: '1000', effective_date: '2020-01-01', legacy_overlap_amount: '100', overlap_reason: 'released reserve confirmed independently', expected_reserve_fingerprint: fp };
  call(db, 'correct_savings_event', [key(2), opening.id, '1', replacement, 'opening reconciliation']);
  assert.equal(balance(db), '1000.00'); assert.equal(scalar(db, 'SELECT balance_text FROM budget_savings_state;'), '400.00'); assert.equal(scalar(db, 'SELECT count(*) FROM transactions;'), '0');
  assert.equal(account(db).history.length, 3);
});

test('closed/captured Budget history blocks linked corrections and detached void without partial effects', () => {
  const db = make(); open(db);
  const month = scalar(db, "SELECT to_char(date_trunc('month',timezone('Asia/Jerusalem',now()))-interval '1 month','YYYY-MM');");
  post(db, 2, 'deposit', '100', { effective_date: month + '-01', charge_date: month + '-01' });
  correct(db, 3, 1, { action: 'detach', category_id: '100', effective_date: month + '-01', charge_date: month + '-01' });
  call(db, 'add_manual_budget_funding', [month, '100', 'test', key(20)]);
  call(db, 'establish_funded_budget', [month, '100', '100', 'manual', key(21)]);
  const preview = call(db, 'get_budget_month_disposition_preview', [month]);
  call(db, 'apply_budget_month_disposition', [month, key(22), preview.fingerprint]);
  const t = cash(db, 1), count = scalar(db, 'SELECT count(*) FROM savings_entries;');
  assert.notEqual(invoke(db, 'void_detached_savings_transaction', [key(4), '1', t.transaction_fingerprint, 'blocked close'], true).status, 0);
  assert.notEqual(sql(db, 'UPDATE transactions SET total_amount=90 WHERE id=1;', true).status, 0);
  assert.equal(cash(db, 1).total_amount, '100.00'); assert.equal(cash(db, 1).voided_at, null); assert.equal(scalar(db, 'SELECT count(*) FROM savings_entries;'), count);
});

test('preexisting ordinary financial history is unchanged by 031; direct Savings-role cash-only inserts fail', () => {
  const db = `upgrade_${++sequence}`; sql('postgres', `CREATE DATABASE ${db} TEMPLATE sav03_baseline;`);
  sql(db, "INSERT INTO transactions(description,total_amount,movement_type,transaction_date) VALUES('legacy ordinary',12.34,'expense','2020-01-01');");
  const before = scalar(db, 'SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM transactions t;'); sql(db, migration);
  assert.equal(scalar(db, 'SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM transactions t;'), before);
  assert.notEqual(sql(db, "SET ROLE service_role; INSERT INTO transactions(description,total_amount,movement_type,transaction_date,category_id) VALUES('invalid cash only',10,'expense','2020-01-01',(SELECT id FROM categories WHERE savings_role='deposit'));", true).status, 0);
});
