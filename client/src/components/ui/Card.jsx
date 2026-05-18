import React from 'react';

const cardBase = {
  backgroundColor: 'var(--surface-2)',
  borderRadius: 'var(--r-16)',
  border: '1px solid var(--border)',
  boxShadow: 'var(--shadow-sm)',
};

export const Card = ({ children, padding = 'var(--s-24)', style, className = '', ...props }) => (
  <div
    className={className}
    style={{ ...cardBase, padding, ...style }}
    {...props}
  >
    {children}
  </div>
);

export const GlassCard = ({ children, padding = 'var(--s-24)', style, className = '', ...props }) => (
  <div
    className={`ui-glass ${className}`}
    style={{
      ...cardBase,
      backgroundColor: 'var(--surface-2-glass)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      padding,
      ...style,
    }}
    {...props}
  >
    {children}
  </div>
);

export default Card;
