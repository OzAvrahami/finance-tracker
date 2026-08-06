import React from 'react';
import TechnicalValue from './TechnicalValue';

const currencyMarks = {
  ILS: '₪',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

const suppliedFractionDigits = (value) => {
  if (typeof value !== 'string') return 0;
  const match = value.trim().match(/^[+-]?\d+\.(\d+)$/);
  return match ? Math.min(match[1].length, 20) : 0;
};

/**
 * Displays a caller-supplied monetary value without changing business data.
 * Numeric strings keep explicitly supplied trailing decimal places.
 */
const MoneyAmount = ({
  value,
  signed = false,
  colorize = false,
  size,
  currency = 'ILS',
  currencyMark,
  minimumFractionDigits,
  maximumFractionDigits = 20,
  style,
  className = '',
  ...props
}) => {
  const parsed = Number(value);
  const amount = Number.isFinite(parsed) ? parsed : 0;
  const isNegative = amount < 0;
  const isPositive = amount > 0;
  const color = colorize
    ? (isNegative ? 'var(--ft-negative)' : 'var(--ft-positive)')
    : 'inherit';
  const sign = isNegative ? '−' : (signed && isPositive ? '+' : '');
  const mark = currencyMark ?? (currency === false ? '' : (currencyMarks[currency] ?? `${currency} `));
  const explicitFractionDigits = suppliedFractionDigits(value);
  const requestedMinDigits = minimumFractionDigits ?? explicitFractionDigits;
  const minDigits = Math.min(Math.max(Number(requestedMinDigits) || 0, 0), 20);
  const requestedMaxDigits = Number(maximumFractionDigits);
  const boundedMaxDigits = Number.isFinite(requestedMaxDigits)
    ? Math.min(Math.max(requestedMaxDigits, 0), 20)
    : 20;
  const maxDigits = Math.max(minDigits, boundedMaxDigits);
  const formatted = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: minDigits,
    maximumFractionDigits: maxDigits,
  });

  return (
    <TechnicalValue
      {...props}
      className={`num ${className}`.trim()}
      style={{ color, fontSize: size, ...style }}
    >
      {sign}{mark}{formatted}
    </TechnicalValue>
  );
};

export default MoneyAmount;
