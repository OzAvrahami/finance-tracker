// Synthetic, portless PostgreSQL only. No dotenv or production connections.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { submitExternal } = require('./fixtures/unifiedTransactionIngestion057');
const { runBulk } = require('../services/externalTransactionBulk');
const container = `finance-unified-${process.pid}`;
const full = fs.readFileSync(path.join(__dirname, '../full_schema.sql'), 'utf8').split('-- Migration 054:')[0];
const migration = fs.readFileSync(path.join(__dirname, '../migrations/054_unified_transaction_ingestion.sql'), 'utf8');
const bankMigration = fs.readFileSync(path.join(__dirname, '../migrations/055_bank_account_payment_sources.sql'), 'utf8');
const bankExpenseMigration = fs.readFileSync(path.join(__dirname, '../migrations/056_external_bank_account_expenses.sql'), 'utf8');
const bankMovementsMigration = fs.readFileSync(path.join(__dirname, '../migrations/057_classified_bank_movements.sql'), 'utf8');
let started = false, sequence = 0;
const run = (args, input, allow = false) => {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60000, maxBuffer: 32e6 });
  if (!allow) assert.equal(r.status, 0, r.stderr || r.error?.message);
  return r;
};
const sql = (db, input, allow = false) => run(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq'], input, allow);
const scalar = (db, input) => sql(db, input).stdout.trim();
const json = (db, input) => JSON.parse(scalar(db, input));
const quote = v => v === null ? 'NULL' : `'${String(typeof v === 'object' ? JSON.stringify(v) : v).replaceAll("'", "''")}'`;
const call = (db, name, values) => json(db, `SET ROLE service_role; SELECT ${name}(${values.map(quote).join(',')});`);
const item = (key, extra = {}) => ({ type: 'expense', amount: 150, date: '2026-11-04', charge_date: '2026-11-04',
  description: 'Synthetic Shop', payment_source_id: 6, currency: 'ILS', external_id: key, ...extra });
const ingest = (db, body) => call(db, 'ingest_external_transaction', [body, false]);
const count = db => Number(scalar(db, 'SELECT count(*) FROM transactions WHERE voided_at IS NULL;'));
const createCase = () => { const db = `case_${++sequence}`; sql('postgres', `CREATE DATABASE ${db} TEMPLATE unified_clean;`); return db; };
const owned = (db, channel, key, extra = {}) => {
  const row = { description: 'Synthetic Shop', movement_type: 'expense', total_amount: 150, transaction_date: '2026-11-04',
    charge_date: '2026-11-04', payment_source_id: 6, currency: 'ILS', ...extra };
  return call(db, 'ingest_owned_transaction', [channel, key, row, row, null]);
};
const configure = db => call(db, 'configure_ingestion_source', [randomUUID(), { source_kind: 'apple_pay', instance_key: 'synthetic-wallet',
  configuration: { payment_source_ids: ['6'], time_verified: true, verified_references: [{ provider: 'synthetic', type: 'purchase', scope: 'fixture' }] }, actor: 'synthetic' }]).source_id;
const wallet = (db, sid, key, extra = {}) => call(db, 'ingest_observation', [sid, { idempotency_key: key, merchant: 'Synthetic Shop',
  accounting_amount: '150.00', currency: 'ILS', movement_type: 'expense', transaction_date: '2026-11-04', payment_source_id: '6', ...extra }]);
const asyncSql = (db, input) => new Promise((resolve, reject) => {
  const p = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq']);
  let out = '', err = ''; p.stdout.on('data', b => { out += b; }); p.stderr.on('data', b => { err += b; });
  p.on('error', reject); p.on('close', status => resolve({ status, out, err })); p.stdin.end(input);
});
const dbClient = db => ({ rpc: async (name, args) => {
  assert.equal(name, 'ingest_external_transaction');
  const r = await asyncSql(db, `SET ROLE service_role; SELECT ${name}(${quote(args.p_request)},${args.p_dry_run});`);
  return r.status ? { error: { code: '23514', message: r.err } } : { data: JSON.parse(r.out.trim()) };
} });
const sources = `INSERT INTO payment_sources(id,name,slug,method,issuer,last4) VALUES
 (6,'CAL 2755','cal-2755','debit_card','CAL','2755'),(7,'Other CAL','cal-other','credit_card','CAL','2002'),
 (8,'New MAX','max','credit_card','MAX','8888'),(9,'Bank account','bank','bank_transfer','Discount',NULL);
 INSERT INTO categories(id,name,type) VALUES(100,'Ordinary','expense'),(101,'Income','income');`;
before(async () => {
  run(['run', '-d', '--rm', '--name', container, '--label', 'finance.disposable=unified', '-e', 'POSTGRES_PASSWORD=local_test_only', 'postgres:16-alpine']); started = true;
  const info = JSON.parse(run(['inspect', container]).stdout)[0];
  assert.equal(info.Config.Labels['finance.disposable'], 'unified'); assert.deepEqual(info.HostConfig.PortBindings || {}, {});
  for (let i = 0; i < 60; i++) { if (run(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], undefined, true).status === 0) break; await new Promise(r => setTimeout(r, 200)); }
  sql('postgres', 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE DATABASE unified_clean; CREATE DATABASE unified_old;');
  sql('unified_old', full); sql('unified_old', sources);
  sql('unified_clean', full); sql('unified_clean', migration); sql('unified_clean', bankMigration); sql('unified_clean', bankExpenseMigration); sql('unified_clean', sources);
});
after(() => { if (started) run(['rm', '-f', container]); });

const createBank = db => Number(scalar(db, `INSERT INTO payment_sources(name,slug,method,issuer,last4,owner)
 VALUES('בנק דיסקונט - 5297','synthetic-discount','bank_account','Discount','5297','Synthetic owner') RETURNING id;`));
test('055 atomically extends methods, preserving IDs 8/9 and all existing payment sources and transactions', () => {
  const db = 'bank_upgrade'; sql('postgres', `CREATE DATABASE ${db};`);
  sql(db, full); sql(db, migration);
  sql(db, `INSERT INTO payment_sources(id,name,slug,method,is_active) VALUES
   (8,'Cash','cash','cash',true),(9,'Bank transfer','transfer','bank_transfer',false);
   INSERT INTO payment_sources(name,slug,method) SELECT method,method,method FROM unnest(ARRAY['credit_card','debit_card','digital_wallet','check']) method;
   INSERT INTO transactions(description,total_amount,movement_type,transaction_date,charge_date,payment_source_id)
    VALUES('Synthetic historical expense',25,'expense','2026-10-01','2026-10-01',8);`);
  const snapshot = () => scalar(db, `SELECT jsonb_build_array(
   (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM payment_sources p),
   (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM transactions t));`);
  const original = snapshot();
  assert.notEqual(sql(db, bankMigration.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;'), true).status, 0);
  assert.equal(snapshot(), original);
  assert.notEqual(sql(db, "INSERT INTO payment_sources(name,slug,method) VALUES('Reject','reject','bank_account');", true).status, 0);
  sql(db, bankMigration); assert.equal(snapshot(), original);
  const id = createBank(db); assert.notEqual(id, 8); assert.notEqual(id, 9);
  assert.deepEqual(json(db, `SELECT jsonb_build_object('name',name,'method',method,'issuer',issuer,'last4',last4) FROM payment_sources WHERE id=${id};`),
    { name: 'בנק דיסקונט - 5297', method: 'bank_account', issuer: 'Discount', last4: '5297' });
  sql(db, `UPDATE payment_sources SET owner='Edited owner',is_active=false WHERE id=${id};`);
  assert.equal(scalar(db, `SELECT is_active FROM payment_sources WHERE id=${id};`), 'f');
  assert.notEqual(sql(db, `UPDATE payment_sources SET method='invalid' WHERE id=${id};`, true).status, 0);
  assert.deepEqual(json(db, 'SELECT jsonb_object_agg(id,method) FROM payment_sources WHERE id IN (8,9);'), { 8: 'cash', 9: 'bank_transfer' });
});

test('bank-account CSV observations stay actionable and cannot post or bypass review', () => {
  for (const channel of ['csv']) {
    const db = createCase(), id = createBank(db);
    const send = (key, extra = {}) => channel === 'external'
      ? ingest(db, item(key, { payment_source_id: id, ...extra }))
      : owned(db, 'csv', key, { payment_source_id: id, ...extra });
    const first = send('bank-event');
    assert.equal(first.reason_code, 'bank_event_semantics_required');
    assert.equal(first.transaction_id, null); assert.equal(first.review_required, true);
    assert.equal(send('bank-event').replayed, true);
    assert.equal(send('bank-event', channel === 'external' ? { amount: 151 } : { total_amount: 151 }).reason_code, 'idempotency_key_conflict');
    const income = send('income', channel === 'external' ? { type: 'income' } : { movement_type: 'income' });
    assert.equal(income.reason_code, 'bank_event_semantics_required');
    const detail = call(db, 'read_reconciliation', ['observation', '{}', first.observation_id]);
    assert.equal(detail.can_separate, false);
    const command = { observation_id: first.observation_id,
      expected_revision: first.decision_revision, expected_candidate_fingerprints: detail.candidate_fingerprints,
      action: 'separate', actor: 'synthetic-owner', reason: 'Attempt cannot supply missing semantics' };
    const review = sql(db, `SET ROLE service_role; SELECT review_reconciliation(${quote(randomUUID())},${quote(command)});`, true);
    assert.notEqual(review.status, 0); assert.match(review.stderr, /evidence_correction_required/);
    assert.equal(count(db), 0);
    assert.equal(Number(scalar(db, 'SELECT count(*) FROM transaction_source_observations;')), 2);
    assert.match(detail.observation.payment_context, /bank_account.*5297/);
  }
});

test('bank-account manual entry uses the existing domain writer and inactive accounts cannot post externally', () => {
  const db = createCase(), id = createBank(db);
  assert.equal(owned(db, 'manual', 'manual-bank', { payment_source_id: id }).outcome, 'created');
  assert.equal(count(db), 1);
  sql(db, `UPDATE payment_sources SET is_active=false WHERE id=${id};`);
  assert.equal(ingest(db, item('inactive-bank', { payment_source_id: id })).reason_code, 'payment_source_not_found');
  assert.equal(count(db), 1);
});

test('056 changes only the external function atomically and preserves previously held evidence', () => {
  const db = 'expense_upgrade'; sql('postgres', `CREATE DATABASE ${db};`);
  sql(db, full); sql(db, migration); sql(db, bankMigration); sql(db, sources);
  const id = createBank(db), body = item('previously-held', { payment_source_id: id });
  assert.equal(ingest(db, body).reason_code, 'bank_event_semantics_required');
  const snapshot = () => scalar(db, `SELECT jsonb_build_array(
   (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM payment_sources p),
   (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM transactions t),
   (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM transaction_source_observations o),
   (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM transaction_reconciliation_events e));`);
  const definitions = () => json(db, `SELECT jsonb_object_agg(p.oid::regprocedure::text,
   jsonb_build_array(pg_get_functiondef(p.oid),p.proacl::text)) FROM pg_proc p
   JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f';`);
  const original = snapshot(), functions = definitions();
  assert.notEqual(sql(db, bankExpenseMigration.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;'), true).status, 0);
  assert.equal(snapshot(), original); assert.deepEqual(definitions(), functions);
  sql(db, bankExpenseMigration); assert.equal(snapshot(), original);
  const changed = definitions(), external = 'ingest_external_transaction(jsonb,boolean)';
  assert.notDeepEqual(changed[external], functions[external]);
  assert.equal(changed[external][1], functions[external][1]);
  delete changed[external]; delete functions[external]; assert.deepEqual(changed, functions);
  sql(db, bankExpenseMigration); assert.equal(snapshot(), original);
  const replay = ingest(db, body);
  assert.equal(replay.replayed, true); assert.equal(replay.reason_code, 'bank_event_semantics_required');
  assert.equal(replay.transaction_id, null);
  assert.equal(ingest(db, item('new-ordinary', { payment_source_id: id, amount: 23.45 })).outcome, 'created');
  assert.equal(count(db), 1);
});

test('ordinary expenses from multiple bank accounts post through the existing API and replay once', async () => {
  const db = createCase(), first = createBank(db);
  const second = Number(scalar(db, `INSERT INTO payment_sources(name,slug,method,issuer)
   VALUES('Synthetic other bank','other-bank','bank_account','Other') RETURNING id;`));
  for (const id of [first, second]) {
    const body = item(`bank-${id}`, { payment_source_id: id, amount: 23.45 });
    const created = await submitExternal(dbClient(db), body);
    assert.equal(created.status, 201); assert.equal(created.body.financial_posted, true);
    const replay = await submitExternal(dbClient(db), body);
    assert.equal(replay.status, 409); assert.equal(replay.body.error, 'already_exists');
    assert.equal(replay.body.id, created.body.id);
    const frozen = scalar(db, `SELECT to_jsonb(t) FROM transactions t WHERE id=${created.body.id};`);
    for (const extra of [{ amount: 23.46 }, { date: '2026-11-05' }, { payment_source_id: id === first ? second : first }]) {
      const conflict = ingest(db, { ...body, ...extra });
      assert.equal(conflict.outcome, 'conflict'); assert.equal(conflict.reason_code, 'idempotency_key_conflict');
      assert.equal(conflict.review_required, true);
      assert.equal(scalar(db, `SELECT to_jsonb(t) FROM transactions t WHERE id=${created.body.id};`), frozen);
    }
  }
  assert.equal(count(db), 2);
});

test('bank-account income, transfers, checks and unsupported expense evidence retain their holds', async () => {
  const db = createCase(), id = createBank(db);
  const check = Number(scalar(db, "INSERT INTO payment_sources(name,slug,method) VALUES('Synthetic check','check','check') RETURNING id;"));
  for (const [key, extra, reason] of [
    ['income', { payment_source_id: id, type: 'income' }, 'refund_semantics_required'],
    ['transfer', { payment_source_id: 9 }, 'bank_event_semantics_required'],
    ['check', { payment_source_id: check }, 'bank_event_semantics_required'],
    ['fx', { payment_source_id: id, currency: 'USD' }, 'original_amount_required'],
    ['installment', { payment_source_id: id, installment_number: 2, installment_count: 6 }, 'installment_series_required'],
    ['whole', { payment_source_id: id }, 'installment_series_review'],
  ]) {
    const held = ingest(db, item(key, extra));
    assert.equal(held.reason_code, reason); assert.equal(held.transaction_id, null); assert.equal(held.review_required, true);
  }
  for (const extra of [{ loan_id: 1 }, { amount: -10 }]) {
    assert.equal((await submitExternal(dbClient(db), item('unsupported', { payment_source_id: id, ...extra }))).status, 400);
  }
  assert.equal(count(db), 0);
});

test('bank-account unresolved payment sources, malformed identities and cross-source candidates cannot post', () => {
  const db = createCase(), id = createBank(db);
  sql(db, "INSERT INTO payment_sources(name,slug,method,last4) VALUES('Synthetic collision','collision','bank_account','5297');");
  for (const [key, extra, reason] of [
    ['missing', { payment_source_id: 999 }, 'payment_source_not_found'],
    ['unspecified', { payment_source_id: undefined }, 'payment_source_not_found'],
    ['ambiguous', { payment_source_id: undefined, payment_source_name: '5297' }, 'payment_source_ambiguous'],
    [' invalid ', { payment_source_id: id }, 'invalid_external_id'],
  ]) assert.equal(ingest(db, item(key, extra)).reason_code, reason);
  assert.equal(count(db), 0);
  assert.equal(owned(db, 'manual', 'historical-bank', { payment_source_id: id }).outcome, 'created');
  const candidate = ingest(db, item('potential-duplicate', { payment_source_id: id }));
  assert.equal(candidate.reason_code, 'competing_candidates'); assert.equal(candidate.review_required, true);
  assert.equal(candidate.transaction_id, null); assert.equal(count(db), 1);
});

test('056 full schema parity, posting protections and function privilege boundaries remain intact', () => {
  const db = 'bank_fresh'; sql('postgres', `CREATE DATABASE ${db};`);
  sql(db, fs.readFileSync(path.join(__dirname, '../full_schema.sql'), 'utf8').split('-- Migration 057:')[0]);
  const definitions = database => scalar(database, `SELECT jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,
   replace(pg_get_functiondef(p.oid),chr(13),''),p.prosecdef,p.proacl::text) ORDER BY p.proname)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
   AND p.proname IN ('ingest_external_transaction','ingest_owned_transaction','unified_ingest','unified_external_guard');`);
  assert.equal(definitions(db), definitions('unified_clean'));
  for (const name of ['ingest_external_transaction(jsonb,boolean)', 'ingest_owned_transaction(text,text,jsonb,jsonb,jsonb)']) {
    for (const role of ['anon', 'authenticated']) assert.equal(scalar(db, `SELECT has_function_privilege('${role}','${name}','EXECUTE');`), 'f');
    assert.equal(scalar(db, `SELECT has_function_privilege('service_role','${name}','EXECUTE');`), 't');
  }
  assert.equal(scalar(db, "SELECT relrowsecurity FROM pg_class WHERE oid='public.payment_sources'::regclass;"), 't');
  assert.ok(fs.readFileSync(path.join(__dirname, '../full_schema.sql'), 'utf8').split('-- Migration 057:')[0].trim().replaceAll('\r\n', '\n').endsWith(bankExpenseMigration.trim().replaceAll('\r\n', '\n')));
});

test('all card issuers use existing payment source records; bank events are retained without guessed cash', () => {
  const db = createCase();
  for (const id of [6, 7, 8]) assert.equal(ingest(db, item(`card-${id}`, { payment_source_id: id })).outcome, 'created');
  const bank = ingest(db, item('bank', { payment_source_id: 9 }));
  assert.equal(bank.reason_code, 'bank_event_semantics_required'); assert.equal(bank.transaction_id, null); assert.equal(count(db), 3);
});
test('exact replay, changed content and two distinct identical-looking provider purchases', () => {
  const db = createCase(), first = ingest(db, item('one'));
  assert.equal(ingest(db, item('one')).transaction_id, first.transaction_id);
  assert.equal(ingest(db, item('one')).replayed, true);
  assert.equal(ingest(db, item('one', { amount: 151 })).reason_code, 'idempotency_key_conflict');
  assert.equal(ingest(db, item('two')).outcome, 'created'); assert.equal(count(db), 2);
});
test('foreign purchase retains charged ILS amount and original currency without inventing exchange rate', () => {
  const db = createCase(), r = ingest(db, item('fx', { amount: 275.82, original_amount: 87, currency: 'USD' }));
  assert.equal(r.outcome, 'created');
  assert.deepEqual(json(db, `SELECT jsonb_build_object('amount',total_amount::text,'original',original_amount::text,'currency',currency,'rate',exchange_rate) FROM transactions WHERE id=${r.transaction_id};`),
    { amount: '275.8200000000000000', original: '87', currency: 'USD', rate: null });
});
test('individual installment holds series evidence; owner-confirmed separate posts only that ordinal', () => {
  const db = createCase(), r = ingest(db, item('part-2', { installment_number: 2, installment_count: 6 }));
  assert.equal(r.reason_code, 'installment_series_required'); assert.equal(count(db), 0);
  const d = call(db, 'read_reconciliation', ['observation', '{}', r.observation_id]);
  const resolved = call(db, 'review_reconciliation', [randomUUID(), { observation_id: r.observation_id, expected_revision: r.decision_revision,
    expected_candidate_fingerprints: d.candidate_fingerprints, action: 'separate', actor: 'synthetic-owner', reason: 'Independent observed installment confirmed' }]);
  assert.equal(resolved.outcome, 'created'); assert.equal(count(db), 1);
  assert.deepEqual(json(db, 'SELECT jsonb_build_object(\'n\',installment_number,\'count\',installment_count,\'parent\',parent_transaction_id) FROM transactions;'), { n: 2, count: 6, parent: null });
  assert.equal(ingest(db, item('whole', { amount: 900 })).transaction_id, null); assert.equal(count(db), 1);
});
test('Wallet first and API first both retain weak matches for review with no second cash', () => {
  for (const order of ['wallet', 'api']) {
    const db = createCase(), sid = configure(db);
    const a = () => wallet(db, sid, 'wallet-key'), b = () => ingest(db, item('bank-key'));
    (order === 'wallet' ? a : b)(); const held = (order === 'wallet' ? b : a)();
    assert.equal(held.transaction_id, null); assert.equal(held.review_required, true); assert.equal(count(db), 1);
  }
});
test('manual and CSV participate in both arrival orders, preserving separate identical rows in one file', () => {
  for (const channel of ['manual', 'csv']) for (const first of [true, false]) {
    const db = createCase(), a = () => owned(db, channel, 'csv:document:0'), b = () => ingest(db, item('api'));
    (first ? a : b)(); const held = (first ? b : a)(); assert.equal(held.transaction_id, null); assert.equal(count(db), 1);
  }
  const db = createCase(); owned(db, 'csv', 'csv:document:0'); owned(db, 'csv', 'csv:document:1'); assert.equal(count(db), 2);
  assert.equal(owned(db, 'csv', 'csv:document:0').replayed, true);
});
test('user edits remain untouched and cancellation reserves an external identity', () => {
  const db = createCase(), r = ingest(db, item('edited'));
  sql(db, `UPDATE transactions SET description='Owner title',total_amount=151,notes='Owner note' WHERE id=${r.transaction_id};`);
  assert.equal(ingest(db, item('edited')).transaction_id, r.transaction_id);
  assert.equal(scalar(db, `SELECT description||':'||notes||':'||total_amount::text FROM transactions WHERE id=${r.transaction_id};`), 'Owner title:Owner note:151');
  call(db, 'delete_transaction_with_loan_payment', [r.transaction_id]);
  assert.equal(ingest(db, item('edited')).disposition, 'cancelled'); assert.equal(count(db), 0);
});
test('real concurrent deliveries serialize identity and preserve one financial posting', async () => {
  const db = createCase(), input = `SET ROLE service_role; SELECT ingest_external_transaction(${quote(item('race'))},false);`;
  const results = await Promise.all([asyncSql(db, input), asyncSql(db, input)]);
  for (const r of results) assert.equal(r.status, 0, r.err);
  assert.equal(count(db), 1); assert.deepEqual(results.map(r => JSON.parse(r.out).replayed).sort(), [false, true]);
});

test('a lost response after commit recovers through the same frozen external identity', async () => {
  const db = createCase(), body = item('lost-response');
  const lost = await submitExternal({ rpc: async () => { ingest(db, body); throw new Error('synthetic transport loss'); } }, body);
  assert.equal(lost.status, 503); assert.equal(lost.body.commit_state, 'unknown');
  const recovered = await submitExternal(dbClient(db), body);
  assert.equal(recovered.status, 409); assert.equal(recovered.body.error, 'already_exists'); assert.equal(count(db), 1);
});

test('independently verified references can link, while a changed amount conflicts', () => {
  const db = createCase(), a = configure(db);
  const b = call(db, 'configure_ingestion_source', [randomUUID(), { source_kind: 'cal', instance_key: 'synthetic-evidence',
    configuration: { payment_source_ids: ['6'], verified_references: [{ provider: 'synthetic', type: 'purchase', scope: 'fixture' }] }, actor: 'synthetic' }]).source_id;
  const proof = { provider_reference: { provider: 'synthetic', type: 'purchase', scope: 'fixture', value: 'independent-reference' } };
  wallet(db, a, 'wallet', proof);
  assert.equal(wallet(db, b, 'bank', proof).outcome, 'reconciled');
  assert.equal(wallet(db, b, 'changed', { ...proof, accounting_amount: '151.00' }).outcome, 'conflict');
  assert.equal(count(db), 1);
});

test('mapping, refunds, incomplete FX and dry-run cannot manufacture accounting evidence', () => {
  const db = createCase();
  assert.equal(ingest(db, item('name', { payment_source_id: undefined, payment_source_name: 'New MAX' })).outcome, 'created');
  assert.equal(ingest(db, item('missing', { payment_source_id: 999 })).reason_code, 'payment_source_not_found');
  assert.equal(ingest(db, item('refund', { type: 'income' })).reason_code, 'refund_semantics_required');
  const fx = ingest(db, item('missing-fx', { currency: 'USD' }));
  assert.equal(fx.reason_code, 'original_amount_required');
  assert.equal(owned(db, 'csv', 'csv:fx:0', { currency: 'USD' }).reason_code, 'original_amount_required');
  const detail = call(db, 'read_reconciliation', ['observation', '{}', fx.observation_id]);
  assert.equal(detail.can_separate, false);
  const before = scalar(db, 'SELECT count(*) FROM transaction_source_observations;');
  assert.equal(call(db, 'ingest_external_transaction', [item('dry'), true]).dry_run, true);
  assert.equal(scalar(db, 'SELECT count(*) FROM transaction_source_observations;'), before);
  assert.equal(count(db), 1);
});

test('manual separate approval resumes the original domain command rather than posting generic cash', () => {
  const db = createCase(); ingest(db, item('bank-first'));
  const held = owned(db, 'manual', 'draft');
  const detail = call(db, 'read_reconciliation', ['observation', '{}', held.observation_id]);
  const command = { observation_id: held.observation_id, expected_revision: held.decision_revision,
    expected_candidate_fingerprints: detail.candidate_fingerprints, action: 'separate', actor: 'synthetic-owner', reason: 'Separate purchase verified' };
  const approved = call(db, 'review_reconciliation', [randomUUID(), command]);
  assert.equal(approved.reason_code, 'manual_domain_approved'); assert.equal(count(db), 1);
  const resumed = owned(db, 'manual', 'new-http-request');
  assert.equal(resumed.observation_id, held.observation_id); assert.equal(resumed.outcome, 'created'); assert.equal(count(db), 2);
});

test('manual loan accounting and cancellation remain atomic through the shared decision', () => {
  const db = createCase();
  sql(db, "INSERT INTO loans(id,name,original_amount,current_balance,monthly_payment,total_installments,remaining_installments,start_date,next_payment_date,calculation_mode,payment_source_id) VALUES(1,'Synthetic loan',1000,1000,150,10,10,'2026-11-04','2026-11-04','loan_payments',9);");
  const row = { description: 'Loan payment', movement_type: 'expense', total_amount: 150, transaction_date: '2026-11-04', charge_date: '2026-11-04', payment_source_id: 9, loan_id: 1, currency: 'ILS' };
  const r = call(db, 'ingest_owned_transaction', ['manual', 'loan', row, row, { loan_payment: { principal_amount: 140, interest_amount: 10, other_amount: 0, next_scheduled_due_date: '2026-12-04' } }]);
  assert.equal(r.outcome, 'created'); assert.ok(r.accounting.loanPayment);
  assert.equal(scalar(db, 'SELECT count(*) FROM loan_payments;'), '1');
  call(db, 'delete_transaction_with_loan_payment', [r.transaction_id]);
  assert.equal(count(db), 0); assert.equal(scalar(db, 'SELECT count(*) FROM loan_payments;'), '0');
  assert.equal(call(db, 'ingest_owned_transaction', ['manual', 'loan', row, row, null]).disposition, 'cancelled');
});
test('8 successful / 2 failed summary and 50-item batches use the real database', async () => {
  const db = createCase(), send = async body => {
    const res = { status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; } };
    await runBulk({ body }, res, async (req, out) => { const r = await submitExternal(dbClient(db), req.body); out.status(r.status).json(r.body); });
    return res;
  };
  sql(db, bankMovementsMigration);
  const ten = Array.from({ length: 10 }, (_, i) => item(`ten-${i}`, i > 7 ? { amount: -1 } : {}));
  const r = await send({ items: ten }); assert.equal(r.body.succeeded, 8); assert.equal(r.body.failed, 2); assert.equal(count(db), 8);
  const fifty = await send({ items: Array.from({ length: 50 }, (_, i) => item(`fifty-${i}`)) });
  assert.equal(fifty.body.succeeded, 50); assert.equal(count(db), 58);
});
test('generic guard blocks direct external inserts; private core is inaccessible to callers', () => {
  const db = createCase();
  const direct = sql(db, "INSERT INTO transactions(description,total_amount,movement_type,transaction_date,charge_date,payment_source_id,external_id) VALUES('Direct',10,'expense','2026-11-04','2026-11-04',6,'bypass');", true);
  assert.notEqual(direct.status, 0); assert.match(direct.stderr, /unified_ingestion_required/);
  assert.equal(scalar(db, "SELECT has_function_privilege('service_role','unified_ingest(bigint,jsonb,jsonb,jsonb,text,jsonb)','EXECUTE');"), 'f');
  assert.equal(scalar(db, "SELECT has_function_privilege('anon','ingest_external_transaction(jsonb,boolean)','EXECUTE');"), 'f');
});
test('forward upgrade preserves 38 CAL receipts and history byte-for-byte; rollback restores guards', () => {
  const db = 'unified_old';
  sql(db, "INSERT INTO transaction_ingestion_sources(id,source_kind,instance_key,configuration) VALUES(3,'cal','v1-cal:fdb-cal-default-debit','{\"payment_source_ids\":[\"6\"]}');");
  for (let i = 0; i < 38; i++) {
    const r = wallet(db, '3', `historical-${i}`, { accounting_amount: String(10 + i) });
    sql(db, `INSERT INTO cal_ingestion_receipts(external_id,source_id,observation_id,request_hash,creation_fields) VALUES('historical-${i}',3,${r.observation_id},repeat('a',64),'{}');`);
  }
  const snapshot = () => scalar(db, "SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(t)-'bank_movement' ORDER BY id) FROM transactions t),(SELECT jsonb_agg(to_jsonb(r) ORDER BY external_id) FROM cal_ingestion_receipts r),(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM transaction_source_observations o),(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM transaction_reconciliation_events e))::text;");
  const original = snapshot();
  assert.notEqual(sql(db, migration.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;'), true).status, 0);
  assert.equal(snapshot(), original);
  assert.equal(scalar(db, "SELECT count(*) FROM pg_trigger WHERE tgname='cal_external_identity';"), '1');
  sql(db, migration); assert.equal(snapshot(), original);
  sql(db, bankMigration); assert.equal(snapshot(), original);
  sql(db, bankExpenseMigration); assert.equal(snapshot(), original);
  sql(db, bankMovementsMigration); assert.equal(snapshot(), original);
  assert.equal(scalar(db, 'SELECT count(*) FROM transactions WHERE bank_movement IS NOT NULL;'), '0');
  const r = ingest(db, item('historical-0')); assert.equal(r.reason_code, 'historical_identity_reserved'); assert.equal(count(db), 38);
});

test('057 classified bank movements preserve all fourteen independent operations and ordinary-income totals', async () => {
  const db=createCase();sql(db,bankMovementsMigration);
  sql(db,"INSERT INTO payment_sources(id,name,slug,method) VALUES(14,'Invented bank','acceptance-bank','bank_account');");
  const expenses=[[1481,1523],[1488,4.5],[1493,0.68],[1501,149]], incomes=[[1508,276],[1510,500],[1514,150],[1515,3100],[1516,290.95]], refunds=[[1486,1523],[1491,4.5],[1490,0.68],[1505,149],[1489,797.2]];
  // Acceptance numbers are synthetic test data only. No production record is read.
  sql(db,"INSERT INTO transactions(id,description,movement_type,total_amount,transaction_date,charge_date,payment_source_id) VALUES(4454,'Invented historical interest','expense',797.20,'2026-10-01','2026-10-01',9);");
  const original=scalar(db,'SELECT to_jsonb(t) FROM transactions t WHERE id=4454;');
  const bodies=[...expenses.map(([id,amount])=>item(`bank:account:date:${id}`,{type:'expense',amount})),...incomes.map(([id,amount])=>item(`bank:account:date:${id}`,{type:'income',amount})),...refunds.map(([id,amount])=>item(`bank:account:date:${id}`,{type:'refund',amount}))].map(v=>({...v,payment_source_id:14}));
  const send=async()=>{const res={status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};
    await runBulk({body:{items:bodies}},res,async(req,out)=>{const r=await submitExternal(dbClient(db),req.body);out.status(r.status).json(r.body);});return res;};
  const first=await send();assert.equal(first.statusCode,200);assert.equal(first.body.succeeded,14);assert.equal(first.body.created,14);assert.equal(first.body.review_required,0);
  assert.equal(count(db),15);
  const replay=await send();assert.equal(replay.body.succeeded,14);assert.equal(replay.body.already_exists,14);assert.equal(replay.body.created,0);
  assert.equal(count(db),15);assert.equal(scalar(db,'SELECT to_jsonb(t) FROM transactions t WHERE id=4454;'),original);
  const totals=json(db,"SELECT dashboard_summary('2026-11-01','2026-11-30');");
  assert.equal(Number(totals.income),4316.95);assert.equal(Number(totals.expenses),-797.2);assert.equal(Number(totals.balance),5114.15);
  assert.equal(scalar(db,"SELECT sum(total_amount) FROM transactions WHERE external_id IN ('bank:account:date:1481','bank:account:date:1486','bank:account:date:1488','bank:account:date:1491','bank:account:date:1493','bank:account:date:1490','bank:account:date:1501','bank:account:date:1505');"),'0.00000000000000000000');
  assert.equal(Number(scalar(db,"SELECT count(*) FROM transactions WHERE bank_movement='refund' AND movement_type='expense' AND total_amount<0 AND parent_transaction_id IS NULL;")),5);
  assert.equal(Number(scalar(db,"SELECT count(*) FROM transaction_source_observations WHERE accepted_payload#>>'{_request,type}'='refund' AND (accepted_payload#>>'{_request,amount}')::numeric>0 AND amount_minor<0;")),5);
  const posted = json(db, "SELECT jsonb_object_agg(external_id,jsonb_build_object('type',movement_type,'amount',total_amount,'bank_movement',bank_movement)) FROM transactions WHERE external_id IS NOT NULL;");
  for (const body of bodies) assert.deepEqual(posted[body.external_id], { type: body.type === 'refund' ? 'expense' : body.type,
    amount: body.type === 'refund' ? -body.amount : body.amount, bank_movement: body.type === 'refund' ? 'refund' : null });
  assert.equal(Number(scalar(db, "SELECT sum(total_amount) FROM budget_actual_transactions('2026-11-01','2026-11-30');")), -797.2);
  const refundId = scalar(db, "SELECT id FROM transactions WHERE bank_movement='refund' ORDER BY id LIMIT 1;");
  assert.equal(scalar(db, `SELECT row_json->>'transaction_fingerprint' FROM transactions_filtered(p_transaction_id=>${refundId});`),
    scalar(db, `SELECT md5((to_jsonb(t)-ARRAY['updated_at','voided_at','void_request_key','void_fingerprint','void_reason'])::text) FROM transactions t WHERE id=${refundId};`));
  assert.equal(ingest(db,{...bodies[0],type:'refund'}).reason_code,'idempotency_key_conflict');
  const future=item('unlisted-future-credit',{type:'income',payment_source_id:14,amount:43.21});
  assert.equal(ingest(db,future).outcome,'created');assert.equal(ingest(db,{...future,external_id:'distinct-equal-credit'}).outcome,'created');
  assert.equal(ingest(db,{...future,type:'refund',external_id:'unlisted-future-refund'}).outcome,'created');
});

test('057 credits do not bypass nonbank, unknown-source, identity, installment or cross-source guards', () => {
  const db=createCase();sql(db,bankMovementsMigration);const bank=createBank(db);
  const checkSource=Number(scalar(db,"INSERT INTO payment_sources(name,slug,method) VALUES('Invented check','check-guard','check') RETURNING id;"));
  for(const type of ['income','refund']){
    for(const id of [6,7,8,9,checkSource]){const r=ingest(db,item(`${type}-${id}`,{type,payment_source_id:id}));assert.equal(r.transaction_id,null);assert.equal(r.review_required,true);}
    assert.equal(ingest(db,item(`no-key-${type}`,{type,payment_source_id:bank,external_id:undefined})).reason_code,'identity_evidence_required');
    assert.equal(ingest(db,item(`missing-${type}`,{type,payment_source_id:999999})).reason_code,'payment_source_not_found');
    assert.equal(ingest(db,item(`part-${type}`,{type,payment_source_id:bank,installment_number:1,installment_count:2})).outcome,'rejected');
  }
  assert.equal(ingest(db,item('unknown',{type:'unknown',payment_source_id:bank})).outcome,'rejected');
  const sid=configure(db);
  assert.equal(wallet(db,sid,'spoof-refund',{accounting_amount:'-25.00',source_metadata:{bank_movement:'refund'}}).reason_code,'refund_source_unsupported');
  assert.equal(count(db),0);
  sql(db,`INSERT INTO transactions(description,movement_type,total_amount,transaction_date,charge_date,payment_source_id) VALUES('Unverified old refund','expense',-25,'2026-11-04','2026-11-04',${bank});`);
  assert.equal(ingest(db,item('competing',{type:'refund',amount:25,payment_source_id:bank})).review_required,true);
  assert.equal(count(db),1);
});

test('refund metadata edit preserves classification, signed cash and immutable ingestion evidence on reload', () => {
  const db = createCase(); sql(db, bankMovementsMigration);
  const bank = createBank(db);
  const date = scalar(db, "SELECT timezone('Asia/Jerusalem',statement_timestamp())::date;");
  const body = item('synthetic-refund-edit', { type: 'refund', amount: 149,
    payment_source_id: bank, date, charge_date: date });
  const first = ingest(db, body);
  assert.equal(first.outcome, 'created');
  const id = first.transaction_id;
  const evidence = () => scalar(db, `SELECT jsonb_build_array(
    (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM transaction_source_observations o),
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM cal_ingestion_receipts r),
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM transaction_api_receipts r));`);
  const before = evidence();
  const edit = { description: 'Reviewed refund', movement_type: 'expense', total_amount: -149,
    payment_source_id: bank, transaction_date: date, charge_date: date, category_id: 100,
    currency: 'ILS', notes: 'Reviewed metadata', installment_count: null };
  call(db, 'update_transaction_with_manual_loan_payment', [id, edit, null]);
  const row = json(db, `SELECT row_json FROM transactions_filtered(p_transaction_id=>${id});`);
  assert.equal(Number(row.total_amount), -149);
  assert.equal(row.bank_movement, 'refund');
  assert.equal(row.movement_type, 'expense');
  assert.equal(Number(row.payment_source_id), bank);
  assert.equal(Number(row.category_id), 100);
  assert.equal(row.notes, 'Reviewed metadata');
  assert.equal(row.installment_count, null);
  assert.equal(row.external_id, body.external_id);
  assert.equal(evidence(), before);
  const replay = ingest(db, body);
  assert.equal(replay.replayed, true);
  assert.equal(replay.transaction_id, id);
  assert.equal(count(db), 1);
  assert.equal(scalar(db, `SELECT total_amount::numeric(14,2) FROM transactions WHERE id=${id};`), '-149.00');
  for (const invalid of [{ ...edit, movement_type: 'income' }, { ...edit, total_amount: 149 }]) {
    assert.notEqual(sql(db, `SET ROLE service_role; SELECT update_transaction_with_manual_loan_payment(${id},${quote(invalid)},NULL);`, true).status, 0);
  }
  assert.equal(evidence(), before);
  assert.equal(scalar(db, `SELECT bank_movement||':'||movement_type||':'||total_amount::numeric(14,2) FROM transactions WHERE id=${id};`), 'refund:expense:-149.00');
});

test('057 migration rollback/repeat preserves old cash and evidence; fresh schema agrees',()=>{
  const db=createCase();ingest(db,item('unchanged-cal'));
  const before=()=>scalar(db,"SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(t)-'bank_movement' ORDER BY id) FROM transactions t),(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM transaction_source_observations o),(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM transaction_reconciliation_events e));");
  const cashFingerprint=scalar(db,"SELECT apy_cash_fingerprint(id) FROM transactions WHERE external_id='unchanged-cal';");
  const original=before();assert.notEqual(sql(db,bankMovementsMigration.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;'),true).status,0);assert.equal(before(),original);
  sql(db,bankMovementsMigration);sql(db,bankMovementsMigration);assert.equal(before(),original);
  assert.equal(scalar(db,"SELECT apy_cash_fingerprint(id) FROM transactions WHERE external_id='unchanged-cal';"),cashFingerprint);
  assert.equal(ingest(db,item('unchanged-cal')).replayed,true);
  sql('postgres','CREATE DATABASE movements_fresh;');sql('movements_fresh',fs.readFileSync(path.join(__dirname,'../full_schema.sql'),'utf8').split('-- Migration 058:')[0]);
  const definitions=d=>scalar(d,"SELECT jsonb_agg(jsonb_build_array(p.proname,replace(pg_get_functiondef(p.oid),chr(13),''),p.proacl::text) ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('apy_identity','apy_cash_fingerprint','apy_review_fingerprints','apy_normalize','apy_create_cash','unified_ingest','ingest_external_transaction','transactions_filtered','savings_post_event_locked','get_savings_surplus_preview','savings_apply_surplus_locked');");
  assert.equal(definitions(db),definitions('movements_fresh'));
  assert.equal(scalar(db,"SELECT has_function_privilege('service_role','unified_ingest(bigint,jsonb,jsonb,jsonb,text,jsonb)','EXECUTE');"),'f');
});

test('057 preserves every legacy row fingerprint and the Dashboard, Budget, Savings and Loan read models', () => {
  const db = createCase(), bank = createBank(db);
  const date = scalar(db, "SELECT timezone('Asia/Jerusalem',statement_timestamp())::date;");
  const month = date.slice(0, 7);
  const cal = ingest(db, item('legacy-cal', { date, charge_date: date, category_id: 100 }));
  const cancelled = ingest(db, item('legacy-cancelled', { date, charge_date: date, amount: 18, category_id: 100 }));
  assert.equal(cancelled.outcome, 'created');
  call(db, 'delete_transaction_with_loan_payment', [cancelled.transaction_id]);
  const discount = ingest(db, item('legacy-discount', { date, charge_date: date, payment_source_id: bank, amount: 27, category_id: 100 }));
  const held = owned(db, 'csv', 'csv:legacy:0', { transaction_date: date, charge_date: date, category_id: 100 });
  assert.equal(held.review_required, true);
  sql(db, `INSERT INTO transactions(description,movement_type,total_amount,transaction_date,charge_date,payment_source_id,category_id,currency,original_amount,exchange_rate,notes,installment_number,installment_count,voided_at)
   VALUES ('Legacy income','income',5000,'${date}','${date}',9,101,'ILS',NULL,NULL,NULL,NULL,NULL,NULL),
    ('Legacy FX','expense',275.82,'${date}','${date}',6,100,'USD',87,NULL,'Owner note',NULL,NULL,NULL),
    ('Legacy installment','expense',30,'${date}','${date}',6,100,'ILS',NULL,NULL,NULL,2,6,NULL),
    ('Legacy negative','expense',-3,'${date}','${date}',9,100,'ILS',NULL,NULL,NULL,NULL,NULL,NULL);
   INSERT INTO loans(id,name,original_amount,current_balance,monthly_payment,total_installments,remaining_installments,start_date,next_payment_date,calculation_mode,payment_source_id)
    VALUES(1,'Synthetic loan',1000,1000,150,10,10,'${date}','${date}','loan_payments',9);`);
  const loanRow = { description: 'Loan payment', movement_type: 'expense', total_amount: 150,
    transaction_date: date, charge_date: date, payment_source_id: 9, category_id: 100, loan_id: 1, currency: 'ILS' };
  const loan = call(db, 'ingest_owned_transaction', ['manual', 'legacy-loan', loanRow, loanRow,
    { loan_payment: { principal_amount: 140, interest_amount: 10, other_amount: 0,
      next_scheduled_due_date: scalar(db, `SELECT ('${date}'::date+interval '1 month')::date;`) } }]);
  assert.equal(loan.outcome, 'created');
  call(db, 'create_savings_account', [randomUUID(), { name: 'Synthetic Savings', opened_on: '2020-01-01', tracking_start_date: '2020-01-01' }, '0', '0', null]);
  const savings = () => call(db, 'get_savings_account', ['1']);
  const deposit = { action: 'create_cash', account_id: '1', expected_revision: savings().account.revision, event_kind: 'deposit', amount: '75',
    effective_date: date, charge_date: date, description: 'Synthetic deposit', payment_source_id: '9',
    category_id: scalar(db, "SELECT id FROM categories WHERE savings_role='deposit';") };
  call(db, 'post_savings_event', [randomUUID(), deposit]);
  const fingerprints = () => json(db, `SELECT jsonb_object_agg(t.id,jsonb_build_object(
   'filtered',(SELECT row_json->>'transaction_fingerprint' FROM transactions_filtered(p_transaction_id=>t.id)),
   'cash',apy_cash_fingerprint(t.id),'identity',apy_identity(t))) FROM transactions t;`);
  const financial = () => json(db, `SELECT jsonb_build_object(
   'rows',(SELECT jsonb_agg(to_jsonb(t)-'bank_movement' ORDER BY id) FROM transactions t),
   'observations',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM transaction_source_observations o),
   'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM transaction_reconciliation_events e),
   'loans',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM loans l),
   'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM loan_payments p),
   'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM savings_entries e));`);
  const access = () => scalar(db, "SELECT jsonb_agg(jsonb_build_array(oid::regprocedure::text,proowner,proacl,prosecdef,proconfig) ORDER BY oid::regprocedure::text) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('transactions_filtered','savings_post_event_locked','get_savings_surplus_preview','savings_apply_surplus_locked');");
  const readModels = () => ({ dashboard: json(db, `SELECT dashboard_summary('${month}-01','${date}');`),
    budget: call(db, 'get_funded_budget_month', [month]), savings: savings(),
    review: call(db, 'read_reconciliation', ['observation', '{}', held.observation_id]) });
  const before = { fingerprints: fingerprints(), financial: financial(), readers: readModels(), access: access() };
  assert.ok(Object.keys(before.fingerprints).length >= 9);
  // Reproduce the original 057 defect before installing its corrected reader definitions.
  const compatibilityMarker = '-- The nullable marker must not invalidate';
  assert.ok(bankMovementsMigration.includes(compatibilityMarker));
  sql(db, bankMovementsMigration.split(compatibilityMarker)[0] + 'COMMIT;');
  assert.notEqual(fingerprints()[cal.transaction_id].filtered, before.fingerprints[cal.transaction_id].filtered);
  assert.deepEqual(financial(), before.financial);
  sql(db, bankMovementsMigration);
  assert.deepEqual(fingerprints(), before.fingerprints);
  assert.deepEqual(financial(), before.financial);
  assert.deepEqual(readModels(), before.readers);
  assert.equal(access(), before.access);
  assert.equal(ingest(db, item('legacy-cal', { date, charge_date: date, category_id: 100 })).transaction_id, cal.transaction_id);
  assert.equal(ingest(db, item('legacy-discount', { date, charge_date: date, payment_source_id: bank, amount: 27, category_id: 100 })).transaction_id, discount.transaction_id);
  // A pre-upgrade owner preview remains valid for the Savings writer, not only its reader.
  call(db, 'post_savings_event', [randomUUID(), { ...deposit, action: 'link_cash', expected_revision: savings().account.revision,
    transaction_id: String(cal.transaction_id), amount: '150.00', payment_source_id: '6',
    expected_transaction_fingerprint: before.fingerprints[cal.transaction_id].filtered }]);
  assert.equal(savings().summary.current_balance, '225.00');
  call(db, 'delete_transaction_with_loan_payment', [loan.transaction_id]);
  assert.equal(scalar(db, 'SELECT count(*) FROM loan_payments;'), '0');
});

test('057 preserves funded Savings preview and reversal fingerprints across upgrade', () => {
  for (const alreadyPosted of [false, true]) {
    const db = createCase();
    const date = scalar(db, "SELECT timezone('Asia/Jerusalem',statement_timestamp())::date;"), month = date.slice(0, 7);
    call(db, 'create_savings_account', [randomUUID(), { name: 'Synthetic surplus', opened_on: '2020-01-01', tracking_start_date: '2020-01-01' }, '0', '0', null]);
    call(db, 'add_manual_budget_funding', [month, '1000', 'Synthetic funds', randomUUID()]);
    call(db, 'establish_funded_budget', [month, '100', '1000', 'manual', randomUUID()]);
    sql(db, `INSERT INTO transactions(description,total_amount,movement_type,transaction_date,charge_date,category_id,payment_source_id)
      VALUES('Synthetic expense',700,'expense','${date}','${date}',100,9);`);
    const command = { source_month: month, category_id: '100', account_id: '1', amount: '300', payment_source_id: '9', cash_date: date };
    const preview = () => call(db, 'get_savings_surplus_preview', Object.values(command));
    const state = () => call(db, 'get_funded_budget_month', [month]);
    const before = preview();
    if (alreadyPosted) call(db, 'apply_savings_surplus', [randomUUID(), before.fingerprint, command]);
    const previousState = state();
    sql(db, bankMovementsMigration);
    assert.deepEqual(state(), previousState);
    if (alreadyPosted) {
      const history = previousState.savings_transfer_history[0];
      call(db, 'reverse_savings_surplus', [randomUUID(), history.operation_id, history.fingerprint, 'Synthetic reversal']);
      assert.equal(call(db, 'get_savings_account', ['1']).summary.current_balance, '0.00');
    } else {
      assert.deepEqual(preview(), before);
      call(db, 'apply_savings_surplus', [randomUUID(), before.fingerprint, command]);
      assert.equal(call(db, 'get_savings_account', ['1']).summary.current_balance, '300.00');
    }
  }
});

test('057 lock timeout aborts blocked migration atomically and stays transaction-local', async () => {
  const db = createCase();
  const blocker = asyncSql(db, "SET application_name='migration057blocker'; BEGIN; LOCK TABLE transactions IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(8); COMMIT;");
  let ready = false;
  for (let i = 0; i < 30; i++) {
    ready = scalar(db, "SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name='migration057blocker' AND l.relation='transactions'::regclass AND l.mode='AccessExclusiveLock' AND l.granted);") === 't';
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(ready, true);
  const result = sql(db, bankMovementsMigration, true);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /lock timeout/);
  assert.equal((await blocker).status, 0);
  assert.equal(scalar(db, "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='bank_movement';"), '0');
  assert.equal(scalar(db, 'SHOW lock_timeout;'), '0');
});
