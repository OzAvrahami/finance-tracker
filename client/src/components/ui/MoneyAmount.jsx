import React from 'react';
import { decimalSign, formatDecimalMoney } from '../../utils/money';
import TechnicalValue from './TechnicalValue';

const currencyMarks = {
  ILS: '₪',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

/**
 * Displays a caller-supplied monetary value without changing business data.
 * Canonical decimal strings are formatted without a JavaScript Number conversion.
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
  let comparison = 0;
  let formatted = '0';
  try {
    comparison = decimalSign(value ?? '0');
    formatted = formatDecimalMoney(value ?? '0', {
      minimumFractionDigits,
      maximumFractionDigits,
    }).replace(/^-/, '');
  } catch {
    // Presentation components remain fail-safe for legacy non-budget callers.
  }
  const isNegative = comparison < 0;
  const isPositive = comparison > 0;
  const color = colorize
    ? (isNegative ? 'var(--ft-negative)' : 'var(--ft-positive)')
    : 'inherit';
  const sign = isNegative ? '−' : (signed && isPositive ? '+' : '');
  const mark = currencyMark ?? (currency === false ? '' : (currencyMarks[currency] ?? `${currency} `));
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
