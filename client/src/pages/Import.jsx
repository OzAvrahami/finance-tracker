import React, { useState, useEffect } from 'react';
import { uploadImportFile, getCategories, saveImportedTransactions } from '../services/api';
import { useNavigate } from 'react-router-dom';

const Import = () => {
  const [file, setFile] = useState(null);
  const [profile, setProfile] = useState('cal'); // ברירת מחדל
  const [previewData, setPreviewData] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1); // 1 = Upload, 2 = Preview & Edit
  const navigate = useNavigate();

  useEffect(() => {
    getCategories().then(res => setCategories(res.data)).catch(console.error);
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

  const handleSaveToDB = async () => {
    const unclassified = previewData.filter(row => !row.category_id);
    if (unclassified.length > 0) {
      if (!window.confirm(`שים לב: יש ${unclassified.length} עסקאות ללא קטגוריה. האם להמשיך?`)) {
        return;
      }
    }

    try {
      setLoading(true);
      await saveImportedTransactions(previewData); // שליחה לשרת
      alert('העסקאות נשמרו בהצלחה! 🎉');
      navigate('/'); // חזרה לדף הבית
    } catch (error) {
      console.error(error);
      alert('שגיאה בשמירת הנתונים');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div dir="rtl" style={{ padding: '30px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1>אשף ייבוא עסקאות 🧙‍♂️</h1>
      
      {step === 1 && (
        <div style={cardStyle}>
          <h3>שלב 1: העלאת קובץ</h3>
          <div style={{ marginBottom: '15px' }}>
            <label>בחר מקור: </label>
            <select value={profile} onChange={(e) => setProfile(e.target.value)} style={inputStyle}>
              <option value="cal">כרטיס אשראי - כאל (Cal)</option>
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
                  <th style={thStyle}>פרטים נוספים (מט"ח/תשלומים)</th>
                  <th style={thStyle}>קטגוריה</th>
                </tr>
              </thead>
              <tbody>
                {previewData.map((row) => (
                  <tr key={row.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={tdStyle}>{row.transaction_date}</td>
                    <td style={tdStyle}>{row.description}</td>
                    <td style={tdStyle}>₪{row.total_amount.toFixed(2)}</td>
                    
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
                      <select 
                        value={row.category_id} 
                        onChange={(e) => handleCategoryChange(row.id, e.target.value)}
                        style={{ 
                          ...inputStyle, 
                          borderColor: row.category_id ? '#ddd' : 'red', // אדום אם לא נבחרה קטגוריה
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
    </div>
  );
};

const cardStyle = { background: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' };
const inputStyle = { padding: '8px', borderRadius: '4px', border: '1px solid #ddd', width: '100%', maxWidth: '200px' };
const buttonStyle = { padding: '10px 20px', background: '#3498db', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '1rem' };
const thStyle = { padding: '12px', textAlign: 'right', fontWeight: 'bold' };
const tdStyle = { padding: '12px', verticalAlign: 'top' };

export default Import;