import React, { useEffect, useState } from 'react';
import { getTransactions } from '../services/api';

const Dashboard = () => {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  // הגדרת העיצובים בתוך הקומפוננטה או מחוצה לה
  const thStyle = { padding: '15px', textAlign: 'right', color: '#6c757d', fontWeight: '600' };
  const tdStyle = { padding: '15px', textAlign: 'right', color: '#333' };

  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await getTransactions();
        setTransactions(response.data);
      } catch (error) {
        console.error("Failed to fetch transactions:", error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  if (loading) return <div style={{ textAlign: 'center', marginTop: '50px' }}>טוען נתונים...</div>;

  return (
    <div style={{ padding: '40px', direction: 'rtl', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ color: '#1a1a2e', marginBottom: '30px', borderBottom: '3px solid #4cc9f0', display: 'inline-block' }}>
        מעקב הוצאות
      </h1>
      
      <div style={{ overflowX: 'auto', boxShadow: '0 4px 15px rgba(0,0,0,0.05)', borderRadius: '8px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white' }}>
          <thead>
            <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
              <th style={thStyle}>תאריך</th>
              <th style={thStyle}>תיאור</th>
              <th style={thStyle}>קטגוריה</th>
              <th style={thStyle}>סכום</th>
              <th style={thStyle}>שיטת תשלום</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={tdStyle}>{new Date(t.transaction_date).toLocaleDateString('he-IL')}</td>
                <td style={tdStyle}>{t.description}</td>
                <td style={{...tdStyle, fontWeight: 'bold', color: '#4cc9f0'}}>{t.category}</td>
                <td style={{...tdStyle, fontWeight: 'bold'}}>₪{t.total_amount?.toLocaleString()}</td>
                <td style={tdStyle}>{t.payment_method}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Dashboard;