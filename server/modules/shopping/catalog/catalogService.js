'use strict';

const { z } = require('zod');
const { requireRule } = require('../shared/errors');
const { identity, compareIds } = require('../shared/contracts');

const text = z.string().min(1).refine(value => !value.includes('\0'));
const price = z.union([z.string().regex(/^\d+(?:\.\d+)?$/), z.number().finite().nonnegative()])
  .transform(String).refine(value => /^\d+(?:\.\d+)?$/.test(value));
const fields = { name: text, category_id: z.union([z.string(), z.number()]),
  default_unit: text.nullable(), default_price: price.nullable(), is_active: z.boolean() };
const createSchema = z.object({ ...fields, default_unit: fields.default_unit.optional(),
  default_price: fields.default_price.optional(), is_active: fields.is_active.optional() }).strict();
const editSchema = createSchema.partial().refine(value => Object.keys(value).length > 0);

function parseProduct(input, { create = false } = {}) {
  const parsed = (create ? createSchema : editSchema).safeParse(input);
  requireRule(parsed.success, 'shopping_product_input_invalid');
  return parsed.data;
}

function assignableCategory(tree, value) {
  const node = tree.get(value);
  requireRule(node.effective_active, 'shopping_category_unavailable');
  return node.id; // Neutral is a valid product assignment; intermediate nodes too.
}

function rejectCollisions(products) {
  const names = new Map();
  for (const product of products) {
    const category = identity(product.category_id, { signed: true });
    if (!names.has(category)) names.set(category, new Set());
    // Preserve the approved PostgreSQL UNIQUE(category_id,name) semantics.
    // Similar/normalized product names never authorize merge or automatic rename.
    requireRule(!names.get(category).has(product.name), 'shopping_product_collision');
    names.get(category).add(product.name);
  }
}

function planProduct(tree, products, operation, id, input) {
  const byId = new Map(products.map(row => [identity(row.id), row]));
  if (operation === 'product.create') {
    const values = parseProduct(input, { create: true });
    values.category_id = assignableCategory(tree, values.category_id);
    values.is_active ??= true;
    values.default_unit ??= null;
    values.default_price ??= null; // Explicit zero is never falsy-defaulted.
    rejectCollisions([...products, values]);
    return { kind: operation, values };
  }
  const before = byId.get(identity(id));
  requireRule(before !== undefined, 'shopping_product_missing');
  const changes = operation === 'product.deactivate' ? { is_active: false } : parseProduct(input);
  if (Object.hasOwn(changes, 'category_id')) changes.category_id = assignableCategory(tree, changes.category_id);
  if (changes.is_active === true) assignableCategory(tree, changes.category_id ?? before.category_id);
  rejectCollisions(products.map(row => identity(row.id) === identity(id) ? { ...row, ...changes } : row));
  return { kind: 'product.update', id: identity(id), revision: before.revision, changes };
}

function bulkIds(values) {
  requireRule(Array.isArray(values) && values.length > 0 && values.length <= 100, 'shopping_bulk_size_invalid');
  const ids = values.map(value => identity(value));
  requireRule(new Set(ids).size === ids.length, 'shopping_bulk_duplicate');
  return ids.sort(compareIds);
}

function planBulkCategory(tree, products, input) {
  const ids = bulkIds(input.product_ids), selected = new Set(ids);
  const target = assignableCategory(tree, input.category_id);
  const byId = new Map(products.map(row => [identity(row.id), row]));
  requireRule(ids.every(id => byId.has(id)), 'shopping_product_missing');
  rejectCollisions(products.map(row => selected.has(identity(row.id)) ? { ...row, category_id: target } : row));
  return { kind: 'product.bulk-category', updates: ids.map(id => ({ id,
    revision: byId.get(id).revision, changes: { category_id: target } })) };
}

module.exports = { parseProduct, planProduct, planBulkCategory, bulkIds };
