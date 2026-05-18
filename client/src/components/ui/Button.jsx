import React from 'react';

const sizes = {
  sm: { padding: '6px 14px',  fontSize: 'var(--fs-13)' },
  md: { padding: '9px 18px',  fontSize: 'var(--fs-14)' },
  lg: { padding: '12px 24px', fontSize: 'var(--fs-16)' },
};

const base = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--s-6)',
  fontFamily: 'var(--font-ui)',
  fontWeight: 600,
  borderRadius: 'var(--r-8)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  border: 'none',
  textDecoration: 'none',
};

export const PrimaryButton = ({ children, size = 'md', style, className = '', ...props }) => (
  <button
    className={`ui-btn-primary ${className}`}
    style={{
      ...base,
      ...sizes[size],
      background: 'var(--primary-grad)',
      color: 'var(--primary-ink)',
      boxShadow: '0 0 16px rgba(124,92,255,0.25)',
      ...style,
    }}
    {...props}
  >
    {children}
  </button>
);

export const SecondaryButton = ({ children, size = 'md', style, className = '', ...props }) => (
  <button
    className={`ui-btn-secondary ${className}`}
    style={{
      ...base,
      ...sizes[size],
      background: 'transparent',
      color: 'var(--ink-2)',
      border: '1px solid var(--border-strong)',
      ...style,
    }}
    {...props}
  >
    {children}
  </button>
);

export const GhostButton = ({ children, size = 'md', style, className = '', ...props }) => (
  <button
    className={`ui-btn-secondary ${className}`}
    style={{
      ...base,
      ...sizes[size],
      background: 'transparent',
      color: 'var(--ink-3)',
      border: '1px solid transparent',
      ...style,
    }}
    {...props}
  >
    {children}
  </button>
);

export default PrimaryButton;
