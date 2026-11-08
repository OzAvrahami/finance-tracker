'use strict';
const { sameId } = require('./policy');
const { protectedCash, capturedCash } = require('./reconciliation');
const { linkReason, separateReason } = require('./core');
async function read(db, mode, ids = [], id = null) {
  const { data, error } = await db.rpc('read_reconciliation', { p_mode: mode, p_ids: ids, p_id: id });
  if (error) throw new Error('reconciliation_unavailable');
  if (data == null || !['observation', 'transaction'].includes(mode)) return data;
  const scope = { command: { [mode === 'observation' ? 'observation_id' : 'transaction_id']: String(id) } };
  const snapshot = await db.rpc('ingestion_core_snapshot', { p_scope: scope });
  if (snapshot.error || !snapshot.data?.facts) throw new Error('reconciliation_unavailable');
  const facts = snapshot.data.facts;
  const protect = row => {
    const t = facts.transactions.find(t => sameId(t.id, row.id));
    return { ...row, protected: !t || protectedCash(t) || capturedCash(t) };
  };
  if (mode === 'transaction') return protect(data);
  const o = facts.observations.find(o => sameId(o.id, id));
  if (!o) return null;
  const limited = Object.keys(o.review_fingerprints).length > 100 || facts.overflow;
  return { ...data, observation: o.ui, candidate_fingerprints: o.review_fingerprints, review_limited: limited,
    can_separate: !limited && o.transaction_id == null && o.outcome === 'ambiguous' && !separateReason(facts, o),
    candidates: data.candidates.map(row => {
      const t = facts.transactions.find(t => sameId(t.id, row.id)), projected = protect(row);
      return { ...projected, can_link: Boolean(!limited && o.transaction_id == null && !linkReason(facts, o, t)) };
    }) };
}
module.exports = { read };
