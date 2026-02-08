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
      
      {/* כרטיס 1: סך החובות (אדום - זה כואב) */}
      <div style={{ ...cardStyle, borderRight: '4px solid #ef4444' }}>
        <div style={iconContainer('#fee2e2', '#ef4444')}><Wallet size={24} /></div>
        <div>
          <div style={labelStyle}>סך כל החובות</div>
          <div style={valueStyle}>₪{stats.totalDebt.toLocaleString()}</div>
        </div>
      </div>

      {/* כרטיס 2: החזר חודשי (כחול - תזרים) */}
      <div style={{ ...cardStyle, borderRight: '4px solid #3b82f6' }}>
        <div style={iconContainer('#dbeafe', '#3b82f6')}><PieChart size={24} /></div>
        <div>
          <div style={labelStyle}>החזר חודשי כולל</div>
          <div style={valueStyle}>₪{stats.monthlyPayment.toLocaleString()}</div>
        </div>
      </div>

      {/* כרטיס 3: הלוואה הכי יקרה (כתום - אזהרה) */}
      <div style={{ ...cardStyle, borderRight: '4px solid #f97316' }}>
        <div style={iconContainer('#ffedd5', '#f97316')}><AlertTriangle size={24} /></div>
        <div>
          <div style={labelStyle}>הכי יקרה ({stats.highestInterest}%)</div>
          <div style={{...valueStyle, fontSize: '1.2rem'}}>{stats.highestInterestName}</div>
        </div>
      </div>

      {/* כרטיס 4: כמות הלוואות (ירוק - סטטוס) */}
      <div style={{ ...cardStyle, borderRight: '4px solid #10b981' }}>
        <div style={iconContainer('#d1fae5', '#10b981')}><TrendingUp size={24} /></div>
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
  backgroundColor: 'white',
  padding: '20px',
  borderRadius: '12px',
  boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
  display: 'flex',
  alignItems: 'center',
  gap: '15px'
};

const labelStyle = { color: '#64748b', fontSize: '0.9rem', marginBottom: '4px' };
const valueStyle = { fontSize: '1.5rem', fontWeight: 'bold', color: '#1e293b' };

const iconContainer = (bgColor, color) => ({
  width: '50px', height: '50px',
  backgroundColor: bgColor, color: color,
  borderRadius: '12px', display: 'flex',
  alignItems: 'center', justifyContent: 'center'
});

export default LoansDashboard;