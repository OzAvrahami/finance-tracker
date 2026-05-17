import React, { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { getAllLoans, createLoan } from '../../services/api';
import LoansDashboard from '../../components/LoanDashboard';
import LoanSimulator from '../../components/LoanSimulator';
import LoanCard from '../../components/LoanCard';

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
    minHeight: '100vh',
  };

  const headerStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '30px'
  };

  const cardsGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '20px'
  };

  const addBtnStyle = {
    background: 'var(--primary-grad)',
    color: 'var(--primary-ink)',
    border: 'none',
    padding: '12px 24px',
    borderRadius: 'var(--r-8)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontWeight: '600',
    fontSize: '1rem',
    boxShadow: '0 4px 12px var(--primary-glow)',
  };

  return (
    <div dir="rtl" style={pageContainerStyle}>

      <div style={headerStyle}>
        <div>
          <h1 style={{ margin: 0, fontSize: '2rem', color: 'var(--ink-1)' }}>ניהול הלוואות</h1>
          <p style={{ color: 'var(--ink-4)', marginTop: '5px' }}>תמונת מצב של ההתחייבויות שלך</p>
        </div>
        <button onClick={() => setShowModal(true)} style={addBtnStyle}>
          <Plus size={20} /> הוסף הלוואה
        </button>
      </div>

      <LoansDashboard loans={loans} />

      <LoanSimulator loans={loans} />

      <div style={cardsGridStyle}>
        {loans.length === 0 ? (
          <div style={{
            gridColumn: '1/-1',
            textAlign: 'center',
            padding: '60px',
            color: 'var(--ink-4)',
            border: '2px dashed var(--border-strong)',
            borderRadius: 'var(--r-12)',
          }}>
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
        start_date: '',
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

                start_date: formData.start_date || null,
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
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        backdropFilter: 'blur(4px)',
    };

    const modalContainerStyle = {
        backgroundColor: 'var(--surface-elev)',
        padding: '30px',
        borderRadius: 'var(--r-16)',
        width: '500px',
        maxWidth: '90%',
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: 'var(--shadow-md)',
        border: '1px solid var(--border-strong)',
        textAlign: 'right',
        color: 'var(--ink-1)',
    };

    const inputStyle = {
        width: '100%',
        padding: '10px',
        marginTop: '5px',
        marginBottom: '15px',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-8)',
        fontSize: '16px',
        boxSizing: 'border-box',
        backgroundColor: 'var(--surface-3)',
        color: 'var(--ink-1)',
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
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '24px', color: 'var(--ink-4)' }}>×</button>
        </div>

        <form onSubmit={handleSubmit}>

          <div style={gridStyle}>
            <div>
              <label style={{ fontSize: '14px', fontWeight: '600', color: 'var(--ink-2)' }}>שם ההלוואה *</label>
              <input name="name" placeholder="למשל: רכב / שיפוץ" onChange={handleChange} required style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: '14px', fontWeight: '600', color: 'var(--ink-2)' }}>גוף מלווה</label>
              <input name="lender_name" placeholder="בנק / חברת אשראי" onChange={handleChange} style={inputStyle} />
            </div>
          </div>

          <div style={{ ...gridStyle, backgroundColor: 'var(--surface-3)', padding: '10px', borderRadius: 'var(--r-8)', marginBottom: '15px', border: '1px solid var(--border)' }}>
             <div>
                <label style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--ink-3)' }}>מסלול (סוג החזר)</label>
                <select name="amortization_type" onChange={handleChange} style={{ ...inputStyle, marginBottom: 0, height: '40px' }}>
                    <option value="spitzer">שפיצר (רגיל)</option>
                    <option value="balloon">בלון / בוליט</option>
                    <option value="grace">גרייס (דחיית תשלום)</option>
                </select>
             </div>
             <div>
                <label style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--ink-3)' }}>בסיס ריבית</label>
                <select name="interest_type" onChange={handleChange} style={{ ...inputStyle, marginBottom: 0, height: '40px' }}>
                    <option value="fixed">ריבית קבועה</option>
                    <option value="prime">ריבית פריים</option>
                    <option value="cpi_linked">צמוד מדד</option>
                </select>
             </div>
          </div>

          <div style={gridStyle}>
            <div>
              <label style={{ fontSize: '14px', fontWeight: '600', color: 'var(--ink-2)' }}>סכום מקורי *</label>
              <input type="number" name="original_amount" onChange={handleChange} required style={inputStyle} />
            </div>

            {formData.amortization_type === 'balloon' ? (
              <div>
                 <label style={{ fontSize: '14px', fontWeight: '600', color: 'var(--warn)' }}>סכום הבלון (בסוף)</label>
                 <input
                    type="number"
                    name="balloon_amount"
                    placeholder="הסכום שלא נפרס"
                    onChange={handleChange}
                    style={{ ...inputStyle, borderColor: 'var(--warn)', backgroundColor: 'var(--warn-soft)' }}
                 />
              </div>
            ) : (
              <div>
                 <label style={{ fontSize: '14px', fontWeight: '600', color: 'var(--ink-2)' }}>יתרה (אופציונלי)</label>
                 <input type="number" name="current_balance" placeholder="אם שונה מהמקור" onChange={handleChange} style={inputStyle} />
              </div>
            )}
          </div>

          <div style={gridStyle}>
            <div>
              <label style={{ fontSize: '14px', fontWeight: '600', color: 'var(--ink-2)' }}>החזר חודשי</label>
              <input type="number" name="monthly_payment" onChange={handleChange} style={inputStyle} />
            </div>

            {formData.interest_type === 'prime' ? (
                <div>
                   <label style={{ fontSize: '14px', fontWeight: '600', color: 'var(--info)' }}>מרווח (P + %)</label>
                   <input
                      type="number"
                      step="0.01"
                      name="prime_margin"
                      placeholder="למשל -0.5 או 1.5"
                      onChange={handleChange}
                      style={{ ...inputStyle, borderColor: 'var(--info)', backgroundColor: 'var(--info-soft)' }}
                   />
                   <div style={{ fontSize: '11px', color: 'var(--ink-4)', marginTop: '-10px', marginBottom: '10px' }}>
                      * יחושב אוטומטית לפי פריים יומי
                   </div>
                </div>
            ) : (
                <div>
                   <label style={{ fontSize: '14px', fontWeight: '600', color: 'var(--ink-2)' }}>ריבית שנתית %</label>
                   <input type="number" step="0.01" name="interest_rate" onChange={handleChange} style={inputStyle} />
                </div>
            )}
          </div>

          <div style={gridStyle}>
            <div>
              <label style={{ fontSize: '14px', fontWeight: '600', color: 'var(--ink-2)' }}>סה"כ תשלומים</label>
              <input type="number" name="total_installments" onChange={handleChange} style={inputStyle} />
            </div>

            <div>
               <label style={{ fontSize: '14px', fontWeight: '600', color: 'var(--ink-2)' }}>תאריך התחלה</label>
               <input type="date" name="start_date" onChange={handleChange} style={inputStyle} />
            </div>
          </div>

          <div style={gridStyle}>
            <div>
               <label style={{ fontSize: '14px', fontWeight: '600', color: 'var(--ink-2)' }}>תאריך סיום</label>
               <input type="date" name="end_date" onChange={handleChange} style={inputStyle} />
            </div>
          </div>

          <button
            type="submit"
            style={{
              width: '100%',
              padding: '14px',
              background: 'var(--primary-grad)',
              color: 'var(--primary-ink)',
              border: 'none',
              borderRadius: 'var(--r-8)',
              fontWeight: 'bold',
              fontSize: '18px',
              cursor: 'pointer',
              marginTop: '15px',
              boxShadow: 'var(--shadow-glow)',
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
