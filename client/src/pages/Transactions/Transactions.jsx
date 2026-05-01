import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { 
  Search, Filter, Download, Edit, Trash2, 
  ArrowUpDown, Calendar, ChevronDown, PlusCircle 
} from 'lucide-react';
import { getTransactions, deleteTransaction, getCategories } from '../../services/api';

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
    const fmt = (d) => d.toISOString().split('T')[0];
    return { start: fmt(start), end: fmt(end) };
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
    }, 300); // מחכה 300ms אחרי סיום ההקלדה

    return () => clearTimeout(timer); // ניקוי טיימר אם הקלדת שוב
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

    // 1. סינון טקסט (תיאור או סכום)
    //if (searchText) {
    if (debouncedSearchText) {
      //const lowerSearch = searchText.toLowerCase();
      const lowerSearch = debouncedSearchText.toLocaleLowerCase();
      
      data = data.filter(t => {
        // א. חיפוש בתיאור
        const matchDesc = t.description?.toLowerCase().includes(lowerSearch);
        
        // ב. חיפוש בסכום
        const matchAmount = t.total_amount?.toString().includes(lowerSearch);
        
        // ג. חיפוש בשם הקטגוריה (למשל: למצוא את כל ה"מזון" גם אם כתוב "רמי לוי")
        const matchCategory = t.categories?.name?.toLowerCase().includes(lowerSearch);
        
        // ד. חיפוש באמצעי תשלום (לפי שם אמצעי התשלום מהטבלה)
        const matchSource = (t.payment_sources?.name || '').toLowerCase().includes(lowerSearch);

        // אם אחד מהם נכון - השורה תוצג
        return matchDesc || matchAmount || matchCategory || matchSource;
      });
    }

    // 2. סינון קטגוריה
    if (selectedCategory !== 'all') {
      data = data.filter(t => t.category_id === parseInt(selectedCategory));
    }

    // 3. סינון תאריכים
    if (dateRange.start) {
      data = data.filter(t => new Date(t.transaction_date) >= new Date(dateRange.start));
    }
    if (dateRange.end) {
      data = data.filter(t => new Date(t.transaction_date) <= new Date(dateRange.end));
    }

    // 4. מיון
    if (sortConfig.key) {
      data.sort((a, b) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];

        // טיפול מיוחד לתאריכים ומספרים
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
  //}, [transactions, searchText, selectedCategory, dateRange, sortConfig]);
  }, [transactions, debouncedSearchText, selectedCategory, dateRange, sortConfig]);

  // --- לוגיקה חכמה: חישוב סיכומים (מתעדכן לפי הסינון) ---
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
        // Clear
        setDateRange({ start: '', end: '' });
        return;
    }
    
    // המרה לפורמט YYYY-MM-DD שמתאים ל-Input
    const formatDate = (d) => d.toISOString().split('T')[0];
    setDateRange({ start: formatDate(start), end: formatDate(end) });
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

  if (loading) return <div style={{textAlign: 'center', marginTop: '50px'}}>טוען נתונים...</div>;

  return (
    <div dir="rtl" style={{ fontFamily: 'Segoe UI, sans-serif', color: '#333' }}>
      
      {/* --- כותרת ראשית --- */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.8rem', color: '#1a1a2e' }}>הליבה הפיננסית 📊</h1>
          <p style={{ margin: '5px 0 0 0', color: '#6c757d' }}>ניהול וחקירת תנועות עומק</p>
        </div>
        <Link to="/add" style={primaryBtnStyle}>
          <PlusCircle size={18} />
          הוסף תנועה
        </Link>
      </div>

      {/* --- סרגל כלים ופילטרים (המוח) --- */}
      <div style={filterContainerStyle}>
        
        {/* חיפוש חופשי */}
        <div style={searchBoxStyle}>
          <Search size={18} color="#888" />
          <input 
            type="text" 
            placeholder="חיפוש לפי תיאור או סכום..." 
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ border: 'none', outline: 'none', width: '100%', fontSize: '0.95rem' }}
          />
        </div>

        {/* פילטרים נוספים */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          
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
            <Calendar size={16} color="#666" />
            <input 
              type="date" 
              value={dateRange.start} 
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              style={dateInputStyle} 
            />
            <span>-</span>
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

      {/* --- שורת סיכום חכמה (Contextual Summary) --- */}
      <div style={summaryBarStyle}>
        <div style={summaryItemStyle}>
          <span style={{ fontSize: '0.85rem', color: '#666' }}>מספר תנועות</span>
          <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{filteredData.length}</span>
        </div>
        <div style={{ width: '1px', background: '#ddd', height: '30px' }}></div>
        <div style={summaryItemStyle}>
          <span style={{ fontSize: '0.85rem', color: '#666' }}>סה"כ הכנסות</span>
          <span style={{ fontWeight: 'bold', fontSize: '1.1rem', color: '#2ecc71' }}>₪{summary.income.toLocaleString()}</span>
        </div>
        <div style={{ width: '1px', background: '#ddd', height: '30px' }}></div>
        <div style={summaryItemStyle}>
          <span style={{ fontSize: '0.85rem', color: '#666' }}>סה"כ הוצאות</span>
          <span style={{ fontWeight: 'bold', fontSize: '1.1rem', color: '#e74c3c' }}>₪{summary.expense.toLocaleString()}</span>
        </div>
        <div style={{ width: '1px', background: '#ddd', height: '30px' }}></div>
        <div style={summaryItemStyle}>
          <span style={{ fontSize: '0.85rem', color: '#666' }}>יתרה בסינון</span>
          <span style={{ fontWeight: 'bold', fontSize: '1.1rem', color: summary.income - summary.expense >= 0 ? '#2ecc71' : '#e74c3c' }}>
            ₪{(summary.income - summary.expense).toLocaleString()}
          </span>
        </div>
      </div>

      {/* --- הטבלה (The Grid) --- */}
      <div style={{ backgroundColor: 'white', borderRadius: '10px', boxShadow: '0 2px 10px rgba(0,0,0,0.03)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #eee' }}>
              <th onClick={() => handleSort('transaction_date')} style={thStyle}>תאריך <ArrowUpDown size={14} /></th>
              <th style={thStyle}>קטגוריה</th>
              <th onClick={() => handleSort('description')} style={thStyle}>תיאור <ArrowUpDown size={14} /></th>
              <th style={thStyle}>אמצעי תשלום</th>
              <th onClick={() => handleSort('total_amount')} style={thStyle}>סכום <ArrowUpDown size={14} /></th>
              <th style={thStyle}>הערות</th>
              <th style={thStyle}>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {filteredData.length > 0 ? filteredData.map((t) => (
              <tr key={t.id} style={trStyle}>
                <td style={tdStyle}>{new Date(t.transaction_date).toLocaleDateString('he-IL')}</td>
                <td style={tdStyle}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                     {t.categories?.icon} {t.categories?.name}
                  </span>
                </td>
                <td style={tdStyle}>
                    <div style={{fontWeight: '500'}}>{t.description}</div>
                    {/* אם תרצה להוסיף פירוט תשלומים בעתיד */}
                    {/* <div style={{fontSize: '0.75rem', color:'#999'}}>תשלום 2 מתוך 10</div> */}
                </td>
                <td style={tdStyle}>
                  {t.payment_sources?.name || '-'}
                </td>
                <td style={{ ...tdStyle, fontWeight: 'bold', color: t.movement_type === 'income' ? '#2ecc71' : '#e74c3c' }}>
                  ₪{Number(t.total_amount).toLocaleString()}
                </td>
                <td style={tdStyle}>
                  {t.notes}
                </td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Link to={`/edit-transaction/${t.id}`} style={actionBtnStyle} title="ערוך">
                      <Edit size={16} color="#3498db" />
                    </Link>
                    <button onClick={() => handleDelete(t.id)} style={actionBtnStyle} title="מחק">
                      <Trash2 size={16} color="#e74c3c" />
                    </button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan="6" style={{ padding: '40px', textAlign: 'center', color: '#999' }}>
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

// --- Styles (CSS-in-JS) ---
const primaryBtnStyle = {
  backgroundColor: '#2c3e50',
  color: 'white',
  padding: '10px 20px',
  borderRadius: '8px',
  textDecoration: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '0.9rem',
  fontWeight: '600'
};

const filterContainerStyle = {
  backgroundColor: 'white',
  padding: '15px',
  borderRadius: '10px',
  boxShadow: '0 2px 10px rgba(0,0,0,0.03)',
  marginBottom: '20px',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '15px',
  alignItems: 'center'
};

const searchBoxStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  backgroundColor: '#f4f6f8',
  padding: '10px 15px',
  borderRadius: '30px',
  flex: 1,
  minWidth: '250px'
};

const selectStyle = {
  padding: '10px 15px',
  borderRadius: '8px',
  border: '1px solid #e0e0e0',
  backgroundColor: 'white',
  outline: 'none',
  cursor: 'pointer'
};

const dateGroupStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  backgroundColor: '#fff',
  border: '1px solid #e0e0e0',
  padding: '8px 12px',
  borderRadius: '8px'
};

const dateInputStyle = {
  border: 'none',
  outline: 'none',
  color: '#555',
  fontFamily: 'inherit'
};

const quickBtnStyle = {
  backgroundColor: '#eef2ff',
  color: '#4f46e5',
  border: 'none',
  padding: '8px 15px',
  borderRadius: '20px',
  fontSize: '0.85rem',
  cursor: 'pointer',
  fontWeight: '600'
};

const summaryBarStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '20px',
  backgroundColor: '#fff',
  padding: '15px 25px',
  borderRadius: '10px',
  marginBottom: '20px',
  border: '1px solid #e9ecef'
};

const summaryItemStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px'
};

const thStyle = {
  textAlign: 'right',
  padding: '15px',
  color: '#6c757d',
  fontSize: '0.85rem',
  fontWeight: '600',
  cursor: 'pointer',
  userSelect: 'none'
};

const trStyle = {
  borderBottom: '1px solid #f1f1f1',
  transition: 'background 0.2s'
};

const tdStyle = {
  padding: '15px',
  fontSize: '0.95rem',
  color: '#2c3e50'
};

const actionBtnStyle = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '5px',
  borderRadius: '5px',
  transition: 'background 0.1s'
};

export default Transactions;