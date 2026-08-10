const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMockResponse,
  loadControllerWithFake,
} = require('./helpers/fakeSupabase');

function createLegoFake() {
  const inserts = [];
  return {
    inserts,
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
      };
    },
  };
}

async function addSet(receiptPrice) {
  const fake = createLegoFake();
  const controller = loadControllerWithFake('../../controllers/legoController', fake);
  const res = createMockResponse();
  await controller.addSet({ body: {
    set_number: receiptPrice === null ? '10002-1' : '10001-1',
    name: 'Purchase fields',
    acquisition_type: 'gift',
    original_price: '109.32',
    receipt_price: receiptPrice,
    purchase_price: receiptPrice,
    market_value: '150',
  } }, res);
  return { fake, res };
}

test('direct LEGO add persists an explicitly known zero receipt and purchase price', async () => {
  const { fake, res } = await addSet(0);
  assert.equal(res.statusCode, 201);
  assert.equal(fake.inserts[0].receipt_price, 0);
  assert.equal(fake.inserts[0].purchase_price, 0);
  assert.equal(fake.inserts[0].market_value, 150);
});

test('direct LEGO add preserves unknown receipt and purchase prices as null', async () => {
  const { fake, res } = await addSet(null);
  assert.equal(res.statusCode, 201);
  assert.equal(fake.inserts[0].receipt_price, null);
  assert.equal(fake.inserts[0].purchase_price, null);
  assert.equal(fake.inserts[0].market_value, 150);
});

