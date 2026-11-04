const supabase = require('../../config/supabase');
const { rejectUnsupported } = require('../../services/savingsTransactionService');
const { submitExternal } = require('../../services/unifiedTransactionIngestion');
const bulk = require('../../services/externalTransactionBulk');

async function createTransaction(req, res) {
  if (req.body && Object.hasOwn(req.body, 'items')) return bulk.runBulk(req, res, createTransaction);
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'invalid_envelope' });
  // The registered-account and retired-producer envelopes are not alternate writers.
  if (Object.hasOwn(req.body, 'contract') || Object.hasOwn(req.body, 'cal_contract')) {
    return res.status(422).json({ error: 'retired_ingestion_contract' });
  }
  try {
    await rejectUnsupported(supabase, req.body, [req.body.category_id]);
    const result = await submitExternal(supabase, req.body);
    return res.status(result.status).json(result.body);
  } catch (error) {
    if (error.savingsCode || error.code === 'SAVINGS_UNSUPPORTED_PATH') return res.status(422).json({ error: error.savingsCode || error.code });
    return res.status(503).json({ error: 'ingestion_unavailable', commit_state: 'unknown', retryable: true });
  }
}
const serializeTags = tags => Array.isArray(tags) && tags.length ? tags.join(',') : null;
module.exports = { createTransaction, serializeTags };
