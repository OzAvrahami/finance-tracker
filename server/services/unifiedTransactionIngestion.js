'use strict';
const { z } = require('zod');
const core = require('./ingestion/core');
const { randomUUID } = require('node:crypto');

const date = z.string().refine(v => /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, 'invalid_date');
// Keep public JSON numbers. Reject precision we cannot represent; never round it.
const money = z.number().positive().refine(v => /^\d+(?:\.\d{1,2})?$/.test(String(v))
  && v <= Number.MAX_SAFE_INTEGER / 100, 'invalid_accounting_amount');
const evidenceNumber = z.number().positive().refine(v => v <= Number.MAX_SAFE_INTEGER
  && /^\d+(?:\.\d+)?$/.test(String(v)), 'invalid_numeric_evidence');
const schema = z.object({
  type: z.enum(['expense', 'income', 'refund']), amount: money, date,
  charge_date: date.optional(), description: z.string().max(200).optional(),
  category_id: z.number().int().positive().safe().optional(),
  payment_source_id: z.number().int().positive().safe().optional(),
  payment_source_name: z.string().min(1).max(100).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  original_amount: evidenceNumber.optional(), exchange_rate: evidenceNumber.optional(),
  notes: z.string().optional(), tags: z.array(z.string().trim().min(1).refine(t => !t.includes(','))).optional(),
  external_id: z.string().min(1).max(255).refine(v => v === v.trim()).optional(),
  dry_run: z.boolean().optional(),
  installment_number: z.number().int().min(1).max(999).optional(),
  installment_count: z.number().int().min(2).max(999).optional(),
}).strict().superRefine((v, ctx) => {
  if ((v.installment_number === undefined) !== (v.installment_count === undefined)
    || (v.installment_number !== undefined && (v.installment_number > v.installment_count || v.type !== 'expense'))) {
    ctx.addIssue({ code: 'custom', path: ['installment_number'], message: 'invalid_installment' });
  }
});

async function submitExternal(db, body, options = {}) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: 'validation_error',
    details: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) } };
  const { dry_run = false, ...request } = parsed.data;
  const result = await core.external(db, request, dry_run, options);
  return externalResponse(result, request.external_id);
}

function externalResponse(result, externalId) {
  if (result.dry_run) return { status: 200, body: result };
  if (result.outcome === 'retryable_failure') return { status: 503, body: { error: result.reason_code, ...result } };
  if (result.disposition === 'cancelled') return { status: 409, body: { error: 'cancelled_record_exists', ...result } };
  if (result.outcome === 'rejected') return { status: 422, body: { error: result.reason_code, ...result } };
  if (result.outcome === 'conflict') return { status: 409, body: { error: result.reason_code, ...result } };
  if (!result.transaction_id) return { status: 202, body: { ...result, financial_posted: false, review_required: true } };
  if (result.replayed) return { status: 409, body: { error: 'already_exists', id: Number(result.transaction_id), ...result } };
  return { status: result.outcome === 'created' ? 201 : 200, body: {
    success: true, id: Number(result.transaction_id), external_id: externalId ?? null,
    ...result, financial_posted: true,
  } };
}

async function submitOwned(db, channel, row, { key = randomUUID(), evidence = row, domain = null } = {}) {
  const result = await core.owned(db, channel, row, key, evidence, domain);
  if (result.outcome === 'retryable_failure') throw Object.assign(new Error('Ingestion result is uncertain; check transaction history before retrying.'), { code: 'INGESTION_UNCERTAIN' });
  if (result.outcome === 'rejected') throw Object.assign(new Error(result.reason_code), { code: result.reason_code });
  return result;
}

async function updateOwnedRefund(db, id, row) {
  const transaction = require('./ingestion/manualRefund').manualRow(row);
  const result = await core.execute(db, { command_kind: 'owner_refund_edit',
    command: { transaction_id: String(id), transaction } });
  if (result.outcome === 'rejected') throw new Error(result.reason_code);
  if (result.outcome !== 'updated') throw new Error('לא ניתן לאשר שהעדכון נשמר. יש לרענן את התנועה לפני ניסיון נוסף.');
  return result.accounting;
}

module.exports = { schema, submitExternal, submitOwned, externalResponse, updateOwnedRefund };
