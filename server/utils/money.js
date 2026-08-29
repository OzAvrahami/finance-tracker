'use strict';

const MONEY_PATTERN = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/;

const toMinorUnits = (value) => {
  const text = typeof value === 'string' ? value.trim() : String(value);
  const match = text.match(MONEY_PATTERN);
  if (!match) throw new TypeError(`Invalid canonical money value: ${text}`);
  const absolute = BigInt(match[2]) * 100n + BigInt((match[3] || '').padEnd(2, '0'));
  return match[1] === '-' && absolute !== 0n ? -absolute : absolute;
};

const fromMinorUnits = (value) => {
  const minor = BigInt(value);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
};

const add = (first, second) => fromMinorUnits(toMinorUnits(first) + toMinorUnits(second));
const subtract = (first, second) => fromMinorUnits(toMinorUnits(first) - toMinorUnits(second));
const sum = (values) => fromMinorUnits(values.reduce((total, value) => total + toMinorUnits(value), 0n));

const compare = (first, second = '0.00') => {
  const firstMinor = toMinorUnits(first);
  const secondMinor = toMinorUnits(second);
  return firstMinor < secondMinor ? -1 : firstMinor > secondMinor ? 1 : 0;
};

const divide = (value, divisor) => {
  const integerDivisor = BigInt(divisor);
  if (integerDivisor <= 0n) throw new RangeError('Money divisor must be positive');
  const minor = toMinorUnits(value);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const rounded = (absolute + (integerDivisor / 2n)) / integerDivisor;
  return fromMinorUnits(negative ? -rounded : rounded);
};

const multiply = (value, multiplier) => fromMinorUnits(toMinorUnits(value) * BigInt(multiplier));

const percentage = (numerator, denominator) => {
  const denominatorMinor = toMinorUnits(denominator);
  if (denominatorMinor === 0n) return 0;
  const numeratorMinor = toMinorUnits(numerator);
  const negative = (numeratorMinor < 0n) !== (denominatorMinor < 0n);
  const absoluteNumerator = numeratorMinor < 0n ? -numeratorMinor : numeratorMinor;
  const absoluteDenominator = denominatorMinor < 0n ? -denominatorMinor : denominatorMinor;
  const rounded = (absoluteNumerator * 100n + absoluteDenominator / 2n) / absoluteDenominator;
  return Number(negative ? -rounded : rounded);
};

module.exports = {
  add,
  compare,
  divide,
  fromMinorUnits,
  multiply,
  percentage,
  subtract,
  sum,
  toMinorUnits,
};
