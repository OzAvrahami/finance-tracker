const assert = require('node:assert/strict');
const test = require('node:test');
const { createMockResponse, loadControllerWithFake } = require('./helpers/fakeSupabase');

const callSetter = async (amount, rpcError = null) => {
  const calls = [];
  const fake = {
    async rpc(name, params) {
      calls.push({ name, params });
      return { data: { category_id: 7, enabled: amount !== null, amount }, error: rpcError };
    },
  };
  const controller = loadControllerWithFake('../../controllers/settingsController', fake);
  const res = createMockResponse();
  await controller.setCategoryRecurringBudget({ params: { id: '7' }, body: { amount } }, res);
  return { calls, res };
};

test('recurring category setting accepts exact strings, explicit zero, and null disable', async () => {
  for (const amount of ['1000.00', '0', '9007199254740993.01', null]) {
    const { calls, res } = await callSetter(amount);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls, [{
      name: 'set_budget_recurring_default',
      params: { p_category_id: '7', p_amount: amount },
    }]);
  }
});

test('recurring category setting rejects numeric and malformed money before PostgreSQL', async () => {
  for (const amount of [1000, true, '', '01', '1e3', '1,000', ' 1 ', '1.001', '-1', 'NaN']) {
    const { calls, res } = await callSetter(amount);
    assert.equal(res.statusCode, 400, `accepted ${String(amount)}`);
    assert.equal(res.body.code, 'INVALID_MONEY_FORMAT');
    assert.equal(calls.length, 0);
  }
});

test('recurring category setting requires an explicit amount or null', async () => {
  const fake = { rpc: async () => assert.fail('RPC must not be called') };
  const controller = loadControllerWithFake('../../controllers/settingsController', fake);
  const res = createMockResponse();
  await controller.setCategoryRecurringBudget({ params: { id: '7' }, body: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_RECURRING_BUDGET');
});

test('settings category reads preserve recurring amounts as exact strings', async () => {
  const tables = {
    categories: [{ id: 7, name: 'Large', type: 'expense', is_active: true }],
    budget_recurring_defaults_read: [{ category_id: 7, amount_text: '9007199254740993.01' }],
  };
  const fake = {
    from(name) {
      const chain = {
        select() { return chain; },
        order() {
          if (name === 'categories' && !chain.orderedOnce) {
            chain.orderedOnce = true;
            return chain;
          }
          return Promise.resolve({ data: tables[name], error: null });
        },
        then(resolve) { return Promise.resolve({ data: tables[name], error: null }).then(resolve); },
      };
      return chain;
    },
  };
  const controller = loadControllerWithFake('../../controllers/settingsController', fake);
  const res = createMockResponse();
  await controller.getCategories({}, res);
  assert.equal(res.statusCode, null);
  assert.equal(res.body[0].recurring_budget_amount, '9007199254740993.01');
});
