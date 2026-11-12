'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHierarchy } = require('./hierarchy');
const { ShoppingDomainError } = require('../shared/errors');

const category = (id, name = `Node ${id}`, parent_id = null, extra = {}) =>
  ({ id, name, parent_id, is_active: true, ...extra });
const neutral = () => category(-99, 'System neutral', null, { is_neutral: true });
const fails = (fn, code) => assert.throws(fn, error => error instanceof ShoppingDomainError && error.code === code);

test('iterative root/leaf ancestry, descendants and literal-separator paths preserve stable IDs', () => {
  const tree = buildHierarchy([neutral(), category(1, 'Root'), category(2, 'a/b', 1), category(3, 'Leaf', 2)]);
  assert.deepEqual(tree.rootIds, ['1']);
  assert.deepEqual(tree.ancestorIds(3), ['1', '2']);
  assert.deepEqual(tree.ancestorIds(3, { includeSelf: true, order: 'node-first' }), ['3', '2', '1']);
  assert.deepEqual(tree.descendantIds(1), ['2', '3']);
  assert.deepEqual(tree.descendantIds(3), []);
  assert.deepEqual(tree.descendantIds(3, { includeSelf: true }), ['3']);
  assert.deepEqual(tree.ancestorIds(1), []);
  assert.deepEqual(tree.path(3), [{ id: '1', name: 'Root' }, { id: '2', name: 'a/b' }, { id: '3', name: 'Leaf' }]);
  assert.equal(tree.isDescendant(3, 1), true);
  assert.equal(tree.isDescendant(1, 1), false);
  assert.equal(tree.isDescendant(1, 1, { includeSelf: true }), true);
  assert.deepEqual(tree.path(-99), [{ id: '-99', name: 'System neutral' }]);
  fails(() => tree.get('Root'), 'shopping_id_invalid');
});

test('same names under different parents are distinct; inactive siblings reserve normalized keys', () => {
  const rows = [neutral(), category(1, 'A'), category(2, 'B'), category(3, 'Same', 1), category(4, 'Same', 2)];
  const tree = buildHierarchy(rows);
  assert.equal(tree.path(3)[0].id, '1');
  assert.equal(tree.path(4)[0].id, '2');
  fails(() => buildHierarchy([...rows, category(5, ' ＳAME\u00a0', 1, { is_active: false })]), 'shopping_category_sibling_duplicate');
  fails(() => buildHierarchy([neutral(), category(1, ' Ａ\t B '), category(2, 'a b')]), 'shopping_category_sibling_duplicate');
  assert.equal(buildHierarchy([neutral(), category(1, 'É'), category(2, 'é')]).rootIds.length, 2);
});

test('normalization preserves source display bytes while keys use the complete approved whitespace set', () => {
  const whitespace = '\u0009\u000a\u000b\u000c\u000d\u0020\u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
  for (const space of whitespace) {
    const name = `${space}Ａ${space}B${space}`;
    const node = buildHierarchy([neutral(), category(1, name)]).get(1);
    assert.equal(node.name, name);
    assert.equal(node.name_key, 'a b');
  }
});

for (const [name, rows, code] of [
  ['duplicate normalized ID', [neutral(), category(1), category('1')], 'shopping_category_id_duplicate'],
  ['missing parent', [neutral(), category(1, 'A', 999)], 'shopping_category_parent_missing'],
  ['self cycle', [neutral(), category(1, 'A', 1)], 'shopping_category_self_parent'],
  ['indirect disconnected cycle', [neutral(), category(1, 'A', 2), category(2, 'B', 3), category(3, 'C', 1), category(4)], 'shopping_category_cycle'],
  ['missing neutral', [category(1)], 'shopping_neutral_missing'],
  ['two marked neutral identities', [neutral(), category(7, 'Another neutral', null, { is_neutral: true })], 'shopping_neutral_invalid'],
  ['inactive neutral', [{ ...neutral(), is_active: false }], 'shopping_neutral_invalid'],
  ['neutral with parent', [{ ...neutral(), parent_id: 1 }, category(1)], 'shopping_neutral_invalid'],
  ['ordinary child of neutral', [neutral(), category(1, 'A', -99)], 'shopping_neutral_parent'],
  ['missing explicit parent', [neutral(), { id: 1, name: 'A', is_active: true }], 'shopping_id_invalid'],
  ['non-boolean activity', [neutral(), category(1, 'A', null, { is_active: 'false' })], 'shopping_activity_invalid'],
  ['invalid order', [neutral(), category(1, 'A', null, { display_order: NaN })], 'shopping_order_invalid'],
  ['empty normalized name', [neutral(), category(1, '\u00a0')], 'shopping_category_name_invalid'],
  ['overlong name', [neutral(), category(1, 'a'.repeat(301))], 'shopping_category_name_invalid'],
]) test(`rejects ${name} explicitly`, () => fails(() => buildHierarchy(rows), code));

test('IDs reject lossy/malformed values and preserve signed system IDs and full int64 precision', () => {
  for (const id of [0, -0, 1.5, Number.MAX_SAFE_INTEGER + 1, null, {}, '01', '+1', '1e2', ' 1', '9223372036854775808', '9'.repeat(1000)]) {
    fails(() => buildHierarchy([neutral(), category(id)]), 'shopping_id_invalid');
  }
  const tree = buildHierarchy([neutral(), category('9223372036854775807')]);
  assert.equal(tree.get('9223372036854775807').id, '9223372036854775807');
  fails(() => tree.get(555), 'shopping_category_missing');
  fails(() => buildHierarchy(null), 'shopping_input_invalid');
  fails(() => buildHierarchy([null]), 'shopping_input_invalid');
  fails(() => tree.ancestorIds(-99, { order: 'sideways' }), 'shopping_path_order_invalid');
});

test('inactive ancestors hide descendants; historical identities remain inspectable without flag rewriting', () => {
  const rows = [neutral(), category(1, 'History', null, { is_active: false }), category(2, 'Child', 1), category(3, 'Inactive child', 2, { is_active: false })];
  const before = structuredClone(rows), tree = buildHierarchy(rows);
  assert.deepEqual(tree.categories().map(n => n.id), ['-99']);
  assert.equal(tree.categories({ includeInactive: true }).length, 4);
  assert.equal(tree.get(2).is_active, true);
  assert.equal(tree.get(2).effective_active, false);
  assert.equal(tree.path(3).length, 3);
  assert.deepEqual(rows, before);
});

test('ordering is independent of input order and detached outputs cannot corrupt internal state', () => {
  const rows = [neutral(), category(9, 'Z', null, { display_order: -1 }), category(1, 'A'), category(2, 'Child', 1), category(3, 'B')];
  const tree = buildHierarchy(rows), shuffled = buildHierarchy([...rows].reverse());
  assert.deepEqual(tree.categoryIds, ['9', '1', '2', '3', '-99']);
  assert.deepEqual(tree.categoryIds, shuffled.categoryIds);
  rows[1].name = 'Changed outside';
  assert.equal(tree.get(9).name, 'Z');
  assert.throws(() => { tree.get(1).parent_id = '2'; }, TypeError);
  assert.throws(() => tree.categoryIds.push('evil'), TypeError);
  assert.throws(() => tree.childrenIds(1).pop(), TypeError);
  assert.throws(() => { tree.path(2)[0].name = 'evil'; }, TypeError);
});

test('20,000-node deep and wide forests traverse without recursion or truncation', () => {
  const size = 20000;
  const deep = buildHierarchy([neutral(), ...Array.from({ length: size }, (_, i) => category(i + 1, `Depth ${i}`, i ? i : null))]);
  assert.equal(deep.path(size).length, size);
  assert.equal(deep.ancestorIds(size).length, size - 1);
  assert.equal(deep.descendantIds(1).length, size - 1);
  assert.equal(deep.isDescendant(size, 1), true);
  const wide = buildHierarchy([neutral(), category(1), ...Array.from({ length: size }, (_, i) => category(i + 2, `Sibling ${i}`, 1))]);
  assert.equal(wide.childrenIds(1).length, size);
  assert.equal(wide.descendantIds(1).length, size);
});

