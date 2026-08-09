import { useMemo } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { Alert } from '../../components/ui';
import AnnualMoneyAmount from './AnnualMoneyAmount';

const getCellState = (planned, actual) => {
  if (planned !== null && actual > 0) return 'normal';
  if (planned !== null && actual === 0) return 'budgeted-no-spend';
  if (planned === null && actual === 0) return 'no-data';
  return 'unplanned';
};

const computeTrend = (totals, months, currentYearMonth) => {
  const relevantMonths = months.filter((month) => {
    if (currentYearMonth && month >= currentYearMonth) return false;
    const total = totals.months[month];
    return total && (total.planned > 0 || total.actual > 0);
  });
  if (relevantMonths.length < 2) return null;
  const olderMonth = relevantMonths[relevantMonths.length - 2];
  const recentMonth = relevantMonths[relevantMonths.length - 1];
  const delta = totals.months[recentMonth].diff - totals.months[olderMonth].diff;
  return delta === 0 ? null : { delta, recentMonth, olderMonth };
};

const computeVisibleMonths = (data, monthRange, currentYearMonth) => {
  if (monthRange === 'full') return data.months;
  const count = monthRange === '3' ? 3 : 6;
  const relevant = data.months.filter((month) => {
    if (currentYearMonth && month >= currentYearMonth) return false;
    const total = data.totals.months[month];
    return total && (total.planned > 0 || total.actual > 0);
  });
  if (!relevant.length) return data.months;
  const selected = new Set(relevant.slice(-count));
  return data.months.filter((month) => selected.has(month));
};

const monthLabel = (data, month) => {
  const index = data.months.indexOf(month);
  return index >= 0 ? data.monthLabels[index] : month;
};

const MatrixCell = ({ cell, current = false }) => {
  if (!cell) return <td className={`annual-matrix-cell${current ? ' is-current' : ''}`}><span aria-label="אין נתונים">—</span></td>;
  const state = getCellState(cell.planned, cell.actual);
  if (state === 'no-data') return <td className={`annual-matrix-cell is-empty${current ? ' is-current' : ''}`}><span aria-label="אין נתונים">—</span></td>;
  if (state === 'unplanned') {
    return (
      <td className={`annual-matrix-cell is-unplanned${current ? ' is-current' : ''}`}>
        <strong>לא תוקצב</strong>
        <AnnualMoneyAmount value={cell.actual} />
        <span>הוצאה לא מתוכננת</span>
      </td>
    );
  }
  const positive = cell.diff >= 0;
  const TrendIcon = positive ? TrendingDown : TrendingUp;
  return (
    <td className={`annual-matrix-cell${current ? ' is-current' : ''}`}>
      <div className="annual-matrix-cell__actual"><AnnualMoneyAmount value={cell.actual} /><TrendIcon size={13} aria-hidden="true" /></div>
      <div className="annual-matrix-cell__planned">מתוכנן <AnnualMoneyAmount value={cell.planned} /></div>
      <div className={positive ? 'is-positive' : 'is-negative'}>
        <span className="u-sr-only">{positive ? 'נותר' : 'חריגה'}</span>
        <span aria-hidden="true">{positive ? '+' : '−'}</span>
        <AnnualMoneyAmount value={Math.abs(cell.diff)} />
      </div>
    </td>
  );
};

const MonthlyBreakdownTable = ({ data, monthRange }) => {
  const today = new Date();
  const currentYearMonth = data.year === today.getFullYear()
    ? `${data.year}-${String(today.getMonth() + 1).padStart(2, '0')}`
    : null;
  const visibleMonths = useMemo(
    () => computeVisibleMonths(data, monthRange, currentYearMonth),
    [currentYearMonth, data, monthRange],
  );
  const trend = useMemo(
    () => computeTrend(data.totals, data.months, currentYearMonth),
    [currentYearMonth, data],
  );
  const hasAnyData = data.months.some((month) => {
    const total = data.totals.months[month];
    return total && (total.planned > 0 || total.actual > 0);
  });

  return (
    <div className="annual-matrix-region">
      {trend && (
        <Alert variant={trend.delta > 0 ? 'success' : 'warning'} className="annual-trend-alert">
          בחודש {monthLabel(data, trend.recentMonth)} חל {trend.delta > 0 ? 'שיפור' : 'שינוי לרעה'} של{' '}
          <AnnualMoneyAmount value={Math.abs(trend.delta)} /> בעמידה מול התקציב לעומת {monthLabel(data, trend.olderMonth)}.
        </Alert>
      )}
      {!hasAnyData ? (
        <div className="annual-matrix-empty">אין נתונים לתקופה זו.</div>
      ) : (
        <div className="annual-matrix-scroll" tabIndex="0" aria-label="מטריצת קטגוריות חודשית; ניתן לגלול אופקית">
          <table className="annual-matrix-table">
            <caption className="u-sr-only">תקציב, הוצאה והפרש לפי קטגוריה וחודש</caption>
            <thead>
              <tr>
                <th className="annual-matrix-sticky">קטגוריה</th>
                {visibleMonths.map((month) => (
                  <th key={month} className={month === currentYearMonth ? 'is-current' : ''}>
                    {monthLabel(data, month)}
                    {month === currentYearMonth && <span>חודש בתהליך</span>}
                  </th>
                ))}
                <th>סך שנתי</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.category_id ?? '__uncategorized__'}>
                  <th scope="row" className="annual-matrix-sticky">
                    <span aria-hidden="true">{row.icon || '🏷️'}</span>
                    <span>{row.name}</span>
                    {!row.is_budgeted_any_month && <span className="annual-unbudgeted-badge">לא מתוקצב</span>}
                  </th>
                  {visibleMonths.map((month) => <MatrixCell key={month} cell={row.months[month]} current={month === currentYearMonth} />)}
                  <MatrixCell cell={row.yearly} />
                </tr>
              ))}
              <tr className="annual-matrix-total-row">
                <th scope="row" className="annual-matrix-sticky">סך הכול</th>
                {visibleMonths.map((month) => <MatrixCell key={month} cell={data.totals.months[month]} current={month === currentYearMonth} />)}
                <MatrixCell cell={data.totals.yearly} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default MonthlyBreakdownTable;
