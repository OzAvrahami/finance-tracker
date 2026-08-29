const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/;

const decimalParts = (value) => {
  let text;
  if (typeof value === 'string') {
    text = value.trim();
  } else if (typeof value === 'bigint') {
    text = value.toString();
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    // Numeric callers are legacy presentation-only paths. Canonical funded-budget
    // values cross the API as strings and never take this compatibility branch.
    text = value.toFixed(2);
  } else {
    throw new TypeError(`Invalid decimal money value: ${String(value)}`);
  }

  const match = text.match(DECIMAL_PATTERN);
  if (!match) throw new TypeError(`Invalid decimal money value: ${text}`);
  return {
    negative: match[1] === '-',
    whole: match[2].replace(/^0+(?=\d)/, ''),
    fraction: match[3] || '',
  };
};

export const moneyToMinorUnits = (value) => {
  const { negative, whole, fraction } = decimalParts(value);
  if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2))) {
    throw new RangeError('Money value has more than two decimal places');
  }
  const minor = BigInt(whole) * 100n + BigInt((fraction.slice(0, 2) || '').padEnd(2, '0'));
  return negative && minor !== 0n ? -minor : minor;
};

export const moneyFromMinorUnits = (minorUnits) => {
  const minor = BigInt(minorUnits);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
};

export const addMoney = (first, second) => (
  moneyFromMinorUnits(moneyToMinorUnits(first) + moneyToMinorUnits(second))
);

export const subtractMoney = (first, second) => (
  moneyFromMinorUnits(moneyToMinorUnits(first) - moneyToMinorUnits(second))
);

export const compareMoney = (first, second = '0.00') => {
  const firstMinor = moneyToMinorUnits(first);
  const secondMinor = moneyToMinorUnits(second);
  return firstMinor < secondMinor ? -1 : firstMinor > secondMinor ? 1 : 0;
};

export const decimalSign = (value) => {
  const { negative, whole, fraction } = decimalParts(value);
  const isZero = !/[1-9]/.test(`${whole}${fraction}`);
  if (isZero) return 0;
  return negative ? -1 : 1;
};

export const absoluteMoney = (value) => {
  const minor = moneyToMinorUnits(value);
  return moneyFromMinorUnits(minor < 0n ? -minor : minor);
};

export const approximateMoneyRatio = (numerator, denominator) => {
  const denominatorMinor = moneyToMinorUnits(denominator);
  if (denominatorMinor === 0n) return 0;
  const numeratorMinor = moneyToMinorUnits(numerator);
  const scaled = (numeratorMinor * 10000n) / denominatorMinor;
  return Number(scaled) / 100;
};

export const formatDecimalMoney = (
  value,
  { minimumFractionDigits, maximumFractionDigits = 20 } = {},
) => {
  const parts = decimalParts(value);
  const boundedMax = Math.min(Math.max(Number(maximumFractionDigits) || 0, 0), 20);
  const requestedMin = minimumFractionDigits === undefined
    ? (typeof value === 'string' ? Math.min(parts.fraction.length, boundedMax) : 0)
    : Number(minimumFractionDigits);
  const boundedMin = Math.min(Math.max(Number.isFinite(requestedMin) ? requestedMin : 0, 0), boundedMax);

  let keptFraction = parts.fraction.slice(0, boundedMax).padEnd(boundedMax, '0');
  let scaled = BigInt(parts.whole) * (10n ** BigInt(boundedMax));
  if (boundedMax > 0) scaled += BigInt(keptFraction || '0');
  if (parts.fraction.length > boundedMax && Number(parts.fraction[boundedMax]) >= 5) scaled += 1n;

  const scale = 10n ** BigInt(boundedMax);
  const whole = (scaled / scale).toString();
  keptFraction = boundedMax > 0 ? (scaled % scale).toString().padStart(boundedMax, '0') : '';
  while (keptFraction.length > boundedMin && keptFraction.endsWith('0')) {
    keptFraction = keptFraction.slice(0, -1);
  }
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = parts.negative && scaled !== 0n ? '-' : '';
  return `${sign}${groupedWhole}${keptFraction ? `.${keptFraction}` : ''}`;
};
