const { z } = require('zod');
const supabase = require('../../config/supabase');
const { rejectUnsupported } = require('../../services/savingsTransactionService');

const schema = z.object({
  type: z.enum(['expense', 'income']),
  amount: z.number().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a valid date in YYYY-MM-DD format'),
  description: z.string().max(200).optional(),
  charge_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a valid date in YYYY-MM-DD format').optional(),
  category_id: z.number().int().positive().optional(),
  payment_source_id: z.number().int().positive().optional(),
  payment_source_name: z.string().max(100).optional(),
  currency: z.string().min(3).max(3).optional(),
  original_amount: z.number().positive().optional(),
  exchange_rate: z.number().positive().optional(),
  notes: z.string().optional(),
  tags: z.array(
    z.string()
      .trim()
      .min(1, 'Tags must not be empty')
      .refine(tag => !tag.includes(','), 'Tags must not contain commas'),
  ).optional(),
  external_id: z.string().max(255).optional(),
  dry_run: z.boolean().optional(),
});

async function createTransaction(req, res) {
  try { await rejectUnsupported(supabase, req.body, [req.body.category_id]); }
  catch (error) { return res.status(422).json({ error: error.code || 'SAVINGS_UNSUPPORTED_PATH', message: error.message }); }
  const parsed = schema.safeParse(req.body);

  if (!parsed.success) {
    const details = parsed.error.issues.map(e => ({
      path: e.path.join('.'),
      message: e.message,
    }));

    console.log(JSON.stringify({
      event: 'v1.transaction.validation_error',
      errors: details,
    }));

    return res.status(400).json({ error: 'validation_error', details });
  }

  const {
    type, amount, date, description, charge_date,
    category_id, payment_source_id, payment_source_name,
    currency, original_amount, exchange_rate,
    notes, tags, external_id, dry_run,
  } = parsed.data;

  const serializedTags = serializeTags(tags);

  let duplicateInfo = null;
  if (external_id) {
    const { data: existing } = await supabase
      .from('transactions')
      .select('id,voided_at')
      .eq('external_id', external_id)
      .maybeSingle();

    if (existing) {
      if (!dry_run) {
        console.log(JSON.stringify({
          event: 'v1.transaction.duplicate',
          has_external_id: true,
          existing_id: existing.id,
        }));
        return res.status(409).json({
          error: existing.voided_at ? 'cancelled_record_exists' : 'already_exists',
          message: existing.voided_at ? 'המזהה החיצוני שמור לתנועה שבוטלה; אין ליצור אותה מחדש עם אותו מזהה' : 'Transaction with this external_id already exists',
          id: existing.id,
        });
      }
      duplicateInfo = { exists: true, id: existing.id, ...(existing.voided_at ? { cancelled: true } : {}) };
    }
  }

  // Resolve category from keywords when no category_id is provided
  let resolvedCategoryId = category_id;
  let resolvedCategoryName = null;
  let resolvedCategoryMatchedKeyword = null;
  if (resolvedCategoryId === undefined && description) {
    const { data: categories } = await supabase
      .from('categories')
      .select('id, name, keywords, type, savings_role');
    if (categories) {
      const descLower = description.toLowerCase();
      const match = categories.find(cat =>
        !cat.savings_role && cat.type === type &&
        cat.keywords &&
        cat.keywords.some(k => descLower.includes(k.toLowerCase()))
      );
      if (match) {
        resolvedCategoryId = match.id;
        resolvedCategoryName = match.name;
        resolvedCategoryMatchedKeyword = match.keywords.find(k => descLower.includes(k.toLowerCase())) ?? null;
      }
    }
  }

  // Resolve payment source from name/last4 when no payment_source_id is provided
  let resolvedPaymentSourceId = payment_source_id;
  let resolvedSourceDetail = null;
  if (resolvedPaymentSourceId === undefined && payment_source_name) {
    const digits = payment_source_name.replace(/\D/g, '');
    const last4 = digits.length >= 4 ? digits.slice(-4) : null;

    let query = supabase.from('payment_sources').select('id, name, last4').eq('is_active', true);
    if (last4) {
      query = query.eq('last4', last4);
    } else {
      query = query.ilike('name', payment_source_name);
    }

    const { data: sources } = await query;
    if (!sources || sources.length === 0) {
      return res.status(400).json({
        error: 'payment_source_not_found',
        message: `No active payment source matches '${payment_source_name}'`,
      });
    }
    resolvedPaymentSourceId = sources[0].id;
    resolvedSourceDetail = { name: sources[0].name, last4: sources[0].last4 };
  }

  const row = {
    movement_type: type,
    total_amount: amount,
    transaction_date: date,
    charge_date: charge_date ?? date,
    currency: currency ?? 'ILS',
    ...(description !== undefined && { description }),
    ...(resolvedCategoryId !== undefined && { category_id: resolvedCategoryId }),
    ...(resolvedPaymentSourceId !== undefined && { payment_source_id: resolvedPaymentSourceId }),
    ...(original_amount !== undefined && { original_amount }),
    ...(exchange_rate !== undefined && { exchange_rate }),
    ...(notes !== undefined && { notes }),
    ...(serializedTags !== null && { tags: serializedTags }),
    ...(external_id !== undefined && { external_id }),
  };

  if (dry_run) {
    return res.status(200).json({
      dry_run: true,
      would_insert: row,
      resolved: {
        category_id: resolvedCategoryId ?? null,
        category_name: resolvedCategoryName,
        matched_keyword: resolvedCategoryMatchedKeyword,
        payment_source_id: resolvedPaymentSourceId ?? null,
        payment_source_detail: resolvedSourceDetail,
      },
      duplicate: duplicateInfo,
    });
  }

  const { data, error } = await supabase
    .from('transactions')
    .insert(row)
    .select('id, external_id, created_at')
    .single();

  if (error) {
    // Race condition: another request won the external_id unique constraint
    if (error.code === '23505') {
      if (external_id) {
        const { data: existing } = await supabase.from('transactions')
          .select('id, voided_at').eq('external_id', external_id).maybeSingle();
        if (existing?.voided_at) return res.status(409).json({
          error: 'cancelled_record_exists',
          message: 'מזהה המקור שייך לתנועה שבוטלה ונשמרה בהיסטוריה; אין לייבא אותה מחדש',
          existing_id: existing.id,
        });
      }
      console.log(JSON.stringify({
        event: 'v1.transaction.duplicate',
        has_external_id: Boolean(external_id),
      }));
      return res.status(409).json({
        error: 'already_exists',
        message: 'Transaction with this external_id already exists',
      });
    }

    // FK violation: category_id or payment_source_id doesn't exist
    if (error.code === '23503') {
      const field = error.detail?.includes('category_id') ? 'category_id'
        : error.detail?.includes('payment_source_id') ? 'payment_source_id'
        : 'unknown';
      return res.status(400).json({
        error: 'validation_error',
        details: [{ path: field, message: 'Referenced record does not exist' }],
      });
    }

    console.error('v1 createTransaction error:', error);
    return res.status(500).json({ error: 'server_error', message: 'Internal server error' });
  }

  console.log(JSON.stringify({
    event: 'v1.transaction.created',
    id: data.id,
    has_external_id: Boolean(data.external_id),
  }));
  return res.status(201).json({
    success: true,
    id: data.id,
    external_id: data.external_id ?? null,
    created_at: data.created_at,
  });
}

function serializeTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return null;
  return tags.join(',');
}

module.exports = { createTransaction, serializeTags };
