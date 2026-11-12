'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { assertFingerprintSet, assertSqlInventory, assertAdoptedPreservation, parseEvidenceBytes,
  removeFunctions, retainFunctions, removeTrigger, retainTriggers, expectedTarget } = require('./migrationReadiness');

test('source fingerprint comparisons reject additions, deletions, duplicates and content changes', () => {
  const expected = [{ name: 'synthetic', count: 2, hash: 'old' }];
  assert.doesNotThrow(() => assertFingerprintSet(structuredClone(expected), expected));
  for (const actual of [[], [...expected, ...expected], [{ ...expected[0], count: 3 }], [{ ...expected[0], hash: 'new' }]])
    assert.throws(() => assertFingerprintSet(actual, expected), /shopping_preservation_drift/);
});

test('SQL checklist has exact 15 removals, seven retained and timestamp/item triggers', () => {
  assert.equal(removeFunctions.length, 15); assert.equal(retainFunctions.length, 7);
  const signatures = [...removeFunctions, ...retainFunctions], triggers = [removeTrigger, ...retainTriggers];
  assert.doesNotThrow(() => assertSqlInventory({ signatures: signatures.reverse(), triggers }));
  assert.throws(() => assertSqlInventory({ signatures: signatures.slice(1), triggers }), /shopping_sql_inventory_drift/);
  assert.throws(() => assertSqlInventory({ signatures: [...signatures, 'shopping_hidden_engine()'], triggers }), /shopping_sql_inventory_drift/);
  assert.throws(() => assertSqlInventory({ signatures, triggers: triggers.slice(1) }), /shopping_sql_inventory_drift/);
  assert.deepEqual(expectedTarget, { categories: 99, activeCategories: 74, historicalInactive: 25,
    products: 173, listTypes: 6, totalLinks: 21, listRows: 85 });
});

test('private evidence bytes are checksum-bound without exposing content', () => {
  const sha = value => createHash('sha256').update(value).digest('hex');
  const m = '{"synthetic":1}', e = '{"synthetic":2}', a = JSON.stringify({ originalManifestSha256: sha(m), evidenceSha256: sha(e) });
  assert.equal(parseEvidenceBytes(m, e, a).manifest.synthetic, 1);
  assert.throws(() => parseEvidenceBytes(m, e + '\n', a), /shopping_evidence_checksum_mismatch/);
  assert.throws(() => parseEvidenceBytes(m + ' ', e, a), /shopping_evidence_checksum_mismatch/);
});

test('mapping mismatch blocks preflight; a count-only lookalike is not approved evidence', () => {
  assert.throws(() => assertAdoptedPreservation({ canonicalMapping: { arrays: [] } }, {}, {}, []), /shopping_mapping_checksum_mismatch/);
});
