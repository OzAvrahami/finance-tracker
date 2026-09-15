const { toMinorUnits, fromMinorUnits } = require('../utils/money');
const { isValidDateString } = require('../utils/transactionQuery');

const date = (value) => {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !isValidDateString(value) || value.startsWith('0000-')) {
    throw Object.assign(new Error('יש להזין תאריך תקין בפורמט שנה-חודש-יום'), { code: '22023' });
  }
  return value;
};

const money = (value, label) => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(value)
      || toMinorUnits(value) > 999999999999999999n) {
    throw Object.assign(new Error(`${label}: יש להזין סכום מדויק בשקלים עם עד שתי ספרות אחרי הנקודה`), { code: '22023' });
  }
  return fromMinorUnits(toMinorUnits(value));
};
const identifier = (value) => {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) || BigInt(value) > 9223372036854775807n) {
    throw Object.assign(new Error('מזהה החשבון או הגרסה אינו תקין'), { code: '22023' });
  }
  return value;
};
const requestKey = (value) => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw Object.assign(new Error('חסר מזהה בקשה תקין; יש לרענן ולנסות שוב'), { code: '22023' });
  }
  return value;
};
const invoke = async (supabase, name, parameters) => {
  const { data, error } = await supabase.rpc(name, parameters);
  if (error) throw error;
  return data;
};

const listAccounts = async (supabase) => {
  const rows = [];
  // Cast BIGINT identifiers in PostgreSQL, before JSON/JavaScript decoding.
  for (let start = 0; ; start += 500) {
    const { data, error } = await supabase.from('savings_account_summary')
      .select('*,account_id::text,revision::text,plan_revision::text')
      .order('account_id').range(start, start + 499);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 500) return rows;
  }
};
const getAccount = (supabase, id, query = {}) => invoke(supabase, 'get_savings_account', {
  p_account_id: identifier(id), p_from: date(query.from), p_to: date(query.to),
  p_before_entry_id: query.before ? identifier(query.before) : null,
  p_limit: query.limit === undefined ? 50 : (/^\d{1,3}$/.test(String(query.limit)) ? Number(query.limit) : 0),
});
const createAccount = (supabase, body) => invoke(supabase, 'create_savings_account', {
  p_request_key: requestKey(body.request_key), p_account: body.account,
  p_opening_amount: money(body.opening_amount, 'יתרת פתיחה'),
  p_legacy_overlap_amount: money(body.legacy_overlap_amount, 'חפיפה לרזרבה'),
  p_overlap_reason: body.overlap_reason || null,
});
const updateAccount = (supabase, id, body) => invoke(supabase, 'update_savings_account', {
  p_account_id: identifier(id), p_expected_revision: identifier(body.expected_revision),
  p_request_key: requestKey(body.request_key), p_account: body.account,
});

const getReport = (supabase, query = {}) => {
  const from = date(query.from), to = date(query.to);
  if (!from || !to || from > to) throw Object.assign(new Error('יש לבחור טווח תאריכים תקין לדוח'), { code: '22023' });
  return invoke(supabase, 'get_savings_report', { p_from: from, p_to: to, p_account_id: query.accountId ? identifier(query.accountId) : null });
};
module.exports = { getReport, listAccounts, getAccount, createAccount, updateAccount, money, identifier, date };
