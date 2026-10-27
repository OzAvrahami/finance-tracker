const { randomBytes } = require('node:crypto');
const { toMinorUnits, fromMinorUnits, roundDivide } = require('../utils/transactionPricing');

// Ephemeral confirmation capabilities, not purchase history. Only new internal
// purchases issue them. Restart/expiry fails closed; manual Return remains available.
// This store and the mutation locks belong to the current single API process.
// Multiple API workers would require a shared store/lock before enabling this flow.
const createRepurchaseService = ({ now = Date.now, ttl = 15 * 60 * 1000, limit = 256 } = {}) => {
  const offers = new Map();
  const locks = new Map();
  const keyFor = (kind, id) => `${kind}:${kind === 'transaction' && /^\d+$/.test(String(id))
    ? BigInt(id).toString() : String(id).toLowerCase()}`;
  const stale = () => Object.assign(new Error('Repurchase confirmation expired or changed'), {
    status: 409, code: 'LEGO_REPURCHASE_STALE',
  });
  const canonical = (value) => JSON.stringify(value, (_, item) => (
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item
  ));
  const prune = () => {
    for (const [token, offer] of offers) if (offer.expires <= now()) offers.delete(token);
  };
  const withLocks = async (keys, work) => {
    const releases = [];
    try {
      for (const key of [...new Set(keys)].sort()) {
        const previous = locks.get(key) || Promise.resolve();
        let release;
        const current = new Promise((resolve) => { release = resolve; });
        locks.set(key, current);
        await previous;
        releases.push(() => { release(); if (locks.get(key) === current) locks.delete(key); });
      }
      return await work();
    } finally { releases.reverse().forEach((release) => release()); }
  };
  const invalidate = (kind, id) => {
    for (const offer of offers.values()) {
      if (kind === 'set' ? keyFor(kind, offer.set.id) === keyFor(kind, id)
        : [offer.transaction.id, offer.set.transaction_id].some((value) => value != null && keyFor(kind, value) === keyFor(kind, id))) {
        offer.revoked = true;
      }
    }
  };
  const readTransaction = async (db, id) => {
    const { data, error } = await db.from('transactions').select('*, transaction_items(*)').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data || data.movement_type !== 'expense' || data.voided_at || data.parent_transaction_id) throw stale();
    // The first exact set-number line keeps the existing one-record behavior.
    data.transaction_items = [...(data.transaction_items || [])].sort((a, b) => Number(a.id) - Number(b.id));
    return data;
  };
  const acquisition = (transaction, setNumber) => {
    const item = transaction.transaction_items.find((row) => String(row.set_number || '').trim() === setNumber);
    if (!item || !Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) < 1) throw stale();
    const quantity = BigInt(item.quantity);
    const receipt = toMinorUnits(item.final_price);
    const original = toMinorUnits(item.price_per_unit);
    const discount = toMinorUnits(item.allocated_global_discount);
    const type = item.acquisition_type || 'purchase';
    if (!['purchase', 'gift', 'gwp'].includes(type) || receipt < 0n || original < 0n || discount < 0n
      || discount > receipt * quantity || (type !== 'purchase' && (receipt !== 0n || discount !== 0n))) throw stale();
    return {
      status: 'New', transaction_id: transaction.id,
      purchase_price: fromMinorUnits(roundDivide(receipt * quantity - discount, quantity)),
      receipt_price: fromMinorUnits(receipt), original_price: fromMinorUnits(original),
      acquisition_type: type, purchase_date: transaction.transaction_date || null,
    };
  };
  const matchesPayload = (row, payload) => row && Object.entries(payload).every(([key, value]) => (
    key.endsWith('_price') ? Number(row[key]) === Number(value) : row[key] === value
  ));

  const issue = async (db, userId, transactionId, soldSets, startedAt = now()) => {
    if (!userId || !soldSets?.length || now() - startedAt >= ttl) return [];
    const transaction = await readTransaction(db, transactionId);
    const candidates = [];
    for (const set of soldSets) {
      // Do not offer to choose among legacy duplicates or the original purchase.
      if (String(set.transaction_id) === String(transactionId)
        || soldSets.filter((row) => row.set_number === set.set_number).length !== 1) continue;
      await withLocks([keyFor('set', set.id)], async () => {
        const { data: current, error } = await db.from('lego_sets').select('*').eq('id', set.id).maybeSingle();
        if (error) throw error;
        if (set.status !== 'Sold' || canonical(current) !== canonical(set)) return;
        // Responses from concurrent creates can finish out of order. A delayed
        // older transaction must not supersede the newer purchase's offer.
        if ([...offers.values()].some((offer) => offer.set.id === set.id
          && BigInt(offer.transaction.id) > BigInt(transactionId))) return;
        const payload = acquisition(transaction, set.set_number);
        prune();
        invalidate('set', set.id); // A newer purchase supersedes an older offer.
        while (offers.size >= limit) offers.delete(offers.keys().next().value);
        const token = randomBytes(32).toString('base64url');
        offers.set(token, { userId, transaction, set: { ...set }, expires: now() + ttl });
        candidates.push({ confirmation_token: token, set_number: set.set_number, name: set.name,
          purchase_price: payload.purchase_price, purchase_date: payload.purchase_date,
          acquisition_type: payload.acquisition_type });
      });
    }
    return candidates;
  };

  const confirm = async (db, userId, token) => {
    prune();
    const offer = offers.get(token);
    if (!userId || !offer || offer.revoked || offer.userId !== userId) throw stale();
    return withLocks([
      keyFor('set', offer.set.id), keyFor('transaction', offer.transaction.id),
      ...(offer.set.transaction_id == null ? [] : [keyFor('transaction', offer.set.transaction_id)]),
    ], async () => {
      if (offers.get(token) !== offer || offer.revoked || offer.expires <= now()) throw stale();
      if (offer.completed) return offer.completed; // Idempotent retry; never write again.
      const transaction = await readTransaction(db, offer.transaction.id);
      if (canonical(transaction) !== canonical(offer.transaction)) { offer.revoked = true; throw stale(); }
      const payload = acquisition(transaction, offer.set.set_number);
      const { data: current, error: readError } = await db.from('lego_sets').select('*').eq('id', offer.set.id).maybeSingle();
      if (readError) throw readError;
      // Recover an ambiguous network error after a committed update without rewriting.
      if (offer.attempted && matchesPayload(current, payload)) {
        offer.completed = current;
        return current;
      }
      if (canonical(current) !== canonical(offer.set) || current?.status !== 'Sold') {
        offer.revoked = true; throw stale();
      }
      let update = db.from('lego_sets').update(payload).eq('id', current.id);
      // Compare-and-set all persisted fields: concurrent changes must not be overwritten.
      for (const [key, value] of Object.entries(offer.set)) {
        if (key !== 'id') update = value == null ? update.is(key, null) : update.eq(key, value);
      }
      offer.attempted = true;
      const { data, error } = await update.select();
      if (error) throw error;
      if (!data?.length) { offer.revoked = true; throw stale(); }
      offer.completed = data[0];
      return offer.completed;
    });
  };

  const guardMutation = (kind, handler) => (req, res) => withLocks([keyFor(kind, req.params.id)], async () => {
    invalidate(kind, req.params.id);
    return handler(req, res);
  });
  return { issue, confirm, guardMutation };
};

module.exports = { createRepurchaseService, repurchases: createRepurchaseService() };
