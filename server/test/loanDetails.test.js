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

test('loan details returns authoritative payments and every related transaction', async () => {
  const fake = createLoanDetailsFake();
  const controller = loadControllerWithFake('../../controllers/loanController', fake);
  const response = createMockResponse();

  await controller.getLoanDetails({ params: { id: '4' } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.loan.id, 4);
  assert.deepEqual(
    response.body.loan_payments.map((payment) => payment.payment_kind),
    ['installment', 'early_payoff'],
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
