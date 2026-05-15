import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { AlertTriangle, Calendar } from 'lucide-react';
import { getAnnualBudgetSummary } from '../../services/api';

// ─── Formatting helpers ───────────────────────────────────────────────────────

const fmt = (n) =>
  `₪${Number(n || 0).toLocaleString('he-IL', { maximumFractionDigits: 0 })}`;

// ─── Sub-components ───────────────────────────────────────────────────────────

const KpiCard = ({ title, value, color, subtitle, badge, badgeColor }) => (
  <div style={kpiCardStyle}>
    <div style={{ fontSize: 13, color: '#64748B', marginBottom: 8, fontWeight: 500 }}>
      {title}
    </div>
    <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
    {subtitle && (
      <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>{subtitle}</div>
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
      <div style={{ fontSize: 12, fontWeight: 600, color: '#64748B', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: color || '#1E293B' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>{sub}</div>}
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    getAnnualBudgetSummary(selectedYear)
      .then(res => { if (!cancelled) setData(res.data); })
      .catch(() => { if (!cancelled) setError('שגיאה בטעינת הסיכום השנתי. נסה לרענן את הדף.'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [selectedYear]);

  // Year range: 2022 → next year
  const years = [];
  for (let y = 2022; y <= currentYear + 1; y++) years.push(y);

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderHeader = () => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1E293B', margin: 0 }}>סיכום שנתי</h2>
        <p style={{ color: '#64748B', fontSize: 13, marginTop: 4, marginBottom: 0 }}>
          סקירת תקציב והוצאות לשנה הנבחרת
        </p>
      </div>
      <select
        value={selectedYear}
        onChange={e => setSelectedYear(Number(e.target.value))}
        style={{ padding: '8px 16px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 15, cursor: 'pointer', background: 'white' }}
      >
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );

  if (loading) {
    return (
      <div dir="rtl">
        {renderHeader()}
        <div style={{ textAlign: 'center', padding: 64, color: '#64748B' }}>טוען סיכום שנתי...</div>
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
        <div style={{ textAlign: 'center', padding: 64, color: '#94A3B8', border: '2px dashed #E2E8F0', borderRadius: 12 }}>
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
        color: s.allowance_per_remaining_month >= 0 ? '#2563EB' : '#DC2626',
      }
    : {
        icon: '🔮',
        title: 'תחזית סוף שנה',
        value: s.months_with_data > 0 ? fmt(s.projected_year_end) : 'אין מספיק נתונים',
        sub: s.months_with_data > 0 ? `לפי ממוצע של ${fmt(s.monthly_average)} לחודש` : undefined,
        color: '#6366F1',
      };

  return (
    <div dir="rtl">
      {renderHeader()}

      {/* ── KPI cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
        <KpiCard
          title="תקציב שנתי"
          value={fmt(s.yearly_planned)}
          color="#2563EB"
        />
        <KpiCard
          title="הוצאות בפועל"
          value={fmt(s.yearly_actual)}
          color="#F59E0B"
        />
        <KpiCard
          title={isUnder ? 'יתרה' : 'חריגה'}
          value={fmt(Math.abs(s.remaining))}
          color={isUnder ? '#10B981' : '#EF4444'}
          badge={isUnder ? 'מתחת לתקציב' : 'מעל לתקציב'}
          badgeColor={isUnder ? '#10B981' : '#EF4444'}
        />
        <KpiCard
          title="הוצאות מתוקצבות"
          value={fmt(s.budgeted_expenses)}
          color="#6366F1"
        />
        <KpiCard
          title="הוצאות לא מתוקצבות"
          value={fmt(s.non_budgeted_expenses)}
          color="#F97316"
        />
        <KpiCard
          title="ממוצע חודשי"
          value={fmt(s.monthly_average)}
          color="#0EA5E9"
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
          color={isUnder ? '#059669' : '#DC2626'}
        />
        <InsightCard
          icon="📅"
          title="החודש הכי יקר"
          value={
            insights.mostExpensiveMonth?.actual > 0
              ? `${insights.mostExpensiveMonth.label}: ${fmt(insights.mostExpensiveMonth.actual)}`
              : 'אין נתונים'
          }
          color="#F59E0B"
        />
        <InsightCard
          icon="📊"
          title="הקטגוריה החורגת ביותר"
          value={
            insights.biggestOverrun
              ? `${insights.biggestOverrun.icon || ''} ${insights.biggestOverrun.name}: חריגה של ${fmt(Math.abs(insights.biggestOverrun.diff))}`
              : 'כל הקטגוריות בטווח התקציב'
          }
          color={insights.biggestOverrun ? '#DC2626' : '#059669'}
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
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 12, fill: '#64748B' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#64748B' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => v >= 1000 ? `₪${(v / 1000).toFixed(0)}k` : `₪${v}`}
            />
            <Tooltip
              formatter={(value, name) => [fmt(value), name]}
              contentStyle={{ direction: 'rtl', fontSize: 13 }}
            />
            <Legend wrapperStyle={{ fontSize: 13, paddingTop: 12 }} />
            <Bar dataKey="תקציב" fill="#3B82F6" radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Bar dataKey="בפועל" fill="#F59E0B" radius={[4, 4, 0, 0]} maxBarSize={28} />
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
            const barColor = cat.pct_used > 100 ? '#EF4444' : cat.pct_used > 70 ? '#F59E0B' : '#10B981';
            const pct      = Math.min(cat.pct_used, 100);
            return (
              <div
                key={cat.category_id ?? idx}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 0',
                  borderTop: '1px solid #F8FAFC',
                }}
              >
                <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{cat.icon || '🏷️'}</span>
                  <span style={{ fontWeight: 500, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {cat.name}
                  </span>
                </div>
                <div style={colStyle}>{fmt(cat.planned)}</div>
                <div style={colStyle}>{fmt(cat.actual)}</div>
                <div style={{ ...colStyle, fontWeight: 600, color: isOver ? '#DC2626' : '#059669' }}>
                  {isOver ? `-${fmt(Math.abs(cat.diff))}` : `+${fmt(cat.diff)}`}
                </div>
                <div style={{ width: 90, flexShrink: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: barColor, marginBottom: 3 }}>
                    {cat.pct_used}%
                  </div>
                  <div style={{ height: 4, background: '#F1F5F9', borderRadius: 9999, overflow: 'hidden' }}>
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
        <div style={{ ...sectionCardStyle, marginBottom: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ ...sectionTitleStyle, marginBottom: 0 }}>הוצאות לא מתוקצבות</h3>
            <span style={{ fontSize: 20, fontWeight: 700, color: '#F97316' }}>
              {fmt(data.non_budgeted.total)}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {data.non_budgeted.by_category.map((item, idx) => (
              <div
                key={item.category_id ?? idx}
                style={{
                  background: '#F8FAFC', borderRadius: 10, padding: '10px 14px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  border: '1px solid #F1F5F9',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon || '🏷️'}</span>
                  <span style={{ fontSize: 13, color: '#374151', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.name}
                  </span>
                </div>
                <span style={{ fontWeight: 700, color: '#F97316', fontSize: 13, flexShrink: 0, marginRight: 8 }}>
                  {fmt(item.total)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const kpiCardStyle = {
  background: 'white', borderRadius: 16, padding: 20,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: '1px solid #F1F5F9',
};

const insightCardStyle = {
  background: 'white', borderRadius: 12, padding: 20,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: '1px solid #F1F5F9',
  display: 'flex', gap: 14, alignItems: 'flex-start',
};

const sectionCardStyle = {
  background: 'white', borderRadius: 16, padding: 24,
  marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: '1px solid #F1F5F9',
};

const sectionTitleStyle = {
  margin: '0 0 20px', fontSize: 16, fontWeight: 700, color: '#1E293B',
};

const errorBannerStyle = {
  background: '#FEF2F2', border: '1px solid #FECACA',
  borderRadius: 8, padding: '12px 16px', color: '#B91C1C', fontSize: 13,
};

const warningBannerStyle = {
  display: 'flex', alignItems: 'center', gap: 8,
  background: '#FEFCE8', border: '1px solid #FEF08A',
  borderRadius: 8, padding: '10px 14px', marginBottom: 20,
  color: '#854D0E', fontSize: 13,
};

const tableHeaderStyle = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '0 0 10px', borderBottom: '2px solid #F1F5F9', marginBottom: 4,
  fontSize: 12, fontWeight: 600, color: '#64748B',
};

const colStyle = { width: 100, flexShrink: 0, color: '#475569', fontSize: 14 };

export default AnnualSummary;
