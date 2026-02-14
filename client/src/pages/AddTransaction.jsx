import React, { useState, useEffect } from 'react';
import { createTransaction, updateTransaction, getTransactionById, getTags, getLegoThemes, getLegoSetDetails, getCategories, createCategory, getAllLoans } from '../services/api';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { FileUp } from 'lucide-react';

const AddTransaction = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditMode = Boolean(id);

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [availableTags, setAvailableTags] = useState([]);
  const [legoThemes, setLegoThemes] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loans, setLoans] = useState([]);
  const [showNewCategoryModal, setShowNewCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  const [transaction, setTransaction] = useState({
    transaction_date: new Date().toISOString().split('T')[0],
    description: '',
    movement_type: 'expense',
    category_id: '',
    payment_source: '',
    payment_method: 'credit_card',
    credit_card_name: '',
    total_amount: 0,
    global_discount: 0,
    tags: '',
    loan_id: ''
  });

  // Load Initial Data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [tagsRes, themesRes, catsRes] = await Promise.all([
          getTags(),
          getLegoThemes(),
          getCategories()
        ]);
        setAvailableTags(tagsRes.data);
        setLegoThemes(themesRes.data);
        setCategories(catsRes.data);

        try {
          const loansRes = await getAllLoans();
          setLoans(loansRes.data);
        } catch (e) {
          console.error("Error loading loans", e);
        }
      } catch (error) {
        console.error("Error loading initial data", error);
      }
    };
    fetchData();
  }, []);

  // Load Transaction for Edit
  useEffect(() => {
    if (isEditMode) {
      setLoading(true);
      getTransactionById(id)
        .then(res => {
          const data = res.data;
          if (!data) return;

          setTransaction({
            transaction_date: data.transaction_date || new Date().toISOString().split('T')[0],
            description: data.description || '',
            movement_type: data.movement_type || 'expense', // שים לב לשם השדה ב-DB
            category_id: data.category_id || '', // טוענים את ה-ID
            payment_source: data.payment_source || 'credit_card',
            payment_method: data.payment_method || 'credit_card',
            credit_card_name: data.credit_card_name || '',
            total_amount: data.total_amount || 0,
            global_discount: data.global_discount || 0,
            tags: data.tags || '',
            loan_id: data.loan_id || ''
          });

          if (data.transaction_items?.length > 0) {
            setItems(data.transaction_items);
          } else {
            setItems([]);
          }
          setLoading(false);
        })
        .catch(err => {
          console.error(err);
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
    return type === 'percent' ? p - (p * (v / 100)) : p - v;
  };

  const calculateTotal = () => {
    const itemsTotal = items.reduce((sum, item) => {
      const linePrice = calculateFinalPrice(item.price_per_unit, item.discount_type, item.discount_value);
      return sum + (linePrice * item.quantity);
    }, 0);
    
    const finalTotal = itemsTotal - Number(transaction.global_discount);
    return finalTotal > 0 ? finalTotal : 0;
  };

  useEffect(() => {
    setTransaction(prev => ({ ...prev, total_amount: calculateTotal() }));
  }, [items, transaction.global_discount]);

  // --- Helpers ---
  // פונקציית עזר לדעת אם הקטגוריה שנבחרה היא לגו (לפי ה-ID)
  const isLegoCategory = () => {
    const selectedCat = categories.find(c => String(c.id) === String(transaction.category_id));
    return selectedCat?.name === 'Lego' || selectedCat?.name === 'לגו';
  };

  const isLoanCategory = () => {
    return String(transaction.category_id) === '24';
  };

  // --- Handlers ---
  const handleTransactionChange = (e) => {
    const { name, value } = e.target;
    
    setTransaction(prev => {
      const updated = { ...prev, [name]: value };

      // לוגיקה לזיהוי אוטומטי של קטגוריה לפי תיאור
      if (name === 'description') {
        const foundCategory = categories.find(cat =>
          cat.keywords && cat.keywords.some(k => value.toLowerCase().includes(k.toLowerCase()))
        );

        if (foundCategory) {
          updated.category_id = foundCategory.id; // מעדכנים את ה-ID, לא את השם!
        }
      }

      return updated;
    });
  };

  const handleItemChange = (index, field, value) => {
    const newItems = [...items];
    newItems[index][field] = value;
    setItems(newItems);
  };

  const addItem = () => setItems([...items, { item_name: '', quantity: 1, price_per_unit: 0, set_number: '', theme: '', tags: '', discount_type: 'amount', discount_value: 0 }]);
  
  const removeItem = (index) => setItems(items.filter((_, i) => i !== index));

  const handleSaveNewCategory = async () => {
    if (!newCategoryName.trim()) return; 

    try {
      const res = await createCategory({ name: newCategoryName });
      const newCat = res.data;

      setCategories(prev => [...prev, newCat]);
      setTransaction(prev => ({ ...prev, category_id: newCat.id }));

      setNewCategoryName('');
      setShowNewCategoryModal(false);
    } catch (error) {
      console.error("Failed to create category", error);
      alert("שגיאה ביצירת קטגוריה");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      // מוודאים ששולחים מספר אם יש ערך, או null
      const payload = {
        transaction: {
            ...transaction,
            category_id: transaction.category_id ? parseInt(transaction.category_id) : null,
            loan_id: transaction.loan_id ? parseInt(transaction.loan_id) : null
        },
        items
      };
      
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
      alert('שגיאה בשמירת התנועה');
    }
  };

  const handleSetNumberBlur = async (index, setNumber) => {
    if (!setNumber || !isLegoCategory()) return; // משתמשים בפונקציית העזר

    try {
        const res = await getLegoSetDetails(setNumber);
        const newItems = [...items];
        if (!newItems[index].item_name) newItems[index].item_name = res.data.name;
        if (!newItems[index].theme) newItems[index].theme = res.data.theme;
        setItems(newItems);
    } catch (error) {
        console.log("Set details not found");
    }
  };

  if (loading) return <div style={{textAlign: 'center', marginTop: '50px'}}>טוען נתונים...</div>;

  return (
  <div style={{ maxWidth: '800px', margin: '40px auto', padding: '30px', backgroundColor: 'white', borderRadius: '15px', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', fontFamily: 'Segoe UI' }} dir="rtl">
      
      {/* --- Header Area (החלק ששונה) --- */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '30px',
        borderBottom: '1px solid #f0f0f0',
        paddingBottom: '20px'
      }}>
          <h1 style={{ margin: 0, color: '#1a1a2e', fontSize: '1.8rem' }}>
              {isEditMode ? 'עריכת תנועה ✏️' : 'הוספת תנועה חדשה 💰'}
          </h1>

          {/* מציג את כפתור הייבוא רק אם אנחנו בהוספה חדשה (לא בעריכה) */}
          {!isEditMode && (
            <Link to="/import" style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px',
              backgroundColor: '#eef2ff', 
              color: '#4f46e5', 
              padding: '10px 18px', 
              borderRadius: '30px', 
              textDecoration: 'none',
              fontWeight: '600',
              fontSize: '0.95rem',
              transition: 'all 0.2s ease',
              border: '1px solid #e0e7ff'
            }}>
              <FileUp size={18} />
              <span>ייבוא מאקסל?</span>
            </Link>
          )}
      </div>

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
                <div style={{ display: 'flex', gap: '10px'}}>
                  <select
                    name="category_id"
                    value={transaction.category_id}
                    onChange={handleTransactionChange}
                    style={inputStyle}
                    required
                    >
                      <option value="">בחר קטגוריה</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.icon} {cat.name}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={() => setShowNewCategoryModal(true)}
                      style={{
                        ...inputStyle,
                        width: '50px',
                        backgroundColor: '#eef2ff',
                        color: '#4f46e5',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '1.5rem',
                        padding: '0'
                      }}
                      title="הוסף קטגוריה חדשה"
                    >
                      +
                    </button>
                </div>
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

            {isLoanCategory() && (
                <div style={inputGroupStyle}>
                    <label style={labelStyle}>בחר הלוואה 🏦</label>
                    <select
                      name="loan_id"
                      value={transaction.loan_id}
                      onChange={handleTransactionChange}
                      style={inputStyle}
                      required
                    >
                      <option value="">בחר הלוואה</option>
                      {loans.map((loan) => (
                        <option key={loan.id} value={loan.id}>
                          {loan.name} - {loan.lender_name} (₪{Number(loan.current_balance).toLocaleString()})
                        </option>
                      ))}
                    </select>
                </div>
            )}

            <div style={inputGroupStyle}>
                <label style={labelStyle}>סכום העסקה (₪)</label>
                <input
                    type="number"
                    name="total_amount"
                    value={transaction.total_amount}
                    onChange={handleTransactionChange}
                    placeholder="הזן סכום"
                    style={inputStyle}
                    min="0"
                    step="0.01"
                    required
                />
            </div>
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

                <div style={gridRowStyle}>
                    <input type="text" placeholder="שם הפריט" value={item.item_name} onChange={(e) => handleItemChange(index, 'item_name', e.target.value)} style={inputStyle} required />
                    <input type="number" placeholder="כמות" value={item.quantity} onChange={(e) => handleItemChange(index, 'quantity', e.target.value)} style={inputStyle} min="1" />
                    <input type="number" placeholder="מחיר ליחידה" value={item.price_per_unit} onChange={(e) => handleItemChange(index, 'price_per_unit', e.target.value)} style={inputStyle} min="0" step="0.01" />
                </div>

                <div style={{ ...gridRowStyle, marginTop: '10px' }}>
                      
                      {/* משתמשים בפונקציית העזר כדי לבדוק אם זה לגו */}
                      {isLegoCategory() && (
                        <>
                              <input 
                                type="text" 
                                placeholder="מספר סט" 
                                value={item.set_number} 
                                onChange={(e) => handleItemChange(index, 'set_number', e.target.value)} 
                                onBlur={(e) => handleSetNumberBlur(index, e.target.value)}
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

        {/* --- Footer --- */}
        <div style={footerStyle}>
            <div style={{ flex: 1 }}>
                 <label style={labelStyle}>הנחה כללית (₪)</label>
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

      {showNewCategoryModal && (
        <div style={modalOverlayStyle}>
          <div style={modalContentStyle}>
            <h3 style={{ marginTop: 0 }}>קטגוריה חדשה ✨</h3>
            <input
              type="text"
              placeholder="שם הקטגוריה..."
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              style={inputStyle}
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

// Styles
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
const modalOverlayStyle = { position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 };
const modalContentStyle = { backgroundColor: 'white', padding: '25px', borderRadius: '12px', width: '90%', maxWidth: '350px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' };
const cancelBtnStyle = { padding: '8px 15px', backgroundColor: '#f3f4f6', border: 'none', borderRadius: '6px', cursor: 'pointer', color: '#374151' };
const saveModalBtnStyle = { padding: '8px 15px', backgroundColor: '#4f46e5', border: 'none', borderRadius: '6px', cursor: 'pointer', color: 'white', fontWeight: 'bold' };

export default AddTransaction;