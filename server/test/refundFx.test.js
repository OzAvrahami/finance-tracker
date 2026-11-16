'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { schema, submitExternal } = require('../services/unifiedTransactionIngestion');
const { validateBulkItem } = require('../services/externalTransactionBulk');
const core = require('../services/ingestion/core');
const facts = () => ({ hash: 'synthetic', sources: [{ id: '1', source_kind: 'external_api', instance_key: 'unified:v1', is_active: true, revision: '1', configuration: {} }],
  payments: [{ id: '6', method: 'credit_card', is_active: true }, { id: '14', method: 'bank_account', is_active: true }],
  categories: [], observations: [], transactions: [], events: [], installments: [] });
const request = extra => ({ type: 'expense', amount: 35, date: '2026-11-01', description: 'Synthetic FX', payment_source_id: 6,
  external_id: 'synthetic-fx', currency: 'USD', original_amount: 10, ...extra });
const scope = r => ({ channel: 'external', request: r, key: r.external_id, hash_input: r, date: r.date });

test('external schema and Bulk accept expenses, FX refunds and evidenced foreign settlements', () => {
  for (const type of ['expense', 'income', 'refund']) {
    const r = request({ type, payment_source_id: type === 'income' ? 14 : 6, charged_amount: 10, charged_currency: 'USD', accounting_reference: 'provider-valuation' });
    assert.ok(schema.safeParse(r).success); assert.equal(validateBulkItem(r), null);
    const d = core.decideIngestion(facts(), scope(r));
    assert.equal(d.outcome, 'created'); assert.equal(d.posting.total_amount, type === 'refund' ? '-35' : '35');
    assert.equal(d.posting.movement_type, type === 'refund' ? 'expense' : type);
    assert.equal(d.posting.original_amount, 10); assert.equal(d.posting.currency, 'USD');
  }
});

test('settlement without reporting evidence is held and generic owner separate cannot authorize it', () => {
  const r = request({ charged_amount: 10, charged_currency: 'USD' }), f = facts();
  const d = core.decideIngestion(f, scope(r));
  assert.equal(d.outcome, 'ambiguous'); assert.equal(d.reason, 'accounting_evidence_required');
  assert.equal(core.decideIngestion(facts(), scope(request({ original_amount: undefined,
    installment_number: 1, installment_count: 2 }))).reason, 'original_amount_required');
  f.observations = [{ id: '1', source_id: '1', evidence_origin: 'source', reason_code: d.reason, outcome: 'ambiguous', decision_revision: '1',
    amount_minor: '3500', source_transaction_date: r.date, payment_source_id: '6', movement_type: 'expense', accepted_payload: d.normalized.input,
    result: { outcome: 'ambiguous' } }];
  // The evidence hold is explicitly included in canPost's non-overridable set.
  const decision = core.decideCommand(f, { command_kind: 'resolve', command: { observation_id: '1', action: 'separate', expected_revision: '1' } });
  assert.equal(decision.action, 'return'); assert.equal(decision.result.reason_code, 'evidence_correction_required');
});

test('invalid currencies, amounts, precision, settlement pairs and refund installments reject before database access', async () => {
  const db = { rpc: () => { throw Error('invalid request reached database'); } };
  for (const extra of [{ amount: 0 }, { amount: -1 }, { amount: 1.001 }, { currency: '$' }, { currency: 'ZZZ' },
    { original_amount: 1.001 }, { charged_amount: 1 }, { charged_currency: 'USD' },
    { charged_amount: 0, charged_currency: 'USD' }, { charged_amount: 1.001, charged_currency: 'USD' },
    { charged_amount: 10, charged_currency: 'ILS' }, { charged_amount: 11, charged_currency: 'USD' },
    { currency: undefined, charged_amount: 10, charged_currency: 'USD', accounting_reference: 'fixture' },
    { accounting_reference: 'unbound' }, { type: 'refund', installment_number: 1, installment_count: 2 }]) {
    const result = await submitExternal(db, request(extra)); assert.equal(result.status, 400, JSON.stringify(extra));
  }
  assert.ok(schema.safeParse(request({ currency: 'JPY', original_amount: 100 })).success);
  assert.ok(!schema.safeParse(request({ currency: 'JPY', original_amount: 100.1 })).success);
  assert.ok(schema.safeParse(request({ currency: 'KWD', original_amount: 1.234 })).success);
});

test('same identity replays only identical evidence; changed settlement evidence conflicts', () => {
  const r = request({ type: 'refund', charged_amount: 10, charged_currency: 'USD', accounting_reference: 'fixture' }), f = facts();
  f.observations = [{ id: 'old', source_id: '1', idempotency_key: r.external_id, payload_fingerprint: 'synthetic' }];
  assert.equal(core.decideIngestion(f, scope(r)).action, 'replay');
  f.hash = 'changed-settlement';
  assert.equal(core.decideIngestion(f, scope({ ...r, accounting_reference: 'different' })).action, 'conflict');
});
