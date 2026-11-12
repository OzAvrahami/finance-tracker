'use strict';

const { requireRule } = require('./errors');
const { uuid } = require('./httpContracts');
const { repositoryError } = require('./persistenceErrors');
const { frozenCopy } = require('./repository');
const { z } = require('zod');
const { identity, compareIds } = require('./contracts');
const { categoryHttpResponse } = require('../categories/categoryResponse');
const { catalogHttpResponse } = require('./catalogResponse');

const id = z.string().regex(/^-?[1-9][0-9]*$/);
const revision = z.string().regex(/^(0|[1-9][0-9]*)$/);
const productFields = { name: z.string(), category_id: id, default_unit: z.string().nullable(),
  default_price: z.string().regex(/^\d+(?:\.\d+)?$/).nullable(), is_active: z.boolean() };
const categoryChanges = z.object({ name: z.string().optional(), icon: z.string().nullable().optional(), parent_id: id.nullable().optional(),
  is_active: z.boolean().optional(), display_order: z.number().int().min(-2147483648).max(2147483647).optional() }).strict().refine(v => Object.keys(v).length > 0);
const projection = z.object({ path: z.array(z.object({ id: id.nullable(), name: z.string() }).strict()).min(1),
  effective_active: z.boolean(), counts: z.object({ direct_active: z.number().int().nonnegative(), direct_total: z.number().int().nonnegative(),
    subtree_active: z.number().int().nonnegative(), subtree_total: z.number().int().nonnegative() }).strict() }).strict();
const decisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('category.create'), values: z.object({ name: z.string(), parent_id: id.nullable(),
    icon: z.string().nullable().optional(), is_active: z.boolean(), is_neutral: z.literal(false), display_order: z.number().int() }).strict(), response: projection.optional(),
    initial_link: z.object({ list_type_id: id, revision }).strict().optional() }).strict(),
  z.object({ kind: z.literal('category.update'), id, revision, changes: categoryChanges, response: projection.optional() }).strict(),
  z.object({ kind: z.literal('product.create'), values: z.object(productFields).strict() }).strict(),
  z.object({ kind: z.literal('product.update'), id, revision, changes: z.object(productFields).partial().strict() }).strict(),
  z.object({ kind: z.literal('product.bulk-category'), updates: z.array(z.object({ id, revision,
    changes: z.object({ category_id: id }).strict() }).strict()).min(1).max(100) }).strict(),
  z.object({ kind: z.literal('branches.replace'), id, revision, category_ids: z.array(id) }).strict(),
]);

function validateDecision(intent, expected, decision) {
  requireRule(decisionSchema.safeParse(decision).success && expected && typeof expected.token === 'string'
    && expected.token.length > 0 && revision.safeParse(expected.catalog_revision).success,
  'shopping_effect_invalid');
  const kinds = { 'category.create': 'category.create', 'category.change': 'category.update', 'category.edit': 'category.update',
    'product.create': 'product.create', 'product.edit': 'product.update', 'product.deactivate': 'product.update',
    'product.bulk-category': 'product.bulk-category', 'branches.replace': 'branches.replace' };
  requireRule(Object.hasOwn(kinds, intent.operation) && kinds[intent.operation] === decision.kind, 'shopping_effect_invalid');
  if (Object.hasOwn(decision, 'id')) requireRule(decision.id === intent.id, 'shopping_effect_invalid');
  if (intent.operation === 'category.create') {
    requireRule(Object.hasOwn(intent.body, 'list_type_id') === Object.hasOwn(decision, 'initial_link')
      && (!decision.initial_link || decision.initial_link.list_type_id === identity(intent.body.list_type_id)), 'shopping_effect_invalid');
  }
  if (decision.kind === 'product.bulk-category') {
    const ids = intent.body.product_ids.map(value => identity(value)).sort(compareIds);
    requireRule(new Set(ids).size === ids.length && JSON.stringify(ids) === JSON.stringify(decision.updates.map(u => u.id))
      && decision.updates.every(u => u.changes.category_id === identity(intent.body.category_id, { signed: true })), 'shopping_effect_invalid');
  }
}

// Private in-process capability: only service-constructed plans enter commit.
// This is an accidental-boundary guard, not a sandbox against trusted server code.
const prepared = new WeakSet();
function prepareCatalogCommand({ actor, key, intent, expected, decision }) {
  validateDecision(intent, expected, decision);
  const command = frozenCopy({ p_actor: uuid(actor), p_key: key === null ? null : uuid(key),
    p_intent: intent, p_expected: expected, p_decision: decision });
  prepared.add(command);
  return command;
}

function validateCommitResult(data, intent) {
  requireRule(data && typeof data === 'object' && data.committed === true
    && typeof data.replayed === 'boolean' && Object.hasOwn(data, 'result')
    && typeof data.catalog_revision === 'string' && /^(0|[1-9][0-9]*)$/.test(data.catalog_revision),
  'shopping_commit_result_invalid');
  if (intent.operation === 'category.edit' || (intent.operation.startsWith('category.') && data.http)) categoryHttpResponse(data);
  if (data.http) catalogHttpResponse(data, intent);
  if (intent.operation === 'product.bulk-category') {
    const ids = intent.body.product_ids.map(value => identity(value)).sort(compareIds);
    requireRule(data.result?.updated === ids.length && JSON.stringify(data.result.product_ids) === JSON.stringify(ids),
      'shopping_commit_result_invalid');
  }
  return frozenCopy(data);
}

function createPersistence(supabase) {
  requireRule(typeof supabase?.rpc === 'function', 'shopping_repository_invalid');
  return Object.freeze({
    async commitCatalog(command) {
      requireRule(prepared.has(command), 'shopping_untrusted_plan');
      let response;
      try { response = await supabase.rpc('shopping_catalog_commit', command); }
      catch (error) { throw repositoryError(error, { committing: true }); }
      if (response?.error) throw repositoryError(response.error, { committing: true });
      // One operation, one transaction, one recorded result. No per-item success
      // array, compensating REST writes, fallback RPC or automatic retry.
      return validateCommitResult(response?.data, command.p_intent);
    },
  });
}

// Required DB protocol, not locks implemented in JavaScript. Catalog operations
// take K -> C-X -> affected entity rows, fixed table order / numeric PK order.
// The future SQL facade chooses this mode from the fixed operation schema.
const catalogProtocol = Object.freeze({
  rpc: 'shopping_catalog_commit', catalogLock: 'FOR UPDATE',
  order: Object.freeze(['K(actor,key)', 'C-X', 'entity rows(table,primary key)']),
  revisionIncrements: 1, maxBulkProducts: 100, atomicResult: true,
  replayBeforeExpectedState: true, freshReadAfterLocks: true,
});

module.exports = { createPersistence, prepareCatalogCommand, validateCommitResult, catalogProtocol };
