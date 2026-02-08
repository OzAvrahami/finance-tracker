import React, { useState, useMemo } from 'react';
import { Calculator, TrendingDown } from 'lucide-react';

const LoanSimulator = ({ loans }) => {
  const [amountToPay, setAmountToPay] = useState('');
  const CURRENT_PRIME = 6.0; // הנחת יסוד לחישובים

  // המוח: מחשב איזו הלוואה הכי משתלם לסגור
  const recommendation = useMemo(() => {
    if (!amountToPay || isNaN(amountToPay) || loans.length === 0) return null;

    const cash = parseFloat(amountToPay);

    // 1. נרמול ומיון: יוצרים רשימה שמכילה את "הריבית האמיתית" לכל הלוואה
    const sortedLoans = loans
      .map(loan => {
        const margin = parseFloat(loan.prime_margin) || 0;
        const fixedRate = parseFloat(loan.interest_rate) || 0;
        
        // חישוב ריבית אפקטיבית (אם זה פריים או קבועה)
        const effectiveRate = loan.interest_type === 'prime' 
            ? (CURRENT_PRIME + margin) 
            : fixedRate;

        return { ...loan, effectiveRate };
      })
      .filter(l => parseFloat(l.current_balance) > 0) // רק הלוואות פתוחות
      .sort((a, b) => b.effectiveRate - a.effectiveRate); // מיון מהכי יקרה להכי זולה

    // 2. ההמלצה: ההלוואה הראשונה ברשימה
    const targetLoan = sortedLoans[0];
    
    if (!targetLoan) return null;

    // 3. חישוב חיסכון משוער (שנתי)
    const paymentAmount = Math.min(cash, parseFloat(targetLoan.current_balance));
    const yearlySavings = (paymentAmount * targetLoan.effectiveRate) / 100;

    return {
      loanName: targetLoan.name,
      loanRate: targetLoan.effectiveRate.toFixed(2),
      balance: parseFloat(targetLoan.current_balance),
      yearlySavings: yearlySavings.toFixed(0),
      isFullPayoff: cash >= parseFloat(targetLoan.current_balance)
    };

  }, [amountToPay, loans]);

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
            <div style={iconBox}><Calculator size={20} /></div>
            <h3 style={{ margin: 0, fontSize: '1.2rem' }}>סימולטור פירעון מוקדם</h3>
        </div>
      </div>

      {/* התיקון: הסגנון inputSection מוגדר עכשיו למטה */}
      <div style={inputSection}>
        <label style={{display: 'block', marginBottom: '8px', fontSize: '0.9rem', color: '#4b5563'}}>
          כמה כסף פנוי יש לך כרגע?
        </label>
        <div style={{display: 'flex', gap: '10px'}}>
            <input 
              type="number" 
              placeholder="למשל: 20000" 
              value={amountToPay}
              onChange={(e) => setAmountToPay(e.target.value)}
              style={inputStyle}
            />
        </div>
      </div>

      {/* אזור התוצאה - מופיע רק אם יש המלצה */}
      {recommendation && (
        <div style={resultCard}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'start'}}>
                <div>
                    <span style={{fontSize: '0.85rem', color: '#6b7280'}}>ההמלצה החכמה שלנו:</span>
                    <div style={{fontSize: '1.3rem', fontWeight: 'bold', color: '#111827', marginTop: '5px'}}>
                        סגור את "{recommendation.loanName}"
                    </div>
                    <div style={{fontSize: '0.9rem', color: '#ef4444', fontWeight: '600', marginTop: '2px'}}>
                        ריבית נוכחית: {recommendation.loanRate}% (הכי יקרה שלך)
                    </div>
                </div>
                {recommendation.isFullPayoff && (
                    <div style={badgeStyle}>חיסול מלא! 🎉</div>
                )}
            </div>

            <div style={savingsBox}>
                <div style={{display: 'flex', alignItems: 'center', gap: '8px', color: '#059669'}}>
                    <TrendingDown size={18} />
                    <span style={{fontWeight: 'bold'}}>חיסכון משוער: ₪{recommendation.yearlySavings} לשנה</span>
                </div>
                <div style={{fontSize: '0.8rem', color: '#059669', marginTop: '4px', opacity: 0.9}}>
                    (זה הכסף שלא תשלם לבנק אם תבצע את הפירעון עכשיו)
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

// --- Styles ---
const containerStyle = {
  backgroundColor: 'white',
  borderRadius: '16px',
  padding: '24px',
  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
  border: '1px solid #e2e8f0',
  marginBottom: '30px'
};

const headerStyle = { marginBottom: '20px' };

// הנה הסגנון שהיה חסר!
const inputSection = {
  marginBottom: '20px'
};

const iconBox = {
  backgroundColor: '#f3e8ff',
  color: '#9333ea',
  padding: '8px',
  borderRadius: '8px',
  display: 'flex', alignItems: 'center', justifyContent: 'center'
};

const inputStyle = {
  width: '100%',
  padding: '12px',
  fontSize: '1.1rem',
  border: '2px solid #e5e7eb',
  borderRadius: '10px',
  outline: 'none',
  transition: 'border-color 0.2s'
};

const resultCard = {
  marginTop: '20px',
  padding: '20px',
  backgroundColor: '#f9fafb',
  borderRadius: '12px',
  border: '1px solid #f3f4f6',
  animation: 'fadeIn 0.3s ease-in'
};

const badgeStyle = {
  backgroundColor: '#d1fae5',
  color: '#065f46',
  padding: '4px 10px',
  borderRadius: '20px',
  fontSize: '0.8rem',
  fontWeight: 'bold'
};

const savingsBox = {
  marginTop: '15px',
  padding: '12px',
  backgroundColor: '#ecfdf5',
  borderRadius: '8px',
  border: '1px solid #a7f3d0'
};

export default LoanSimulator;