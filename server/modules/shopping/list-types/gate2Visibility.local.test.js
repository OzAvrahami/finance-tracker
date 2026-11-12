'use strict';

// Opt-in local read of owner-supplied evidence. No DB client, network or private
// rows in the repository/test output. Canonical tests use a synthetic fixture.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { buildHierarchy } = require('../categories/hierarchy');
const { createVisibilityEngine } = require('./listTypeService');

test('private approved Gate 2 mapping derives the six exact visibility counts', {
  skip: !process.env.SHOPPING_GATE2_MANIFEST,
}, () => {
  const manifest = JSON.parse(fs.readFileSync(process.env.SHOPPING_GATE2_MANIFEST, 'utf8'));
  const hash = crypto.createHash('sha256').update(JSON.stringify(manifest.canonicalMapping.arrays)).digest('hex');
  assert.equal(hash, '7b4b0547363ebd6066aca8cee5871467cb0a1db1ed6271c36b7de80a6f8d4fdf');
  // Reconstruct from the checksum-bound arrays, not unbound convenience fields.
  const [dictionary, dispositions, mapping, assignments] = manifest.canonicalMapping.arrays;
  assert.equal(dispositions.length, 27);
  assert.equal(mapping.length, 173);
  assert.equal(new Set(mapping.map(p => p[0])).size, 173);
  const ids = new Map(dictionary.map(([code], i) => [code, String(10001 + i)]));
  const categories = dictionary.map(([code, parent, name]) => ({
    id: ids.get(code), parent_id: parent === null ? null : ids.get(parent),
    name, is_neutral: code === 'N', is_active: true,
  }));
  for (let i = 0; i < 25; i++) categories.push({ id: 900001 + i, name: `Synthetic historical ${i}`, parent_id: null, is_active: false });
  const tree = buildHierarchy(categories);
  const visibility = createVisibilityEngine(tree, {
    listTypes: assignments.map(([id]) => ({ id, is_active: true })),
    links: assignments.flatMap(([id, codes]) => codes.map(code => ({ list_type_id: id, category_id: ids.get(code) }))),
    products: mapping.map(([, , code], i) => ({ id: 100001 + i, category_id: ids.get(code), is_active: true })),
  });
  assert.equal(tree.categories({ includeInactive: true }).length, 99);
  const expected = [[57, 144], [11, 19], [1, 1], [10, 21], [9, 12], [11, 21]];
  for (let i = 0; i < expected.length; i++) {
    const result = visibility.forListType(i + 1);
    assert.deepEqual([result.category_ids.length, result.product_ids.length], expected[i], `list type ${i + 1}`);
  }
});
