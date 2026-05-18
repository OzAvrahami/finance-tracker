import React from 'react';

const fills = {
  primary: {
    background: 'linear-gradient(90deg, var(--primary-lo), var(--primary-hi))',
    boxShadow: '0 0 8px rgba(124,92,255,0.4)',
  },
  pos:  { background: 'linear-gradient(90deg, #2DB574, var(--pos))' },
  warn: { background: 'linear-gradient(90deg, #E09800, var(--warn))' },
  neg:  { background: 'linear-gradient(90deg, #C93550, var(--neg))' },
};

const ProgressBar = ({ value, max = 100, tone = 'primary', height = 6, style }) => {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const fill = fills[tone] ?? fills.primary;

  return (
    <div style={{
      height,
      backgroundColor: 'var(--surface-3)',
      borderRadius: 9999,
      overflow: 'hidden',
      border: '1px solid var(--border)',
      ...style,
    }}>
      <div style={{
        height: '100%',
        width: `${pct}%`,
        borderRadius: 9999,
        transition: 'width 0.3s ease',
        ...fill,
      }} />
    </div>
  );
};

export default ProgressBar;
