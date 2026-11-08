// Shared JavaScript business authority; source credentials stay in their routes.
const core = require('./ingestion/core');
const { identifier, normalizeObservation, normalizeMerchant, money, timeEvidence, fail } = require('./ingestion/normalization');
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
  try {
    const result = await core.observation(db, identifier(sourceId), normalizeObservation(input));
    if (result.outcome === 'retryable_failure') throw Object.assign(new Error('APY command failed'), {
      code: result.database_code, retryable: ['40P01', '40001', '55P03'].includes(result.database_code) });
    return result;
  }
  catch (error) { if (error.code === 'APY_INPUT') return rejected(error.reason); throw error; }
};
const command = (name) => (db, requestKey, payload) => {
  if (typeof requestKey !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(requestKey)) fail('invalid_request_key');
  if (name === 'configure_ingestion_source') return rpc(db, name, { p_request_key: requestKey, p_command: payload });
  return core.command(db, name === 'cancel_ingested_transaction' ? 'cancel' : name === 'amend_observation' ? 'amend' : 'resolve', requestKey, payload, name === 'review_reconciliation');
};
module.exports = { ingestObservation,
  readReconciliation: require('./ingestion/readers').read,
  reviewReconciliation: command('review_reconciliation'),
  ingestFlowlinkObservation: async (db, digest, request) => {
    const result = await core.flowlink(db, digest, request);
    if (result.outcome === 'retryable_failure') throw new Error('APY command failed');
    return result;
  }, amendObservation: command('amend_observation'),
  resolveObservation: command('resolve_observation'), cancelIngestedTransaction: command('cancel_ingested_transaction'),
  configureSource: command('configure_ingestion_source'),
  getObservation: (db, id) => rpc(db, 'get_ingestion_observation', { p_observation_id: identifier(id) }),
  normalizeObservation, normalizeMerchant, money, timeEvidence };
