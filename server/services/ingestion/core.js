'use strict';
const { isDeepStrictEqual } = require('node:util');
const { randomUUID } = require('node:crypto');
const { normalize, date, object, fail, storedMinor } = require('./normalization');
const { prepare, external: prepareExternal, sameId, rejected, stripNulls, sourceFor } = require('./policy');
const { match, enrichment, near, protectedCash, capturedCash } = require('./reconciliation');
const { fromMinorUnits } = require('../../utils/money');

const heldReasons = new Set(['payment_source_not_found', 'payment_source_ambiguous', 'historical_identity_reserved',
  'bank_event_semantics_required', 'refund_semantics_required', 'original_amount_required', 'identity_evidence_required']);
const posting = (draft, old = null) => {
  const p = draft.n.input;
  const row = draft.row || stripNulls({ description: p.merchant, movement_type: p.movement_type,
    total_amount: fromMinorUnits(draft.n.amount_minor), currency: 'ILS', transaction_date: draft.n.date,
    payment_source_id: draft.payment, category_id: p.category_id, notes: old?.cal_fields?.notes,
    tags: old?.cal_fields?.tags?.join(',') });
  return { ...row, charge_date: old?.charge_evidence || p.charge_date || draft.n.date };
};
const priorDraft = (facts, o) => ({ n: { input: o.accepted_payload, date: o.source_transaction_date, amount_minor: o.amount_minor },
  row: o.accepted_payload._creation, source: facts.sources.find(s => sameId(s.id, o.source_id)), payment: o.payment_source_id });
const canPost = (facts, o) => {
  if (heldReasons.has(o.reason_code)) return 'evidence_correction_required';
  if (!o.amount_minor || BigInt(o.amount_minor) === 0n || !o.source_transaction_date) return 'incomplete_accounting_evidence';
  if (!facts.payments.some(p => sameId(p.id, o.payment_source_id) && p.is_active)) return 'payment_source_not_found';
  if (o.accepted_payload.category_id != null && !facts.categories.some(c => sameId(c.id, o.accepted_payload.category_id)
    && c.is_active && c.savings_role == null && c.type === o.movement_type)) return 'invalid_category';
  if (BigInt(o.amount_minor) < 0n && !(o.movement_type === 'expense' && o.accepted_payload._request?.type === 'refund'
    && o.accepted_payload._creation?.bank_movement === 'refund' && facts.sources.some(s => sameId(s.id, o.source_id)
      && s.source_kind === 'external_api' && s.instance_key === 'unified:v1'))) return 'refund_source_unsupported';
  return null;
};
const returned = result => ({ action: 'return', result });
const linkReason = (facts, o, t) => {
  if (!t || t.voided_at != null || protectedCash(t) || capturedCash(t)) return 'protected_transaction';
  if (String(storedMinor(t.total_amount)) !== o.amount_minor || t.movement_type !== o.movement_type
    || !sameId(t.payment_source_id, o.payment_source_id) || !near(t.transaction_date, o.source_transaction_date)
    || facts.observations.some(x => sameId(x.transaction_id, t.id) && sameId(x.source_id, o.source_id))) return 'review_target_conflict';
  return null;
};
const separateReason = (facts, o) => {
  const source = facts.sources.find(s => sameId(s.id, o.source_id));
  if (source?.source_kind === 'manual') return o.outcome !== 'ambiguous'
    || ['payment_source_not_found', 'payment_source_ambiguous', 'historical_identity_reserved', 'original_amount_required'].includes(o.reason_code)
    ? 'evidence_correction_required' : null;
  return o.outcome === 'conflict' ? 'conflict_requires_domain_correction' : canPost(facts, o);
};
function decideIngestion(facts, scope) {
  if (scope.channel === 'flowlink') {
    const auth = facts.auth, b = auth?.binding;
    const error = code => returned({ error: { code } });
    if (!auth || auth.credential_status !== 'active' || auth.device_status !== 'active') return error('unauthorized');
    if (!b || b.status !== 'active') return error('binding_unavailable');
    if (!auth.source_matches || !facts.sources.some(s => sameId(s.id, b.source_id) && s.is_active)) return error('flowlink_configuration_invalid');
    if (!facts.payments.some(p => sameId(p.id, b.payment_source_id) && p.is_active)) return returned(rejected('payment_source_not_found'));
    const r = scope.request;
    scope = { ...scope, source_id: String(b.source_id), observation: { idempotency_key: r.idempotency_key,
      accounting_amount: r.amount, currency: 'ILS', movement_type: 'expense', merchant: r.merchant,
      transaction_date: r.transaction_date, payment_source_id: String(b.payment_source_id) } };
  }
  if (scope.channel === 'external' && facts.historical_replay && !scope.dry_run) {
    // The former external command validated category/currency before returning
    // its historical receipt, without requiring a new unified source mapping.
    prepareExternal(facts, scope);
    return returned(facts.historical_replay);
  }
  if (['observation', 'flowlink'].includes(scope.channel)) {
    const source = sourceFor(facts, scope);
    if (!source?.is_active || source.source_kind === 'legacy_api') return returned(rejected('source_unavailable'));
    normalize(scope.observation);
    const previous = facts.observations.find(o => sameId(o.source_id, source.id) && o.idempotency_key === scope.key);
    if (previous) return { action: previous.payload_fingerprint === facts.hash ? 'replay' : 'conflict', observation_id: previous.id };
  }
  const draft = prepare(facts, scope), { n, source } = draft;
  if (scope.dry_run) {
    const row = { ...draft.row };
    for (const k of ['total_amount', 'payment_source_id', 'category_id']) if (row[k] != null) row[k] = Number(row[k]);
    return returned({ dry_run: true, would_insert: row, matching_deferred: true,
      resolved: { payment_source_id: draft.payment == null ? null : Number(draft.payment), category_id: draft.category == null ? null : Number(draft.category) },
      duplicate: draft.hold === 'historical_identity_reserved' ? { exists: true } : null, review_reason: draft.hold });
  }
  const old = facts.observations.find(o => sameId(o.source_id, source.id) && o.idempotency_key === n.input.idempotency_key);
  if (old) {
    if (old.payload_fingerprint !== facts.hash) return { action: 'conflict', observation_id: old.id };
    if (source.source_kind === 'manual' && old.transaction_id == null && old.reason_code === 'manual_domain_approved') {
      const event = facts.events.filter(e => sameId(e.observation_id, old.id) && e.reason_code === 'manual_domain_approved').at(-1);
      if (!isDeepStrictEqual(old.review_fingerprints, event?.evidence.candidate_fingerprints)) return returned({ ...old.result, reason_code: 'stale_review', review_required: true });
      const invalid = canPost(facts, old); if (invalid) return returned(rejected(invalid));
      return { action: 'resume', observation_id: old.id, revision: old.decision_revision, posting: posting(priorDraft(facts, old), old), reason: 'owner_separate' };
    }
    return { action: 'replay', observation_id: old.id };
  }
  const decision = match(facts, draft);
  const enrich = decision.outcome === 'reconciled' && source.source_kind === 'cal'
    ? enrichment(facts, { transaction_id: decision.target }, n.input.charge_date) : null;
  return { action: 'ingest', ...decision, source_id: source.id, normalized: n, payment: draft.payment,
    merchant_key: draft.merchant_key, reference_verified: draft.reference_verified, time_verified: draft.time_verified,
    creation: draft.row, posting: posting(draft), enrichment: enrich,
    event_evidence: { candidate_ids: decision.candidate_ids, source_revision: String(source.revision) } };
}

const conflict = (o, reason) => returned({ ...o.result, outcome: 'conflict', reason_code: reason, review_required: true });
function decideCommand(facts, scope) {
  if (facts.command_receipt) return returned(facts.command_receipt);
  const c = scope.command, kind = scope.command_kind;
  let o = facts.observations.find(o => kind === 'cancel' ? sameId(o.transaction_id, c.transaction_id) && o.evidence_origin === 'source'
    : sameId(o.id, c.observation_id) && o.evidence_origin === 'source');
  if (kind === 'cancel') {
    const t = facts.transactions.find(t => sameId(t.id, c.transaction_id));
    if (!o || !t || t.voided_at != null || protectedCash(t) || capturedCash(t)) return returned(rejected('protected_transaction'));
    if (String(c.expected_revision) !== o.decision_revision || c.expected_transaction_fingerprint !== t.cash_fingerprint) return conflict(o, 'stale_review');
    return { action: 'cancel', observation_id: o.id, revision: o.decision_revision, reason: 'owner_cancelled', event_evidence: { reason: c.reason } };
  }
  if (kind === 'amend' && !facts.sources.some(s => sameId(s.id, c.source_id) && s.is_active && s.source_kind === 'cal')) return returned(rejected('source_unavailable'));
  if (!o || (kind === 'amend' && !sameId(o.source_id, c.source_id))) return returned(rejected('observation_not_found'));
  if (String(c.expected_revision) !== o.decision_revision) return conflict(o, 'stale_review');
  if (kind === 'amend') {
    const charge = date(c.charge_date), enrich = o.transaction_id == null ? { ok: true } : enrichment(facts, o, charge);
    return { action: 'amend', observation_id: o.id, revision: o.decision_revision, enrichment: enrich,
      reason: enrich.ok ? 'charge_date_evidence' : 'enrichment_conflict', event_evidence: { charge_date: charge } };
  }
  if (scope.review && (!isDeepStrictEqual(c.expected_candidate_fingerprints, o.review_fingerprints)
    || (c.action === 'link' && !Object.hasOwn(o.review_fingerprints, c.transaction_id)))) return returned(rejected('stale_review'));
  if (o.transaction_id != null) return conflict(o, 'stale_review');
  const source = facts.sources.find(s => sameId(s.id, o.source_id));
  if (c.action === 'link') {
    const t = facts.transactions.find(t => sameId(t.id, c.transaction_id));
    const invalid = linkReason(facts, o, t);
    if (invalid === 'protected_transaction') return returned(rejected(invalid));
    if (invalid || t.cash_fingerprint !== c.expected_transaction_fingerprint) return conflict(o, 'review_target_conflict');
    return { action: 'link', observation_id: o.id, revision: o.decision_revision, target: t.id,
      enrichment: source.source_kind === 'cal' ? enrichment(facts, { ...o, transaction_id: t.id }, o.charge_evidence) : null,
      reason: 'owner_link', event_evidence: { reason: c.reason, previous_candidates: o.candidate_ids } };
  }
  if (scope.review && source.source_kind === 'manual') {
    const invalid = separateReason(facts, o); if (invalid) return returned(rejected(invalid));
    return { action: 'approve', observation_id: o.id, revision: o.decision_revision, reason: 'manual_domain_approved', event_evidence: { candidate_fingerprints: o.review_fingerprints } };
  }
  if (o.outcome === 'conflict') return returned(rejected('conflict_requires_domain_correction'));
  if (!isDeepStrictEqual(c.expected_candidate_fingerprints, o.review_fingerprints)) return conflict(o, 'stale_review');
  if (source.source_kind === 'manual') return returned(rejected('manual_domain_resume_required'));
  const invalid = canPost(facts, o); if (invalid) return returned(rejected(invalid));
  return { action: 'separate', observation_id: o.id, revision: o.decision_revision,
    posting: posting(priorDraft(facts, o), o), reason: 'owner_separate', event_evidence: { reason: c.reason, previous_candidates: o.candidate_ids } };
}

async function rpc(db, name, args, ms) {
  const { boundedCommand } = require('../ingestionCommand');
  return boundedCommand(db, name, args, ms);
}
async function execute(db, scope, options = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const snapshot = await rpc(db, 'ingestion_core_snapshot', { p_scope: scope }, options.commandMs);
    if (snapshot.outcome === 'retryable_failure') {
      if (['40001', '40P01', '55P03'].includes(snapshot.database_code) && attempt === 0) continue;
      return snapshot;
    }
    if (!snapshot.facts || !snapshot.token) throw new Error('invalid_ingestion_snapshot');
    let decision;
    try { decision = scope.command_kind === 'general' ? require('./historicalReceipts').decide(snapshot.facts, scope, decideIngestion)
      : scope.command ? decideCommand(snapshot.facts, scope) : decideIngestion(snapshot.facts, scope); }
    catch (error) { if (error.code === 'APY_INPUT') decision = returned(rejected(error.reason)); else throw error; }
    // Even decisions without writes are returned from the consistency boundary:
    // no stale approval, replay or dry-run is accepted from mixed facts.
    const result = await rpc(db, 'ingestion_core_commit', { p_scope: scope, p_token: snapshot.token, p_decision: decision }, options.commandMs);
    if (result.outcome === 'retryable_failure' && ['40001', '40P01', '55P03'].includes(result.database_code) && attempt === 0) continue;
    return result;
  }
}
const external = (db, request, dryRun = false, options = {}) => execute(db, {
  channel: 'external', request, hash_input: request, dry_run: dryRun, key: request.external_id || randomUUID(), date: request.date,
}, options);
const owned = (db, channel, row, key, evidence, domain) => execute(db, {
  channel, row, key, evidence, domain, hash_input: evidence, date: row.transaction_date,
});
const observation = (db, sourceId, input) => {
  const n = normalize(input);
  return execute(db, { channel: 'observation', source_id: sourceId, observation: input, key: input.idempotency_key, hash_input: n.input, date: n.date });
};
const flowlink = (db, credential, request) => {
  require('../../config/flowlinkBindings').walletRequest(request);
  const hashInput = normalize({ idempotency_key: request.idempotency_key, accounting_amount: request.amount, currency: 'ILS',
    movement_type: 'expense', merchant: request.merchant, transaction_date: request.transaction_date }).input;
  return execute(db, { channel: 'flowlink', credential, request, hash_input: hashInput, key: request.idempotency_key, date: request.transaction_date });
};
const general = (db, key, payload) => execute(db, { command_kind: 'general', request_key: key, command: payload,
  date: payload.item.event.basis === 'installment' ? payload.item.dates.billing : payload.item.dates.purchase });
const command = (db, kind, key, payload, review = false) => {
  const fields = kind === 'cancel' ? ['transaction_id', 'expected_revision', 'expected_transaction_fingerprint', 'reason', 'actor']
    : kind === 'amend' ? ['source_id', 'observation_id', 'expected_revision', 'charge_date', 'actor']
    : ['observation_id', 'expected_revision', 'action', 'transaction_id', 'expected_transaction_fingerprint', 'expected_candidate_fingerprints', 'reason', 'actor'];
  object(payload, fields);
  if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(key || '') || typeof payload.actor !== 'string' || !payload.actor.length || payload.actor.length > 255
    || (kind !== 'amend' && (typeof payload.reason !== 'string' || !payload.reason.length || payload.reason.length > 500))
    || (kind === 'resolve' && !['link', 'separate'].includes(payload.action))) fail('invalid_review_command');
  return execute(db, { command_kind: kind, request_key: key, command: payload, review });
};
module.exports = { external, owned, observation, flowlink, general, command, execute, decideIngestion, decideCommand, canPost, posting, priorDraft, returned, linkReason, separateReason };
