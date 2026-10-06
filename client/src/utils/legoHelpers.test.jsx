import { describe, expect, it } from 'vitest';
import { calculateStats } from './legoHelpers';

describe('calculateStats', () => {
  it('counts individual minifigures from the same series and preserves financial totals', () => {
    const sets = [
      {
        set_number: '60001-1',
        theme: 'City',
        original_price: 100,
        purchase_price: 80,
      },
      {
        set_number: '71053-1',
        theme: 'Collectible Minifigures',
        subtheme: 'Shrek',
        original_price: 20,
        purchase_price: 15,
      },
      {
        set_number: '71053-2',
        theme: 'Collectible Minifigures',
        subtheme: 'Shrek',
        original_price: 20,
        purchase_price: 15,
      },
    ];

    expect(calculateStats(sets)).toMatchObject({
      totalSets: 1,
      totalMinifigs: 2,
      totalListPrice: 140,
      totalPaid: 110,
      totalSaved: 30,
    });
  });
});