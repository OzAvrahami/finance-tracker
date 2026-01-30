import React, { useState, useEffect } from 'react';
import { createTransaction, getTags, getLegoThemes } from '../services/api';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';

const AddTransaction = () => {
  const navigate = useNavigate();

  // State לניהול התגיות
  const [availableTags, setAvailableTags] = useState([]); 
  const [tagInput, setTagInput] = useState(''); 
  const [selectedTags, setSelectedTags] = useState([]);
  const [availableThemes, setAvailableThemes] = useState([]);

  // State ראשי לטופס
  const [transaction, setTransaction] = useState({
    description: '',
    movement_type: 'expense',
    category: '',
    total_amount: '',
    transaction_date: new Date().toISOString().split('T')[0],
    payment_source: 'Credit Card', // ברירת מחדל
    credit_card_name: '',
    global_discount: 0,
    tags: ''
  });

  const [items, setItems] = useState([]);

  // 1. טעינת תגיות קיימות בטעינת הדף
  useEffect(() => {
    const loadTags = async () => {
      try {
        // Tags
        const tagsRes = await getTags();
        setAvailableTags(Array.isArray(tagsRes.data) ? tagsRes.data : []);

        // Lego themes
        const themesRes = await getLegoThemes();
        setAvailableThemes(themesRes.data || []);

      } catch (e) {
        console.log("Error loading data");
      }
    };
    loadTags();
  }, []);

  // Calculate total transaction amount automatically
  useEffect(() => {
      if (items.length > 0) {
          // 1. Sum up all items (after their specific discounts)
          const itemsTotal = items.reduce((sum, item) => {
              return sum + calculateItemFinalPrice(
                  Number(item.price_per_unit) || 0,
                  Number(item.quantity) || 1,
                  item.discount_type,
                  Number(item.discount_value) || 0
              );
          }, 0);

          // 2. Subtract global discount (e.g., points used)
          const globalDiscount = Number(transaction.global_discount) || 0;
          const finalTotal = Math.max(0, itemsTotal - globalDiscount);

          setTransaction(prev => ({ ...prev, total_amount: finalTotal }));
      }
  }, [items, transaction.global_discount]);

  // --- לוגיקת תגיות ---
  const handleTagKeyDown = (e) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault();
      const newTag = tagInput.trim();
      if (!selectedTags.includes(newTag)) {
        setSelectedTags([...selectedTags, newTag]);
      }
      setTagInput('');
    }
  };

  const removeTag = (tagToRemove) => {
    setSelectedTags(selectedTags.filter(tag => tag !== tagToRemove));
  };
  // --------------------

  const handleItemChange = (index, field, value) => {
    const newItems = [...items];
    newItems[index][field] = value;
    setItems(newItems);
  };

  const addItemRow = () => {
    setItems([...items, {
      item_name: '',
      theme: '',
      quantity: 1,
      price_per_unit: 0,
      set_number: '',
      tags: '',
      discount_type: 'amount',
      discount_value: 0
    }]);
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

    // איחוד התגיות למחרוזת
    const finalTransaction = {
      ...transaction,
      tags: selectedTags.join(',') 
    };

    try {
      await createTransaction({ transaction: finalTransaction, items });
      alert('התנועה נשמרה בהצלחה!');
      navigate('/');
    } catch (error) {
      alert('שגיאה בשמירה: ' + error.message);
    }
  };

  // Helper to calculate final price per item based on discount
  const calculateItemFinalPrice = (price, quantity, type, value) => {
      const baseTotal = price * quantity;
      if (!value || value === 0) return baseTotal;

      let discountAmount = 0;
      if (type === 'percent') {
          discountAmount = baseTotal * (value / 100);
      } else {
          discountAmount = value; // Fixed amount discount
      }
      
      return Math.max(0, baseTotal - discountAmount); // Prevent negative price
  };

  return (
    <div dir="rtl" style={{ padding: '40px', maxWidth: '1000px', margin: '0 auto', fontFamily: 'Segoe UI' }}>
      <h2 style={{ borderBottom: '3px solid #4cc9f0', display: 'inline-block' }}>הזנת תנועה חדשה</h2>
      
      <form onSubmit={handleSubmit} style={formCardStyle}>
        <div style={gridStyle}>
          
          {/* תיאור */}
          <div style={inputGroup}>
            <label>תיאור (חובה):</label>
            <input type="text" required style={inputStyle} 
                   value={transaction.description}
                   onChange={(e) => setTransaction({...transaction, description: e.target.value})} />
          </div>

          {/* סוג תנועה */}
          <div style={inputGroup}>
            <label>סוג תנועה:</label>
            <select style={inputStyle} value={transaction.movement_type} onChange={(e) => setTransaction({...transaction, movement_type: e.target.value})}>
              <option value="expense">הוצאה</option>
              <option value="income">הכנסה</option>
            </select>
          </div>

          {/* קטגוריה */}
          <div style={inputGroup}>
            <label>קטגוריה (חובה):</label>
            <select required style={inputStyle} value={transaction.category} onChange={(e) => setTransaction({...transaction, category: e.target.value})}>
              <option value="">בחר קטגוריה...</option>
              <option value="Food">אוכל/סופר</option>
              <option value="Lego">לגו 🧱</option>
              <option value="Vehicle">רכב</option>
              <option value="Housing">מגורים/חשבונות</option>
              <option value="Salary">משכורת</option>
              <option value="General">כללי</option>
            </select>
          </div>

          {/* סכום כולל */}
          <div style={inputGroup}>
            <label>סכום כולל:</label>
            <input type="number" required style={inputStyle}
                   value={transaction.total_amount}
                   onChange={(e) => setTransaction({...transaction, total_amount: e.target.value})} />
          </div>

          {/* מקור תשלום */}
          <div style={inputGroup}>
            <label>מקור תשלום:</label>
            <select required style={inputStyle} value={transaction.payment_source} onChange={(e) => setTransaction({...transaction, payment_source: e.target.value})}>
              <option value="Credit Card">כרטיס אשראי</option>
              <option value="Cash">מזומן</option>
              <option value="Bank Transfer">העברה בנקאית</option>
              <option value="Bit">ביט / פפר פיי</option>
            </select>
          </div>

          {/* בחירת כרטיס - מותנה */}
          {transaction.payment_source === 'Credit Card' && (
            <div style={inputGroup}>
              <label>בחר כרטיס (חובה):</label>
              <select required style={inputStyle} value={transaction.credit_card_name} onChange={(e) => setTransaction({...transaction, credit_card_name: e.target.value})}>
                <option value="">בחר כרטיס...</option>
                <option value="Mastercard">Mastercard זהב</option>
                <option value="Visa">Visa Signature</option>
                <option value="Amex">American Express</option>
              </select>
            </div>
          )}

          {/* תאריך */}
          <div style={inputGroup}>
            <label>תאריך:</label>
            <input type="date" required style={inputStyle}
                   value={transaction.transaction_date}
                   onChange={(e) => setTransaction({...transaction, transaction_date: e.target.value})} />
          </div>

          {/* --- רכיב התגיות החדש --- */}
          <div style={{ ...inputGroup, gridColumn: '1 / -1' }}>
            <label>תגיות (הקלד ולחץ Enter):</label>
            <div style={tagsContainerStyle}>
              {selectedTags.map(tag => (
                <span key={tag} style={tagChipStyle}>
                  {tag}
                  <X size={14} style={{ cursor: 'pointer' }} onClick={() => removeTag(tag)} />
                </span>
              ))}
              <input 
                type="text" 
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                placeholder="הוסף תגית..." 
                style={tagInputStyle}
                list="tags-suggestions" 
              />
              <datalist id="tags-suggestions">
                {availableTags.map((tag, i) => <option key={i} value={tag} />)}
              </datalist>
            </div>
          </div>
        </div>

        <hr style={{ margin: '30px 0', border: '0.5px solid #eee' }} />

        {/* --- Item Details Section --- */}
        <h3>פירוט פריטים</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          {items.map((item, index) => {
            // Calculate live final price for display
            const finalPrice = calculateItemFinalPrice(
                item.price_per_unit, 
                item.quantity, 
                item.discount_type, 
                item.discount_value
            );

            return (
            <div key={index} style={itemCardStyle}>
              
              {/* Row 1: Lego Specifics */}
              {transaction.category === 'Lego' && (
                <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>מספר סט</label>
                    <input 
                      type="text" 
                      placeholder="Example: 75192"
                      value={item.set_number || ''}
                      style={{ ...inputStyle, borderColor: '#f39c12', background: '#fffcf5' }} 
                      onChange={(e) => handleItemChange(index, 'set_number', e.target.value)} 
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>נושא</label>
                    <input 
                      type="text" 
                      value={item.theme || ''}
                      list="lego-themes-list" 
                      style={{ ...inputStyle, borderColor: '#f39c12', background: '#fffcf5' }} 
                      onChange={(e) => handleItemChange(index, 'theme', e.target.value)} 
                    />
                  </div>
                </div>
              )}

              {/* Row 2: Basic Info */}
              <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                <div style={{ flex: 3 }}>
                  <label style={labelStyle}>שם הפריט</label>
                  <input 
                    type="text" 
                    value={item.item_name} 
                    style={inputStyle} 
                    onChange={(e) => handleItemChange(index, 'item_name', e.target.value)} 
                  />
                </div>
                <div style={{ flex: 0.8 }}>
                  <label style={labelStyle}>כמות</label>
                  <input 
                    type="number" 
                    value={item.quantity} 
                    style={inputStyle} 
                    onChange={(e) => handleItemChange(index, 'quantity', Number(e.target.value))} 
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>מחיר יח' (לפני הנחה)</label>
                  <input 
                    type="number" 
                    value={item.price_per_unit} 
                    style={inputStyle} 
                    onChange={(e) => handleItemChange(index, 'price_per_unit', Number(e.target.value))} 
                  />
                </div>
              </div>

              {/* Row 3: Discounts Logic */}
              <div style={{ display: 'flex', gap: '10px', marginBottom: '10px', backgroundColor: '#eefcf5', padding: '10px', borderRadius: '6px' }}>
                <div style={{ flex: 1 }}>
                    <label style={labelStyle}>סוג הנחה</label>
                    <select 
                        style={inputStyle} 
                        value={item.discount_type}
                        onChange={(e) => handleItemChange(index, 'discount_type', e.target.value)}
                    >
                        <option value="amount">סכום (₪)</option>
                        <option value="percent">אחוז (%)</option>
                    </select>
                </div>
                <div style={{ flex: 1 }}>
                    <label style={labelStyle}>שווי הנחה</label>
                    <input 
                        type="number" 
                        placeholder="0"
                        value={item.discount_value} 
                        style={inputStyle}
                        onChange={(e) => handleItemChange(index, 'discount_value', Number(e.target.value))} 
                    />
                </div>
                <div style={{ flex: 1 }}>
                    <label style={labelStyle}>סה"כ לשורה (סופי)</label>
                    <div style={{ ...inputStyle, backgroundColor: '#e2e6ea', fontWeight: 'bold', display: 'flex', alignItems: 'center' }}>
                        ₪{finalPrice.toFixed(2)}
                    </div>
                </div>
              </div>

              {/* Row 4: Tags & Delete */}
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <input 
                    type="text" 
                    placeholder="תגיות..." 
                    value={item.tags || ''}
                    style={{ ...inputStyle, fontSize: '0.9rem' }}
                    onChange={(e) => handleItemChange(index, 'tags', e.target.value)} 
                  />
                </div>
                <button type="button" onClick={() => removeItemRow(index)} style={deleteRowBtnStyle}>🗑️</button>
              </div>

            </div>
          )})}
        </div>

        {/* --- Global Discount Field (Below items) --- */}
        <div style={{ marginTop: '20px', padding: '15px', background: '#fff3cd', borderRadius: '8px', border: '1px solid #ffeeba' }}>
            <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                <label style={{ fontWeight: 'bold', color: '#856404' }}>הנחה כללית / שימוש בנקודות (₪):</label>
                <input 
                    type="number" 
                    value={transaction.global_discount}
                    onChange={(e) => setTransaction({ ...transaction, global_discount: Number(e.target.value) })}
                    style={{ ...inputStyle, width: '150px', borderColor: '#ffeeba' }}
                    placeholder="0"
                />
                <span style={{ fontSize: '0.9rem', color: '#856404' }}>(מופחת מהסה"כ לתשלום)</span>
            </div>
        </div>
        
        <button type="button" onClick={addItemRow} style={addBtnStyle}>+ הוסף פריט</button>

        <button type="submit" style={submitBtnStyle}>שמור תנועה</button>

        <datalist id="lego-themes-list">
            {availableThemes.map((theme, idx) => (
                <option key={idx} value={theme} />
            ))}
        </datalist>
      </form>
    </div>
  );
};

// --- עיצובים ---
const formCardStyle = { background: 'white', padding: '30px', borderRadius: '12px', boxShadow: '0 5px 20px rgba(0,0,0,0.05)' };
const gridStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' };
const inputGroup = { display: 'flex', flexDirection: 'column', gap: '8px' };
const inputStyle = { padding: '12px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '1rem' };
const tagsContainerStyle = { display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '8px', border: '1px solid #ddd', borderRadius: '6px', minHeight: '45px', alignItems: 'center' };
const tagChipStyle = { background: '#e9ecef', padding: '5px 10px', borderRadius: '20px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '5px' };
const tagInputStyle = { border: 'none', outline: 'none', flex: 1, minWidth: '100px', fontSize: '1rem' };
const addBtnStyle = { marginTop: '10px', padding: '10px', background: '#f8f9fa', border: '1px dashed #ced4da', borderRadius: '6px', cursor: 'pointer' };
const submitBtnStyle = { marginTop: '40px', padding: '15px', background: '#1a1a2e', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', width: '100%', fontSize: '1.1rem', fontWeight: 'bold' };
// --- Styles ---

const itemCardStyle = {
  background: '#f8f9fa',
  padding: '20px',
  borderRadius: '10px',
  border: '1px solid #e9ecef',
  boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
};

const labelStyle = {
  display: 'block',
  marginBottom: '5px',
  fontSize: '0.85rem',
  color: '#6c757d',
  fontWeight: '600'
};

const deleteRowBtnStyle = {
  background: '#ffe3e3',
  border: '1px solid #ffa8a8',
  borderRadius: '6px',
  cursor: 'pointer',
  padding: '10px 15px',
  fontSize: '1.2rem',
  height: '46px', // Align with input height
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.2s'
};

export default AddTransaction;