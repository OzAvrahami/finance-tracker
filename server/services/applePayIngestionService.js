const ingestion = require('./transactionIngestionService');
const { UUID, safeIdentity, keys, id, BOUND_CARD_REFERENCE } = require('../config/applePay');

const reject = (reason, status = 400) => { throw Object.assign(new Error(reason), { reason, status }); };
// Input is an explicit plain-text coercion result, never a raw Wallet object/file.
function normalizeWalletAmountText(value) {
  if (typeof value !== 'string' || value !== value.trim() || !/^\u20aa\d{1,28}\.\d{2}$/.test(value)) reject('invalid_wallet_amount_text', 422);
  try { return { amount: ingestion.money(value.slice(1)).amount, currency: 'ILS' }; }
  catch { reject('invalid_wallet_amount_text', 422); }
}
function preferredMerchant(merchant, name) {
  for (const value of [merchant, name]) {
    if (value != null && (typeof value !== 'string' || [...value].length > 512
        || /^attachment(?: \d+)?\.txt$/i.test(value.trim()))) reject('invalid_merchant');
  }
  const selected = typeof merchant === 'string' && merchant.trim() ? merchant : name;
  if (typeof selected !== 'string' || !ingestion.normalizeMerchant(selected)) reject('invalid_merchant');
  return selected;
}
function observationFromRequest(body, instanceKey, bound = false) {
  if (!keys(body, ['amount', 'currency', 'merchant', 'name', 'payment_method', 'transaction_date', 'occurred_at', 'idempotency_key', 'provider_reference'])) reject('unsupported_field');
  if (typeof body.idempotency_key !== 'string' || !UUID.test(body.idempotency_key)) reject('invalid_idempotency_key');
  if (bound ? Object.hasOwn(body, 'payment_method') : !safeIdentity(body.payment_method)) reject('invalid_payment_method');
  if (body.provider_reference != null && !safeIdentity(body.provider_reference)) reject('invalid_provider_reference');
  if (body.currency !== 'ILS') reject('accounting_amount_required', 422);
  if (typeof body.amount === 'string' && body.amount !== body.amount.trim()) reject('invalid_accounting_amount');
  const amount = typeof body.amount === 'string' && body.amount.startsWith('\u20aa')
    ? normalizeWalletAmountText(body.amount).amount : body.amount;
  const merchant = preferredMerchant(body.merchant, body.name);
  if (body.transaction_date == null && body.occurred_at == null) reject('purchase_date_required', 422);
  let observation;
  try {
    observation = ingestion.normalizeObservation({
      idempotency_key: body.idempotency_key,
      accounting_amount: amount, currency: body.currency, merchant,
      movement_type: 'expense', // This credential cannot submit income/refunds/domain commands.
      payment_evidence: { card_reference: bound ? BOUND_CARD_REFERENCE : body.payment_method },
      ...(body.transaction_date != null ? { transaction_date: body.transaction_date } : {}),
      ...(body.occurred_at != null ? { occurred_at: body.occurred_at } : {}),
      ...(body.provider_reference != null ? { provider_reference: {
        provider: 'apple_wallet', type: 'unverified', scope: instanceKey, value: body.provider_reference,
      } } : {}),
    });
    // No date from an unqualified local timestamp, and never from receipt/current time.
    if (body.transaction_date == null && !ingestion.timeEvidence(body.occurred_at).comparable) reject('purchase_date_required', 422);
  } catch (error) {
    if (error.status) throw error;
    if (error.code === 'APY_INPUT') reject(error.reason);
    throw error;
  }
  return observation;
}

// Source registration reuses the existing audited, idempotent configuration RPC.
// Never query/insert cash here. A failed setup isn't cached; capture retry stays safe.
function createAppleIngestion(db) {
  let cachedKey, sourcePromise;
  return async (config, body) => {
    const observation = observationFromRequest(body, config.command.instance_key, config.bound);
    const cacheKey = JSON.stringify(config);
    if (cacheKey !== cachedKey || !sourcePromise) {
      cachedKey = cacheKey;
      sourcePromise = ingestion.configureSource(db, config.requestKey, config.command).then(result => {
        if (!id(result?.source_id) || result.outcome === 'conflict') reject('apple_configuration_invalid', 503);
        return result.source_id;
      });
    }
    let sourceId;
    try { sourceId = await sourcePromise; }
    catch (error) { if (cachedKey === cacheKey) sourcePromise = null; throw error; }
    return ingestion.ingestObservation(db, sourceId, observation);
  };
}

const reasonCodes = new Set([
  'no_candidate', 'verified_reference', 'precision_time', 'unique_purchase_tuple',
  'candidate_overflow', 'competing_references', 'competing_candidates', 'idempotency_key_conflict',
  'cancelled_record_exists', 'protected_transaction', 'identity_edited', 'reference_conflict',
  'enrichment_conflict', 'payment_source_not_found', 'payment_source_ambiguous', 'payment_source_conflict',
  'source_unavailable', 'invalid_category', 'owner_link', 'owner_separate', 'owner_cancelled',
]);
function safeResult(result) {
  const statuses = { created: 201, reconciled: 200, already_observed: 200, ambiguous: 202, conflict: 409, rejected: 422 };
  if (!result || !Object.hasOwn(statuses, result.outcome)) throw new Error('invalid_ingestion_result');
  const safeId = value => id(value) ? value : null;
  return {
    status: result.reason_code === 'source_unavailable' ? 503 : statuses[result.outcome],
    body: {
      outcome: result.outcome,
      original_outcome: Object.hasOwn(statuses, result.original_outcome) ? result.original_outcome : null,
      observation_id: safeId(result.observation_id), transaction_id: safeId(result.transaction_id),
      disposition: ['created', 'attached', 'pending', 'cancelled'].includes(result.disposition) ? result.disposition : 'pending',
      review_required: result.review_required === true, replayed: result.replayed === true,
      reason_code: reasonCodes.has(result.reason_code) ? result.reason_code : 'ingestion_rejected',
      decision_revision: safeId(result.decision_revision),
    },
  };
}

module.exports = { observationFromRequest, createAppleIngestion, safeResult, normalizeWalletAmountText, preferredMerchant };
