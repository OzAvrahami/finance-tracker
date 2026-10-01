// APY foundation only: no source-facing route or credential is mounted here.
const fail = (reason) => { throw Object.assign(new Error(reason), { code: 'APY_INPUT', reason }); };
const identifier = value => {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) fail('invalid_identifier');
  return value;
};
const money = value => {
  if (typeof value !== 'string' || !/^\d{1,28}(?:\.\d{1,2})?$/.test(value)) fail('invalid_accounting_amount');
  const [whole, fraction = ''] = value.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor <= 0n) fail('invalid_accounting_amount');
  return { amount: `${minor / 100n}.${String(minor % 100n).padStart(2, '0')}`, minor: String(minor) };
};
const normalizeMerchant = value => {
  if (typeof value !== 'string' || !value.length || [...value].length > 512) fail('invalid_merchant');
  return value.normalize('NFKC').replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/./gsu, character => character.toLowerCase()).replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();
};
const date = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1
      || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('invalid_date');
  return value;
};
const timeEvidence = value => {
  if (value == null) return { raw: null, precision: null, comparable: false };
  if (typeof value !== 'string' || value.length > 80) fail('invalid_occurred_at');
  const m = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,6}))?)?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)?$/.exec(value);
  if (!m) fail('invalid_occurred_at');
  date(m[1]);
  if (m[6] && /[+-]14:(?!00)/.test(m[6])) fail('invalid_occurred_at');
  return { raw: value, precision: m[5] ? `fractional_${m[5].length}` : m[4] ? 'second' : 'minute', comparable: Boolean(m[6]) };
};
const keys = ['idempotency_key', 'provider_reference', 'merchant', 'accounting_amount', 'currency', 'movement_type',
  'transaction_date', 'occurred_at', 'charge_date', 'payment_source_id', 'payment_evidence', 'category_id',
  'source_metadata', 'original_amount', 'original_currency', 'original_scale'];
const normalizeObservation = input => {
  if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).some(k => !keys.includes(k))) fail('unsupported_field');
  if (typeof input.idempotency_key !== 'string' || !input.idempotency_key.length || input.idempotency_key.length > 255
      || input.idempotency_key !== input.idempotency_key.trim()) fail('invalid_idempotency_key');
  const output = { ...input, accounting_amount: money(input.accounting_amount).amount };
  if (input.currency !== 'ILS') fail('accounting_amount_required');
  if (!['expense', 'income'].includes(input.movement_type)) fail('unsupported_event_kind');
  if (!normalizeMerchant(input.merchant)) fail('invalid_merchant');
  if (input.transaction_date != null) date(input.transaction_date);
  if (input.charge_date != null) date(input.charge_date);
  timeEvidence(input.occurred_at);
  for (const k of ['payment_source_id', 'category_id']) if (input[k] != null) identifier(input[k]);
  return output; // PostgreSQL independently validates all nested evidence and recomputes normalization/hash.
};
const rejected = reason => ({ outcome: 'rejected', original_outcome: null, observation_id: null, transaction_id: null,
  disposition: 'pending', review_required: false, reason_code: reason, replayed: false, decision_revision: null });
const rpc = async (db, name, args) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await db.rpc(name, args);
    if (!error) return data;
    if (['40P01', '40001', '55P03'].includes(error.code) && attempt === 0) continue;
    // Do not propagate database detail/input to a future source credential or logger.
    throw Object.assign(new Error('APY command failed'), { code: error.code, retryable: ['40P01', '40001', '55P03'].includes(error.code) });
  }
};
const ingestObservation = async (db, sourceId, input) => {
  try { return await rpc(db, 'ingest_observation', { p_source_id: identifier(sourceId), p_observation: normalizeObservation(input) }); }
  catch (error) { if (error.code === 'APY_INPUT') return rejected(error.reason); throw error; }
};
const command = (name) => (db, requestKey, payload) => {
  if (typeof requestKey !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(requestKey)) fail('invalid_request_key');
  return rpc(db, name, { p_request_key: requestKey, p_command: payload });
};
// Preserve the exact legacy Supabase result/error shape. Migration 036's trigger
// mirrors nonempty external IDs in the SAME INSERT transaction, including callers
// outside this wrapper. Dry-run never calls this adapter; no source matching occurs.
const insertLegacyTransaction = (db, row) => db.from('transactions').insert(row).select('id, external_id, created_at').single();
module.exports = { ingestObservation,
  readReconciliation: (db, mode, ids = [], id = null) => rpc(db, 'read_reconciliation', { p_mode: mode, p_ids: ids, p_id: id }),
  reviewReconciliation: command('review_reconciliation'),
  ingestCalV1: (db, key, source, observation, request) => rpc(db, 'ingest_cal_v1', { p_request_key: key, p_source: source, p_observation: observation, p_request: request }),
  ingestFlowlinkObservation: (db, digest, request) => rpc(db, 'ingest_flowlink_observation', { p_credential_sha256: digest, p_request: request }), amendObservation: command('amend_observation'),
  resolveObservation: command('resolve_observation'), cancelIngestedTransaction: command('cancel_ingested_transaction'),
  configureSource: command('configure_ingestion_source'), insertLegacyTransaction,
  getObservation: (db, id) => rpc(db, 'get_ingestion_observation', { p_observation_id: identifier(id) }),
  normalizeObservation, normalizeMerchant, money, timeEvidence };
