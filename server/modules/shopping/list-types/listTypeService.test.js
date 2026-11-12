'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHierarchy } = require('../categories/hierarchy');
const { createVisibilityEngine, validateBranchSelection } = require('./listTypeService');
const { approvedFixture } = require('./fixtures/approvedTaxonomy');
const { ShoppingDomainError } = require('../shared/errors');

const row = (id, name, parent_id = null, is_active = true) => ({ id, name, parent_id, is_active });
const simple = () => ({
  categories: [{ ...row(-99, 'System'), is_neutral: true }, row(1, 'Outside'), row(2, 'Selected', 1), row(3, 'Leaf', 2), row(4, 'Second root')],
  listTypes: [{ id: 1, is_active: true }, { id: 2, is_active: true }],
  links: [{ list_type_id: 1, category_id: 2 }, { list_type_id: 1, category_id: 3 }, { list_type_id: 1, category_id: 4 }, { list_type_id: 2, category_id: 2 }],
  products: [{ id: 1, category_id: 2, is_active: true }, { id: 2, category_id: 3, is_active: true }, { id: 3, category_id: 4, is_active: true }, { id: 4, category_id: -99, is_active: true }, { id: 5, category_id: 1, is_active: true }],
});
const engine = data => createVisibilityEngine(buildHierarchy(data.categories), data);
const fails = (fn, code) => assert.throws(fn, e => e instanceof ShoppingDomainError && e.code === code);

test('multiple arbitrary branches inherit descendants and deduplicate overlap, shared products and system links', () => {
  const data = simple(), before = structuredClone(data);
  data.links.push({ list_type_id: 1, category_id: 2 }, { list_type_id: 1, category_id: -99 });
  const visibility = engine(data);
  const a = visibility.forListType(1), b = visibility.forListType('2');
  assert.deepEqual(a.category_ids, ['2', '3', '4', '-99']);
  assert.deepEqual(a.product_ids, ['1', '2', '3', '4']);
  assert.deepEqual(a.root_ids, ['2', '4', '-99']);
  assert.deepEqual(b.category_ids, ['2', '3', '-99']);
  assert.deepEqual(b.product_ids, ['1', '2', '4']);
  assert.equal(data.products.length, before.products.length);
  assert.equal(data.products[0].category_id, 2);
  assert.deepEqual(a.branch_ids, ['2', '3', '4']);
  assert.equal(a.category_ids.includes('1'), false);
});

test('selected roots show full context; descendants have relative paths and unambiguous full breadcrumbs', () => {
  const visibility = engine(simple()).forListType(1);
  assert.deepEqual(visibility.categoryPath(2).display_path.map(n => n.name), ['Outside', 'Selected']);
  const leaf = visibility.categoryPath(3);
  assert.deepEqual(leaf.path.map(n => n.id), ['1', '2', '3']);
  assert.deepEqual(leaf.relative_path.map(n => n.id), ['2', '3']);
  assert.deepEqual(leaf.display_path.map(n => n.id), ['3']);
  assert.equal(leaf.visible_root_id, '2');
  fails(() => visibility.categoryPath(1), 'shopping_category_unavailable');
  assert.deepEqual(visibility.categoryPath(-99).relative_path.map(n => n.id), ['-99']);
});

test('inactive ancestors hide explicitly selected descendants; inactive products never become selectable', () => {
  const data = simple();
  data.categories.find(c => c.id === 1).is_active = false;
  data.products.find(p => p.id === 3).is_active = false;
  const view = engine(data).forListType(1);
  assert.deepEqual(view.category_ids, ['4', '-99']);
  assert.deepEqual(view.product_ids, ['4']);
  const tree = buildHierarchy(data.categories);
  assert.equal(tree.get(2).is_active, true);
  assert.equal(tree.get(3).effective_active, false);
  assert.equal(tree.categories({ includeInactive: true }).length, 5);
});

test('empty mappings and empty catalogs retain neutral availability without inventing products', () => {
  const data = simple(); data.links = [];
  assert.deepEqual(engine(data).forListType(1).category_ids, ['-99']);
  assert.deepEqual(engine(data).forListType(1).product_ids, ['4']);
  data.products = [];
  assert.deepEqual(engine(data).forListType(1).product_ids, []);
});

test('branch validation supports inactive targets but excludes neutral as an ordinary branch', () => {
  const data = simple(); data.categories[1].is_active = false;
  const tree = buildHierarchy(data.categories);
  assert.deepEqual(validateBranchSelection(tree, [3, 2, 3]), ['2', '3']);
  fails(() => validateBranchSelection(tree, [-99]), 'shopping_neutral_not_branch');
  fails(() => validateBranchSelection(tree, [999]), 'shopping_category_missing');
  fails(() => validateBranchSelection(tree, null), 'shopping_input_invalid');
});

for (const [name, modify, code] of [
  ['missing mapped category', d => d.links.push({ list_type_id: 1, category_id: 999 }), 'shopping_category_missing'],
  ['missing mapped type', d => d.links.push({ list_type_id: 999, category_id: 1 }), 'shopping_list_type_missing'],
  ['duplicate type', d => d.listTypes.push({ id: '1', is_active: true }), 'shopping_list_type_duplicate'],
  ['duplicate product', d => d.products.push({ id: '1', category_id: 4, is_active: true }), 'shopping_product_id_duplicate'],
  ['orphan inactive product', d => d.products.push({ id: 999, category_id: 999, is_active: false }), 'shopping_category_missing'],
  ['invalid product activity', d => { d.products[0].is_active = null; }, 'shopping_activity_invalid'],
  ['invalid type activity', d => { d.listTypes[0].is_active = 1; }, 'shopping_activity_invalid'],
  ['invalid product ID', d => { d.products[0].id = -99; }, 'shopping_id_invalid'],
]) test(`rejects ${name} even outside a requested visible subset`, () => {
  const data = simple(); modify(data); fails(() => engine(data), code);
});

test('unknown types and invalid raw fact collections fail explicitly', () => {
  const data = simple(), tree = buildHierarchy(data.categories);
  fails(() => engine(data).forListType(333), 'shopping_list_type_missing');
  fails(() => createVisibilityEngine(tree, null), 'shopping_input_invalid');
  fails(() => createVisibilityEngine(tree, { ...data, products: null }), 'shopping_input_invalid');
});

test('ordering and visibility survive reversed input, while outputs and snapshots remain isolated', () => {
  const data = simple(), first = engine(data);
  const shuffled = Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, [...rows].reverse()]));
  const second = engine(shuffled);
  assert.deepEqual(first.forListType(1).category_ids, second.forListType(1).category_ids);
  assert.deepEqual(first.forListType(1).product_ids, second.forListType(1).product_ids);
  data.products[0].is_active = false; data.links.length = 0;
  assert.equal(first.forListType(1).product_ids.includes('1'), true);
  assert.throws(() => first.forListType(1).product_ids.pop(), TypeError);
  assert.throws(() => { first.forListType(1).categoryPath(3).path[0].id = 'broken'; }, TypeError);
});

test('public approved taxonomy and six branch sets derive exact published counts using synthetic products', () => {
  const data = approvedFixture(), visibility = engine(data);
  assert.equal(data.categories.length, 74);
  assert.equal(data.products.length, 173);
  const expected = [[57, 144], [11, 19], [1, 1], [10, 21], [9, 12], [11, 21]];
  for (let i = 0; i < expected.length; i++) {
    const result = visibility.forListType(i + 1);
    assert.deepEqual([result.category_ids.length, result.product_ids.length], expected[i], `list type ${i + 1}`);
    assert.equal(new Set(result.category_ids).size, result.category_ids.length);
    assert.equal(new Set(result.product_ids).size, result.product_ids.length);
  }
  const gluten = data.idAt(['מזון ומשקאות', 'מוצרים ללא גלוטן']);
  assert.ok(visibility.forListType(1).category_ids.includes(gluten));
  assert.equal(visibility.forListType(1).category_ids.includes(data.idAt(['אופנה והנעלה'])), false);
});

test('25 synthetic historical roots remain inspectable but invisible under the approved branch selections', () => {
  const data = approvedFixture();
  for (let i = 0; i < 25; i++) data.categories.push(row(900001 + i, `Synthetic history ${i}`, null, false));
  const tree = buildHierarchy(data.categories);
  assert.equal(tree.categories().length, 74);
  assert.equal(tree.categories({ includeInactive: true }).length, 99);
  assert.equal(createVisibilityEngine(tree, data).forListType(1).category_ids.length, 57);
});

test('deep branch inheritance includes intermediate and deepest products without fixed-depth assumptions', () => {
  const size = 12000;
  const categories = [{ ...row(-99, 'System'), is_neutral: true }];
  for (let i = 1; i <= size; i++) categories.push(row(i, `Node ${i}`, i === 1 ? null : i - 1));
  const data = { categories, listTypes: [{ id: 1, is_active: true }],
    links: [{ list_type_id: 1, category_id: 2 }, { list_type_id: 1, category_id: size }],
    products: [{ id: 1, category_id: size, is_active: true }, { id: 2, category_id: 6000, is_active: true }] };
  const result = engine(data).forListType(1);
  assert.equal(result.category_ids.length, size);
  assert.deepEqual(result.product_ids, ['2', '1']);
  assert.equal(result.categoryPath(size).path.length, size);
});
