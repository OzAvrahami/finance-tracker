import React, { useEffect, useState, useMemo } from 'react';
import { getTransactions, getLegoSets } from '../services/api'; 
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { Wallet, TrendingUp, TrendingDown, Package } from 'lucide-react';
import { preparePieChartData, calculateSummaryStats, filterTransactionsByMonth } from '../utils/dashboardHelpers';

const Dashboard = () => {
  const [transactions, setTransactions] = useState([]);
  const [legoValue, setLegoValue] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [transRes, legoRes] = await Promise.all([getTransactions(), getLegoSets()]);
        
        setTransactions(transRes.data);

        const totalLego = legoRes.data.reduce((sum, item) => sum + (Number(item.purchase_price) || 0), 0);
        setLegoValue(totalLego);
        
      } catch (error) {
        console.error("Error fetching dashboard data", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const monthlyTransactions = useMemo(() => {
    return filterTransactionsByMonth(transactions);
  }, [transactions]);

  const stats = useMemo(() => {
    return calculateSummaryStats(monthlyTransactions);
  }, [monthlyTransactions]);

  const chartData = useMemo(() => {
    return preparePieChartData(monthlyTransactions);
  }, [monthlyTransactions]);

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#AF19FF', '#FF5733'];

  if (loading) return <div style={{textAlign: 'center', marginTop: '50px'}}>טוען נתונים...</div>;

  return (
    <div dir="rtl" style={{ padding: '30px', backgroundColor: '#f4f6f8', minHeight: '100vh' }}>
      <h1 style={{ marginBottom: '30px', color: '#2c3e50' }}>לוח בקרה פיננסי 📊</h1>

      {/* כרטיסיות סיכום */}
      <div style={cardsContainer}>
        <StatCard title="הכנסות החודש" value={stats.income} color="#2ecc71" icon={<TrendingUp />} />
        <StatCard title="הוצאות החודש" value={stats.expenses} color="#e74c3c" icon={<TrendingDown />} />
        <StatCard title="מאזן חודשי" value={stats.balance} color="#3498db" icon={<Wallet />} />
        <StatCard title="שווי הלגו" value={legoValue} color="#f39c12" icon={<Package />} />
      </div>

      <div style={gridContainer}>
        {/* גרף עוגה */}
        <div style={chartCard}>
          <h3>התפלגות הוצאות (החודש)</h3>
          <div style={{ width: '100%', height: 300 }}>
            {chartData.length > 0 ? (
                <ResponsiveContainer>
                <PieChart>
                    <Pie data={chartData} cx="50%" cy="50%" outerRadius={80} fill="#8884d8" dataKey="value" label>
                    {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                    </Pie>
                    <Tooltip formatter={(value) => `₪${value.toLocaleString()}`} />
                </PieChart>
                </ResponsiveContainer>
            ) : (
                <p style={{textAlign: 'center', marginTop: '100px', color: '#888'}}>אין נתונים לחודש זה</p>
            )}
          </div>
        </div>

        {/* תנועות אחרונות */}
        <div style={recentCard}>
          <h3>פעולות אחרונות</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {transactions.slice(0, 5).map(t => (
              <li key={t.id} style={listItem}>
                <div>
                  <div style={{ fontWeight: 'bold' }}>{t.description}</div>
                  <div style={{ fontSize: '0.8rem', color: '#7f8c8d' }}>
                    {new Date(t.transaction_date).toLocaleDateString('he-IL')} | {t.categories?.icon} {t.categories?.name || 'כללי'}
                  </div>
                </div>
                <div style={{ color: t.movement_type === 'income' ? '#2ecc71' : '#e74c3c', fontWeight: 'bold' }}>
                  {t.movement_type === 'income' ? '+' : '-'}₪{Number(t.total_amount).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

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
const gridContainer = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px' }; 
const cardStyle = { background: 'white', padding: '20px', borderRadius: '10px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' };
const chartCard = { ...cardStyle, minHeight: '400px' };
const recentCard = { ...cardStyle, minHeight: '400px' };
const listItem = { display: 'flex', justifyContent: 'space-between', padding: '15px 0', borderBottom: '1px solid #eee' };

export default Dashboard;