'use strict';

const { buildHierarchy } = require('./hierarchy');
const { requireRule } = require('../shared/errors');

// Policy/presentation belongs to JavaScript. SQL only binds this projection to
// the validated source token, persisted row and transaction's response metadata.
function categoryProjection(snapshot, decision) {
  if (decision.kind === 'category.create') {
    const tree = buildHierarchy(snapshot.categories), parent = decision.values.parent_id;
    return { path: [...(parent === null ? [] : tree.path(parent)), { id: null, name: decision.values.name }],
      effective_active: decision.values.is_active && (parent === null || tree.get(parent).effective_active),
      counts: { direct_active: 0, direct_total: 0, subtree_active: 0, subtree_total: 0 } };
  }
  const tree = buildHierarchy(snapshot.categories.map(c => String(c.id) === decision.id ? { ...c, ...decision.changes } : c));
  const direct = snapshot.products.filter(p => String(p.category_id) === decision.id);
  const subtree = snapshot.products.filter(p => tree.isDescendant(p.category_id, decision.id, { includeSelf: true }));
  return { path: tree.path(decision.id), effective_active: tree.get(decision.id).effective_active,
    counts: { direct_active: direct.filter(p => p.is_active).length, direct_total: direct.length,
      subtree_active: subtree.filter(p => p.is_active).length, subtree_total: subtree.length } };
}

// Future controllers use this recorded representation, never a post-commit read.
// Pre-061 ledger records cannot supply a historical full response: fail closed.
function categoryHttpResponse(commit) {
  requireRule(commit?.http !== null && commit?.http !== undefined, 'shopping_legacy_result_unavailable');
  const { result, http } = commit;
  requireRule([200, 201].includes(http.status) && /^"[a-f0-9]{64}"$/.test(http.headers?.ETag || '')
    && typeof result?.id === 'string' && typeof result.name === 'string'
    && typeof result.revision === 'string' && Object.hasOwn(result, 'icon')
    && typeof result.created_at === 'string' && typeof result.updated_at === 'string'
    && Array.isArray(result.path) && typeof result.effective_active === 'boolean' && result.counts,
  'shopping_commit_result_invalid');
  return { status: http.status, headers: { ...http.headers }, body: structuredClone(result) };
}

module.exports = { categoryProjection, categoryHttpResponse };
