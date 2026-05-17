import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Filter, Download, Edit, Trash2,
  ArrowUpDown, Calendar, ChevronDown, PlusCircle
} from 'lucide-react';
import { getTransactions, deleteTransaction, getCategories } from '../../services/api';

const formatLocalDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const Transactions = () => {
  // --- State ניהול נתונים ---
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  // --- State פילטרים ומיון ---
  const [searchText, setSearchText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [dateRange, setDateRange] = useState(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start: formatLocalDate(start), end: formatLocalDate(end) };
  });
  const [sortConfig, setSortConfig] = useState({ key: 'transaction_date', direction: 'desc' });
  const [debouncedSearchText, setDebouncedSearchText] = useState('');

  // --- טעינת נתונים ראשונית ---
  useEffect(() => {
    fetchData();
  }, []);

  // --- Debounce Effect (מונע קריסה בהקלדה) ---
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [transRes, catsRes] = await Promise.all([getTransactions(), getCategories()]);
      setTransactions(transRes.data);
      setCategories(catsRes.data);
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  // --- לוגיקה חכמה: סינון ומיון (UseMemo) ---
  const filteredData = useMemo(() => {
    let data = [...transactions];

    if (debouncedSearchText) {
      const lowerSearch = debouncedSearchText.toLocaleLowerCase();
      data = data.filter(t => {
        const matchDesc = t.description?.toLowerCase().includes(lowerSearch);
        const matchAmount = t.total_amount?.toString().includes(lowerSearch);
        const matchCategory = t.categories?.name?.toLowerCase().includes(lowerSearch);
        const matchSource = (t.payment_sources?.name || '').toLowerCase().includes(lowerSearch);
        return matchDesc || matchAmount || matchCategory || matchSource;
      });
    }

    if (selectedCategory !== 'all') {
      data = data.filter(t => t.category_id === parseInt(selectedCategory));
    }

    if (dateRange.start) {
      data = data.filter(t => new Date(t.transaction_date) >= new Date(dateRange.start));
    }
    if (dateRange.end) {
      data = data.filter(t => new Date(t.transaction_date) <= new Date(dateRange.end));
    }

    if (sortConfig.key) {
      data.sort((a, b) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];
        if (sortConfig.key === 'transaction_date') {
          aValue = new Date(aValue);
          bValue = new Date(bValue);
        } else if (sortConfig.key === 'total_amount') {
          aValue = Number(aValue);
          bValue = Number(bValue);
        }
        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return data;
  }, [transactions, debouncedSearchText, selectedCategory, dateRange, sortConfig]);

  // --- לוגיקה חכמה: חישוב סיכומים ---
  const summary = useMemo(() => {
    return filteredData.reduce((acc, curr) => {
      const amount = Number(curr.total_amount);
      if (curr.movement_type === 'income') {
        acc.income += amount;
      } else {
        acc.expense += amount;
      }
      return acc;
    }, { income: 0, expense: 0 });
  }, [filteredData]);

  // --- פונקציות עזר ---
  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const setPresetDate = (type) => {
    const now = new Date();
    let start = new Date();
    let end = new Date();

    if (type === 'thisMonth') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else if (type === 'lastMonth') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
    } else if (type === 'thisYear') {
      start = new Date(now.getFullYear(), 0, 1);
      end = new Date(now.getFullYear(), 11, 31);
    } else {
      setDateRange({ start: '', end: '' });
      return;
    }
    setDateRange({ start: formatLocalDate(start), end: formatLocalDate(end) });
  };

  const handleDelete = async (id) => {
    if (window.confirm('האם אתה בטוח שברצונך למחוק תנועה זו?')) {
      try {
        await deleteTransaction(id);
        setTransactions(prev => prev.filter(t => t.id !== id));
      } catch (error) {
        alert('שגיאה במחיקה');
      }
    }
  };

  if (loading) return <div style={{ textAlign: 'center', marginTop: 50, color: 'var(--ink-3)' }}>טוען נתונים...</div>;

  return (
    <div dir="rtl" style={{ color: 'var(--ink-2)' }}>

      {/* --- כותרת ראשית --- */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s-24)' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 'var(--fs-20)', fontWeight: 700, color: 'var(--ink-1)', letterSpacing: '-0.015em' }}>הליבה הפיננסית 📊</h1>
          <p style={{ margin: '4px 0 0 0', color: 'var(--ink-4)', fontSize: 'var(--fs-14)' }}>ניהול וחקירת תנועות עומק</p>
        </div>
        <Link to="/add" style={primaryBtnStyle}>
          <PlusCircle size={18} />
          הוסף תנועה
        </Link>
      </div>

      {/* --- סרגל כלים ופילטרים --- */}
      <div style={filterContainerStyle}>

        {/* חיפוש חופשי */}
        <div style={searchBoxStyle}>
          {/* #5A607A = --ink-4; Lucide color prop does not accept CSS variables */}
          <Search size={18} color="#5A607A" />
          <input
            type="text"
            placeholder="חיפוש לפי תיאור או סכום..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ border: 'none', outline: 'none', width: '100%', fontSize: 'var(--fs-14)', backgroundColor: 'transparent', color: 'var(--ink-1)' }}
          />
        </div>

        {/* פילטרים נוספים */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            style={selectStyle}
          >
            <option value="all">כל הקטגוריות</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
            ))}
          </select>

          <div style={dateGroupStyle}>
            {/* #5A607A = --ink-4 */}
            <Calendar size={16} color="#5A607A" />
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              style={dateInputStyle}
            />
            <span style={{ color: 'var(--ink-4)' }}>-</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              style={dateInputStyle}
            />
          </div>

          {/* כפתורים מהירים */}
          <button onClick={() => setPresetDate('thisMonth')} style={quickBtnStyle}>החודש</button>
          <button onClick={() => setPresetDate('lastMonth')} style={quickBtnStyle}>חודש שעבר</button>
          <button onClick={() => setPresetDate('clear')} style={quickBtnStyle}>הכל</button>
        </div>
      </div>

      {/* --- שורת סיכום חכמה --- */}
      <div style={summaryBarStyle}>
        <div style={summaryItemStyle}>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--ink-4)' }}>מספר תנועות</span>
          <span className="num" style={{ fontWeight: 700, fontSize: 'var(--fs-16)', color: 'var(--ink-1)' }}>{filteredData.length}</span>
        </div>
        <div style={{ width: 1, background: 'var(--border-strong)', height: 30 }} />
        <div style={summaryItemStyle}>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--ink-4)' }}>סה"כ הכנסות</span>
          <span className="num" style={{ fontWeight: 700, fontSize: 'var(--fs-16)', color: 'var(--pos)' }}>₪{summary.income.toLocaleString()}</span>
        </div>
        <div style={{ width: 1, background: 'var(--border-strong)', height: 30 }} />
        <div style={summaryItemStyle}>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--ink-4)' }}>סה"כ הוצאות</span>
          <span className="num" style={{ fontWeight: 700, fontSize: 'var(--fs-16)', color: 'var(--neg)' }}>₪{summary.expense.toLocaleString()}</span>
        </div>
        <div style={{ width: 1, background: 'var(--border-strong)', height: 30 }} />
        <div style={summaryItemStyle}>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--ink-4)' }}>יתרה בסינון</span>
          <span className="num" style={{ fontWeight: 700, fontSize: 'var(--fs-16)', color: summary.income - summary.expense >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
            ₪{(summary.income - summary.expense).toLocaleString()}
          </span>
        </div>
      </div>

      {/* --- הטבלה --- */}
      <div style={tableContainerStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--surface-3)', borderBottom: '1px solid var(--border-strong)' }}>
              <th onClick={() => handleSort('transaction_date')} style={thStyle}>תאריך <ArrowUpDown size={13} /></th>
              <th style={thStyle}>קטגוריה</th>
              <th onClick={() => handleSort('description')} style={thStyle}>תיאור <ArrowUpDown size={13} /></th>
              <th style={thStyle}>אמצעי תשלום</th>
              <th onClick={() => handleSort('total_amount')} style={thStyle}>סכום <ArrowUpDown size={13} /></th>
              <th style={thStyle}>הערות</th>
              <th style={thStyle}>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {filteredData.length > 0 ? filteredData.map((t) => (
              <tr key={t.id} className="tr-hover" style={trStyle}>
                <td className="num" style={{ ...tdStyle, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>
                  {new Date(t.transaction_date).toLocaleDateString('he-IL')}
                </td>
                <td style={tdStyle}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink-3)' }}>
                    {t.categories?.icon} {t.categories?.name}
                  </span>
                </td>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 500, color: 'var(--ink-2)' }}>{t.description}</div>
                </td>
                <td style={{ ...tdStyle, color: 'var(--ink-3)' }}>
                  {t.payment_sources?.name || '−'}
                </td>
                <td className="num" style={{ ...tdStyle, fontWeight: 700, color: t.movement_type === 'income' ? 'var(--pos)' : 'var(--neg)' }}>
                  {t.movement_type === 'income' ? '+' : '−'}₪{Number(t.total_amount).toLocaleString()}
                </td>
                <td style={{ ...tdStyle, color: 'var(--ink-4)', fontSize: 'var(--fs-13)' }}>
                  {t.notes}
                </td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Link to={`/edit-transaction/${t.id}`} style={actionBtnStyle} title="ערוך">
                      {/* #9B82FF = --primary-hi */}
                      <Edit size={15} color="#9B82FF" />
                    </Link>
                    <button onClick={() => handleDelete(t.id)} style={actionBtnStyle} title="מחק">
                      {/* #FF7A8A = --neg */}
                      <Trash2 size={15} color="#FF7A8A" />
                    </button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan="7" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-4)' }}>
                  לא נמצאו תנועות התואמות את הסינון 🔍
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// --- Styles ---
const primaryBtnStyle = {
  background: 'var(--primary-grad)',
  color: 'var(--primary-ink)',
  padding: '10px 18px',
  borderRadius: 'var(--r-10)',
  textDecoration: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--s-8)',
  fontSize: 'var(--fs-14)',
  fontWeight: 600,
  border: '1px solid rgba(255,255,255,0.12)',
  boxShadow: '0 4px 12px rgba(124,92,255,0.3)',
};

const filterContainerStyle = {
  backgroundColor: 'var(--surface-2)',
  padding: 'var(--s-16)',
  borderRadius: 'var(--r-12)',
  boxShadow: 'var(--shadow-sm)',
  border: '1px solid var(--border)',
  marginBottom: 'var(--s-16)',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--s-12)',
  alignItems: 'center',
};

const searchBoxStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  backgroundColor: 'var(--surface-3)',
  padding: '10px 14px',
  borderRadius: 30,
  flex: 1,
  minWidth: 250,
  border: '1px solid var(--border)',
};

const selectStyle = {
  padding: '9px 14px',
  borderRadius: 'var(--r-8)',
  border: '1px solid var(--border)',
  backgroundColor: 'var(--surface-3)',
  color: 'var(--ink-2)',
  outline: 'none',
  cursor: 'pointer',
  fontSize: 'var(--fs-14)',
};

const dateGroupStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  backgroundColor: 'var(--surface-3)',
  border: '1px solid var(--border)',
  padding: '8px 12px',
  borderRadius: 'var(--r-8)',
};

const dateInputStyle = {
  border: 'none',
  outline: 'none',
  color: 'var(--ink-2)',
  backgroundColor: 'transparent',
  fontFamily: 'inherit',
  fontSize: 'var(--fs-13)',
};

const quickBtnStyle = {
  backgroundColor: 'var(--primary-soft)',
  color: 'var(--primary-hi)',
  border: '1px solid rgba(124,92,255,0.2)',
  padding: '8px 14px',
  borderRadius: 20,
  fontSize: 'var(--fs-13)',
  cursor: 'pointer',
  fontWeight: 600,
};

const summaryBarStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--s-20)',
  backgroundColor: 'var(--surface-2)',
  padding: '14px 24px',
  borderRadius: 'var(--r-12)',
  marginBottom: 'var(--s-16)',
  border: '1px solid var(--border)',
};

const summaryItemStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const tableContainerStyle = {
  backgroundColor: 'var(--surface-2)',
  borderRadius: 'var(--r-12)',
  boxShadow: 'var(--shadow-sm)',
  border: '1px solid var(--border)',
  overflow: 'hidden',
};

const thStyle = {
  textAlign: 'start',
  padding: '13px 15px',
  color: 'var(--ink-4)',
  fontSize: 'var(--fs-11)',
  fontWeight: 600,
  cursor: 'pointer',
  userSelect: 'none',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};

const trStyle = {
  borderBottom: '1px solid var(--border)',
  transition: 'background-color 0.15s',
};

const tdStyle = {
  padding: '14px 15px',
  fontSize: 'var(--fs-14)',
  color: 'var(--ink-2)',
};

const actionBtnStyle = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '4px 6px',
  borderRadius: 'var(--r-6)',
  transition: 'background 0.1s',
  display: 'flex',
};

export default Transactions;
