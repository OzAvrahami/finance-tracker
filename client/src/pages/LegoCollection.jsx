import React, { useEffect, useState } from 'react';
import { getLegoSets, updateLegoSet } from '../services/api';
import SetCard from '../components/lego/SetCard';

const LegoCollection = () => {
  const [sets, setSets] = useState([]);
  const [filterStatus, setFilterStatus] = useState('All');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSets();
  }, []);

  const loadSets = async () => {
    try {
      const response = await getLegoSets();
      // Sort: Newest sets first, then by purchase date
      //const sorted = response.data.sort((a, b) => new Date(b.purchase_date) - new Date(a.purchase_date));
      const sorted = [...response.data].sort((a, b) => {
        const [mainA, subA = 0] = a.set_number.split('-').map(Number);
        const [mainB, subB = 0] = b.set_number.split('-').map(Number);

        if (mainA !== mainB) {
            return mainA - mainB;
        }

        return subA - subB;
      });

      setSets(sorted);
    } catch (e) {
      console.error("Error loading lego sets", e);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (id, newStatus) => {
    try {
      await updateLegoSet(id, { status: newStatus });
      loadSets(); // Refresh data to reflect changes
    } catch (error) {
      alert("Error updating status");
    }
  };

  // --- Statistics Calculations ---
  const totalSets = sets.length;
  
  // Calculate Market Value (Original Price) vs Paid Price
  const totalValue = sets.reduce((sum, set) => sum + (Number(set.original_price) || Number(set.purchase_price) || 0), 0);
  const totalPaid = sets.reduce((sum, set) => sum + (Number(set.purchase_price) || 0), 0);
  const totalSaved = totalValue - totalPaid;

  // Filtering Logic
  const filteredSets = filterStatus === 'All' 
    ? sets 
    : sets.filter(s => s.status === filterStatus);

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', fontSize: '1.2rem', color: '#666' }}>טוען אוסף... 🧱</div>;

  return (
    <div dir="rtl" style={{ padding: '40px', fontFamily: 'Segoe UI', backgroundColor: '#f8f9fa', minHeight: '100vh' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        
        {/* --- Header --- */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
            <div>
                <h1 style={{ color: '#1a1a2e', margin: 0 }}>האוסף שלי 🧱</h1>
                <p style={{ color: '#666', margin: '5px 0 0 0' }}>ניהול מלאי, סטטוס בנייה ומעקב שווי</p>
            </div>
        </header>

        {/* --- Stats Dashboard --- */}
        <div style={statsContainer}>
            <StatCard title="כמות סטים" value={totalSets} color="#4cc9f0" />
            <StatCard title="שווי שוק מוערך" value={`₪${totalValue.toLocaleString()}`} color="#4361ee" />
            <StatCard title="סה&quot;כ שולם" value={`₪${totalPaid.toLocaleString()}`} color="#3a0ca3" />
            <StatCard title="חיסכון כולל" value={`₪${totalSaved.toLocaleString()}`} color="#10b981" />
        </div>

        {/* --- Filters --- */}
        <div style={{ marginBottom: '30px', background: 'white', padding: '15px', borderRadius: '10px', boxShadow: '0 2px 5px rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: '15px' }}>
            <span style={{ fontWeight: 'bold', color: '#555' }}>סינון מהיר:</span>
            {['All', 'New', 'In Progress', 'Built'].map(status => (
                <button 
                    key={status}
                    onClick={() => setFilterStatus(status)}
                    style={{
                        padding: '8px 16px',
                        borderRadius: '20px',
                        border: 'none',
                        cursor: 'pointer',
                        background: filterStatus === status ? '#1a1a2e' : '#f1f3f5',
                        color: filterStatus === status ? 'white' : '#555',
                        fontWeight: '500',
                        transition: 'all 0.2s'
                    }}
                >
                    {status === 'All' ? 'הכל' : status === 'New' ? 'חדש בקופסה' : status === 'Built' ? 'בנוי' : 'בבנייה'}
                </button>
            ))}
        </div>

        {/* --- Sets Grid --- */}
        <div style={gridStyle}>
            {filteredSets.map((set) => (
                <SetCard
                    key={set.id}
                    set={set}
                    onStatusChange={handleStatusChange}
                    styles={{
                        cardStyle,
                        imageContainerStyle,
                        imageStyle,
                        setNumberBadge,
                        themeBadge,
                        dealBadge,
                    }}
                />
            ))}
        </div>

        
        {filteredSets.length === 0 && (
            <div style={{ textAlign: 'center', padding: '50px', color: '#999', fontSize: '1.1rem' }}>
                לא נמצאו סטים תואמים לסינון
            </div>
        )}
      </div>
    </div>
  );
};

// --- Styles & Sub-components ---

const statsContainer = { 
    display: 'grid', 
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
    gap: '20px', 
    marginBottom: '40px' 
};

const gridStyle = { 
    display: 'grid', 
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', 
    gap: '25px' 
};

const cardStyle = { 
    background: 'white', 
    borderRadius: '16px', 
    overflow: 'hidden',   
    boxShadow: '0 10px 30px rgba(0,0,0,0.05)',
    border: '1px solid rgba(0,0,0,0.03)',
    transition: 'transform 0.2s, box-shadow 0.2s',
    display: 'flex',
    flexDirection: 'column'
};

// חזרנו לעיצוב הקודם של התמונה
const imageContainerStyle = {
    height: '180px', // גובה קטן יותר
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    padding: '10px', // הוספנו חזרה ריפוד
    borderBottom: '1px solid #f0f0f0' // הוספנו חזרה קו מפריד
};

const imageStyle = {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain' // התמונה לא תיחתך ותוצג במלואה
};

const setNumberBadge = { 
    background: '#f1f3f5', 
    padding: '4px 8px', 
    borderRadius: '6px', 
    fontSize: '0.8rem', 
    fontWeight: 'bold', 
    color: '#555' 
};

const themeBadge = { 
    background: '#fff0f6', 
    color: '#c026d3', 
    padding: '4px 8px', 
    borderRadius: '6px', 
    fontSize: '0.8rem', 
    fontWeight: '600' 
};

const dealBadge = { 
    marginTop: '10px', 
    background: '#d1fae5', 
    color: '#059669', 
    padding: '6px', 
    borderRadius: '6px', 
    fontSize: '0.85rem', 
    textAlign: 'center', 
    fontWeight: 'bold' 
};

// Sub-component for clean stats (Defined here to be accessible)
const StatCard = ({ title, value, color }) => (
    <div style={{ 
        background: 'white', 
        padding: '20px', 
        borderRadius: '12px', 
        boxShadow: '0 4px 15px rgba(0,0,0,0.03)', 
        borderBottom: `4px solid ${color}` 
    }}>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '0.9rem', color: '#888' }}>{title}</h3>
        <p style={{ margin: 0, fontSize: '1.8rem', fontWeight: 'bold', color: '#1a1a2e' }}>{value}</p>
    </div>
);

export default LegoCollection;