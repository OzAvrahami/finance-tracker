'use strict';

const { isDeepStrictEqual } = require('node:util');
const { z } = require('zod');
const { requireRule } = require('./errors');
const { identity } = require('./contracts');
const { parseHeaders, policyFor, enforcePreconditions, authenticatedActor } = require('./httpContracts');
const { catalogView, frozenCopy } = require('./repository');
const { prepareCatalogCommand, validateCommitResult } = require('./persistence');
const { planCategoryCreate, planCategoryChange, planCategoryEdit } = require('../categories/categoryService');
const { categoryProjection } = require('../categories/categoryResponse');
const { validateBranchSelection } = require('../list-types/listTypeService');
const { parseProduct, planProduct, planBulkCategory, bulkIds } = require('../catalog/catalogService');
const { canonicalIntent } = require('./requestIdentity');

const idValue = z.union([z.string(), z.number()]);
const schemas = {
  'category.create': z.object({ name: z.string(), icon: z.string().nullable().optional(), parent_id: idValue.nullable(), is_active: z.boolean().optional(), display_order: z.number().optional(), list_type_id: idValue.optional() }).strict(),
  'category.edit': z.object({ name: z.string().optional(), icon: z.string().nullable().optional(), parent_id: idValue.nullable().optional(), is_active: z.boolean().optional(), display_order: z.number().optional() }).strict().refine(v => Object.keys(v).length > 0),
  'category.change': z.discriminatedUnion('type', [
    z.object({ type: z.literal('rename'), name: z.string() }).strict(),
    z.object({ type: z.literal('reparent'), parent_id: idValue.nullable() }).strict(),
    ...['activate', 'deactivate', 'delete'].map(type => z.object({ type: z.literal(type) }).strict()),
  ]),
  'product.deactivate': z.object({}).strict(),
  'product.bulk-category': z.object({ product_ids: z.array(idValue).min(1).max(100), category_id: idValue }).strict(),
  'branches.replace': z.object({ categoryIds: z.array(idValue) }).strict(),
};

function publicIntent(operation, id, body) {
  policyFor(operation);
  requireRule(body && Object.getPrototypeOf(body) === Object.prototype, 'shopping_input_invalid');
  requireRule(Object.values(body).every(value => value !== undefined), 'shopping_input_invalid');
  if (operation === 'category.create') requireRule(Object.hasOwn(body, 'parent_id'), 'shopping_category_parent_required');
  if (operation === 'product.create' || operation === 'product.edit') parseProduct(body, { create: operation === 'product.create' });
  else requireRule(schemas[operation].safeParse(body).success, 'shopping_input_invalid');
  if (operation === 'product.bulk-category') bulkIds(body.product_ids);
  const needsId = ['category.change', 'category.edit', 'product.edit', 'product.deactivate', 'branches.replace'].includes(operation);
  const target = needsId ? identity(id, { signed: operation.startsWith('category.') }) : null;
  requireRule(needsId || id === null || id === undefined, 'shopping_input_invalid');
  // Keep ORIGINAL public values for exact replay comparison. Parsed/transformed
  // defaults belong only to the decision. Headers are not public intent fields.
  return frozenCopy({ operation, id: target, body });
}

function decideCatalog(intent, snapshot) {
  const view = catalogView(snapshot), { operation, id, body } = intent;
  let decision;
  if (operation === 'category.create') {
    const { list_type_id, ...fields } = body;
    const plan = planCategoryCreate(view.tree, fields);
    decision = { kind: plan.kind, values: plan.values };
    if (list_type_id !== undefined) {
      const type = snapshot.listTypes.find(t => String(t.id) === identity(list_type_id));
      requireRule(type !== undefined, 'shopping_list_type_missing');
      decision.initial_link = { list_type_id: identity(list_type_id), revision: type.revision };
    }
  } else if (operation === 'category.change' || operation === 'category.edit') {
    const plan = operation === 'category.edit' ? planCategoryEdit(view.tree, id, body) : planCategoryChange(view.tree, { ...body, id });
    decision = { kind: plan.kind, id, revision: snapshot.categories.find(c => String(c.id) === id).revision, changes: plan.changes };
  } else if (operation === 'branches.replace') {
    const type = snapshot.listTypes.find(t => String(t.id) === id);
    requireRule(type !== undefined, 'shopping_list_type_missing');
    const branches = validateBranchSelection(view.tree, body.categoryIds);
    decision = { kind: operation, id, revision: type.revision,
      category_ids: [...branches, view.tree.neutralId] }; // Preserve system link.
  } else if (operation === 'product.bulk-category') decision = planBulkCategory(view.tree, snapshot.products, body);
  else decision = planProduct(view.tree, snapshot.products, operation, id, body);
  if (operation.startsWith('category.')) decision.response = categoryProjection(snapshot, decision);
  return frozenCopy(decision);
}

function createCatalogCommands({ repository, persistence, authorize }) {
  requireRule(typeof authorize === 'function', 'shopping_authorizer_required');
  async function actorFor(request, operation) {
    const actor = authenticatedActor(request);
    requireRule(await authorize({ actor, operation }) === true, 'shopping_forbidden');
    return actor;
  }
  return Object.freeze({
    async read(request) {
      const actor = await actorFor(request, 'catalog.read');
      return catalogView(await repository.readCatalog({ operation: 'catalog.read', actor }));
    },
    async execute(request, operation, id = null) {
      const actor = await actorFor(request, operation);
      const headers = parseHeaders(request.headers);
      const intent = publicIntent(operation, id, request.body);
      const snapshot = await repository.readCatalog({ operation, actor, key: headers.key, id: intent.id,
        productIds: operation === 'product.bulk-category' ? bulkIds(intent.body.product_ids) : [] });
      if (snapshot.command !== null) {
        const prior = snapshot.command;
        requireRule(headers.key !== null && prior.actor === actor && prior.key === headers.key, 'shopping_snapshot_invalid');
        requireRule(isDeepStrictEqual(canonicalIntent(prior.intent), canonicalIntent(intent)), 'shopping_key_conflict');
        // The immutable durable result wins before new edit preconditions and
        // current target eligibility. No browser-supplied result is accepted.
        return validateCommitResult({ committed: true, replayed: true, result: prior.result,
          catalog_revision: prior.catalog_revision, ...(prior.http === undefined ? {} : { http: prior.http }) }, intent);
      }
      enforcePreconditions(headers, operation, snapshot.etag);
      const decision = decideCatalog(intent, snapshot);
      const command = prepareCatalogCommand({ actor, key: headers.key, intent, expected: snapshot.expected, decision });
      return persistence.commitCatalog(command);
    },
  });
}

module.exports = { createCatalogCommands, publicIntent, decideCatalog };
