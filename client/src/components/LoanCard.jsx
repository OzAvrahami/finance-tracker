import React from 'react';
import { CreditCard, Home } from 'lucide-react';

const LoanCard = ({ loan }) => {

  const original = Number(loan.original_amount) || 0;
  const balance = Number(loan.current_balance) || 0;

  const progressPercent = original > 0
    ? Math.min(100, Math.max(0, ((original - balance) / original) * 100))
    : 0;

  let progressColor = 'var(--neg)';

  if (progressPercent >= 70) {
    progressColor = 'var(--pos)';
  } else if (progressPercent >= 30) {
    progressColor = 'var(--warn)';
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={iconWrapperStyle}>
            {loan.loan_type === 'mortgage' ? <Home size={20} /> : <CreditCard size={20} />}
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--ink-1)' }}>{loan.name}</h3>
            <span style={{ fontSize: '0.85rem', color: 'var(--ink-4)' }}>{loan.lender_name}</span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
          <span style={{ color: 'var(--ink-4)', fontSize: '0.9rem' }}>יתרה לסילוק</span>
          <span className="num" style={{ fontWeight: 'bold', fontSize: '1.1rem', color: 'var(--neg)' }}>
            ₪{Number(loan.current_balance).toLocaleString()}
          </span>
        </div>

        <div style={progressBarBgStyle}>
          <div style={{
            width: `${progressPercent}%`,
            height: '100%',
            backgroundColor: progressColor,
            transition: 'width 0.5s ease, background-color 0.5s ease'
          }} />
        </div>

        <div className="num" style={{ marginTop: '6px', fontSize: '0.8rem', color: 'var(--ink-4)' }}>
          {progressPercent.toFixed(0)}% הוחזר
        </div>

        <div style={statsRowStyle}>
          <div>
            <span style={statLabelStyle}>החזר חודשי</span>
            <span className="num" style={statValueStyle}>₪{Number(loan.monthly_payment).toLocaleString()}</span>
          </div>
          <div style={{ textAlign: 'center' }}>
            <span style={statLabelStyle}>תשלומים שנותרו</span>
            <span className="num" style={statValueStyle}>{loan.remaining_installments ?? '−'}</span>
          </div>
          <div style={{ textAlign: 'left' }}>
            <span style={statLabelStyle}>סיום משוער</span>
            <span style={statValueStyle}>{loan.end_date || '−'}</span>
          </div>
        </div>

        <div style={{ ...statsRowStyle, marginTop: 0, paddingTop: '10px' }}>
          <div>
            <span style={statLabelStyle}>תאריך התחלה</span>
            <span style={statValueStyle}>{loan.start_date || '−'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const cardStyle = {
  backgroundColor: 'var(--surface-2)',
  borderRadius: 'var(--r-16)',
  padding: 'var(--s-24)',
  boxShadow: 'var(--shadow-sm)',
  border: '1px solid var(--border)',
  transition: 'transform 0.2s',
  display: 'flex',
  flexDirection: 'column',
  gap: '15px',
};

const iconWrapperStyle = {
  padding: '10px',
  backgroundColor: 'var(--primary-soft)',
  borderRadius: 'var(--r-10)',
  color: 'var(--primary-hi)',
};

const progressBarBgStyle = {
  width: '100%',
  height: '6px',
  backgroundColor: 'var(--surface-3)',
  borderRadius: 'var(--r-6)',
  overflow: 'hidden',
};

const statsRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  marginTop: '15px',
  paddingTop: '15px',
  borderTop: '1px solid var(--border)',
};

const statLabelStyle = {
  display: 'block',
  fontSize: '0.8rem',
  color: 'var(--ink-4)',
};

const statValueStyle = {
  fontWeight: '600',
  color: 'var(--ink-2)',
};

export default LoanCard;
