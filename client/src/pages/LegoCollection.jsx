import React, { useEffect, useState } from 'react';
import { getLegoSets } from '../services/api';

const LegoCollection = () => {
  const [sets, setSets] = useState([]);

  useEffect(() => {
    const loadSets = async () => {
      const response = await getLegoSets();
      setSets(response.data);
    };
    loadSets();
  }, []);

  return (
    <div dir="rtl" style={{ padding: '40px' }}>
      <h1>אוסף הלגו שלי 🧱</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '20px' }}>
        {sets.map(set => (
          <div key={set.id} style={cardStyle}>
            <h3>{set.name}</h3>
            <p>מספר סט: <strong>{set.set_number}</strong></p>
            <p>מחיר קנייה: ₪{set.purchase_price}</p>
            <div style={statusTag(set.status)}>{set.status}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const cardStyle = { background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', textAlign: 'right' };
const statusTag = (status) => ({
  display: 'inline-block', padding: '4px 10px', borderRadius: '4px',
  backgroundColor: status === 'New' ? '#d4edda' : '#fff3cd',
  color: status === 'New' ? '#155724' : '#856404', fontSize: '0.8rem'
});

export default LegoCollection;