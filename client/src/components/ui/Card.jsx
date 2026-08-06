import React from 'react';

const cardBase = {
  backgroundColor: 'var(--ft-surface-solid-secondary)',
  borderRadius: 'var(--ft-radius-xl)',
  border: '1px solid var(--ft-border)',
  boxShadow: 'var(--ft-shadow)',
};

export const Card = ({ children, padding = 'var(--s-24)', style, className = '', ...props }) => (
  <div
    className={className.trim()}
    style={{ ...cardBase, padding, ...style }}
    {...props}
  >
    {children}
  </div>
);

export const GlassCard = ({ children, padding = 'var(--s-24)', style, className = '', ...props }) => (
  <div
    className={`ui-glass ${className}`.trim()}
    style={{
      ...cardBase,
      backgroundColor: 'var(--ft-glass)',
      backdropFilter: 'var(--ft-blur)',
      WebkitBackdropFilter: 'var(--ft-blur)',
      padding,
      ...style,
    }}
    {...props}
  >
    {children}
  </div>
);

export default Card;
