const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createMockResponse,
  loadControllerWithFake,
} = require('./helpers/fakeSupabase');

const createLoanDetailsFake = () => {
  const calls = [];
  const rows = {
    loans: {
      id: 4,
      name: 'Closed loan',
      original_amount: '6000.00',
      payment_source: { id: 5, name: 'Cal - 5746', last4: '5746' },
    },
    loan_payments: [
      {
        id: 1, loan_id: 4, transaction_id: 101, installment_number: 1,
        payment_date: '2024-06-02', payment_kind: 'installment',
      },
      {
        id: 2, loan_id: 4, transaction_id: 102, installment_number: null,
        payment_date: '2026-06-03', payment_kind: 'early_payoff',
      },
      {
        id: 3, loan_id: 4, transaction_id: 103, installment_number: null,
        payment_date: '2025-01-20', payment_kind: 'irregular_payment',
        installments_covered: 0,
      },
    ],
    transactions: [
      { id: 101, loan_id: 4, description: 'Payment', charge_date: '2024-06-02' },
      { id: 70, loan_id: 4, description: 'Bridging interest', charge_date: '2024-05-02' },
    ],
  };

  class Query {
    constructor(table) {
      this.table = table;
    }

    select(columns) { calls.push({ table: this.table, op: 'select', columns }); return this; }
    eq(column, value) { calls.push({ table: this.table, op: 'eq', column, value }); return this; }
    order(column, options) { calls.push({ table: this.table, op: 'order', column, options }); return this; }
    async maybeSingle() { return { data: rows.loans, error: null }; }
    then(resolve) { return Promise.resolve({ data: rows[this.table], error: null }).then(resolve); }
  }

  return {
    calls,
    from(table) { calls.push({ table, op: 'from' }); return new Query(table); },
  };
};

const createLoanListFake = () => {
  const calls = [];
  const loans = [
    { id: 3, name: 'Closed early', current_balance: '0.00', status: 'paid' },
    { id: 4, name: 'Closed normal', current_balance: '0.00', status: 'paid' },
  ];
  const paymentKinds = [
    ...Array.from({ length: 25 }, () => ({
      loan_id: 3, payment_kind: 'installment', installments_covered: 1,
    })),
    { loan_id: 3, payment_kind: 'early_payoff', installments_covered: 0 },
    { loan_id: 4, payment_kind: 'catch_up', installments_covered: 3 },
  ];

  return {
    calls,
    from(table) {
      calls.push({ table, op: 'from' });
      if (table === 'loans') {
        return {
          select(columns) {
            calls.push({ table, op: 'select', columns });
            return {
              async order(column, options) {
                calls.push({ table, op: 'order', column, options });
                return { data: loans, error: null };
              },
            };
          },
        };
      }
      if (table === 'loan_payments') {
        return {
          select(columns) {
            calls.push({ table, op: 'select', columns });
            return {
              async in(column, values) {
                calls.push({ table, op: 'in', column, values });
                return { data: paymentKinds, error: null };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
};

test('loan list returns compact authoritative payment summaries for cards', async () => {
  const fake = createLoanListFake();
  const controller = loadControllerWithFake('../../controllers/loanController', fake);
  const response = createMockResponse();

  await controller.getAllLoans({}, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.map((loan) => ({
    id: loan.id,
    regular_payment_count: loan.regular_payment_count,
    has_early_payoff: loan.has_early_payoff,
  })), [
    { id: 3, regular_payment_count: 25, has_early_payoff: true },
    { id: 4, regular_payment_count: 3, has_early_payoff: false },
  ]);
  assert.equal(Object.hasOwn(response.body[0], 'loan_payments'), false);
  assert.ok(fake.calls.some((call) => call.table === 'loan_payments'
    && call.op === 'select'
    && call.columns === 'loan_id, payment_kind, installments_covered'));
  assert.deepEqual(
    fake.calls.find((call) => call.table === 'loan_payments' && call.op === 'in').values,
    [3, 4],
  );
});

test('loan details returns authoritative payments and every related transaction', async () => {
  const fake = createLoanDetailsFake();
  const controller = loadControllerWithFake('../../controllers/loanController', fake);
  const response = createMockResponse();

  await controller.getLoanDetails({ params: { id: '4' } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.loan.id, 4);
  assert.deepEqual(
    response.body.loan_payments.map((payment) => payment.payment_kind),
    ['installment', 'early_payoff', 'irregular_payment'],
  );
  assert.equal(response.body.related_transactions.length, 2);
  assert.equal(response.body.related_transactions.find((row) => row.id === 70).description, 'Bridging interest');
  assert.ok(fake.calls.some((call) => call.table === 'loan_payments'
    && call.op === 'order' && call.column === 'payment_date'));
  assert.ok(fake.calls.some((call) => call.table === 'transactions'
    && call.op === 'eq' && call.column === 'loan_id' && call.value === 4));
});

test('loan details rejects an invalid id before querying Supabase', async () => {
  const fake = createLoanDetailsFake();
  const controller = loadControllerWithFake('../../controllers/loanController', fake);
  const response = createMockResponse();

  await controller.getLoanDetails({ params: { id: '4 OR 1=1' } }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(fake.calls.length, 0);
});
