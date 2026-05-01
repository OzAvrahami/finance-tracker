import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getTransactions, getAllLoans, getBudgetsByMonth, getCategories, getTasks } from '../services/api';
import { isOverdue, STATUS_LABELS, PRIORITY_LABELS, PRIORITY_COLORS, CATEGORY_LABELS } from './Tasks';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Wallet, TrendingUp, TrendingDown, DollarSign, PiggyBank } from 'lucide-react';
import { calculateSummaryStats, filterTransactionsByMonth, prepareMonthlyChartData } from '../utils/dashboardHelpers';

const Dashboard = () => {
  const [transactions, setTransactions] = useState([]);
  const [loans, setLoans] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

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
      }
    };
    fetchData();
  }, []);

  const monthlyTransactions = useMemo(() => filterTransactionsByMonth(transactions), [transactions]);
  const stats = useMemo(() => calculateSummaryStats(monthlyTransactions), [monthlyTransactions]);
  const chartData = useMemo(() => prepareMonthlyChartData(transactions, 6), [transactions]);

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
    return <div style={{ textAlign: 'center', marginTop: 80, color: '#64748B', fontSize: 16 }}>טוען נתונים...</div>;
  }

  return (
    <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Summary Cards */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24 }}>
        <SummaryCard
          title="יתרה נוכחית"
          value={stats.balance}
          icon={<Wallet size={20} />}
          iconBg="#EFF6FF"
          iconColor="#2563EB"
        />
        <SummaryCard
          title="הכנסות החודש"
          value={stats.income}
          icon={<TrendingUp size={20} />}
          iconBg="#ECFDF5"
          iconColor="#059669"
        />
        <SummaryCard
          title="הוצאות החודש"
          value={stats.expenses}
          icon={<TrendingDown size={20} />}
          iconBg="#FFF1F2"
          iconColor="#E11D48"
        />
        <SummaryCard
          title="נטו לחיסכון"
          value={stats.balance}
          icon={<PiggyBank size={20} />}
          iconBg="#EEF2FF"
          iconColor="#4F46E5"
          valueColor="#4338CA"
        />
      </section>

      {/* Chart + Loans */}
      <section style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
        {/* Chart */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <h2 style={cardTitleStyle}>מגמת הכנסות והוצאות</h2>
            <span style={{ fontSize: 14, color: '#64748B', backgroundColor: '#F8F9FC', padding: '6px 12px', borderRadius: 8 }}>
              6 חודשים אחרונים
            </span>
          </div>
          <div style={{ width: '100%', height: 280 }}>
            {chartData.some(d => d.income > 0 || d.expenses > 0) ? (
              <ResponsiveContainer>
                <BarChart data={chartData} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 12 }} tickFormatter={v => `₪${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value) => `₪${value.toLocaleString()}`} />
                  <Bar dataKey="income" name="הכנסות" fill="#34D399" radius={[2, 2, 0, 0]} barSize={14} />
                  <Bar dataKey="expenses" name="הוצאות" fill="#FB7185" radius={[2, 2, 0, 0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8' }}>
                אין מספיק נתונים להצגה
              </div>
            )}
          </div>
        </div>

        {/* Loan Status */}
        <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <h2 style={cardTitleStyle}>סטטוס הלוואות</h2>
            <DollarSign size={20} color="#94A3B8" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24, flex: 1 }}>
            {/* Total debt */}
            <div style={{ textAlign: 'center', padding: 16, backgroundColor: '#EFF6FF', borderRadius: 12, border: '1px solid #DBEAFE' }}>
              <p style={{ fontSize: 14, color: '#1D4ED8', margin: '0 0 4px 0', fontWeight: 500 }}>יתרת חוב כוללת</p>
              <p style={{ fontSize: 24, fontWeight: 700, color: '#1E293B', margin: 0 }} dir="ltr">
                ₪{totalDebt.toLocaleString()}
              </p>
            </div>

            {loans.length > 0 ? loans.slice(0, 3).map(loan => {
              const original = Number(loan.original_amount) || 1;
              const current = Number(loan.current_balance) || 0;
              const paid = original - current;
              const pct = Math.round((paid / original) * 100);
              return (
                <div key={loan.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 8 }}>
                    <span style={{ fontWeight: 500, color: '#334155' }}>{loan.name}</span>
                    <span style={{ color: '#0F172A' }} dir="ltr">₪{Number(loan.monthly_payment).toLocaleString()} / חודש</span>
                  </div>
                  <div style={{ height: 12, backgroundColor: '#F1F5F9', borderRadius: 9999, overflow: 'hidden' }}>
                    <div style={{ height: '100%', backgroundColor: '#2563EB', width: `${pct}%`, borderRadius: 9999 }} />
                  </div>
                  <p style={{ fontSize: 12, color: '#64748B', margin: '8px 0 0 0', textAlign: 'left' }}>שולמו {pct}% מהקרן</p>
                </div>
              );
            }) : (
              <p style={{ color: '#94A3B8', textAlign: 'center', marginTop: 16 }}>אין הלוואות פעילות</p>
            )}
          </div>
        </div>
      </section>

      {/* Task Summary Widget */}
      <section>
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <h2 style={cardTitleStyle}>משימות פתוחות</h2>
            <Link to="/tasks" style={{ fontSize: 14, color: '#2563EB', fontWeight: 500, textDecoration: 'none' }}>
              לכל המשימות →
            </Link>
          </div>
          {openTasks.length === 0 ? (
            <p style={{ color: '#94A3B8', textAlign: 'center', padding: '12px 0', margin: 0 }}>אין משימות פתוחות</p>
          ) : (
            <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
              {/* Stat pills */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
                <div style={{ padding: '12px 20px', backgroundColor: '#EFF6FF', borderRadius: 12, textAlign: 'center', minWidth: 72 }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#1E293B' }}>{openTasks.length}</div>
                  <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>פתוחות</div>
                </div>
                {overdueTaskCount > 0 && (
                  <div style={{ padding: '12px 20px', backgroundColor: '#FEF2F2', borderRadius: 12, textAlign: 'center', minWidth: 72 }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#DC2626' }}>{overdueTaskCount}</div>
                    <div style={{ fontSize: 12, color: '#DC2626', marginTop: 2 }}>באיחור</div>
                  </div>
                )}
              </div>
              {/* Top tasks */}
              <div style={{ flex: 1 }}>
                {topDashTasks.map((task, i) => {
                  const overdue = isOverdue(task);
                  const dotColor = PRIORITY_COLORS[task.priority]?.color || '#CBD5E1';
                  return (
                    <div key={task.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 0',
                      borderBottom: i < topDashTasks.length - 1 ? '1px solid #F8FAFC' : 'none',
                    }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, backgroundColor: dotColor }} />
                      <span style={{ flex: 1, fontSize: 14, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {task.title}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 500, padding: '1px 7px', borderRadius: 9999, backgroundColor: PRIORITY_COLORS[task.priority]?.bg, color: PRIORITY_COLORS[task.priority]?.color, flexShrink: 0 }}>
                        {PRIORITY_LABELS[task.priority]}
                      </span>
                      {task.due_date && (
                        <span style={{ fontSize: 12, color: overdue ? '#DC2626' : '#94A3B8', whiteSpace: 'nowrap', fontWeight: overdue ? 600 : 400, marginRight: 4 }}>
                          {task.due_date}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Recent Transactions + Budget */}
      <section style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 24, alignItems: 'start' }}>
        {/* Recent Transactions */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <h2 style={cardTitleStyle}>תנועות אחרונות</h2>
            <Link to="/transactions" style={{ fontSize: 14, color: '#2563EB', fontWeight: 500, textDecoration: 'none' }}>
              לכל התנועות
            </Link>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', textAlign: 'right', borderCollapse: 'collapse' }}>
              <thead style={{ fontSize: 14, color: '#64748B', borderBottom: '1px solid #F1F5F9' }}>
                <tr>
                  <th style={{ paddingBottom: 12, fontWeight: 500 }}>תאריך</th>
                  <th style={{ paddingBottom: 12, fontWeight: 500, paddingRight: 16 }}>תיאור</th>
                  <th style={{ paddingBottom: 12, fontWeight: 500, paddingRight: 16 }}>קטגוריה</th>
                  <th style={{ paddingBottom: 12, fontWeight: 500, textAlign: 'left', paddingLeft: 8 }}>סכום</th>
                </tr>
              </thead>
              <tbody>
                {transactions.slice(0, 5).map(t => {
                  const isIncome = t.movement_type === 'income';
                  const catName = t.categories?.name || 'כללי';
                  const badgeColors = isIncome
                    ? { bg: '#ECFDF5', color: '#047857' }
                    : { bg: '#EEF2FF', color: '#4338CA' };
                  return (
                    <tr key={t.id} className="tr-hover" style={{ transition: 'background-color 0.2s', borderTop: '1px solid #F8F9FC' }}>
                      <td style={{ padding: '16px 0', fontSize: 14, color: '#475569', whiteSpace: 'nowrap' }}>
                        {new Date(t.transaction_date).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td style={{ padding: '16px 16px 16px 0', fontWeight: 500, color: '#1E293B' }}>
                        {t.description}
                      </td>
                      <td style={{ padding: '16px 16px 16px 0' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center',
                          padding: '2px 10px', borderRadius: 9999,
                          fontSize: 12, fontWeight: 500,
                          backgroundColor: badgeColors.bg, color: badgeColors.color,
                        }}>
                          {t.categories?.icon} {catName}
                        </span>
                      </td>
                      <td style={{
                        padding: '16px 0 16px 8px', textAlign: 'left', fontWeight: 700,
                        color: isIncome ? '#059669' : '#E11D48',
                      }} dir="ltr">
                        {isIncome ? '+' : '-'}₪{Number(t.total_amount).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
                {transactions.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: 32, color: '#94A3B8' }}>
                      אין תנועות עדיין
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Budget Progress */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <h2 style={cardTitleStyle}>מצב תקציב חודשי</h2>
            <Link to="/budget" style={{ fontSize: 14, color: '#2563EB', fontWeight: 500, textDecoration: 'none' }}>
              לתקציב המלא
            </Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {budgetProgress.length > 0 ? budgetProgress.slice(0, 4).map(b => {
              const barColor = b.pct >= 100 ? '#EF4444' : b.pct >= 85 ? '#F59E0B' : '#3B82F6';
              const textColor = b.pct >= 100 ? '#E11D48' : b.pct >= 85 ? '#D97706' : '#64748B';
              const amountColor = b.pct >= 100 ? '#BE123C' : b.pct >= 85 ? '#B45309' : '#0F172A';
              return (
                <div key={b.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'baseline' }}>
                    <span style={{ fontWeight: 500, color: '#1E293B', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {b.icon} {b.name}
                    </span>
                    <span style={{ fontSize: 14, color: '#475569' }}>
                      <span style={{ fontWeight: 700, color: amountColor }} dir="ltr">₪{b.spent.toLocaleString()}</span>
                      {' '}מתוך{' '}
                      <span dir="ltr">₪{b.budget.toLocaleString()}</span>
                    </span>
                  </div>
                  <div style={{ height: 16, backgroundColor: '#F1F5F9', borderRadius: 9999, overflow: 'hidden' }}>
                    <div style={{ height: '100%', backgroundColor: barColor, width: `${b.pct}%`, borderRadius: 9999 }} />
                  </div>
                  <p style={{ fontSize: 12, color: textColor, fontWeight: b.pct >= 85 ? 500 : 400, margin: '4px 0 0 0', textAlign: 'left', paddingLeft: 4 }}>
                    {b.remaining >= 0 ? `נותרו ₪${b.remaining.toLocaleString()}` : `חריגה של ₪${Math.abs(b.remaining).toLocaleString()}`}
                  </p>
                </div>
              );
            }) : (
              <p style={{ color: '#94A3B8', textAlign: 'center' }}>לא הוגדר תקציב לחודש זה</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

// --- Sub-components ---

const SummaryCard = ({ title, value, icon, iconBg, iconColor, valueColor = '#0F172A' }) => (
  <div style={{
    backgroundColor: 'white', padding: 24, borderRadius: 16,
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid #F1F5F9',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
      <h3 style={{ color: '#64748B', fontSize: 14, fontWeight: 500, margin: 0 }}>{title}</h3>
      <div style={{ padding: 8, backgroundColor: iconBg, borderRadius: 8, color: iconColor, display: 'flex' }}>
        {icon}
      </div>
    </div>
    <span style={{ fontSize: 30, fontWeight: 700, color: valueColor }} dir="ltr">
      ₪{value.toLocaleString()}
    </span>
  </div>
);

// --- Styles ---
const cardStyle = {
  backgroundColor: 'white', padding: 24, borderRadius: 16,
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid #F1F5F9',
};
const cardTitleStyle = { fontSize: 18, fontWeight: 700, color: '#1E293B', margin: 0 };

export default Dashboard;
