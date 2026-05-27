import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getTransactions, getAllLoans, getBudgetsByMonth, getCategories, getTasks } from '../../services/api';
import { isOverdue, PRIORITY_LABELS, PRIORITY_COLORS } from '../../utils/taskHelpers';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Wallet, TrendingUp, TrendingDown, DollarSign, PiggyBank, Bell, Plus } from 'lucide-react';
import { calculateSummaryStats, filterTransactionsByMonth, prepareMonthlyChartData } from '../../utils/dashboardHelpers';
import { Card, MoneyAmount, LiveChip, IconButton, CardHeader, ProgressBar, KPIHero, KPICard } from '../../components/ui';

const HEBREW_MONTHS_FULL = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

// Dashboard uses --info-soft for medium priority to distinguish it from the iris accents on the same card.
// Other priorities use the shared PRIORITY_COLORS bg values.
const DASHBOARD_PRIORITY_BG = {
  ...Object.fromEntries(Object.entries(PRIORITY_COLORS).map(([k, v]) => [k, v.bg])),
  medium: 'var(--info-soft)',
};

const Dashboard = () => {
  const [transactions, setTransactions] = useState([]);
  const [loans, setLoans] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const currentMonth = new Date().toISOString().slice(0, 7);
        const [transRes, loansRes, budgetsRes, catsRes, tasksRes] = await Promise.all([
          getTransactions(),
          getAllLoans().catch(() => ({ data: [] })),
          getBudgetsByMonth(currentMonth).catch(() => ({ data: [] })),
          getCategories(),
          getTasks().catch(() => ({ data: [] })),
        ]);
        setTransactions(transRes.data);
        setLoans(loansRes.data);
        setBudgets(budgetsRes.data);
        setCategories(catsRes.data);
        setTasks(tasksRes.data);
      } catch (error) {
        console.error('Error fetching dashboard data', error);
      } finally {
        setLoading(false);
        setLastUpdated(new Date());
      }
    };
    fetchData();
  }, []);

  const monthlyTransactions = useMemo(() => filterTransactionsByMonth(transactions, selectedMonth), [transactions, selectedMonth]);
  const stats = useMemo(() => calculateSummaryStats(monthlyTransactions), [monthlyTransactions]);
  const chartData = useMemo(() => prepareMonthlyChartData(transactions, 6), [transactions]);

  const monthOptions = useMemo(() => {
    const now = new Date();
    const options = [];
    for (let i = 0; i < 12; i++) {
      options.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
    }
    return options;
  }, []);

  const selectedMonthLabel = `${HEBREW_MONTHS_FULL[selectedMonth.getMonth()]} ${selectedMonth.getFullYear()}`;

  // Calculate budget progress - spending per category this month
  const budgetProgress = useMemo(() => {
    if (!budgets.length) return [];
    const expenseByCategory = {};
    monthlyTransactions.filter(t => t.movement_type === 'expense').forEach(t => {
      const catId = t.category_id;
      if (catId) {
        expenseByCategory[catId] = (expenseByCategory[catId] || 0) + Number(t.total_amount);
      }
    });

    return budgets.map(b => {
      const cat = categories.find(c => c.id === b.category_id);
      const spent = expenseByCategory[b.category_id] || 0;
      const budget = Number(b.amount);
      const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
      const remaining = budget - spent;
      return { id: b.id, name: cat?.name || 'כללי', icon: cat?.icon || '', spent, budget, pct, remaining };
    }).sort((a, b) => b.pct - a.pct);
  }, [budgets, monthlyTransactions, categories]);

  // Calculate total loan debt
  const totalDebt = useMemo(() => loans.reduce((s, l) => s + (Number(l.current_balance) || 0), 0), [loans]);

  // Task summary for widget
  const openTasks = useMemo(() => tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled'), [tasks]);
  const overdueTaskCount = useMemo(() => tasks.filter(isOverdue).length, [tasks]);
  const topDashTasks = useMemo(() => {
    const WEIGHT = { urgent: 0, high: 1, medium: 2, low: 3 };
    return [...openTasks]
      .sort((a, b) => {
        const aOver = isOverdue(a) ? 0 : 1;
        const bOver = isOverdue(b) ? 0 : 1;
        if (aOver !== bOver) return aOver - bOver;
        return (WEIGHT[a.priority] ?? 2) - (WEIGHT[b.priority] ?? 2);
      })
      .slice(0, 3);
  }, [openTasks]);

  if (loading) {
    return <div style={{ textAlign: 'center', marginTop: 80, color: 'var(--ink-3)', fontSize: 16 }}>טוען נתונים...</div>;
  }

  return (
    <div dir="rtl" style={{ display: 'flex', flexDirection: 'column' }}>

      {/* ─── Dashboard command header ─── */}
      <header style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        backgroundColor: 'var(--surface-1)',
        borderBlockEnd: '1px solid var(--border)',
        padding: '18px 28px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--s-16)',
        flexWrap: 'wrap',
      }}>

        {/* Right: brand identity mark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-10)', flexShrink: 0 }}>
          <div style={{
            height: 36, width: 36, flexShrink: 0,
            background: 'var(--primary-grad)',
            borderRadius: 'var(--r-8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 16px rgba(124,92,255,0.28)',
          }}>
            <Wallet size={17} color="white" />
          </div>
          <span style={{ fontSize: 'var(--fs-16)', fontWeight: 700, color: 'var(--ink-1)', letterSpacing: '-0.02em' }}>
            פיננסים.
          </span>
        </div>

        {/* Center: title + LIVE badge + subtitle */}
        <div style={{ textAlign: 'center', flex: '1 1 auto', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--s-8)', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 'var(--fs-20)', fontWeight: 700, color: 'var(--ink-1)', letterSpacing: '-0.015em' }}>
              סקירה כללית
            </h2>
            <LiveChip />
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 'var(--fs-13)', color: 'var(--ink-4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {selectedMonthLabel}
            {lastUpdated && (
              <span> · עודכן {lastUpdated.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</span>
            )}
          </p>
        </div>

        {/* Left: actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-8)', flexShrink: 0, flexWrap: 'wrap' }}>

          {/* Month selector — unchanged */}
          <select
            value={`${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}`}
            onChange={(e) => {
              const [yr, mo] = e.target.value.split('-');
              setSelectedMonth(new Date(Number(yr), Number(mo) - 1, 1));
            }}
            style={{
              padding: '8px 12px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-8)',
              fontSize: 'var(--fs-13)',
              backgroundColor: 'var(--surface-3)',
              color: 'var(--ink-2)',
              cursor: 'pointer',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          >
            {monthOptions.map(d => {
              const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              return (
                <option key={val} value={val}>
                  {HEBREW_MONTHS_FULL[d.getMonth()]} {d.getFullYear()}
                </option>
              );
            })}
          </select>

          {/* Notifications */}
          <IconButton size={38} title="התראות">
            <Bell size={16} color="var(--ink-3)" />
          </IconButton>

          {/* New transaction — Link styled via ui-btn-primary class to match PrimaryButton */}
          <Link
            to="/add"
            className="ui-btn-primary"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 'var(--s-6)',
              padding: '9px 18px',
              background: 'var(--primary-grad)',
              color: 'var(--primary-ink)',
              borderRadius: 'var(--r-8)',
              fontSize: 'var(--fs-14)', fontWeight: 600,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              boxShadow: '0 0 16px rgba(124,92,255,0.25)',
            }}
          >
            <Plus size={16} />
            תנועה חדשה
          </Link>
        </div>
      </header>

      {/* ─── Content ─── */}
      <div style={{ padding: 'var(--s-32)', maxWidth: 1280, margin: '0 auto', width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 'var(--s-32)' }}>

        {/* Summary Cards */}
        <section style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 'var(--s-24)' }}>
          <KPIHero label="יתרה נוכחית"  value={stats.balance}  icon={<Wallet size={14} />} />
          <KPICard label="הכנסות החודש" value={stats.income}   icon={<TrendingUp size={13} />}  accent="mint"  valueColor="var(--pos)" />
          <KPICard label="הוצאות החודש" value={stats.expenses} icon={<TrendingDown size={13} />} accent="coral" valueColor="var(--neg)" />
          <KPICard label="נטו לחיסכון"  value={stats.balance}  icon={<PiggyBank size={13} />}   accent="cyan" />
        </section>

        {/* Chart + Loans */}
        <section style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--s-24)' }}>

          {/* Trend chart */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--s-24)' }}>
              <h2 style={{ fontSize: 'var(--fs-16)', fontWeight: 700, color: 'var(--ink-1)', margin: 0 }}>מגמת הכנסות והוצאות</h2>
              <span style={{
                fontSize: 'var(--fs-12)', color: 'var(--ink-4)',
                backgroundColor: 'var(--surface-3)', padding: '4px 10px',
                borderRadius: 'var(--r-6)', border: '1px solid var(--border)',
              }}>
                6 חודשים אחרונים
              </span>
            </div>
            <div style={{ width: '100%', height: 280 }}>
              {chartData.some(d => d.income > 0 || d.expenses > 0) ? (
                <ResponsiveContainer>
                  <BarChart data={chartData} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--ink-5)" vertical={false} />
                    <XAxis
                      dataKey="name"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'var(--ink-4)', fontSize: 12 }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'var(--ink-4)', fontSize: 12 }}
                      tickFormatter={v => `₪${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      formatter={(value) => `₪${value.toLocaleString()}`}
                      contentStyle={{
                        backgroundColor: 'var(--surface-elev)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: 8,
                        color: 'var(--ink-1)',
                      }}
                      itemStyle={{ color: 'var(--ink-2)' }}
                      labelStyle={{ color: 'var(--ink-3)', marginBottom: 4 }}
                      cursor={{ fill: 'var(--border)' }}
                    />
                    <Bar dataKey="income" name="הכנסות" fill="var(--primary-hi)" radius={[4, 4, 0, 0]} barSize={14} />
                    <Bar dataKey="expenses" name="הוצאות" fill="var(--surface-3)" stroke="var(--border-strong)" strokeWidth={1} radius={[4, 4, 0, 0]} barSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--ink-4)' }}>
                  אין מספיק נתונים להצגה
                </div>
              )}
            </div>
          </Card>

          {/* Loan Status */}
          <Card style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--s-24)' }}>
              <h2 style={{ fontSize: 'var(--fs-16)', fontWeight: 700, color: 'var(--ink-1)', margin: 0 }}>סטטוס הלוואות</h2>
              <DollarSign size={20} color="var(--ink-4)" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-20)', flex: 1 }}>
              {/* Total debt summary */}
              <div style={{
                textAlign: 'center', padding: 'var(--s-16)',
                backgroundColor: 'var(--surface-3)', borderRadius: 'var(--r-12)',
                border: '1px solid var(--border-strong)',
              }}>
                <p style={{ fontSize: 'var(--fs-13)', color: 'var(--ink-3)', margin: '0 0 4px 0', fontWeight: 500 }}>יתרת חוב כוללת</p>
                <p className="num" style={{ fontSize: 'var(--fs-24)', fontWeight: 700, color: 'var(--ink-1)', margin: 0 }} dir="ltr">
                  ₪{totalDebt.toLocaleString()}
                </p>
              </div>

              {loans.length > 0 ? loans.slice(0, 3).map(loan => {
                const original = Number(loan.original_amount) || 1;
                const current  = Number(loan.current_balance) || 0;
                const paid     = original - current;
                const pct      = Math.round((paid / original) * 100);
                return (
                  <div key={loan.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-14)', marginBottom: 'var(--s-8)' }}>
                      <span style={{ fontWeight: 500, color: 'var(--ink-2)' }}>{loan.name}</span>
                      <span className="num" style={{ color: 'var(--ink-1)' }} dir="ltr">₪{Number(loan.monthly_payment).toLocaleString()} / חודש</span>
                    </div>
                    <ProgressBar value={pct} tone="primary" />
                    <p style={{ fontSize: 'var(--fs-12)', color: 'var(--ink-4)', margin: '6px 0 0 0', textAlign: 'start' }}>שולמו {pct}% מהקרן</p>
                  </div>
                );
              }) : (
                <p style={{ color: 'var(--ink-4)', textAlign: 'center', marginTop: 'var(--s-16)' }}>אין הלוואות פעילות</p>
              )}
            </div>
          </Card>
        </section>

        {/* Task Summary Widget */}
        <section>
          <Card>
            <CardHeader title="משימות פתוחות" action={{ to: '/tasks', label: 'לכל המשימות →' }} />
            {openTasks.length === 0 ? (
              <p style={{ color: 'var(--ink-4)', textAlign: 'center', padding: '12px 0', margin: 0 }}>אין משימות פתוחות</p>
            ) : (
              <div style={{ display: 'flex', gap: 'var(--s-24)', alignItems: 'flex-start' }}>
                {/* Stat pills */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-8)', flexShrink: 0 }}>
                  <div style={{
                    padding: '12px 20px', backgroundColor: 'var(--primary-soft)',
                    borderRadius: 'var(--r-12)', textAlign: 'center', minWidth: 72,
                    border: '1px solid rgba(124,92,255,0.2)',
                  }}>
                    <div className="num" style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-1)' }}>{openTasks.length}</div>
                    <div style={{ fontSize: 'var(--fs-12)', color: 'var(--ink-3)', marginTop: 2 }}>פתוחות</div>
                  </div>
                  {overdueTaskCount > 0 && (
                    <div style={{
                      padding: '12px 20px', backgroundColor: 'var(--neg-soft)',
                      borderRadius: 'var(--r-12)', textAlign: 'center', minWidth: 72,
                      border: '1px solid rgba(255,122,138,0.2)',
                    }}>
                      <div className="num" style={{ fontSize: 22, fontWeight: 700, color: 'var(--neg)' }}>{overdueTaskCount}</div>
                      <div style={{ fontSize: 'var(--fs-12)', color: 'var(--neg)', marginTop: 2 }}>באיחור</div>
                    </div>
                  )}
                </div>
                {/* Top tasks */}
                <div style={{ flex: 1 }}>
                  {topDashTasks.map((task, i) => {
                    const overdue  = isOverdue(task);
                    const dotColor = PRIORITY_COLORS[task.priority]?.color || 'var(--ink-5)';
                    return (
                      <div key={task.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '9px 0',
                        borderBottom: i < topDashTasks.length - 1 ? '1px solid var(--border)' : 'none',
                      }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, backgroundColor: dotColor }} />
                        <span style={{ flex: 1, fontSize: 'var(--fs-14)', color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {task.title}
                        </span>
                        <span style={{
                          fontSize: 'var(--fs-11)', fontWeight: 500, padding: '1px 7px', borderRadius: 9999, flexShrink: 0,
                          backgroundColor: DASHBOARD_PRIORITY_BG[task.priority] || 'var(--surface-3)',
                          color: PRIORITY_COLORS[task.priority]?.color || 'var(--ink-3)',
                        }}>
                          {PRIORITY_LABELS[task.priority]}
                        </span>
                        {task.due_date && (
                          <span style={{ fontSize: 'var(--fs-12)', color: overdue ? 'var(--neg)' : 'var(--ink-4)', whiteSpace: 'nowrap', fontWeight: overdue ? 600 : 400, marginInlineEnd: 4 }}>
                            {task.due_date}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>
        </section>

        {/* Recent Transactions + Budget */}
        <section style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 'var(--s-24)', alignItems: 'start' }}>

          {/* Recent Transactions */}
          <Card>
            <CardHeader
              title="תנועות אחרונות"
              action={{ to: '/transactions', label: 'לכל התנועות' }}
              style={{ marginBottom: 'var(--s-24)' }}
            />
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', textAlign: 'right', borderCollapse: 'collapse' }}>
                <thead style={{ fontSize: 'var(--fs-11)', color: 'var(--ink-4)', borderBottom: '1px solid var(--border)' }}>
                  <tr>
                    <th style={{ paddingBottom: 12, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase' }}>תאריך</th>
                    <th style={{ paddingBottom: 12, fontWeight: 500, paddingRight: 16, letterSpacing: '0.06em', textTransform: 'uppercase' }}>תיאור</th>
                    <th style={{ paddingBottom: 12, fontWeight: 500, paddingRight: 16, letterSpacing: '0.06em', textTransform: 'uppercase' }}>קטגוריה</th>
                    <th style={{ paddingBottom: 12, fontWeight: 500, textAlign: 'left', paddingLeft: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>סכום</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.slice(0, 5).map(t => {
                    const isIncome = t.movement_type === 'income';
                    const catName  = t.categories?.name || 'כללי';
                    return (
                      <tr key={t.id} className="tr-hover" style={{ transition: 'background-color 0.15s', borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '14px 0', fontSize: 'var(--fs-13)', color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>
                          {new Date(t.transaction_date).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                        <td style={{ padding: '14px 16px 14px 0', fontWeight: 500, color: 'var(--ink-2)', fontSize: 'var(--fs-14)' }}>
                          {t.description}
                        </td>
                        <td style={{ padding: '14px 16px 14px 0' }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '2px 8px', borderRadius: 'var(--r-6)',
                            fontSize: 'var(--fs-12)', fontWeight: 500,
                            backgroundColor: 'var(--surface-3)',
                            color: 'var(--ink-3)',
                            border: '1px solid var(--border)',
                          }}>
                            {t.categories?.icon} {catName}
                          </span>
                        </td>
                        <td className="num" style={{
                          padding: '14px 0 14px 8px', textAlign: 'left', fontWeight: 700,
                          fontSize: 'var(--fs-14)',
                          color: isIncome ? 'var(--pos)' : 'var(--neg)',
                        }} dir="ltr">
                          {isIncome ? '+' : '−'}₪{Number(t.total_amount).toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                  {transactions.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', padding: 32, color: 'var(--ink-4)' }}>
                        אין תנועות עדיין
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Budget Progress */}
          <Card>
            <CardHeader
              title="מצב תקציב חודשי"
              action={{ to: '/budget', label: 'לתקציב המלא' }}
              style={{ marginBottom: 'var(--s-24)' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-20)' }}>
              {budgetProgress.length > 0 ? budgetProgress.slice(0, 4).map(b => {
                const barTone    = b.pct >= 100 ? 'neg'         : b.pct >= 85 ? 'warn'         : 'pos';
                const hintColor  = b.pct >= 100 ? 'var(--neg)'  : b.pct >= 85 ? 'var(--warn)'  : 'var(--ink-4)';
                const amountColor = b.pct >= 100 ? 'var(--neg)' : b.pct >= 85 ? 'var(--warn)'  : 'var(--ink-2)';
                return (
                  <div key={b.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--s-8)', alignItems: 'baseline' }}>
                      <span style={{ fontWeight: 500, color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 'var(--s-6)', fontSize: 'var(--fs-14)' }}>
                        {b.icon} {b.name}
                      </span>
                      <span style={{ fontSize: 'var(--fs-13)', color: 'var(--ink-3)' }}>
                        <span className="num" style={{ fontWeight: 700, color: amountColor }} dir="ltr">₪{b.spent.toLocaleString()}</span>
                        {' '}מתוך{' '}
                        <span className="num" dir="ltr">₪{b.budget.toLocaleString()}</span>
                      </span>
                    </div>
                    <ProgressBar value={b.pct} tone={barTone} />
                    <p style={{ fontSize: 'var(--fs-12)', color: hintColor, fontWeight: b.pct >= 85 ? 500 : 400, margin: '5px 0 0 0', textAlign: 'start', paddingInlineStart: 4 }}>
                      {b.remaining >= 0 ? `נותרו ₪${b.remaining.toLocaleString()}` : `חריגה של ₪${Math.abs(b.remaining).toLocaleString()}`}
                    </p>
                  </div>
                );
              }) : (
                <p style={{ color: 'var(--ink-4)', textAlign: 'center' }}>לא הוגדר תקציב לחודש זה</p>
              )}
            </div>
          </Card>
        </section>

      </div>{/* end content wrapper */}
    </div>
  );
};


export default Dashboard;
