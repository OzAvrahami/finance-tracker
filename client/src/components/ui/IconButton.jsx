import React from 'react';

const sizeMap = { sm: 30, md: 36, lg: 40, touch: 44 };

const IconButton = ({ children, size = 'md', style, className = '', title, ...props }) => {
  const dim = typeof size === 'number' ? size : (sizeMap[size] ?? 36);
  const hasAccessibleName = props['aria-label'] || props['aria-labelledby'] || title;

  if (!hasAccessibleName) {
    throw new Error('IconButton requires title, aria-label, or aria-labelledby.');
  }

  return (
    <button
      {...props}
      className={`ui-icon-btn ${className}`.trim()}
      title={title}
      aria-label={props['aria-label'] || (props['aria-labelledby'] ? undefined : title)}
      style={{
        width: dim,
        height: dim,
        flexShrink: 0,
        padding: 0,
        border: '1px solid var(--ft-border)',
        borderRadius: 'var(--ft-radius-control)',
        backgroundColor: 'var(--ft-glass)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--ft-text-muted)',
        cursor: 'pointer',
        fontFamily: 'var(--font-ui)',
        ...style,
      }}
    >
      {children}
    </button>
  );
};

export default IconButton;
