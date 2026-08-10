const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTransactionPricing,
  fromMinorUnits,
  toMinorUnits,
} = require('../utils/transactionPricing');
const {
  createMockResponse,
  loadControllerWithFake,
} = require('./helpers/fakeSupabase');

const item = (overrides = {}) => ({
  item_name: 'LEGO set',
  quantity: 1,
  price_per_unit: '200.00',
  discount_type: 'amount',
  discount_value: '0',
  acquisition_type: 'purchased',
  ...overrides,
});

const money = (value) => fromMinorUnits(value);

test('three-stage item pricing preserves original, receipt, and actual paid amounts', () => {
  const noDiscount = buildTransactionPricing([item()], '0', '200');
  assert.equal(money(noDiscount.items[0].originalUnitCents), '200.00');
  assert.equal(money(noDiscount.items[0].receiptUnitCents), '200.00');
  assert.equal(money(noDiscount.items[0].actualLineCents), '200.00');

  const sale = buildTransactionPricing([item({ discount_value: '110' })], '0', '90');
  assert.equal(money(sale.items[0].originalUnitCents), '200.00');
  assert.equal(money(sale.items[0].receiptUnitCents), '90.00');
  assert.equal(money(sale.items[0].actualLineCents), '90.00');

  const saleAndPoints = buildTransactionPricing([item({ discount_value: '110' })], '20', '70');
  assert.equal(money(saleAndPoints.items[0].receiptUnitCents), '90.00');
  assert.equal(money(saleAndPoints.items[0].allocatedGlobalDiscountCents), '20.00');
  assert.equal(money(saleAndPoints.items[0].actualLineCents), '70.00');
});

test('real receipt allocation reconciles exactly to 547.67 ILS', () => {
  const prices = ['295.76', '168.64', '75.42', '100.85'];
  const pricing = buildTransactionPricing(
    prices.map((price, index) => item({ item_name: `Set ${index + 1}`, price_per_unit: price })),
    '93.00',
    '547.67',
  );

  assert.deepEqual(
    pricing.items.map((pricedItem) => money(pricedItem.allocatedGlobalDiscountCents)),
    ['42.93', '24.48', '10.95', '14.64'],
  );
  assert.deepEqual(
    pricing.items.map((pricedItem) => money(pricedItem.actualLineCents)),
    ['252.83', '144.16', '64.47', '86.21'],
  );
  assert.equal(money(pricing.actualTotalCents), '547.67');
  assert.equal(
    money(pricing.items.reduce((sum, pricedItem) => sum + pricedItem.actualLineCents, 0n)),
    '547.67',
  );
});

test('rounding remainder uses largest remainder and stable item order for ties', () => {
  const pricing = buildTransactionPricing([
    item({ item_name: 'First', price_per_unit: '1' }),
    item({ item_name: 'Second', price_per_unit: '1' }),
    item({ item_name: 'Third', price_per_unit: '1' }),
  ], '0.01', '2.99');

  assert.deepEqual(
    pricing.items.map((pricedItem) => money(pricedItem.allocatedGlobalDiscountCents)),
    ['0.01', '0.00', '0.00'],
  );
});

test('gift/GWP lines remain zero and receive no global allocation', () => {
  const pricing = buildTransactionPricing([
    item({ price_per_unit: '100', discount_value: '0' }),
    item({
      item_name: 'GWP',
      price_per_unit: '109.32',
      discount_type: 'percent',
      discount_value: '100',
      acquisition_type: 'gift',
    }),
  ], '10', '90');

  assert.equal(money(pricing.items[1].originalUnitCents), '109.32');
  assert.equal(money(pricing.items[1].receiptUnitCents), '0.00');
  assert.equal(money(pricing.items[1].allocatedGlobalDiscountCents), '0.00');
  assert.equal(money(pricing.items[1].actualLineCents), '0.00');
});

test('non-LEGO paid lines participate in the global discount denominator', () => {
  const pricing = buildTransactionPricing([
    item({ item_name: 'LEGO', price_per_unit: '90' }),
    item({ item_name: 'Other product', price_per_unit: '10', set_number: '' }),
  ], '20', '80');

  assert.deepEqual(
    pricing.items.map((pricedItem) => money(pricedItem.allocatedGlobalDiscountCents)),
    ['18.00', '2.00'],
  );
});

test('invalid global discounts are rejected before persistence', () => {
  assert.throws(
    () => buildTransactionPricing([item({ price_per_unit: '10' })], '-1', '11'),
    /cannot be negative/,
  );
  assert.throws(
    () => buildTransactionPricing([item({ price_per_unit: '10' })], '11', '0'),
    /cannot exceed/,
  );
  assert.throws(
    () => buildTransactionPricing([
      item({ price_per_unit: '10', discount_type: 'percent', discount_value: '100', acquisition_type: 'gift' }),
    ], '1', '0'),
    /requires at least one eligible/,
  );
});

test('minor-unit conversion preserves explicit zero and rounds floating artifacts', () => {
  assert.equal(toMinorUnits(0), 0n);
  assert.equal(toMinorUnits(null), 0n);
  assert.equal(money(toMinorUnits(252.04999999999995)), '252.05');
});

function createWriteFake() {
  const inserts = { transactions: [], transaction_items: [], lego_sets: [] };
  return {
    inserts,
    from(table) {
      if (table === 'categories') {
        return {
          select() {
            return { eq: () => ({ single: async () => ({ data: { name: 'Lego' }, error: null }) }) };
          },
        };
      }

      return {
        insert(rows) {
          inserts[table].push(...rows);
          if (table === 'transactions') {
            return { select: async () => ({ data: [{ ...rows[0], id: 321 }], error: null }) };
          }
          return Promise.resolve({ data: rows, error: null });
        },
      };
    },
  };
}

test('create transaction persists allocation provenance and the real LEGO transaction id', async () => {
  const fake = createWriteFake();
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();
  const items = [
    item({ item_name: 'Discounted set', price_per_unit: '200', discount_value: '110', set_number: '12345-1' }),
    item({ item_name: 'Other product', price_per_unit: '10', set_number: '' }),
    item({
      item_name: 'GWP',
      price_per_unit: '109.32',
      discount_type: 'percent',
      discount_value: '100',
      acquisition_type: 'gift',
      set_number: '40649-1',
    }),
  ];

  await controller.createTransaction({ body: {
    transaction: {
      description: 'LEGO receipt purchase',
      movement_type: 'expense',
      category_id: 2,
      total_amount: '80.00',
      global_discount: '20.00',
      global_discount_source: 'loyalty_points',
      payment_source_id: 10,
      transaction_date: '2026-08-10',
      charge_date: '2026-08-10',
      installment_count: 1,
    },
    items,
  } }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(fake.inserts.transactions[0].global_discount_source, 'loyalty_points');
  assert.deepEqual(
    fake.inserts.transaction_items.map((row) => row.allocated_global_discount),
    ['18.00', '2.00', '0.00'],
  );
  assert.deepEqual(
    fake.inserts.transaction_items.map((row) => row.acquisition_type),
    ['purchased', 'purchased', 'gift'],
  );

  const paidSet = fake.inserts.lego_sets.find((set) => set.set_number === '12345-1');
  assert.equal(paidSet.original_price, '200.00');
  assert.equal(paidSet.receipt_price, '90.00');
  assert.equal(paidSet.purchase_price, '72.00');
  assert.equal(paidSet.transaction_id, 321);

  const gift = fake.inserts.lego_sets.find((set) => set.set_number === '40649-1');
  assert.equal(gift.original_price, '109.32');
  assert.equal(gift.receipt_price, '0.00');
  assert.equal(gift.purchase_price, '0.00');
  assert.equal(gift.acquisition_type, 'gift');
  assert.equal(gift.transaction_id, 321);
});

test('legacy transaction payloads default to purchased items and a null discount source', async () => {
  const fake = createWriteFake();
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();

  await controller.createTransaction({ body: {
    transaction: {
      description: 'Legacy payload remains compatible',
      movement_type: 'expense',
      category_id: 2,
      total_amount: '25',
      global_discount: 0,
      transaction_date: '2026-08-10',
      installment_count: 1,
    },
    items: [item({ price_per_unit: '25', set_number: '10000-1', acquisition_type: undefined })],
  } }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(fake.inserts.transactions[0].global_discount_source, null);
  assert.equal(fake.inserts.transaction_items[0].acquisition_type, 'purchased');
  assert.equal(fake.inserts.lego_sets[0].receipt_price, '25.00');
});

test('controller rejects an unreconcilable global discount before writing', async () => {
  const fake = createWriteFake();
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await controller.createTransaction({ body: {
      transaction: {
        total_amount: '0',
        global_discount: '11',
        installment_count: 1,
      },
      items: [item({ price_per_unit: '10' })],
    } }, res);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /cannot exceed/);
  assert.equal(fake.inserts.transactions.length, 0);
});
