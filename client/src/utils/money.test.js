import { describe, expect, it } from 'vitest';
import {
  addMoney,
  compareMoney,
  formatDecimalMoney,
  moneyFromMinorUnits,
  moneyToMinorUnits,
  subtractMoney,
} from './money';

describe('exact money transport helpers', () => {
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
