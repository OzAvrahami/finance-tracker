// Disposable, portless PostgreSQL only. Never loads .env or a network DB URL.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config/flowlink');
const { harness, claim, token, ownerId, otherOwnerId } = require('./helpers/flowlinkHttp');
const full = fs.readFileSync(path.join(__dirname, '../full_schema.sql'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../migrations/038_flowlink_card_bindings.sql'), 'utf8');
const baseline = full.split('-- Migration 038:')[0];
const container = `finance-flowlink03-${process.pid}`;
let started = false, sequence = 0;
const run = (args, input, allow = false) => {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60000, maxBuffer: 32e6 });
  if (!allow) assert.equal(r.status, 0, r.stderr || r.error?.message);
  return r;
};
const sql = (db, text, allow = false) => run(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq'], text, allow);
const scalar = (db, text) => sql(db, text).stdout.trim();
const json = (db, text) => JSON.parse(scalar(db, text));
const quote = v => v === null ? 'NULL' : `'${String(typeof v === 'object' ? JSON.stringify(v) : v).replaceAll("'", "''")}'`;
const signatures = {
  create_flowlink_binding: ['p_owner_id', 'p_request_key', 'p_command'],
  update_flowlink_binding: ['p_owner_id', 'p_request_key', 'p_command'],
  list_flowlink_owner_bindings: ['p_device_id', 'p_cursor'], list_flowlink_payment_sources: ['p_cursor'],
  list_flowlink_bindings: ['p_credential_sha256'], ingest_flowlink_observation: ['p_credential_sha256', 'p_request'],
  configure_ingestion_source: ['p_request_key', 'p_command'], ingest_observation: ['p_source_id', 'p_observation'],
  create_flowlink_pairing: ['p_owner_id', 'p_pairing_id', 'p_secret_sha256', 'p_command'],
  redeem_flowlink_pairing: ['p_pairing_id', 'p_secret_sha256', 'p_redemption_id', 'p_credential_sha256'],
  cancel_flowlink_pairing: ['p_owner_id', 'p_pairing_id'], revoke_flowlink_device: ['p_owner_id', 'p_device_id'],
  get_flowlink_device: ['p_credential_sha256'], list_flowlink_devices: ['p_cursor'], cleanup_flowlink_pairings: [],
};
const statement = (name, args) => {
  assert.ok(signatures[name]);return `SET ROLE service_role; SELECT public.${name}(${signatures[name].map(k => quote(args[k])).join(',')});`;
};
const parallelSql = (db, text) => new Promise((resolve, reject) => {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq']);
  let out = '', err = '';child.stdout.on('data', b => { out += b; });child.stderr.on('data', b => { err += b; });
  child.on('error', reject);child.on('close', status => resolve({ status, out, err }));child.stdin.end(text);
});
const client = db => ({ rpc: async (name, args) => {
  const r = await parallelSql(db, `SET lock_timeout='10s';${statement(name, args)}`);
  if (r.status) throw new Error(`Disposable SQL failed: ${r.err}`);
  return { data: JSON.parse(r.out.trim()) };
} });
const call = (db, name, args) => json(db, statement(name, args));
const count = (db, table) => Number(scalar(db, `SELECT count(*) FROM ${table};`));
const financialSnapshot = db => json(db, `SELECT jsonb_build_object(
 'transactions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM transactions t),
 'sources',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM transaction_ingestion_sources t),
 'observations',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM transaction_source_observations t),
 'events',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM transaction_reconciliation_events t),
 'savings',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM savings_entries t),
 'loans',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM loan_payments t),
 'budget',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM budget_operations t));`);
async function make(t, options = {}) {
  const db = `case_${++sequence}`;sql('postgres', `CREATE DATABASE ${db} TEMPLATE flowlink_clean;`);
  sql(db, "INSERT INTO payment_sources(id,name,slug,method,is_active) VALUES(1,'Card A','a','credit_card',true),(2,'Card B','b','debit_card',true),(3,'Old','old','credit_card',false);");
  options.env ||= { FLOWLINK_OWNER_USER_IDS: JSON.stringify([ownerId]), FLOWLINK_INGESTION_ENABLED: 'true' };
  const h = await harness(t, { db: client(db), ...options });
  return { ...h, client: h.db, db };
}
const pair = async (c, body = { purpose: 'enroll', label: 'Test phone' }) => {
  const r = await c.send('/owner/pairings', body);assert.equal(r.status, 201, JSON.stringify(r.body));return r.body;
};
const enroll = async c => {
  const pairing = await pair(c), body = claim(pairing), r = await c.send('/pairings/redeem', body);
  assert.equal(r.status, 201, JSON.stringify(r.body));return { pairing, body, result: r.body };
};
const auth = value => ({ headers: { Authorization: `Bearer ${value}` } });
const storedPair = (db, age, status = 'pending') => {
  const p = config.newPairing();
  sql(db, `INSERT INTO flowlink_pairing_capabilities(id,secret_sha256,purpose,device_label,created_by,created_at,expires_at,status)
   VALUES(${quote(p.id)},${quote(config.digest(p.text))},'enroll','Expired test',${quote(ownerId)},
   statement_timestamp()-interval ${quote(age)},statement_timestamp()-interval ${quote(age)}+interval '10 minutes',${quote(status)});`);
  return { pairing_id: p.id, pairing_text: p.text };
};
before(async () => {
  run(['run', '-d', '--rm', '--name', container, '--label', 'finance.disposable=flowlink03', '-e', 'POSTGRES_PASSWORD=local_test_only', 'postgres:16-alpine']);started = true;
  const info = JSON.parse(run(['inspect', container]).stdout)[0];assert.equal(info.Config.Labels['finance.disposable'], 'flowlink03');
  assert.equal(info.Config.Image, 'postgres:16-alpine');assert.deepEqual(info.HostConfig.PortBindings || {}, {});
  for (let i = 0; i < 60; i++) { if (run(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], undefined, true).status === 0) break; await new Promise(r => setTimeout(r, 200)); }
  sql('postgres', 'CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE DATABASE flowlink_clean;CREATE DATABASE flowlink_baseline;');
  sql('flowlink_baseline', baseline);sql('flowlink_clean', full);
});
after(() => { if (started) run(['rm', '-f', container]); });

const binding = async (c, e, payment = '1') => {
  const body = { request_id: randomUUID(), label: 'My card', payment_source_id: payment };
  const r = await c.send(`/owner/devices/${e.result.device_id}/bindings`, body);
  assert.equal(r.status, 201, JSON.stringify(r.body));return { ...r.body, command: body };
};
const setup = async t => { const c = await make(t), e = await enroll(c), b = await binding(c, e);return { c, e, b }; };
const purchase = b => ({ binding_id: b.id, idempotency_key: randomUUID(), amount: '4.00', currency: 'ILS', merchant: 'Israel Post', transaction_date: '2026-09-26' });
const send = (c, e, p) => c.send('/wallet-transactions', p, auth(e.body.device_credential));
const patch = (c, b, changes, command) => c.send(`/owner/bindings/${b.id}`, command || { request_id: randomUUID(), expected_revision: b.revision, ...changes }, { method: 'PATCH' });
const nativeArgs = (e, p) => ({ p_credential_sha256: config.digest(e.body.device_credential), p_request: p });
const cash = c => json(c.db, "SELECT jsonb_build_object('count',count(*),'amount',coalesce(sum(total_amount),0)::text) FROM transactions WHERE voided_at IS NULL;");
async function waitLock(c) {
  for (let n = 0; n < 60; n++) {
    if (scalar(c.db, "SELECT count(*) FROM pg_locks WHERE relation='transactions'::regclass AND mode='ExclusiveLock' AND granted;") !== '0') return;
    await new Promise(r => setTimeout(r, 10));
  }
  assert.fail('competing session never obtained the transactions lock');
}

test('037 upgrade, rerun, failed migration rollback and full schema definitions agree', () => {
  const db = 'upgrade';sql('postgres', `CREATE DATABASE ${db} TEMPLATE flowlink_baseline;`);
  const snap = financialSnapshot(db);
  assert.notEqual(sql(db, migration.replace('COMMIT;', 'SELECT 1/0; COMMIT;'), true).status, 0);
  assert.equal(scalar(db, "SELECT to_regclass('flowlink_card_bindings') IS NULL;"), 't');
  sql(db, migration);sql(db, migration);assert.deepEqual(financialSnapshot(db), snap);
  const defs = d => json(d, "SELECT jsonb_object_agg(proname,pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace;");
  assert.deepEqual(defs(db), defs('flowlink_clean'));
});
test('create binds an explicit singleton source and replays the original receipt after later updates', async t => {
  const { c, e, b } = await setup(t);
  const s = json(c.db, `SELECT to_jsonb(s) FROM transaction_ingestion_sources s WHERE id=${b.source_id};`);
  assert.equal(s.instance_key, 'flowlink:' + b.id);assert.equal(s.source_kind, 'apple_pay');
  assert.deepEqual(s.configuration, { payment_source_ids: ['1'], card_mappings: [], aliases: [], time_verified: false, verified_references: [] });
  const u = await patch(c, b, { label: 'Corrected' });assert.equal(u.status, 200);assert.equal(u.body.revision, '2');
  const replay = await c.send(`/owner/devices/${e.result.device_id}/bindings`, b.command);
  assert.equal(replay.status, 200);assert.equal(replay.body.label, b.label);assert.equal(replay.body.revision, '1');assert.equal(replay.body.replayed, true);
  const bad = await c.send(`/owner/devices/${e.result.device_id}/bindings`, { ...b.command, label: 'Changed command' });assert.equal(bad.status, 409);
  assert.equal(count(c.db, 'flowlink_card_bindings'), 1);assert.equal(count(c.db, 'transactions'), 0);
});
test('label, disable, re-enable, retirement, no-op, stale revision and immutable identity', async t => {
  const { c, e, b } = await setup(t);
  assert.equal((await patch(c, b, { label: b.label })).status, 400);
  const command = { request_id: randomUUID(), expected_revision: b.revision, status: 'disabled' };
  const disabled = await patch(c, b, {}, command);assert.equal(disabled.status, 200);
  assert.equal(scalar(c.db, `SELECT is_active FROM transaction_ingestion_sources WHERE id=${b.source_id};`), 'f');
  assert.equal((await send(c, e, purchase(b))).status, 403);
  assert.equal((await patch(c, b, { label: 'Stale' })).body.error.code, 'stale_revision');
  const active = await patch(c, disabled.body, { status: 'active' });assert.equal(active.status, 200);
  assert.equal((await patch(c, b, {}, command)).body.revision, '2'); // Original disable receipt, no remutation.
  assert.equal(scalar(c.db, `SELECT is_active FROM transaction_ingestion_sources WHERE id=${b.source_id};`), 't');
  assert.equal((await patch(c, b, {}, { ...command, status: 'retired' })).body.error.code, 'request_key_conflict');
  const retired = await patch(c, active.body, { status: 'retired' });assert.equal(retired.status, 200);assert.ok(retired.body.retired_at);
  assert.equal((await patch(c, retired.body, { status: 'active' })).body.error.code, 'state_conflict');
  assert.equal((await send(c, e, purchase(b))).status, 403);
  assert.equal((await c.send('/device/bindings', undefined, auth(e.body.device_credential))).body.bindings.length, 0);
  const replacement = await binding(c, e);assert.notEqual(replacement.id, b.id);assert.notEqual(replacement.source_id, b.source_id);
});
test('owner lists are safe, paginated and active-only; owner auth remains mandatory', async t => {
  const { c, e, b } = await setup(t);
  sql(c.db, "INSERT INTO payment_sources(id,name,slug,method) SELECT x,'Card '||x,'p'||x,'credit_card' FROM generate_series(10,115) x;");
  const p = await c.send('/owner/payment-sources');assert.equal(p.body.payment_sources.length, 100);assert.ok(p.body.next_cursor);
  const q = await c.send('/owner/payment-sources?cursor=' + p.body.next_cursor);assert.equal(q.body.payment_sources.length, 8);assert.equal(q.body.next_cursor, null);
  assert.deepEqual(Object.keys(p.body.payment_sources[0]).sort(), ['id', 'name', 'method', 'issuer', 'last4', 'is_active'].sort());
  const list = await c.send(`/owner/devices/${e.result.device_id}/bindings`);assert.equal(list.body.bindings[0].source_id, b.source_id);
  for (const value of ['test-other-session', e.body.device_credential]) {
    assert.equal((await c.send('/owner/payment-sources', undefined, auth(value))).status, value === 'test-other-session' ? 403 : 401);
  }
  assert.equal((await c.send('/owner/payment-sources?cursor=bad')).status, 400);
  assert.equal((await c.send(`/owner/devices/${randomUUID()}/bindings`)).status, 404);
});
test('bindings are per device; multiple cards and same payment source on different devices remain independent', async t => {
  const { c, e, b } = await setup(t), b2 = await binding(c, e, '2'), other = await enroll(c), b3 = await binding(c, other);
  assert.equal((await send(c, e, purchase(b))).status, 201);assert.equal((await send(c, e, purchase(b2))).status, 201);
  assert.equal((await send(c, other, purchase(b3))).status, 201);assert.equal(cash(c).count, 3);
  assert.equal((await send(c, e, purchase(b3))).status, 403);assert.equal((await send(c, e, purchase({ id: randomUUID() }))).status, 403);
  const list = (await c.send('/device/bindings', undefined, auth(e.body.device_credential))).body.bindings;
  assert.deepEqual(list.map(x => x.id).sort(), [b.id, b2.id].sort());
  assert.deepEqual(Object.keys(list[0]).sort(), ['id', 'label', 'status', 'revision', 'available'].sort());
  assert.equal((await send(c, { body: { device_credential: token() } }, purchase(b))).status, 401);
});
test('same-key financial replay and changed-payload conflict preserve exactly one cash row', async t => {
  const { c, e, b } = await setup(t), p = purchase(b);
  const a = await send(c, e, p), replay = await send(c, e, p), conflict = await send(c, e, { ...p, amount: '5.00' });
  assert.equal(a.status, 201);assert.equal(replay.status, 200);assert.equal(replay.body.outcome, 'already_observed');
  assert.equal(replay.body.transaction_id, a.body.transaction_id);assert.equal(conflict.status, 409);
  assert.equal(cash(c).count, 1);assert.match(cash(c).amount, /^4\.0+$/); // NUMERIC scale is not money identity.
});
function cal(c, times = 1) {
  const source = call(c.db, 'configure_ingestion_source', { p_request_key: randomUUID(), p_command: {
    source_kind: 'cal', instance_key: 'test', actor: 'synthetic', configuration: { payment_source_ids: ['1'] } } });
  for (let i = 0; i < times; i++) call(c.db, 'ingest_observation', { p_source_id: source.source_id, p_observation: {
    idempotency_key: randomUUID(), merchant: 'Israel Post', accounting_amount: '4.00', currency: 'ILS', movement_type: 'expense',
    transaction_date: '2026-09-26', payment_source_id: '1' } });
  return source;
}
test('one strong CAL candidate attaches through existing APY without extra cash', async t => {
  const { c, e, b } = await setup(t);cal(c);
  const r = await send(c, e, purchase(b));assert.equal(r.status, 200);assert.equal(r.body.outcome, 'reconciled');assert.equal(cash(c).count, 1);
});
test('ambiguous CAL candidates retain pending evidence and create zero avoidable cash', async t => {
  const { c, e, b } = await setup(t);cal(c, 2);
  const r = await send(c, e, purchase(b));assert.equal(r.status, 202);assert.equal(r.body.disposition, 'pending');assert.equal(cash(c).count, 2);
  assert.equal(JSON.stringify(r.body).includes('candidate_ids'), false);
});
test('inactive payment source and corrupt APY identity/configuration fail closed, never self-repair', async t => {
  const { c, e, b } = await setup(t);
  sql(c.db, 'UPDATE payment_sources SET is_active=false WHERE id=1;');
  assert.equal((await send(c, e, purchase(b))).status, 422);
  assert.equal((await c.send('/device/bindings', undefined, auth(e.body.device_credential))).body.bindings[0].available, false);
  sql(c.db, 'UPDATE payment_sources SET is_active=true WHERE id=1;');
  for (const change of ["configuration=jsonb_set(configuration,'{payment_source_ids}','[\"1\",\"2\"]')", "instance_key='wrong'", 'is_active=false']) {
    sql(c.db, `UPDATE transaction_ingestion_sources SET ${change} WHERE id=${b.source_id};`);
    assert.equal((await send(c, e, purchase(b))).status, 503);assert.equal(cash(c).count, 0);
  }
});
test('duplicate mapping, inactive payment source/device and quota are rejected before source creation', async t => {
  const { c, e, b } = await setup(t), url = `/owner/devices/${e.result.device_id}/bindings`;
  assert.equal((await c.send(url, { ...b.command, request_id: randomUUID() })).status, 409);
  assert.equal((await c.send(url, { ...b.command, request_id: randomUUID(), payment_source_id: '3' })).status, 409);
  sql(c.db, "INSERT INTO payment_sources(id,name,slug,method) SELECT x,'Card '||x,'p'||x,'credit_card' FROM generate_series(10,41) x;");
  for (let i = 10; i < 41; i++) await binding(c, e, String(i));
  assert.equal((await c.send(url, { ...b.command, request_id: randomUUID(), payment_source_id: '41' })).status, 429);
  assert.equal(count(c.db, 'flowlink_card_bindings'), 32);
  await c.send(`/owner/devices/${e.result.device_id}/revoke`, {});
  assert.equal((await c.send(url, { ...b.command, request_id: randomUUID(), payment_source_id: '2' })).status, 409);
  assert.equal((await send(c, e, purchase(b))).status, 401);
  assert.equal(scalar(c.db, `SELECT is_active FROM transaction_ingestion_sources WHERE id=${b.source_id};`), 't');
});
test('SQL boundary independently rejects protocol escalation, noncanonical scalars and invalid Gregorian dates', async t => {
  const { c, e, b } = await setup(t), base = purchase(b);
  for (const extra of [{ payment_source_id: '2' }, { source_id: '1' }, { amount: 4 }, { amount: '04.00' }, { amount: '0.00' },
    { merchant: 'Attachment.txt' }, { merchant: '\n' }, { merchant: '!!!' }, { currency: 'USD' }, { transaction_date: '2026-02-30' },
    { transaction_date: '0000-01-01' }, { idempotency_key: 'bad' }, { binding_id: b.id.toUpperCase() }]) {
    const r = call(c.db, 'ingest_flowlink_observation', nativeArgs(e, { ...base, ...extra }));
    assert.ok(r.error || r.outcome === 'rejected', JSON.stringify(extra));
  }
  assert.equal(cash(c).count, 0);
});
test('concurrent identical binding commands replay once and competing duplicate mappings create one source', async t => {
  const c = await make(t), e = await enroll(c), url = `/owner/devices/${e.result.device_id}/bindings`;
  const body = { request_id: randomUUID(), label: 'A', payment_source_id: '1' };
  const same = await Promise.all([c.send(url, body), c.send(url, body)]);assert.deepEqual(same.map(r => r.status).sort(), [200, 201]);
  const different = await Promise.all([c.send(url, { ...body, request_id: randomUUID(), payment_source_id: '2' }), c.send(url, { ...body, request_id: randomUUID(), payment_source_id: '2' })]);
  assert.deepEqual(different.map(r => r.status).sort(), [201, 409]);
  assert.equal(count(c.db, 'flowlink_card_bindings'), 2);assert.equal(scalar(c.db, "SELECT count(*) FROM transaction_ingestion_sources WHERE source_kind='apple_pay';"), '2');
});
for (const mode of ['revoke', 'disable', 'rotate']) for (const firstMoney of [false, true]) {
  test(`real transaction race: ${firstMoney ? 'ingestion' : mode} commits first against ${firstMoney ? mode : 'ingestion'}`, async t => {
    const { c, e, b } = await setup(t), p = purchase(b);
    let operation;
    if (mode === 'revoke') operation = statement('revoke_flowlink_device', { p_owner_id: ownerId, p_device_id: e.result.device_id });
    if (mode === 'disable') operation = statement('update_flowlink_binding', { p_owner_id: ownerId, p_request_key: randomUUID(), p_command: { binding_id: b.id, expected_revision: '1', status: 'disabled' } });
    if (mode === 'rotate') operation = statement('redeem_flowlink_pairing', config.redemption(claim(await pair(c, { purpose: 'replace_credential', device_id: e.result.device_id }))));
    const money = statement('ingest_flowlink_observation', nativeArgs(e, p));
    const first = parallelSql(c.db, `BEGIN;${firstMoney ? money : operation} SELECT pg_sleep(0.5);COMMIT;`);await waitLock(c);
    const second = await parallelSql(c.db, firstMoney ? operation : money);assert.equal((await first).status, 0);assert.equal(second.status, 0, second.err);
    assert.equal(cash(c).count, firstMoney ? 1 : 0);
    if (!firstMoney) assert.equal(JSON.parse(second.out.trim()).error.code, mode === 'disable' ? 'binding_unavailable' : 'unauthorized');
  });
}
test('payment-source deactivation commits first: waiting authorized ingest rechecks and creates no cash', async t => {
  const { c, e, b } = await setup(t);
  const first = parallelSql(c.db, "BEGIN;UPDATE payment_sources SET is_active=false WHERE id=1;SELECT pg_sleep(1);COMMIT;");
  let locked = false;
  for (let n = 0; n < 60; n++) {
    locked = scalar(c.db, "SELECT count(*) FROM pg_locks WHERE relation='payment_sources'::regclass AND mode='RowExclusiveLock' AND granted;") !== '0';
    if (locked) break;await new Promise(r => setTimeout(r, 10));
  }
  assert.ok(locked);const result = await send(c, e, purchase(b));assert.equal((await first).status, 0);assert.equal(result.status, 422);assert.equal(cash(c).count, 0);
});
test('concurrent native and existing APY ingestion share the same financial lock and one cash row', async t => {
  const { c, e, b } = await setup(t);
  const source = call(c.db, 'configure_ingestion_source', { p_request_key: randomUUID(), p_command: { source_kind: 'cal', instance_key: 'race', actor: 'test', configuration: { payment_source_ids: ['1'] } } });
  const results = await Promise.all([send(c, e, purchase(b)), c.client.rpc('ingest_observation', { p_source_id: source.source_id, p_observation: {
    idempotency_key: randomUUID(), merchant: 'Israel Post', accounting_amount: '4.00', currency: 'ILS', movement_type: 'expense', transaction_date: '2026-09-26', payment_source_id: '1' } })]);
  assert.ok(results[0].status < 300);assert.ok(['created', 'reconciled'].includes(results[1].data.outcome));assert.equal(cash(c).count, 1);
});
test('bindings/history immutable; RLS and private helper/RPC grants deny browser and direct service access', async t => {
  const { c, b } = await setup(t);
  for (const text of ['DELETE FROM flowlink_card_bindings;', 'DELETE FROM flowlink_binding_commands;', "UPDATE flowlink_binding_commands SET result='{}';", 'UPDATE flowlink_card_bindings SET payment_source_id=2,revision=revision+1;', 'UPDATE flowlink_card_bindings SET device_id=gen_random_uuid(),revision=revision+1;']) assert.notEqual(sql(c.db, text, true).status, 0);
  for (const role of ['anon', 'authenticated', 'service_role']) for (const table of ['flowlink_card_bindings', 'flowlink_binding_commands']) {
    assert.notEqual(sql(c.db, `SET ROLE ${role};SELECT * FROM ${table};`, true).status, 0);
  }
  assert.equal(scalar(c.db, "SELECT count(*) FROM pg_class WHERE relname IN ('flowlink_card_bindings','flowlink_binding_commands') AND relrowsecurity;"), '2');
  for (const role of ['anon', 'authenticated']) assert.equal(scalar(c.db, `SELECT has_function_privilege('${role}','ingest_flowlink_observation(bytea,jsonb)','EXECUTE');`), 'f');
  assert.equal(scalar(c.db, "SELECT has_function_privilege('service_role','flowlink_owner_binding(uuid)','EXECUTE');"), 'f');
  assert.equal(scalar(c.db, `SELECT source_id::text FROM flowlink_card_bindings WHERE id=${quote(b.id)};`), b.source_id);
});
test('binding/source/receipt rollback together after an injected receipt failure', async t => {
  const c = await make(t), e = await enroll(c);
  sql(c.db, "CREATE FUNCTION test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$;CREATE TRIGGER test_fail BEFORE INSERT ON flowlink_binding_commands FOR EACH ROW EXECUTE FUNCTION test_fail();");
  const body = { request_id: randomUUID(), label: 'Test', payment_source_id: '1' };
  assert.equal((await c.send(`/owner/devices/${e.result.device_id}/bindings`, body)).status, 503);
  assert.equal(count(c.db, 'flowlink_card_bindings'), 0);assert.equal(count(c.db, 'flowlink_binding_commands'), 0);
  assert.equal(scalar(c.db, "SELECT count(*) FROM transaction_ingestion_sources WHERE source_kind='apple_pay';"), '0');
  sql(c.db, 'DROP TRIGGER test_fail ON flowlink_binding_commands;');
  assert.equal((await c.send(`/owner/devices/${e.result.device_id}/bindings`, body)).status, 201);
});
test('lost HTTP responses recover binding and financial receipts without remutation or duplicate cash', async t => {
  const c = await make(t), e = await enroll(c), original = c.client.rpc;
  let lose = 'create_flowlink_binding';
  c.client.rpc = async (name, args) => { const r = await original(name, args);if (name === lose) { lose = null;throw new Error('lost committed response'); }return r; };
  const url = `/owner/devices/${e.result.device_id}/bindings`, body = { request_id: randomUUID(), label: 'A', payment_source_id: '1' };
  assert.equal((await c.send(url, body)).status, 503);
  const b = (await c.send(url, body)).body;assert.equal(b.replayed, true);assert.equal(count(c.db, 'flowlink_card_bindings'), 1);
  lose = 'ingest_flowlink_observation';const p = purchase(b);
  assert.equal((await send(c, e, p)).status, 503);
  const r = await send(c, e, p);assert.equal(r.status, 200);assert.equal(r.body.replayed, true);assert.equal(cash(c).count, 1);
});
test('owner updates preserve approved aliases and use actual independent APY revision', async t => {
  const { c, b } = await setup(t);
  const s = json(c.db, `SELECT to_jsonb(s) FROM transaction_ingestion_sources s WHERE id=${b.source_id};`);
  const cfg = { ...s.configuration, aliases: [{ merchant: 'Post', key: 'post' }] };
  call(c.db, 'configure_ingestion_source', { p_request_key: randomUUID(), p_command: { source_kind: s.source_kind,
    instance_key: s.instance_key, expected_revision: String(s.revision), configuration: cfg, actor: 'synthetic-approved-owner' } });
  const result = await patch(c, b, { status: 'disabled' });assert.equal(result.status, 200);assert.equal(result.body.revision, '2');
  const after = json(c.db, `SELECT to_jsonb(s) FROM transaction_ingestion_sources s WHERE id=${b.source_id};`);
  assert.deepEqual(after.configuration, cfg);assert.equal(after.revision, 3);assert.equal(after.is_active, false);
});
test('concurrent owner updates serialize expected revisions and retain one original receipt', async t => {
  const { c, b } = await setup(t), body = { request_id: randomUUID(), expected_revision: '1', label: 'New label' };
  const same = await Promise.all([patch(c, b, {}, body), patch(c, b, {}, body)]);
  assert.deepEqual(same.map(r => r.status), [200, 200]);assert.deepEqual(same.map(r => r.body.replayed).sort(), [false, true]);
  const current = same[0].body;
  const different = await Promise.all([patch(c, current, { label: 'A' }), patch(c, current, { label: 'B' })]);
  assert.deepEqual(different.map(r => r.status).sort(), [200, 409]);assert.equal(different.find(r => r.status === 409).body.error.code, 'stale_revision');
});
test('owner binding history paginates at 50 including retired identities without device exposure', async t => {
  const { c, e, b } = await setup(t);
  // Private service calls avoid the intentional process-local owner HTTP burst limit.
  let current = b;
  for (let i = 0; i < 51; i++) {
    const r = call(c.db, 'update_flowlink_binding', { p_owner_id: ownerId, p_request_key: randomUUID(), p_command: { binding_id: current.id, expected_revision: '1', status: 'retired' } });assert.equal(r.status, 'retired');
    current = call(c.db, 'create_flowlink_binding', { p_owner_id: ownerId, p_request_key: randomUUID(), p_command: { device_id: e.result.device_id, label: 'Replacement', payment_source_id: '1' } });assert.equal(current.status, 'active');
  }
  const first = await c.send(`/owner/devices/${e.result.device_id}/bindings`);assert.equal(first.body.bindings.length, 50);
  const second = await c.send(`/owner/devices/${e.result.device_id}/bindings?cursor=${first.body.next_cursor}`);assert.equal(second.body.bindings.length, 2);assert.equal(second.body.next_cursor, null);
  assert.equal(new Set([...first.body.bindings, ...second.body.bindings].map(b => b.id)).size, 52);
  assert.equal((await c.send('/device/bindings', undefined, auth(e.body.device_credential))).body.bindings.length, 1);
});
test('each source identity/configuration invariant independently fails closed without repair', async t => {
  const { c, e, b } = await setup(t);
  const original = json(c.db, `SELECT to_jsonb(s) FROM transaction_ingestion_sources s WHERE id=${b.source_id};`);
  for (const change of ["source_kind='cal'", "instance_key='wrong'", 'is_active=false', "configuration=jsonb_set(configuration,'{payment_source_ids}','[\"2\"]')"]) {
    sql(c.db, `UPDATE transaction_ingestion_sources SET ${change} WHERE id=${b.source_id};`);
    const r = call(c.db, 'ingest_flowlink_observation', nativeArgs(e, purchase(b)));assert.equal(r.error.code, 'flowlink_configuration_invalid');
    sql(c.db, `UPDATE transaction_ingestion_sources SET source_kind='apple_pay',instance_key=${quote(original.instance_key)},is_active=true,configuration=${quote(original.configuration)} WHERE id=${b.source_id};`);
  }
  assert.equal(call(c.db, 'ingest_flowlink_observation', { p_credential_sha256: config.digest(token()), p_request: purchase(b) }).error.code, 'unauthorized');
  assert.equal(cash(c).count, 0);
});
