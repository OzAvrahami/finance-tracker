'use strict';
// Existing owner receipt correction, not a second delivery API or registration path.
const { isDeepStrictEqual: equal } = require('node:util');
const { sameId, rejected, stripNulls } = require('./policy');
const { near } = require('./reconciliation');
const { normalize } = require('./normalization');
const { toMinorUnits } = require('../../utils/money');
function decide(facts, scope, decideIngestion) {
  const c = scope.command, item = c.item, rel = c.relationship, r = facts.general_current, review = facts.general_review;
  const stop = reason => ({ action: 'return', result: rejected(reason) });
  const prior = facts.general_command_receipt;
  if (prior) return prior.command_hash === facts.general_command_hash
    ? { action: 'return', result: { ...prior.current_result, resolved_revision: prior.revision } } : stop('command_key_conflict');
  if (!r) return stop('receipt_not_found');
  if (review.review_token !== c.review_token || String(review.revision) !== String(c.expected_revision)) return stop('stale_review');
  if (r.observation_id != null) return stop('observation_review_required');
  if (review.revision >= 50) return stop('resolution_limit');
  if (item.key !== r.item_key) return stop('delivery_key_change_forbidden');
  if ((!equal(r.evidence.provider_reference, item.provider_reference) || r.evidence.identity_basis !== item.identity_basis) && rel.kind !== 'provider_link') return stop('identity_relationship_required');
  for (const k of ['kind', 'basis', 'purchase_key']) if (r.evidence.event[k] != null && r.evidence.event[k] !== 'unknown'
    && !equal(r.evidence.event[k], item.event[k])) return stop('known_event_change_forbidden');
  if (r.evidence.charged?.currency != null && r.evidence.charged.currency !== item.charged?.currency) return stop('known_currency_change_forbidden');
  if ((r.evidence.legacy_external_id ?? null) !== (item.legacy_external_id ?? null)) return stop('historical_identity_change_forbidden');
  const reg = facts.registrations.find(g => sameId(g.source_id, r.source_id)), src = facts.sources.find(s => sameId(s.id, r.source_id));
  const refused = reason => ({ action: 'return', result: { outcome: 'rejected', accepted: false, financial_posted: false, review_required: false, retryable: false, reason_code: reason } });
  if (!reg?.enabled) return refused('registration_required');
  if (!src?.is_active || src.source_kind !== 'cal') return refused('source_unavailable');
  const e = item.event, d = item.dates, m = item.charged;
  let reason = null, payment;
  const mapped = facts.payments.filter(p => (src.configuration.payment_source_ids || []).includes(String(p.id)));
  if (!mapped.length) reason = 'mapping_missing';
  else if (mapped.length > 1) reason = 'mapping_ambiguous';
  else { payment = mapped[0].id; if (!mapped[0].is_active) reason = 'inactive_card_review'; }
  if (!reg.history_reviewed) reason ||= 'historical_transition_review';
  if (facts.general_reserved) reason ||= 'historical_identity_reserved';
  if (item.identity_basis === 'unresolved') reason ||= 'identity_unresolved';
  if (e.status !== 'completed') reason ||= 'source_not_completed';
  // Historical envelope is not the approved positive-amount v1 refund contract.
  if (!['expense', 'income'].includes(e.kind)) reason ||= 'unsupported_event_kind';
  if (m?.currency !== 'ILS' || m?.scale !== 2 || m?.amount == null || toMinorUnits(m.amount) <= 0n) reason ||= 'exact_ils_charge_required';
  if (e.basis === 'unknown') reason ||= 'event_basis_unresolved';
  if (e.basis === 'whole_purchase') reason ||= 'whole_purchase_not_posted';
  if (e.basis === 'installment') {
    if (!e.installment?.current || !(e.installment.total >= 2) || e.purchase_key == null) reason ||= 'installment_evidence_required';
    else if (d.purchase == null) reason ||= 'installment_purchase_date_required';
    else if (reg.installment_date_policy === 'review') reason ||= 'installment_policy_required';
  }
  if (!reason && e.purchase_key != null) for (const other of facts.general_group) {
    if (sameId(other.id, r.id) || !sameId(other.source_id, src.id)) continue;
    const event = other.evidence.event;
    if (event.basis === 'single' || e.basis === 'single' || (e.basis === 'installment' && event.basis === 'installment' && event.installment?.current === e.installment?.current)) { reason = 'purchase_identity_reserved'; break; }
    if (e.basis === 'installment' && event.installment?.total != null && event.installment.total !== e.installment?.total) { reason = 'installment_count_conflict'; break; }
  }
  const day = e.basis === 'installment' ? d.billing : d.purchase;
  if (!day) reason ||= 'accounting_date_evidence_required';
  if (e.basis === 'installment' && facts.transactions.some(t => sameId(t.payment_source_id, payment) && (near(t.transaction_date, d.purchase) || near(t.transaction_date, day))
    && !facts.general_group.some(g => sameId(g.source_id, src.id) && g.evidence.event.basis === 'installment'
      && facts.observations.some(o => sameId(o.id, g.observation_id) && sameId(o.transaction_id, t.id))))) reason ||= 'installment_existing_purchase_review';
  let nested, nestedScope;
  if (!reason) {
    const observation = stripNulls({ idempotency_key: item.key, merchant: item.merchant, accounting_amount: m.amount,
      currency: 'ILS', movement_type: e.kind, transaction_date: day, charge_date: d.billing, occurred_at: d.occurred_at,
      payment_source_id: String(payment), provider_reference: item.provider_reference,
      source_metadata: { channel: e.basis === 'installment' ? 'general_v1_installment' : 'general_v1', provider_status: e.status },
      original_amount: item.original?.amount, original_currency: item.original?.currency, original_scale: item.original?.scale });
    nestedScope = { channel: 'observation', source_id: String(src.id), key: item.key, observation, hash_input: normalize(observation).input, date: day };
    nested = decideIngestion(facts, nestedScope);
    if (nested.action === 'return') { reason = nested.result.reason_code || 'ingestion_rejected'; nested = null; }
  }
  return { action: 'general', revision: review.revision + 1, nested, nested_scope: nestedScope,
    result: { outcome: 'review_required', accepted: true, retryable: false, review_required: true, financial_posted: false, reason_code: reason } };
}
module.exports = { decide };
