const { CONTRACT, LIMITS, validateItem, envelope } = require('./generalTransactionContract');
const failure = (reason, commitState = 'not_attempted') => ({ outcome: 'retryable_failure', accepted: false,
  financial_posted: null, review_required: false, retryable: true, reason_code: reason, commit_state: commitState });
async function processItem(db, account, raw, commandMs = LIMITS.commandMs) {
  const parsed = validateItem(raw);
  if (!parsed.item) return { outcome: 'rejected', accepted: false, financial_posted: false, review_required: false,
    retryable: false, reason_code: parsed.reason, ...(parsed.fields ? { fields: parsed.fields } : {}) };
  const { client_id, ...evidence } = parsed.item;
  return boundedCommand(db,'ingest_general_transaction',{p_account:account,p_item:evidence},commandMs);
}
async function boundedCommand(db,name,args,commandMs=LIMITS.commandMs) {
  const abort = new AbortController();
  let timer;
  try {
    let query = db.rpc(name,args);
    if (query.abortSignal) query = query.abortSignal(abort.signal);
    const result = await Promise.race([Promise.resolve(query), new Promise(resolve => {
      timer = setTimeout(() => { abort.abort(); resolve({ error: true }); }, commandMs);
    })]);
    if (result.error || !result.data) return failure('persistence_unavailable',
      ['40P01', '40001', '55P03', '57014', '23514', '22023'].includes(result.error?.code) ? 'rolled_back' : 'unknown');
    return result.data;
  } catch { return failure('persistence_unavailable', 'unknown'); }
  finally { clearTimeout(timer); }
}
async function processSubmission(db, body, options = {}) {
  const parsed = envelope(body, options.rawBytes);
  if (parsed.error) return { status: parsed.status, body: { error: parsed.error } };
  const now = options.now || Date.now, deadline = now() + (options.durationMs ?? LIMITS.durationMs);
  const results = [];
  // APY's table-first lock serializes financial writes. Sequential items avoid lock storms.
  for (const [index, item] of parsed.items.entries()) {
    const remaining = deadline - now();
    const result = remaining <= 0 ? failure('batch_deadline')
      : await processItem(db, parsed.account, item, Math.min(remaining, options.commandMs ?? LIMITS.commandMs));
    results.push({ index, client_id: typeof item?.client_id === 'string' && item.client_id.length <= 100 ? item.client_id : null,
      key: typeof item?.key === 'string' && item.key.length <= 255 ? item.key : null, ...result });
    // A timed-out command may still hold the DB lock; don't launch more work in this batch.
    if (result.commit_state === 'unknown') {
      for (let i = index + 1; i < parsed.items.length; i++) results.push({ index: i,
        client_id: typeof parsed.items[i]?.client_id === 'string' && parsed.items[i].client_id.length <= 100 ? parsed.items[i].client_id : null,
        key: typeof parsed.items[i]?.key === 'string' && parsed.items[i].key.length <= 255 ? parsed.items[i].key : null, ...failure('batch_interrupted') });
      break;
    }
  }
  return { status: 200, body: { contract: CONTRACT, results } };
}
module.exports = { processSubmission, processItem, boundedCommand };
