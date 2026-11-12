'use strict';

// Offline evidence validation ONLY. No filesystem, DB connection, SQL execution,
// migration number reservation or mutation payload generation.
const { createHash } = require('node:crypto');
const { requireRule } = require('./errors');

const mappingSha256 = '7b4b0547363ebd6066aca8cee5871467cb0a1db1ed6271c36b7de80a6f8d4fdf';
const expectedTarget = Object.freeze({ categories: 99, activeCategories: 74, historicalInactive: 25,
  products: 173, listTypes: 6, totalLinks: 21, listRows: 85 });
const removeFunctions = Object.freeze([
  'shopping_receipt_command(bigint,text,jsonb)', 'shopping_move_receipt(bigint,bigint,text)',
  'shopping_checkout(bigint,bigint,bigint,jsonb)', 'shopping_approve_product_identifier(jsonb,uuid)',
  'shopping_add_planned_item(bigint,jsonb)', 'shopping_accept_suggestion(bigint,bigint,numeric,text)',
  'shopping_delete_draft(bigint)', 'shopping_claim_product_lookup(text,text,text)',
  'shopping_commercial_command(jsonb,uuid)', 'shopping_receipt_context(bigint)',
  'shopping_resolve_entry_category(bigint,text)', 'shopping_category_write_guard()',
  'shopping_snapshot(bigint)', 'shopping_commercial_detail(uuid)', 'shopping_unit_factor(text,text)',
]);
const retainFunctions = Object.freeze([
  'shopping_category_display(text)', 'shopping_category_key(text)', 'shopping_gtin_valid(text)',
  'shopping_lock_item()', 'shopping_save_receipt_draft(bigint,integer,integer,jsonb)',
  'shopping_receipt_duplicates(bigint,jsonb)', 'shopping_require_duplicate_review(bigint,jsonb,jsonb)',
]);
const removeTrigger = 'shopping_category_name_guard';
const retainTriggers = Object.freeze(['shopping_item_write_lock', 'trg_shopping_lists_updated_at',
  'trg_shopping_list_items_updated_at', 'trg_catalog_categories_updated_at', 'trg_catalog_items_updated_at']);

function assertFingerprintSet(actual, expected) {
  requireRule(Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length,
    'shopping_preservation_drift');
  const byName = new Map(actual.map(row => [row.name, row]));
  requireRule(byName.size === actual.length && new Set(expected.map(row => row.name)).size === expected.length,
    'shopping_preservation_drift');
  for (const before of expected) {
    const current = byName.get(before.name);
    requireRule(current && current.count === before.count && current.hash === before.hash, 'shopping_preservation_drift');
  }
}

function assertSqlInventory({ signatures, triggers }) {
  const expected = [...removeFunctions, ...retainFunctions].sort();
  requireRule(Array.isArray(signatures) && JSON.stringify([...signatures].sort()) === JSON.stringify(expected),
    'shopping_sql_inventory_drift');
  requireRule(Array.isArray(triggers) && JSON.stringify([...triggers].sort()) === JSON.stringify([removeTrigger, ...retainTriggers].sort()),
    'shopping_sql_inventory_drift');
  // Names alone are never a semantic zero-engine or permissions proof.
}

function assertAdoptedPreservation(manifest, evidence, adoption, currentFingerprints) {
  requireRule(manifest?.canonicalMapping?.arrays !== undefined, 'shopping_manifest_invalid');
  const hash = createHash('sha256').update(JSON.stringify(manifest.canonicalMapping.arrays)).digest('hex');
  requireRule(hash === mappingSha256 && evidence?.canonicalMappingSha256 === hash && adoption?.mappingSha256 === hash,
    'shopping_mapping_checksum_mismatch');
  requireRule(adoption.status === 'OWNER_APPROVED_ADOPTED', 'shopping_preservation_unapproved');
  requireRule(Array.isArray(evidence.rows) && evidence.rows.length === 85 && new Set(evidence.rows.map(r => r.id)).size === 85,
    'shopping_preservation_drift');
  requireRule(adoption.approvedCurrentListHash === evidence.proposedListTableMd5, 'shopping_preservation_drift');
  const md5 = value => createHash('md5').update(value).digest('hex');
  let changed = 0;
  for (const row of evidence.rows) {
    requireRule(md5(row.currentRowText) === row.currentMd5 && md5(row.recoveredOriginalRowText) === row.originalMd5,
      'shopping_preservation_drift');
    const reference = manifest.listRowsPreserve.find(r => r.id === row.id);
    const current = JSON.parse(row.currentRowText);
    const original = JSON.parse(row.recoveredOriginalRowText);
    const differences = Object.keys(original).filter(key => JSON.stringify(original[key]) !== JSON.stringify(current[key])).sort();
    if (differences.length) {
      changed++;
      requireRule(JSON.stringify(differences) === JSON.stringify(['is_purchased', 'purchased_at', 'updated_at'])
        && original.is_purchased === false && original.purchased_at === null
        && original.updated_at === original.created_at && current.is_purchased === true
        && typeof current.purchased_at === 'string' && typeof current.updated_at === 'string', 'shopping_preservation_drift');
    }
    requireRule(reference && reference.sourceRowMd5 === row.originalMd5 && current.id === reference.id
      && current.list_id === reference.listId && current.catalog_item_id === reference.catalogItemId
      && current.category_id === reference.categoryId, 'shopping_preservation_drift');
  }
  requireRule(changed === 50 && manifest.listRowsPreserve.length === 85, 'shopping_preservation_drift');
  requireRule(md5(evidence.rows.map(r => r.recoveredOriginalRowText).sort().join('\n')) === evidence.originalListTableMd5
    && evidence.originalListTableMd5 === manifest.sourceTableFingerprints.find(r => r.name === 'shopping_list_items')?.hash,
  'shopping_preservation_drift');
  requireRule(md5(evidence.rows.map(r => r.currentRowText).sort().join('\n')) === evidence.proposedListTableMd5,
    'shopping_preservation_drift');
  assertFingerprintSet(evidence.currentTableFingerprints, adoption.currentTableFingerprints);
  assertFingerprintSet(evidence.currentTableFingerprints.filter(r => r.name !== 'shopping_list_items'),
    manifest.sourceTableFingerprints.filter(r => r.name !== 'shopping_list_items'));
  assertFingerprintSet(currentFingerprints, adoption.currentTableFingerprints);
  return Object.freeze({ preservationVerified: true, mappingSha256: hash,
    migrationExecutable: false, reason: 'requires_separate_rehearsal_recovery_cutover_authorization' });
}

function parseEvidenceBytes(manifestText, evidenceText, adoptionText) {
  const adoption = JSON.parse(adoptionText);
  const sha = text => createHash('sha256').update(text).digest('hex');
  requireRule(sha(manifestText) === adoption.originalManifestSha256 && sha(evidenceText) === adoption.evidenceSha256,
    'shopping_evidence_checksum_mismatch');
  return { manifest: JSON.parse(manifestText), evidence: JSON.parse(evidenceText), adoption };
}

module.exports = { mappingSha256, expectedTarget, removeFunctions, retainFunctions, removeTrigger,
  retainTriggers, assertFingerprintSet, assertSqlInventory, assertAdoptedPreservation, parseEvidenceBytes };
