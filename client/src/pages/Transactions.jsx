import React, { useEffect, useState } from 'react';
import { getTransactions, deleteTransaction } from '../services/api'; // Correct import!
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';

const Transactions = () => {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchTransactions();
  }, []);

  const fetchTransactions = async () => {
    try {
      // Use the API service instead of direct Supabase call
      const response = await getTransactions();
      setTransactions(response.data);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('האם אתה בטוח שברצונך למחוק תנועה זו?')) return;

    try {
      // Use the API service for deletion
      await deleteTransaction(id);
      
      // Remove from UI immediately
      setTransactions(transactions.filter((t) => t.id !== id));
    } catch (error) {
      console.error('Error deleting transaction:', error);
      alert('שגיאה במחיקת התנועה');
    }
  };

  if (loading) return <div style={{ textAlign: 'center', marginTop: '50px' }}>טוען נתונים...</div>;

  return (
    <div style={{ maxWidth: '1000px', margin: '40px auto', padding: '0 20px', fontFamily: 'Segoe UI' }} dir="rtl">
      <h1 style={{ textAlign: 'center', color: '#1a1a2e', marginBottom: '30px' }}>היסטוריית תנועות 📜</h1>
      
      <div style={{ overflowX: 'auto', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', borderRadius: '10px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white' }}>
          <thead>
            <tr style={{ backgroundColor: '#1a1a2e', color: 'white', textAlign: 'right' }}>
              <th style={thStyle}>תאריך</th>
              <th style={thStyle}>תיאור</th>
              <th style={thStyle}>קטגוריה</th>
              <th style={thStyle}>סכום</th>
              <th style={thStyle}>אמצעי תשלום</th>
              <th style={thStyle}>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={tdStyle}>{format(new Date(t.transaction_date), 'dd/MM/yyyy')}</td>
                <td style={tdStyle}>{t.description}</td>
                <td style={tdStyle}>
                    <span style={{ 
                        padding: '4px 8px', 
                        borderRadius: '12px', 
                        backgroundColor: '#e3f2fd', 
                        color: '#1565c0',
                        fontSize: '0.85rem'
                    }}>
                        {t.category}
                    </span>
                </td>
                <td style={{ ...tdStyle, color: t.type === 'income' ? '#2ecc71' : '#e74c3c', fontWeight: 'bold' }}>
                  {t.type === 'income' ? '+' : '-'}{t.total_amount?.toLocaleString()}₪
                </td>
                <td style={tdStyle}>{t.payment_method === 'credit_card' ? '💳 אשראי' : t.payment_method === 'cash' ? '💵 מזומן' : '🏦 העברה'}</td>
                
                {/* --- Actions Column (Edit & Delete) --- */}
                <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button 
                            onClick={() => navigate(`/edit-transaction/${t.id}`)} 
                            style={{ ...actionBtnStyle, background: '#fff3cd', color: '#856404' }}
                            title="ערוך"
                        >
                            ✏️
                        </button>
                        <button 
                            onClick={() => handleDelete(t.id)} 
                            style={{ ...actionBtnStyle, background: '#ffe3e3', color: '#c0392b' }}
                            title="מחק"
                        >
                            🗑️
                        </button>
                    </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {transactions.length === 0 && (
            <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
                לא נמצאו תנועות. זה הזמן להוסיף אחת!
            </div>
        )}
      </div>
    </div>
  );
};

// --- Styles ---

const thStyle = {
  padding: '15px',
  fontSize: '0.95rem',
  fontWeight: '600'
};

const tdStyle = {
  padding: '15px',
  color: '#333',
  fontSize: '0.9rem'
};

const actionBtnStyle = {
    border: 'none',
    cursor: 'pointer',
    padding: '6px',
    borderRadius: '6px',
    fontSize: '1.1rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'transform 0.2s',
    minWidth: '32px',
    height: '32px'
};

export default Transactions;