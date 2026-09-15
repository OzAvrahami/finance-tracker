// Release rehearsal: isolated PostgreSQL only; never reads .env.
// Evidence and binary backups are written outside the checkout.
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-sav08-release-'));
const container = `finance-sav08-release-${process.pid}`;
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const full = read('server/full_schema.sql');
const baseline = full.split('-- Migration 030: Savings foundation')[0];
const files = fs.readdirSync(path.join(root, 'server/migrations')).filter(f => /^03[0-5]_.*\.sql$/.test(f)).sort();
assert.equal(files.length, 6);
let created = false;
const run = (args, input, allow = false) => {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 32e6, timeout: 120000 });
  if (!allow) assert.equal(r.status, 0, r.stderr || r.error?.message);
  return r;
};
const sql = (db, input, allow = false) => run(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq'], input, allow);
const scalar = (db, input) => sql(db, input).stdout.trim();
const json = (db, input) => JSON.parse(scalar(db, input));
const save = (name, x) => fs.writeFileSync(path.join(evidenceDir, name + '.json'), JSON.stringify(x, null, 2));
const key = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const quote = x => `'${String(x).replaceAll("'", "''")}'`;
const call = (db, fn, args) => json(db, `SET ROLE service_role; SELECT ${fn}(${args.map(a => a === null ? 'NULL' : quote(typeof a === 'object' ? JSON.stringify(a) : a)).join(',')});`);
const grants = `GRANT SELECT,INSERT,DELETE ON transactions TO service_role;
GRANT SELECT ON categories,payment_sources,loan_payments TO service_role;
GRANT INSERT,UPDATE ON loan_payments TO service_role;
DO $$DECLARE seq record; BEGIN FOR seq IN SELECT sequencename FROM pg_sequences WHERE schemaname='public' AND sequencename NOT IN ('savings_accounts_id_seq','savings_entries_id_seq') LOOP EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE %I TO service_role',seq.sequencename); END LOOP; END $$;
DO $$DECLARE cols text; BEGIN SELECT string_agg(quote_ident(column_name),',') INTO cols FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name NOT IN ('voided_at','void_request_key','void_fingerprint','void_reason'); EXECUTE 'GRANT UPDATE ('||cols||') ON transactions TO service_role'; END $$;`;
// OID-independent catalog includes all public definitions and explicit ACLs.
const catalog = db => {
  const result = json(db, `SELECT jsonb_build_object(
'relations',(SELECT jsonb_object_agg(relname,jsonb_build_object('kind',relkind,'rls',relrowsecurity,'force_rls',relforcerowsecurity,'acl',coalesce(relacl,acldefault(CASE WHEN relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,relowner))::text,'options',reloptions)) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','v','S')),
'columns',(SELECT jsonb_object_agg(c.relname||'.'||a.attname,jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'nullable',NOT a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'acl',a.attacl::text)) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','v') AND a.attnum>0 AND NOT a.attisdropped),
'constraints',(SELECT jsonb_object_agg(conrelid::regclass::text||'.'||conname,pg_get_constraintdef(oid)) FROM pg_constraint WHERE connamespace='public'::regnamespace),
'indexes',(SELECT jsonb_object_agg(indexname,indexdef) FROM pg_indexes WHERE schemaname='public'),
'triggers',(SELECT jsonb_object_agg(tgrelid::regclass::text||'.'||tgname,pg_get_triggerdef(oid)) FROM pg_trigger WHERE tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace) AND NOT tgisinternal),
'views',(SELECT jsonb_object_agg(viewname,definition) FROM pg_views WHERE schemaname='public'),
'functions',(SELECT jsonb_object_agg(oid::regprocedure::text,jsonb_build_object('definition',pg_get_functiondef(oid),'acl',proacl::text)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f'),
'policies',(SELECT coalesce(jsonb_object_agg(tablename||'.'||policyname,to_jsonb(p)), '{}'::jsonb) FROM pg_policies p WHERE schemaname='public'));
`);
  // pg_dump/reparse distributes this existing varchar[] -> text[] cast.
  // Normalize only the two known equivalent spellings, not arbitrary SQL.
  const name = 'transactions.transactions_movement_type_check';
  result.constraints[name] = result.constraints[name].replace(
    "ANY ((ARRAY['expense'::character varying, 'income'::character varying])::text[])",
    "ANY (ARRAY[('expense'::character varying)::text, ('income'::character varying)::text])",
  );
  if (result.constraints['savings_accounts.savings_accounts_name_check']) {
    result.constraints['savings_accounts.savings_accounts_name_check'] = result.constraints['savings_accounts.savings_accounts_name_check'].replace(
      'CHECK ((((length(name) >= 1) AND (length(name) <= 200)) AND (name = btrim(name))))',
      'CHECK (((length(name) >= 1) AND (length(name) <= 200) AND (name = btrim(name))))',
    );
  }
  return result;
};
const rows = db => {
  const tables = json(db, "SELECT jsonb_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public';");
  return Object.fromEntries(tables.map(t => [t, json(db, `SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) FROM public.${t} r;`)]));
};
const difference = (a, b) => Object.fromEntries(Object.keys(b).map(kind => [kind, {
  added: Object.keys(b[kind]).filter(k => !(k in a[kind])),
  removed: Object.keys(a[kind]).filter(k => !(k in b[kind])),
  changed: Object.keys(b[kind]).filter(k => k in a[kind] && JSON.stringify(a[kind][k]) !== JSON.stringify(b[kind][k])),
}]));
const backupRestore = (source, dest) => {
  // Binary dump never passes through a shell text pipeline.
  run(['exec', container, 'pg_dump', '-U', 'postgres', '-d', source, '-Fc', '-f', `/tmp/${dest}.dump`]);
  const file = path.join(evidenceDir, dest + '.dump');
  run(['cp', `${container}:/tmp/${dest}.dump`, file]);
  sql('postgres', `CREATE DATABASE ${dest};`);
  run(['exec', container, 'pg_restore', '-U', 'postgres', '-d', dest, '--exit-on-error', `/tmp/${dest}.dump`]);
  const expected = catalog(source), actual = catalog(dest);
  assert(JSON.stringify(actual) === JSON.stringify(expected), JSON.stringify(difference(expected, actual)));
  assert.deepEqual(rows(dest), rows(source));
  const sequences = d => scalar(d, "SELECT jsonb_agg(to_jsonb(s) ORDER BY sequencename) FROM pg_sequences s WHERE schemaname='public';");
  assert.equal(sequences(dest), sequences(source));
  const proof = { source, restored: dest, file, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), catalog: 'identical', rows: 'identical', sequences: 'identical' };
  save(dest + '-proof', proof); return proof;
};
before(async () => {
  run(['run', '-d', '--rm', '--name', container, '--label', 'finance.disposable=sav08-release', '-e', 'POSTGRES_PASSWORD=local_test_only', 'postgres:16-alpine']); created = true;
  const i = JSON.parse(run(['inspect', container]).stdout)[0];
  assert.equal(i.Config.Labels['finance.disposable'], 'sav08-release');
  assert.equal(i.Config.Image, 'postgres:16-alpine'); assert.equal(Object.keys(i.HostConfig.PortBindings || {}).length, 0);
  for (let n = 0; n < 60; n++) { if (run(['exec', container, 'pg_isready', '-U', 'postgres'], undefined, true).status === 0) break; await new Promise(r => setTimeout(r, 200)); }
  sql('postgres', 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE DATABASE baseline_029; CREATE DATABASE clean_035;');
  sql('baseline_029', baseline); sql('baseline_029', grants);
  sql('clean_035', full); sql('clean_035', grants);
  save('target', { container, image: i.Config.Image, label: i.Config.Labels['finance.disposable'], publishedPorts: i.HostConfig.PortBindings });
  console.log('Release rehearsal evidence: ' + evidenceDir);
});
after(() => { if (created) run(['rm', '-f', container]); });

for (const reserve of [0, 500]) test(`029 → 035 with reserve ${reserve}: preservation, clean equivalence, overlap and recovery`, () => {
  const db = `upgrade_${reserve}`;
  sql('postgres', `CREATE DATABASE ${db} TEMPLATE baseline_029;`);
  sql(db, `INSERT INTO categories(id,name,type) VALUES(100,'ordinary','expense'),(101,'income','income');
INSERT INTO payment_sources(id,name,slug,method) VALUES(1,'local','local','bank_transfer');
INSERT INTO loans(id,name,original_amount,current_balance,total_installments,remaining_installments,calculation_mode) VALUES(1,'local loan',1000,1000,10,10,'loan_payments');
INSERT INTO transactions(id,description,total_amount,movement_type,transaction_date,charge_date,category_id,payment_source_id,external_id) VALUES(100,'imported ordinary',20,'expense','2020-01-02','2020-01-02',100,1,'release-import'),(101,'loan payment',100,'expense','2020-01-02','2020-01-02',100,1,'release-loan');
INSERT INTO loan_payments(loan_id,transaction_id,installment_number,payment_date,payment_amount,principal_amount,interest_amount,source_kind) VALUES(1,101,1,'2020-01-02',100,90,10,'manual');
SELECT setval(pg_get_serial_sequence('transactions','id'),101,true);`);
  const month = scalar(db, "SELECT to_char(date_trunc('month',timezone('Asia/Jerusalem',now()))-interval '1 month','YYYY-MM');");
  call(db, 'add_manual_budget_funding', [month, '500', 'synthetic history', key(10)]);
  call(db, 'establish_funded_budget', [month, '100', '500', 'manual', key(11)]);
  if (reserve) {
    call(db, 'set_budget_unused_balance_policy', ['100', 'savings']);
    const p = call(db, 'get_budget_month_disposition_preview', [month]);
    call(db, 'apply_budget_month_disposition', [month, key(12), p.fingerprint]);
  }
  const oldCatalog = catalog(db), oldRows = rows(db);
  const restored = `restored_029_${reserve}`; backupRestore(db, restored);
  const stages = [];
  for (const file of files) {
    const number = file.slice(0, 3);
    const pre = json(db, read(`docs/MIGRATION_${number}_PRODUCTION_PREFLIGHT.sql`));
    assert.equal(pre.result, `MIGRATION_${number}_PREFLIGHT_PASS`, JSON.stringify(pre));
    sql(db, read('server/migrations/' + file));
    const post = json(db, read(`docs/MIGRATION_${number}_PRODUCTION_POSTFLIGHT.sql`));
    assert.equal(post.result, `MIGRATION_${number}_POSTFLIGHT_PASS`, JSON.stringify(post));
    if (number === '030') {
      for (const field of ['financial_history', 'legacy_reserve', 'budget_state_fingerprint']) assert.deepEqual(post.evidence[field], pre.evidence[field]);
    } else assert.deepEqual(post.evidence, pre.evidence);
    stages.push({ migration: file, pre, post });
  }
  save(db + '-stages', stages);
  const finalCatalog = catalog(db), clean = catalog('clean_035');
  save('catalog-029', oldCatalog); save('catalog-035', finalCatalog); save('catalog-diff', difference(oldCatalog, finalCatalog));
  assert(JSON.stringify(finalCatalog) === JSON.stringify(clean), JSON.stringify(difference(clean, finalCatalog)));
  const delta = difference(oldCatalog, finalCatalog);
  assert.deepEqual(delta.relations.added.filter(n => finalCatalog.relations[n].kind === 'r').sort(), ['savings_accounts', 'savings_entries']);
  assert.deepEqual(delta.relations.added.filter(n => finalCatalog.relations[n].kind === 'v'), ['savings_account_summary']);
  assert.deepEqual(rows(db).loans, oldRows.loans); assert.deepEqual(rows(db).loan_payments, oldRows.loan_payments);
  for (const [signature, definition] of Object.entries(oldCatalog.functions).filter(([n]) => n.includes('loan'))) assert.deepEqual(finalCatalog.functions[signature], definition);
  assert.equal(scalar(db, 'SELECT count(*) FROM savings_accounts;'), '0');
  assert.equal(scalar(db, 'SELECT count(*) FROM savings_entries;'), '0');
  assert.equal(json(db, read('docs/SAVINGS_RELEASE_POSTFLIGHT.sql')).result, 'SAVINGS_RELEASE_POSTFLIGHT_PASS');
  assert.equal(scalar(db, 'SELECT balance_text FROM budget_savings_state;'), reserve ? '500.00' : '0.00');
  const cashBefore = rows(db).transactions;
  const a = call(db, 'create_savings_account', [key(20), { name: 'release rehearsal', opened_on: '2020-01-01', tracking_start_date: '2020-01-01', target_amount: '5000' }, '1200', reserve ? '300' : '0', reserve ? 'explicit synthetic overlap' : null]);
  assert.equal(a.summary.current_balance, '1200.00'); assert.equal(a.summary.target_remaining, '3800.00');
  assert.equal(scalar(db, 'SELECT balance_text FROM budget_savings_state;'), reserve ? '200.00' : '0.00');
  assert.deepEqual(rows(db).transactions, cashBefore);
  const untouchedReserve = rows(db).budget_savings_entries.filter(e => e.entry_kind !== 'account_opening_retirement');
  assert.deepEqual(untouchedReserve, oldRows.budget_savings_entries);
  // Failed overlap and archived/new activity leave the entire committed database unchanged.
  const beforeBad = rows(db);
  assert.notEqual(sql(db, `SET ROLE service_role; SELECT create_savings_account('${key(21)}','{"name":"invalid","opened_on":"2020-01-01","tracking_start_date":"2020-01-01"}','1200','9999','invalid overlap');`, true).status, 0);
  assert.deepEqual(rows(db), beforeBad);
  const account = call(db, 'get_savings_account', ['1']);
  call(db, 'update_savings_account', ['1', account.account.revision, key(22), { status: 'archived' }]);
  const archived = call(db, 'get_savings_account', ['1']);
  call(db, 'update_savings_account', ['1', archived.account.revision, key(23), { status: 'active', notes: 'restored', target_amount: '6000' }]);
  assert.equal(call(db, 'get_savings_account', ['1']).summary.current_balance, '1200.00');
  const today = scalar(db, "SELECT timezone('Asia/Jerusalem',statement_timestamp())::date;");
  const deposit = call(db, 'post_savings_event', [key(30), { action: 'create_cash', account_id: '1', expected_revision: call(db, 'get_savings_account', ['1']).account.revision,
    event_kind: 'deposit', amount: '25', effective_date: today, charge_date: today, description: 'post-backup cash', payment_source_id: '1',
    category_id: scalar(db, "SELECT id FROM categories WHERE savings_role='deposit';") }]);
  const linked = json(db, `SET ROLE service_role; SELECT row_json FROM transactions_filtered(p_transaction_id=>${deposit.transaction_id});`);
  call(db, 'cancel_savings_event', [key(31), linked.savings.entry_id, linked.savings.revision, 'void', 'audited recovery fixture']);
  // Rehearse recovery AFTER new Savings writes with a fresh complete backup.
  const afterWriteRestore = `restored_035_${reserve}`; backupRestore(db, afterWriteRestore);
  const finalAudit = json(afterWriteRestore, read('docs/SAVINGS_RELEASE_POSTFLIGHT.sql'));
  assert.equal(finalAudit.result, 'SAVINGS_RELEASE_POSTFLIGHT_PASS', JSON.stringify(finalAudit)); save(db + '-final-audit', finalAudit);
  assert.equal(finalAudit.evidence.voided_transactions, 1);
  assert.equal(scalar(afterWriteRestore, "SET ROLE service_role; SELECT (get_savings_report('2020-01-01','2099-12-31')->>'current_balance');"), '1200.00');
  // The old restore cannot preserve post-backup writes: demonstrate the limit, then
  // upgrade that restored branch and compare it BEFORE any new Savings writes.
  assert.equal(scalar(restored, "SELECT to_regclass('public.savings_accounts') IS NULL;"), 't');
  for (const file of files) sql(restored, read('server/migrations/' + file));
  assert.deepEqual(catalog(restored), finalCatalog);
  assert.equal(scalar(restored, 'SELECT count(*) FROM savings_accounts;'), '0');
  save(db + '-preservation', { priorTransactions: cashBefore.length, loanPayments: oldRows.loan_payments.length, reserveBefore: reserve, reserveAfter: reserve ? 200 : 0, opening: 1200, inventedCash: 0, cleanCatalogEqual: true, oldBackupLosesNewWrites: true });
});
