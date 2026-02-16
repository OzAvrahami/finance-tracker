const supabase = require('../config/supabase');

// GET /api/budgets?month=2026-02
exports.getBudgetsByMonth = async (req, res) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'month query parameter is required' });

    // 1. Fetch budgets for the month with category info
    const { data: budgets, error: budgetError } = await supabase
      .from('budgets')
      .select('*, categories(name, icon, type)')
      .eq('month', month);

    if (budgetError) throw budgetError;

    // 2. Calculate actual spending per category for this month
    // Get first and last day of the month
    const [year, mon] = month.split('-').map(Number);
    const startDate = `${month}-01`;
    const endDate = new Date(year, mon, 0).toISOString().split('T')[0]; // last day

    const { data: transactions, error: transError } = await supabase
      .from('transactions')
      .select('category_id, total_amount')
      .eq('movement_type', 'expense')
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate);

    if (transError) throw transError;

    // Group transactions by category_id and sum
    const spentByCategory = {};
    for (const t of transactions) {
      const catId = t.category_id;
      if (!catId) continue;
      spentByCategory[catId] = (spentByCategory[catId] || 0) + Number(t.total_amount);
    }

    // 3. Merge actual_spent into budget rows
    const result = budgets.map(b => ({
      ...b,
      actual_spent: spentByCategory[b.category_id] || 0
    }));

    res.status(200).json(result);
  } catch (error) {
    console.error('getBudgetsByMonth Error:', error);
    res.status(400).json({ error: error.message });
  }
};

// POST /api/budgets — create or update a budget row
exports.upsertBudget = async (req, res) => {
  try {
    const { category_id, month, amount } = req.body;

    if (!category_id || !month || amount === undefined) {
      return res.status(400).json({ error: 'category_id, month, and amount are required' });
    }

    const { data, error } = await supabase
      .from('budgets')
      .upsert({
        category_id,
        month,
        amount: Number(amount),
        updated_at: new Date().toISOString()
      }, { onConflict: 'category_id,month' })
      .select('*, categories(name, icon, type)');

    if (error) throw error;
    res.status(200).json(data[0]);
  } catch (error) {
    console.error('upsertBudget Error:', error);
    res.status(400).json({ error: error.message });
  }
};

// POST /api/budgets/copy — copy budget from one month to another
exports.copyBudget = async (req, res) => {
  try {
    const { fromMonth, toMonth } = req.body;

    if (!fromMonth || !toMonth) {
      return res.status(400).json({ error: 'fromMonth and toMonth are required' });
    }

    // Fetch source budgets
    const { data: sourceBudgets, error: fetchError } = await supabase
      .from('budgets')
      .select('category_id, amount')
      .eq('month', fromMonth);

    if (fetchError) throw fetchError;

    if (sourceBudgets.length === 0) {
      return res.status(400).json({ error: 'No budgets found for source month' });
    }

    // Upsert into target month
    const rows = sourceBudgets.map(b => ({
      category_id: b.category_id,
      month: toMonth,
      amount: b.amount,
      updated_at: new Date().toISOString()
    }));

    const { data, error } = await supabase
      .from('budgets')
      .upsert(rows, { onConflict: 'category_id,month' })
      .select();

    if (error) throw error;
    res.status(200).json({ message: `Copied ${data.length} budget rows`, data });
  } catch (error) {
    console.error('copyBudget Error:', error);
    res.status(400).json({ error: error.message });
  }
};

// DELETE /api/budgets/:id
exports.deleteBudget = async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('budgets')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.status(200).json({ message: 'Budget deleted' });
  } catch (error) {
    console.error('deleteBudget Error:', error);
    res.status(400).json({ error: error.message });
  }
};
