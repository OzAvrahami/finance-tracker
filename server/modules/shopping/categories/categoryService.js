'use strict';

const { buildHierarchy } = require('./hierarchy');
const { requireRule } = require('../shared/errors');
const { record, boolean, displayOrder, categoryName, categoryNameKey } = require('../shared/contracts');

function ordinaryParent(tree, value) {
  if (value === null) return null;
  const parent = tree.get(value);
  requireRule(!parent.is_neutral, 'shopping_neutral_parent');
  return parent.id;
}

function onlyFields(input, fields) {
  requireRule(Object.keys(record(input)).every(key => fields.includes(key)), 'shopping_category_change_invalid');
}

// Existing HTTP icon semantics: trim, empty/null clears. No invented icon enum.
function categoryIcon(value) {
  requireRule(value === null || (typeof value === 'string' && !value.includes('\0')), 'shopping_category_icon_invalid');
  return value === null ? null : value.trim() || null;
}

function planCategoryEdit(tree, id, input) {
  onlyFields(input, ['name', 'icon', 'parent_id', 'is_active', 'display_order']);
  requireRule(Object.keys(input).length > 0, 'shopping_category_change_invalid');
  const before = tree.get(id);
  requireRule(!before.is_neutral, 'shopping_neutral_protected');
  const changes = {};
  for (const [key, value] of Object.entries(input)) {
    requireRule(value !== undefined, 'shopping_category_change_invalid');
    if (key === 'name') changes.name = categoryName(value);
    else if (key === 'icon') changes.icon = categoryIcon(value);
    else if (key === 'parent_id') changes.parent_id = ordinaryParent(tree, value);
    else if (key === 'is_active') changes.is_active = boolean(value);
    else {
      changes.display_order = displayOrder(value);
      requireRule(value >= -2147483648 && value <= 2147483647, 'shopping_order_invalid');
    }
  }
  // Validate the FINAL graph once: a combined rename/move may be valid even
  // where either intermediate state would collide. Never persist intermediate states.
  buildHierarchy(tree.categories({ includeInactive: true }).map(node => node.id === before.id ? { ...node, ...changes } : node));
  return Object.freeze({ kind: 'category.update', id: before.id, before,
    changes: Object.freeze(changes), preservesReferences: true, requiresCatalogRevision: true });
}

// Plans are decisions on a supplied snapshot, NOT write authorization or RPC
// arguments. Gate 3B must bind them to authenticated current facts/revisions and
// atomically recheck expected state; callers must never persist them blindly.
function planCategoryCreate(tree, input) {
  onlyFields(input, ['name', 'icon', 'parent_id', 'is_active', 'display_order']);
  const values = {
    name: categoryName(input.name), parent_id: ordinaryParent(tree, input.parent_id),
    is_active: input.is_active === undefined ? true : boolean(input.is_active),
    is_neutral: false, display_order: displayOrder(input.display_order),
  };
  requireRule(values.display_order >= -2147483648 && values.display_order <= 2147483647, 'shopping_order_invalid');
  if (Object.hasOwn(input, 'icon')) values.icon = categoryIcon(input.icon);
  const key = categoryNameKey(values.name);
  requireRule(!tree.categories({ includeInactive: true }).some(n => n.parent_id === values.parent_id && n.name_key === key),
    'shopping_category_sibling_duplicate');
  // No guessed ID: a later atomic persistence operation allocates the identity.
  return Object.freeze({ kind: 'category.create', values: Object.freeze(values), requiresCatalogRevision: true });
}

function planCategoryChange(tree, intent) {
  record(intent);
  const before = tree.get(intent.id);
  requireRule(!before.is_neutral, 'shopping_neutral_protected');
  let changes;
  switch (intent.type) {
    case 'rename':
      onlyFields(intent, ['type', 'id', 'name']);
      changes = { name: categoryName(intent.name) };
      break;
    case 'reparent':
      onlyFields(intent, ['type', 'id', 'parent_id']);
      changes = { parent_id: ordinaryParent(tree, intent.parent_id) };
      break;
    case 'activate': case 'deactivate': case 'delete':
      onlyFields(intent, ['type', 'id']);
      // Approved admin DELETE is deactivation, even for unreferenced categories.
      // Descendant flags/products/links/history are never rewritten or removed.
      changes = { is_active: intent.type === 'activate' };
      break;
    default:
      requireRule(false, 'shopping_category_change_invalid');
  }
  const snapshot = tree.categories({ includeInactive: true });
  buildHierarchy(snapshot.map(node => node.id === before.id ? { ...node, ...changes } : node));
  return Object.freeze({ kind: 'category.update', id: before.id, before,
    changes: Object.freeze(changes), preservesReferences: true, requiresCatalogRevision: true });
}

module.exports = { planCategoryCreate, planCategoryChange, planCategoryEdit };
