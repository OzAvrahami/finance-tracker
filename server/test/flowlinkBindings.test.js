const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { gzipSync } = require('node:zlib');
const config = require('../config/flowlink');
const bindings = require('../config/flowlinkBindings');
const { harness, ownerId, token, status } = require('./helpers/flowlinkHttp');
const payment = () => ({ binding_id: randomUUID(), amount: '4.00', currency: 'ILS', merchant: 'Israel Post', transaction_date: '2026-09-26', idempotency_key: randomUUID() });
const env = () => ({ FLOWLINK_OWNER_USER_IDS: JSON.stringify([ownerId]), FLOWLINK_INGESTION_ENABLED: 'true' });
const auth = t => ({ headers: { Authorization: `Bearer ${t}` } });
const result = { outcome: 'created', observation_id: '10', transaction_id: '20', disposition: 'created', reason_code: 'no_candidate', decision_revision: '1' };
function dbStub(extra) {
  const calls = [], device = status();
  return { calls, rpc: async (name, args) => {
    calls.push({ name, args });
    if (name === 'get_flowlink_device') return { data: device };
    if (extra) return extra(name, args);
    return { data: { ...result, candidate_ids: ['999'], source_id: '101', credential_sha256: 'secret' } };
  } };
}
test('strict create/update commands preserve BIGINT strings and reject identity changes/PAN labels', () => {
  const id = randomUUID(), request_id = randomUUID();
  assert.equal(bindings.createCommand(id, { request_id, label: '  My card ', payment_source_id: '9223372036854775807' }).command.label, 'My card');
  for (const v of [1, '01', '0', '-1', '9223372036854775808']) assert.throws(() => bindings.createCommand(id, { request_id, label: 'A', payment_source_id: v }));
  for (const extra of [{}, { status: 'other' }, { label: null }, { payment_source_id: '1' }, { device_id: id }, { source_id: '1' }]) assert.throws(() => bindings.updateCommand(id, { request_id, expected_revision: '1', ...extra }));
  assert.throws(() => bindings.createCommand(id, { request_id, label: '1234-5678-9012-3456', payment_source_id: '1' }));
});
test('native amount/date/merchant validation is exact, accepts Unicode and never rounds money', () => {
  const p = payment();assert.deepEqual(bindings.walletRequest(p), p);
  for (const amount of ['0.00', '04.00', '4', '4.0', '4.001', '4e2', 4, ' 4.00', '9'.repeat(29) + '.00']) assert.throws(() => bindings.walletRequest({ ...p, amount }));
  assert.equal(bindings.walletRequest({ ...p, amount: '9'.repeat(28) + '.99', merchant: 'דואר ישראל' }).amount, '9'.repeat(28) + '.99');
  for (const extra of [{ currency: 'USD' }, { transaction_date: '2026-02-30' }, { transaction_date: null }, { transaction_date: '0000-01-01' }, { merchant: 'Attachment.txt' }, { merchant: '!!!' }, { merchant: 'a\nb' }, { merchant: 'x'.repeat(513) }]) assert.throws(() => bindings.walletRequest({ ...p, ...extra }));
});
test('only literal true enables native ingestion; management/listing unaffected and status reflects flag', async t => {
  const d = dbStub((name) => ({ data: name === 'list_flowlink_bindings' ? { bindings: [] } : { payment_sources: [], next_cursor: null } }));
  for (const value of [undefined, 'false', 'TRUE', '1', true]) {
    const c = await harness(t, { db: d, env: { ...env(), FLOWLINK_INGESTION_ENABLED: value, APPLE_PAY_INGESTION_ENABLED: 'true' } });
    const r = await c.send('/wallet-transactions', payment(), auth(token()));assert.equal(r.status, 503);assert.equal(r.body.reason_code, 'flowlink_ingestion_disabled');
    assert.equal((await c.send('/device', undefined, auth(token()))).body.ingestion_enabled, false);
    assert.equal((await c.send('/device/bindings', undefined, auth(token()))).status, 200);
    assert.equal((await c.send('/owner/payment-sources')).status, 200);
  }
  const c = await harness(t, { db: dbStub(), env: env() });assert.equal((await c.send('/device', undefined, auth(token()))).body.ingestion_enabled, true);
});
test('HTTP invokes only the authorized wrapper with digest and projects safe APY result', async t => {
  const d = dbStub(), c = await harness(t, { db: d, env: env() }), secret = token(), p = payment();
  const r = await c.send('/wallet-transactions', p, auth(secret));assert.equal(r.status, 201);
  assert.deepEqual(d.calls.map(c => c.name), ['get_flowlink_device', 'ingest_flowlink_observation']);
  assert.deepEqual(d.calls[1].args, { p_credential_sha256: config.digest(secret), p_request: p });
  for (const value of [secret, 'credential_sha256', 'source_id', 'candidate_ids', p.merchant]) assert.equal(JSON.stringify([r.body, c.logs]).includes(value), false);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});
test('HTTP rejects every unknown native field, including null, without invoking money RPC', async t => {
  const d = dbStub(), c = await harness(t, { db: d, env: env() }), a = auth(token());
  for (const field of ['payment_source_id', 'source_id', 'movement_type', 'category_id', 'transaction_id', 'occurred_at', 'provider_reference', 'payment_method', 'Card', 'Pass']) {
    const r = await c.send('/wallet-transactions', { ...payment(), [field]: null }, a);assert.equal(r.status, 400);assert.equal(r.body.reason_code, 'unsupported_field');
  }
  assert.equal(d.calls.some(c => c.name === 'ingest_flowlink_observation'), false);
});
test('device body/media/origin/query boundaries return safe APY envelopes', async t => {
  const c = await harness(t, { db: dbStub(), env: env() }), a = auth(token());
  for (const [extra, code] of [[{ raw: '{bad' }, 400], [{ raw: JSON.stringify({ merchant: 'x'.repeat(8300) }) }, 413],
    [{ headers: { ...a.headers, 'Content-Type': 'text/plain' } }, 415],
    [{ raw: gzipSync('{}'), headers: { ...a.headers, 'Content-Encoding': 'gzip' } }, 415],
    [{ headers: { ...a.headers, Origin: 'http://localhost:5173' } }, 403]]) {
    const r = await c.send('/wallet-transactions', payment(), { ...a, ...extra });assert.equal(r.status, code);assert.equal(r.body.transaction_id, null);
  }
  assert.equal((await c.send('/wallet-transactions?device_id=x', payment(), a)).status, 400);
  assert.equal((await c.send('/device/bindings?device_id=x', undefined, a)).status, 400);
});
test('wrong device credential and approved-owner JWT cannot access native money', async t => {
  const c = await harness(t, { db: dbStub(), env: env() });
  for (const value of ['test-owner-session', 'ftapy1_abc', 'wrong']) assert.equal((await c.send('/wallet-transactions', payment(), auth(value))).status, 401);
});
test('sanitized atomic auth errors override advisory middleware success', async t => {
  for (const [code, statusCode] of [['unauthorized', 401], ['binding_unavailable', 403], ['flowlink_configuration_invalid', 503]]) {
    const c = await harness(t, { db: dbStub(() => ({ data: { error: { code, detail: 'SQL secret' } } })), env: env() });
    const r = await c.send('/wallet-transactions', payment(), auth(token()));assert.equal(r.status, statusCode);assert.equal(r.body.reason_code, code);assert.equal(JSON.stringify(r.body).includes('SQL'), false);
  }
});
test('deadlock retries once with identical digest/request; transport uncertainty does not silently repost', async t => {
  let count = 0;
  const d = dbStub(() => ++count === 1 ? { error: { code: '40P01', message: 'secret' } } : { data: result });
  const c = await harness(t, { db: d, env: env() });assert.equal((await c.send('/wallet-transactions', payment(), auth(token()))).status, 201);
  assert.deepEqual(d.calls[1], d.calls[2]);
  const broken = await harness(t, { db: dbStub(() => { throw new Error('SQL credential raw'); }), env: env() });
  const r = await broken.send('/wallet-transactions', payment(), auth(token()));assert.equal(r.status, 503);assert.equal(r.body.reason_code, 'ingestion_unavailable');
});
test('authenticated device write rate bucket survives credential rotation', async t => {
  const c = await harness(t, { db: dbStub(), env: env(), limits: { write: 1 } });
  assert.equal((await c.send('/wallet-transactions', payment(), auth(token()))).status, 201);
  const second = await c.send('/wallet-transactions', payment(), auth(token()));assert.equal(second.status, 429);assert.ok(second.headers.get('retry-after'));
});
test('owner create/update/list sanitize snapshots and enforce existing owner gate', async t => {
  const b = { id: randomUUID(), device_id: randomUUID(), label: 'Card', payment_source_id: '1', source_id: '2', status: 'active', revision: '1', created_at: 'date', updated_at: 'date', retired_at: null };
  const d = dbStub((name) => ({ data: name === 'list_flowlink_owner_bindings' ? { bindings: [{ ...b, secret: 'no' }], next_cursor: null } : { ...b, secret: 'no', replayed: false } }));
  const c = await harness(t, { db: d, env: env() }), body = { request_id: randomUUID(), label: 'Card', payment_source_id: '1' };
  const url = `/owner/devices/${b.device_id}/bindings`;
  assert.equal((await c.send(url, body)).status, 201);
  const u = await c.send(`/owner/bindings/${b.id}`, { request_id: randomUUID(), expected_revision: '1', label: 'Updated' }, { method: 'PATCH' });assert.equal(u.status, 200);
  assert.equal(JSON.stringify(u.body).includes('secret'), false);assert.equal((await c.send(url)).status, 200);
  assert.equal((await c.send(url, body, auth('test-other-session'))).status, 403);
  assert.equal((await c.send(url, body, auth(token()))).status, 401);
  assert.equal(d.calls.find(x => x.name === 'create_flowlink_binding').args.p_owner_id, ownerId);
});
