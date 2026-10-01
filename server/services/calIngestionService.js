// Opt-in compatibility adapter for the inspected Financial Data Bridge v1 producer.
// Existing API-key authorization remains upstream. No matching or financial writes here.
const ingestion = require('./transactionIngestionService');
const { safeResult } = require('./applePayIngestionService');
const { id, UUID, safeIdentity, keys } = require('../config/applePay');
const fail = (code, status = 422) => { throw Object.assign(new Error(code), { calCode: code, status }); };
const fields = ['type', 'amount', 'date', 'description', 'charge_date', 'category_id', 'payment_source_id',
  'payment_source_name', 'currency', 'original_amount', 'exchange_rate', 'notes', 'tags', 'external_id', 'dry_run', 'cal_contract'];

function profiles(env = process.env) {
  if (!env.CAL_INGESTION_SOURCES) return [];
  if (Buffer.byteLength(env.CAL_INGESTION_SOURCES) > 32768) fail('cal_configuration_invalid', 503);
  let configs;
  try { configs = JSON.parse(env.CAL_INGESTION_SOURCES); } catch { fail('cal_configuration_invalid', 503); }
  if (!Array.isArray(configs) || !configs.length || configs.length > 32) fail('cal_configuration_invalid', 503);
  const names = new Set(), instances = new Set(), requests = new Set();
  for (const c of configs) {
    if (!keys(c, ['instance_key', 'request_key', 'payment_source_name', 'payment_source_id', 'expected_revision', 'aliases'])
      || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(c.instance_key || '') || !UUID.test(c.request_key || '')
      || !safeIdentity(c.payment_source_name) || !id(c.payment_source_id)
      || (c.expected_revision !== undefined && !id(c.expected_revision))
      || names.has(c.payment_source_name) || instances.has(c.instance_key) || requests.has(c.request_key)
      || (c.aliases !== undefined && (!Array.isArray(c.aliases) || c.aliases.length > 64))) fail('cal_configuration_invalid', 503);
    for (const a of c.aliases || []) {
      if (!keys(a, ['merchant', 'key']) || typeof a.merchant !== 'string' || !a.merchant.trim() || a.merchant.length > 512
        || typeof a.key !== 'string' || !a.key.trim() || a.key.length > 255) fail('cal_configuration_invalid', 503);
    }
    names.add(c.payment_source_name); instances.add(c.instance_key); requests.add(c.request_key);
  }
  return configs;
}
function selectProfile(body, env = process.env) {
  return profiles(env).find(c => body?.payment_source_name === c.payment_source_name) || null;
}
function exactNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER / 100) fail('invalid_accounting_amount');
  try { return ingestion.money(String(value)).amount; } catch { fail('invalid_accounting_amount'); }
}
function billingEvidence(value) {
  if (!keys(value, ['version', 'billed', 'original', 'event']) || value.version !== 2) fail('cal_contract_invalid');
  const m = value.billed, e = value.event;
  if (!keys(m, ['amount', 'currency', 'scale']) || m.currency !== 'ILS') fail('cal_billed_ils_required');
  let amount; try { amount = ingestion.money(m.amount).amount; } catch { fail('invalid_accounting_amount'); }
  if (!Number.isInteger(m.scale) || m.scale < 0 || m.scale > 2 || m.scale !== (m.amount.split('.')[1] || '').length) fail('cal_contract_invalid');
  if (!keys(e, ['kind', 'basis', 'provider_type', 'installment']) || typeof e.provider_type !== 'string' || e.provider_type.length > 100 || /[\p{Cc}]/u.test(e.provider_type)) fail('cal_contract_invalid');
  if (e.kind === 'refund') fail('cal_refund_policy_required');
  if (e.basis === 'installment_part') fail('cal_installment_identity_required');
  if (e.kind !== 'purchase' || !e.provider_type.trim() || e.basis !== 'full_purchase' || e.installment !== undefined) fail('cal_event_semantics_required');
  const original = value.original;
  if (original !== null) {
    if (!keys(original, ['amount','currency','scale']) || !/^[A-Z]{3}$/.test(original.currency || '')
      || typeof original.amount !== 'string' || !/^\d{1,28}(?:\.\d{1,6})?$/.test(original.amount)
      || !/[1-9]/.test(original.amount) || !Number.isInteger(original.scale) || original.scale < 0 || original.scale > 6
      || original.scale !== (original.amount.split('.')[1] || '').length) fail('cal_original_evidence_invalid');
  }
  return { billed: { ...m, amount }, original };
}
function request(profile, body) {
  if (!keys(body, fields) || (body.dry_run !== undefined && typeof body.dry_run !== 'boolean')) fail('unsupported_field');
  const explicit = body.cal_contract !== undefined ? billingEvidence(body.cal_contract) : null;
  if (explicit && (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0)) fail('cal_contract_invalid');
  if (body.type !== 'expense' || (!explicit && (body.currency || 'ILS') !== 'ILS')) fail('cal_supported_ils_purchase_required');
  if (typeof body.external_id !== 'string' || !body.external_id.length || body.external_id.length > 255
    || body.external_id !== body.external_id.trim()) fail('cal_external_id_required');
  if (body.payment_source_name !== profile.payment_source_name
    || (body.payment_source_id !== undefined && String(body.payment_source_id) !== profile.payment_source_id)) fail('payment_source_conflict');
  if (typeof body.description !== 'string' || body.description.length > 200 || /[\p{Cc}]/u.test(body.description)) fail('invalid_merchant');
  if ((body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 2000))
    || (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.length > 32
      || body.tags.some(t => typeof t !== 'string' || !t.trim() || t.includes(',') || t.length > 100)))) fail('invalid_input');
  if (body.exchange_rate !== undefined) fail('cal_supported_ils_purchase_required');
  if (body.category_id !== undefined && (!Number.isSafeInteger(body.category_id) || body.category_id <= 0)) fail('invalid_category');
  if (!explicit && body.original_amount !== undefined && exactNumber(body.original_amount) !== exactNumber(body.amount)) fail('cal_unsupported_amount_basis');
  const observation = {
    idempotency_key: body.external_id, merchant: body.description, accounting_amount: explicit ? explicit.billed.amount : exactNumber(body.amount),
    currency: 'ILS', movement_type: 'expense', transaction_date: body.date, payment_source_id: profile.payment_source_id,
    source_metadata: explicit ? { channel: 'financial_data_bridge_v2', provider_status: body.cal_contract.event.provider_type } : { channel: 'financial_data_bridge_v1' },
    ...(body.charge_date !== undefined ? { charge_date: body.charge_date } : {}),
    ...(body.category_id !== undefined ? { category_id: String(body.category_id) } : {}),
    ...(explicit ? (explicit.original ? { original_amount: explicit.original.amount, original_currency: explicit.original.currency, original_scale: explicit.original.scale } : {})
      : (body.original_amount !== undefined ? { original_amount: exactNumber(body.original_amount), original_currency: 'ILS', original_scale: 2 } : {})),
  };
  try { ingestion.normalizeObservation(observation); if (!body.date) fail('invalid_date'); } catch (e) { fail(e.reason || e.calCode || 'invalid_input'); }
  // No source occurrence timestamp or common reference is present in this producer's payload.
  const source = {
    source_kind: 'cal', instance_key: `v1-cal:${profile.instance_key}`, is_active: true, actor: 'cal_v1_configuration',
    ...(profile.expected_revision ? { expected_revision: profile.expected_revision } : {}),
    configuration: { payment_source_ids: [profile.payment_source_id], card_mappings: [],
      aliases: (profile.aliases || []).map(a => ({ ...a, payment_source_id: profile.payment_source_id })),
      time_verified: false, verified_references: [] },
  };
  const { dry_run, ...evidence } = body;
  return { source, observation, evidence };
}
async function handleCal(db, profile, body) {
  const { source, observation, evidence } = request(profile, body);
  // Suggestions apply only on creation. Original producer payload is the immutable retry fingerprint.
  if (!observation.category_id) {
    const { data, error } = await db.from('categories').select('id,keywords,type,savings_role,is_active');
    if (error) fail('cal_unavailable', 503);
    const category = (data || []).find(c => c.is_active !== false && c.type === 'expense' && !c.savings_role
      && Array.isArray(c.keywords) && c.keywords.some(k => body.description.toLowerCase().includes(k.toLowerCase())));
    if (category) observation.category_id = String(category.id);
  }
  if (body.dry_run) return { status: 200, body: { dry_run: true, would_insert: null,
    would_ingest: observation, matching_deferred: true, duplicate: null,
    resolved: { payment_source_id: profile.payment_source_id, category_id: observation.category_id || null } } };
  let result;
  try { result = await ingestion.ingestCalV1(db, profile.request_key, source, observation, evidence); }
  catch { fail('cal_unavailable', 503); }
  if (result.legacy_existing) return { status: 409, body: { error: result.cancelled ? 'cancelled_record_exists' : 'already_exists', existing_id: Number(result.transaction_id) } };
  if (result.reason_code === 'cal_payload_changed') return { status: 422, body: { error: 'cal_payload_changed', review_required: true } };
  const safe = safeResult(result);
  // Bridge 3.0.3 considers *any* 409 containing "conflict" an accepted duplicate.
  // Reserve 409 exclusively for an exact replay of a linked legacy-compatible identity.
  if (safe.body.outcome === 'conflict') safe.status = 422;
  if (safe.body.outcome === 'already_observed' && safe.body.transaction_id) return {
    status: 409, body: { error: safe.body.disposition === 'cancelled' ? 'cancelled_record_exists' : 'already_exists',
      existing_id: Number(safe.body.transaction_id), reconciliation: safe.body } };
  if (safe.body.disposition === 'pending' && safe.body.outcome === 'already_observed') safe.status = 202;
  return { status: safe.status, body: { ...safe.body, success: safe.status < 300,
    id: safe.body.transaction_id ? Number(safe.body.transaction_id) : null,
    external_id: body.external_id, ...(result.created_at ? { created_at: result.created_at } : {}), financial_posted: safe.body.transaction_id !== null } };
}
module.exports = { profiles, selectProfile, request, handleCal, exactNumber };
