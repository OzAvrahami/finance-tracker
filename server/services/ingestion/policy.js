'use strict';
const { randomUUID } = require('node:crypto');
const { toMinorUnits, fromMinorUnits } = require('../../utils/money');
const { normalize, normalizeMerchant, fail, object } = require('./normalization');
const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const stripNulls = value => Object.fromEntries(Object.entries(value).filter(([, v]) => v != null));
const rejected = reason => ({ outcome: 'rejected', original_outcome: null, observation_id: null, transaction_id: null,
  disposition: 'pending', review_required: false, reason_code: reason, replayed: false, decision_revision: null });
const sourceFor = (facts, scope) => facts.sources.find(s => scope.source_id != null
  ? sameId(s.id, scope.source_id) : s.instance_key === `unified:${scope.channel === 'external' ? 'v1' : scope.channel}`);

function mapPayment(facts, source, input, unified = false) {
  if (unified) return facts.payments.find(p => sameId(p.id, input.payment_source_id) && p.is_active)?.id ?? null;
  const cfg = source.configuration, e = input.payment_evidence || {};
  const mapped = e.card_reference == null ? null : (cfg.card_mappings || []).find(m => m.card_reference === e.card_reference)?.payment_source_id;
  if (e.card_reference != null && mapped == null) fail('payment_source_not_found');
  if (input.payment_source_id != null && mapped != null && !sameId(input.payment_source_id, mapped)) fail('payment_source_conflict');
  const chosen = input.payment_source_id ?? mapped;
  if (chosen == null && e.last4 == null) fail('payment_source_not_found');
  const matches = facts.payments.filter(p => p.is_active && (cfg.payment_source_ids || []).includes(String(p.id))
    && (chosen == null || sameId(p.id, chosen))
    && ['last4', 'issuer', 'method', 'owner', 'name'].every(k => e[k] == null || p[k] === e[k]));
  if (!matches.length) fail('payment_source_not_found');
  if (matches.length > 1) fail('payment_source_ambiguous');
  return matches[0].id;
}

function external(facts, scope) {
  const r = scope.request;
  let payment, hold = null;
  if (r.payment_source_id != null) payment = facts.payments.find(p => sameId(p.id, r.payment_source_id) && p.is_active)?.id;
  else {
    const digits = (r.payment_source_name || '').replace(/\D/g, '');
    const matches = facts.payments.filter(p => p.is_active && r.payment_source_name != null
      && (digits.length >= 4 ? p.last4 === digits.slice(-4) : p.name.toLowerCase() === r.payment_source_name.toLowerCase()));
    if (matches.length === 1) payment = matches[0].id;
    else if (matches.length > 1) hold = 'payment_source_ambiguous';
  }
  if (payment == null) hold ||= 'payment_source_not_found';
  const kind = r.type === 'refund' ? 'expense' : r.type;
  const signed = toMinorUnits(r.amount) * (r.type === 'refund' ? -1n : 1n);
  let category = r.category_id;
  if (category == null && r.description != null) category = facts.categories.find(c => c.is_active && c.savings_role == null && c.type === kind
    && (c.keywords || []).some(k => r.description.toLowerCase().includes(k.toLowerCase())))?.id;
  if (category != null && !facts.categories.some(c => sameId(c.id, category) && c.is_active && c.savings_role == null && c.type === kind)) fail('invalid_category');
  const method = facts.payments.find(p => sameId(p.id, payment))?.method;
  // Approved change: refund eligibility is evidence-based, never method-based.
  // Income is independent and retains the bank-account-only policy.
  if (r.type !== 'refund' && ['bank_transfer', 'check'].includes(method)) hold ||= 'bank_event_semantics_required';
  if (r.type === 'income' && method !== 'bank_account') hold ||= 'refund_semantics_required';
  if (r.type === 'refund' && (r.currency || 'ILS') !== 'ILS') fail('refund_currency_unsupported');
  if (['income', 'refund'].includes(r.type) && r.external_id == null) hold ||= 'identity_evidence_required';
  if (r.installment_number != null) hold ||= 'installment_series_required';
  if ((r.currency || 'ILS') !== 'ILS' && r.original_amount == null) hold ||= 'original_amount_required';
  if (facts.historical_reserved) hold ||= 'historical_identity_reserved';
  const row = stripNulls({ description: r.description, movement_type: kind, bank_movement: r.type === 'refund' ? 'refund' : null,
    // Keep the JSON numeric scale of the public request in immutable _creation.
    // Arithmetic above is exact; this string is a storage representation only.
    total_amount: `${r.type === 'refund' ? '-' : ''}${String(r.amount)}`, transaction_date: r.date, charge_date: r.charge_date || r.date,
    payment_source_id: payment, category_id: category, currency: r.currency || 'ILS',
    original_amount: r.original_amount, exchange_rate: r.exchange_rate, external_id: r.external_id,
    notes: r.notes, tags: r.tags?.length ? r.tags.join(',') : null,
    installment_number: r.installment_number, installment_count: r.installment_count,
    installments_info: r.installment_number != null ? `${r.installment_number}/${r.installment_count}` : null });
  const observation = stripNulls({ idempotency_key: r.external_id || scope.key,
    merchant: r.description || '(description not supplied)', accounting_amount: fromMinorUnits(signed), currency: 'ILS', movement_type: kind,
    transaction_date: r.date, charge_date: r.charge_date, payment_source_id: payment == null ? null : String(payment),
    category_id: category == null ? null : String(category), source_metadata: stripNulls({ channel: 'external_v1', bank_movement: row.bank_movement }) });
  return { row, observation, hold, payment: payment ?? null, category: category ?? null };
}

const ownedFields = ['description', 'movement_type', 'total_amount', 'transaction_date', 'charge_date', 'payment_source_id', 'category_id',
  'currency', 'original_amount', 'exchange_rate', 'notes', 'tags', 'installment_number', 'installment_count', 'installments_info',
  'global_discount', 'global_discount_source', 'parent_transaction_id', 'loan_id', 'bank_movement'];
function owned(facts, scope) {
  const row = scope.row; object(row, ownedFields);
  if (scope.domain != null) object(scope.domain, ['loan_payment']);
  if (scope.channel === 'csv' && (scope.domain != null || row.loan_id != null)) fail('unsupported_domain');
  let hold = null;
  if (scope.channel === 'csv') {
    if ((row.currency || 'ILS') !== 'ILS' && !(row.original_amount != null && /^[\d.]+$/.test(String(row.original_amount)) && /[1-9]/.test(String(row.original_amount)))) hold = 'original_amount_required';
    if (row.movement_type === 'income') hold = 'refund_semantics_required';
    if (facts.payments.some(p => sameId(p.id, row.payment_source_id) && ['bank_transfer', 'check', 'bank_account'].includes(p.method))) hold = 'bank_event_semantics_required';
    if (row.installments_info != null || Number(row.installment_count) > 1) hold ||= 'installment_series_required';
  }
  const key = scope.channel === 'manual' && facts.manual_resume_key ? facts.manual_resume_key : scope.key;
  return { row, hold, observation: stripNulls({ idempotency_key: key,
    merchant: row.description || '(description not supplied)', accounting_amount: String(row.total_amount), currency: 'ILS', movement_type: row.movement_type,
    transaction_date: row.transaction_date, charge_date: row.charge_date,
    payment_source_id: row.payment_source_id == null ? null : String(row.payment_source_id), category_id: row.category_id == null ? null : String(row.category_id),
    source_metadata: { channel: scope.channel, terminal_reference: scope.channel === 'csv' ? key.split(':')[1] || '' : '',
      ...(row.bank_movement === 'refund' ? { bank_movement: 'refund' } : {}) } }) };
}

function prepare(facts, scope) {
  const source = sourceFor(facts, scope);
  if (!source || !source.is_active || source.source_kind === 'legacy_api') fail('source_unavailable');
  const draft = scope.channel === 'external' ? external(facts, scope)
    : ['manual', 'csv'].includes(scope.channel) ? owned(facts, scope) : { observation: scope.observation, row: null, hold: null };
  const manualRefund = scope.channel === 'manual' && source.source_kind === 'manual'
    && source.instance_key === 'unified:manual' && draft.row?.bank_movement === 'refund';
  const externalRefund = scope.channel === 'external' && source.source_kind === 'external_api'
    && source.instance_key === 'unified:v1' && scope.request?.type === 'refund';
  const n = normalize(draft.observation, { refund: manualRefund || externalRefund });
  if (n.input.source_metadata.bank_movement === 'refund' && !(manualRefund || externalRefund)) fail('refund_source_unsupported');
  const unified = ['unified:v1', 'unified:manual', 'unified:csv'].includes(source.instance_key);
  const payment = mapPayment(facts, source, n.input, unified);
  if (unified && payment == null) draft.hold ||= 'payment_source_not_found';
  if (n.input.category_id != null && !facts.categories.some(c => sameId(c.id, n.input.category_id)
    && c.is_active && c.savings_role == null && c.type === n.input.movement_type)) fail('invalid_category');
  const alias = (source.configuration.aliases || []).find(a => normalizeMerchant(a.merchant) === n.merchant
    && (a.payment_source_id == null || sameId(a.payment_source_id, payment)));
  const ref = n.input.provider_reference;
  return { ...draft, n, source, payment, merchant_key: alias ? `alias:${alias.key}` : `raw:${n.merchant}`,
    reference_verified: ref != null && (source.configuration.verified_references || []).some(r => ['provider', 'type', 'scope'].every(k => r[k] === ref[k])),
    time_verified: source.configuration.time_verified === true && n.instant != null };
}
module.exports = { prepare, external, owned, mapPayment, sameId, stripNulls, rejected, sourceFor, randomUUID };
