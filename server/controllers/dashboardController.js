const supabase = require('../config/supabase');
const { isValidDateString, parsePositiveInt } = require('../utils/transactionQuery');

// Bounds the trend chart so a caller cannot request an unbounded series.
const MAX_SERIES_MONTHS = 24;
const DEFAULT_SERIES_MONTHS = 6;

/**
 * GET /api/dashboard/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Period income / expenses / balance / count, aggregated in PostgreSQL.
 *
 * Replaces the previous approach where the Dashboard downloaded the entire
 * transactions array and summed it in the browser via calculateSummaryStats().
 * That was doubly wrong: it shipped megabytes to compute four numbers, and the
 * array it summed was silently truncated at 1000 rows, so any period reaching
 * before 2026-04-09 was understated with no warning.
 *
 * The income/expense rule itself is unchanged: total_amount is stored
 * non-negative and movement_type carries the sign.
 */
exports.getSummary = async (req, res) => {
  const { from, to } = req.query;

  if (!from || !to) {
    return res.status(400).json({ error: 'from and to query parameters are required' });
  }
  if (!isValidDateString(from)) {
    return res.status(400).json({ error: 'from must be a valid date in YYYY-MM-DD format' });
  }
  if (!isValidDateString(to)) {
    return res.status(400).json({ error: 'to must be a valid date in YYYY-MM-DD format' });
  }
  if (from > to) {
    return res.status(400).json({ error: 'from must be earlier than or equal to to' });
  }

  try {
    const { data, error } = await supabase.rpc('dashboard_summary', {
      p_from: from,
      p_to: to,
    });

    if (error) throw error;

    res.status(200).json({
      income: Number(data?.income) || 0,
      expenses: Number(data?.expenses) || 0,
      balance: Number(data?.balance) || 0,
      count: Number(data?.count) || 0,
    });
  } catch (error) {
    console.error('getSummary Error:', error);
    res.status(400).json({ error: error.message });
  }
};

/**
 * GET /api/dashboard/monthly-series?months=6
 *
 * Trailing-N-month income/expense series for the trend chart, aggregated in
 * PostgreSQL. Replaces prepareMonthlyChartData(), which bucketed the full
 * downloaded transaction array in JavaScript.
 *
 * Months with no transactions are returned with zeros so the chart keeps a
 * continuous axis — same as the previous client-side behaviour.
 */
exports.getMonthlySeries = async (req, res) => {
  const { months } = req.query;

  let seriesMonths = DEFAULT_SERIES_MONTHS;
  if (months !== undefined && months !== '') {
    const parsed = parsePositiveInt(months);
    if (parsed === null) {
      return res.status(400).json({ error: 'months must be a positive integer' });
    }
    seriesMonths = Math.min(parsed, MAX_SERIES_MONTHS);
  }

  try {
    const { data, error } = await supabase.rpc('dashboard_monthly_series', {
      p_months: seriesMonths,
    });

    if (error) throw error;

    const series = Array.isArray(data) ? data : [];
    res.status(200).json(
      series.map((row) => ({
        month: row.month,
        income: Number(row.income) || 0,
        expenses: Number(row.expenses) || 0,
      }))
    );
  } catch (error) {
    console.error('getMonthlySeries Error:', error);
    res.status(400).json({ error: error.message });
  }
};
