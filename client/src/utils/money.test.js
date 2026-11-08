import { describe, expect, it } from 'vitest';
import {
  addMoney,
  compareMoney,
  formatDecimalMoney,
  moneyFromMinorUnits,
  moneyToMinorUnits,
  normalizeMoneyForDisplay,
  subtractMoney,
} from './money';

describe('exact money transport helpers', () => {
  it('normalizes display scale exactly without rounding invalid precision', () => {
    expect(normalizeMoneyForDisplay('-557.5500000000000000')).toBe('-557.55');
    expect(normalizeMoneyForDisplay('9007199254740993.010000')).toBe('9007199254740993.01');
    expect(normalizeMoneyForDisplay(25)).toBe('25.00');
    expect(normalizeMoneyForDisplay('149.001')).toBe('149.001');
    expect(normalizeMoneyForDisplay(149.001)).toBe('149.001');
    expect(normalizeMoneyForDisplay('')).toBe('');
    expect(normalizeMoneyForDisplay('invalid')).toBe('invalid');
  });

  it('preserves values above JavaScript safe integer range', () => {
    const value = '9007199254740993.01';
    expect(moneyToMinorUnits(value)).toBe(900719925474099301n);
    expect(moneyFromMinorUnits(900719925474099301n)).toBe(value);
    expect(formatDecimalMoney(value, { maximumFractionDigits: 2 }))
      .toBe('9,007,199,254,740,993.01');
  });

  it('adds and subtracts decimal-artifact cases in integer minor units', () => {
    expect(addMoney('0.10', '0.20')).toBe('0.30');
    expect(subtractMoney('9007199254740993.31', '0.30')).toBe('9007199254740993.01');
    expect(compareMoney('0.30', '0.3')).toBe(0);
  });

  it('rejects non-canonical precision instead of silently rounding authority', () => {
    expect(() => moneyToMinorUnits('1.001')).toThrow(/two decimal places/i);
    expect(() => moneyToMinorUnits('NaN')).toThrow(/invalid decimal/i);
  });
});
