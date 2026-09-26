const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const config = require('../config/flowlink');
const { createFlowlinkService } = require('../services/flowlinkService');
const { harness, ownerId, otherOwnerId, token, claim, status } = require('./helpers/flowlinkHttp');

test('owner allowlist is strict, bounded, UUID-based, and fail-closed', () => {
  for (const raw of [undefined, '', '[]', 'null', '{}', ownerId, '["owner@example.com"]',
    JSON.stringify([ownerId, ownerId]), JSON.stringify([ownerId.toUpperCase()]), JSON.stringify(Array(11).fill(ownerId))]) {
    // ownerId consists only of digits; uppercase is still canonical, test a letter UUID separately.
    if (raw === JSON.stringify([ownerId])) continue;
    assert.throws(() => config.owners({ FLOWLINK_OWNER_USER_IDS: raw }), /flowlink_configuration_invalid/);
  }
  assert.throws(() => config.owners({ FLOWLINK_OWNER_USER_IDS: '["AAAAAAAA-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]' }));
  assert.deepEqual([...config.owners({ FLOWLINK_OWNER_USER_IDS: JSON.stringify([ownerId, otherOwnerId]) })], [ownerId, otherOwnerId]);
});
test('credentials use canonical 32-byte base64url and hash the entire versioned token', () => {
  const value = token();assert.equal(config.credential(value), true);
  assert.equal(config.digest(value), '\\x' + createHash('sha256').update(value).digest('hex'));
  for (const bad of [value + '=', value + ' ', value.slice(1), 'ftapy1_' + value.slice(7), {}, value.slice(0, -1)]) assert.equal(config.credential(bad), false);
  const valid = 'A'.repeat(43);assert.equal(config.secret(valid), true);assert.equal(config.secret('A'.repeat(42) + 'B'), false);
});
test('pairing format is separate high-entropy material and redemption transports hashes only', () => {
  const p = config.newPairing(), body = claim({ pairing_text: p.text }), normalized = config.redemption(body);
  assert.match(p.text, /^flpair1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(normalized.p_secret_sha256, config.digest(p.text));assert.equal(normalized.p_credential_sha256, config.digest(body.device_credential));
  assert.equal(JSON.stringify(normalized).includes(body.device_credential), false);
  assert.throws(() => config.redemption({ ...body, device_id: randomUUID() }));
});
test('labels and owner commands reject control/PAN/unknown fields', () => {
  assert.deepEqual(config.pairingCommand({ purpose: 'enroll', label: '  Test phone  ' }), { purpose: 'enroll', label: 'Test phone' });
  for (const label of ['', ' ', 'x'.repeat(81), '1234 5678 9012 3456', 'test\u202e', {}, 'a\nb']) assert.throws(() => config.label(label));
  for (const body of [{ purpose: 'enroll', label: 'phone', owner_id: ownerId }, { purpose: 'replace_credential', device_id: 'bad' }, []]) assert.throws(() => config.pairingCommand(body));
});
test('cursor is bounded, canonical and typed', () => {
  const c = { id: randomUUID(), created_at: '2026-09-26T10:00:00.123456+00:00' };
  assert.deepEqual(config.cursor(Buffer.from(JSON.stringify(c)).toString('base64url')), c);
  for (const value of ['', 'a'.repeat(257), '!', Buffer.from('{"id":"bad","created_at":"infinity"}').toString('base64url'), ['abc']]) assert.throws(() => config.cursor(value));
});
test('approved owner creates capability, with only digests passed to RPC and no secrets in logs', async t => {
  const c = await harness(t), r = await c.send('/owner/pairings', { purpose: 'enroll', label: 'Phone' });
  assert.equal(r.status, 201);assert.match(r.body.pairing_text, /^flpair1\./);
  assert.equal(c.calls[0].args.p_owner_id, ownerId);assert.equal(c.calls[0].args.p_secret_sha256, config.digest(r.body.pairing_text));
  assert.equal(JSON.stringify(c.logs).includes(r.body.pairing_text), false);assert.equal(JSON.stringify(c.calls).includes(r.body.pairing_text), false);
});
test('non-owner user and missing/invalid/device sessions cannot manage enrollment', async t => {
  const c = await harness(t);
  for (const [auth, expected] of [['Bearer test-other-session', 403], ['', 401], ['Bearer bad', 401], [`Bearer ${token()}`, 401]]) {
    assert.equal((await c.send('/owner/pairings', { purpose: 'enroll', label: 'Phone' }, { headers: { Authorization: auth } })).status, expected);
  }
  assert.equal(c.calls.length, 0);
});
test('multiple configured approved owners share management authority', async t => {
  const c = await harness(t, { env: { FLOWLINK_OWNER_USER_IDS: JSON.stringify([ownerId, otherOwnerId]) } });
  assert.equal((await c.send('/owner/devices', undefined, { headers: { Authorization: 'Bearer test-other-session' } })).status, 200);
});
test('missing/malformed/empty owner configuration disables owner, redeem and device routes', async t => {
  const c = await harness(t);
  for (const raw of [undefined, '', '[]', 'broken']) {
    c.env.FLOWLINK_OWNER_USER_IDS = raw;
    for (const [path, body] of [['/owner/devices'], ['/device'], ['/pairings/redeem', {}]]) {
      const r = await c.send(path, body);assert.equal(r.status, 503);assert.equal(r.body.error.code, 'flowlink_configuration_invalid');
    }
  }
  assert.equal(c.calls.length, 0);
});
test('redemption needs no JWT but requires strict body-only proof', async t => {
  const c = await harness(t), body = claim({ pairing_text: config.newPairing().text });
  assert.equal((await c.send('/pairings/redeem', body, { headers: { Authorization: '' } })).status, 201);
  for (const b of [{}, { ...body, source_id: '1' }, { ...body, secret: null }, { ...body, redemption_id: 'bad' }, { ...body, device_credential: {} }]) {
    assert.equal((await c.send('/pairings/redeem', b)).status, 400);
  }
});
test('bounded parser rejects malformed, oversized, array, non-JSON and compressed inputs safely', async t => {
  const c = await harness(t);
  for (const [raw, headers, statusCode] of [['{', {}, 400], ['[]', {}, 400], ['{"label":"' + 'x'.repeat(9000) + '"}', {}, 413],
    ['secret', { 'Content-Type': 'text/plain' }, 415], ['{}', { 'Content-Encoding': 'gzip' }, 415]]) {
    const r = await c.send('/owner/pairings', {}, { raw, headers });assert.equal(r.status, statusCode);assert.deepEqual(Object.keys(r.body), ['error']);
  }
  assert.equal(c.calls.length, 0);
});
test('query credentials/browser device access are rejected before any DB operation', async t => {
  const c = await harness(t);
  assert.equal((await c.send('/pairings/redeem?secret=redacted', {})).status, 400);
  assert.equal((await c.send('/device?token=redacted')).status, 400);
  assert.equal((await c.send('/device', undefined, { headers: { Origin: 'https://example.invalid' } })).status, 403);
  assert.equal((await c.send('/owner/devices?token=redacted')).status, 400);
  assert.equal(c.calls.length, 0);assert.equal(JSON.stringify(c.logs).includes('redacted'), false);
});
test('owner CORS allows only the existing web origins and safe preflight', async t => {
  const c = await harness(t);
  assert.equal((await c.send('/owner/devices', undefined, { headers: { Origin: 'https://example.invalid' } })).status, 403);
  const r = await c.send('/owner/pairings', undefined, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(r.status, 204);assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:5173');
});
test('production requires HTTPS as reported by the trusted reverse proxy', async t => {
  const c = await harness(t, { env: { NODE_ENV: 'production', FLOWLINK_OWNER_USER_IDS: JSON.stringify([ownerId]) } });
  assert.equal((await c.send('/owner/devices')).status, 403);
  assert.equal((await c.send('/owner/devices', undefined, { headers: { 'X-Forwarded-Proto': 'https' } })).status, 200);
});
test('device authentication rechecks current DB state and projects no private fields', async t => {
  let active = true, calls = 0;const d = status();d.device.owner = ownerId;d.credential.digest = 'DO_NOT_EXPOSE';
  const c = await harness(t, { db: { rpc: async () => { calls++;return { data: active ? d : { error: { code: 'unauthorized' } } }; } } });
  const auth = { headers: { Authorization: `Bearer ${token()}` } };
  const r = await c.send('/device', undefined, auth);assert.equal(r.status, 200);assert.equal(r.body.ingestion_enabled, false);
  assert.equal(JSON.stringify(r.body).includes('DO_NOT_EXPOSE'), false);assert.equal(JSON.stringify(r.body).includes(ownerId), false);
  active = false;assert.equal((await c.send('/device', undefined, auth)).status, 401);assert.equal(calls, 2);
});
test('device rejects broad credentials and client-selected identity', async t => {
  const c = await harness(t);
  for (const value of ['', 'test-owner-session', 'ftapy1_' + token().slice(7), token() + ' ']) {
    // HTTP implementations trim trailing header whitespace; test malformed token with internal whitespace.
    const auth = value.endsWith(' ') ? value.slice(0, 9) + ' ' + value.slice(9) : value;
    assert.equal((await c.send('/device', undefined, { headers: { Authorization: 'Bearer ' + auth } })).status, 401);
  }
  assert.equal((await c.send('/device?device_id=' + randomUUID())).status, 400);
  assert.equal(c.calls.length, 0);
});
test('device credentials cannot reach owner payment sources or unimplemented review endpoints', async t => {
  const c = await harness(t);
  for (const path of ['/wallet-transactions', '/owner/payment-sources', '/review', '/cancel']) {
    assert.equal((await c.send(path, undefined, { headers: { Authorization: `Bearer ${token()}` } })).status, path.startsWith('/owner') ? 401 : 404);
  }
});
test('owner cancellation/revocation reject extra fields and malformed UUIDs', async t => {
  const c = await harness(t);
  for (const path of ['/owner/pairings/bad/cancel', '/owner/devices/bad/revoke']) assert.equal((await c.send(path, {})).status, 400);
  assert.equal((await c.send(`/owner/devices/${randomUUID()}/revoke`, { device_id: randomUUID() })).status, 400);
  assert.equal(c.calls.length, 0);
});
test('rate limiting returns safe 429 for capability guessing', async t => {
  const c = await harness(t, { limits: { redeem: 2 } });
  await c.send('/pairings/redeem', {});await c.send('/pairings/redeem', {});
  const r = await c.send('/pairings/redeem', {});assert.equal(r.status, 429);assert.ok(r.headers.get('retry-after'));
});
test('owner and per-device limits use authenticated identity', async t => {
  const d = status(), c = await harness(t, { limits: { owner: 1, device: 1 }, db: { rpc: async name => ({ data: name === 'get_flowlink_device' ? d : { devices: [], next_cursor: null } }) } });
  await c.send('/owner/devices');assert.equal((await c.send('/owner/devices')).status, 429);
  const opts = { headers: { Authorization: `Bearer ${token()}` } };
  await c.send('/device', undefined, opts);assert.equal((await c.send('/device', undefined, opts)).status, 429);
});
test('database/parser/auth exceptions do not leak secret details', async t => {
  const secret = token();const c = await harness(t, { db: { rpc: async () => { throw new Error(secret); } } });
  const r = await c.send('/owner/devices');assert.equal(r.status, 503);assert.equal(JSON.stringify([r.body, c.logs]).includes(secret), false);
  const d = await harness(t, { verifyUser: async () => { throw new Error(secret); } });
  assert.equal((await d.send('/owner/devices')).status, 401);assert.equal(JSON.stringify(d.logs).includes(secret), false);
});
test('service retries only transient SQL failures once with identical hashed command', async () => {
  const calls = [];const s = createFlowlinkService({ rpc: async (name, args) => {
    calls.push(args);return calls.length === 1 ? { error: { code: '40001' } } : { data: { pairing_id: args.p_pairing_id, purpose: 'enroll', device_id: null, expires_at: 'future' } };
  } });
  await s.createPairing(ownerId, { purpose: 'enroll', label: 'Phone' });assert.equal(calls.length, 2);assert.deepEqual(calls[0], calls[1]);
});
