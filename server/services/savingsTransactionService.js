const { money, identifier } = require('./savingsService');
const fail = (message, code = 'SAVINGS_LINK_CONFLICT') => { throw Object.assign(new Error(message), { code }); };
const requestKey = (value) => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) fail('חסר מזהה בקשה; יש לרענן ולנסות שוב');
  return value;
};
const rpc = async (db, name, args) => {
  const { data, error } = await db.rpc(name, args);
  if (error) throw Object.assign(error, { savingsCode: /^SAVINGS_[A-Z_]+$/.test(error.details || '') ? error.details : undefined,
    message: /[\u0590-\u05ff]/.test(error.message || '') ? error.message : 'פעולת החיסכון נדחתה. בדקו סכום מדויק, תאריכים, חשבון ומקור פעילים ורעננו לפני ניסיון נוסף.' });
  return data;
};
const readCash = async (db, id) => {
  const rows = await rpc(db, 'transactions_filtered', { p_transaction_id: Number(identifier(String(id))) });
  if (!rows?.[0]?.row_json) fail('התנועה לא נמצאה', 'P0002');
  return rows[0].row_json;
};
const assertSimple = (body) => {
  const t = body.transaction || {};
  if ((body.items?.length || 0) > 0 || body.loan_handling || t.loan_id || t.parent_transaction_id
      || Number(t.installment_count || 1) > 1 || t.installments_info || t.installment_number
      || Number(t.global_discount || 0) !== 0 || (t.currency && t.currency !== 'ILS')
      || t.original_amount || t.exchange_rate || t.voided_at || t.void_request_key || t.void_reason || t.void_fingerprint) {
    fail('תנועת חיסכון חייבת להיות סכום ישיר בשקלים ללא פריטים, הנחות, תשלומים או הלוואה');
  }
};
const cashPayload = (t) => ({
  amount: money(t.total_amount, 'סכום התנועה'), effective_date: t.transaction_date,
  charge_date: t.charge_date, description: t.description, notes: t.notes || null,
  category_id: identifier(String(t.category_id)), payment_source_id: identifier(String(t.payment_source_id)),
});
const rejectUnsupported = async (db, body, categoryIds = []) => {
  if (Object.keys(body || {}).some(k => k.startsWith('savings_'))) fail('ייבאו כתנועה רגילה ואז קשרו אותה במפורש לחשבון חיסכון', 'SAVINGS_UNSUPPORTED_PATH');
  const ids = [...new Set(categoryIds.filter(Boolean).map(String))];
  if (!ids.length) return;
  const { data, error } = await db.from('categories').select('id,savings_role').in('id', ids);
  if (error) throw error;
  if (data?.some(c => c.savings_role)) fail('בנתיב זה אין רישום חיסכון. בחרו קטגוריה רגילה וקשרו את התנועה בטופס התנועות', 'SAVINGS_UNSUPPORTED_PATH');
};

// Called before pricing/Number coercion, Loan dispatch or item/keyword writes.
const saveCash = async (db, body, id = null) => {
  const h = body.savings_handling;
  if (!h) {
    if (Object.keys(body || {}).some(k => k.startsWith('savings_')) || Object.keys(body.transaction || {}).some(k => k.startsWith('savings_'))) fail('פעולת חיסכון מחייבת בחירה מפורשת בטופס התנועה');
    return null; // Bare role/history writes still fail at DB commit.
  }
  if (Object.keys(h).some(k => !['request_key','mode','account_id','event_kind','expected_revision','expected_destination_revision','entry_id','expected_transaction_fingerprint','reason','cutoff_confirmed','was_voided'].includes(k))) fail('שדה טיפול בחיסכון אינו נתמך');
  assertSimple(body);
  const t = body.transaction;
  const { data: category, error } = await db.from('categories').select('id,savings_role,type').eq('id', t.category_id).single();
  if (error) throw error;
  if (h.mode === 'edit_detached') {
    const cash = await readCash(db, id);
    if (!cash.savings || cash.savings.active || cash.voided_at || category.savings_role
      || cash.transaction_fingerprint !== h.expected_transaction_fingerprint) fail('התנועה אינה מנותקת וחיה או השתנתה; יש לרענן');
    const fields = cashPayload(t);
    return rpc(db, 'update_transaction_with_manual_loan_payment', { p_transaction_id: Number(id), p_loan_payment: null,
      p_transaction: { description: fields.description, total_amount: fields.amount, transaction_date: fields.effective_date,
        charge_date: fields.charge_date, category_id: fields.category_id, payment_source_id: fields.payment_source_id,
        notes: fields.notes, movement_type: t.movement_type, currency: 'ILS', loan_id: null, global_discount: '0.00' } });
  }
  const kind = category?.savings_role || h.event_kind;
  if (!['deposit', 'withdrawal', 'interest_payout'].includes(kind) || t.movement_type !== (kind === 'deposit' ? 'expense' : 'income')) fail('בחרו קטגוריה התואמת להפקדה, למשיכה או לריבית ששולמה לעו״ש');
  const payload = { ...cashPayload(t), account_id: identifier(h.account_id), event_kind: kind,
    cutoff_confirmed: h.cutoff_confirmed === true };
  const key = requestKey(h.request_key);
  let result;
  if (id) {
    payload.transaction_id = String(id);
    payload.expected_transaction_fingerprint = h.expected_transaction_fingerprint;
  }
  if (h.mode === 'create') {
    if (id) fail('תנועה קיימת חייבת קישור מפורש');
    result = await rpc(db, 'post_savings_event', { p_request_key: key, p_command: { ...payload, action: 'create_cash', expected_revision: identifier(h.expected_revision) } });
  } else if (h.mode === 'link') {
    if (!id) fail('חסרה תנועה קיימת לקישור');
    result = await rpc(db, 'post_savings_event', { p_request_key: key, p_command: { ...payload, action: 'link_cash', expected_revision: identifier(h.expected_revision) } });
  } else if (['correct', 'detach', 'reinstate'].includes(h.mode)) {
    if (!id) fail('חסרה תנועה לתיקון');
    result = await rpc(db, 'correct_savings_event', { p_request_key: key, p_entry_id: identifier(h.entry_id), p_expected_revision: identifier(h.expected_revision), p_reason: h.reason,
      p_replacement: { ...payload, action: h.mode === 'detach' ? 'detach' : h.mode === 'reinstate' && !h.was_voided ? 'link_cash' : 'create_cash', reinstate: h.mode === 'reinstate',
        ...(h.expected_destination_revision ? { expected_destination_revision: identifier(h.expected_destination_revision) } : {}) } });
  } else fail('יש לבחור פעולה מפורשת בחיסכון');
  return { ...result, id: result.transaction_id || String(id || ''), message: 'התנועה והחיסכון נשמרו יחד' };
};
const cancelCash = async (db, id, h) => {
  if (!h) fail('ביטול תנועת חיסכון דורש אישור וסיבה מפורשים');
  const cash = await readCash(db, id);
  if (h.entry_id && cash.savings?.entry_id !== h.entry_id) fail('הקישור השתנה; יש לרענן לפני הביטול');
  if (h.entry_id) return rpc(db, 'cancel_savings_event', { p_request_key: requestKey(h.request_key), p_entry_id: identifier(h.entry_id), p_expected_revision: identifier(h.expected_revision), p_cash_action: 'void', p_reason: h.reason });
  return rpc(db, 'void_detached_savings_transaction', { p_request_key: requestKey(h.request_key), p_transaction_id: Number(identifier(String(id))), p_expected_transaction_fingerprint: h.expected_transaction_fingerprint, p_reason: h.reason });
};
module.exports = { saveCash, cancelCash, readCash, rejectUnsupported, assertSimple, rpc };
