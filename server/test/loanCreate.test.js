const test = require('node:test');
const assert = require('node:assert/strict');
const { loadControllerWithFake, createMockResponse } = require('./helpers/fakeSupabase');

const validBody = (overrides = {}) => ({
  name: 'Modern fixed loan',
  lender_name: 'Test lender',
  original_amount: 21900,
  total_installments: 36,
  start_date: '2026-08-13',
  end_date: '2029-08-13',
  interest_type: 'fixed',
  interest_rate: 12,
  prime_margin: 99,
  monthly_payment: 727.39,
  payment_source_id: 5,
  next_payment_date: '2026-09-02',
  auto_payment_enabled: true,
  ...overrides,
});

const createFake = ({ paymentSource = { id: 5 } } = {}) => {
  const inserted = [];
  const tables = [];
  return {
    inserted,
    tables,
    client: {
      from(table) {
        tables.push(table);
        if (table === 'payment_sources') {
          const query = {
            select() { return query; },
            eq() { return query; },
            async maybeSingle() { return { data: paymentSource, error: null }; },
          };
          return query;
        }
        if (table === 'loans') {
          return {
            insert(rows) {
              inserted.push(...rows);
              return {
                select: async () => ({ data: [{ id: 91, ...rows[0] }], error: null }),
              };
            },
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    },
  };
};

const create = async (body, fakeOptions) => {
  const fake = createFake(fakeOptions);
  const controller = loadControllerWithFake('../../controllers/loanController', fake.client);
  const res = createMockResponse();
  await controller.createLoan({ body }, res);
  return { fake, res };
};

test('creates a fixed-rate loan in a server-controlled loan_payments initial state', async () => {
  const { fake, res } = await create(validBody({
    calculation_mode: 'legacy',
    current_balance: 12,
    remaining_installments: 1,
    status: 'paid',
    closed_date: '2026-08-13',
    amortization_type: 'balloon',
  }));

  assert.equal(res.statusCode, 200);
  assert.deepEqual(fake.inserted[0], {
    name: 'Modern fixed loan',
    lender_name: 'Test lender',
    loan_type: 'bank_loan',
    original_amount: 21900,
    current_balance: 21900,
    monthly_payment: 727.39,
    interest_rate: 12,
    total_installments: 36,
    remaining_installments: 36,
    start_date: '2026-08-13',
    end_date: '2029-08-13',
    status: 'active',
    amortization_type: 'spitzer',
    interest_type: 'fixed',
    prime_margin: 0,
    calculation_mode: 'loan_payments',
    next_payment_date: '2026-09-02',
    payment_source_id: 5,
    auto_payment_enabled: true,
    closed_date: null,
  });
  assert.deepEqual(fake.tables, ['payment_sources', 'loans']);
  assert.equal(fake.tables.includes('loan_payments'), false);
});

test('creates a Prime loan with separate effective rate and margin', async () => {
  const { fake, res } = await create(validBody({
    name: 'Prime loan',
    interest_type: 'prime',
    interest_rate: 11.85,
    prime_margin: 6.85,
  }));

  assert.equal(res.statusCode, 200);
  assert.equal(fake.inserted[0].interest_type, 'prime');
  assert.equal(fake.inserted[0].interest_rate, 11.85);
  assert.equal(fake.inserted[0].prime_margin, 6.85);
});

test('allows informational next-payment/source fields to be absent when automation is disabled', async () => {
  const { fake, res } = await create(validBody({
    auto_payment_enabled: false,
    payment_source_id: null,
    next_payment_date: null,
  }));

  assert.equal(res.statusCode, 200);
  assert.equal(fake.inserted[0].auto_payment_enabled, false);
  assert.equal(fake.inserted[0].payment_source_id, null);
  assert.equal(fake.inserted[0].next_payment_date, null);
});

test('rejects unsafe or incomplete create configurations with 400 responses', async (t) => {
  const cases = [
    ['empty name', { name: '  ' }, 'Loan name is required'],
    ['non-positive principal', { original_amount: 0 }, 'Original amount must be greater than zero'],
    ['fractional term', { total_installments: 12.5 }, 'Total installments must be a positive integer'],
    ['missing monthly payment', { monthly_payment: '' }, 'Monthly payment must be greater than zero'],
    ['unsupported interest', { interest_type: 'cpi_linked' }, 'Interest type must be fixed or prime'],
    ['negative rate', { interest_rate: -1 }, 'Interest rate must be zero or greater'],
    ['missing Prime margin', { interest_type: 'prime', prime_margin: '' }, 'Prime margin is required for a prime-rate loan'],
    ['invalid start date', { start_date: '2026-02-30' }, 'Start date must be a valid YYYY-MM-DD date'],
    ['missing source with automation', { payment_source_id: null }, 'Payment source is required when automatic payment is enabled'],
    ['missing due date with automation', { next_payment_date: null }, 'Next payment date is required when automatic payment is enabled'],
  ];

  for (const [name, override, error] of cases) {
    await t.test(name, async () => {
      const { fake, res } = await create(validBody(override));
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, error);
      assert.equal(fake.inserted.length, 0);
    });
  }
});

test('rejects an unknown or inactive supplied payment source', async () => {
  const { fake, res } = await create(validBody(), { paymentSource: null });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Payment source was not found or is inactive');
  assert.equal(fake.inserted.length, 0);
});
