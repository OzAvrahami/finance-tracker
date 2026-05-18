import React from 'react';

const sizeMap = { sm: 30, md: 36, lg: 40 };

const IconButton = ({ children, size = 'md', style, className = '', title, ...props }) => {
  const dim = typeof size === 'number' ? size : (sizeMap[size] ?? 36);
  return (
    <button
      className={`ui-icon-btn ${className}`}
      title={title}
      style={{
        width: dim,
        height: dim,
        flexShrink: 0,
        padding: 0,
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-8)',
        backgroundColor: 'var(--surface-3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--ink-3)',
        cursor: 'pointer',
        fontFamily: 'var(--font-ui)',
        ...style,
      }}
      {...props}
    >
      {children}
    </button>
  );
};

export default IconButton;
