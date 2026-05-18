import React from 'react';

export const DeltaChip = ({ value, suffix = '' }) => {
  const n = Number(value) || 0;
  const pos = n >= 0;
  return (
    <span
      className="num"
      dir="ltr"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--s-4)',
        fontSize: 'var(--fs-12)',
        fontWeight: 600,
        color: pos ? 'var(--pos)' : 'var(--neg)',
        backgroundColor: pos ? 'var(--pos-soft)' : 'var(--neg-soft)',
        border: `1px solid ${pos ? 'rgba(74,222,154,0.25)' : 'rgba(255,122,138,0.25)'}`,
        padding: '2px 8px',
        borderRadius: 9999,
        whiteSpace: 'nowrap',
      }}
    >
      {pos ? '+' : '−'}{Math.abs(n).toLocaleString()}{suffix}
    </span>
  );
};

export const LiveChip = () => (
  <span style={{
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.07em',
    color: 'var(--pos)',
    background: 'var(--pos-soft)',
    border: '1px solid rgba(74,222,154,0.35)',
    padding: '2px 8px',
    borderRadius: 9999,
    textTransform: 'uppercase',
  }}>
    <span style={{
      width: 6,
      height: 6,
      borderRadius: '50%',
      backgroundColor: 'var(--pos)',
      boxShadow: '0 0 6px var(--pos)',
    }} />
    Live
  </span>
);

export const CategoryChip = ({ name, color }) => (
  <span style={{
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--s-6)',
    backgroundColor: 'var(--surface-3)',
    border: '1px solid var(--border)',
    borderRadius: 9999,
    padding: '3px 10px',
    fontSize: 'var(--fs-12)',
    color: 'var(--ink-2)',
    whiteSpace: 'nowrap',
  }}>
    {color && (
      <span style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        backgroundColor: color,
        flexShrink: 0,
      }} />
    )}
    {name}
  </span>
);

export default DeltaChip;
