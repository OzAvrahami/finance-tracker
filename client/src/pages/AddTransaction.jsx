import React, { useState, useEffect } from 'react';
import { createTransaction, updateTransaction, getTransactionById, getTags, getLegoThemes } from '../services/api';
import { useNavigate, useParams } from 'react-router-dom';

const AddTransaction = () => {
  const navigate = useNavigate();
  const { id } = useParams(); 
  const isEditMode = Boolean(id);

  const [loading, setLoading] = useState(false);
  
  const [transaction, setTransaction] = useState({
    transaction_date: new Date().toISOString().split('T')[0],
    description: '',
    movement_type: 'expense',
    category: 'General',
    payment_source: 'credit_card',
    credit_card_name: '',
    total_amount: 0,
    global_discount: 0,
    tags: ''
  });

  const [items, setItems] = useState([]);

  const [availableTags, setAvailableTags] = useState([]);
  const [legoThemes, setLegoThemes] = useState([]);

  // Load Tags & Themes
  useEffect(() => {
    getTags().then(res => setAvailableTags(res.data)).catch(console.error);
    getLegoThemes().then(res => setLegoThemes(res.data)).catch(console.error);
  }, []);

  // Load Data for Edit Mode
  useEffect(() => {
    if (isEditMode) {
      setLoading(true);
      getTransactionById(id)
        .then(res => {
          const data = res.data;
          
          if (!data) {
              console.error("No data received!");
              return;
          }

          setTransaction({
            transaction_date: data.transaction_date || new Date().toISOString().split('T')[0],
            description: data.description || '',
            movement_type: data.type || 'expense',
            category: data.category || 'General',
            payment_source: data.payment_method || 'credit_card',
            credit_card_name: data.credit_card_name || '',
            total_amount: data.total_amount || 0,
            global_discount: data.global_discount || 0,
            tags: data.tags || ''
          });

          if (data.transaction_items && Array.isArray(data.transaction_items)) {
             setItems(data.transaction_items.map(item => ({
                item_name: item.item_name,
                quantity: item.quantity,
                price_per_unit: item.price_per_unit,
                set_number: item.set_number || '',
                theme: item.theme || '',
                tags: item.tags || '',
                discount_type: item.discount_type || 'amount',
                discount_value: item.discount_value || 0
             })));
          } else {
              setItems([]);
          }
          setLoading(false);
        })
        .catch(err => {
            console.error("Failed to load transaction", err);
            alert("שגיאה בטעינת העסקה");
            navigate('/');
        });
    }
  }, [id, isEditMode, navigate]);

  // --- Calculations ---
  const calculateFinalPrice = (price, type, value) => {
    if (!price) return 0;
    const p = Number(price);
    const v = Number(value);
    if (type === 'percent') return p - (p * (v / 100));
    return p - v;
  };

  const calculateTotal = () => {
    const itemsTotal = items.reduce((sum, item) => {
      const linePrice = calculateFinalPrice(item.price_per_unit, item.discount_type, item.discount_value);
      return sum + (linePrice * item.quantity);
    }, 0);
    
    // Global discount logic
    const finalTotal = itemsTotal - Number(transaction.global_discount);
    return finalTotal > 0 ? finalTotal : 0;
  };

  useEffect(() => {
    setTransaction(prev => ({ ...prev, total_amount: calculateTotal() }));
  }, [items, transaction.global_discount]);


  // --- Handlers ---
  const handleTransactionChange = (e) => {
    const { name, value } = e.target;
    setTransaction(prev => ({ ...prev, [name]: value }));
  };

  const handleItemChange = (index, field, value) => {
    const newItems = [...items];
    newItems[index][field] = value;
    setItems(newItems);
  };

  const addItem = () => {
    setItems([...items, { item_name: '', quantity: 1, price_per_unit: 0, set_number: '', theme: '', tags: '', discount_type: 'amount', discount_value: 0 }]);
  };

  const removeItem = (index) => {
    const newItems = items.filter((_, i) => i !== index);
    setItems(newItems);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = { transaction, items };
      
      if (isEditMode) {
        await updateTransaction(id, payload);
        alert('העסקה עודכנה בהצלחה! 💾');
      } else {
        await createTransaction(payload);
        alert('התנועה נשמרה בהצלחה! 🚀');
      }
      navigate('/');
    } catch (error) {
      console.error('Error saving transaction:', error);
      alert('שגיאה בשמירת התנועה: ' + (error.message || 'שגיאה לא ידועה'));
    }
  };

  if (loading) return <div style={{textAlign: 'center', marginTop: '50px'}}>טוען נתונים...</div>;

  return (
    <div style={{ maxWidth: '800px', margin: '40px auto', padding: '30px', backgroundColor: 'white', borderRadius: '15px', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', fontFamily: 'Segoe UI' }} dir="rtl">
      
      <h1 style={{ textAlign: 'center', color: '#1a1a2e', marginBottom: '30px' }}>
          {isEditMode ? 'עריכת תנועה ✏️' : 'הוספת תנועה חדשה 💰'}
      </h1>

      <form onSubmit={handleSubmit}>
        
        {/* --- Transaction Details --- */}
        <div style={sectionStyle}>
            <div style={rowStyle}>
                <div style={inputGroupStyle}>
                    <label style={labelStyle}>תאריך</label>
                    <input type="date" name="transaction_date" value={transaction.transaction_date} onChange={handleTransactionChange} style={inputStyle} required />
                </div>
                
                <div style={inputGroupStyle}>
                    <label style={labelStyle}>סוג תנועה</label>
                    <select name="movement_type" value={transaction.movement_type} onChange={handleTransactionChange} style={inputStyle}>
                        <option value="expense">הוצאה 💸</option>
                        <option value="income">הכנסה 💰</option>
                    </select>
                </div>
            </div>

            <div style={inputGroupStyle}>
                <label style={labelStyle}>תיאור כללי</label>
                <input type="text" name="description" value={transaction.description} onChange={handleTransactionChange} placeholder="למשל: קניות בסופר, דלק, משכורת..." style={inputStyle} required />
            </div>

            <div style={rowStyle}>
                <div style={inputGroupStyle}>
                    <label style={labelStyle}>קטגוריה</label>
                    <input type="text" name="category" value={transaction.category} onChange={handleTransactionChange} list="categories" style={inputStyle} required />
                    <datalist id="categories">
                        <option value="Food" />
                        <option value="Lego" />
                        <option value="Electronics" />
                        <option value="Transport" />
                        <option value="Salary" />
                    </datalist>
                </div>

                <div style={inputGroupStyle}>
                    <label style={labelStyle}>אמצעי תשלום</label>
                    <select name="payment_source" value={transaction.payment_source} onChange={handleTransactionChange} style={inputStyle}>
                        <option value="credit_card">כרטיס אשראי 💳</option>
                        <option value="cash">מזומן 💵</option>
                        <option value="bank_transfer">העברה בנקאית 🏦</option>
                        <option value="bit">Bit / PayBox 📱</option>
                    </select>
                </div>
            </div>

            {/* Credit Card Name Input */}
            {transaction.payment_source === 'credit_card' && (
                <div style={inputGroupStyle}>
                    <label style={labelStyle}>שם כרטיס / 4 ספרות אחרונות</label>
                    <input 
                        type="text" 
                        name="credit_card_name" 
                        value={transaction.credit_card_name} 
                        onChange={handleTransactionChange} 
                        placeholder="למשל: מאקס (1234)" 
                        style={inputStyle} 
                    />
                </div>
            )}
        </div>

        <hr style={{ margin: '30px 0', border: 'none', borderTop: '1px solid #eee' }} />

        {/* --- Items Section --- */}
        <h3 style={{ color: '#444', marginBottom: '15px' }}>פירוט פריטים 🛒</h3>
        
        {items.map((item, index) => (
            <div key={index} style={itemCardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <span style={badgeStyle}>פריט #{index + 1}</span>
                    <button type="button" onClick={() => removeItem(index)} style={deleteBtnStyle}>🗑️ הסר</button>
                </div>

                {/* שורה עליונה: שם, כמות, מחיר - תמיד מופיע */}
                <div style={gridRowStyle}>
                    <input type="text" placeholder="שם הפריט" value={item.item_name} onChange={(e) => handleItemChange(index, 'item_name', e.target.value)} style={inputStyle} required />
                    <input type="number" placeholder="כמות" value={item.quantity} onChange={(e) => handleItemChange(index, 'quantity', e.target.value)} style={inputStyle} min="1" />
                    <input type="number" placeholder="מחיר ליחידה" value={item.price_per_unit} onChange={(e) => handleItemChange(index, 'price_per_unit', e.target.value)} style={inputStyle} min="0" step="0.01" />
                </div>

                {/* שורה תחתונה: לגו (רק אם נבחרה קטגוריית לגו) + הנחות */}
                <div style={{ ...gridRowStyle, marginTop: '10px' }}>
                     
                     {/* --- התנאי החדש: מציג את שדות הלגו רק אם הקטגוריה היא Lego --- */}
                     {transaction.category === 'Lego' && (
                        <>
                             <input 
                                type="text" 
                                placeholder="מספר סט" 
                                value={item.set_number} 
                                onChange={(e) => handleItemChange(index, 'set_number', e.target.value)} 
                                style={{ ...inputStyle, borderColor: item.set_number ? '#3b82f6' : '#eee' }} 
                             />
                             
                             <input 
                                type="text" 
                                list={`themes-${index}`} 
                                placeholder="נושא (למשל: Star Wars)"
                                value={item.theme} 
                                onChange={(e) => handleItemChange(index, 'theme', e.target.value)} 
                                style={inputStyle}
                             />
                             <datalist id={`themes-${index}`}>
                                {legoThemes.map((t, i) => (
                                    <option key={i} value={t} />
                                ))}
                             </datalist>
                        </>
                     )}

                     {/* שדות ההנחה - נשארים תמיד כי רלוונטיים לכל קנייה */}
                     <div style={{ display: 'flex', gap: '5px' }}>
                        <select value={item.discount_type} onChange={(e) => handleItemChange(index, 'discount_type', e.target.value)} style={{ ...inputStyle, width: '80px' }}>
                            <option value="amount">₪</option>
                            <option value="percent">%</option>
                        </select>
                        <input type="number" placeholder="הנחה" value={item.discount_value} onChange={(e) => handleItemChange(index, 'discount_value', e.target.value)} style={inputStyle} />
                     </div>
                </div>
            </div>
        ))}
        
        <button type="button" onClick={addItem} style={addBtnStyle}>+ הוסף פריט נוסף</button>

        <hr style={{ margin: '30px 0', border: 'none', borderTop: '1px solid #eee' }} />

        {/* --- Footer & Total --- */}
        <div style={footerStyle}>
            <div style={{ flex: 1 }}>
                 <label style={labelStyle}>הנחה כללית על כל הקבלה (₪)</label>
                 <input type="number" name="global_discount" value={transaction.global_discount} onChange={handleTransactionChange} style={{ ...inputStyle, width: '150px' }} />
            </div>

            <div style={{ textAlign: 'left' }}>
                <h2 style={{ margin: 0, color: '#1a1a2e' }}>סה"כ: ₪{transaction.total_amount.toLocaleString()}</h2>
                <button type="submit" style={submitBtnStyle}>
                    {isEditMode ? 'עדכן תנועה' : 'שמור תנועה'}
                </button>
            </div>
        </div>

      </form>
    </div>
  );
};

// --- Styles ---
const sectionStyle = { display: 'flex', flexDirection: 'column', gap: '15px' };
const rowStyle = { display: 'flex', gap: '20px', flexWrap: 'wrap' };
const inputGroupStyle = { flex: 1, minWidth: '200px', display: 'flex', flexDirection: 'column', gap: '5px' };
const labelStyle = { fontSize: '0.9rem', fontWeight: 'bold', color: '#555' };
const inputStyle = { padding: '10px', borderRadius: '8px', border: '1px solid #eee', fontSize: '1rem', width: '100%', boxSizing: 'border-box' };
const itemCardStyle = { backgroundColor: '#f9fafb', padding: '15px', borderRadius: '10px', border: '1px solid #eee', marginBottom: '15px' };
const badgeStyle = { fontSize: '0.8rem', backgroundColor: '#e5e7eb', padding: '3px 8px', borderRadius: '4px', color: '#374151' };
const gridRowStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' };
const deleteBtnStyle = { background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.9rem' };
const addBtnStyle = { width: '100%', padding: '10px', backgroundColor: '#eef2ff', color: '#4f46e5', border: '1px dashed #6366f1', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' };
const footerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px' };
const submitBtnStyle = { padding: '12px 30px', backgroundColor: '#1a1a2e', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1.1rem', cursor: 'pointer', fontWeight: 'bold', marginTop: '10px' };

export default AddTransaction;