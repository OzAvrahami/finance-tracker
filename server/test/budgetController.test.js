const assert = require('node:assert/strict');
const test = require('node:test');
const { createMockResponse, loadControllerWithFake } = require('./helpers/fakeSupabase');

const state = {
  month: '2026-08',
  funding: { available: '1000.00', total_allocated: '700.00', unallocated: '300.00' },
  actuals: { total: '850.00', budgeted: '800.00', unbudgeted: '50.00' },
  categories: [
    {
      budget_id: 5, category_id: 2, lifecycle_state: 'active', starting_amount: '600.00',
      adjustment_total: '100.00', final_funded: '700.00', actual_spent: '800.00',
      remaining: '-100.00', deficit: '100.00', categories: { name: 'Fuel', type: 'expense' },
    },
    { budget_id: null, category_id: 3, lifecycle_state: 'no_budget', actual_spent: '50.00' },
  ],
  history: [{ id: 1, operation_type: 'manual_funding' }],
};

const call = async (method, request, responseData = state, responseError = null) => {
  const calls = [];
  const fake = {
    async rpc(name, params) {
      calls.push({ name, params });
      return { data: responseData, error: responseError };
    },
  };
  const controller = loadControllerWithFake('../../controllers/budgetController', fake);
  const res = createMockResponse();
  await controller[method]({ query: {}, body: {}, params: {}, ...request }, res);
  return { calls, res };
};

test('canonical monthly API returns all funded state and actuals', async () => {
  const { calls, res } = await call('getFundedBudgetMonth', { query: { month: '2026-08' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, state);
  assert.deepEqual(calls, [{ name: 'get_funded_budget_month', params: { p_month: '2026-08' } }]);
});

test('compatibility monthly API derives amount from final funded and omits inactive/no-budget', async () => {
  const { res } = await call('getBudgetsByMonth', { query: { month: '2026-08' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].amount, '700.00');
  assert.equal(res.body[0].starting_amount, '600.00');
});

test('history API exposes immutable operations without transaction duplication', async () => {
  const { res } = await call('getBudgetHistory', { query: { month: '2026-08' } });
  assert.deepEqual(res.body, { month: '2026-08', history: state.history });
  assert.equal(Object.hasOwn(res.body, 'transactions'), false);
});

test('manual funding maps the source label and request key to one RPC', async () => {
  const { calls, res } = await call('addManualFunding', { body: {
    month: '2026-08', amount: '1000.00', source_label: 'Confirmed cash', request_key: 'key-a',
  } });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'add_manual_budget_funding');
  assert.equal(calls[0].params.p_amount, '1000.00');
  assert.equal(calls[0].params.p_source_label, 'Confirmed cash');
  assert.equal(calls[0].params.p_request_key, 'key-a');
});

test('first allocation preserves explicit zero rather than treating it as missing', async () => {
  const { calls, res } = await call('establishBudget', { body: {
    month: '2026-08', category_id: 2, starting_amount: '0', request_key: 'key-b',
  } });
  assert.equal(res.statusCode, 200);
  assert.equal(calls[0].name, 'establish_funded_budget');
  assert.equal(calls[0].params.p_starting_amount, '0');
});

test('authoritative mutation money rejects JSON numbers before an RPC call', async () => {
  const { calls, res } = await call('addManualFunding', { body: {
    month: '2026-08', amount: 1000, source_label: 'Confirmed cash', request_key: 'key-number',
  } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_MONEY_FORMAT');
  assert.equal(calls.length, 0);
});

test('every funded allocation controller rejects numeric JSON money', async () => {
  const cases = [
    ['establishBudget', { body: {
      month: '2026-08', category_id: 2, starting_amount: 1000, request_key: 'key-establish-number',
    } }],
    ['adjustBudget', {
      params: { id: '5' }, body: { target_amount: 1000, request_key: 'key-adjust-number' },
    }],
    ['reactivateBudget', {
      params: { id: '5' }, body: { additional_amount: 1000, request_key: 'key-reactivate-number' },
    }],
  ];
  for (const [method, request] of cases) {
    const { calls, res } = await call(method, request);
    assert.equal(res.statusCode, 400, `${method} accepted a JSON number`);
    assert.equal(res.body.code, 'INVALID_MONEY_FORMAT');
    assert.equal(calls.length, 0);
  }
});

test('large exact decimal strings reach PostgreSQL without JavaScript coercion', async () => {
  const exact = '9007199254740993.01';
  const { calls, res } = await call('adjustBudget', {
    params: { id: '5' }, body: { target_amount: exact, request_key: 'key-exact' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(calls[0].params.p_target_amount, exact);
});

test('malformed, exponent, non-finite, over-precision, and non-string money are rejected', async () => {
  const invalidValues = [
    null, true, '', 'NaN', 'Infinity', '-Infinity', '1e3', '1,000.00', ' 1000 ',
    '1.001', '-1.00', '01.00',
  ];
  for (const targetAmount of invalidValues) {
    const { calls, res } = await call('adjustBudget', {
      params: { id: '5' }, body: { target_amount: targetAmount, request_key: 'key-invalid' },
    });
    assert.equal(res.statusCode, 400, `expected rejection for ${String(targetAmount)}`);
    assert.equal(res.body.code, 'INVALID_MONEY_FORMAT');
    assert.equal(calls.length, 0);
  }
});

test('endpoint-specific zero rules accept allocation targets but reject zero funding', async () => {
  const manual = await call('addManualFunding', { body: {
    month: '2026-08', amount: '0.00', source_label: 'Confirmed cash', request_key: 'key-zero-funding',
  } });
  assert.equal(manual.res.statusCode, 400);
  assert.equal(manual.res.body.code, 'INVALID_MONEY_AMOUNT');
  assert.equal(manual.calls.length, 0);

  const adjust = await call('adjustBudget', {
    params: { id: '5' }, body: { target_amount: '0.00', request_key: 'key-zero-target' },
  });
  assert.equal(adjust.res.statusCode, 200);
  assert.equal(adjust.calls[0].params.p_target_amount, '0.00');

  const reactivate = await call('reactivateBudget', {
    params: { id: '5' }, body: { additional_amount: '0', request_key: 'key-zero-reactivate' },
  });
  assert.equal(reactivate.res.statusCode, 200);
  assert.equal(reactivate.calls[0].params.p_additional_amount, '0');
});

test('compatibility upsert rejects numeric JSON money before reading current state', async () => {
  const { calls, res } = await call('upsertBudget', { body: {
    category_id: 2, month: '2026-08', amount: 1000, request_key: 'key-upsert-number',
  } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_MONEY_FORMAT');
  assert.equal(calls.length, 0);
});

test('domain conflicts return a stable code and status', async () => {
  const error = { code: '23514', message: 'Insufficient unallocated funds' };
  const { res } = await call('adjustBudget', {
    params: { id: '5' }, body: { target_amount: '900.00', request_key: 'key-c' },
  }, null, error);
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: error.message, code: error.code });
});

test('compatibility delete route invokes removal RPC and cannot hard-delete', async () => {
  const { calls, res } = await call('deleteBudget', {
    params: { id: '5' }, body: { request_key: 'key-d' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'remove_funded_budget');
  assert.equal(res.body.message, 'Budget removed; funded history was preserved');
});

test('copy maps the whole action to one atomic RPC with no controller-side writes', async () => {
  const { calls, res } = await call('copyBudget', { body: {
    fromMonth: '2026-08', toMonth: '2026-09', request_key: 'key-e',
  } });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    name: 'copy_funded_budget_month',
    params: {
      p_from_month: '2026-08', p_to_month: '2026-09', p_request_key: 'key-e', p_reason: null,
    },
  });
});

const exactAnnualFake = () => {
  const rows = {
    budget_category_state: [
      {
        budget_id: 1, category_id: 1, month: '2026-01',
        starting_amount_text: '9007199254740993.01', final_funded_text: '9007199254740993.01',
        category_name: 'Large', category_icon: null, category_type: 'expense', lifecycle_state: 'active',
      },
      {
        budget_id: 2, category_id: 2, month: '2026-01',
        starting_amount_text: '0.10', final_funded_text: '0.30',
        category_name: 'Decimal', category_icon: null, category_type: 'expense', lifecycle_state: 'active',
      },
    ],
    budget_month_category_actuals: [
      { month: '2026-01', actual_spent_text: '0.10', category_id: 1, category_name: 'Large', category_icon: null },
      { month: '2026-01', actual_spent_text: '0.20', category_id: 2, category_name: 'Decimal', category_icon: null },
    ],
  };
  return {
    from(table) {
      const chain = {
        select() { return chain; },
        gte() { return chain; },
        lte() { return Promise.resolve({ data: rows[table], error: null }); },
      };
      return chain;
    },
  };
};

test('annual compatibility aggregates final funded and actual values with exact decimals', async () => {
  const controller = loadControllerWithFake('../../controllers/budgetController', exactAnnualFake());
  const res = createMockResponse();
  await controller.getAnnualSummary({ query: { year: '2026' } }, res);
  assert.equal(res.body.summary.yearly_planned, '9007199254740993.31');
  assert.equal(res.body.summary.yearly_actual, '0.30');
  assert.equal(res.body.summary.remaining, '9007199254740993.01');
  assert.equal(res.body.monthly[0].planned, '9007199254740993.31');
  assert.equal(res.body.monthly[0].actual, '0.30');
  assert.equal(res.body.categories.find((category) => category.category_id === 2).planned, '0.30');
});

test('monthly category compatibility totals never aggregate money with JavaScript Number', async () => {
  const controller = loadControllerWithFake('../../controllers/budgetController', exactAnnualFake());
  const res = createMockResponse();
  await controller.getMonthlyCategoryBreakdown({ query: { year: '2026' } }, res);
  assert.equal(res.body.totals.months['2026-01'].planned, '9007199254740993.31');
  assert.equal(res.body.totals.months['2026-01'].actual, '0.30');
  assert.equal(res.body.totals.months['2026-01'].diff, '9007199254740993.01');
  assert.equal(res.body.totals.yearly.planned, '9007199254740993.31');
});
