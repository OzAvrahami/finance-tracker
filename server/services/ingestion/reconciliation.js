'use strict';
const { isDeepStrictEqual } = require('node:util');
const { instantMicros, storedMinor } = require('./normalization');
const { sameId } = require('./policy');
const near = (a, b) => a != null && b != null && Math.abs(Date.parse(a) - Date.parse(b)) <= 86400000;
const protectedCash = t => Boolean(t.loan_id || t.parent_transaction_id || Number(t.installment_count) > 1
  || t.installment_number != null || t.installments_info != null || /[1-9]/.test(String(t.global_discount || '0'))
  || t.currency !== 'ILS' || /[1-9]/.test(String(t.original_amount || '0')) || /[1-9]/.test(String(t.exchange_rate || '0'))
  || t.links?.length || t.savings_role != null);
const capturedCash = t => t.budget_facts?.some(f => f.operation_type === 'month_close' || ['carryover', 'unused_disposition'].includes(f.item_kind)) || false;

function match(facts, draft) {
  if (facts.overflow) return { outcome: 'ambiguous', reason: draft.hold || 'candidate_overflow', target: null, candidate_ids: [] };
  const { source, n, payment, reference_verified, time_verified } = draft, p = n.input;
  const observations = facts.observations, cash = new Map(facts.transactions.map(t => [String(t.id), t]));
  const candidates = new Map(); let sentinel = null;
  const candidate = (id, flags) => {
    const prev = candidates.get(String(id)) || {};
    candidates.set(String(id), Object.fromEntries(Object.entries(flags).map(([k, v]) => [k, Boolean(prev[k] || v)])));
  };
  for (const c of observations) {
    if (c.evidence_origin !== 'source' || c.transaction_id == null) continue;
    const other = !sameId(c.source_id, source.id) || source.source_kind === 'manual'
      || (source.source_kind === 'external_api' && draft.row?.external_id == null)
      || (source.source_kind === 'file_import' && c.source_metadata?.terminal_reference !== p.source_metadata.terminal_reference);
    const strong = reference_verified && c.reference_verified && isDeepStrictEqual(c.provider_reference, p.provider_reference);
    const tuple = sameId(c.payment_source_id, payment) && c.amount_minor === n.amount_minor && c.currency_code === 'ILS'
      && c.amount_basis === 'accounting' && c.movement_type === p.movement_type && near(c.source_transaction_date, n.date);
    if (!other || !(tuple || strong)) continue;
    const t = cash.get(String(c.transaction_id)); if (!t) throw new Error('incomplete_ingestion_snapshot');
    const merchant = c.merchant_key === draft.merchant_key || c.normalized_merchant === n.merchant;
    const comparable = time_verified && c.time_verified && c.instant_micros != null;
    const time = comparable && BigInt(c.instant_micros) <= instantMicros(n.instant) + BigInt(n.width_micros)
      && instantMicros(n.instant) <= BigInt(c.instant_micros) + BigInt(c.width_micros);
    if (comparable && !time && !strong) continue;
    if (t.voided_at != null) sentinel = 'cancelled_record_exists';
    else if (protectedCash(t)) sentinel = 'protected_transaction';
    else if (c.identity_overridden || !c.identity_matches) sentinel = 'identity_edited';
    else if (strong && (!sameId(c.payment_source_id, payment) || c.amount_minor !== n.amount_minor || c.movement_type !== p.movement_type)) sentinel = 'reference_conflict';
    const saturated = observations.some(o => sameId(o.transaction_id, t.id) && sameId(o.source_id, source.id));
    candidate(t.id, { reference: strong && near(c.source_transaction_date, n.date) && !saturated,
      time: time && merchant && !saturated, unknown: !comparable || !merchant });
    if (candidates.size > 100) break;
  }
  let legacyCount = 0;
  for (const t of facts.transactions) {
    if (observations.some(o => sameId(o.transaction_id, t.id) && o.evidence_origin === 'source')) continue;
    const legacy = observations.filter(o => sameId(o.transaction_id, t.id) && ['legacy_insert', 'legacy_backfill'].includes(o.evidence_origin));
    const tuple = sameId(t.payment_source_id, payment) && t.movement_type === p.movement_type && String(storedMinor(t.total_amount)) === n.amount_minor && near(t.transaction_date, n.date);
    if (!tuple && !legacy.some(o => sameId(o.payment_source_id, payment) && o.movement_type === p.movement_type && o.amount_minor === n.amount_minor && near(o.source_transaction_date, n.date))) continue;
    candidates.set(String(t.id), { reference: false, time: false, unknown: true });
    if (t.voided_at != null) sentinel = 'cancelled_record_exists';
    else if (protectedCash(t)) sentinel = 'protected_transaction';
    else if (legacy.some(o => !o.identity_matches)) sentinel = 'identity_edited';
    if (++legacyCount === 101) break;
  }
  // jsonb object keys order by byte length then bytes; preserve candidate ordering.
  const ids = [...candidates.keys()].sort((a, b) => a.length - b.length || a.localeCompare(b, 'en'));
  const refs = ids.filter(id => candidates.get(id).reference), times = ids.filter(id => candidates.get(id).time), unknown = ids.filter(id => candidates.get(id).unknown);
  let outcome = 'created', reason = 'no_candidate', target = null;
  if (facts.overflow || candidates.size > 100) { outcome = 'ambiguous'; reason = 'candidate_overflow'; }
  else if (sentinel) { outcome = 'conflict'; reason = sentinel; }
  else if (refs.length === 1) { target = refs[0]; reason = 'verified_reference'; }
  else if (refs.length > 1) { outcome = 'ambiguous'; reason = 'competing_references'; }
  else if (times.length === 1 && !unknown.some(id => id !== times[0])) { target = times[0]; reason = 'precision_time'; }
  else if (ids.length) { outcome = 'ambiguous'; reason = 'competing_candidates'; }
  if (target != null) outcome = 'reconciled';
  let hold = draft.hold;
  // A signed owner refund is explicitly one new credit, not an installment.
  // Unrelated purchase schedules on its card must not block this operation.
  const manualRefund = source.source_kind === 'manual' && draft.row?.bank_movement === 'refund' && BigInt(n.amount_minor) < 0n;
  if ((!manualRefund && facts.installments.some(i => sameId(i.payment_source_id, payment) && (i.idempotency_key == null || i.idempotency_key !== p.idempotency_key)))
    || (source.source_kind === 'manual' && Number(draft.row?.installment_count) > 1
      && facts.transactions.some(t => sameId(t.payment_source_id, payment) && near(t.transaction_date, n.date)))) hold ||= 'installment_series_review';
  if (observations.some(o => o.transaction_id == null && !sameId(o.source_id, source.id) && sameId(o.payment_source_id, payment)
    && o.amount_minor === n.amount_minor && o.movement_type === p.movement_type && near(o.source_transaction_date, n.date))) hold ||= 'pending_observation_review';
  if (hold) { target = null; outcome = 'ambiguous'; reason = hold; }
  return { outcome, reason, target, candidate_ids: candidates.size > 100 ? [] : ids.map(Number) };
}

function enrichment(facts, observation, charge) {
  if (charge == null) return { ok: true };
  const t = facts.transactions.find(t => sameId(t.id, observation.transaction_id));
  if (!t || t.voided_at != null) return { ok: false };
  const creator = facts.observations.find(o => sameId(o.transaction_id, t.id) && o.charge_date_origin != null);
  if (!creator || protectedCash(t) || capturedCash(t) || creator.identity_overridden || creator.charge_date_overridden) return { ok: false };
  if (creator.charge_date_origin !== 'provisional_purchase_date') return { ok: t.charge_date === charge };
  return { ok: true, transaction_id: String(t.id), creator_id: String(creator.id), charge_date: charge };
}
module.exports = { near, protectedCash, capturedCash, match, enrichment };
