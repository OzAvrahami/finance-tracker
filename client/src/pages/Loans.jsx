import React, { useState, useEffect } from 'react';
import { Plus, X } from 'lucide-react';
import { getAllLoans, createLoan } from '../services/api';
import LoansDashboard from '../components/LoanDashboard';
import LoanSimulator from '../components/LoanSimulator';
import LoanCard from '../components/LoanCard';

const Loans = () => {
  const [loans, setLoans] = useState([]);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    fetchLoans();
  }, []);

  const fetchLoans = async () => {
    try {
      const response = await getAllLoans();
      setLoans(response.data);
    } catch (error) {
      console.error("Error fetching loans:", error);
    }
  };

  const pageContainerStyle = {
    padding: '40px',
    marginRight: '250px',
    backgroundColor: '#f8fafc',
    minHeight: '100vh',
    fontFamily: 'Segoe UI, sans-serif'
  };

  const headerStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '30px'
  };

  const cardsGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', // ריספונסיבי
    gap: '20px'
  };

  const addBtnStyle = {
    backgroundColor: '#2563eb',
    color: 'white',
    border: 'none',
    padding: '12px 24px',
    borderRadius: '8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontWeight: '600',
    fontSize: '1rem',
    boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)'
  };

  return (
    <div dir="rtl" style={pageContainerStyle}>
      
      <div style={headerStyle}>
        <div>
          <h1 style={{ margin: 0, fontSize: '2rem', color: '#1e293b' }}>ניהול הלוואות</h1>
          <p style={{ color: '#64748b', marginTop: '5px' }}>תמונת מצב של ההתחייבויות שלך</p>
        </div>
        <button onClick={() => setShowModal(true)} style={addBtnStyle}>
          <Plus size={20} /> הוסף הלוואה
        </button>
      </div>

      <LoansDashboard loans={loans}/>

      <LoanSimulator loans={loans}/>

      <div style={cardsGridStyle}>
        {loans.length === 0 ? (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '60px', color: '#94a3b8', border: '2px dashed #e2e8f0', borderRadius: '12px' }}>
            עדיין אין הלוואות במערכת. לחץ על הכפתור למעלה כדי להתחיל.
          </div>
        ) : (
          loans.map((loan) => (
            <LoanCard key={loan.id} loan={loan} />
          ))
        )}
      </div>

      {showModal && (
        <AddLoanModal 
          onClose={() => setShowModal(false)} 
          onSuccess={() => { setShowModal(false); fetchLoans(); }} 
        />
      )}
    </div>
  );
};

const AddLoanModal = ({ onClose, onSuccess }) => {

    const CURRENT_PRIME_RATE = 5.5;
    const [formData, setFormData] = useState({
        name: '',
        lender_name: '',
        loan_type: 'bank_loan',
        amortization_type: 'spitzer',
        interest_type: 'fixed',
        prime_margin: '',
        balloon_amount: '',
        grace_months: '',
        original_amount: '',
        current_balance: '',
        monthly_payment: '',
        interest_rate: '',
        total_installments: '',
        end_date: ''
    });
  
    const handleChange = (e) => {
        const { name, value } = e.target;
        
        setFormData(prev => {
            const updated = { ...prev, [name]: value };
            
            if (name === 'prime_margin') {
                const margin = parseFloat(value) || 0;
                updated.interest_rate = (CURRENT_PRIME_RATE + margin).toFixed(2);
            }
            
            if (name === 'interest_type' && value === 'prime') {
                updated.interest_rate = '';
                updated.prime_margin = '';
            }
            return updated;
        });
    };
    
    const handleSubmit = async (e) => {
        e.preventDefault();
        const originalAmount = parseFloat(formData.original_amount);
        
        if (!formData.name || isNaN(originalAmount)) {
            alert("חובה למלא שם הלוואה וסכום מקורי.");
            return;
        }
        
        try {
            const primeMargin = parseFloat(formData.prime_margin) || 0;
            const calculatedInterest = formData.interest_type === 'prime' 
            ? parseFloat((6.0 + primeMargin).toFixed(2))
            : parseFloat(formData.interest_rate) || 0;
            
            const payload = {
                ...formData,
                
                original_amount: originalAmount,
                current_balance: formData.current_balance ? parseFloat(formData.current_balance) : originalAmount,
                monthly_payment: parseFloat(formData.monthly_payment) || 0,
                total_installments: parseInt(formData.total_installments) || 0,
                remaining_installments: parseInt(formData.remaining_installments) || 0,
                grace_months: parseInt(formData.grace_months) || 0,
                
                balloon_amount: formData.amortization_type === 'balloon' ? (parseFloat(formData.balloon_amount) || 0) : 0,
                prime_margin: formData.interest_type === 'prime' ? primeMargin : 0,
                interest_rate: calculatedInterest,
                
                end_date: formData.end_date || null 
            };
            
            await createLoan(payload);
            onSuccess();
        
        } catch (error) {
            console.error("Save Error:", error);
            const errorMsg = error.response?.data?.error || "שגיאה לא ידועה";
            alert(`נכשל בשמירה: ${errorMsg}`);
        }
    };

    const overlayStyle = {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        backdropFilter: 'blur(4px)'
    };

    const modalContainerStyle = {
        backgroundColor: 'white',
        padding: '30px',
        borderRadius: '16px',
        width: '500px',
        maxWidth: '90%',
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
        textAlign: 'right'
    };

    const inputStyle = {
        width: '100%',
        padding: '10px',
        marginTop: '5px',
        marginBottom: '15px',
        border: '1px solid #d1d5db',
        borderRadius: '8px',
        fontSize: '16px',
        boxSizing: 'border-box'
    };

    const gridStyle = {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '15px'
    };

return (
    <div style={overlayStyle}>
      <div style={modalContainerStyle}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 'bold' }}>הקמת הלוואה חכמה</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '24px', color: '#6b7280' }}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          
          <div style={gridStyle}>
            <div>
              <label style={{ fontSize: '14px', fontWeight: '600', color: '#374151' }}>שם ההלוואה *</label>
              <input name="name" placeholder="למשל: רכב / שיפוץ" onChange={handleChange} required style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: '14px', fontWeight: '600', color: '#374151' }}>גוף מלווה</label>
              <input name="lender_name" placeholder="בנק / חברת אשראי" onChange={handleChange} style={inputStyle} />
            </div>
          </div>

          <div style={{...gridStyle, backgroundColor: '#f3f4f6', padding: '10px', borderRadius: '8px', marginBottom: '15px', border: '1px solid #e5e7eb'}}>
             <div>
                <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#4b5563' }}>מסלול (סוג החזר)</label>
                <select name="amortization_type" onChange={handleChange} style={{...inputStyle, marginBottom: 0, height: '40px'}}>
                    <option value="spitzer">שפיצר (רגיל)</option>
                    <option value="balloon">בלון / בוליט</option>
                    <option value="grace">גרייס (דחיית תשלום)</option>
                </select>
             </div>
             <div>
                <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#4b5563' }}>בסיס ריבית</label>
                <select name="interest_type" onChange={handleChange} style={{...inputStyle, marginBottom: 0, height: '40px'}}>
                    <option value="fixed">ריבית קבועה</option>
                    <option value="prime">ריבית פריים</option>
                    <option value="cpi_linked">צמוד מדד</option>
                </select>
             </div>
          </div>

          <div style={gridStyle}>
            <div>
              <label style={{ fontSize: '14px', fontWeight: '600' }}>סכום מקורי *</label>
              <input type="number" name="original_amount" onChange={handleChange} required style={inputStyle} />
            </div>
            
            {formData.amortization_type === 'balloon' ? (
              <div>
                 <label style={{ fontSize: '14px', fontWeight: '600', color: '#d97706' }}>סכום הבלון (בסוף)</label>
                 <input 
                    type="number" 
                    name="balloon_amount" 
                    placeholder="הסכום שלא נפרס" 
                    onChange={handleChange} 
                    style={{...inputStyle, borderColor: '#fcd34d', backgroundColor: '#fffbeb'}} 
                 />
              </div>
            ) : (
              <div>
                 <label style={{ fontSize: '14px', fontWeight: '600' }}>יתרה (אופציונלי)</label>
                 <input type="number" name="current_balance" placeholder="אם שונה מהמקור" onChange={handleChange} style={inputStyle} />
              </div>
            )}
          </div>

          <div style={gridStyle}>
            <div>
              <label style={{ fontSize: '14px', fontWeight: '600' }}>החזר חודשי</label>
              <input type="number" name="monthly_payment" onChange={handleChange} style={inputStyle} />
            </div>

            {formData.interest_type === 'prime' ? (
                <div>
                   <label style={{ fontSize: '14px', fontWeight: '600', color: '#2563eb' }}>מרווח (P + %)</label>
                   <input 
                      type="number" 
                      step="0.01" 
                      name="prime_margin" 
                      placeholder="למשל -0.5 או 1.5" 
                      onChange={handleChange} 
                      style={{...inputStyle, borderColor: '#93c5fd', backgroundColor: '#eff6ff'}} 
                   />
                   <div style={{fontSize: '11px', color: '#6b7280', marginTop: '-10px', marginBottom: '10px'}}>
                      * יחושב אוטומטית לפי פריים יומי
                   </div>
                </div>
            ) : (
                <div>
                   <label style={{ fontSize: '14px', fontWeight: '600' }}>ריבית שנתית %</label>
                   <input type="number" step="0.01" name="interest_rate" onChange={handleChange} style={inputStyle} />
                </div>
            )}
          </div>

          <div style={gridStyle}>
            <div>
              <label style={{ fontSize: '14px', fontWeight: '600' }}>סה"כ תשלומים</label>
              <input type="number" name="total_installments" onChange={handleChange} style={inputStyle} />
            </div>
            
            <div>
               <label style={{ fontSize: '14px', fontWeight: '600' }}>תאריך סיום</label>
               <input type="date" name="end_date" onChange={handleChange} style={inputStyle} />
            </div>
          </div>

          <button 
            type="submit" 
            style={{ 
              width: '100%', 
              padding: '14px', 
              backgroundColor: '#10b981', 
              color: 'white', 
              border: 'none', 
              borderRadius: '8px', 
              fontWeight: 'bold', 
              fontSize: '18px', 
              cursor: 'pointer',
              marginTop: '15px',
              boxShadow: '0 4px 6px -1px rgba(16, 185, 129, 0.4)'
            }}
          >
            שמור הלוואה
          </button>
        </form>
      </div>
    </div>
  );
};

export default Loans;