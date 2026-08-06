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
  minHeight: 36,
  borderRadius: 'var(--ft-radius-sm)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  border: 'none',
  textDecoration: 'none',
};

const renderContent = (children, loading, loadingText) => (
  <>
    {loading && <span className="ui-button-spinner" aria-hidden="true" />}
    {loading && loadingText ? loadingText : children}
  </>
);

export const PrimaryButton = ({
  children,
  size = 'md',
  style,
  className = '',
  loading = false,
  loadingText,
  fullWidth = false,
  disabled = false,
  ...props
}) => (
  <button
    {...props}
    className={`ui-btn-primary ${className}`.trim()}
    style={{
      ...base,
      ...sizes[size],
      width: fullWidth ? '100%' : undefined,
      background: 'var(--ft-primary-gradient)',
      color: 'var(--ft-on-primary)',
      boxShadow: '0 0 16px var(--ft-primary-weak)',
      ...style,
    }}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    data-loading={loading || undefined}
  >
    {renderContent(children, loading, loadingText)}
  </button>
);

export const SecondaryButton = ({
  children,
  size = 'md',
  style,
  className = '',
  loading = false,
  loadingText,
  fullWidth = false,
  disabled = false,
  ...props
}) => (
  <button
    {...props}
    className={`ui-btn-secondary ${className}`.trim()}
    style={{
      ...base,
      ...sizes[size],
      width: fullWidth ? '100%' : undefined,
      background: 'transparent',
      color: 'var(--ft-text-muted)',
      border: '1px solid var(--ft-border-strong)',
      ...style,
    }}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    data-loading={loading || undefined}
  >
    {renderContent(children, loading, loadingText)}
  </button>
);

export const GhostButton = ({
  children,
  size = 'md',
  style,
  className = '',
  loading = false,
  loadingText,
  fullWidth = false,
  disabled = false,
  ...props
}) => (
  <button
    {...props}
    className={`ui-btn-secondary ${className}`.trim()}
    style={{
      ...base,
      ...sizes[size],
      width: fullWidth ? '100%' : undefined,
      background: 'transparent',
      color: 'var(--ft-text-muted)',
      border: '1px solid transparent',
      ...style,
    }}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    data-loading={loading || undefined}
  >
    {renderContent(children, loading, loadingText)}
  </button>
);

export default PrimaryButton;
