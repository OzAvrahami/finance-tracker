'use strict';

// Server-created capability. Request payloads and preview flags cannot create it.
const capabilities = new WeakSet();
const project = 'ohhvzveyreolguztcnqx';
const contract = 'hierarchy-v1';
const { owners } = require('../../../config/flowlink');
function createProductionAccess(environment) {
  if (!['fenced', 'active'].includes(environment.SHOPPING_PRODUCTION_MODE)
      || environment.SUPABASE_URL !== `https://${project}.supabase.co`
      || environment.SHOPPING_PRODUCTION_PROJECT !== project) throw Error('shopping_production_identity_invalid');
  // Owner explicitly approved reusing the existing FlowLink owner configuration.
  const ownerIds = owners(environment);
  const historicalCategoryIds = String(environment.SHOPPING_HISTORICAL_CATEGORY_IDS || '').split(',').filter(Boolean);
  if (historicalCategoryIds.length !== 25 || historicalCategoryIds.some(x => !/^\d+$/.test(x))
      || new Set(historicalCategoryIds).size !== 25) throw Error('shopping_history_configuration_required');
  const access = Object.freeze({
    mode: environment.SHOPPING_PRODUCTION_MODE, adminIds: [...ownerIds], historicalCategoryIds,
    authorize: async ({ actor }) => ownerIds.has(actor),
    middleware(req, res, next) {
      res.set('Cache-Control', 'no-store').set('X-Shopping-Contract', contract);
      if (environment.SHOPPING_PRODUCTION_MODE !== 'active') return res.status(503).set('Retry-After', '60').json({ code: 'shopping_maintenance', error: 'shopping_maintenance' });
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Shopping-Contract') !== contract) {
        return res.status(426).json({ code: 'shopping_client_upgrade_required', error: 'shopping_client_upgrade_required' });
      }
      next();
    },
  });
  capabilities.add(access);return access;
}
function isProductionAccess(access) { return capabilities.has(access); }
module.exports = { createProductionAccess, isProductionAccess, contract };
