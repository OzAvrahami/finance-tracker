import React, { useEffect, useState } from 'react';
import { getLegoSets, updateLegoSet } from '../services/api';

const LegoCollection = () => {
  const [sets, setSets] = useState([]);
  const [filterStatus, setFilterStatus] = useState('All');

  useEffect(() => {
    loadSets();
  }, []);

  const loadSets = async () => {
    const response = await getLegoSets();
    setSets(response.data);
  };

  const handleStatusChange = async (id, newStatus) => {
    try {
      await updateLegoSet(id, { status: newStatus });
      loadSets(); // רענון נתונים
    } catch (error) {
      alert("שגיאה בעדכון הסטטוס");
    }
  };

  // חישובים לסיכום
  const totalSets = sets.length;
  const totalValue = sets.reduce((sum, set) => sum + (Number(set.purchase_price) || 0), 0);

  // סינון
  const filteredSets = filterStatus === 'All' 
    ? sets 
    : sets.filter(s => s.status === filterStatus);

  return (
    <div dir="rtl" style={{ padding: '40px', fontFamily: 'Segoe UI' }}>
      <h1 style={{ color: '#1a1a2e' }}>ניהול אוסף לגו 🧱</h1>

      {/* שורת סיכום */}
      <div style={statsContainer}>
        <div style={statCard}>
          <h3>כמות סטים</h3>
          <p style={statNumber}>{totalSets}</p>
        </div>
        <div style={statCard}>
          <h3>שווי אוסף כולל</h3>
          <p style={statNumber}>₪{totalValue.toLocaleString()}</p>
        </div>
      </div>

      {/* סרגל סינון */}
      <div style={{ marginBottom: '30px' }}>
        <label>סנן לפי סטטוס: </label>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={selectStyle}>
          <option value="All">הכל</option>
          <option value="New">חדש בקופסה</option>
          <option value="Built">מורכב</option>
          <option value="In Progress">בתהליך בנייה</option>
        </select>
      </div>

      {/* רשימת סטים */}
      <div style={gridStyle}>
        {filteredSets.map(set => (
          <div key={set.id} style={cardStyle}>
            <div style={{ fontSize: '0.8rem', color: '#666' }}>#{set.set_number}</div>
            <h3 style={{ margin: '10px 0' }}>{set.name}</h3>
            <p>מחיר קנייה: <strong>₪{set.purchase_price}</strong></p>
            
            <div style={{ marginTop: '15px' }}>
              <label style={{ fontSize: '0.8rem', display: 'block' }}>שינוי סטטוס:</label>
              <select 
                value={set.status} 
                onChange={(e) => handleStatusChange(set.id, e.target.value)}
                style={inlineSelect}
              >
                <option value="New">חדש</option>
                <option value="Built">מורכב</option>
                <option value="In Progress">בבנייה</option>
              </select>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// עיצובים (Styles)
const statsContainer = { display: 'flex', gap: '20px', marginBottom: '40px' };
const statCard = { background: '#4cc9f0', color: 'white', padding: '20px', borderRadius: '12px', flex: 1, boxShadow: '0 4px 15px rgba(0,0,0,0.1)' };
const statNumber = { fontSize: '2rem', fontWeight: 'bold', margin: '10px 0 0 0' };
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '25px' };
const cardStyle = { background: 'white', padding: '25px', borderRadius: '15px', boxShadow: '0 5px 20px rgba(0,0,0,0.05)', border: '1px solid #eee' };
const selectStyle = { padding: '8px 15px', borderRadius: '6px', border: '1px solid #ddd', marginRight: '10px' };
const inlineSelect = { width: '100%', padding: '5px', marginTop: '5px', borderRadius: '4px', border: '1px solid #eee' };

export default LegoCollection;