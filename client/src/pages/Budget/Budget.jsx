import React, { useState, useEffect, useMemo } from 'react';
import { Pencil, Trash2, Copy, Plus, TrendingDown, TrendingUp, AlertTriangle } from 'lucide-react';
import { getBudgetsByMonth, upsertBudget, copyBudget, deleteBudget, getCategories } from '../../services/api';

const Budget = () => {
  const currentMonth = new Date().toISOString().slice(0, 7); // '2026-02'
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [budgets, setBudgets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editAmount, setEditAmount] = useState('');
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [showAddRow, setShowAddRow] = useState(false);
  const [newCategoryId, setNewCategoryId] = useState('');
  const [newAmount, setNewAmount] = useState('');

  useEffect(() => {
    fetchCategories();
  }, []);

  useEffect(() => {
    fetchBudgets();
  }, [selectedMonth]);

  const fetchCategories = async () => {
    try {
      const res = await getCategories();
      setCategories(res.data);
    } catch (e) {
      console.error('Error fetching categories:', e);
    }
  };

  const fetchBudgets = async () => {
    setLoading(true);
    try {
      const res = await getBudgetsByMonth(selectedMonth);
      setBudgets(res.data);
    } catch (e) {
      console.error('Error fetching budgets:', e);
    } finally {
      setLoading(false);
    }
  };

  // Summary calculations
  const summary = useMemo(() => {
    const totalBudget = budgets.reduce((sum, b) => sum + Number(b.amount), 0);
    const totalSpent = budgets.reduce((sum, b) => sum + Number(b.actual_spent), 0);
    return {
      totalBudget,
      totalSpent,
      remaining: totalBudget - totalSpent
    };
  }, [budgets]);

  // Insights
  const insights = useMemo(() => {
    const withDiff = budgets.map(b => ({
      ...b,
      diff: Number(b.amount) - Number(b.actual_spent)
    }));

    const overBudget = withDiff
      .filter(b => b.diff < 0)
      .sort((a, b) => a.diff - b.diff)
      .slice(0, 3);

    const underUtilized = withDiff
      .filter(b => b.diff > 0 && Number(b.amount) > 0)
      .sort((a, b) => b.diff - a.diff)
      .slice(0, 3);

    return { overBudget, underUtilized };
  }, [budgets]);

  // Categories not yet budgeted this month
  const availableCategories = useMemo(() => {
    const budgetedIds = new Set(budgets.map(b => b.category_id));
    return categories.filter(c => !budgetedIds.has(c.id) && c.type === 'expense');
  }, [categories, budgets]);

  const handleAdd = async () => {
    if (!newCategoryId || !newAmount) return;
    try {
      await upsertBudget({ category_id: Number(newCategoryId), month: selectedMonth, amount: Number(newAmount) });
      setNewCategoryId('');
      setNewAmount('');
      setShowAddRow(false);
      fetchBudgets();
    } catch (e) {
      console.error('Error adding budget:', e);
    }
  };

  const handleEdit = async (budgetRow) => {
    try {
      await upsertBudget({ category_id: budgetRow.category_id, month: selectedMonth, amount: Number(editAmount) });
      setEditingId(null);
      setEditAmount('');
      fetchBudgets();
    } catch (e) {
      console.error('Error updating budget:', e);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteBudget(id);
      fetchBudgets();
    } catch (e) {
      console.error('Error deleting budget:', e);
    }
  };

  const getProgressColor = (percent) => {
    if (percent > 100) return 'var(--neg)';
    if (percent >= 70) return 'var(--warn)';
    return 'var(--pos)';
  };

  const formatMonth = (monthStr) => {
    const [y, m] = monthStr.split('-');
    const months = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
    return `${months[Number(m) - 1]} ${y}`;
  };

  return (
    <div dir="rtl" style={pageStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div>
          <h1 style={{ margin: 0, fontSize: '2rem', color: 'var(--ink-1)' }}>תקציב חודשי</h1>
          <p style={{ color: 'var(--ink-4)', marginTop: '5px' }}>{formatMonth(selectedMonth)}</p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            style={monthInputStyle}
          />
          <button onClick={() => setShowCopyModal(true)} style={copyBtnStyle}>
            <Copy size={18} /> העתק תקציב
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={summaryGridStyle}>
        <SummaryCard
          title="תקציב החודש"
          value={summary.totalBudget}
          color="var(--primary-hi)"
          icon={<TrendingUp size={24} />}
        />
        <SummaryCard
          title="בוצע בפועל"
          value={summary.totalSpent}
          color="var(--warn)"
          icon={<TrendingDown size={24} />}
        />
        <SummaryCard
          title={summary.remaining >= 0 ? 'יתרה' : 'חריגה'}
          value={Math.abs(summary.remaining)}
          color={summary.remaining >= 0 ? 'var(--pos)' : 'var(--neg)'}
          icon={<AlertTriangle size={24} />}
        />
      </div>

      {/* Budget Table */}
      <div style={tableContainerStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '1.3rem', color: 'var(--ink-1)' }}>פירוט תקציב</h2>
          <button onClick={() => setShowAddRow(true)} style={addBtnStyle}>
            <Plus size={18} /> הוסף קטגוריה
          </button>
        </div>

        {showAddRow && (
          <div style={addRowStyle}>
            <select
              value={newCategoryId}
              onChange={(e) => setNewCategoryId(e.target.value)}
              style={{ ...inputStyle, flex: 2 }}
            >
              <option value="">בחר קטגוריה</option>
              {availableCategories.map(c => (
                <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
              ))}
            </select>
            <input
              type="number"
              placeholder="סכום תקציב"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button onClick={handleAdd} style={saveBtnStyle}>הוסף</button>
            <button onClick={() => { setShowAddRow(false); setNewCategoryId(''); setNewAmount(''); }} style={cancelBtnStyle}>ביטול</button>
          </div>
        )}

        {loading ? (
          <p style={{ textAlign: 'center', color: 'var(--ink-4)' }}>...טוען</p>
        ) : budgets.length === 0 ? (
          <div style={emptyStyle}>
            אין תקציב מוגדר לחודש זה. לחץ "הוסף קטגוריה" כדי להתחיל.
          </div>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>קטגוריה</th>
                <th style={thStyle}>תקציב</th>
                <th style={thStyle}>בוצע</th>
                <th style={thStyle}>נשאר / חריגה</th>
                <th style={{ ...thStyle, width: '180px' }}>ניצול</th>
                <th style={{ ...thStyle, width: '80px' }}>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {budgets.map(b => {
                const budget = Number(b.amount);
                const spent = Number(b.actual_spent);
                const remaining = budget - spent;
                const percent = budget > 0 ? Math.round((spent / budget) * 100) : 0;
                const isEditing = editingId === b.id;

                return (
                  <tr key={b.id} style={trStyle}>
                    <td style={tdStyle}>
                      <span style={{ marginLeft: '8px' }}>{b.categories?.icon}</span>
                      {b.categories?.name}
                    </td>
                    <td style={tdStyle}>
                      {isEditing ? (
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <input
                            type="number"
                            value={editAmount}
                            onChange={(e) => setEditAmount(e.target.value)}
                            style={{ ...inputStyle, width: '100px', marginBottom: 0 }}
                            autoFocus
                          />
                          <button onClick={() => handleEdit(b)} style={saveBtnSmall}>שמור</button>
                          <button onClick={() => setEditingId(null)} style={cancelBtnSmall}>X</button>
                        </div>
                      ) : (
                        <span className="num">₪{budget.toLocaleString()}</span>
                      )}
                    </td>
                    <td style={tdStyle}><span className="num">₪{spent.toLocaleString()}</span></td>
                    <td style={{ ...tdStyle, color: remaining >= 0 ? 'var(--pos)' : 'var(--neg)', fontWeight: '600' }}>
                      <span className="num">
                        {remaining >= 0 ? `₪${remaining.toLocaleString()}` : `−₪${Math.abs(remaining).toLocaleString()}`}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={progressBgStyle}>
                          <div style={{
                            width: `${Math.min(percent, 100)}%`,
                            height: '100%',
                            backgroundColor: getProgressColor(percent),
                            borderRadius: '4px',
                            transition: 'width 0.3s ease'
                          }} />
                        </div>
                        <span className="num" style={{ fontSize: '0.8rem', color: 'var(--ink-4)', minWidth: '35px' }}>{percent}%</span>
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          onClick={() => { setEditingId(b.id); setEditAmount(String(budget)); }}
                          style={iconBtnStyle}
                          title="ערוך"
                        >
                          <Pencil size={15} color="#9B82FF" />
                        </button>
                        <button
                          onClick={() => handleDelete(b.id)}
                          style={iconBtnStyle}
                          title="מחק"
                        >
                          <Trash2 size={15} color="#FF7A8A" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Insights */}
      {budgets.length > 0 && (
        <div style={insightsContainerStyle}>
          <h2 style={{ margin: '0 0 20px', fontSize: '1.3rem', color: 'var(--ink-1)' }}>חריגות והמלצות</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            {/* Over budget */}
            <div style={insightCardStyle}>
              <h3 style={{ margin: '0 0 12px', color: 'var(--neg)', fontSize: '1rem' }}>חריגות מהתקציב</h3>
              {insights.overBudget.length === 0 ? (
                <p style={{ color: 'var(--ink-4)', fontSize: '0.9rem' }}>אין חריגות - כל הכבוד!</p>
              ) : (
                insights.overBudget.map(b => (
                  <div key={b.id} style={insightRowStyle}>
                    <span>{b.categories?.icon} {b.categories?.name}</span>
                    <span className="num" style={{ color: 'var(--neg)', fontWeight: '600' }}>
                      −₪{Math.abs(b.diff).toLocaleString()}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Under utilized */}
            <div style={insightCardStyle}>
              <h3 style={{ margin: '0 0 12px', color: 'var(--pos)', fontSize: '1rem' }}>לא נוצלו</h3>
              {insights.underUtilized.length === 0 ? (
                <p style={{ color: 'var(--ink-4)', fontSize: '0.9rem' }}>כל התקציבים נוצלו</p>
              ) : (
                insights.underUtilized.map(b => (
                  <div key={b.id} style={insightRowStyle}>
                    <span>{b.categories?.icon} {b.categories?.name}</span>
                    <span className="num" style={{ color: 'var(--pos)', fontWeight: '600' }}>
                      ₪{b.diff.toLocaleString()} נשאר
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Copy Budget Modal */}
      {showCopyModal && (
        <CopyBudgetModal
          currentMonth={selectedMonth}
          onClose={() => setShowCopyModal(false)}
          onSuccess={() => { setShowCopyModal(false); fetchBudgets(); }}
        />
      )}
    </div>
  );
};

// Summary Card Component
const SummaryCard = ({ title, value, color, icon }) => (
  <div style={{
    backgroundColor: 'var(--surface-2)',
    borderRadius: 'var(--r-12)',
    padding: 'var(--s-20)',
    boxShadow: 'var(--shadow-sm)',
    border: '1px solid var(--border)',
  }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <p style={{ margin: 0, color: 'var(--ink-3)', fontSize: '0.9rem' }}>{title}</p>
        <p className="num" style={{ margin: '8px 0 0', fontSize: '1.6rem', fontWeight: 'bold', color }}>
          ₪{value.toLocaleString()}
        </p>
      </div>
      <div style={{ color, opacity: 0.5 }}>{icon}</div>
    </div>
  </div>
);

// Copy Budget Modal
const CopyBudgetModal = ({ currentMonth, onClose, onSuccess }) => {
  const [targetMonth, setTargetMonth] = useState('');
  const [copying, setCopying] = useState(false);

  const handleCopy = async () => {
    if (!targetMonth) return;
    setCopying(true);
    try {
      await copyBudget({ fromMonth: currentMonth, toMonth: targetMonth });
      onSuccess();
    } catch (e) {
      console.error('Copy error:', e);
      alert('שגיאה בהעתקת התקציב');
    } finally {
      setCopying(false);
    }
  };

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <h2 style={{ margin: '0 0 20px', fontSize: '1.3rem', color: 'var(--ink-1)' }}>העתקת תקציב</h2>
        <div style={{ marginBottom: '15px' }}>
          <label style={labelStyle}>מחודש (מקור)</label>
          <input type="month" value={currentMonth} disabled style={{ ...inputStyle, backgroundColor: 'var(--surface-3)', opacity: 0.6 }} />
        </div>
        <div style={{ marginBottom: '20px' }}>
          <label style={labelStyle}>לחודש (יעד)</label>
          <input type="month" value={targetMonth} onChange={(e) => setTargetMonth(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={handleCopy} disabled={copying || !targetMonth} style={saveBtnStyle}>
            {copying ? 'מעתיק...' : 'העתק'}
          </button>
          <button onClick={onClose} style={cancelBtnStyle}>ביטול</button>
        </div>
      </div>
    </div>
  );
};

// --- Styles ---
const pageStyle = {
  padding: '30px',
  minHeight: '100vh',
};

const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '25px'
};

const monthInputStyle = {
  padding: '10px 14px',
  borderRadius: 'var(--r-8)',
  border: '1px solid var(--border)',
  fontSize: '1rem',
  cursor: 'pointer',
  backgroundColor: 'var(--surface-3)',
  color: 'var(--ink-2)',
};

const copyBtnStyle = {
  background: 'var(--primary-grad)',
  color: 'var(--primary-ink)',
  border: 'none',
  padding: '10px 20px',
  borderRadius: 'var(--r-8)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontWeight: '600',
  fontSize: '0.95rem',
};

const summaryGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: '16px',
  marginBottom: '25px'
};

const tableContainerStyle = {
  backgroundColor: 'var(--surface-2)',
  borderRadius: 'var(--r-12)',
  padding: '24px',
  boxShadow: 'var(--shadow-sm)',
  border: '1px solid var(--border)',
  marginBottom: '25px'
};

const addBtnStyle = {
  background: 'var(--primary-grad)',
  color: 'var(--primary-ink)',
  border: 'none',
  padding: '8px 16px',
  borderRadius: 'var(--r-8)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontWeight: '600',
  fontSize: '0.9rem',
};

const addRowStyle = {
  display: 'flex',
  gap: '10px',
  alignItems: 'center',
  padding: '12px',
  backgroundColor: 'var(--surface-3)',
  borderRadius: 'var(--r-8)',
  marginBottom: '16px',
  border: '1px dashed var(--border-strong)',
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse'
};

const thStyle = {
  textAlign: 'start',
  padding: '12px 10px',
  borderBottom: '2px solid var(--border-strong)',
  color: 'var(--ink-4)',
  fontSize: 'var(--fs-11)',
  fontWeight: '600',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const trStyle = {
  borderBottom: '1px solid var(--border)'
};

const tdStyle = {
  padding: '14px 10px',
  fontSize: '0.95rem',
  color: 'var(--ink-2)'
};

const progressBgStyle = {
  flex: 1,
  height: '6px',
  backgroundColor: 'var(--surface-3)',
  borderRadius: 'var(--r-6)',
  overflow: 'hidden'
};

const iconBtnStyle = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '4px',
  display: 'flex',
  alignItems: 'center',
};

const inputStyle = {
  padding: '8px 12px',
  borderRadius: 'var(--r-6)',
  border: '1px solid var(--border)',
  fontSize: '0.95rem',
  boxSizing: 'border-box',
  backgroundColor: 'var(--surface-3)',
  color: 'var(--ink-1)',
};

const saveBtnStyle = {
  background: 'var(--primary-grad)',
  color: 'var(--primary-ink)',
  border: 'none',
  padding: '8px 20px',
  borderRadius: 'var(--r-6)',
  cursor: 'pointer',
  fontWeight: '600',
};

const saveBtnSmall = {
  background: 'var(--primary)',
  color: 'white',
  border: 'none',
  padding: '4px 10px',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '0.8rem',
};

const cancelBtnStyle = {
  backgroundColor: 'var(--surface-3)',
  color: 'var(--ink-3)',
  border: '1px solid var(--border)',
  padding: '8px 20px',
  borderRadius: 'var(--r-6)',
  cursor: 'pointer',
  fontWeight: '600',
};

const cancelBtnSmall = {
  backgroundColor: 'var(--neg-soft)',
  color: 'var(--neg)',
  border: 'none',
  padding: '4px 8px',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '0.8rem',
};

const emptyStyle = {
  textAlign: 'center',
  padding: '40px',
  color: 'var(--ink-4)',
  border: '2px dashed var(--border-strong)',
  borderRadius: 'var(--r-8)',
};

const insightsContainerStyle = {
  backgroundColor: 'var(--surface-2)',
  borderRadius: 'var(--r-12)',
  padding: '24px',
  boxShadow: 'var(--shadow-sm)',
  border: '1px solid var(--border)',
};

const insightCardStyle = {
  backgroundColor: 'var(--surface-3)',
  borderRadius: 'var(--r-8)',
  padding: '16px',
  border: '1px solid var(--border)',
};

const insightRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '8px 0',
  borderBottom: '1px solid var(--border)',
  fontSize: '0.9rem',
};

const overlayStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.7)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
  backdropFilter: 'blur(4px)',
};

const modalStyle = {
  backgroundColor: 'var(--surface-elev)',
  padding: '30px',
  borderRadius: 'var(--r-16)',
  width: '400px',
  maxWidth: '90%',
  boxShadow: 'var(--shadow-md)',
  border: '1px solid var(--border-strong)',
  textAlign: 'right',
  color: 'var(--ink-1)',
};

const labelStyle = {
  display: 'block',
  fontSize: '0.9rem',
  fontWeight: '600',
  color: 'var(--ink-2)',
  marginBottom: '6px',
};

export default Budget;
