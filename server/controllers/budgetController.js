const supabase = require('../config/supabase');
const budgetService = require('../services/budgetService');
const money = require('../utils/money');

// Authoritative funded-budget money crosses the HTTP boundary as an exact
// nonnegative decimal string. JSON numbers are deliberately rejected because
// they may already have lost precision before controller validation runs.
const FUNDED_MONEY_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const ZERO_MONEY_PATTERN = /^0(?:\.0{1,2})?$/;
const CARRYOVER_FINGERPRINT_PATTERN = /^[0-9a-f]{32}$/;

const validateFundedMoney = (res, field, value, { positive = false } = {}) => {
  if (typeof value !== 'string' || !FUNDED_MONEY_PATTERN.test(value)) {
    res.status(400).json({
      error: `${field} must be a canonical nonnegative decimal string with at most two decimal places`,
      code: 'INVALID_MONEY_FORMAT',
    });
    return false;
  }
  if (positive && ZERO_MONEY_PATTERN.test(value)) {
    res.status(400).json({
      error: `${field} must be a positive decimal string`,
      code: 'INVALID_MONEY_AMOUNT',
    });
    return false;
  }
  return true;
};

const budgetErrorStatus = (error) => {
  if (error?.code === 'P0002') return 404;
  if (['23505', '23514', '40001', '55000', '0A000'].includes(error?.code)) return 409;
  return 400;
};

const sendBudgetError = (res, label, error) => {
  console.error(`${label} Error:`, error);
  const domainCode = String(error?.message || '').match(/^([A-Z][A-Z0-9_]+):/)?.[1];
  const code = domainCode || error?.code || 'BUDGET_ERROR';
  return res.status(domainCode ? 409 : budgetErrorStatus(error)).json({
    error: error.message,
    code,
  });
};

// GET /api/budgets?month=2026-02
exports.getBudgetsByMonth = async (req, res) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'month query parameter is required' });
    const state = await budgetService.getFundedBudgetMonth(supabase, month);
    res.status(200).json(budgetService.toCompatibilityRows(state));
  } catch (error) {
    return sendBudgetError(res, 'getBudgetsByMonth', error);
  }
};

// GET /api/budgets/funded?month=2026-02
exports.getFundedBudgetMonth = async (req, res) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'month query parameter is required' });
    const state = await budgetService.getFundedBudgetMonth(supabase, month);
    return res.status(200).json(state);
  } catch (error) {
    return sendBudgetError(res, 'getFundedBudgetMonth', error);
  }
};

exports.getBudgetHistory = async (req, res) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'month query parameter is required' });
    const state = await budgetService.getFundedBudgetMonth(supabase, month);
    return res.status(200).json({
      month: state.month,
      history: state.history || [],
      carryover_history: state.carryover_history || [],
      unused_disposition_history: state.unused_disposition_history || [],
      savings: state.savings || { balance: '0.00' },
    });
  } catch (error) {
    return sendBudgetError(res, 'getBudgetHistory', error);
  }
};

exports.addManualFunding = async (req, res) => {
  try {
    const { month, amount, source_label: sourceLabel, request_key: requestKey, reason } = req.body;
    if (!month || amount === undefined || !sourceLabel) {
      return res.status(400).json({ error: 'month, amount, and source_label are required' });
    }
    if (!validateFundedMoney(res, 'amount', amount, { positive: true })) return undefined;
    const state = await budgetService.addManualFunding(supabase, {
      month, amount, sourceLabel, requestKey, reason,
    });
    return res.status(200).json(state);
  } catch (error) {
    return sendBudgetError(res, 'addManualFunding', error);
  }
};

exports.establishBudget = async (req, res) => {
  try {
    const {
      month,
      category_id: categoryId,
      starting_amount: startingAmount,
      starting_kind: startingKind = 'manual',
      request_key: requestKey,
      reason,
    } = req.body;
    if (!month || !categoryId || startingAmount === undefined) {
      return res.status(400).json({ error: 'month, category_id, and starting_amount are required' });
    }
    if (!validateFundedMoney(res, 'starting_amount', startingAmount)) return undefined;
    const state = await budgetService.establishBudget(supabase, {
      month, categoryId, startingAmount, startingKind, requestKey, reason,
    });
    return res.status(200).json(state);
  } catch (error) {
    return sendBudgetError(res, 'establishBudget', error);
  }
};

exports.adjustBudget = async (req, res) => {
  try {
    const { target_amount: targetAmount, request_key: requestKey, reason } = req.body;
    if (targetAmount === undefined) {
      return res.status(400).json({ error: 'target_amount is required' });
    }
    if (!validateFundedMoney(res, 'target_amount', targetAmount)) return undefined;
    const state = await budgetService.setBudgetAmount(supabase, {
      budgetId: req.params.id, targetAmount, requestKey, reason,
    });
    return res.status(200).json(state);
  } catch (error) {
    return sendBudgetError(res, 'adjustBudget', error);
  }
};

exports.removeBudget = async (req, res) => {
  try {
    const { request_key: requestKey, reason } = req.body || {};
    const state = await budgetService.removeBudget(supabase, {
      budgetId: req.params.id, requestKey, reason,
    });
    return res.status(200).json(state);
  } catch (error) {
    return sendBudgetError(res, 'removeBudget', error);
  }
};

exports.reactivateBudget = async (req, res) => {
  try {
    const {
      additional_amount: additionalAmount = '0.00',
      request_key: requestKey,
      reason,
    } = req.body || {};
    if (!validateFundedMoney(res, 'additional_amount', additionalAmount)) return undefined;
    const state = await budgetService.reactivateBudget(supabase, {
      budgetId: req.params.id, additionalAmount, requestKey, reason,
    });
    return res.status(200).json(state);
  } catch (error) {
    return sendBudgetError(res, 'reactivateBudget', error);
  }
};

exports.reverseOperation = async (req, res) => {
  try {
    const { request_key: requestKey, reason } = req.body || {};
    const state = await budgetService.reverseOperation(supabase, {
      operationId: req.params.id, requestKey, reason,
    });
    return res.status(200).json(state);
  } catch (error) {
    return sendBudgetError(res, 'reverseOperation', error);
  }
};

exports.initializeRecurringBudgets = async (req, res) => {
  try {
    const { month, request_key: requestKey, reason } = req.body || {};
    if (!month) {
      return res.status(400).json({ error: 'month is required' });
    }
    const state = await budgetService.initializeRecurringBudgets(supabase, {
      month, requestKey, reason,
    });
    return res.status(200).json(state);
  } catch (error) {
    return sendBudgetError(res, 'initializeRecurringBudgets', error);
  }
};

exports.setMonthOverride = async (req, res) => {
  try {
    const { amount, request_key: requestKey, reason } = req.body || {};
    const { month, categoryId } = req.params;
    if (!month || !categoryId || amount === undefined || !requestKey) {
      return res.status(400).json({
        error: 'month, categoryId, amount, and request_key are required',
        code: 'INVALID_MONTH_OVERRIDE_REQUEST',
      });
    }
    if (!validateFundedMoney(res, 'amount', amount)) return undefined;
    const state = await budgetService.setMonthOverride(supabase, {
      month, categoryId, amount, requestKey, reason,
    });
    return res.status(200).json(state);
  } catch (error) {
    return sendBudgetError(res, 'setMonthOverride', error);
  }
};

exports.removeMonthOverride = async (req, res) => {
  try {
    const { request_key: requestKey, reason } = req.body || {};
    const { month, categoryId } = req.params;
    if (!month || !categoryId || !requestKey) {
      return res.status(400).json({
        error: 'month, categoryId, and request_key are required',
        code: 'INVALID_MONTH_OVERRIDE_REQUEST',
      });
    }
    const state = await budgetService.removeMonthOverride(supabase, {
      month, categoryId, requestKey, reason,
    });
    return res.status(200).json(state);
  } catch (error) {
    return sendBudgetError(res, 'removeMonthOverride', error);
  }
};

exports.getCarryoverPreview = async (req, res) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'month query parameter is required' });
    const preview = await budgetService.getCarryoverPreview(supabase, month);
    return res.status(200).json(preview);
  } catch (error) {
    return sendBudgetError(res, 'getCarryoverPreview', error);
  }
};

exports.applyCarryover = async (req, res) => {
  try {
    const {
      destination_month: destinationMonth,
      preview_fingerprint: previewFingerprint,
      request_key: requestKey,
      reason,
    } = req.body || {};
    if (!destinationMonth || !requestKey || !CARRYOVER_FINGERPRINT_PATTERN.test(previewFingerprint || '')) {
      return res.status(400).json({
        error: 'destination_month, request_key, and a valid preview_fingerprint are required',
        code: 'INVALID_CARRYOVER_REQUEST',
      });
    }
    const result = await budgetService.applyCarryover(supabase, {
      destinationMonth, previewFingerprint, requestKey, reason,
    });
    return res.status(200).json(result);
  } catch (error) {
    return sendBudgetError(res, 'applyCarryover', error);
  }
};

exports.reverseCarryover = async (req, res) => {
  try {
    const { request_key: requestKey, reason } = req.body || {};
    if (!requestKey) {
      return res.status(400).json({ error: 'request_key is required', code: 'INVALID_CARRYOVER_REQUEST' });
    }
    const result = await budgetService.reverseCarryover(supabase, {
      transferId: req.params.id, requestKey, reason,
    });
    return res.status(200).json(result);
  } catch (error) {
    return sendBudgetError(res, 'reverseCarryover', error);
  }
};

exports.getMonthDispositionPreview = async (req, res) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'month query parameter is required' });
    const preview = await budgetService.getMonthDispositionPreview(supabase, month);
    return res.status(200).json(preview);
  } catch (error) {
    return sendBudgetError(res, 'getMonthDispositionPreview', error);
  }
};

exports.applyMonthDisposition = async (req, res) => {
  try {
    const {
      source_month: sourceMonth,
      preview_fingerprint: previewFingerprint,
      request_key: requestKey,
      reason,
    } = req.body || {};
    if (!sourceMonth || !requestKey || !CARRYOVER_FINGERPRINT_PATTERN.test(previewFingerprint || '')) {
      return res.status(400).json({
        error: 'source_month, request_key, and a valid preview_fingerprint are required',
        code: 'INVALID_MONTH_DISPOSITION_REQUEST',
      });
    }
    const result = await budgetService.applyMonthDisposition(supabase, {
      sourceMonth, previewFingerprint, requestKey, reason,
    });
    return res.status(200).json(result);
  } catch (error) {
    return sendBudgetError(res, 'applyMonthDisposition', error);
  }
};

exports.reverseMonthDisposition = async (req, res) => {
  try {
    const { request_key: requestKey, reason } = req.body || {};
    if (!requestKey) {
      return res.status(400).json({
        error: 'request_key is required', code: 'INVALID_MONTH_DISPOSITION_REQUEST',
      });
    }
    const result = await budgetService.reverseMonthDisposition(supabase, {
      batchId: req.params.id, requestKey, reason,
    });
    return res.status(200).json(result);
  } catch (error) {
    return sendBudgetError(res, 'reverseMonthDisposition', error);
  }
};

// POST /api/budgets — create or update a budget row
exports.upsertBudget = async (req, res) => {
  try {
    const { category_id: categoryId, month, amount, request_key: requestKey } = req.body;

    if (!categoryId || !month || amount === undefined) {
      return res.status(400).json({ error: 'category_id, month, and amount are required' });
    }
    if (!validateFundedMoney(res, 'amount', amount)) return undefined;
    const current = await budgetService.getFundedBudgetMonth(supabase, month);
    const existing = (current.categories || []).find(
      (category) => String(category.category_id) === String(categoryId) && category.budget_id,
    );
    let state;
    if (!existing) {
      state = await budgetService.establishBudget(supabase, {
        month,
        categoryId,
        startingAmount: amount,
        startingKind: 'manual',
        requestKey,
      });
    } else if (existing.lifecycle_state === 'inactive') {
      return res.status(409).json({
        error: 'This category has historical budget state and must be reactivated explicitly',
        code: 'BUDGET_REACTIVATION_REQUIRED',
        budget_id: existing.budget_id,
      });
    } else {
      state = await budgetService.setBudgetAmount(supabase, {
        budgetId: existing.budget_id,
        targetAmount: amount,
        requestKey,
      });
    }
    const row = budgetService.toCompatibilityRows(state)
      .find((budget) => String(budget.category_id) === String(categoryId));
    return res.status(200).json(row);
  } catch (error) {
    return sendBudgetError(res, 'upsertBudget', error);
  }
};

// POST /api/budgets/copy — copy budget from one month to another
exports.copyBudget = async (req, res) => {
  try {
    const { fromMonth, toMonth, request_key: requestKey } = req.body;

    if (!fromMonth || !toMonth) {
      return res.status(400).json({ error: 'fromMonth and toMonth are required' });
    }

    const state = await budgetService.copyBudgetMonth(supabase, {
      fromMonth, toMonth, requestKey,
    });
    return res.status(200).json({
      message: 'Budget plan copied with funded provenance',
      data: budgetService.toCompatibilityRows(state),
      funded_state: state,
    });
  } catch (error) {
    return sendBudgetError(res, 'copyBudget', error);
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

    // 1. All budget rows for the year — join categories (no is_active filter for historical data)
    const { data: budgetStates, error: budgetError } = await supabase
      .from('budget_category_state')
      .select('budget_id,category_id,month,starting_amount_text,final_funded_text,category_name,category_icon,category_type,lifecycle_state')
      .gte('month', startMonth)
      .lte('month', endMonth);

    if (budgetError) throw budgetError;
    const budgets = (budgetStates || []).map((budget) => ({
      id: budget.budget_id,
      category_id: budget.category_id,
      month: budget.month,
      starting_amount: budget.starting_amount_text,
      amount: budget.final_funded_text,
      lifecycle_state: budget.lifecycle_state,
      categories: {
        name: budget.category_name,
        icon: budget.category_icon,
        type: budget.category_type,
      },
    }));

    // 2. PostgreSQL-derived exact expense aggregates for the year. Values are
    // decimal strings so PostgREST cannot round them through JavaScript Number.
    const { data: transactions, error: transError } = await supabase
      .from('budget_month_category_actuals')
      .select('month,actual_spent_text,category_id,category_name,category_icon')
      .gte('month', startMonth)
      .lte('month', endMonth);

    if (transError) throw transError;

    // Build per-month set of budgeted category_ids
    const budgetedByMonth = {};
    for (const b of budgets) {
      if (!budgetedByMonth[b.month]) budgetedByMonth[b.month] = new Set();
      if (b.category_id != null && b.lifecycle_state === 'active') {
        budgetedByMonth[b.month].add(b.category_id);
      }
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
        planned: '0.00',
        actual: '0.00',
        budgeted_actual: '0.00',
        non_budgeted_actual: '0.00',
      };
    }

    // Aggregate planned per month and per category from budget rows
    const categoryPlanMap = {}; // category_id -> { category_id, name, icon, planned }
    for (const b of budgets) {
      if (monthlyMap[b.month]) {
        monthlyMap[b.month].planned = money.add(monthlyMap[b.month].planned, b.amount);
      }
      const catId = b.category_id;
      if (catId != null) {
        if (!categoryPlanMap[catId]) {
          categoryPlanMap[catId] = {
            category_id: catId,
            name: b.categories?.name || 'ללא שם',
            icon: b.categories?.icon || null,
            planned: '0.00',
          };
        }
        categoryPlanMap[catId].planned = money.add(categoryPlanMap[catId].planned, b.amount);
      }
    }

    // Process transactions
    let yearly_actual = '0.00';
    let budgeted_expenses = '0.00';
    let non_budgeted_expenses = '0.00';
    const actualByCat    = {}; // category_id -> total (all year, for categories table)
    const nonBudgetedByCat = {}; // for non_budgeted section

    for (const t of transactions) {
      const amount  = t.actual_spent_text;
      const txMonth = t.month;
      const catId   = t.category_id;

      yearly_actual = money.add(yearly_actual, amount);

      if (monthlyMap[txMonth]) monthlyMap[txMonth].actual = money.add(monthlyMap[txMonth].actual, amount);

      // All-year actual per category (for category table)
      if (catId != null) {
        actualByCat[catId] = money.add(actualByCat[catId] || '0.00', amount);
      }

      // Per-month budgeted check
      const isBudgeted =
        catId != null &&
        budgetedByMonth[txMonth] &&
        budgetedByMonth[txMonth].has(catId);

      if (isBudgeted) {
        budgeted_expenses = money.add(budgeted_expenses, amount);
        if (monthlyMap[txMonth]) monthlyMap[txMonth].budgeted_actual = money.add(monthlyMap[txMonth].budgeted_actual, amount);
      } else {
        non_budgeted_expenses = money.add(non_budgeted_expenses, amount);
        if (monthlyMap[txMonth]) monthlyMap[txMonth].non_budgeted_actual = money.add(monthlyMap[txMonth].non_budgeted_actual, amount);

        const nbKey = catId != null ? String(catId) : '__null__';
        if (!nonBudgetedByCat[nbKey]) {
          nonBudgetedByCat[nbKey] = {
            category_id: catId,
            name: catId != null ? (t.category_name || 'ללא שם') : 'ללא קטגוריה',
            icon: catId != null ? (t.category_icon || null) : null,
            total: '0.00',
          };
        }
        nonBudgetedByCat[nbKey].total = money.add(nonBudgetedByCat[nbKey].total, amount);
      }
    }

    // Build outputs
    const monthly = Object.values(monthlyMap)
      .sort((a, b) => a.month.localeCompare(b.month));

    const categories = Object.values(categoryPlanMap).map(c => {
      const actual  = actualByCat[c.category_id] || '0.00';
      const planned = c.planned;
      return {
        category_id: c.category_id,
        name: c.name,
        icon: c.icon,
        planned,
        actual,
        diff: money.subtract(planned, actual),
        pct_used: money.compare(planned) > 0 ? money.percentage(actual, planned) : 0,
      };
    }).sort((a, b) => money.compare(a.diff, b.diff)); // most overrun first

    const yearly_planned      = money.sum(budgets.map((budget) => budget.amount));
    const months_with_data    = monthly.filter(m => money.compare(m.actual) > 0).length;
    const months_with_budget  = Object.keys(budgetedByMonth).length;
    const monthly_average     = months_with_data > 0 ? money.divide(yearly_actual, months_with_data) : '0.00';
    const projected_year_end  = money.multiply(monthly_average, 12);

    const today        = new Date();
    const currentYear  = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    let remaining_months;
    if (yearNum < currentYear)      remaining_months = 0;
    else if (yearNum > currentYear) remaining_months = 12;
    else                            remaining_months = 12 - currentMonth;

    const remaining = money.subtract(yearly_planned, yearly_actual);
    const allowance_per_remaining_month =
      remaining_months > 0 ? money.divide(remaining, remaining_months) : null;

    const non_budgeted_by_category = Object.values(nonBudgetedByCat)
      .sort((a, b) => money.compare(b.total, a.total));

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

// GET /api/budgets/monthly-category-breakdown?year=YYYY
exports.getMonthlyCategoryBreakdown = async (req, res) => {
  try {
    const { year } = req.query;
    if (!year || !/^\d{4}$/.test(year)) {
      return res.status(400).json({ error: 'year must be a 4-digit integer' });
    }

    const startMonth = `${year}-01`;
    const endMonth   = `${year}-12`;

    const MONTH_LABELS = [
      '', 'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
      'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
    ];

    const months = [];
    const monthLabels = [];
    for (let m = 1; m <= 12; m++) {
      const ms = `${year}-${String(m).padStart(2, '0')}`;
      months.push(ms);
      monthLabels.push(MONTH_LABELS[m]);
    }

    // 1. All budget rows for the year
    const { data: budgetStates, error: budgetError } = await supabase
      .from('budget_category_state')
      .select('category_id,month,final_funded_text,category_name,category_icon')
      .gte('month', startMonth)
      .lte('month', endMonth);
    if (budgetError) throw budgetError;
    const budgets = (budgetStates || []).map((budget) => ({
      category_id: budget.category_id,
      month: budget.month,
      amount: budget.final_funded_text,
      categories: { name: budget.category_name, icon: budget.category_icon },
    }));

    // 2. PostgreSQL-derived exact expense aggregates for the year
    const { data: transactions, error: transError } = await supabase
      .from('budget_month_category_actuals')
      .select('month,actual_spent_text,category_id,category_name,category_icon')
      .gte('month', startMonth)
      .lte('month', endMonth);
    if (transError) throw transError;

    // Build budget map: budgetMap[catKey][month] = amount
    // catKey is String(category_id)
    const budgetMap = {};
    const catMeta   = {}; // catKey -> { name, icon, is_budgeted_any_month }

    for (const b of budgets) {
      const key = b.category_id != null ? String(b.category_id) : '__null__';
      if (!budgetMap[key]) budgetMap[key] = {};
      budgetMap[key][b.month] = money.add(budgetMap[key][b.month] || '0.00', b.amount);
      if (!catMeta[key]) {
        catMeta[key] = {
          category_id: b.category_id,
          name: b.categories?.name || 'ללא שם',
          icon: b.categories?.icon || null,
          is_budgeted_any_month: true,
        };
      }
    }

    // Build actual map: actualMap[catKey][month] = amount
    // Expense transactions with null category_id OR missing joined category → '__null__' key
    const actualMap = {};

    for (const t of transactions) {
      const amount = t.actual_spent_text;
      const txMonth = t.month;

      // A transaction is "uncategorized" if category_id is null OR joined category is missing
      const isCategorized = t.category_id != null && t.category_name != null;
      const key = isCategorized ? String(t.category_id) : '__null__';

      if (!actualMap[key]) actualMap[key] = {};
      actualMap[key][txMonth] = money.add(actualMap[key][txMonth] || '0.00', amount);

      // Register meta for categories that only appear in transactions (unbudgeted)
      if (!catMeta[key]) {
        catMeta[key] = {
          category_id: isCategorized ? t.category_id : null,
          name: isCategorized ? (t.category_name || 'ללא שם') : 'ללא קטגוריה',
          icon: isCategorized ? (t.category_icon || null) : null,
          is_budgeted_any_month: false,
        };
      }
    }

    // Ensure the '__null__' row is always named correctly
    if (catMeta['__null__']) {
      catMeta['__null__'].name = 'ללא קטגוריה';
      catMeta['__null__'].icon = null;
    }

    // Collect all category keys: union of budgeted + actual
    const allKeys = new Set([...Object.keys(budgetMap), ...Object.keys(actualMap)]);

    // Build per-category rows
    const rows = [];
    for (const key of allKeys) {
      const meta = catMeta[key];
      const monthCells = {};
      let yearlyPlanned = '0.00';
      let yearlyActual  = '0.00';
      let hasAnyPlanned = false;

      for (const m of months) {
        const planned = budgetMap[key]?.[m] ?? null;
        const actual  = actualMap[key]?.[m] ?? '0.00';
        const diff    = planned !== null ? money.subtract(planned, actual) : null;

        monthCells[m] = { planned, actual, diff };

        if (planned !== null) { yearlyPlanned = money.add(yearlyPlanned, planned); hasAnyPlanned = true; }
        yearlyActual = money.add(yearlyActual, actual);
      }

      rows.push({
        category_id: meta.category_id,
        name: meta.name,
        icon: meta.icon,
        is_budgeted_any_month: meta.is_budgeted_any_month,
        months: monthCells,
        yearly: {
          planned: hasAnyPlanned ? yearlyPlanned : null,
          actual: yearlyActual,
          diff: hasAnyPlanned ? money.subtract(yearlyPlanned, yearlyActual) : null,
        },
      });
    }

    // Sort: budgeted first (by yearly actual desc), then unbudgeted (by yearly actual desc),
    // '__null__' (ללא קטגוריה) always last
    rows.sort((a, b) => {
      const aIsNull = a.category_id === null;
      const bIsNull = b.category_id === null;
      if (aIsNull && !bIsNull) return 1;
      if (!aIsNull && bIsNull) return -1;
      if (a.is_budgeted_any_month !== b.is_budgeted_any_month) {
        return a.is_budgeted_any_month ? -1 : 1;
      }
      return money.compare(b.yearly.actual, a.yearly.actual);
    });

    // Build totals row: planned = sum of budgeted categories; actual = ALL actual
    const totals = { months: {}, yearly: { planned: '0.00', actual: '0.00', diff: '0.00' } };
    for (const m of months) {
      let mPlanned = '0.00';
      let mActual  = '0.00';
      for (const row of rows) {
        const cell = row.months[m];
        if (cell.planned !== null) mPlanned = money.add(mPlanned, cell.planned);
        mActual = money.add(mActual, cell.actual);
      }
      totals.months[m] = { planned: mPlanned, actual: mActual, diff: money.subtract(mPlanned, mActual) };
      totals.yearly.planned = money.add(totals.yearly.planned, mPlanned);
      totals.yearly.actual = money.add(totals.yearly.actual, mActual);
    }
    totals.yearly.diff = money.subtract(totals.yearly.planned, totals.yearly.actual);

    res.json({ year: parseInt(year, 10), months, monthLabels, rows, totals });
  } catch (error) {
    console.error('getMonthlyCategoryBreakdown Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// DELETE /api/budgets/:id
exports.deleteBudget = async (req, res) => {
  try {
    const state = await budgetService.removeBudget(supabase, {
      budgetId: req.params.id,
      requestKey: req.body?.request_key,
      reason: req.body?.reason || 'Removed through compatibility route',
    });
    return res.status(200).json({
      message: 'Budget removed; funded history was preserved',
      funded_state: state,
    });
  } catch (error) {
    return sendBudgetError(res, 'deleteBudget', error);
  }
};
