import React, { useMemo } from 'react';
import { Wallet, TrendingUp, AlertTriangle, PieChart } from 'lucide-react';

const LoansDashboard = ({ loans }) => {

  const stats = useMemo(() => {
    let totalDebt = 0;
    let monthlyPayment = 0;
    let highestInterest = 0;
    let highestInterestName = '-';

    loans.forEach(loan => {
      const balance = parseFloat(loan.current_balance) || 0;
      const payment = parseFloat(loan.monthly_payment) || 0;
      const interest = parseFloat(loan.interest_rate) || 0;

      totalDebt += balance;
      monthlyPayment += payment;

      if (interest > highestInterest) {
        highestInterest = interest;
        highestInterestName = loan.name;
      }
    });

    return { totalDebt, monthlyPayment, highestInterest, highestInterestName };
  }, [loans]);

  return (
    <div style={dashboardGrid}>

      {/* כרטיס 1: סך החובות */}
      <div style={{ ...cardStyle, borderInlineStart: '4px solid var(--neg)' }}>
        <div style={iconContainer('var(--neg-soft)', 'var(--neg)')}><Wallet size={24} /></div>
        <div>
          <div style={labelStyle}>סך כל החובות</div>
          <div style={valueStyle}>₪{stats.totalDebt.toLocaleString()}</div>
        </div>
      </div>

      {/* כרטיס 2: החזר חודשי */}
      <div style={{ ...cardStyle, borderInlineStart: '4px solid var(--primary)' }}>
        <div style={iconContainer('var(--primary-soft)', 'var(--primary)')}><PieChart size={24} /></div>
        <div>
          <div style={labelStyle}>החזר חודשי כולל</div>
          <div style={valueStyle}>₪{stats.monthlyPayment.toLocaleString()}</div>
        </div>
      </div>

      {/* כרטיס 3: הלוואה הכי יקרה */}
      <div style={{ ...cardStyle, borderInlineStart: '4px solid var(--warn)' }}>
        <div style={iconContainer('var(--warn-soft)', 'var(--warn)')}><AlertTriangle size={24} /></div>
        <div>
          <div style={labelStyle}>הכי יקרה ({stats.highestInterest}%)</div>
          <div style={{...valueStyle, fontSize: '1.2rem'}}>{stats.highestInterestName}</div>
        </div>
      </div>

      {/* כרטיס 4: כמות הלוואות */}
      <div style={{ ...cardStyle, borderInlineStart: '4px solid var(--pos)' }}>
        <div style={iconContainer('var(--pos-soft)', 'var(--pos)')}><TrendingUp size={24} /></div>
        <div>
          <div style={labelStyle}>תיקים פעילים</div>
          <div style={valueStyle}>{loans.length}</div>
        </div>
      </div>
    </div>
  );
};

// --- Styles ---
const dashboardGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: '20px',
  marginBottom: '30px'
};

const cardStyle = {
  backgroundColor: 'var(--surface-2)',
  padding: '20px',
  borderRadius: 'var(--r-12)',
  boxShadow: 'var(--shadow-sm)',
  border: '1px solid var(--border)',
  display: 'flex',
  alignItems: 'center',
  gap: '15px'
};

const labelStyle = { color: 'var(--ink-3)', fontSize: 'var(--fs-13)', marginBottom: '4px' };
const valueStyle = { fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--ink-1)' };

const iconContainer = (bgColor, color) => ({
  width: '50px', height: '50px',
  backgroundColor: bgColor, color: color,
  borderRadius: 'var(--r-12)', display: 'flex',
  alignItems: 'center', justifyContent: 'center',
  flexShrink: 0,
});

export default LoansDashboard;
