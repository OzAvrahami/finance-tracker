'use strict';

const { ShoppingDomainError } = require('./errors');

const statuses = Object.freeze({
  shopping_unauthenticated: 401, shopping_forbidden: 403,
  shopping_category_missing: 404, shopping_product_missing: 404, shopping_list_type_missing: 404,
  shopping_list_missing: 404, shopping_item_missing: 404,
  shopping_category_scope: 409, shopping_category_ambiguous: 409, shopping_product_ambiguous: 409,
  shopping_list_has_history: 409, shopping_list_type_in_use: 409, shopping_mapping_stale: 409, shopping_mapping_conflict: 409,
  shopping_precondition_required: 428, shopping_idempotency_required: 428,
  shopping_revision_stale: 409, shopping_key_conflict: 409, shopping_uniqueness_conflict: 409,
  shopping_legacy_result_unavailable: 409,
  shopping_reference_conflict: 409, shopping_category_sibling_duplicate: 409,
  shopping_product_collision: 409, shopping_category_unavailable: 409,
  shopping_neutral_protected: 409, shopping_neutral_parent: 409,
  shopping_category_parent_required: 409, shopping_category_cycle: 409,
  shopping_category_self_parent: 409, shopping_list_closed: 409,
  shopping_busy: 503, shopping_repository_unavailable: 503,
  shopping_snapshot_invalid: 503, shopping_commit_result_invalid: 503,
  shopping_commit_unknown: 503,
});

function repositoryError(error, { committing = false } = {}) {
  const codes = {
    '23505': 'shopping_uniqueness_conflict', '23503': 'shopping_reference_conflict',
    '23514': 'shopping_reference_conflict', '42501': 'shopping_forbidden',
    '40001': 'shopping_busy', '40P01': 'shopping_busy', '55P03': 'shopping_busy', '57014': 'shopping_busy',
  };
  const known = ['shopping_revision_stale', 'shopping_key_conflict', 'shopping_list_closed', 'shopping_list_missing', 'shopping_item_missing', 'shopping_legacy_result_unavailable', 'shopping_reference_conflict'];
  const code = codes[error?.code] || (error?.code === 'P0001' && known.includes(error.message) ? error.message : null);
  // Transport errors cannot prove rollback. Never automatically reissue a write.
  return new ShoppingDomainError(code || (committing ? 'shopping_commit_unknown' : 'shopping_repository_unavailable'));
}

function httpError(error) {
  if (!(error instanceof ShoppingDomainError)) return { status: 500, body: { error: 'shopping_internal_error', code: 'shopping_internal_error' } };
  const code = error.code;
  return { status: statuses[code] || (/^(receipt_|checkout_)/.test(code) ? 409 : 400), body: { error: code, code } };
}

module.exports = { repositoryError, httpError };
