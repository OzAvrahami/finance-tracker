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
        select() {
          return {
            in: async (field, values) => ({
              data: (inserts[table] || []).filter((row) => values.includes(row[field])),
              error: null,
            }),
          };
        },
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

function createUpdateSyncFake(initialLinkedSets = [], options = {}) {
  const state = {
    transactions: [{ id: 42 }],
    transaction_items: [],
    lego_sets: initialLinkedSets.map((set) => ({ ...set })),
  };
  let nextLegoId = 1000;
  const queries = [];
  const categoryIds = [];

  return {
    state,
    queries,
    categoryIds,
    from(table) {
      if (table === 'categories') {
        return {
          select() {
            return {
              eq: (_field, value) => {
                categoryIds.push(value);
                return {
                  single: async () => ({ data: { name: options.categoryName || 'Lego' }, error: null }),
                };
              },
            };
          },
        };
      }

      return {
        select() {
          return {
            in: async (field, values) => {
              queries.push({ table, field, values: [...values] });
              return {
                data: state[table].filter((row) => values.includes(row[field])).map((row) => ({ ...row })),
                error: options.failExistenceQuery && table === 'lego_sets'
                  ? { code: 'QUERY_FAILED', message: 'existence query failed' }
                  : null,
              };
            },
          };
        },
        update(payload) {
          return {
            eq: async (field, value) => {
              state[table] = state[table].map((row) => (
                String(row[field]) === String(value) ? { ...row, ...payload } : row
              ));
              return { error: null };
            },
          };
        },
        delete() {
          return {
            eq: async (field, value) => {
              state[table] = state[table].filter((row) => String(row[field]) !== String(value));
              return { error: null };
            },
          };
        },
        insert(rows) {
          if (table === 'lego_sets' && options.failLegoInsert) {
            return Promise.resolve({ data: null, error: { code: 'INSERT_FAILED', message: 'insert failed' } });
          }
          const inserted = rows.map((row) => (
            table === 'lego_sets' ? { id: nextLegoId += 1, ...row } : { ...row }
          ));
          state[table].push(...inserted);
          return Promise.resolve({ data: inserted, error: null });
        },
      };
    },
  };
}

const updateRequest = (items, overrides = {}) => ({
  params: { id: '42' },
  body: {
    transaction: {
      description: 'Updated LEGO receipt',
      movement_type: 'expense',
      category_id: 2,
      total_amount: '180.00',
      global_discount: '20.00',
      global_discount_source: 'loyalty_points',
      transaction_date: '2026-08-11',
      ...overrides,
    },
    items,
  },
});

test('updating a transaction creates each current LEGO set once and remains idempotent', async () => {
  const fake = createUpdateSyncFake();
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const items = [
    item({ item_name: 'Sale set', price_per_unit: '200', discount_value: '110', set_number: '12345-1' }),
    item({ item_name: 'Second set', price_per_unit: '10', set_number: '22222-1' }),
    item({
      item_name: 'GWP',
      price_per_unit: '109.32',
      discount_type: 'percent',
      discount_value: '100',
      acquisition_type: 'gift',
      set_number: '40649-1',
    }),
    item({ item_name: 'Non-LEGO product', price_per_unit: '100', set_number: '' }),
  ];

  const firstResponse = createMockResponse();
  await controller.updateTransaction(updateRequest(items), firstResponse);
  assert.equal(firstResponse.statusCode, 200);
  assert.deepEqual(fake.categoryIds, [2]);
  assert.equal(fake.state.lego_sets.length, 3);

  const paidSet = fake.state.lego_sets.find((set) => set.set_number === '12345-1');
  assert.equal(paidSet.original_price, '200.00');
  assert.equal(paidSet.receipt_price, '90.00');
  assert.equal(paidSet.purchase_price, '81.00');
  assert.equal(paidSet.transaction_id, '42');

  const gift = fake.state.lego_sets.find((set) => set.set_number === '40649-1');
  assert.equal(gift.acquisition_type, 'gift');
  assert.equal(gift.receipt_price, '0.00');
  assert.equal(gift.purchase_price, '0.00');
  assert.equal(fake.state.lego_sets.some((set) => set.name === 'Non-LEGO product'), false);

  const secondResponse = createMockResponse();
  await controller.updateTransaction(updateRequest(items), secondResponse);
  assert.equal(secondResponse.statusCode, 200);
  assert.equal(fake.state.lego_sets.length, 3);
  assert.equal(fake.state.lego_sets.filter((set) => set.set_number === '12345-1').length, 1);
});

test('existing collection set numbers are skipped without overwriting any record fields', async () => {
  const fake = createUpdateSyncFake([
    {
      id: 'linked-set',
      transaction_id: '42',
      set_number: '12345-1',
      name: 'Old name',
      status: 'Built',
      market_value: '350.00',
      piece_count: 999,
      image_url: 'https://example.test/manual-image.png',
      brand: 'CaDA',
      purchase_price: '200.00',
    },
    {
      id: 'removed-line-set',
      transaction_id: '42',
      set_number: '99999-1',
      name: 'Manually enriched removed line',
      status: 'In Progress',
      market_value: '500.00',
    },
  ]);
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();

  await controller.updateTransaction(updateRequest([
    item({
      item_name: 'Updated name',
      price_per_unit: '200',
      discount_value: '110',
      set_number: '12345-1',
      theme: 'Updated theme',
      brand: undefined,
    }),
  ], { total_amount: '70.00' }), res);

  assert.equal(res.statusCode, 200);
  const updated = fake.state.lego_sets.find((set) => set.id === 'linked-set');
  assert.equal(updated.name, 'Old name');
  assert.equal(updated.original_price, undefined);
  assert.equal(updated.receipt_price, undefined);
  assert.equal(updated.purchase_price, '200.00');
  assert.equal(updated.status, 'Built');
  assert.equal(updated.market_value, '350.00');
  assert.equal(updated.piece_count, 999);
  assert.equal(updated.image_url, 'https://example.test/manual-image.png');
  assert.equal(updated.brand, 'CaDA');

  const removed = fake.state.lego_sets.find((set) => set.id === 'removed-line-set');
  assert.equal(removed.name, 'Manually enriched removed line');
  assert.equal(removed.market_value, '500.00');
});

test('manual and other-transaction collection records are skipped by collection-wide set number', async () => {
  const fake = createUpdateSyncFake([
    {
      id: 'manual-set',
      transaction_id: null,
      set_number: '12345-1',
      name: 'Manual collection record',
      purchase_price: '999.00',
      market_value: '1200.00',
      status: 'Built',
    },
    {
      id: 'other-transaction-set',
      transaction_id: 999,
      set_number: '22222-1',
      name: 'Other transaction record',
      purchase_price: '88.00',
    },
  ]);
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();

  await controller.updateTransaction(updateRequest([
    item({ item_name: 'Should not overwrite manual', price_per_unit: '100', set_number: '12345-1' }),
    item({ item_name: 'Should not overwrite other transaction', price_per_unit: '100', set_number: '22222-1' }),
    item({
      item_name: 'Missing GWP',
      price_per_unit: '109.32',
      discount_type: 'percent',
      discount_value: '100',
      acquisition_type: 'gift',
      set_number: '40649-1',
    }),
  ], { total_amount: '200.00', global_discount: 0, global_discount_source: null }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(fake.state.lego_sets.length, 3);
  assert.equal(fake.state.lego_sets.find((set) => set.id === 'manual-set').name, 'Manual collection record');
  assert.equal(fake.state.lego_sets.find((set) => set.id === 'manual-set').purchase_price, '999.00');
  assert.equal(fake.state.lego_sets.find((set) => set.id === 'other-transaction-set').transaction_id, 999);
  const gift = fake.state.lego_sets.find((set) => set.set_number === '40649-1');
  assert.equal(gift.transaction_id, '42');
  assert.equal(gift.acquisition_type, 'gift');
  assert.equal(gift.receipt_price, '0.00');
  assert.equal(gift.purchase_price, '0.00');
  assert.deepEqual(fake.queries.find((query) => query.table === 'lego_sets'), {
    table: 'lego_sets',
    field: 'set_number',
    values: ['12345-1', '22222-1', '40649-1'],
  });
});

test('a non-LEGO transaction does not create collection records even when a set number is present', async () => {
  const fake = createUpdateSyncFake([], { categoryName: 'Other' });
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();

  await controller.updateTransaction(updateRequest([
    item({ price_per_unit: '10', set_number: '12345-1' }),
  ], { total_amount: '10.00', global_discount: 0, global_discount_source: null }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(fake.state.lego_sets.length, 0);
  assert.equal(fake.queries.some((query) => query.table === 'lego_sets'), false);
});

test('a LEGO insert failure is logged and cannot produce a successful update response', async () => {
  const fake = createUpdateSyncFake([], { failLegoInsert: true });
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    await controller.updateTransaction(updateRequest([
      item({ price_per_unit: '10', set_number: '12345-1' }),
    ], { total_amount: '10.00', global_discount: 0, global_discount_source: null }), res);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Failed to synchronize LEGO collection');
  assert.equal(fake.state.lego_sets.length, 0);
  assert.equal(logged.some(([message]) => message === 'LEGO synchronization insert failed'), true);
});
