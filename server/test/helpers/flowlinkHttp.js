const express = require('express');
const { randomUUID, randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { PATH, createFlowlinkRouter } = require('../../routes/flowlinkRoutes');
const ownerId = '11111111-1111-4111-8111-111111111111';
const otherOwnerId = '22222222-2222-4222-8222-222222222222';
const token = () => 'fldev1_' + randomBytes(32).toString('base64url');
const status = () => ({ device: { id: randomUUID(), label: 'Test phone', status: 'active' },
  credential: { id: randomUUID(), revision: '1' }, protocol_version: 1 });
const claim = (pairing, deviceCredential = token()) => {
  const [, id, secret] = pairing.pairing_text.split('.');
  return { pairing_id: id, secret, redemption_id: randomUUID(), device_credential: deviceCredential };
};
async function harness(t, options = {}) {
  const calls = [], logs = [], env = options.env || { FLOWLINK_OWNER_USER_IDS: JSON.stringify([ownerId]) };
  const db = options.db || { rpc: async (name, args) => {
    calls.push({ name, args });
    if (name === 'create_flowlink_pairing') return { data: { pairing_id: args.p_pairing_id,
      expires_at: new Date(Date.now() + 600000).toISOString(), purpose: args.p_command.purpose, device_id: null } };
    if (name === 'get_flowlink_device') return { data: status() };
    if (name === 'list_flowlink_devices') return { data: { devices: [], next_cursor: null } };
    return { data: { outcome: 'paired', device_id: randomUUID(), device_label: 'Test phone',
      credential_id: randomUUID(), credential_revision: '1', replayed: false } };
  } };
  const verifyUser = options.verifyUser || (async value => value === 'test-owner-session'
    ? { data: { user: { id: ownerId } } }
    : value === 'test-other-session' ? { data: { user: { id: otherOwnerId } } } : { error: true });
  const app = express();app.set('trust proxy', 'loopback');
  app.use(PATH, createFlowlinkRouter({ db, env: () => env, verifyUser, limits: options.limits, log: row => logs.push(row) }));
  app.use((req, res) => res.status(401).json({ error: { code: 'existing_user_auth' } }));
  const server = app.listen(0, '127.0.0.1');await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve);server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}${PATH}`;
  const send = async (path, body, opts = {}) => {
    const method = opts.method || (body === undefined ? 'GET' : 'POST');
    const r = await fetch(base + path, { method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-owner-session', ...opts.headers },
      ...(method === 'GET' || method === 'OPTIONS' ? {} : { body: opts.raw ?? JSON.stringify(body) }) });
    const raw = await r.text();return { status: r.status, body: raw ? JSON.parse(raw) : null, headers: r.headers };
  };
  return { send, calls, logs, env, db };
}
module.exports = { harness, ownerId, otherOwnerId, token, claim, status };
