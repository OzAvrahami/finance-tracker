import {
  AlertTriangle,
  ArrowLeftRight,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronUp,
  Tags,
  TrendingUp,
  WalletCards,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Alert,
  GlassCard,
  ProgressBar,
  SecondaryButton,
  SegmentedControl,
  Select,
  Skeleton,
  TechnicalValue,
} from '../../components/ui';
import AnnualMoneyAmount from './AnnualMoneyAmount';
import MonthlyBreakdownTable from './MonthlyBreakdownTable';

const moneyText = (value) => `₪${Number(value || 0).toLocaleString('en-US', {
  maximumFractionDigits: 2,
})}`;

const rangeOptions = [
  { value: '3', label: '3 חודשים' },
  { value: '6', label: '6 חודשים' },
  { value: 'full', label: 'שנה מלאה' },
];

export const AnnualToolbar = ({
  selectedYear,
  years,
  monthRange,
  onYearChange,
  onMonthRangeChange,
}) => (
  <GlassCard padding="14px 18px" className="annual-toolbar">
    <div className="annual-toolbar__year">
      <Select
        id="annual-year"
        label="שנה"
        value={selectedYear}
        onChange={(event) => onYearChange(Number(event.target.value))}
        technicalLtr
        fullWidth={false}
        selectClassName="annual-year-select"
      >
        {years.map((year) => <option key={year} value={year}>{year}</option>)}
      </Select>
      <span className="annual-toolbar__divider" aria-hidden="true" />
      <p>הדף מנתח תקציב מול הוצאה. אין בו הכנסות, חיסכון או יתרות.</p>
    </div>
    <div className="annual-toolbar__range">
      <span id="annual-range-label">טווח</span>
      <SegmentedControl
        value={monthRange}
        onValueChange={onMonthRangeChange}
        options={rangeOptions}
        labelledBy="annual-range-label"
        size="compact"
      />
    </div>
  </GlassCard>
);

export const SparseBudgetAlert = ({ summary }) => {
  if (!(summary.months_with_budget > 0 && summary.months_with_budget < 12)) return null;
  return (
    <Alert variant="warning" announce className="annual-sparse-alert">
      <strong>כיסוי תקציב דליל:</strong>{' '}
      מוגדרים תקציבים ל־<TechnicalValue>{summary.months_with_budget}</TechnicalValue> חודשים בלבד מתוך{' '}
      <TechnicalValue>{summary.months_with_data}</TechnicalValue> חודשים עם נתונים. הניתוח והתחזית פחות מדויקים.
    </Alert>
  );
};

const AnnualKpi = ({ label, value, note, tone = 'neutral' }) => (
  <GlassCard padding="15px 16px" className={`annual-kpi annual-kpi--${tone}`}>
    <div className="annual-kpi__label">{label}</div>
    <AnnualMoneyAmount className="annual-kpi__value" value={value} />
    <div className="annual-kpi__note">{note}</div>
  </GlassCard>
);

export const AnnualKpis = ({ summary }) => {
  const remainingPositive = summary.remaining >= 0;
  return (
    <section aria-label="מדדי הסיכום השנתי" className="annual-kpi-grid">
      <AnnualKpi
        label="תקציב שנתי מתוכנן"
        value={summary.yearly_planned}
        note={`${summary.months_with_budget} חודשים עם תקציב`}
      />
      <AnnualKpi
        label="הוצאה שנתית בפועל"
        value={summary.yearly_actual}
        note={`${summary.months_with_data} חודשים עם נתונים`}
        tone="expense"
      />
      <AnnualKpi
        label={remainingPositive ? 'נותר מהתקציב' : 'חריגה מהתקציב'}
        value={Math.abs(summary.remaining)}
        note="תקציב פחות ביצוע"
        tone={remainingPositive ? 'positive' : 'expense'}
      />
      <AnnualKpi
        label="ממוצע הוצאה חודשי"
        value={summary.monthly_average}
        note="לפי חודשים עם נתונים בלבד"
        tone="info"
      />
    </section>
  );
};

const AnnualChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="annual-chart-tooltip" dir="rtl">
      <strong>{label}</strong>
      {payload.map((entry) => (
        <div
          key={entry.dataKey}
          className={entry.dataKey === 'actual' && entry.payload?.actual > entry.payload?.planned ? 'is-over' : ''}
        >
          <span>{entry.name}</span>
          <TechnicalValue>{moneyText(entry.value)}</TechnicalValue>
        </div>
      ))}
    </div>
  );
};

const AnnualChart = ({ monthly }) => {
  const chartData = monthly.map((month) => ({
    month: month.label,
    shortMonth: month.label.slice(0, 3),
    planned: month.planned,
    actual: month.actual,
  }));

  return (
    <div className="annual-chart-panel">
      <div className="annual-section-heading annual-chart-heading">
        <div>
          <h2>מתוכנן מול בפועל</h2>
          <p>שנים־עשר חודשי השנה, כולל חודשים ללא פעילות.</p>
        </div>
        <div className="annual-chart-legend" role="list" aria-label="מקרא התרשים">
          <span role="listitem"><i className="is-planned" aria-hidden="true" />מתוכנן</span>
          <span role="listitem"><i className="is-actual" aria-hidden="true" />בפועל</span>
        </div>
      </div>
      <div className="annual-chart" role="img" aria-label="תרשים תקציב מתוכנן מול הוצאה בפועל לפי חודש">
        <ResponsiveContainer width="100%" height={218}>
          <BarChart data={chartData} barCategoryGap="42%" barGap={3} margin={{ top: 8, right: 2, bottom: 0, left: -4 }}>
            <defs>
              <linearGradient id="annual-actual-primary" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--ft-primary-hover)" />
                <stop offset="100%" stopColor="var(--ft-primary-hover)" stopOpacity="0.38" />
              </linearGradient>
              <linearGradient id="annual-actual-over" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--ft-negative)" />
                <stop offset="100%" stopColor="var(--ft-negative)" stopOpacity="0.38" />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--ft-border)" strokeDasharray="3 4" vertical={false} />
            <XAxis
              dataKey="shortMonth"
              tick={{ fill: 'var(--ft-text-faint)', fontSize: 10.5, fontWeight: 600 }}
              tickMargin={8}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: 'var(--ft-text-faint)', fontSize: 10 }}
              tickCount={5}
              tickMargin={8}
              width={48}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value) => value >= 1000 ? `₪${Math.round(value / 1000)}k` : `₪${value}`}
            />
            <Tooltip content={<AnnualChartTooltip />} />
            <Bar dataKey="planned" name="מתוכנן" fill="var(--ft-track)" stroke="var(--ft-border-strong)" radius={[5, 5, 0, 0]} barSize={11} />
            <Bar dataKey="actual" name="בפועל" radius={[5, 5, 0, 0]} barSize={11}>
              {chartData.map((month) => (
                <Cell
                  key={month.month}
                  fill={month.actual > month.planned ? 'url(#annual-actual-over)' : 'url(#annual-actual-primary)'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="u-sr-only" aria-label="סיכום טקסטואלי של נתוני התרשים">
        {monthly.map((month) => (
          <li key={month.month}>
            {month.label}: מתוכנן {moneyText(month.planned)}, בפועל {moneyText(month.actual)}
          </li>
        ))}
      </ul>
    </div>
  );
};

const ForecastItem = ({ icon, label, value, note, tone = 'neutral', unavailable = false }) => (
  <div className={`annual-forecast-item annual-forecast-item--${tone}`}>
    {icon}
    <div>
      <div className="annual-forecast-item__label">{label}</div>
      <div className="annual-forecast-item__value">
        {unavailable ? '—' : value}
      </div>
      <div className="annual-forecast-item__note">{note}</div>
    </div>
  </div>
);

export const AnnualForecastAndChart = ({ data, insights }) => {
  const { summary } = data;
  const hasProjection = summary.months_with_data > 0;
  const hasAllowance = summary.allowance_per_remaining_month !== null;
  return (
    <section className="annual-analysis-grid" aria-label="תרשים, תחזית ותובנות שנתיות">
      <GlassCard padding="18px" className="annual-chart-card">
        <AnnualChart monthly={data.monthly} />
      </GlassCard>
      <GlassCard padding="18px" className="annual-forecast-card">
        <div className="annual-section-heading">
          <div>
            <h2>תחזית ותובנות</h2>
            <p>הערכות המבוססות על הנתונים שנרשמו עד עכשיו.</p>
          </div>
        </div>
        <div className="annual-forecast-list">
          <ForecastItem
            icon={<TrendingUp size={17} aria-hidden="true" />}
            label="תחזית הוצאה לסוף השנה"
            value={<AnnualMoneyAmount value={summary.projected_year_end} />}
            unavailable={!hasProjection}
            note={hasProjection ? 'הרחבה לינארית של הממוצע החודשי — הערכה בלבד' : 'אין מספיק נתונים לתחזית'}
          />
          <ForecastItem
            icon={<WalletCards size={17} aria-hidden="true" />}
            label="תקרה חודשית לחודשים שנותרו"
            value={<AnnualMoneyAmount value={summary.allowance_per_remaining_month} />}
            unavailable={!hasAllowance}
            tone={hasAllowance && summary.allowance_per_remaining_month < 0 ? 'expense' : 'neutral'}
            note={hasAllowance ? 'היתרה השנתית מחולקת בחודשים שנותרו' : 'לא נותרו חודשים לחישוב תקרה חודשית'}
          />
          <ForecastItem
            icon={<CalendarDays size={17} aria-hidden="true" />}
            label="החודש היקר ביותר"
            value={insights.mostExpensiveMonth?.actual > 0
              ? <><span>{insights.mostExpensiveMonth.label}</span> · <AnnualMoneyAmount value={insights.mostExpensiveMonth.actual} /></>
              : 'אין נתונים'}
            unavailable={!insights.mostExpensiveMonth?.actual}
            note="לפי הוצאה חודשית בפועל"
            tone="warning"
          />
          <ForecastItem
            icon={<AlertTriangle size={17} aria-hidden="true" />}
            label="החריגה הקטגוריאלית הגדולה ביותר"
            value={insights.biggestOverrun
              ? <><span>{insights.biggestOverrun.name}</span> · <AnnualMoneyAmount value={Math.abs(insights.biggestOverrun.diff)} /></>
              : 'אין חריגות'}
            note="מצטבר על פני השנה"
            tone={insights.biggestOverrun ? 'expense' : 'positive'}
          />
        </div>
      </GlassCard>
    </section>
  );
};

const SpendingSourceRow = ({ label, value, tone = 'neutral', percent }) => (
  <div className={`annual-spending-source annual-spending-source--${tone}`}>
    <span>{label}</span>
    <div>
      <AnnualMoneyAmount value={value} />
      {percent !== null && <TechnicalValue>{percent}%</TechnicalValue>}
    </div>
  </div>
);

export const AnnualSpendingAnalysis = ({ data }) => {
  const total = Number(data.summary.yearly_actual);
  const uncategorized = data.non_budgeted.by_category
    .filter((item) => item.category_id == null)
    .reduce((sum, item) => sum + Number(item.total), 0);
  const namedNonBudgeted = Number(data.summary.non_budgeted_expenses) - uncategorized;
  const percentage = (value) => total > 0 ? Math.round((Number(value) / total) * 100) : 0;
  const namedRows = data.non_budgeted.by_category.filter((item) => item.category_id != null);
  const uncategorizedRows = data.non_budgeted.by_category.filter((item) => item.category_id == null);

  return (
    <section className="annual-spending-grid" aria-label="מקורות ההוצאה והוצאות לא מתוקצבות">
      <GlassCard padding="20px">
        <div className="annual-section-heading">
          <h2>מהיכן ההוצאה השנתית</h2>
        </div>
        <div className="annual-spending-source-list">
          <SpendingSourceRow label="הוצאה בקטגוריות מתוקצבות" value={data.summary.budgeted_expenses} percent={percentage(data.summary.budgeted_expenses)} />
          <SpendingSourceRow label="הוצאה בקטגוריות ללא תקציב" value={namedNonBudgeted} percent={percentage(namedNonBudgeted)} tone="warning" />
          <SpendingSourceRow label="הוצאה ללא קטגוריה" value={uncategorized} percent={percentage(uncategorized)} tone="uncategorized" />
        </div>
        <div className="annual-nonbudgeted-total">
          <span>הוצאה לא מתוקצבת</span>
          <AnnualMoneyAmount value={data.summary.non_budgeted_expenses} />
        </div>
      </GlassCard>

      <GlassCard padding="20px">
        <div className="annual-section-heading">
          <div>
            <h2>קטגוריות ללא תקציב</h2>
            <p>הוצאות בחודש שבו לא הוגדר לקטגוריה תקציב.</p>
          </div>
        </div>
        {data.non_budgeted.total > 0 ? (
          <div
            className="annual-nonbudgeted-list"
            role="region"
            tabIndex="0"
            aria-label="פירוט כל הקטגוריות ללא תקציב"
          >
            {namedRows.map((item) => (
              <div key={item.category_id} className="annual-nonbudgeted-row">
                <span><span aria-hidden="true">{item.icon || '🏷️'}</span>{item.name}</span>
                <AnnualMoneyAmount value={item.total} />
              </div>
            ))}
            {uncategorizedRows.map((item, index) => (
              <div key={`uncategorized-${index}`} className="annual-nonbudgeted-row annual-nonbudgeted-row--uncategorized">
                <span><Tags size={15} aria-hidden="true" />הוצאות ללא קטגוריה</span>
                <AnnualMoneyAmount value={item.total} />
              </div>
            ))}
          </div>
        ) : (
          <p className="annual-section-empty">אין הוצאות לא מתוקצבות בשנה שנבחרה.</p>
        )}
      </GlassCard>
    </section>
  );
};

const categoryTone = (category) => {
  if (category.pct_used > 100) return 'expense';
  if (category.pct_used > 70) return 'warning';
  if (category.pct_used === 0) return 'neutral';
  return 'primary';
};

const CategoryStatus = ({ category }) => {
  if (category.pct_used > 100) return 'חריגה';
  if (category.pct_used > 70) return 'קרוב למגבלה';
  if (category.pct_used === 0) return 'ללא הוצאה';
  return 'בתוך התקציב';
};

const CategoryProgress = ({ category }) => {
  const tone = categoryTone(category);
  return (
    <div className="annual-category-progress">
      <div>
        <TechnicalValue>{category.pct_used}%</TechnicalValue>
        <span>{CategoryStatus({ category })}</span>
      </div>
      <ProgressBar
        value={category.pct_used}
        tone={{ expense: 'neg', warning: 'warn', neutral: 'primary' }[tone] || 'primary'}
        aria-label={`ניצול התקציב של ${category.name}`}
        aria-valuetext={`${category.pct_used}% — ${CategoryStatus({ category })}`}
      />
    </div>
  );
};

export const AnnualCategoryAnalysis = ({ categories }) => {
  if (!categories.length) return null;
  return (
    <GlassCard padding="20px" className="annual-category-card">
      <div className="annual-section-heading"><h2>טבלת קטגוריות שנתית</h2></div>
      <div
        className="annual-category-table-wrap"
        role="region"
        tabIndex="0"
        aria-label="גלילת טבלת הקטגוריות השנתית"
      >
        <table className="annual-category-table">
          <caption className="u-sr-only">תקציב והוצאה שנתיים לפי קטגוריה</caption>
          <thead>
            <tr><th>קטגוריה</th><th>מתוכנן</th><th>בפועל</th><th>הפרש</th><th>ניצול</th></tr>
          </thead>
          <tbody>
            {categories.map((category, index) => (
              <tr key={category.category_id ?? index} className={`annual-category-row annual-category-row--${categoryTone(category)}`}>
                <th scope="row"><span aria-hidden="true">{category.icon || '🏷️'}</span><span>{category.name}</span></th>
                <td><AnnualMoneyAmount value={category.planned} /></td>
                <td className="annual-category-actual"><AnnualMoneyAmount value={category.actual} /></td>
                <td className={category.diff < 0 ? 'is-negative' : 'is-positive'}>
                  <span aria-hidden="true">{category.diff < 0 ? '−' : '+'}</span>
                  <AnnualMoneyAmount value={Math.abs(category.diff)} signed={false} />
                  <span className="u-sr-only">{category.diff < 0 ? 'חריגה' : 'נותר'}</span>
                </td>
                <td><CategoryProgress category={category} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="annual-category-mobile-list" role="list" tabIndex="0" aria-label="קטגוריות שנתיות">
        {categories.map((category, index) => (
          <article key={category.category_id ?? index} className={`annual-category-mobile annual-category-row--${categoryTone(category)}`} role="listitem">
            <header><span aria-hidden="true">{category.icon || '🏷️'}</span><strong>{category.name}</strong><span>{CategoryStatus({ category })}</span></header>
            <dl>
              <div><dt>מתוכנן</dt><dd><AnnualMoneyAmount value={category.planned} /></dd></div>
              <div><dt>בפועל</dt><dd><AnnualMoneyAmount value={category.actual} /></dd></div>
              <div><dt>{category.diff < 0 ? 'חריגה' : 'נותר'}</dt><dd className={category.diff < 0 ? 'is-negative' : 'is-positive'}><AnnualMoneyAmount value={Math.abs(category.diff)} /></dd></div>
            </dl>
            <CategoryProgress category={category} />
          </article>
        ))}
      </div>
    </GlassCard>
  );
};

export const AnnualBreakdownSection = ({
  open,
  breakdown,
  monthRange,
  onToggle,
  onRetry,
}) => (
  <GlassCard padding="20px" className="annual-breakdown-card">
    <div className="annual-breakdown-heading">
      <div>
        <h2>מטריצת קטגוריות לפי חודש</h2>
        <p>הפירוט נטען רק כשפותחים אותו. עמודת הקטגוריה נשארת נעוצה בזמן גלילה.</p>
      </div>
      <SecondaryButton type="button" onClick={onToggle} aria-expanded={open} aria-controls="annual-monthly-breakdown">
        {open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
        {open ? 'הסתרת פירוט' : 'הצגת פירוט חודשי'}
      </SecondaryButton>
    </div>
    <div id="annual-monthly-breakdown">
      {!open && (
        <div className="annual-breakdown-closed">
          <CalendarRange size={20} aria-hidden="true" />
          <span>פתח את הפירוט כדי לטעון את המטריצה החודשית.</span>
        </div>
      )}
      {open && breakdown.loading && (
        <div className="annual-breakdown-loading" role="status" aria-label="טעינת הפירוט החודשי">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} height={44} borderRadius="12px" />)}
        </div>
      )}
      {open && breakdown.error && (
        <Alert
          variant="error"
          urgent
          action={<button type="button" className="annual-inline-retry" onClick={onRetry}>ניסיון נוסף</button>}
        >
          {breakdown.error}
        </Alert>
      )}
      {open && !breakdown.loading && !breakdown.error && breakdown.data && (
        <>
          <div className="annual-matrix-scroll-hint"><ArrowLeftRight size={14} aria-hidden="true" />גלילה אופקית</div>
          <MonthlyBreakdownTable data={breakdown.data} monthRange={monthRange} />
        </>
      )}
    </div>
  </GlassCard>
);

export const AnnualSummarySkeleton = () => (
  <div className="annual-skeleton" role="status" aria-label="טעינת הסיכום השנתי">
    <div className="annual-skeleton__kpis">
      {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} height={100} borderRadius="18px" />)}
    </div>
    <div className="annual-skeleton__analysis">
      <Skeleton height={300} borderRadius="22px" />
      <Skeleton height={300} borderRadius="22px" />
    </div>
    <Skeleton height={260} borderRadius="22px" />
  </div>
);
