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

  it('excludes sold sets from collection statistics', () => {
    const sets = [
      {
        set_number: '42207',
        status: 'Sold',
        theme: 'Technic',
        purchase_price: 574.60,
        original_price: 650,
      },
      {
        set_number: '10305',
        status: 'Built',
        theme: 'Icons',
        purchase_price: 100,
        original_price: 150,
      },
    ];

    expect(calculateStats(sets)).toEqual({
      totalSets: 1,
      totalMinifigs: 0,
      totalListPrice: 150,
      totalPaid: 100,
      totalSaved: 50,
    });
  });

  it('excludes sold minifigures but preserves legacy statuses and price fallbacks without mutating records', () => {
    const sets = [
      { status: 'Sold', theme: 'Collectible Minifigures', original_price: 100, purchase_price: 70 },
      { status: null, theme: 'Collectible Minifigures', original_price: 0, purchase_price: '15.50' },
      { status: '', theme: 'City', original_price: null, purchase_price: '574.60' },
      { theme: null, original_price: 20, purchase_price: null },
    ];
    const before = structuredClone(sets);
    expect(calculateStats(sets)).toEqual({ totalSets: 2, totalMinifigs: 1, totalListPrice: 610.1, totalPaid: 590.1, totalSaved: 20 });
    expect(sets).toEqual(before);
    expect(calculateStats([sets[0]])).toEqual({ totalSets: 0, totalMinifigs: 0, totalListPrice: 0, totalPaid: 0, totalSaved: 0 });
  });
});
