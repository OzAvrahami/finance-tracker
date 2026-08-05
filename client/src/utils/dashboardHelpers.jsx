/**
 * Dashboard presentation helpers.
 *
 * NOTE ON OWNERSHIP:
 * Financial aggregation for the Dashboard lives in PostgreSQL — see
 * dashboard_summary() and dashboard_monthly_series() in
 * server/migrations/003_transaction_pagination_and_aggregates.sql, exposed via
 * GET /api/dashboard/summary and GET /api/dashboard/monthly-series.
 *
 * The former filterTransactionsByMonth(), calculateSummaryStats() and
 * prepareMonthlyChartData() helpers were removed with that change. They summed
 * a transaction array downloaded into the browser, which meant the
 * income/expense rule had a second owner on the client, and the array they
 * summed was silently capped at 1000 rows — so every Dashboard total covering a
 * period before 2026-04 was understated.
 *
 * Do not reintroduce client-side aggregation of transaction rows here. Add the
 * aggregate to the SQL functions and expose it through the dashboard endpoint.
 */

const HEBREW_MONTHS_SHORT = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];

/**
 * Turns a 'YYYY-MM' key from the aggregate API into the short Hebrew month
 * label used on the trend chart axis. Purely presentational.
 */
export const formatMonthKeyShort = (monthKey) => {
  if (typeof monthKey !== 'string') return '';
  const monthIndex = Number(monthKey.slice(5, 7)) - 1;
  return HEBREW_MONTHS_SHORT[monthIndex] ?? '';
};

/**
 * Groups an already-fetched, bounded set of transactions by category name for
 * a pie chart. Presentation-only: it aggregates whatever array it is handed and
 * must not be used as a substitute for a server-side total.
 */
export const preparePieChartData = (transactions) => {
  const categoryMap = transactions
    .filter(t => t.movement_type === 'expense')
    .reduce((acc, curr) => {
      const catName = curr.categories?.name || 'ללא קטגוריה';
      const amount = Number(curr.total_amount) || 0;

      if (!acc[catName]) {
        acc[catName] = 0;
      }
      acc[catName] += amount;
      return acc;
    }, {});

  return Object.keys(categoryMap).map(key => ({
    name: key,
    value: categoryMap[key]
  })).sort((a, b) => b.value - a.value);
};
