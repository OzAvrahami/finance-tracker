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
const migration = fs.readFileSync(path.join(__dirname, '../migrations/037_flowlink_device_enrollment.sql'), 'utf8');
const baseline = full.split('-- Migration 037:')[0];
const container = `finance-flowlink02-${process.pid}`;
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
  const before = financialSnapshot(db);t.after(() => assert.deepEqual(financialSnapshot(db), before, 'Enrollment must have zero financial/APY effects'));
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
  run(['run', '-d', '--rm', '--name', container, '--label', 'finance.disposable=flowlink02', '-e', 'POSTGRES_PASSWORD=local_test_only', 'postgres:16-alpine']);started = true;
  const info = JSON.parse(run(['inspect', container]).stdout)[0];assert.equal(info.Config.Labels['finance.disposable'], 'flowlink02');
  assert.equal(info.Config.Image, 'postgres:16-alpine');assert.deepEqual(info.HostConfig.PortBindings || {}, {});
  for (let i = 0; i < 60; i++) { if (run(['exec', container, 'pg_isready', '-U', 'postgres'], undefined, true).status === 0) break; await new Promise(r => setTimeout(r, 200)); }
  sql('postgres', 'CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE DATABASE flowlink_clean;CREATE DATABASE flowlink_baseline;');
  sql('flowlink_baseline', baseline);sql('flowlink_clean', full);
});
after(() => { if (started) run(['rm', '-f', container]); });

test('036 upgrade, clean installation, rerun and rollback preserve financial schema/data/provenance', () => {
  const db = 'upgrade';sql('postgres', `CREATE DATABASE ${db} TEMPLATE flowlink_baseline;`);
  sql(db, "INSERT INTO transactions(transaction_date,charge_date,total_amount,movement_type,external_id) VALUES('2026-09-01','2026-09-02',84.90,'expense','legacy-test');");
  const snapshot = financialSnapshot(db);
  const broken = migration.replace('COMMIT;', "SELECT 1/0; COMMIT;");
  assert.notEqual(sql(db, broken, true).status, 0);assert.equal(scalar(db, "SELECT to_regclass('public.flowlink_devices') IS NULL;"), 't');
  sql(db, migration);sql(db, migration);assert.deepEqual(financialSnapshot(db), snapshot);
  const definitions = d => json(d, "SELECT jsonb_object_agg(proname,pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE '%flowlink%';");
  assert.deepEqual(definitions(db), definitions('flowlink_clean'));
  const existing = d => json(d, "SELECT jsonb_object_agg(proname,pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'apy_%' OR proname LIKE 'savings_%' OR proname='ingest_observation');");
  assert.deepEqual(existing(db), existing('flowlink_baseline'));
});
test('HTTP creates 10-minute digest-only capability and one enrolled device/credential', async t => {
  const c = await make(t), e = await enroll(c);
  assert.equal(count(c.db, 'flowlink_devices'), 1);assert.equal(count(c.db, 'flowlink_device_credentials'), 1);
  const p = json(c.db, `SELECT to_jsonb(p) FROM flowlink_pairing_capabilities p WHERE id=${quote(e.pairing.pairing_id)};`);
  assert.equal(p.status, 'consumed');assert.equal(new Date(p.expires_at) - new Date(p.created_at), 600000);
  assert.equal(p.secret_sha256, config.digest(e.pairing.pairing_text));
  const credential = json(c.db, 'SELECT to_jsonb(c) FROM flowlink_device_credentials c;');
  assert.equal(credential.credential_sha256, config.digest(e.body.device_credential));
  const all = JSON.stringify([p, credential, c.logs]);assert.equal(all.includes(e.body.device_credential), false);assert.equal(all.includes(e.body.secret), false);
});
test('identical committed-but-lost HTTP response replays stable enrollment without rotation', async t => {
  const c = await make(t), p = await pair(c), body = claim(p), rpc = c.client.rpc;let lose = true;
  c.client.rpc = async (name, args) => { const result = await rpc(name, args);if (name === 'redeem_flowlink_pairing' && lose) { lose = false;throw new Error('lost response'); }return result; };
  assert.equal((await c.send('/pairings/redeem', body)).status, 503);
  const retried = await c.send('/pairings/redeem', body);assert.equal(retried.status, 200);assert.equal(retried.body.replayed, true);
  const again = await c.send('/pairings/redeem', body);assert.deepEqual(again.body, retried.body);
  assert.equal(count(c.db, 'flowlink_devices'), 1);assert.equal(count(c.db, 'flowlink_device_credentials'), 1);
});
test('concurrent identical HTTP redemption returns one creation and one exact replay', async t => {
  const c = await make(t), body = claim(await pair(c));
  const [a, b] = await Promise.all([c.send('/pairings/redeem', body), c.send('/pairings/redeem', body)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 201]);assert.equal(a.body.device_id, b.body.device_id);assert.equal(a.body.credential_id, b.body.credential_id);
  assert.equal(count(c.db, 'flowlink_devices'), 1);assert.equal(count(c.db, 'flowlink_device_credentials'), 1);
});
test('concurrent conflicting claims cannot enroll twice or overwrite the winner', async t => {
  const c = await make(t), body = claim(await pair(c));
  const results = await Promise.all([c.send('/pairings/redeem', body), c.send('/pairings/redeem', { ...body, device_credential: token() })]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);assert.equal(results.find(r => r.status === 409).body.error.code, 'pairing_consumed');
  assert.equal(count(c.db, 'flowlink_devices'), 1);assert.equal(count(c.db, 'flowlink_device_credentials'), 1);
});
test('same capability with a different request ID or credential is a deterministic conflict', async t => {
  const c = await make(t), e = await enroll(c);
  for (const body of [{ ...e.body, redemption_id: randomUUID() }, { ...e.body, device_credential: token() }]) {
    const r = await c.send('/pairings/redeem', body);assert.equal(r.status, 409);assert.equal(r.body.error.code, 'pairing_consumed');
  }
  assert.equal(count(c.db, 'flowlink_device_credentials'), 1);
});
test('expired capability cannot create cash or a device', async t => {
  const c = await make(t), p = storedPair(c.db, '11 minutes');
  const r = await c.send('/pairings/redeem', claim(p));assert.equal(r.status, 410);assert.equal(r.body.error.code, 'pairing_unavailable');
  assert.equal(count(c.db, 'flowlink_devices'), 0);
});
test('cancel is idempotent and cancelled capability cannot redeem', async t => {
  const c = await make(t), p = await pair(c);
  const a = await c.send(`/owner/pairings/${p.pairing_id}/cancel`, {}), b = await c.send(`/owner/pairings/${p.pairing_id}/cancel`, {});
  assert.equal(a.status, 200);assert.deepEqual(a.body, b.body);
  assert.equal((await c.send('/pairings/redeem', claim(p))).status, 410);assert.equal(count(c.db, 'flowlink_devices'), 0);
});
test('five bad proofs persist attempts, lock capability and never expose secret/exists details', async t => {
  const c = await make(t), p = await pair(c), body = claim(p);
  for (let n = 1; n <= 5; n++) {
    const r = await c.send('/pairings/redeem', { ...body, secret: token().slice(7) });assert.equal(r.status, 401);assert.equal(r.body.error.code, 'pairing_invalid');
    assert.equal(scalar(c.db, `SELECT failed_attempts FROM flowlink_pairing_capabilities WHERE id=${quote(p.pairing_id)};`), String(n));
  }
  assert.equal((await c.send('/pairings/redeem', body)).status, 410);
  assert.equal((await c.send('/pairings/redeem', { ...body, pairing_id: randomUUID() })).status, 401);
});
test('concurrent wrong proofs cannot lose attempt increments or exceed five', async t => {
  const c = await make(t), body = claim(await pair(c));
  const responses = await Promise.all(Array.from({ length: 7 }, () => c.send('/pairings/redeem', { ...body, secret: token().slice(7) })));
  assert.ok(responses.every(r => r.status === 401));
  assert.equal(scalar(c.db, 'SELECT failed_attempts FROM flowlink_pairing_capabilities;'), '5');
  assert.equal(scalar(c.db, 'SELECT status FROM flowlink_pairing_capabilities;'), 'locked');
});
test('persistent concurrent owner pending quota admits five capabilities only', async t => {
  const c = await make(t);
  const results = await Promise.all(Array.from({ length: 7 }, () => c.send('/owner/pairings', { purpose: 'enroll', label: 'Phone' })));
  assert.equal(results.filter(r => r.status === 201).length, 5);assert.equal(results.filter(r => r.status === 429).length, 2);
  assert.equal(count(c.db, 'flowlink_pairing_capabilities'), 5);
});
test('hourly owner quota includes consumed/cancelled capabilities and survives process changes', async t => {
  const c = await make(t);
  for (let n = 0; n < 10; n++) { const p = await pair(c);await c.send(`/owner/pairings/${p.pairing_id}/cancel`, {}); }
  const r = await c.send('/owner/pairings', { purpose: 'enroll', label: 'Phone' });assert.equal(r.status, 429);
});
test('real status auth checks current digest and isolates two devices', async t => {
  const c = await make(t), a = await enroll(c), b = await enroll(c);
  assert.equal((await c.send('/device', undefined, auth(a.body.device_credential))).body.device.id, a.result.device_id);
  assert.equal((await c.send('/device', undefined, auth(b.body.device_credential))).body.device.id, b.result.device_id);
  assert.equal((await c.send('/device', undefined, auth(token()))).status, 401);
  assert.equal((await c.send('/device?device_id=' + b.result.device_id, undefined, auth(a.body.device_credential))).status, 400);
});
test('device revocation is permanent, uncached, idempotent and independent', async t => {
  const c = await make(t), a = await enroll(c), b = await enroll(c);
  const first = await c.send(`/owner/devices/${a.result.device_id}/revoke`, {}), second = await c.send(`/owner/devices/${a.result.device_id}/revoke`, {});
  assert.equal(first.status, 200);assert.deepEqual(first.body, second.body);
  assert.equal((await c.send('/device', undefined, auth(a.body.device_credential))).status, 401);
  assert.equal((await c.send('/device', undefined, auth(b.body.device_credential))).status, 200);
  assert.equal((await c.send('/pairings/redeem', a.body)).body.error.code, 'pairing_superseded');
  assert.equal((await c.send('/owner/pairings', { purpose: 'replace_credential', device_id: a.result.device_id })).status, 409);
  assert.equal(count(c.db, 'flowlink_devices'), 2);
});
test('replacement pairing rotates one credential, preserves identity and returns stable replay', async t => {
  const c = await make(t), a = await enroll(c), b = await enroll(c);
  const p = await pair(c, { purpose: 'replace_credential', device_id: a.result.device_id }), body = claim(p);
  assert.equal((await c.send('/device', undefined, auth(a.body.device_credential))).status, 200);
  const r = await c.send('/pairings/redeem', body);assert.equal(r.status, 201);assert.equal(r.body.device_id, a.result.device_id);assert.equal(r.body.credential_revision, '2');
  assert.equal((await c.send('/device', undefined, auth(a.body.device_credential))).status, 401);
  assert.equal((await c.send('/device', undefined, auth(body.device_credential))).status, 200);
  assert.equal((await c.send('/device', undefined, auth(b.body.device_credential))).status, 200);
  assert.equal((await c.send('/pairings/redeem', a.body)).body.error.code, 'pairing_superseded');
  const again = await c.send('/pairings/redeem', body);assert.equal(again.status, 200);assert.equal(again.body.credential_id, r.body.credential_id);
  assert.equal(scalar(c.db, `SELECT count(*) FROM flowlink_device_credentials WHERE device_id=${quote(a.result.device_id)} AND status='active';`), '1');
});
test('credential already registered to another device cannot be substituted during enrollment', async t => {
  const c = await make(t), a = await enroll(c), p = await pair(c);
  const r = await c.send('/pairings/redeem', claim(p, a.body.device_credential));assert.equal(r.status, 409);assert.equal(r.body.error.code, 'credential_reused');
  assert.equal(count(c.db, 'flowlink_devices'), 1);assert.equal((await c.send('/device', undefined, auth(a.body.device_credential))).status, 200);
});
test('revocation wins against waiting replacement redemption under transactions-first locking', async t => {
  const c = await make(t), a = await enroll(c), p = await pair(c, { purpose: 'replace_credential', device_id: a.result.device_id }), body = claim(p);
  const sqlText = `BEGIN;${statement('revoke_flowlink_device', { p_owner_id: ownerId, p_device_id: a.result.device_id })} SELECT pg_sleep(0.5);COMMIT;`;
  const first = parallelSql(c.db, sqlText);
  // Wait for the actual first transaction lock, not a mocked middleware result.
  for (let n = 0; n < 50; n++) {
    if (scalar(c.db, "SELECT count(*) FROM pg_locks WHERE relation='transactions'::regclass AND mode='ExclusiveLock' AND granted;") !== '0') break;
    await new Promise(r => setTimeout(r, 10));
  }
  const r = await c.send('/pairings/redeem', body);assert.equal((await first).status, 0);
  assert.equal(r.status, 410);assert.equal(count(c.db, 'flowlink_device_credentials'), 1);
});
test('replacement wins before revoke; revoke then invalidates the new credential too', async t => {
  const c = await make(t), a = await enroll(c), body = claim(await pair(c, { purpose: 'replace_credential', device_id: a.result.device_id }));
  const first = parallelSql(c.db, `BEGIN;${statement('redeem_flowlink_pairing', config.redemption(body))} SELECT pg_sleep(0.5);COMMIT;`);
  for (let n = 0; n < 50; n++) {
    if (scalar(c.db, "SELECT count(*) FROM pg_locks WHERE relation='transactions'::regclass AND mode='ExclusiveLock' AND granted;") !== '0') break;
    await new Promise(r => setTimeout(r, 10));
  }
  const r = await c.send(`/owner/devices/${a.result.device_id}/revoke`, {});assert.equal((await first).status, 0);assert.equal(r.status, 200);
  assert.equal((await c.send('/device', undefined, auth(body.device_credential))).status, 401);
  assert.equal(scalar(c.db, "SELECT count(*) FROM flowlink_device_credentials WHERE status='active';"), '0');
});
test('rollback after device/credential creation leaves no orphan identity or consumed receipt', async t => {
  const c = await make(t), p = await pair(c), body = claim(p);
  sql(c.db, "CREATE FUNCTION test_fail_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='consumed' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_fail_claim BEFORE UPDATE ON flowlink_pairing_capabilities FOR EACH ROW EXECUTE FUNCTION test_fail_claim();");
  assert.equal((await c.send('/pairings/redeem', body)).status, 503);assert.equal(count(c.db, 'flowlink_devices'), 0);assert.equal(count(c.db, 'flowlink_device_credentials'), 0);
  assert.equal(scalar(c.db, 'SELECT status FROM flowlink_pairing_capabilities;'), 'pending');
  sql(c.db, 'DROP TRIGGER test_fail_claim ON flowlink_pairing_capabilities;');
  assert.equal((await c.send('/pairings/redeem', body)).status, 201);
});
test('guards prevent identity edits, history deletion, receipt mutation and credential resurrection', async t => {
  const c = await make(t), a = await enroll(c);
  for (const text of ["DELETE FROM flowlink_devices;", "DELETE FROM flowlink_device_credentials;", "DELETE FROM flowlink_pairing_capabilities;",
    "UPDATE flowlink_devices SET label='changed';", "UPDATE flowlink_device_credentials SET credential_sha256=decode(repeat('ab',32),'hex');",
    "UPDATE flowlink_pairing_capabilities SET failed_attempts=1;"]) assert.notEqual(sql(c.db, text, true).status, 0, text);
  await c.send(`/owner/devices/${a.result.device_id}/revoke`, {});
  assert.notEqual(sql(c.db, "UPDATE flowlink_devices SET status='active',revoked_at=NULL,revoked_by=NULL;", true).status, 0);
  assert.notEqual(sql(c.db, "UPDATE flowlink_device_credentials SET status='active',revoked_at=NULL,revocation_reason=NULL;", true).status, 0);
});
test('constraints enforce one active digest, unique revisions and byte length', async t => {
  const c = await make(t), a = await enroll(c);
  for (const [hash, revision] of [config.digest(token()), config.digest(token())].map((h, i) => [h, i + 1]).concat([['\\x00', 2]])) {
    assert.notEqual(sql(c.db, `INSERT INTO flowlink_device_credentials(device_id,credential_sha256,revision) VALUES(${quote(a.result.device_id)},${quote(hash)},${revision});`, true).status, 0);
  }
  assert.equal(count(c.db, 'flowlink_device_credentials'), 1);
});
test('RLS, explicit grants and private helper revokes prohibit direct client/server table access', async t => {
  const c = await make(t);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const table of ['flowlink_devices', 'flowlink_device_credentials', 'flowlink_pairing_capabilities']) {
      assert.equal(scalar(c.db, `SELECT relrowsecurity FROM pg_class WHERE oid=${quote(table)}::regclass;`), 't');
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) assert.equal(scalar(c.db, `SELECT has_table_privilege(${quote(role)},${quote(table)},${quote(privilege)});`), 'f');
    }
    const funcs = json(c.db, "SELECT jsonb_agg(oid::regprocedure::text) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE '%flowlink%';");
    for (const fn of funcs) {
      const should = role === 'service_role' && !fn.startsWith('flowlink_');
      assert.equal(scalar(c.db, `SELECT has_function_privilege(${quote(role)},${quote(fn)},'EXECUTE');`), should ? 't' : 'f', `${role} ${fn}`);
    }
  }
});
test('owner pagination is stable and never exposes audit identities/digests', async t => {
  const c = await make(t);
  sql(c.db, `INSERT INTO flowlink_devices(label,created_by,created_at) SELECT 'Fixture '||n,${quote(ownerId)},'2026-01-01'::timestamptz+n*interval '1 second' FROM generate_series(1,55) n;`);
  const a = await c.send('/owner/devices');assert.equal(a.status, 200);assert.equal(a.body.devices.length, 50);assert.ok(a.body.next_cursor);
  const b = await c.send('/owner/devices?cursor=' + a.body.next_cursor);assert.equal(b.status, 200);assert.equal(b.body.devices.length, 5);assert.equal(b.body.next_cursor, null);
  assert.equal(new Set([...a.body.devices, ...b.body.devices].map(d => d.id)).size, 55);
  assert.equal(JSON.stringify([a.body, b.body]).includes(ownerId), false);
});
test('bounded cleanup expires/prunes only old capabilities and preserves devices', async t => {
  const c = await make(t);await enroll(c);const old = storedPair(c.db, '91 days'), recent = storedPair(c.db, '11 minutes');
  const result = call(c.db, 'cleanup_flowlink_pairings', {});assert.equal(result.pruned, 1);
  assert.equal(scalar(c.db, `SELECT count(*) FROM flowlink_pairing_capabilities WHERE id=${quote(old.pairing_id)};`), '0');
  assert.equal(scalar(c.db, `SELECT status FROM flowlink_pairing_capabilities WHERE id=${quote(recent.pairing_id)};`), 'expired');
  assert.equal(count(c.db, 'flowlink_devices'), 1);
});
test('no card-binding/native-money tables or APY sources were added', async t => {
  const c = await make(t);await enroll(c);
  assert.equal(scalar(c.db, "SELECT to_regclass('public.flowlink_card_bindings') IS NULL;"), 't');
  assert.equal(scalar(c.db, "SELECT count(*) FROM transaction_ingestion_sources WHERE source_kind='apple_pay';"), '0');
  assert.equal((await c.send('/wallet-transactions', {})).status, 404);
});

test('receipt recovery ends after 24 hours without invalidating the stored device credential', async t => {
  const c = await make(t), e = await enroll(c), p = config.newPairing();
  const body = claim({ pairing_id: p.id, pairing_text: p.text });
  body.device_credential = e.body.device_credential;
  const args = config.redemption(body);
  sql(c.db, `INSERT INTO flowlink_pairing_capabilities
   (id,secret_sha256,purpose,device_label,created_by,created_at,expires_at,status,consumed_at,
    redemption_id,claim_hash,result_device_id,result_credential_id)
   VALUES(${quote(p.id)},${quote(args.p_secret_sha256)},'enroll','Receipt fixture',${quote(ownerId)},
    statement_timestamp()-interval '25 hours',statement_timestamp()-interval '25 hours'+interval '10 minutes',
    'consumed',statement_timestamp()-interval '25 hours',${quote(body.redemption_id)},
    sha256(convert_to(jsonb_build_object('pairing_id',${quote(p.id)}::uuid,'redemption_id',${quote(body.redemption_id)}::uuid,
     'credential_sha256',${quote(args.p_credential_sha256.slice(2))})::text,'UTF8')),
    ${quote(e.result.device_id)},${quote(e.result.credential_id)});`);
  const r = await c.send('/pairings/redeem', body);
  assert.equal(r.status, 410);assert.equal(r.body.error.code, 'pairing_unavailable');
  assert.equal((await c.send('/device', undefined, auth(body.device_credential))).status, 200);
  assert.equal(count(c.db, 'flowlink_devices'), 1);
});

test('active-device cap rejects enrollment without consuming its capability', async t => {
  const c = await make(t), p = await pair(c);
  sql(c.db, `INSERT INTO flowlink_devices(label,created_by)
   SELECT 'Capacity fixture '||n,${quote(ownerId)} FROM generate_series(1,100) n;`);
  const r = await c.send('/pairings/redeem', claim(p));assert.equal(r.status, 429);
  assert.equal(count(c.db, 'flowlink_devices'), 100);assert.equal(count(c.db, 'flowlink_device_credentials'), 0);
  assert.equal(scalar(c.db, `SELECT status FROM flowlink_pairing_capabilities WHERE id=${quote(p.pairing_id)};`), 'pending');
});
