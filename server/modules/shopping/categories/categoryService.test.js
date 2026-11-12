'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHierarchy } = require('./hierarchy');
const { planCategoryCreate, planCategoryChange } = require('./categoryService');
const { ShoppingDomainError } = require('../shared/errors');

const row = (id, name, parent_id = null, is_active = true) => ({ id, name, parent_id, is_active });
const source = () => [{ ...row(-99, 'System'), is_neutral: true }, row(1, 'Root A'), row(2, 'Child', 1), row(3, 'Leaf', 2), row(4, 'Root B'), row(5, 'Reserved', 4, false)];
const fails = (fn, code) => assert.throws(fn, e => e instanceof ShoppingDomainError && e.code === code);
const after = (tree, plan) => buildHierarchy(tree.categories({ includeInactive: true }).map(n => n.id === plan.id ? { ...n, ...plan.changes } : n));

test('create plans normalize names, require explicit parents, preserve zero order and never allocate IDs', () => {
  const tree = buildHierarchy(source());
  const plan = planCategoryCreate(tree, { name: ' Ｎew\t child ', parent_id: 2, display_order: 0 });
  assert.deepEqual(plan.values, { name: 'New child', parent_id: '2', is_active: true, is_neutral: false, display_order: 0 });
  assert.equal(Object.hasOwn(plan.values, 'id'), false);
  assert.equal(plan.requiresCatalogRevision, true);
  assert.equal(planCategoryCreate(tree, { name: 'New root', parent_id: null, is_active: false }).values.is_active, false);
  assert.equal(tree.categoryIds.length, 6);
  fails(() => planCategoryCreate(tree, { name: 'New' }), 'shopping_id_invalid');
  fails(() => planCategoryCreate(tree, { name: 'New', parent_id: 333 }), 'shopping_category_missing');
  fails(() => planCategoryCreate(tree, { name: 'New', parent_id: -99 }), 'shopping_neutral_parent');
  fails(() => planCategoryCreate(tree, { name: 'New', parent_id: null, id: 123 }), 'shopping_category_change_invalid');
  fails(() => planCategoryCreate(tree, { name: 'New', parent_id: null, is_neutral: true }), 'shopping_category_change_invalid');
});

test('rename validates normalized sibling reservations, including inactive rows, without global name restrictions', () => {
  const tree = buildHierarchy(source());
  fails(() => planCategoryCreate(tree, { name: ' RESERVED ', parent_id: 4 }), 'shopping_category_sibling_duplicate');
  fails(() => planCategoryChange(tree, { type: 'rename', id: 1, name: 'root b' }), 'shopping_category_sibling_duplicate');
  const plan = planCategoryChange(tree, { type: 'rename', id: 2, name: ' Reserved ' });
  assert.equal(plan.changes.name, 'Reserved');
  assert.equal(after(tree, plan).path(3)[1].name, 'Reserved');
  assert.equal(tree.path(3)[1].name, 'Child');
  fails(() => planCategoryChange(tree, { type: 'rename', id: 2, name: '' }), 'shopping_category_name_invalid');
});

test('reparent plans refresh subtree paths while preserving identities, activity flags and source snapshot', () => {
  const rows = source(), original = structuredClone(rows), tree = buildHierarchy(rows);
  const plan = planCategoryChange(tree, { type: 'reparent', id: 2, parent_id: 4 });
  const result = after(tree, plan);
  assert.deepEqual(result.path(3).map(n => n.id), ['4', '2', '3']);
  assert.deepEqual(tree.path(3).map(n => n.id), ['1', '2', '3']);
  assert.equal(result.get(3).is_active, true);
  assert.deepEqual(rows, original);
  const rootPlan = planCategoryChange(tree, { type: 'reparent', id: 2, parent_id: null });
  assert.equal(after(tree, rootPlan).get(2).parent_id, null);
  assert.equal(plan.preservesReferences, true);
  assert.throws(() => { plan.changes.parent_id = 'bad'; }, TypeError);
});

test('reparent rejects self, descendants, missing/neutral parents and target sibling collisions', () => {
  const tree = buildHierarchy(source());
  fails(() => planCategoryChange(tree, { type: 'reparent', id: 1, parent_id: 1 }), 'shopping_category_self_parent');
  fails(() => planCategoryChange(tree, { type: 'reparent', id: 1, parent_id: 3 }), 'shopping_category_cycle');
  fails(() => planCategoryChange(tree, { type: 'reparent', id: 1, parent_id: 999 }), 'shopping_category_missing');
  fails(() => planCategoryChange(tree, { type: 'reparent', id: 1, parent_id: -99 }), 'shopping_neutral_parent');
  const repeated = buildHierarchy([...source(), row(6, 'Child', 4)]);
  fails(() => planCategoryChange(repeated, { type: 'reparent', id: 2, parent_id: 4 }), 'shopping_category_sibling_duplicate');
});

test('deletion is deactivation, retains referenced history, and activation never cascades stored flags', () => {
  const tree = buildHierarchy(source());
  const historicalReferences = Object.freeze([{ category_id: 1 }, { category_id: 3 }]);
  const plan = planCategoryChange(tree, { type: 'delete', id: 1 });
  const inactive = after(tree, plan);
  assert.deepEqual(plan.changes, { is_active: false });
  assert.equal(inactive.categoryIds.length, tree.categoryIds.length);
  assert.equal(inactive.get(3).is_active, true);
  assert.equal(inactive.get(3).effective_active, false);
  assert.ok(historicalReferences.every(r => inactive.get(r.category_id)));
  const childOff = after(inactive, planCategoryChange(inactive, { type: 'deactivate', id: 2 }));
  const reactivated = after(childOff, planCategoryChange(childOff, { type: 'activate', id: 1 }));
  assert.equal(reactivated.get(2).is_active, false);
  assert.equal(reactivated.get(3).effective_active, false);
  fails(() => planCategoryChange(tree, { type: 'hard-delete', id: 5 }), 'shopping_category_change_invalid');
});

test('moving an active subtree beneath an inactive parent is explicit and does not reactivate anything', () => {
  const tree = buildHierarchy(source());
  const result = after(tree, planCategoryChange(tree, { type: 'reparent', id: 2, parent_id: 5 }));
  assert.equal(result.get(5).is_active, false);
  assert.equal(result.get(2).is_active, true);
  assert.equal(result.get(3).effective_active, false);
});

test('neutral cannot be renamed, reparented, deactivated, deleted or replaced through category plans', () => {
  const tree = buildHierarchy(source());
  for (const type of ['rename', 'reparent', 'deactivate', 'delete', 'hard-delete']) {
    fails(() => planCategoryChange(tree, { type, id: -99, name: 'Other', parent_id: 1 }), 'shopping_neutral_protected');
  }
  fails(() => planCategoryChange(tree, { type: 'activate', id: 999 }), 'shopping_category_missing');
  fails(() => planCategoryChange(tree, { type: 'activate', id: 1, is_neutral: true }), 'shopping_category_change_invalid');
  fails(() => planCategoryChange(tree, null), 'shopping_input_invalid');
});
