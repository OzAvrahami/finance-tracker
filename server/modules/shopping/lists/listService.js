'use strict';

const { requireRule } = require('../shared/errors');
const { identity, categoryNameKey, record } = require('../shared/contracts');
const { catalogView } = require('../shared/repository');
const { planCategoryCreate } = require('../categories/categoryService');
const { normalizeShoppingListFields } = require('../../../utils/shoppingListFields');
const { planningUnit, supportedPlanningUnit } = require('../../../../shared/shoppingEntryOptions.mjs');

const has = (o, k) => Object.hasOwn(o, k);
function fields(body, allowed) {
  record(body);
  requireRule(Object.keys(body).every(k => allowed.includes(k) && body[k] !== undefined), 'shopping_input_invalid');
}
function text(value, max, nullable = true) {
  if (value === null && nullable) return null;
  requireRule(typeof value === 'string' && !value.includes('\0') && value.length <= max, 'shopping_input_invalid');
  const result = value.trim();
  requireRule(nullable || result.length > 0, 'shopping_input_invalid');
  return result || null;
}
// Decimal strings are validated without money arithmetic or binary rounding.
function numberText(value, maximum, { nullable = false, positive = false, places = 12 } = {}) {
  if (nullable && (value === null || value === '')) return null;
  const s = String(value);
  requireRule((typeof value === 'string' || typeof value === 'number') && new RegExp(`^\\d{1,9}(?:\\.\\d{1,${places}})?$`).test(s), 'shopping_item_invalid');
  const [whole, fraction = ''] = s.split('.'), scale = 10n ** BigInt(fraction.length);
  const exact = BigInt(whole) * scale + BigInt(fraction || '0');
  requireRule(exact <= BigInt(maximum) * scale && (!positive || exact > 0n), 'shopping_item_invalid');
  return s;
}
function list(facts, id) {
  const row = facts.lists.find(x => String(x.id) === identity(id));
  requireRule(row, 'shopping_list_missing');
  return row;
}
function openList(facts, id) {
  const row = list(facts, id);
  requireRule(['draft', 'active'].includes(row.status) && !facts.checkouts.some(c => String(c.list_id) === String(row.id)), 'shopping_list_closed');
  return row;
}
function item(facts, listId, itemId) {
  const row = facts.items.find(x => String(x.id) === identity(itemId) && String(x.list_id) === identity(listId));
  requireRule(row, 'shopping_item_missing');
  return row;
}
function selectedCategory(view, scope, id) {
  const value = identity(id, { signed: true });
  requireRule(scope.list_type_active && scope.category_ids.includes(value), 'shopping_category_scope');
  return view.tree.get(value).id;
}
function header(body, facts, { create = false } = {}) {
  fields(body, ['title', 'list_type_id', 'store', 'link', 'target_date', ...(create ? [] : ['status'])]);
  const optional = normalizeShoppingListFields(body);
  requireRule(!optional.error, 'shopping_list_fields_invalid');
  const values = { ...optional.values };
  if (create || has(body, 'title')) values.title = text(body.title, 300, false);
  if (create || has(body, 'list_type_id')) {
    values.list_type_id = identity(body.list_type_id);
    requireRule(facts.listTypes.some(t => String(t.id) === values.list_type_id && t.is_active), 'shopping_list_type_missing');
  }
  if (has(body, 'status')) {
    // Checkout is the only path allowed to create checked_out state.
    requireRule(['draft', 'active', 'archived'].includes(body.status), 'shopping_input_invalid');
    values.status = body.status;
  }
  if (create) values.status = 'draft';
  return values;
}

function append(facts, listId, body) {
  fields(body, ['entry_mode', 'catalog_item_id', 'custom_name', 'category_id', 'category_name', 'parent_id', 'save_to_catalog', 'planned_name', 'quantity', 'unit', 'unit_mode', 'price', 'notes']);
  requireRule(!has(body, 'entry_mode') || body.entry_mode === 'name_first', 'shopping_input_invalid');
  requireRule(!has(body, 'save_to_catalog') || typeof body.save_to_catalog === 'boolean', 'shopping_input_invalid');
  requireRule(!has(body, 'unit_mode') || body.unit_mode === 'controlled', 'shopping_input_invalid');
  const current = openList(facts, listId), view = catalogView(facts), scope = view.visibility.forListType(current.list_type_id);
  const nameFirst = body.entry_mode === 'name_first', controlled = body.unit_mode === 'controlled';
  let product = null, category = null, createCategory = null, createProduct = null;
  const name = body.custom_name == null ? null : text(body.custom_name, 300, false);
  if (body.catalog_item_id != null && body.catalog_item_id !== '') {
    product = view.product(body.catalog_item_id);
    requireRule(scope.product_ids.includes(String(product.id)), 'shopping_category_scope');
    category = String(product.category_id);
  } else {
    requireRule(name, 'shopping_item_name_required');
    if (body.category_id != null && body.category_id !== '') category = selectedCategory(view, scope, body.category_id);
    else if (body.category_name != null && text(body.category_name, 300)) {
      const candidates = scope.category_ids.filter(id => view.tree.get(id).name_key === categoryNameKey(body.category_name));
      requireRule(candidates.length < 2, 'shopping_category_ambiguous');
      if (candidates.length) category = candidates[0];
      else {
        requireRule(has(body, 'parent_id') && body.parent_id !== null, 'shopping_category_parent_required');
        const parent = selectedCategory(view, scope, body.parent_id);
        createCategory = planCategoryCreate(view.tree, { name: body.category_name, parent_id: parent }).values;
      }
    } else category = view.tree.neutralId;
    if (!createCategory) selectedCategory(view, scope, category);
    if (!nameFirst && !createCategory) {
      // Literal matching: %, _ and backslash are name characters, never ILIKE patterns.
      const matches = facts.products.filter(p => String(p.category_id) === category && p.name.toLowerCase() === name.toLowerCase());
      requireRule(matches.length <= 1, 'shopping_product_ambiguous');
      if (matches.length) {
        product = matches[0];
        requireRule(scope.product_ids.includes(String(product.id)), 'shopping_category_scope');
      }
    }
  }
  let unit = has(body, 'unit') ? text(body.unit, controlled && product ? Math.max(30, product.default_unit?.length || 0) : 30) : product?.default_unit ?? null;
  let price = has(body, 'price') ? numberText(body.price, 100000000, { nullable: true }) : product?.default_price ?? null;
  // Legacy empty/null values inherited defaults; explicit zero always survives.
  if (!nameFirst && product) {
    if (!unit) unit = product.default_unit;
    if (price === null) price = product.default_price;
  }
  if (controlled) {
    const normalized = planningUnit(unit);
    requireRule(supportedPlanningUnit(normalized) || (product && unit === product.default_unit), 'shopping_unit_invalid');
    unit = product && unit === product.default_unit ? unit : normalized;
  }
  const quantity = numberText(body.quantity == null || body.quantity === '' ? 1 : body.quantity, 10000, { positive: true, places: controlled ? 3 : 12 });
  if (!product && (!nameFirst || body.save_to_catalog === true)) {
    requireRule(!facts.products.some(p => String(p.category_id) === category && p.name === name), 'shopping_product_collision');
    createProduct = { name, category_id: category, default_unit: unit, default_price: price, is_active: true };
  }
  return { kind: 'item.append', create_category: createCategory, create_product: createProduct,
    values: { catalog_item_id: product ? String(product.id) : null, custom_name: product || createProduct ? null : name,
      category_id: category, quantity, unit, price, notes: body.notes == null ? null : text(body.notes, 2000),
      planned_name: body.planned_name == null ? null : text(body.planned_name, 300, false), is_purchased: false } };
}

function planList(facts, intent) {
  const { operation: op, id, item_id: itemId, body } = intent;
  if (op === 'list.create') return { kind: op, values: header(body, facts, { create: true }) };
  if (op === 'item.append') return append(facts, id, body);
  const current = openList(facts, id);
  if (op === 'list.edit') return { kind: op, changes: header(body, facts) };
  if (op === 'list.delete') {
    fields(body, []);
    requireRule(!facts.plans.length && !facts.receipts.length && !facts.confirmed.length && !facts.checkouts.length, 'shopping_list_has_history');
    return { kind: op };
  }
  if (op === 'suggestion.accept') {
    fields(body, ['catalog_item_id', 'quantity', 'unit']);
    const catalogId = identity(body.catalog_item_id);
    const planned = append(facts, id, { ...body, entry_mode: 'name_first' });
    const existing = facts.items.find(row => String(row.list_id) === id && String(row.catalog_item_id) === catalogId);
    return existing ? { kind: 'item.existing', item_id: String(existing.id) } : planned;
  }
  const before = item(facts, id, itemId);
  if (op === 'item.remove') { fields(body, []); return { kind: op, item_id: itemId }; }
  if (op === 'item.toggle') { fields(body, []); return { kind: 'item.edit', item_id: itemId, changes: { is_purchased: !before.is_purchased } }; }
  requireRule(op === 'item.edit', 'shopping_operation_invalid');
  requireRule(!has(body, 'unit_mode') || body.unit_mode === 'controlled', 'shopping_input_invalid');
  fields(body, ['planned_name', 'custom_name', 'category_id', 'quantity', 'unit', 'unit_mode', 'price', 'notes', 'is_purchased']);
  const changes = {};
  for (const k of ['planned_name', 'custom_name', 'notes']) if (has(body, k)) changes[k] = text(body[k], k === 'notes' ? 2000 : 300, k !== 'planned_name');
  if (has(body, 'custom_name')) requireRule(before.catalog_item_id === null && changes.custom_name, 'shopping_item_invalid');
  if (has(body, 'quantity')) changes.quantity = numberText(body.quantity, 10000, { positive: true, places: body.unit_mode === 'controlled' ? 3 : 12 });
  if (has(body, 'price')) changes.price = numberText(body.price, 100000000, { nullable: true });
  if (has(body, 'unit')) {
    changes.unit = text(body.unit, Math.max(30, before.unit?.length || 0));
    if (body.unit_mode === 'controlled') {
      const normalized = planningUnit(changes.unit);
      requireRule(supportedPlanningUnit(normalized) || changes.unit === before.unit, 'shopping_unit_invalid');
      if (changes.unit !== before.unit) changes.unit = normalized;
    }
  }
  if (has(body, 'is_purchased')) { requireRule(typeof body.is_purchased === 'boolean', 'shopping_input_invalid'); changes.is_purchased = body.is_purchased; }
  if (has(body, 'category_id')) {
    const selected = identity(body.category_id, { signed: true });
    if (selected !== String(before.category_id)) {
      const view = catalogView(facts); selectedCategory(view, view.visibility.forListType(current.list_type_id), selected);
    }
    changes.category_id = selected;
  }
  requireRule(Object.keys(changes).length > 0, 'shopping_input_invalid');
  return { kind: 'item.edit', item_id: itemId, changes };
}

function listProjection(facts, id) {
  const products = new Map(facts.products.map(p => [String(p.id), p]));
  return facts.items.filter(i => String(i.list_id) === identity(id)).map(i => ({ list_item_id: String(i.id),
    catalog_item_id: i.catalog_item_id === null ? null : String(i.catalog_item_id), notes: i.notes,
    name: i.planned_name ?? products.get(String(i.catalog_item_id))?.name ?? i.custom_name,
    quantity: i.quantity ?? '1', unit: i.unit ?? 'יח׳', price: i.price, is_purchased: i.is_purchased }));
}

module.exports = { planList, append, list, openList, item, listProjection, fields, text, numberText };
