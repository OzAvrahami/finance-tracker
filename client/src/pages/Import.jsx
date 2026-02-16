import React, { useState, useEffect } from 'react';
import { uploadImportFile, getCategories, getPaymentSources, saveImportedTransactions, createCategory } from '../services/api';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

const Import = () => {
  const [file, setFile] = useState(null);
  const [profile, setProfile] = useState('cal_bank');
  const [previewData, setPreviewData] = useState([]);
  const [categories, setCategories] = useState([]);
  const [paymentSources, setPaymentSources] = useState([]);
  const [selectedPaymentSourceId, setSelectedPaymentSourceId] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [showNewCategoryModal, setShowNewCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  
  const [targetRowId, setTargetRowId] = useState(null); 

  const navigate = useNavigate();

  useEffect(() => {
    getCategories().then(res => setCategories(res.data)).catch(console.error);
    getPaymentSources().then(res => {
      setPaymentSources(res.data);
      if (res.data.length > 0) setSelectedPaymentSourceId(res.data[0].id);
    }).catch(console.error);
  }, []);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) return alert("אנא בחר קובץ");

    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('profile', profile);

    try {
      const res = await uploadImportFile(formData);
      const dataWithCategories = res.data.previewData.map(row => ({
        ...row,
        category_id: row.suggested_category ? row.suggested_category.id : ''
      }));
      
      setPreviewData(dataWithCategories);
      setStep(2);
    } catch (error) {
      console.error(error);
      alert("שגיאה בטעינת הקובץ");
    } finally {
      setLoading(false);
    }
  };

  const handleCategoryChange = (rowId, newCatId) => {
    setPreviewData(prev => prev.map(row => 
      row.id === rowId ? { ...row, category_id: newCatId } : row
    ));
  };

  const handleSaveNewCategory = async () => {
    if (!newCategoryName.trim()) return;

    try {
      const res = await createCategory({ name: newCategoryName });
      const newCat = res.data;

      setCategories(prev => [...prev, newCat]);

      if (targetRowId !== null) {
        handleCategoryChange(targetRowId, newCat.id);
        setTargetRowId(null);
      }

      setNewCategoryName('');
      setShowNewCategoryModal(false);
      
    } catch (error) {
      console.error("Failed to create category", error);
      alert("שגיאה ביצירת קטגוריה");
    }
  };

  const openNewCategoryModal = (rowId) => {
    setTargetRowId(rowId); 
    setShowNewCategoryModal(true);
  };

  const handleDeleteRow = (idToDelete) => {
    const updatedData = previewData.filter(row => row.id !== idToDelete);
    setPreviewData(updatedData);
  };

  const handleSaveToDB = async () => {

    const validData = previewData.filter(row => row.transaction_date && row.transaction_date.trim() !== '');

    const unclassified = validData.filter(row => !row.category_id);
    if (unclassified.length > 0) {
      if (!window.confirm(`שים לב: יש ${unclassified.length} עסקאות ללא קטגוריה. האם להמשיך?`)) {
        return;
      }
    }

    try {
      setLoading(true);
      await saveImportedTransactions(validData, selectedPaymentSourceId);
      alert('העסקאות נשמרו בהצלחה! 🎉');
      navigate('/');
    } catch (error) {
      console.error(error);
      alert('שגיאה בשמירת הנתונים');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div dir="rtl" style={{ padding: '30px', maxWidth: '1200px', margin: '0 auto' }}>

      <div style={{ marginBottom: '20px' }}>
      <Link to="/add" style={{ 
        display: 'inline-flex', 
        alignItems: 'center', 
        gap: '8px',
        color: '#7f8c8d', // אפור נעים
        textDecoration: 'none',
        fontSize: '0.95rem',
        fontWeight: '500'
      }}>
        <ArrowRight size={18} />
        חזרה להוספה ידנית
      </Link>
    </div>
    
      <h1>אשף ייבוא עסקאות 🧙‍♂️</h1>
      
      {step === 1 && (
        <div style={cardStyle}>
          <h3>שלב 1: העלאת קובץ</h3>
          <div style={{ marginBottom: '15px' }}>
            <label>בחר מקור: </label>
            <select value={profile} onChange={(e) => setProfile(e.target.value)} style={inputStyle}>
              <option value="cal">כרטיס אשראי - כאל בנקאי (Cal)</option>
            </select>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label>אמצעי תשלום: </label>
            <select value={selectedPaymentSourceId} onChange={(e) => setSelectedPaymentSourceId(e.target.value)} style={inputStyle}>
              {paymentSources.map(ps => (
                <option key={ps.id} value={ps.id}>
                  {ps.name}{ps.last4 ? ` (${ps.last4})` : ''}
                </option>
              ))}
            </select>
          </div>
          
          <div style={{ marginBottom: '15px' }}>
            <input type="file" onChange={handleFileChange} accept=".csv,.xlsx,.xls" />
          </div>

          <button onClick={handleUpload} disabled={loading} style={buttonStyle}>
            {loading ? 'מעבד נתונים...' : 'טען ותציג תצוגה מקדימה'}
          </button>
        </div>
      )}

      {step === 2 && (
        <div style={cardStyle}>
          <h3>שלב 2: אישור נתונים ({previewData.length} עסקאות)</h3>
          <p>אנא עבור על הרשימה. וודא שכל העסקאות מסווגות נכון.</p>
          
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
              <thead>
                <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #ddd' }}>
                  <th style={thStyle}>תאריך</th>
                  <th style={thStyle}>תיאור</th>
                  <th style={thStyle}>חיוב בפועל (₪)</th>
                  <th style={thStyle}>פרטים נוספים</th>
                  <th style={thStyle}>קטגוריה</th>
                  <th style={thStyle}>מחיקה</th>
                </tr>
              </thead>
              <tbody>
                {previewData.map((row) => (
                  <tr key={row.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={tdStyle}>{row.transaction_date}</td>
                    <td style={tdStyle}>{row.description}</td>
                    <td style={tdStyle}>₪{(row.total_amount || 0 ).toFixed(2)}</td>
                    
                    <td style={tdStyle}>
                      {row.currency !== 'ILS' && (
                        <div style={{ fontSize: '0.85em', color: '#e67e22' }}>
                          {row.original_amount} {row.currency} (שער: {row.exchange_rate})
                        </div>
                      )}
                      {row.installments_info && (
                        <div style={{ fontSize: '0.85em', color: '#3498db' }}>
                          💳 {row.installments_info}
                        </div>
                      )}
                    </td>

                    <td style={tdStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <select 
                            value={row.category_id} 
                            onChange={(e) => handleCategoryChange(row.id, e.target.value)}
                            style={{ 
                              ...inputStyle, 
                              borderColor: row.category_id ? '#ddd' : 'red',
                              backgroundColor: row.category_id ? 'white' : '#fff0f0'
                            }}
                          >
                            <option value="">-- בחר קטגוריה --</option>
                            {categories.map(cat => (
                              <option key={cat.id} value={cat.id}>
                                {cat.icon} {cat.name}
                              </option>
                            ))}
                          </select>
                          
                          <button
                            type="button"
                            onClick={() => openNewCategoryModal(row.id)}
                            style={miniAddBtnStyle}
                            title="צור קטגוריה חדשה"
                          >
                            +
                          </button>
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <button onClick={() => handleDeleteRow(row.id)} style={{ color: 'red', cursor: 'pointer'}}>
                        🗑️ מחק
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
            <button onClick={handleSaveToDB} disabled={loading} style={{...buttonStyle, background: '#2ecc71'}}>
              {loading ? 'שומר...' : 'שמור עסקאות ב-DB 💾'}
            </button>
            <button onClick={() => setStep(1)} style={{...buttonStyle, background: '#95a5a6'}}>
              חזור אחורה
            </button>
          </div>
        </div>
      )}

      {/* --- Modal --- */}
      {showNewCategoryModal && (
        <div style={modalOverlayStyle}>
          <div style={modalContentStyle}>
            <h3 style={{ marginTop: 0 }}>קטגוריה חדשה ✨</h3>
            <input
              type="text"
              placeholder="שם הקטגוריה..."
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              style={{...inputStyle, width: '100%', boxSizing: 'border-box'}}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowNewCategoryModal(false)} style={cancelBtnStyle}>ביטול</button>
              <button type="button" onClick={handleSaveNewCategory} style={saveModalBtnStyle}>שמור</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

// --- Styles ---
const cardStyle = { background: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' };
const inputStyle = { padding: '8px', borderRadius: '4px', border: '1px solid #ddd', width: '100%', maxWidth: '200px' };
const buttonStyle = { padding: '10px 20px', background: '#3498db', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '1rem' };
const thStyle = { padding: '12px', textAlign: 'right', fontWeight: 'bold' };
const tdStyle = { padding: '12px', verticalAlign: 'top' };
const miniAddBtnStyle = { background: 'white', border: '1px solid #3498db', color: '#3498db', borderRadius: '4px', width: '30px', height: '35px', cursor: 'pointer', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const modalOverlayStyle = { position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 };
const modalContentStyle = { backgroundColor: 'white', padding: '25px', borderRadius: '12px', width: '90%', maxWidth: '350px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' };
const cancelBtnStyle = { padding: '8px 15px', backgroundColor: '#f3f4f6', border: 'none', borderRadius: '6px', cursor: 'pointer', color: '#374151' };
const saveModalBtnStyle = { padding: '8px 15px', backgroundColor: '#4f46e5', border: 'none', borderRadius: '6px', cursor: 'pointer', color: 'white', fontWeight: 'bold' };

export default Import;