'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../services/ingestion/core');
const { schema } = require('../services/unifiedTransactionIngestion');
const { protectedCash, conflictingOriginalEvidence } = require('../services/ingestion/reconciliation');
const facts = () => ({ sources: [{ id: '1', source_kind: 'external_api', instance_key: 'unified:v1', is_active: true, configuration: {} }],
  payments: [{ id: '6', is_active: true, method: 'credit_card' }], categories: [], observations: [], transactions: [], installments: [], events: [] });
const request = extra => ({ type: 'refund', amount: 137.29, currency: 'USD', original_amount: 35.12,
  date: '2026-04-03', payment_source_id: 6, external_id: 'fx-credit', ...extra });
const decision = extra => { const r = request(extra); return core.decideIngestion(facts(), { channel: 'external', request: r, key: r.external_id || 'transport-only' }); };
const target = extra => ({ id: '10', total_amount: '137.290000', currency: 'USD', original_amount: '35.120000', exchange_rate: '3.800000',
  movement_type: 'expense', payment_source_id: '6', transaction_date: '2026-04-03', charge_date: '2026-04-10',
  description: 'Owner description', notes: 'Previous name preserved', links: [], cash_fingerprint: 'cash', ...extra });
const observation = extra => ({ id: '20', source_id: '1', transaction_id: null, evidence_origin: 'source', decision_revision: '2',
  amount_minor: '13729', movement_type: 'expense', payment_source_id: '6', source_transaction_date: '2026-04-03',
  accepted_payload: {}, review_fingerprints: { 10: 'review' }, charge_evidence: '2026-04-02', result: {}, ...extra });
function ownerDecision(t = target(), o = observation(), changes = {}, other = []) {
  const f = facts(); f.transactions = [t]; f.observations = [o, ...other];
  f.sources[0].source_kind = 'cal';
  return core.decideCommand(f, { command_kind: 'resolve', review: true, command: { observation_id: o.id, action: 'link',
    expected_revision: o.decision_revision, expected_candidate_fingerprints: o.review_fingerprints,
    transaction_id: t.id, expected_transaction_fingerprint: t.cash_fingerprint, ...changes } });
}

test('Single/Bulk public schema keeps positive JSON numbers and optional independent FX rate evidence', () => {
  for (const type of ['expense', 'refund']) for (const rate of [undefined, 3.8]) {
    const r = request({ type, exchange_rate: rate });
    assert.equal(schema.safeParse(r).success, true);
    const d = decision({ type, exchange_rate: rate });
    assert.equal(d.outcome, 'created');
    assert.equal(d.posting.total_amount, type === 'refund' ? '-137.29' : '137.29');
    assert.equal(d.posting.original_amount, 35.12); assert.equal(d.posting.currency, 'USD');
    assert.equal(d.posting.exchange_rate, rate);
    assert.equal(d.posting.bank_movement, type === 'refund' ? 'refund' : undefined);
  }
  for (const extra of [{ amount: '137.29' }, { original_amount: '35.12' }, { exchange_rate: '3.8' },
    { amount: -137.29 }, { original_amount: -35.12 }, { original_amount: 0 }]) assert.equal(schema.safeParse(request(extra)).success, false);
});

test('required original evidence cannot gain separate-post authority through another review reason', () => {
  assert.equal(decision({ original_amount: undefined }).reason, 'original_amount_required');
  assert.equal(decision({ external_id: undefined }).reason, 'identity_evidence_required');
  const o = observation({ reason_code: 'installment_series_required', accepted_payload: { _creation: { currency: 'USD' } } });
  assert.equal(core.canPost(facts(), o), 'evidence_correction_required');
});

test('explicit accounting-only owner link preserves target and never requests charge enrichment', () => {
  const t = target(), o = observation(), frozen = JSON.stringify(t);
  assert.equal(protectedCash(t), true);
  const d = ownerDecision(t, o);
  assert.equal(d.action, 'link'); assert.equal(d.enrichment, null); assert.equal(d.target, t.id);
  assert.equal(JSON.stringify(t), frozen);
  assert.equal(ownerDecision(t, observation({ accepted_payload: { _creation: { currency: 'ILS' } } })).action, 'link');
  assert.equal(ownerDecision(target({ currency: 'ILS', original_amount: null, exchange_rate: null })).enrichment, null);
});

test('owner link compares supplied original amount/currency/rate exactly without multiplying or rounding', () => {
  const t = target();
  for (const p of [{ original_currency: 'USD', original_amount: '35.1200' },
    { _creation: { currency: 'USD', original_amount: 35.12 } },
    { _creation: { currency: 'USD', original_amount: 35.12, exchange_rate: 3.8 } }]) {
    assert.equal(ownerDecision(t, observation({ accepted_payload: p })).action, 'link');
  }
  for (const p of [{ original_currency: 'EUR', original_amount: '35.12' },
    { original_currency: 'USD', original_amount: '35.120001' },
    { _creation: { currency: 'USD' } }, { _creation: { currency: 'EUR', original_amount: 35.12 } },
    { _creation: { currency: 'USD', original_amount: 35.12, exchange_rate: 3.81 } }]) {
    assert.equal(ownerDecision(t, observation({ accepted_payload: p })).result.reason_code, 'review_target_conflict');
  }
  assert.equal(conflictingOriginalEvidence(observation({ accepted_payload: { original_currency: 'USD', original_amount: '90071992547409.910001' } }),
    target({ original_amount: '90071992547409.910002' })), true);
  assert.equal(ownerDecision(target({ exchange_rate: null }), observation({ accepted_payload: { _creation: { exchange_rate: 3.8 } } })).result.reason_code, 'review_target_conflict');
});

test('signed cash, date, source exclusivity and all review fingerprints remain binding', () => {
  for (const extra of [{ total_amount: '-137.29' }, { total_amount: '137.30' }, { movement_type: 'income' },
    { payment_source_id: '7' }, { transaction_date: '2026-04-06' }]) assert.equal(ownerDecision(target(extra)).result.reason_code, 'review_target_conflict');
  assert.equal(ownerDecision(target({ total_amount: '-137.29' }), observation({ amount_minor: '-13729' })).action, 'link');
  for (const changes of [{ expected_revision: '1' }, { expected_candidate_fingerprints: {} }]) assert.equal(ownerDecision(target(), observation(), changes).result.reason_code, 'stale_review');
  assert.equal(ownerDecision(target(), observation(), { expected_transaction_fingerprint: 'old' }).result.reason_code, 'review_target_conflict');
  assert.equal(ownerDecision(target(), observation({ transaction_id: '10' })).result.reason_code, 'stale_review');
  assert.equal(ownerDecision(target(), observation(), {}, [{ transaction_id: '10', source_id: '1' }]).result.reason_code, 'review_target_conflict');
});

test('domain and captured-history guards remain for explicit FX links; generic FX cancellation stays denied', () => {
  for (const extra of [{ loan_id: 1 }, { parent_transaction_id: 1 }, { installment_count: 2 }, { installment_number: 1 },
    { installments_info: '1/2' }, { global_discount: '1' }, { savings_role: 'contribution' }, { voided_at: '2026-04-04' },
    ...['loan', 'child', 'item', 'shopping', 'lego', 'savings'].map(link => ({ links: [link] })),
    { budget_facts: [{ operation_type: 'month_close' }] }, { budget_facts: [{ item_kind: 'carryover' }] },
    { budget_facts: [{ item_kind: 'unused_disposition' }] }]) assert.equal(ownerDecision(target(extra)).result.reason_code, 'protected_transaction');
  const f = facts(), t = target(), o = observation({ transaction_id: t.id }); f.transactions = [t]; f.observations = [o];
  assert.equal(core.decideCommand(f, { command_kind: 'cancel', command: { transaction_id: t.id } }).result.reason_code, 'protected_transaction');
});
