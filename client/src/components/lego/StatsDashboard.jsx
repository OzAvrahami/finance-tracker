import React from 'react';

const StatCard = ({ title, value, color }) => (
  <div style={{
    background: 'white',
    padding: '20px',
    borderRadius: '12px',
    boxShadow: '0 4px 15px rgba(0,0,0,0.03)',
    borderBottom: `4px solid ${color}`,
  }}>
    <h3 style={{ margin: '0 0 10px 0', fontSize: '0.9rem', color: '#888' }}>{title}</h3>
    <p style={{ margin: 0, fontSize: '1.8rem', fontWeight: 'bold', color: '#1a1a2e' }}>{value}</p>
  </div>
);

const StatsDashboard = ({ stats }) => {
  const { totalSets, totalValue, totalPaid, totalSaved } = stats;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: '20px',
      marginBottom: '40px',
    }}>
      <StatCard title="כמות סטים" value={totalSets} color="#4cc9f0" />
      <StatCard title="שווי שוק מוערך" value={`₪${totalValue.toLocaleString()}`} color="#4361ee" />
      <StatCard title='סה"כ שולם' value={`₪${totalPaid.toLocaleString()}`} color="#3a0ca3" />
      <StatCard title="חיסכון כולל" value={`₪${totalSaved.toLocaleString()}`} color="#10b981" />
    </div>
  );
};

export default StatsDashboard;
