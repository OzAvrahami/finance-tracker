import React from 'react';
import { CreditCard, Home } from 'lucide-react';

const LoanCard = ({ loan }) => {

  const original = Number(loan.original_amount) || 0;
  const balance = Number(loan.current_balance) || 0;

  const progressPercent = original > 0
    ? Math.min(100, Math.max(0, ((original - balance) / original) * 100))
    : 0;

  let progressColor = '#ef4444';

  if (progressPercent >=70) {
    progressColor = '#10b981';
  } else if (progressPercent >= 30) {
    progressColor = '#f59e0b';
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={iconWrapperStyle}>
            {loan.loan_type === 'mortgage' ? <Home size={20}/> : <CreditCard size={20}/>}
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#1e293b' }}>{loan.name}</h3>
            <span style={{ fontSize: '0.85rem', color: '#64748b' }}>{loan.lender_name}</span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
          <span style={{ color: '#64748b', fontSize: '0.9rem' }}>יתרה לסילוק</span>
          <span style={{ fontWeight: 'bold', fontSize: '1.1rem', color: '#ef4444' }}>
            ₪{Number(loan.current_balance).toLocaleString()}
          </span>
        </div>

        <div style={progressBarBgStyle}>
          <div style={{
            width: `${progressPercent}%`,
            height: '100%',
            backgroundColor: progressColor,
            transition: 'width 0.5s ease, background-color 0.5s ease'
          }}/>
        </div>

        <div style={{ marginTop: '6px', fontSize: '0.8rem', color: '#64748b' }}>
          {progressPercent.toFixed(0)}% הוחזר
        </div>

        <div style={statsRowStyle}>
          <div>
            <span style={statLabelStyle}>החזר חודשי</span>
            <span style={statValueStyle}>₪{Number(loan.monthly_payment).toLocaleString()}</span>
          </div>
          <div style={{ textAlign: 'center' }}>
            <span style={statLabelStyle}>תשלומים שנותרו</span>
            <span style={statValueStyle}>{loan.remaining_installments ?? '-'}</span>
          </div>
          <div style={{ textAlign: 'left' }}>
            <span style={statLabelStyle}>סיום משוער</span>
            <span style={statValueStyle}>{loan.end_date || '-'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const cardStyle = {
  backgroundColor: 'white',
  borderRadius: '16px',
  padding: '24px',
  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
  border: '1px solid #e2e8f0',
  transition: 'transform 0.2s',
  display: 'flex',
  flexDirection: 'column',
  gap: '15px'
};

const iconWrapperStyle = {
  padding: '10px',
  backgroundColor: '#eff6ff',
  borderRadius: '10px',
  color: '#3b82f6'
};

const progressBarBgStyle = {
  width: '100%',
  height: '6px',
  backgroundColor: '#f1f5f9',
  borderRadius: '4px',
  overflow: 'hidden'
};

const statsRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  marginTop: '15px',
  paddingTop: '15px',
  borderTop: '1px solid #f1f5f9'
};

const statLabelStyle = {
  display: 'block',
  fontSize: '0.8rem',
  color: '#94a3b8'
};

const statValueStyle = {
  fontWeight: '600',
  color: '#334155'
};

export default LoanCard;
