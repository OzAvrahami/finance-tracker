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

// GET /api/budgets/annual-summary?year=2026
exports.getAnnualSummary = async (req, res) => {
  try {
    const { year } = req.query;

    if (!year || !/^\d{4}$/.test(year)) {
      return res.status(400).json({ error: 'year must be a 4-digit integer' });
    }

    const yearNum = parseInt(year, 10);
    const startMonth = `${year}-01`;
    const endMonth   = `${year}-12`;
    const startDate  = `${year}-01-01`;
    const endDate    = `${year}-12-31`;

    // 1. All budget rows for the year — join categories (no is_active filter for historical data)
    const { data: budgets, error: budgetError } = await supabase
      .from('budgets')
      .select('*, categories(name, icon, type)')
      .gte('month', startMonth)
      .lte('month', endMonth);

    if (budgetError) throw budgetError;

    // 2. All expense transactions for the year
    const { data: transactions, error: transError } = await supabase
      .from('transactions')
      .select('transaction_date, total_amount, category_id, categories(name, icon)')
      .eq('movement_type', 'expense')
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate);

    if (transError) throw transError;

    // Build per-month set of budgeted category_ids
    const budgetedByMonth = {};
    for (const b of budgets) {
      if (!budgetedByMonth[b.month]) budgetedByMonth[b.month] = new Set();
      if (b.category_id != null) budgetedByMonth[b.month].add(b.category_id);
    }

    const MONTH_LABELS = [
      '', 'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
      'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
    ];

    // Build 12-month skeleton
    const monthlyMap = {};
    for (let m = 1; m <= 12; m++) {
      const monthStr = `${year}-${String(m).padStart(2, '0')}`;
      monthlyMap[monthStr] = {
        month: monthStr,
        label: MONTH_LABELS[m],
        planned: 0,
        actual: 0,
        budgeted_actual: 0,
        non_budgeted_actual: 0,
      };
    }

    // Aggregate planned per month and per category from budget rows
    const categoryPlanMap = {}; // category_id -> { category_id, name, icon, planned }
    for (const b of budgets) {
      if (monthlyMap[b.month]) {
        monthlyMap[b.month].planned += Number(b.amount);
      }
      const catId = b.category_id;
      if (catId != null) {
        if (!categoryPlanMap[catId]) {
          categoryPlanMap[catId] = {
            category_id: catId,
            name: b.categories?.name || 'ללא שם',
            icon: b.categories?.icon || null,
            planned: 0,
          };
        }
        categoryPlanMap[catId].planned += Number(b.amount);
      }
    }

    // Process transactions
    let yearly_actual = 0;
    let budgeted_expenses = 0;
    let non_budgeted_expenses = 0;
    const actualByCat    = {}; // category_id -> total (all year, for categories table)
    const nonBudgetedByCat = {}; // for non_budgeted section

    for (const t of transactions) {
      const amount  = Number(t.total_amount);
      const txMonth = t.transaction_date.slice(0, 7); // 'YYYY-MM'
      const catId   = t.category_id;

      yearly_actual += amount;

      if (monthlyMap[txMonth]) monthlyMap[txMonth].actual += amount;

      // All-year actual per category (for category table)
      if (catId != null) {
        actualByCat[catId] = (actualByCat[catId] || 0) + amount;
      }

      // Per-month budgeted check
      const isBudgeted =
        catId != null &&
        budgetedByMonth[txMonth] &&
        budgetedByMonth[txMonth].has(catId);

      if (isBudgeted) {
        budgeted_expenses += amount;
        if (monthlyMap[txMonth]) monthlyMap[txMonth].budgeted_actual += amount;
      } else {
        non_budgeted_expenses += amount;
        if (monthlyMap[txMonth]) monthlyMap[txMonth].non_budgeted_actual += amount;

        const nbKey = catId != null ? String(catId) : '__null__';
        if (!nonBudgetedByCat[nbKey]) {
          nonBudgetedByCat[nbKey] = {
            category_id: catId,
            name: catId != null ? (t.categories?.name || 'ללא שם') : 'ללא קטגוריה',
            icon: catId != null ? (t.categories?.icon || null) : null,
            total: 0,
          };
        }
        nonBudgetedByCat[nbKey].total += amount;
      }
    }

    // Build outputs
    const monthly = Object.values(monthlyMap)
      .sort((a, b) => a.month.localeCompare(b.month));

    const categories = Object.values(categoryPlanMap).map(c => {
      const actual  = actualByCat[c.category_id] || 0;
      const planned = c.planned;
      return {
        category_id: c.category_id,
        name: c.name,
        icon: c.icon,
        planned,
        actual,
        diff: planned - actual,
        pct_used: planned > 0 ? Math.round((actual / planned) * 100) : 0,
      };
    }).sort((a, b) => a.diff - b.diff); // most overrun first

    const yearly_planned      = budgets.reduce((s, b) => s + Number(b.amount), 0);
    const months_with_data    = monthly.filter(m => m.actual > 0).length;
    const months_with_budget  = Object.keys(budgetedByMonth).length;
    const monthly_average     = months_with_data > 0 ? yearly_actual / months_with_data : 0;
    const projected_year_end  = monthly_average * 12;

    const today        = new Date();
    const currentYear  = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    let remaining_months;
    if (yearNum < currentYear)      remaining_months = 0;
    else if (yearNum > currentYear) remaining_months = 12;
    else                            remaining_months = 12 - currentMonth;

    const remaining = yearly_planned - yearly_actual;
    const allowance_per_remaining_month =
      remaining_months > 0 ? remaining / remaining_months : null;

    const non_budgeted_by_category = Object.values(nonBudgetedByCat)
      .sort((a, b) => b.total - a.total);

    res.json({
      year: yearNum,
      summary: {
        yearly_planned,
        yearly_actual,
        remaining,
        budgeted_expenses,
        non_budgeted_expenses,
        monthly_average,
        projected_year_end,
        months_with_data,
        months_with_budget,
        allowance_per_remaining_month,
      },
      monthly,
      categories,
      non_budgeted: {
        total: non_budgeted_expenses,
        by_category: non_budgeted_by_category,
      },
    });
  } catch (error) {
    console.error('getAnnualSummary Error:', error);
    res.status(500).json({ error: error.message });
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
