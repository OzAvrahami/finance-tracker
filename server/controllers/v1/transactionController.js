const { z } = require('zod');
const supabase = require('../../config/supabase');

const schema = z.object({
  type: z.enum(['expense', 'income']),
  amount: z.number().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a valid date in YYYY-MM-DD format'),
  description: z.string().max(200).optional(),
  charge_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a valid date in YYYY-MM-DD format').optional(),
  category_id: z.number().int().positive().optional(),
  payment_source_id: z.number().int().positive().optional(),
  currency: z.string().min(3).max(3).optional(),
  notes: z.string().optional(),
  tags: z.string().optional(),
  external_id: z.string().max(255).optional(),
});

async function createTransaction(req, res) {
  const parsed = schema.safeParse(req.body);

  if (!parsed.success) {
    const details = parsed.error.errors.map(e => ({ path: e.path.join('.'), message: e.message }));
    console.log(JSON.stringify({ event: 'v1.transaction.validation_error', errors: details }));
    return res.status(400).json({ error: 'validation_error', details });
  }

  const {
    type, amount, date, description, charge_date,
    category_id, payment_source_id, currency, notes, tags, external_id,
  } = parsed.data;

  if (external_id) {
    const { data: existing } = await supabase
      .from('transactions')
      .select('id')
      .eq('external_id', external_id)
      .maybeSingle();

    if (existing) {
      console.log(JSON.stringify({ event: 'v1.transaction.duplicate', external_id, existing_id: existing.id }));
      return res.status(409).json({
        error: 'already_exists',
        message: 'Transaction with this external_id already exists',
        id: existing.id,
      });
    }
  }

  const row = {
    movement_type: type,
    total_amount: amount,
    transaction_date: date,
    charge_date: charge_date ?? date,
    currency: currency ?? 'ILS',
    ...(description !== undefined && { description }),
    ...(category_id !== undefined && { category_id }),
    ...(payment_source_id !== undefined && { payment_source_id }),
    ...(notes !== undefined && { notes }),
    ...(tags !== undefined && { tags }),
    ...(external_id !== undefined && { external_id }),
  };

  const { data, error } = await supabase
    .from('transactions')
    .insert(row)
    .select('id, external_id, created_at')
    .single();

  if (error) {
    // Race condition: another request won the external_id unique constraint
    if (error.code === '23505') {
      console.log(JSON.stringify({ event: 'v1.transaction.duplicate', external_id }));
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

  console.log(JSON.stringify({ event: 'v1.transaction.created', id: data.id, external_id: data.external_id }));
  return res.status(201).json({
    success: true,
    id: data.id,
    external_id: data.external_id ?? null,
    created_at: data.created_at,
  });
}

module.exports = { createTransaction };
