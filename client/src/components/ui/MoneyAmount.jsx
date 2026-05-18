import React from 'react';

/**
 * Renders a money value with tabular-numeral typography.
 * Props:
 *   value    – number or string, required
 *   signed   – prepend "+" for positive values (default false)
 *   colorize – apply --pos/--neg color based on sign (default false)
 *   size     – fontSize override (e.g. 'var(--fs-32)')
 *   style    – extra inline styles (overrides component defaults)
 */
const MoneyAmount = ({ value, signed = false, colorize = false, size, style, className = '' }) => {
  const n = Number(value) || 0;
  const isPos = n >= 0;
  const color = colorize ? (isPos ? 'var(--pos)' : 'var(--neg)') : 'inherit';
  const sign  = signed && n > 0 ? '+' : '';

  return (
    <span
      className={`num ${className}`}
      dir="ltr"
      style={{ color, fontSize: size, ...style }}
    >
      {sign}₪{Math.abs(n).toLocaleString()}
    </span>
  );
};

export default MoneyAmount;
