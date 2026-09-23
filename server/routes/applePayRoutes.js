const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate, sourceConfiguration } = require('../config/applePay');
const { createAppleIngestion, safeResult } = require('../services/applePayIngestionService');

const PATH = '/api/ingestion/apple-pay';
function createApplePayRouter({ db, env = () => process.env, log = record => console.info(JSON.stringify(record)), limits = {} }) {
  const router = express.Router({ caseSensitive: true, strict: true });
  const ingest = createAppleIngestion(db);
  const sendError = (res, status, reason) => {
    res.locals.appleResult = { outcome: 'rejected', reason_code: reason };
    return res.status(status).json({ outcome: 'rejected', original_outcome: null,
      observation_id: null, transaction_id: null, disposition: 'pending',
      reason_code: reason, review_required: false, replayed: false, decision_revision: null });
  };
  router.use((req, res, next) => {
    const started = performance.now();
    res.set('Cache-Control', 'no-store');
    res.once('finish', () => {
      const result = res.locals.appleResult || {};
      log({ event: 'apple_pay.ingestion', source_kind: 'apple_pay', status: res.statusCode,
        outcome: result.outcome || 'rejected', reason_code: result.reason_code || 'request_rejected',
        observation_id: result.observation_id || null, transaction_id: result.transaction_id || null,
        duration_ms: Math.round(performance.now() - started) });
    });
    next();
  });
  // Pre-auth IP ceiling bounds invalid-token abuse. Post-auth ceiling includes retries
  // and is shared across rotating credentials, not keyed by supplied header/token.
  router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: limits.ip ?? 120,
    standardHeaders: true, legacyHeaders: false,
    handler: (req, res) => sendError(res, 429, 'rate_limited') }));
  router.use((req, res, next) => {
    const reason = authenticate(env(), req.headers.authorization);
    if (reason) return sendError(res, reason === 'unauthorized' ? 401 : 503, reason);
    if (req.headers.origin) return sendError(res, 403, 'browser_origin_not_supported');
    if (req.url.includes('?')) return sendError(res, 400, 'query_not_supported');
    next();
  });
  router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: limits.source ?? 60,
    keyGenerator: () => 'apple-shortcut', standardHeaders: true, legacyHeaders: false,
    handler: (req, res) => sendError(res, 429, 'rate_limited') }));
  router.post('/', (req, res, next) => {
    if (!req.is('application/json')) return sendError(res, 415, 'json_required');
    next();
  }, express.json({ limit: '8kb', strict: true, inflate: false }), async (req, res) => {
    try {
      let config;
      try { config = sourceConfiguration(env()); }
      catch { return sendError(res, 503, 'apple_configuration_invalid'); }
      const result = safeResult(await ingest(config, req.body));
      res.locals.appleResult = result.body;
      if (result.status === 503) res.set('Retry-After', '30');
      return res.status(result.status).json(result.body);
    } catch (error) {
      // Never pass database/parser/request details to the generic logger.
      if (error.status) return sendError(res, error.status, error.reason);
      res.set('Retry-After', '30');
      return sendError(res, 503, 'ingestion_unavailable');
    }
  });
  router.use((req, res) => sendError(res, 404, 'not_found'));
  router.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
    const status = error.type === 'entity.too.large' ? 413 : error.type === 'encoding.unsupported' ? 415 : 400;
    return sendError(res, status, status === 413 ? 'payload_too_large' : status === 415 ? 'encoding_not_supported' : 'invalid_json');
  });
  return router;
}

module.exports = { PATH, createApplePayRouter };
