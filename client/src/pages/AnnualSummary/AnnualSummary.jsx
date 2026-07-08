import React, { useState, useEffect, useContext } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { AlertTriangle, Calendar } from 'lucide-react';
import { getAnnualBudgetSummary, getMonthlyCategoryBreakdown } from '../../services/api';
import MonthlyBreakdownTable from './MonthlyBreakdownTable';
import { PageHeaderContext } from '../../context/PageHeaderContext';

// ─── Formatting helpers ───────────────────────────────────────────────────────

const fmt = (n) =>
  `₪${Number(n || 0).toLocaleString('he-IL', { maximumFractionDigits: 0 })}`;

// ─── Sub-components ───────────────────────────────────────────────────────────

const KpiCard = ({ title, value, color, subtitle, badge, badgeColor }) => (
  <div style={kpiCardStyle}>
    <div style={{ fontSize: 13, color: 'var(--ink-4)', marginBottom: 8, fontWeight: 500 }}>
      {title}
    </div>
    <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
    {subtitle && (
      <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 4 }}>{subtitle}</div>
    )}
    {badge && (
      <span style={{
        fontSize: 11, fontWeight: 600, color: badgeColor,
        background: `${badgeColor}18`, borderRadius: 9999,
        padding: '2px 10px', display: 'inline-block', marginTop: 6,
      }}>
        {badge}
      </span>
    )}
  </div>
);

const InsightCard = ({ icon, title, value, sub, color }) => (
  <div style={insightCardStyle}>
    <span style={{ fontSize: 26, lineHeight: 1, flexShrink: 0 }}>{icon}</span>
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-4)', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: color || 'var(--ink-1)' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 2 }}>{sub}</div>}
    </div>
  </div>
);

// ─── Insight computation ──────────────────────────────────────────────────────

function buildInsights(data) {
  const mostExpensiveMonth = data.monthly.reduce(
    (best, m) => (m.actual > (best?.actual || 0) ? m : best),
    null,
  );

  const biggestOverrun = data.categories
    .filter(c => c.diff < 0)
    .sort((a, b) => a.diff - b.diff)[0] || null;

  return { mostExpensiveMonth, biggestOverrun };
}

// ─── Main component ───────────────────────────────────────────────────────────

const AnnualSummary = () => {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Drill-down state
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [breakdownData, setBreakdownData] = useState(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [breakdownError, setBreakdownError] = useState(null);
  const [monthRange, setMonthRange] = useState('3');
  
  const { setPageHeader } = useContext(PageHeaderContext);

  useEffect(() => {
    setPageHeader({
      title: 'דוחות וסיכום שנתי',
      subtitle: 'ניתוח מגמות והשוואות שנתיות',
    });
  }, [setPageHeader]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    // Reset drill-down when year changes
    setShowBreakdown(false);
    setBreakdownData(null);
    setBreakdownError(null);
    setMonthRange('3');

    getAnnualBudgetSummary(selectedYear)
      .then(res => { if (!cancelled) setData(res.data); })
      .catch(() => { if (!cancelled) setError('שגיאה בטעינת הסיכום השנתי. נסה לרענן את הדף.'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [selectedYear]);

  const handleToggleBreakdown = () => {
    if (!showBreakdown && !breakdownData) {
      setBreakdownLoading(true);
      setBreakdownError(null);
      getMonthlyCategoryBreakdown(selectedYear)
        .then(res => setBreakdownData(res.data))
        .catch(() => setBreakdownError('שגיאה בטעינת הפירוט החודשי. נסה שנית.'))
        .finally(() => setBreakdownLoading(false));
    }
    setShowBreakdown(v => !v);
  };

  // Year range: 2022 → next year
  const years = [];
  for (let y = 2022; y <= currentYear + 1; y++) years.push(y);

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderHeader = () => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-1)', margin: 0 }}>סיכום שנתי</h2>
        <p style={{ color: 'var(--ink-4)', fontSize: 13, marginTop: 4, marginBottom: 0 }}>
          סקירת תקציב והוצאות לשנה הנבחרת
        </p>
      </div>
      <select
        value={selectedYear}
        onChange={e => setSelectedYear(Number(e.target.value))}
        style={{ padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 15, cursor: 'pointer', background: 'var(--surface-3)', color: 'var(--ink-1)' }}
      >
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );

  if (loading) {
    return (
      <div dir="rtl">
        {renderHeader()}
        <div style={{ textAlign: 'center', padding: 64, color: 'var(--ink-4)' }}>טוען סיכום שנתי...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div dir="rtl">
        {renderHeader()}
        <div style={errorBannerStyle}>{error}</div>
      </div>
    );
  }

  const isEmpty = data.summary.yearly_planned === 0 && data.summary.yearly_actual === 0;

  if (isEmpty) {
    return (
      <div dir="rtl">
        {renderHeader()}
        <div style={{ textAlign: 'center', padding: 64, color: 'var(--ink-4)', border: '2px dashed var(--border)', borderRadius: 12 }}>
          <Calendar size={40} style={{ marginBottom: 12 }} />
          <p style={{ margin: '0 0 6px', fontSize: 16 }}>אין נתונים לשנת {selectedYear}</p>
          <p style={{ margin: 0, fontSize: 13 }}>הגדר תקציבים חודשיים והוסף עסקאות כדי לראות את הסיכום השנתי.</p>
        </div>
      </div>
    );
  }

  const s = data.summary;
  const isUnder = s.remaining >= 0;
  const insights = buildInsights(data);

  const chartData = data.monthly.map(m => ({
    name: m.label.slice(0, 3),
    תקציב: m.planned,
    בפועל: m.actual,
  }));

  // Insight #4: allowance if months remaining, otherwise projected year-end
  const insight4 = s.allowance_per_remaining_month !== null
    ? {
        icon: '💡',
        title: 'תקציב ממוצע לחודש נותר',
        value: fmt(s.allowance_per_remaining_month),
        sub: 'כדי לעמוד בתקציב השנתי',
        color: s.allowance_per_remaining_month >= 0 ? 'var(--primary-hi)' : 'var(--neg)',
      }
    : {
        icon: '🔮',
        title: 'תחזית סוף שנה',
        value: s.months_with_data > 0 ? fmt(s.projected_year_end) : 'אין מספיק נתונים',
        sub: s.months_with_data > 0 ? `לפי ממוצע של ${fmt(s.monthly_average)} לחודש` : undefined,
        color: 'var(--primary-hi)',
      };

  return (
    <div dir="rtl">
      {renderHeader()}

      {/* ── KPI cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
        <KpiCard
          title="תקציב שנתי"
          value={fmt(s.yearly_planned)}
          color="var(--primary-hi)"
        />
        <KpiCard
          title="הוצאות בפועל"
          value={fmt(s.yearly_actual)}
          color="var(--warn)"
        />
        <KpiCard
          title={isUnder ? 'יתרה' : 'חריגה'}
          value={fmt(Math.abs(s.remaining))}
          color={isUnder ? 'var(--pos)' : 'var(--neg)'}
          badge={isUnder ? 'מתחת לתקציב' : 'מעל לתקציב'}
          badgeColor={isUnder ? 'var(--pos)' : 'var(--neg)'}
        />
        <KpiCard
          title="הוצאות מתוקצבות"
          value={fmt(s.budgeted_expenses)}
          color="var(--primary-hi)"
        />
        <KpiCard
          title="הוצאות לא מתוקצבות"
          value={fmt(s.non_budgeted_expenses)}
          color="var(--warn)"
        />
        <KpiCard
          title="ממוצע חודשי"
          value={fmt(s.monthly_average)}
          color="var(--info)"
          subtitle={`מבוסס על ${s.months_with_data} חודשים עם הוצאות`}
        />
      </div>

      {/* ── Sparse budget warning ── */}
      {s.months_with_budget > 0 && s.months_with_budget < 12 && (
        <div style={warningBannerStyle}>
          <AlertTriangle size={15} style={{ flexShrink: 0 }} />
          התקציב השנתי מחושב רק לפי חודשים שבהם הוגדר תקציב: {s.months_with_budget} מתוך 12 חודשים.
        </div>
      )}

      {/* ── Insights ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 28 }}>
        <InsightCard
          icon={isUnder ? '✅' : '⚠️'}
          title="מצב שנתי"
          value={
            isUnder
              ? `מתחת לתקציב ב-${fmt(s.remaining)}`
              : `חריגה מהתקציב ב-${fmt(Math.abs(s.remaining))}`
          }
          color={isUnder ? 'var(--pos)' : 'var(--neg)'}
        />
        <InsightCard
          icon="📅"
          title="החודש הכי יקר"
          value={
            insights.mostExpensiveMonth?.actual > 0
              ? `${insights.mostExpensiveMonth.label}: ${fmt(insights.mostExpensiveMonth.actual)}`
              : 'אין נתונים'
          }
          color="var(--warn)"
        />
        <InsightCard
          icon="📊"
          title="הקטגוריה החורגת ביותר"
          value={
            insights.biggestOverrun
              ? `${insights.biggestOverrun.icon || ''} ${insights.biggestOverrun.name}: חריגה של ${fmt(Math.abs(insights.biggestOverrun.diff))}`
              : 'כל הקטגוריות בטווח התקציב'
          }
          color={insights.biggestOverrun ? 'var(--neg)' : 'var(--pos)'}
        />
        <InsightCard
          icon={insight4.icon}
          title={insight4.title}
          value={insight4.value}
          sub={insight4.sub}
          color={insight4.color}
        />
      </div>

      {/* ── Monthly chart ── */}
      <div style={sectionCardStyle}>
        <h3 style={sectionTitleStyle}>פירוט חודשי — תקציב מול בפועל</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData} barCategoryGap="30%" barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--ink-5)" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 12, fill: 'var(--ink-4)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--ink-4)' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => v >= 1000 ? `₪${(v / 1000).toFixed(0)}k` : `₪${v}`}
            />
            <Tooltip
              formatter={(value, name) => [fmt(value), name]}
              contentStyle={{ direction: 'rtl', fontSize: 13, backgroundColor: 'var(--surface-elev)', border: '1px solid var(--border-strong)', color: 'var(--ink-1)' }}
            />
            <Legend wrapperStyle={{ fontSize: 13, paddingTop: 12 }} />
            <Bar dataKey="תקציב" fill="var(--primary-hi)" radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Bar dataKey="בפועל" fill="var(--warn)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Category breakdown ── */}
      {data.categories.length > 0 && (
        <div style={sectionCardStyle}>
          <h3 style={sectionTitleStyle}>פירוט לפי קטגוריה</h3>

          {/* Header row */}
          <div style={tableHeaderStyle}>
            <div style={{ flex: '1 1 auto' }}>קטגוריה</div>
            <div style={colStyle}>תקציב שנתי</div>
            <div style={colStyle}>בפועל</div>
            <div style={colStyle}>הפרש</div>
            <div style={{ width: 90, flexShrink: 0 }}>ניצול %</div>
          </div>

          {data.categories.map((cat, idx) => {
            const isOver   = cat.diff < 0;
            const barColor = cat.pct_used > 100 ? 'var(--neg)' : cat.pct_used > 70 ? 'var(--warn)' : 'var(--pos)';
            const pct      = Math.min(cat.pct_used, 100);
            return (
              <div
                key={cat.category_id ?? idx}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 0',
                  borderTop: '1px solid var(--border)',
                }}
              >
                <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{cat.icon || '🏷️'}</span>
                  <span style={{ fontWeight: 500, color: 'var(--ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {cat.name}
                  </span>
                </div>
                <div style={colStyle}>{fmt(cat.planned)}</div>
                <div style={colStyle}>{fmt(cat.actual)}</div>
                <div style={{ ...colStyle, fontWeight: 600, color: isOver ? 'var(--neg)' : 'var(--pos)' }}>
                  {isOver ? `-${fmt(Math.abs(cat.diff))}` : `+${fmt(cat.diff)}`}
                </div>
                <div style={{ width: 90, flexShrink: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: barColor, marginBottom: 3 }}>
                    {cat.pct_used}%
                  </div>
                  <div style={{ height: 4, background: 'var(--surface-3)', borderRadius: 9999, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 9999 }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Non-budgeted section ── */}
      {data.non_budgeted.total > 0 && (
        <div style={sectionCardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ ...sectionTitleStyle, marginBottom: 0 }}>הוצאות לא מתוקצבות</h3>
            <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--warn)' }}>
              {fmt(data.non_budgeted.total)}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {data.non_budgeted.by_category.map((item, idx) => (
              <div
                key={item.category_id ?? idx}
                style={{
                  background: 'var(--surface-3)', borderRadius: 10, padding: '10px 14px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  border: '1px solid var(--border)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon || '🏷️'}</span>
                  <span style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.name}
                  </span>
                </div>
                <span style={{ fontWeight: 700, color: 'var(--warn)', fontSize: 13, flexShrink: 0, marginRight: 8 }}>
                  {fmt(item.total)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Monthly breakdown drill-down ── */}
      <div style={{ ...sectionCardStyle, marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ ...sectionTitleStyle, marginBottom: 0 }}>פירוט תקציב חודשי לפי קטגוריה</h3>
            {!showBreakdown && (
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink-4)' }}>
                ניתוח ביצועים לפי קטגוריה וחודש לאורך השנה
              </p>
            )}
          </div>
          <button
            onClick={handleToggleBreakdown}
            style={{
              padding: '8px 18px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              background: showBreakdown ? 'var(--surface-3)' : 'var(--primary-hi)',
              color: showBreakdown ? 'var(--ink-2)' : '#fff',
              flexShrink: 0,
            }}
          >
            {showBreakdown ? 'הסתר פירוט חודשי לפי קטגוריה ▲' : 'הצג פירוט חודשי לפי קטגוריה ▼'}
          </button>
        </div>

        {showBreakdown && (
          <div style={{ marginTop: 20 }}>
            {breakdownLoading && (
              <div style={{ textAlign: 'center', padding: 32, color: 'var(--ink-4)' }}>טוען פירוט...</div>
            )}
            {breakdownError && (
              <div style={errorBannerStyle}>{breakdownError}</div>
            )}
            {!breakdownLoading && !breakdownError && breakdownData && (
              <MonthlyBreakdownTable
                data={breakdownData}
                monthRange={monthRange}
                onMonthRangeChange={setMonthRange}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const kpiCardStyle = {
  background: 'var(--surface-2)', borderRadius: 16, padding: 20,
  border: '1px solid var(--border)',
};

const insightCardStyle = {
  background: 'var(--surface-2)', borderRadius: 12, padding: 20,
  border: '1px solid var(--border)',
  display: 'flex', gap: 14, alignItems: 'flex-start',
};

const sectionCardStyle = {
  background: 'var(--surface-2)', borderRadius: 16, padding: 24,
  marginBottom: 24, border: '1px solid var(--border)',
};

const sectionTitleStyle = {
  margin: '0 0 20px', fontSize: 16, fontWeight: 700, color: 'var(--ink-1)',
};

const errorBannerStyle = {
  background: 'var(--neg-soft)', border: '1px solid var(--neg)',
  borderRadius: 8, padding: '12px 16px', color: 'var(--neg)', fontSize: 13,
};

const warningBannerStyle = {
  display: 'flex', alignItems: 'center', gap: 8,
  background: 'var(--warn-soft)', border: '1px solid var(--warn)',
  borderRadius: 8, padding: '10px 14px', marginBottom: 20,
  color: 'var(--warn)', fontSize: 13,
};

const tableHeaderStyle = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '0 0 10px', borderBottom: '2px solid var(--border)', marginBottom: 4,
  fontSize: 12, fontWeight: 600, color: 'var(--ink-4)',
};

const colStyle = { width: 100, flexShrink: 0, color: 'var(--ink-3)', fontSize: 14 };

export default AnnualSummary;
