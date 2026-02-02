import React, { useEffect, useState } from 'react';
import { getTransactions, getLegoSets } from '../services/api'; 
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'; // הורדתי רכיבים לא בשימוש
import { Wallet, TrendingUp, TrendingDown, Package } from 'lucide-react';

const Dashboard = () => {
  const [transactions, setTransactions] = useState([]);
  const [legoValue, setLegoValue] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const transRes = await getTransactions();
        setTransactions(transRes.data);

        // חישוב שווי הלגו
        const legoRes = await getLegoSets();
        // הערה: כאן הנחתי שהשדה הוא purchase_price, אם ב-DB זה משהו אחר, צריך להתאים
        const totalLego = legoRes.data.reduce((sum, item) => sum + (Number(item.purchase_price) || 0), 0);
        setLegoValue(totalLego);
        
        setLoading(false);
      } catch (error) {
        console.error("Error fetching dashboard data", error);
      }
    };
    fetchData();
  }, []);

  const currentMonth = new Date().getMonth();
  const monthlyTrans = transactions.filter(t => new Date(t.transaction_date).getMonth() === currentMonth);
  
  // 1. תיקון: שימוש ב-movement_type במקום type
  const income = monthlyTrans
    .filter(t => t.movement_type === 'income')
    .reduce((sum, t) => sum + Number(t.total_amount), 0);

  const expenses = monthlyTrans
    .filter(t => t.movement_type === 'expense')
    .reduce((sum, t) => sum + Number(t.total_amount), 0);

  const balance = income - expenses;

  // 2. תיקון: שליפת שם הקטגוריה מהאובייקט המקושר
  const categoryData = [];
  monthlyTrans.filter(t => t.movement_type === 'expense').forEach(t => {
    // מנסה לקחת את השם מהטבלה המקושרת, אם אין - שם 'כללי'
    const catName = t.categories?.name || 'כללי';
    
    const existing = categoryData.find(c => c.name === catName);
    if (existing) {
      existing.value += Number(t.total_amount);
    } else {
      categoryData.push({ name: catName, value: Number(t.total_amount) });
    }
  });

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#AF19FF', '#FF5733'];

  if (loading) return <div>טוען נתונים...</div>;

  return (
    <div dir="rtl" style={{ padding: '30px', backgroundColor: '#f4f6f8', minHeight: '100vh' }}>
      <h1 style={{ marginBottom: '30px', color: '#2c3e50' }}>לוח בקרה פיננסי 📊</h1>

      {/* 1. כרטיסיות סיכום */}
      <div style={cardsContainer}>
        <StatCard title="הכנסות החודש" value={income} color="#2ecc71" icon={<TrendingUp />} />
        <StatCard title="הוצאות החודש" value={expenses} color="#e74c3c" icon={<TrendingDown />} />
        <StatCard title="מאזן חודשי" value={balance} color="#3498db" icon={<Wallet />} />
        <StatCard title="שווי הלגו" value={legoValue} color="#f39c12" icon={<Package />} />
      </div>

      <div style={gridContainer}>
        {/* 2. גרף התפלגות הוצאות */}
        <div style={chartCard}>
          <h3>התפלגות הוצאות (החודש)</h3>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={categoryData} cx="50%" cy="50%" outerRadius={80} fill="#8884d8" dataKey="value" label>
                  {categoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => `₪${value}`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 3. תנועות אחרונות */}
        <div style={recentCard}>
          <h3>פעולות אחרונות</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {transactions.slice(0, 5).map(t => (
              <li key={t.id} style={listItem}>
                <div>
                  <div style={{ fontWeight: 'bold' }}>{t.description}</div>
                  {/* 3. תיקון: הצגת האייקון ושם הקטגוריה החדש */}
                  <div style={{ fontSize: '0.8rem', color: '#7f8c8d' }}>
                    {t.transaction_date} | {t.categories?.icon} {t.categories?.name || 'כללי'}
                  </div>
                </div>
                <div style={{ color: t.movement_type === 'income' ? '#2ecc71' : '#e74c3c', fontWeight: 'bold' }}>
                  {t.movement_type === 'income' ? '+' : '-'}₪{t.total_amount}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

// --- רכיבים קטנים ועיצוב ---
const StatCard = ({ title, value, color, icon }) => (
  <div style={{ ...cardStyle, borderRight: `5px solid ${color}`, display: 'flex', alignItems: 'center', gap: '15px' }}>
    <div style={{ color: color }}>{icon}</div>
    <div>
      <div style={{ fontSize: '0.9rem', color: '#7f8c8d' }}>{title}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>₪{value.toLocaleString()}</div>
    </div>
  </div>
);

const cardsContainer = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '30px' };
const gridContainer = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }; 
const cardStyle = { background: 'white', padding: '20px', borderRadius: '10px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' };
const chartCard = { ...cardStyle };
const recentCard = { ...cardStyle };
const listItem = { display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #eee' };

export default Dashboard;