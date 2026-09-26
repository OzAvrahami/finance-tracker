const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('../config/flowlink');
const { createFlowlinkService, errorStatuses } = require('../services/flowlinkService');
const { requireFlowlinkOwner, requireFlowlinkDevice } = require('../middleware/flowlinkAuth');

const PATH = '/api/flowlink/v1';
const OWNER_ORIGINS = ['http://localhost:5173', 'https://finance-tracker-sigma-ten-19.vercel.app'];
function createFlowlinkRouter({ db, verifyUser = token => db.auth.getUser(token), env = () => process.env,
  log = event => console.info(JSON.stringify(event)), limits = {} }) {
  const router = express.Router({ caseSensitive: true, strict: true });
  const service = createFlowlinkService(db, env);
  const error = (res, status, code) => {
    res.locals.flowlinkCode = code;
    return res.status(status).json(res.locals.flowlinkWallet ? { outcome: 'rejected', original_outcome: null,
      observation_id: null, transaction_id: null, disposition: 'pending', review_required: false,
      reason_code: code, replayed: false, decision_revision: null } : { error: { code } });
  };
  const limit = (max, keyGenerator) => rateLimit({ windowMs: 15 * 60 * 1000, limit: max, keyGenerator,
    standardHeaders: true, legacyHeaders: false, handler: (req, res) => error(res, 429, 'rate_limited') });
  const handle = fn => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
  const json = [
    (req, res, next) => req.is('application/json') ? next() : error(res, 415, 'json_required'),
    express.json({ limit: '8kb', strict: true, inflate: false }),
    (req, res, next) => config.object(req.body, Object.keys(req.body || {})) ? next() : error(res, 400, 'invalid_input'),
  ];
  const empty = (req, res, next) => Object.keys(req.body).length ? error(res, 400, 'invalid_input') : next();
  router.use((req, res, next) => {
    res.locals.flowlinkWallet = req.path === '/wallet-transactions';
    const started = performance.now();res.set('Cache-Control', 'no-store');
    res.once('finish', () => log({ event: 'flowlink.request', status: res.statusCode,
      reason_code: res.locals.flowlinkCode || 'ok', duration_ms: Math.round(performance.now() - started) }));
    next();
  });
  router.use(limit(limits.ip ?? 120));
  router.use((req, res, next) => env().NODE_ENV === 'production' && !req.secure
    ? error(res, 403, 'https_required') : next());
  router.use((req, res, next) => {
    try { req.flowlinkOwners = config.owners(env());next(); } catch (e) { next(e); }
  });
  router.use((req, res, next) => {
    const owner = req.path === '/owner' || req.path.startsWith('/owner/');
    if (!owner && req.headers.origin) return error(res, 403, 'browser_origin_not_supported');
    if (req.url.includes('?') && !(req.method === 'GET' && (req.path === '/owner/devices' || req.path === '/owner/payment-sources' || /^\/owner\/devices\/[^/]+\/bindings$/.test(req.path)))) return error(res, 400, 'query_not_supported');
    next();
  });
  router.post('/pairings/redeem', limit(limits.redeem ?? 30), ...json, handle(async (req, res) => {
    const result = await service.redeem(req.body);res.status(result.replayed ? 200 : 201).json(result);
  }));
  const owner = express.Router({ caseSensitive: true, strict: true });
  owner.use((req, res, next) => {
    if (req.headers.origin && !OWNER_ORIGINS.includes(req.headers.origin)) return error(res, 403, 'browser_origin_not_supported');
    next();
  });
  owner.use(cors({ origin: OWNER_ORIGINS, methods: ['GET', 'POST', 'PATCH', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
  owner.use(requireFlowlinkOwner(verifyUser));
  owner.use(limit(limits.owner ?? 60, req => req.user.id));
  owner.post('/pairings', ...json, handle(async (req, res) => res.status(201).json(await service.createPairing(req.user.id, req.body))));
  owner.post('/pairings/:id/cancel', ...json, empty, handle(async (req, res) => res.json(await service.cancel(req.user.id, req.params.id))));
  owner.get('/devices', handle(async (req, res) => {
    if (!config.object(req.query, ['cursor'])) config.fail();
    res.json(await service.devices(req.query.cursor));
  }));
  owner.post('/devices/:id/revoke', ...json, empty, handle(async (req, res) => res.json(await service.revoke(req.user.id, req.params.id))));
  owner.get('/payment-sources', handle(async (req, res) => {
    if (!config.object(req.query, ['cursor'])) config.fail();
    res.json(await service.paymentSources(req.query.cursor));
  }));
  owner.get('/devices/:id/bindings', handle(async (req, res) => {
    if (!config.object(req.query, ['cursor'])) config.fail();
    res.json(await service.ownerBindings(req.params.id, req.query.cursor));
  }));
  owner.post('/devices/:id/bindings', ...json, handle(async (req, res) => {
    const result = await service.createBinding(req.user.id, req.params.id, req.body);
    res.status(result.replayed ? 200 : 201).json(result);
  }));
  owner.patch('/bindings/:id', ...json, handle(async (req, res) => res.json(await service.updateBinding(req.user.id, req.params.id, req.body))));
  router.use('/owner', owner);
  const deviceReads = limit(limits.device ?? 120, req => req.flowlinkDevice.device.id);
  router.get('/device/bindings', requireFlowlinkDevice(service), deviceReads,
    handle(async (req, res) => res.json(await service.bindings(req.flowlinkToken))));
  router.post('/wallet-transactions', (req, res, next) => env().FLOWLINK_INGESTION_ENABLED === 'true'
    ? next() : error(res, 503, 'flowlink_ingestion_disabled'), requireFlowlinkDevice(service),
    limit(limits.write ?? 60, req => req.flowlinkDevice.device.id), ...json, handle(async (req, res) => {
      const result = await service.ingest(req.flowlinkToken, req.body);
      res.locals.flowlinkCode = result.body.reason_code;res.status(result.status).json(result.body);
    }));
  router.get('/device', requireFlowlinkDevice(service), deviceReads,
    (req, res) => res.json(req.flowlinkDevice));
  router.use((req, res) => error(res, 404, 'not_found'));
  router.use((e, req, res, next) => { // eslint-disable-line no-unused-vars
    if (e.type === 'entity.too.large') return error(res, 413, 'payload_too_large');
    if (e.type === 'encoding.unsupported') return error(res, 415, 'encoding_not_supported');
    if (e.type === 'entity.parse.failed') return error(res, 400, 'invalid_json');
    const code = Object.hasOwn(errorStatuses, e.flowlinkCode) ? e.flowlinkCode : 'flowlink_unavailable';
    if ([429, 503].includes(errorStatuses[code])) res.set('Retry-After', '60');
    return error(res, errorStatuses[code], code);
  });
  return router;
}
module.exports = { PATH, createFlowlinkRouter };
