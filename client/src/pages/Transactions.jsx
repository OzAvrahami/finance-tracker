import React, { useEffect, useState } from 'react';
import { getTransactions, deleteTransaction } from '../services/api';
import { Trash2, Search, Filter } from 'lucide-react';

const Transactions = () => {
  const [transactions, setTransactions] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('All'); // All, income, expense

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const res = await getTransactions();
      // מיון לפי תאריך (החדש ביותר למעלה)
      const sorted = res.data.sort((a, b) => new Date(b.transaction_date) - new Date(a.transaction_date));
      setTransactions(sorted);
    } catch (error) {
      console.error("Error loading transactions", error);
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('האם אתה בטוח שברצונך למחוק תנועה זו? (הפעולה לא ניתנת לביטול)')) {
      try {
        await deleteTransaction(id);
        setTransactions(transactions.filter(t => t.id !== id)); // עדכון הטבלה ללא רענון עמוד
      } catch (error) {
        alert('שגיאה במחיקה: ' + error.message);
      }
    }
  };

  // לוגיקת סינון וחיפוש
  const filteredData = transactions.filter(t => {
    const matchesSearch = t.description.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          t.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === 'All' || t.type === filterType;
    return matchesSearch && matchesType;
  });

  return (
    <div dir="rtl" style={{ padding: '30px', backgroundColor: '#f8f9fa', minHeight: '100vh' }}>
      <h1 style={{ marginBottom: '20px', color: '#1a1a2e' }}>היסטוריית תנועות 📋</h1>

      {/* סרגל כלים: חיפוש וסינון */}
      <div style={toolbarStyle}>
        <div style={searchContainer}>
          <Search size={20} color="#666" />
          <input 
            type="text" 
            placeholder="חפש לפי תיאור או קטגוריה..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={searchInput}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Filter size={20} color="#666" />
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={selectStyle}>
            <option value="All">הכל</option>
            <option value="expense">הוצאות בלבד</option>
            <option value="income">הכנסות בלבד</option>
          </select>
        </div>
      </div>

      {/* הטבלה */}
      <div style={tableContainer}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: '#e9ecef', color: '#495057', textAlign: 'right' }}>
              <th style={thStyle}>תאריך</th>
              <th style={thStyle}>תיאור</th>
              <th style={thStyle}>קטגוריה</th>
              <th style={thStyle}>סוג</th>
              <th style={thStyle}>אמצעי תשלום</th>
              <th style={thStyle}>סכום</th>
              <th style={thStyle}>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {filteredData.map(t => (
              <tr key={t.id} style={{ borderBottom: '1px solid #dee2e6' }}>
                <td style={tdStyle}>{t.transaction_date}</td>
                <td style={tdStyle}>
                    <div style={{ fontWeight: '500' }}>{t.description}</div>
                    {t.tags && <span style={tagStyle}>{t.tags}</span>}
                </td>
                <td style={tdStyle}>{t.category}</td>
                <td style={tdStyle}>
                  <span style={typeBadge(t.type)}>
                    {t.type === 'income' ? 'הכנסה' : 'הוצאה'}
                  </span>
                </td>
                <td style={tdStyle}>
                    {t.payment_method === 'Credit Card' ? `💳 ${t.credit_card_name || 'אשראי'}` : t.payment_method}
                </td>
                <td style={{ ...tdStyle, fontWeight: 'bold', color: t.type === 'income' ? '#2ecc71' : '#e74c3c' }}>
                  {t.type === 'income' ? '+' : '-'}₪{t.total_amount}
                </td>
                <td style={tdStyle}>
                  <button onClick={() => handleDelete(t.id)} style={deleteBtn}>
                    <Trash2 size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {filteredData.length === 0 && (
          <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>לא נמצאו תנועות תואמות לחיפוש</div>
        )}
      </div>
    </div>
  );
};

// --- עיצובים ---
const toolbarStyle = { display: 'flex', justifyContent: 'space-between', marginBottom: '20px', background: 'white', padding: '15px', borderRadius: '8px', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' };
const searchContainer = { display: 'flex', alignItems: 'center', gap: '10px', flex: 1, maxWidth: '400px' };
const searchInput = { border: 'none', outline: 'none', width: '100%', fontSize: '1rem' };
const selectStyle = { padding: '8px', borderRadius: '6px', border: '1px solid #ddd' };
const tableContainer = { background: 'white', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' };
const thStyle = { padding: '15px', fontSize: '0.9rem' };
const tdStyle = { padding: '15px', fontSize: '0.95rem', color: '#2c3e50' };
const deleteBtn = { background: 'none', border: 'none', color: '#e74c3c', cursor: 'pointer', padding: '5px' };
const tagStyle = { fontSize: '0.75rem', backgroundColor: '#f1f3f5', padding: '2px 6px', borderRadius: '4px', color: '#666', marginRight: '5px' };
const typeBadge = (type) => ({
    padding: '4px 8px', borderRadius: '12px', fontSize: '0.8rem',
    backgroundColor: type === 'income' ? '#d4edda' : '#f8d7da',
    color: type === 'income' ? '#155724' : '#721c24'
});

export default Transactions;