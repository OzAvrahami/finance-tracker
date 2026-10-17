// Public evidence contract. No accounting dates, ownership IDs or reconciliation targets from callers.
const { z } = require('zod');
const ingestion = require('./transactionIngestionService');
const CONTRACT = 'finance.transactions.v1';
const LIMITS = Object.freeze({ bytes: 1024 * 1024, items: 50, itemBytes: 16384, durationMs: 20000, commandMs: 5000 });
const text = max => z.string().min(1).max(max).refine(v => v === v.trim() && !/[\p{Cc}]/u.test(v));
const key = text(255);
const date = z.string().refine(v => {
  try { ingestion.normalizeObservation({ idempotency_key: 'date', merchant: 'Test', accounting_amount: '1', currency: 'ILS', movement_type: 'expense', transaction_date: v }); return true; }
  catch { return false; }
}, 'invalid_date');
const currencies = new Set(Intl.supportedValuesOf('currency'));
const money = z.strictObject({ amount: z.string().regex(/^-?\d{1,28}(?:\.\d{1,6})?$/), currency: z.string(), scale: z.number().int().min(0).max(6) })
  .superRefine((v, ctx) => {
    if (!currencies.has(v.currency)) { ctx.addIssue({ code: 'custom', message: 'unsupported_currency' }); return; }
    const scale = new Intl.NumberFormat('en', { style: 'currency', currency: v.currency }).resolvedOptions().maximumFractionDigits;
    if (v.scale !== scale || (v.amount.split('.')[1] || '').length !== v.scale) ctx.addIssue({ code: 'custom', message: 'currency_scale_mismatch' });
  });
const reference = z.strictObject({ provider: key, type: key, scope: key, value: key });
const itemSchema = z.strictObject({
  client_id: text(100), key,
  identity_basis: z.enum(['provider', 'durable_delivery', 'unresolved']),
  legacy_external_id: key.optional(),
  merchant: text(200),
  event: z.strictObject({ kind: z.enum(['expense', 'income', 'refund', 'unknown']), status: z.enum(['pending', 'completed', 'unknown']),
    basis: z.enum(['single', 'installment', 'whole_purchase', 'unknown']),
    purchase_key: key.nullable(), installment: z.strictObject({ current: z.number().int().min(0).max(999).nullable(), total: z.number().int().min(0).max(999).nullable() }).nullable(),
    provider_type: z.union([text(100), z.number().safe()]).optional() }),
  dates: z.strictObject({ purchase: date.nullable(), mapped: date.nullable(), billing: date.nullable(),
    occurred_at: z.string().refine(v => { try { ingestion.timeEvidence(v); return true; } catch { return false; } }).nullable().optional(),
    timezone: text(100).refine(v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }).nullable().optional() }),
  charged: money.nullable(), original: money.nullable(),
  provider_reference: reference.optional(), related_provider_reference: reference.optional(),
  hints: z.strictObject({ last4: z.string().regex(/^\d{4}$/).optional(), name: text(100).optional() }).optional(),
});
function validateItem(input) {
  if (Buffer.byteLength(JSON.stringify(input) || '') > LIMITS.itemBytes) return { reason: 'item_too_large' };
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return { reason: 'invalid_evidence', fields: [...new Set(parsed.error.issues.map(i => i.path.join('.')))].slice(0, 20) };
  const item = parsed.data;
  const { occurred_at, timezone } = item.dates;
  if (occurred_at && timezone && ingestion.timeEvidence(occurred_at).comparable) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(occurred_at));
    const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
    if (`${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}` !== occurred_at.slice(0, 16)) return { reason: 'contradictory_timezone' };
  }
  const e = item.event, counters = e.installment;
  if (e.basis === 'single' && counters && (counters.current !== 0 || counters.total !== 0)) return { reason: 'contradictory_installments' };
  if (counters && counters.current !== null && counters.total !== null && counters.current > counters.total) return { reason: 'contradictory_installments' };
  for (const value of [item.charged, item.original]) {
    if (!value) continue;
    const minor = BigInt(value.amount.replace('.', ''));
    if ((['expense', 'income'].includes(e.kind) && minor < 0n) || (e.kind === 'refund' && minor > 0n)) return { reason: 'contradictory_money_direction' };
  }
  return { item };
}
function envelope(body, rawBytes) {
  if ((rawBytes ?? Buffer.byteLength(JSON.stringify(body) || '')) > LIMITS.bytes) return { status: 413, error: 'request_too_large' };
  if (!body || Array.isArray(body) || body.contract !== CONTRACT || typeof body.account !== 'string' || !key.safeParse(body.account).success
    || Object.keys(body).some(k => !['contract', 'account', 'item', 'items'].includes(k))
    || Object.hasOwn(body, 'item') === Object.hasOwn(body, 'items')) return { status: 400, error: 'invalid_envelope' };
  const items = Object.hasOwn(body, 'item') ? [body.item] : body.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > LIMITS.items) return { status: 400, error: 'invalid_item_count' };
  return { items, account: body.account };
}
module.exports = { CONTRACT, LIMITS, itemSchema, validateItem, envelope };
