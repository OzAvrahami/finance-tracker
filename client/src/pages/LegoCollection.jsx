import React, { useEffect, useState } from 'react';
import { getLegoSets, updateLegoSet } from '../services/api';

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
      // מיון: קודם סטים חדשים, אח"כ לפי תאריך קנייה (מהחדש לישן)
      const sorted = response.data.sort((a, b) => new Date(b.purchase_date) - new Date(a.purchase_date));
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
      loadSets(); // Refresh data
    } catch (error) {
      alert("Error updating status");
    }
  };

  // --- Statistics Calculations ---
  const totalSets = sets.length;
  // שווי כולל לפי מחיר שוק (מקורי), לא כמה שילמת
  const totalValue = sets.reduce((sum, set) => sum + (Number(set.original_price) || Number(set.purchase_price) || 0), 0);
  
  const totalPaid = sets.reduce((sum, set) => sum + (Number(set.purchase_price) || 0), 0);
  const totalSaved = totalValue - totalPaid;

  // Filtering
  const filteredSets = filterStatus === 'All' 
    ? sets 
    : sets.filter(s => s.status === filterStatus);

  if (loading) return <div style={{ padding: '40px', textAlign: 'center' }}>טוען אוסף... 🧱</div>;

  return (
    <div dir="rtl" style={{ padding: '40px', fontFamily: 'Segoe UI', backgroundColor: '#f8f9fa', minHeight: '100vh' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        
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
            <StatCard title="חיסכון כולל" value={`₪${totalSaved.toLocaleString()}`} color="#10b981" isPositive={totalSaved > 0} />
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
            {filteredSets.map(set => {
                // חישוב אחוז הנחה
                const orig = Number(set.original_price) || 0;
                const paid = Number(set.purchase_price) || 0;
                const discountPercent = orig > paid ? Math.round(((orig - paid) / orig) * 100) : 0;

                return (
                    <div key={set.id} style={cardStyle}>
                        {/* Header: Set Number & Theme */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '10px' }}>
                            <span style={setNumberBadge}>#{set.set_number}</span>
                            {set.theme && <span style={themeBadge}>{set.theme}</span>}
                        </div>

                        {/* Set Name */}
                        <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem', height: '50px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {set.name}
                        </h3>

                        {/* Price Info */}
                        <div style={{ background: '#f8f9fa', padding: '10px', borderRadius: '8px', marginBottom: '15px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#666' }}>
                                <span>שולם:</span>
                                <span style={{ fontWeight: 'bold', color: '#1a1a2e' }}>₪{paid}</span>
                            </div>
                            
                            {orig > paid && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#999', marginTop: '5px' }}>
                                    <span>מחיר שוק:</span>
                                    <span style={{ textDecoration: 'line-through' }}>₪{orig}</span>
                                </div>
                            )}

                            {/* Deal Badge */}
                            {discountPercent > 0 && (
                                <div style={dealBadge}>
                                    🔥 עסקה מעולה! חסכת {discountPercent}%
                                </div>
                            )}
                        </div>
                        
                        {/* Status Action */}
                        <div>
                            <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '5px', color: '#888' }}>סטטוס:</label>
                            <select 
                                value={set.status} 
                                onChange={(e) => handleStatusChange(set.id, e.target.value)}
                                style={{ 
                                    width: '100%', 
                                    padding: '8px', 
                                    borderRadius: '6px', 
                                    border: '1px solid #eee',
                                    background: set.status === 'New' ? '#e3f2fd' : set.status === 'Built' ? '#e8f5e9' : '#fff3e0',
                                    color: '#333',
                                    cursor: 'pointer'
                                }}
                            >
                                <option value="New">חדש בקופסה 📦</option>
                                <option value="In Progress">בתהליך בנייה 🚧</option>
                                <option value="Built">מורכב ומוצג ✅</option>
                            </select>
                        </div>
                    </div>
                );
            })}
        </div>
        
        {filteredSets.length === 0 && (
            <div style={{ textAlign: 'center', padding: '50px', color: '#999' }}>
                לא נמצאו סטים תואמים לסינון
            </div>
        )}
      </div>
    </div>
  );
};

// --- Styles ---
const statsContainer = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '40px' };
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '25px' };

const cardStyle = { 
    background: 'white', 
    padding: '20px', 
    borderRadius: '16px', 
    boxShadow: '0 10px 30px rgba(0,0,0,0.04)', 
    border: '1px solid rgba(0,0,0,0.02)',
    transition: 'transform 0.2s',
    display: 'flex',
    flexDirection: 'column'
};

const setNumberBadge = { background: '#f1f3f5', padding: '4px 8px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 'bold', color: '#555' };
const themeBadge = { background: '#fff0f6', color: '#c026d3', padding: '4px 8px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '600' };

const dealBadge = { 
    marginTop: '10px', 
    background: '#d1fae5', 
    color: '#059669', 
    padding: '5px', 
    borderRadius: '4px', 
    fontSize: '0.8rem', 
    textAlign: 'center', 
    fontWeight: 'bold' 
};

// Sub-component for clean stats
const StatCard = ({ title, value, color, isPositive }) => (
    <div style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 15px rgba(0,0,0,0.03)', borderBottom: `4px solid ${color}` }}>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '0.9rem', color: '#888' }}>{title}</h3>
        <p style={{ margin: 0, fontSize: '1.8rem', fontWeight: 'bold', color: '#1a1a2e' }}>{value}</p>
    </div>
);

export default LegoCollection;