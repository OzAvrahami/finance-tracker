import { describe, expect, it } from 'vitest';
import { getTransactionPricingPreview } from './transactionPricing';

const item = (price, overrides = {}) => ({
  quantity: 1,
  price_per_unit: price,
  discount_type: 'amount',
  discount_value: 0,
  acquisition_type: 'purchase',
  ...overrides,
});

describe('transaction pricing preview', () => {
  it('matches the exact real-receipt allocation without floating artifacts', () => {
    const preview = getTransactionPricingPreview([
      item('295.76'),
      item('168.64'),
      item('75.42'),
      item('100.85'),
    ], '93.00');

    expect(preview.error).toBe('');
    expect(preview.items.map((row) => row.allocatedGlobalDiscount)).toEqual([
      '42.93',
      '24.48',
      '10.95',
      '14.64',
    ]);
    expect(preview.items.map((row) => row.actualPaid)).toEqual([
      '252.83',
      '144.16',
      '64.47',
      '86.21',
    ]);
    expect(preview.totals).toEqual({
      originalSubtotal: '640.67',
      itemDiscounts: '0.00',
      receiptSubtotal: '640.67',
      globalDiscount: '93.00',
      actualTotal: '547.67',
    });
    expect(JSON.stringify(preview)).not.toMatch(/000000000|999999999/);
  });

  it('normalizes a real receipt plus a 100% discounted GWP to exact agorot', () => {
    const preview = getTransactionPricingPreview([
      item('295.76'),
      item('168.64'),
      item('75.42'),
      item('100.85'),
      item('109.32', {
        discount_type: 'percent',
        discount_value: '100',
        acquisition_type: 'gwp',
      }),
    ], '93.00');

    expect(preview.totals).toEqual({
      originalSubtotal: '749.99',
      itemDiscounts: '109.32',
      receiptSubtotal: '640.67',
      globalDiscount: '93.00',
      actualTotal: '547.67',
    });
    expect(preview.items[4]).toEqual({
      receiptPrice: '0.00',
      allocatedGlobalDiscount: '0.00',
      actualPaid: '0.00',
    });
  });

  it('excludes a zero-cost gift while retaining paid non-LEGO participation', () => {
    const preview = getTransactionPricingPreview([
      item('90'),
      item('10'),
      item('109.32', {
        discount_type: 'percent',
        discount_value: '100',
        acquisition_type: 'gift',
      }),
    ], '20');

    expect(preview.items.map((row) => row.allocatedGlobalDiscount)).toEqual(['18.00', '2.00', '0.00']);
    expect(preview.items[2]).toEqual({
      receiptPrice: '0.00',
      allocatedGlobalDiscount: '0.00',
      actualPaid: '0.00',
    });
  });
});
