'use strict';

const { z } = require('zod');
const { requireRule } = require('./errors');
const { identity, compareIds } = require('./contracts');
const { uuid, etag, policyFor } = require('./httpContracts');
const { repositoryError } = require('./persistenceErrors');
const { buildHierarchy } = require('../categories/hierarchy');
const { createVisibilityEngine } = require('../list-types/listTypeService');

const revision = z.string().regex(/^(0|[1-9][0-9]*)$/).max(19).refine(value => BigInt(value) <= 9223372036854775807n);
const rawId = z.union([z.string(), z.number()]);
const productRow = z.object({ id: rawId, revision, name: z.string().min(1), category_id: rawId, is_active: z.boolean(),
  default_unit: z.string().nullable(), default_price: z.string().regex(/^\d+(?:\.\d+)?$/).nullable() }).passthrough();
const envelope = z.object({
  version: z.literal(1), scope: z.literal('catalog'), operation: z.string(), complete: z.literal(true),
  expected: z.object({ catalog_revision: revision, token: z.string().min(1) }).strict(),
  etag: z.string(), categories: z.array(z.object({ revision }).passthrough()),
  products: z.array(productRow), listTypes: z.array(z.object({ revision }).passthrough()),
  links: z.array(z.object({ category_id: z.union([z.string(), z.number()]), list_type_id: z.union([z.string(), z.number()]) }).passthrough()),
  counts: z.object({ categories: z.number().int().nonnegative(), products: z.number().int().nonnegative(), listTypes: z.number().int().nonnegative(), links: z.number().int().nonnegative() }).strict(),
  command: z.union([z.null(), z.object({ actor: z.string(), key: z.string(), intent: z.unknown(), result: z.unknown(), catalog_revision: revision, http: z.object({ status: z.number().int(), headers: z.record(z.string(), z.string()) }).strict().nullable().optional() }).strict()]),
}).strict();

function frozenCopy(value) {
  const copy = structuredClone(value), stack = [copy];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object' || Object.isFrozen(node)) continue;
    Object.freeze(node); stack.push(...Object.values(node));
  }
  return copy;
}

function validateSnapshot(data, operation) {
  const parsed = envelope.safeParse(data);
  requireRule(parsed.success, 'shopping_snapshot_invalid');
  const snapshot = parsed.data;
  requireRule(snapshot.operation === operation, 'shopping_snapshot_invalid');
  for (const key of ['categories', 'products', 'listTypes', 'links']) {
    requireRule(snapshot.counts[key] === snapshot[key].length, 'shopping_snapshot_invalid');
  }
  try { etag(snapshot.etag); } catch { requireRule(false, 'shopping_snapshot_invalid'); }
  // Tokens are database-generated opaque values. Do not manufacture tokens by
  // JSON.stringify/hash or assemble a decision snapshot from paginated REST.
  return frozenCopy(snapshot);
}

function createRepository(supabase) {
  requireRule(typeof supabase?.rpc === 'function', 'shopping_repository_invalid');
  return Object.freeze({
    async readCatalog({ operation, actor, key = null, id = null, productIds = [] }) {
      if (operation !== 'catalog.read') policyFor(operation);
      const ids = { actor: uuid(actor), request_key: key === null ? null : uuid(key), operation,
        id: id === null ? null : identity(id, { signed: true }), product_ids: productIds.map(value => identity(value)) };
      let response;
      try { response = await supabase.rpc('shopping_state', { p_scope: 'catalog', p_ids: ids }); }
      catch (error) { throw repositoryError(error); }
      if (response?.error) throw repositoryError(response.error);
      return validateSnapshot(response?.data, operation);
    },
  });
}

function catalogView(snapshot) {
  // This is the Gate 3A authority, not database filtering or a second engine.
  let tree, visibility;
  try {
    tree = buildHierarchy(snapshot.categories);
    visibility = createVisibilityEngine(tree, snapshot);
  } catch { requireRule(false, 'shopping_snapshot_invalid'); }
  const products = new Map(snapshot.products.map(p => [identity(p.id), p]));
  return Object.freeze({ tree, visibility, etag: snapshot.etag,
    categories: options => tree.categories(options),
    product(id) {
      const value = products.get(identity(id));
      requireRule(value !== undefined, 'shopping_product_missing');
      return frozenCopy(value); // Explicit identity reads retain inactive/history.
    },
    products: ({ includeInactive = false } = {}) => {
      requireRule(typeof includeInactive === 'boolean', 'shopping_input_invalid');
      return frozenCopy([...products.values()].filter(p => includeInactive || (p.is_active && tree.get(p.category_id).effective_active))
        .sort((a, b) => compareIds(identity(a.id), identity(b.id))));
    },
    listTypes: () => frozenCopy(snapshot.listTypes),
    branches: () => frozenCopy(snapshot.links),
  });
}

module.exports = { createRepository, validateSnapshot, catalogView, frozenCopy };
