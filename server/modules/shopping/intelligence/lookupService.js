'use strict';
const { randomUUID } = require('node:crypto');
const { requireRule } = require('../shared/errors');
const { identifier } = require('../../../services/shoppingProductIdentifiers');
const { fetchFoodProduct } = require('../../../services/shoppingProductLookup');
const { commercialProduct } = require('../../../services/shoppingCommercialProducts');
const { find } = require('../catalog/commercialService');
function cacheKey(row, body) { return row.code === body.code && row.provider === body.provider && row.environment === body.environment; }
function planLookup(facts, intent) {
  const b = intent.body, now = Date.parse(facts.db_time);
  requireRule(identifier(b.code) && ['open_food_facts', 'open_products_facts'].includes(b.provider) && ['production', 'staging'].includes(b.environment), 'shopping_input_invalid');
  const row = facts.cache.find(r => cacheKey(r, b));
  if (intent.operation === 'lookup.claim') {
    if (row && Date.parse(row.expires_at) > now) return { kind: 'lookup.result', result: { claimed: false, result: row.result }, valid_until: row.expires_at };
    const requests = facts.cache.filter(r => Date.parse(r.requested_at) > now - 60000);
    if (requests.length >= 12) return { kind: 'lookup.result', result: { claimed: false, result: { status: 'rate_limited' } }, valid_until: new Date(Math.min(...requests.map(r => Date.parse(r.requested_at))) + 60000).toISOString() };
    return { kind: 'lookup.claim', lease_id: b.lease_id, expires_at: new Date(now + 300000).toISOString(), valid_until: new Date(now + 1000).toISOString() };
  }
  requireRule(row && row.lease_id === b.lease_id && row.result.status === 'pending' && Date.parse(row.expires_at) > now, 'shopping_lookup_lease_stale');
  const seconds = b.result.status === 'found' ? 2592000 : b.result.status === 'missing' ? 86400 : 300;
  return { kind: 'lookup.finalize', lease_id: b.lease_id, result: b.result, expires_at: new Date(now + seconds * 1000).toISOString(), valid_until: row.expires_at };
}
function createWorkflowLookup(commands, options = {}) {
  return async (request, input) => {
    const key = identifier(input.code, input.kind, input.retailer_scope);
    if (!key) return { status: 'invalid_identifier' };
    const local = find(await commands.read(request, 'commercial.read'), key);
    if (local?.approved_name) return { status: 'found', product: commercialProduct(local, key) };
    if (key.kind !== 'gtin') return { status: 'missing' };
    const provider = input.provider ?? 'open_food_facts';
    const environment = provider === 'open_products_facts' || (options.env ?? process.env).SHOPPING_PRODUCT_LOOKUP_ENV === 'production' ? 'production' : 'staging';
    const lease = randomUUID(), body = { code: key.code, provider, environment, lease_id: lease };
    const internal = { user: request.user, headers: { 'Idempotency-Key': randomUUID() } };
    const claim = await commands.execute(internal, 'lookup.claim', null, body, planLookup);
    if (!claim.result.claimed) return claim.result.result;
    // Provider transport is unchanged and occurs outside every DB transaction.
    const result = await (options.fetchProduct ?? fetchFoodProduct)(key.code, { ...options, provider });
    await commands.execute({ user: request.user, headers: { 'Idempotency-Key': randomUUID() } }, 'lookup.finalize', null, { ...body, result }, planLookup);
    return result;
  };
}
module.exports = { planLookup, createWorkflowLookup };
