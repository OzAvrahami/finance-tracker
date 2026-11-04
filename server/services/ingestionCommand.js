'use strict';

// A timeout does not prove rollback. Callers must retry the frozen identity and
// evidence, and must stop dispatching a batch after an unknown result.
async function boundedCommand(db, name, args, commandMs = 5000) {
  const abort = new AbortController();
  let timer;
  try {
    let query = db.rpc(name, args);
    if (query.abortSignal) query = query.abortSignal(abort.signal);
    const result = await Promise.race([Promise.resolve(query), new Promise(resolve => {
      timer = setTimeout(() => { abort.abort(); resolve({ error: true }); }, commandMs);
    })]);
    if (!result.error && result.data) return result.data;
    return { outcome: 'retryable_failure', accepted: false, financial_posted: null, retryable: true,
      reason_code: 'persistence_unavailable', commit_state:
        ['40P01', '40001', '55P03', '57014', '23514', '22023'].includes(result.error?.code) ? 'rolled_back' : 'unknown' };
  } catch {
    return { outcome: 'retryable_failure', accepted: false, financial_posted: null, retryable: true,
      reason_code: 'persistence_unavailable', commit_state: 'unknown' };
  } finally { clearTimeout(timer); }
}

module.exports = { boundedCommand };
