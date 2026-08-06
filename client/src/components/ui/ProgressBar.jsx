import React from 'react';

const fills = {
  primary: {
    background: 'linear-gradient(90deg, var(--ft-primary-strong), var(--ft-primary-hover))',
    boxShadow: '0 0 8px var(--ft-primary-glow)',
  },
  pos: { background: 'var(--ft-positive)' },
  warn: { background: 'var(--ft-warning)' },
  neg: { background: 'var(--ft-negative)' },
};

const ProgressBar = ({
  value,
  min = 0,
  max = 100,
  tone = 'primary',
  height = 6,
  label,
  style,
  className = '',
  ...props
}) => {
  const numericValue = Number(value);
  const numericMin = Number(min);
  const numericMax = Number(max);
  const safeValue = Number.isFinite(numericValue) ? numericValue : 0;
  const safeMin = Number.isFinite(numericMin) ? numericMin : 0;
  const safeMax = Number.isFinite(numericMax) && numericMax > safeMin ? numericMax : 100;
  const rawPercent = ((safeValue - safeMin) / (safeMax - safeMin)) * 100;
  const visualPercent = Math.min(Math.max(rawPercent, 0), 100);
  const fill = fills[tone] ?? fills.primary;
  const accessibleName = props['aria-label']
    || (props['aria-labelledby'] ? undefined : (label || 'התקדמות'));

  return (
    <div
      {...props}
      className={className.trim()}
      role="progressbar"
      aria-label={accessibleName}
      aria-valuenow={safeValue}
      aria-valuemin={safeMin}
      aria-valuemax={safeMax}
      style={{
        height,
        backgroundColor: 'var(--ft-track)',
        borderRadius: 'var(--ft-radius-pill)',
        overflow: 'hidden',
        border: '1px solid var(--ft-border)',
        ...style,
      }}
    >
      <div
        data-progress-fill
        aria-hidden="true"
        style={{
          height: '100%',
          width: `${visualPercent}%`,
          borderRadius: 'var(--ft-radius-pill)',
          transition: `width var(--ft-motion-slow) var(--ft-ease-standard)`,
          ...fill,
        }}
      />
    </div>
  );
};

export default ProgressBar;
