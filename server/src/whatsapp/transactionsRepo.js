const supabase = require('../../config/supabase');

/**
 * Create an expense transaction in the transactions table.
 * @param {{ category_id: number, amount: number, description: string }} params
 * @returns {object|null} The created transaction or null on error.
 */
async function createTransaction({ category_id, amount, description }) {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('transactions')
    .insert([{
      description,
      movement_type: 'expense',
      category_id,
      total_amount: amount,
      transaction_date: today,
      charge_date: today,
    }])
    .select()
    .single();

  if (error) {
    console.error('[WhatsApp] transactionsRepo.createTransaction error:', error.message);
    return null;
  }

  return data;
}

module.exports = { createTransaction };
