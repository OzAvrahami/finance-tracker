const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createFakeSupabase,
  loadControllerWithFake,
  createMockResponse,
  sumDecimal,
} = require('./helpers/fakeSupabase');
const { buildHistorySpanningCutoff } = require('./helpers/fixtures');

function callDashboard(method, rows, query, options) {
  const fake = createFakeSupabase(rows, options);
  const controller = loadControllerWithFake('../../controllers/dashboardController', fake);
  const res = createMockResponse();
  return controller[method]({ query }, res).then(() => ({ res, fake }));
}

test('GET /api/dashboard/summary', async (t) => {
  const rows = buildHistorySpanningCutoff();

  await t.test('aggregates in the database, returning a small bounded payload', async () => {
    const { res, fake } = await callDashboard('getSummary', rows, {
      from: '2026-08-01',
      to: '2026-08-31',
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(Object.keys(res.body).sort(), ['balance', 'count', 'expenses', 'income']);

    // The point of the endpoint: no transaction rows cross the wire.
    assert.equal(fake.calls[0].fnName, 'dashboard_summary');
    assert.equal(JSON.stringify(res.body).includes('transaction_date'), false);
  });

  await t.test('balance is income minus expenses', async () => {
    const { res } = await callDashboard('getSummary', rows, { from: '2024-01-01', to: '2026-12-31' });
    assert.equal(res.body.balance, res.body.income - res.body.expenses);
  });

  await t.test('includes history older than the April 2026 cutoff', async () => {
    // The regression this endpoint exists to prevent: totals for an old period
    // used to be computed over a client array truncated at 1000 rows.
    const { res } = await callDashboard('getSummary', rows, {
      from: '2024-01-01',
      to: '2024-12-31',
    });

    assert.ok(res.body.count > 0, 'expected 2024 transactions to be counted');

    const expected = rows.filter(
      (r) => r.transaction_date >= '2024-01-01' && r.transaction_date <= '2024-12-31'
    );
    assert.equal(res.body.count, expected.length);
    // Amounts are decimal strings (NUMERIC), so they are summed exactly rather
    // than with `+`, which would concatenate them.
    assert.equal(
      res.body.income,
      Number(sumDecimal(expected.filter((r) => r.movement_type === 'income').map((r) => r.total_amount)))
    );
    assert.equal(
      res.body.expenses,
      Number(sumDecimal(expected.filter((r) => r.movement_type === 'expense').map((r) => r.total_amount)))
    );
  });

  await t.test('an empty period returns zeros rather than failing', async () => {
    const { res } = await callDashboard('getSummary', rows, { from: '2019-01-01', to: '2019-12-31' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { income: 0, expenses: 0, balance: 0, count: 0 });
  });

  await t.test('requires both bounds', async () => {
    for (const query of [{}, { from: '2026-01-01' }, { to: '2026-01-31' }]) {
      const { res, fake } = await callDashboard('getSummary', rows, query);
      assert.equal(res.statusCode, 400);
      assert.equal(fake.calls.length, 0);
    }
  });

  await t.test('rejects malformed and inverted ranges', async () => {
    const bad = [
      { from: '2026-02-31', to: '2026-03-01' },
      { from: '2026-01-01', to: 'nope' },
      { from: '2026-08-01', to: '2026-01-01' },
    ];
    for (const query of bad) {
      const { res, fake } = await callDashboard('getSummary', rows, query);
      assert.equal(res.statusCode, 400, `expected ${JSON.stringify(query)} to be rejected`);
      assert.equal(fake.calls.length, 0);
    }
  });

  await t.test('surfaces database errors', async () => {
    const { res } = await callDashboard(
      'getSummary',
      rows,
      { from: '2026-01-01', to: '2026-01-31' },
      { failWith: 'aggregate failed' }
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /aggregate failed/);
  });
});

test('GET /api/dashboard/monthly-series', async (t) => {
  const rows = buildHistorySpanningCutoff();

  await t.test('defaults to six months', async () => {
    const { res, fake } = await callDashboard('getMonthlySeries', rows, {});
    assert.equal(res.statusCode, 200);
    assert.equal(fake.calls[0].params.p_months, 6);
    assert.equal(res.body.length, 6);
  });

  await t.test('each entry carries a month key and numeric totals', async () => {
    const { res } = await callDashboard('getMonthlySeries', rows, { months: '3' });
    assert.equal(res.body.length, 3);
    for (const entry of res.body) {
      assert.match(entry.month, /^\d{4}-\d{2}$/);
      assert.equal(typeof entry.income, 'number');
      assert.equal(typeof entry.expenses, 'number');
    }
  });

  await t.test('returns months in ascending order', async () => {
    const { res } = await callDashboard('getMonthlySeries', rows, { months: '6' });
    const months = res.body.map((e) => e.month);
    assert.deepEqual(months, [...months].sort());
  });

  await t.test('clamps an excessive month count', async () => {
    const { res, fake } = await callDashboard('getMonthlySeries', rows, { months: '9999' });
    assert.equal(res.statusCode, 200);
    assert.equal(fake.calls[0].params.p_months, 24);
  });

  await t.test('rejects an invalid month count', async () => {
    for (const bad of ['abc', '0', '-3', '2.5']) {
      const { res, fake } = await callDashboard('getMonthlySeries', rows, { months: bad });
      assert.equal(res.statusCode, 400, `expected months=${bad} to be rejected`);
      assert.equal(fake.calls.length, 0);
    }
  });
});
