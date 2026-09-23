const express = require('express');
const helmet = require('helmet');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { once } = require('node:events');
const { PATH, createApplePayRouter } = require('../../routes/applePayRoutes');
const token = () => 'ftapy1_' + randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('hex');
const configuration = () => ({ instance_key: 'test-iphone', request_key: randomUUID(),
  card_mappings: [{ card_reference: 'Wallet test card', payment_source_id: '1' }], time_verified: false });
const environment = (credential, config = configuration()) => ({ APPLE_PAY_INGESTION_ENABLED: 'true',
  APPLE_PAY_TOKEN_SHA256: digest(credential), APPLE_PAY_SOURCE_CONFIG: JSON.stringify(config) });
const purchase = extra => ({ amount: '84.90', currency: 'ILS', merchant: 'AROMA', transaction_date: '2026-09-22',
  payment_method: 'Wallet test card', idempotency_key: randomUUID(), ...extra });
const created = extra => ({ outcome: 'created', original_outcome: null, observation_id: '2', transaction_id: '3',
  disposition: 'created', review_required: false, reason_code: 'no_candidate', replayed: false, decision_revision: '1', ...extra });
async function listen(t, app) {
  const server = app.listen(0, '127.0.0.1');await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve);server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
async function harness(t, options = {}) {
  const credential = options.credential || token(), env = options.env || environment(credential), calls = [], logs = [];
  const db = options.db || { rpc: async (name, args) => { calls.push({ name, args });
    return { data: name === 'configure_ingestion_source' ? { source_id: '1', revision: '1' } : created() }; } };
  const app = express();app.use(helmet());
  app.use(PATH, createApplePayRouter({ db, env: () => env, log: record => logs.push(record), limits: options.limits }));
  app.use((req, res) => res.status(401).json({ error: 'owner_jwt_required' }));
  const base = await listen(t, app);
  const send = async (body = purchase(), opts = {}) => {
    const response = await fetch(base + (opts.path || PATH), { method: opts.method || 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', ...opts.headers },
      ...((opts.method || 'POST') === 'GET' ? {} : { body: opts.raw !== undefined ? opts.raw : JSON.stringify(body) }) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  return { send, env, calls, logs, credential, base };
}
module.exports = { harness, listen, token, digest, environment, configuration, purchase, created, PATH };
