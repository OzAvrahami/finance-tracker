'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { parseEvidenceBytes, assertAdoptedPreservation } = require('./migrationReadiness');

test('owner-approved private preservation evidence remains complete and rejects tampering', {
  skip: !process.env.SHOPPING_PRESERVATION_ADOPTION || !process.env.SHOPPING_GATE2_MANIFEST,
}, () => {
  const adoptionText = fs.readFileSync(process.env.SHOPPING_PRESERVATION_ADOPTION, 'utf8');
  const path = JSON.parse(adoptionText).evidencePath;
  const { manifest, evidence, adoption } = parseEvidenceBytes(fs.readFileSync(process.env.SHOPPING_GATE2_MANIFEST, 'utf8'),
    fs.readFileSync(path, 'utf8'), adoptionText);
  const result = assertAdoptedPreservation(manifest, evidence, adoption, adoption.currentTableFingerprints);
  assert.equal(result.preservationVerified, true); assert.equal(result.migrationExecutable, false);
  const drift = structuredClone(adoption.currentTableFingerprints); drift[0].hash = 'changed';
  assert.throws(() => assertAdoptedPreservation(manifest, evidence, adoption, drift), /shopping_preservation_drift/);
  const tampered = structuredClone(evidence); tampered.rows[0].currentRowText += ' ';
  assert.throws(() => assertAdoptedPreservation(manifest, tampered, adoption, adoption.currentTableFingerprints), /shopping_preservation_drift/);
  assert.throws(() => assertAdoptedPreservation(manifest, evidence, { ...adoption, status: 'PROPOSED_NOT_ADOPTED' }, adoption.currentTableFingerprints), /shopping_preservation_unapproved/);
});
