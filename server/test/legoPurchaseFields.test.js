const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMockResponse,
  loadControllerWithFake,
} = require('./helpers/fakeSupabase');

function createLegoFake() {
  const inserts = [];
  const updates = [];
  return {
    inserts,
    updates,
    from(table) {
      assert.equal(table, 'lego_sets');
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: async () => ({ data: null, error: null }) };
            },
          };
        },
        insert(rows) {
          inserts.push(...rows);
          return { select: async () => ({ data: rows, error: null }) };
        },
        update(payload) {
          updates.push(payload);
          return {
            eq() {
              return { select: async () => ({ data: [payload], error: null }) };
            },
          };
        },
      };
    },
  };
}

async function addSet(acquisitionType, overrides = {}) {
  const fake = createLegoFake();
  const controller = loadControllerWithFake('../../controllers/legoController', fake);
  const res = createMockResponse();
  await controller.addSet({ body: {
    set_number: ({ purchase: '10001-1', gift: '10002-1', gwp: '10003-1' })[acquisitionType] || '10004-1',
    name: 'Acquisition model set',
    acquisition_type: acquisitionType,
    original_price: '200.00',
    receipt_price: '90.00',
    purchase_price: '70.00',
    market_value: '999.00',
    ...overrides,
  } }, res);
  return { fake, res };
}

test('direct Purchase preserves the three purchase-cost fields', async () => {
  const { fake, res } = await addSet('purchase');
  assert.equal(res.statusCode, 201);
  assert.equal(fake.inserts[0].acquisition_type, 'purchase');
  assert.equal(fake.inserts[0].original_price, 200);
  assert.equal(fake.inserts[0].receipt_price, 90);
  assert.equal(fake.inserts[0].purchase_price, 70);
});

test('direct Gift is distinct from GWP and always has zero receipt and paid cost', async () => {
  const { fake, res } = await addSet('gift');
  assert.equal(res.statusCode, 201);
  assert.equal(fake.inserts[0].acquisition_type, 'gift');
  assert.equal(fake.inserts[0].receipt_price, 0);
  assert.equal(fake.inserts[0].purchase_price, 0);
  assert.equal(fake.inserts[0].original_price, 200);
  assert.equal(Object.hasOwn(fake.inserts[0], 'transaction_id'), false);
});

test('direct GWP is explicit and always has zero receipt and paid cost', async () => {
  const { fake, res } = await addSet('gwp');
  assert.equal(res.statusCode, 201);
  assert.equal(fake.inserts[0].acquisition_type, 'gwp');
  assert.equal(fake.inserts[0].receipt_price, 0);
  assert.equal(fake.inserts[0].purchase_price, 0);
});

test('obsolete current-value input is not serialized to lego_sets', async () => {
  const { fake, res } = await addSet('purchase');
  assert.equal(res.statusCode, 201);
  assert.equal(Object.hasOwn(fake.inserts[0], 'market_value'), false);
});

test('legacy acquisition values cannot be written through the API', async () => {
  const { fake, res } = await addSet('trade');
  assert.equal(res.statusCode, 400);
  assert.equal(fake.inserts.length, 0);
});

test('edit keeps the bounded LEGO payload and enforces GWP zero cost', async () => {
  const fake = createLegoFake();
  const controller = loadControllerWithFake('../../controllers/legoController', fake);
  const res = createMockResponse();
  await controller.updateSet({ params: { id: 'set-id' }, body: {
    name: 'Updated GWP',
    acquisition_type: 'gwp',
    original_price: '109.32',
    receipt_price: '10',
    purchase_price: '10',
    market_value: '150',
  } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(fake.updates[0], {
    name: 'Updated GWP',
    acquisition_type: 'gwp',
    original_price: 109.32,
    receipt_price: 0,
    purchase_price: 0,
  });
});
