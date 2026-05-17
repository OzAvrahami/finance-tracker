import React from 'react';

const StatCard = ({ title, value, color }) => (
  <div style={{
    background: 'var(--surface-2)',
    padding: '20px',
    borderRadius: '12px',
    border: '1px solid var(--border)',
    borderBottom: `4px solid ${color}`,
  }}>
    <h3 style={{ margin: '0 0 10px 0', fontSize: '0.9rem', color: 'var(--ink-4)' }}>{title}</h3>
    <p style={{ margin: 0, fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--ink-1)' }}>{value}</p>
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
      <StatCard title="כמות סטים" value={totalSets} color="#5AC8FF" />
      <StatCard title="שווי שוק מוערך" value={`₪${totalValue.toLocaleString()}`} color="#9B82FF" />
      <StatCard title='סה"כ שולם' value={`₪${totalPaid.toLocaleString()}`} color="#7C5CFF" />
      <StatCard title="חיסכון כולל" value={`₪${totalSaved.toLocaleString()}`} color="#4ADE9A" />
    </div>
  );
};

export default StatsDashboard;
