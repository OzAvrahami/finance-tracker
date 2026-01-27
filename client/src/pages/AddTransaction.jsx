import React, { useState, useEffect } from 'react';
import { createTransaction } from '../services/api';
import { useNavigate } from 'react-router-dom';

const AddTransaction = () => {
  const navigate = useNavigate();
  const [transaction, setTransaction] = useState({
    description: '',
    movement_type: 'expense', // הוצאה או הכנסה
    category: '',
    total_amount: '',
    tags: '',
    transaction_date: new Date().toISOString().split('T')[0],
    payment_source: 'Credit Card', // מזומן, אשראי וכו'
    credit_card_name: ''
  });

  const [items, setItems] = useState([]); // מתחיל ריק כפי שביקשת

  // חישוב סכום כולל אוטומטי במידה ויש פריטים
  useEffect(() => {
    if (items.length > 0) {
      const total = items.reduce((sum, item) => sum + (item.quantity * item.price_per_unit), 0);
      setTransaction(prev => ({ ...prev, total_amount: total }));
    }
  }, [items]);

  const handleItemChange = (index, field, value) => {
    const newItems = [...items];
    newItems[index][field] = value;
    newItems[index].total_item_price = newItems[index].quantity * newItems[index].price_per_unit;
    setItems(newItems);
  };

  const addItemRow = () => {
    setItems([...items, { item_name: '', quantity: 1, price_per_unit: 0 }]);
  };

  const removeItemRow = (index) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // בדיקת חובה לכרטיס אשראי
    if (transaction.payment_source === 'Credit Card' && !transaction.credit_card_name) {
      alert("נא לבחור איזה כרטיס אשראי זה");
      return;
    }

    try {
      await createTransaction({ transaction, items });
      alert('התנועה נשמרה בהצלחה!');
      navigate('/');
    } catch (error) {
      alert('שגיאה בשמירה');
    }
  };

  return (
    <div dir="rtl" style={{ padding: '40px', maxWidth: '1000px', margin: '0 auto' }}>
      <h2 style={{ borderBottom: '3px solid #4cc9f0', display: 'inline-block' }}>הזנת תנועה חדשה</h2>
      
      <form onSubmit={handleSubmit} style={formCardStyle}>
        <div style={gridStyle}>
          {/* שם התנועה */}
          <div style={inputGroup}>
            <label>שם הוצאה/הכנסה (חובה):</label>
            <input type="text" required style={inputStyle} 
                   onChange={(e) => setTransaction({...transaction, description: e.target.value})} />
          </div>

          {/* סוג תנועה */}
          <div style={inputGroup}>
            <label>סוג תנועה (חובה):</label>
            <select required style={inputStyle} onChange={(e) => setTransaction({...transaction, movement_type: e.target.value})}>
              <option value="expense">הוצאה</option>
              <option value="income">הכנסה</option>
            </select>
          </div>

          {/* קטגוריה */}
          <div style={inputGroup}>
            <label>קטגוריה (חובה):</label>
            <select required style={inputStyle} onChange={(e) => setTransaction({...transaction, category: e.target.value})}>
              <option value="">בחר קטגוריה...</option>
              <option value="Food">אוכל/סופר</option>
              <option value="Lego">לגו 🧱</option>
              <option value="Housing">מגורים/חשבונות</option>
              <option value="Vehicle">רכב</option>
              <option value="Salary">משכורת</option>
            </select>
          </div>

          {/* סכום כולל */}
          <div style={inputGroup}>
            <label>סכום כולל (חובה):</label>
            <input type="number" required value={transaction.total_amount} style={inputStyle}
                   onChange={(e) => setTransaction({...transaction, total_amount: Number(e.target.value)})} />
          </div>

          {/* מקור תשלום */}
          <div style={inputGroup}>
            <label>מקור (חובה):</label>
            <select required style={inputStyle} onChange={(e) => setTransaction({...transaction, payment_source: e.target.value})}>
              <option value="Credit Card">כרטיס אשראי</option>
              <option value="Cash">מזומן</option>
              <option value="Bank Transfer">העברה בנקאית</option>
              <option value="Bit">ביט / פפר פיי</option>
            </select>
          </div>

          {/* הצגת כרטיס אשראי רק אם נבחר אשראי */}
          {transaction.payment_source === 'Credit Card' && (
            <div style={inputGroup}>
              <label>בחר כרטיס (חובה):</label>
              <select required style={inputStyle} onChange={(e) => setTransaction({...transaction, credit_card_name: e.target.value})}>
                <option value="">בחר כרטיס...</option>
                <option value="Mastercard">Mastercard זהב</option>
                <option value="Visa">Visa Signature</option>
                <option value="Amex">American Express</option>
              </select>
            </div>
          )}

          {/* תאריך */}
          <div style={inputGroup}>
            <label>תאריך (חובה):</label>
            <input type="date" required value={transaction.transaction_date} style={inputStyle}
                   onChange={(e) => setTransaction({...transaction, transaction_date: e.target.value})} />
          </div>

          {/* תגיות */}
          <div style={inputGroup}>
            <label>תגיות (אופציונלי):</label>
            <input type="text" placeholder="לגו, יום הולדת, דחוף..." style={inputStyle}
                   onChange={(e) => setTransaction({...transaction, tags: e.target.value})} />
          </div>
        </div>

        <hr style={{ margin: '30px 0', border: '0.5px solid #eee' }} />

        <h3>פירוט פריטים (אופציונלי)</h3>
        {items.map((item, index) => (
          <div key={index} style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
            <input type="text" placeholder="שם הפריט" style={{...inputStyle, flex: 3}} 
                   onChange={(e) => handleItemChange(index, 'item_name', e.target.value)} />
            <input type="number" placeholder="כמות" style={{...inputStyle, flex: 1}} 
                   onChange={(e) => handleItemChange(index, 'quantity', Number(e.target.value))} />
            <input type="number" placeholder="מחיר" style={{...inputStyle, flex: 1}} 
                   onChange={(e) => handleItemChange(index, 'price_per_unit', Number(e.target.value))} />
            <button type="button" onClick={() => removeItemRow(index)} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>🗑️</button>
          </div>
        ))}
        
        <button type="button" onClick={addItemRow} style={addBtnStyle}>+ הוסף פריט</button>

        <button type="submit" style={submitBtnStyle}>שמור תנועה</button>
      </form>
    </div>
  );
};

// עיצובים
const formCardStyle = { background: 'white', padding: '30px', borderRadius: '12px', boxShadow: '0 5px 20px rgba(0,0,0,0.05)' };
const gridStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' };
const inputGroup = { display: 'flex', flexDirection: 'column', gap: '8px' };
const inputStyle = { padding: '12px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '1rem' };
const addBtnStyle = { marginTop: '10px', padding: '10px', background: '#f8f9fa', border: '1px dashed #ccc', borderRadius: '6px', cursor: 'pointer' };
const submitBtnStyle = { marginTop: '40px', padding: '15px', background: '#1a1a2e', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', width: '100%', fontSize: '1.1rem', fontWeight: 'bold' };

export default AddTransaction;