'use strict';

const { requireRule } = require('./errors');
const { categoryHttpResponse } = require('../categories/categoryResponse');
const { identity, compareIds } = require('./contracts');

// Only durable application metadata is replayable. Never forward transport,
// session or authorization headers from a ledger or from a caller.
function catalogHttpResponse(commit, intent) {
  requireRule(commit?.http != null, 'shopping_legacy_result_unavailable');
  const { http, result } = commit;
  const status = intent.operation.endsWith('.create') ? 201 : 200;
  requireRule(http.status === status && http.headers && Object.keys(http.headers).length === 1
    && /^"[a-f0-9]{64}"$/.test(http.headers.ETag || ''), 'shopping_commit_result_invalid');
  if (intent.operation.startsWith('category.')) return categoryHttpResponse(commit);
  if (['product.create', 'product.edit', 'product.deactivate'].includes(intent.operation)) {
    requireRule(typeof result?.id === 'string' && typeof result.name === 'string'
      && typeof result.category_id === 'string' && /^(0|[1-9][0-9]*)$/.test(result.revision || '')
      && typeof result.is_active === 'boolean' && typeof result.created_at === 'string'
      && typeof result.updated_at === 'string' && (result.default_unit === null || typeof result.default_unit === 'string')
      && (result.default_price === null || (typeof result.default_price === 'string' && /^\d+(?:\.\d+)?$/.test(result.default_price))), 'shopping_commit_result_invalid');
    requireRule(identity(result.id) === result.id && identity(result.category_id, { signed: true }) === result.category_id
      && (intent.operation === 'product.create' || result.id === intent.id), 'shopping_commit_result_invalid');
  } else if (intent.operation === 'branches.replace') {
    requireRule(result?.linked === intent.body.categoryIds.length && Object.keys(result).length === 1, 'shopping_commit_result_invalid');
  } else {
    const expected = intent.body.product_ids?.map(value => identity(value)).sort(compareIds);
    requireRule(intent.operation === 'product.bulk-category' && result?.updated === expected?.length
      && JSON.stringify(result.product_ids) === JSON.stringify(expected), 'shopping_commit_result_invalid');
  }
  return { status: http.status, headers: { ETag: http.headers.ETag }, body: structuredClone(result) };
}

module.exports = { catalogHttpResponse };
