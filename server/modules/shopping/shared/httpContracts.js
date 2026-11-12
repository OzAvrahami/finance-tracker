'use strict';

const { z } = require('zod');
const { requireRule } = require('./errors');

const uuidSchema = z.string().uuid();
function uuid(value) {
  requireRule(uuidSchema.safeParse(value).success, 'shopping_uuid_invalid');
  return value.toLowerCase();
}

function etag(value) {
  // A single strong, quoted, server-issued token. No wildcard/weak/list forms.
  requireRule(typeof value === 'string' && /^"[\x21\x23-\x7e]+"$/.test(value), 'shopping_if_match_invalid');
  return value;
}

function parseHeaders(headers = {}) {
  const values = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (key !== 'if-match' && key !== 'idempotency-key') continue;
    requireRule(!Object.hasOwn(values, key), 'shopping_header_duplicate');
    requireRule(typeof value === 'string', 'shopping_header_invalid');
    values[key] = value;
  }
  return Object.freeze({
    ifMatch: values['if-match'] === undefined ? null : etag(values['if-match']),
    key: values['idempotency-key'] === undefined ? null : uuid(values['idempotency-key']),
  });
}

// Only catalog administration is wired into this foundation. These are the
// approved category/product/branch requirements, not new production middleware.
const policies = Object.freeze({
  'category.create': Object.freeze({ revision: false, key: false }),
  'category.change': Object.freeze({ revision: true, key: false }),
  'category.edit': Object.freeze({ revision: true, key: false }),
  'product.create': Object.freeze({ revision: false, key: true }),
  'product.edit': Object.freeze({ revision: true, key: true }),
  'product.deactivate': Object.freeze({ revision: true, key: true }),
  'product.bulk-category': Object.freeze({ revision: true, key: true }),
  'branches.replace': Object.freeze({ revision: true, key: false }),
});

function policyFor(operation) {
  requireRule(Object.hasOwn(policies, operation), 'shopping_operation_invalid');
  return policies[operation];
}

function enforcePreconditions(headers, operation, currentEtag) {
  const policy = policyFor(operation);
  // Called only AFTER authenticated durable replay inspection.
  requireRule(!policy.revision || headers.ifMatch !== null, 'shopping_precondition_required');
  requireRule(!policy.key || headers.key !== null, 'shopping_idempotency_required');
  if (headers.ifMatch !== null) requireRule(headers.ifMatch === etag(currentEtag), 'shopping_revision_stale');
}

// req.user must come from the existing requireAuth/getUser middleware, never
// body fields or unverified JWT decoding. No new ownership/tenant policy here.
function authenticatedActor(request) {
  requireRule(request?.user?.id !== undefined, 'shopping_unauthenticated');
  return uuid(request.user.id);
}

module.exports = { uuid, etag, parseHeaders, policyFor, enforcePreconditions, authenticatedActor };
