'use strict';

const { toMinorUnits, fromMinorUnits } = require('../../utils/money');
const merchantRepertoire = require('./merchantUnicode16');
const fail = reason => { throw Object.assign(new Error(reason), { code: 'APY_INPUT', reason }); };
const object = (value, allowed) => {
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).some(key => !allowed.includes(key))) fail('unsupported_field');
};
const identifier = value => {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) fail('invalid_identifier');
  return value;
};
const date = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('invalid_date');
  return value;
};
const money = value => {
  if (typeof value !== 'string' || !/^\d{1,28}(?:\.\d{1,2})?$/.test(value) || toMinorUnits(value) <= 0n) fail('invalid_accounting_amount');
  return { amount: fromMinorUnits(toMinorUnits(value)), minor: String(toMinorUnits(value)) };
};
// PostgreSQL NUMERIC can retain redundant scale (150.0000000000000000).
// Strip only trailing fractional zeroes, never round historical precision.
// Sub-cent historical cash is not equal to a two-decimal observation.
const storedMinor = value => {
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!m) return null;
  const fraction = (m[3] || '').replace(/0+$/, '');
  if (fraction.length > 2) return null;
  return toMinorUnits(`${m[1]}${m[2]}${fraction ? `.${fraction}` : ''}`);
};
const normalizeMerchant = value => {
  if (typeof value !== 'string' || !value.length || [...value].length > 512) fail('invalid_merchant');
  // New ICU releases assign previously opaque code points (including new case
  // mappings, symbols and compatibility letters). Preserve the historical APY
  // repertoire instead of changing stored matching evidence with the runtime.
  return value.replace(merchantRepertoire, run => run.normalize('NFKC'))
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(merchantRepertoire, run => run.replace(/./gsu, character => character.toLowerCase())
      .replace(/[\p{P}\p{S}\s]+/gu, ' ')).replace(/^ +| +$/g, '');
};
const timeEvidence = value => {
  if (value == null) return { raw: null, precision: null, comparable: false };
  if (typeof value !== 'string' || value.length > 80) fail('invalid_occurred_at');
  const m = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,6}))?)?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)?$/.exec(value);
  if (!m || (m[6] && /[+-]14:(?!00)/.test(m[6]))) fail('invalid_occurred_at');
  date(m[1]);
  return { raw: value, precision: m[5] ? `fractional_${m[5].length}` : m[4] ? 'second' : 'minute', comparable: Boolean(m[6]) };
};
// BigInt microseconds preserve sub-millisecond evidence; Date is used only for
// whole-second timezone conversion, never for money or precision comparison.
const instantMicros = raw => {
  const m = /^(.*T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(raw);
  if (!m) return null;
  return BigInt(Date.parse(`${m[1]}:${m[2] || '00'}${m[4]}`)) * 1000n + BigInt((m[3] || '').padEnd(6, '0'));
};
const jerusalemDate = raw => {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(raw));
  const field = key => parts.find(p => p.type === key).value;
  return `${field('year')}-${field('month')}-${field('day')}`;
};
const observationKeys = ['idempotency_key', 'provider_reference', 'merchant', 'accounting_amount', 'currency', 'movement_type',
  'transaction_date', 'occurred_at', 'charge_date', 'payment_source_id', 'payment_evidence', 'category_id',
  'source_metadata', 'original_amount', 'original_currency', 'original_scale'];
function normalize(input, { refund = false } = {}) {
  object(input, observationKeys);
  const key = input.idempotency_key;
  if (typeof key !== 'string' || !key.length || key.length > 255 || key !== key.trim()) fail('invalid_idempotency_key');
  if (typeof input.accounting_amount !== 'string' || !/^-?\d{1,28}(?:\.\d{1,2})?$/.test(input.accounting_amount)) fail('invalid_accounting_amount');
  const amount = toMinorUnits(input.accounting_amount);
  const marked = input.source_metadata?.bank_movement === 'refund';
  if (!amount || (amount < 0n && !(refund && marked && input.movement_type === 'expense')) || (amount > 0n && marked)) fail('invalid_accounting_amount');
  if (input.currency !== 'ILS') fail('accounting_amount_required');
  if (!['expense', 'income'].includes(input.movement_type)) fail('unsupported_event_kind');
  const merchant = normalizeMerchant(input.merchant);
  if (!merchant) fail('invalid_merchant');
  for (const key of ['payment_source_id', 'category_id']) if (input[key] != null) identifier(input[key]);
  if (input.provider_reference != null) {
    object(input.provider_reference, ['provider', 'type', 'scope', 'value']);
    for (const key of ['provider', 'type', 'scope', 'value']) {
      const value = input.provider_reference[key];
      if (typeof value !== 'string' || !value.length || value.length > 255) fail('invalid_provider_reference');
    }
  }
  const payment = input.payment_evidence ?? {}, metadata = input.source_metadata ?? {};
  object(payment, ['card_reference', 'last4', 'issuer', 'method', 'owner', 'name']);
  for (const [key, value] of Object.entries(payment)) {
    if (typeof value !== 'string' || !value.length || value.length > 255 || (key === 'last4' && !/^\d{4}$/.test(value))) fail('invalid_payment_evidence');
  }
  object(metadata, ['provider_status', 'channel', 'terminal_reference', 'bank_movement']);
  for (const value of Object.values(metadata)) if (typeof value !== 'string' || value.length > 255) fail('invalid_metadata');
  const time = timeEvidence(input.occurred_at);
  const day = input.transaction_date != null ? date(input.transaction_date) : time.comparable ? jerusalemDate(time.raw) : null;
  if (!day) fail('transaction_date_required');
  if (input.charge_date != null) date(input.charge_date);
  if (input.original_amount != null) {
    if (typeof input.original_amount !== 'string' || !/^\d{1,28}(?:\.\d{1,6})?$/.test(input.original_amount)
      || !/[1-9]/.test(input.original_amount) || !/^[A-Z]{3}$/.test(input.original_currency || '')
      || !/^[0-6]$/.test(String(input.original_scale)) || (input.original_amount.split('.')[1] || '').length > Number(input.original_scale)) fail('invalid_original_amount');
  } else if (input.original_currency != null || input.original_scale != null) fail('invalid_original_amount');
  // Exact old jsonb canonical projection, including null keys. Hash in PostgreSQL.
  const p = Object.fromEntries(observationKeys.map(key => [key, input[key] ?? null]));
  p.accounting_amount = fromMinorUnits(amount); p.payment_evidence = payment; p.source_metadata = metadata;
  if (p.original_scale != null) p.original_scale = String(p.original_scale);
  const digits = time.precision?.startsWith('fractional_') ? Number(time.precision.slice(11)) : null;
  return { input: p, merchant, amount_minor: String(amount), date: day,
    instant: time.comparable ? time.raw : null, precision: time.precision,
    width: digits ? `0.${'0'.repeat(digits - 1)}1 seconds` : time.precision === 'second' ? '1 second' : time.precision ? '1 minute' : null,
    width_micros: digits ? String(10n ** BigInt(6 - digits)) : time.precision === 'second' ? '1000000' : time.precision ? '60000000' : null,
    date_discrepancy: time.comparable && jerusalemDate(time.raw) !== day };
}
const normalizeObservation = input => {
  normalize(input);
  return { ...input, accounting_amount: money(input.accounting_amount).amount };
};
module.exports = { fail, object, identifier, date, money, storedMinor, normalizeMerchant, timeEvidence, instantMicros, normalize, normalizeObservation };
