const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  calculateDueLoanPayment,
  calculateFixedSchedule,
  calculateOutstandingPrincipal,
  calculateVariableSchedule,
  summarizeSchedule,
} = require('../utils/loanAmortization');
const {
  getJerusalemDate,
  processDueLoanPayments,
} = require('../services/dueLoanPaymentService');
const { requireLoanJobSecret } = require('../middleware/loanJobAuth');
const { createProcessDueLoansHandler } = require('../controllers/internalJobController');

const migrationPath = path.join(
  __dirname,
  '..',
  'migrations',
  '009_automatic_due_loan_payments.sql',
);
const schemaPath = path.join(__dirname, '..', 'full_schema.sql');

const addMonth = (date) => {
  const [year, month, day] = date.split('-').map(Number);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const lastDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
};

class Query {
  constructor(table, state) {
    this.table = table;
    this.state = state;
    this.filters = [];
    this.orders = [];
  }

  select() { return this; }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
  gt(column, value) { this.filters.push((row) => Number(row[column]) > Number(value)); return this; }
  lte(column, value) { this.filters.push((row) => row[column] <= value); return this; }
  not(column, operator, value) {
    assert.equal(operator, 'is');
    assert.equal(value, null);
    this.filters.push((row) => row[column] != null);
    return this;
  }

  order(column, { ascending }) {
    this.orders.push({ column, ascending });
    return this;
  }

  execute() {
    let data = [...this.state[this.table]].filter(
      (row) => this.filters.every((filter) => filter(row)),
    );
    data.sort((left, right) => {
      for (const { column, ascending } of this.orders) {
        if (left[column] === right[column]) continue;
        const comparison = left[column] < right[column] ? -1 : 1;
        return ascending ? comparison : -comparison;
      }
      return 0;
    });
    return { data, error: null };
  }

  then(resolve, reject) {
    return Promise.resolve(this.execute()).then(resolve, reject);
  }
}

const createDueLoanFake = ({ loans, loanPayments = [], categories } = {}) => {
  const state = {
    loans: structuredClone(loans || []),
    loan_payments: structuredClone(loanPayments).map((payment) => {
      const row = {
        payment_kind: 'installment',
        other_amount: '0.0000000000',
        balance_adjustment_amount: '0.0000000000',
        ...payment,
      };
      return {
        ...row,
        installments_covered: row.installments_covered
          ?? (row.payment_kind === 'installment' ? 1 : 0),
      };
    }),
    categories: structuredClone(categories || [
      { id: 24, name: 'הלוואות', type: 'expense', is_active: true },
    ]),
    transactions: [],
    rpcCalls: [],
  };

  return {
    state,
    from(table) {
      return new Query(table, state);
    },
    async rpc(name, params) {
      assert.equal(name, 'create_due_loan_payment');
      state.rpcCalls.push({ name, params: structuredClone(params) });
      const loan = state.loans.find((row) => row.id === params.p_loan_id);
      const existing = state.loan_payments.find(
        (row) => row.loan_id === loan.id
          && row.installment_number === params.p_expected_installment_number,
      );
      if (existing) {
        if (loan.next_payment_date === params.p_expected_due_date) {
          loan.next_payment_date = loan.remaining_installments <= 0
            ? null
            : addMonth(params.p_expected_due_date);
        }
        return { data: {
          status: 'already_processed',
          transaction_id: existing.transaction_id,
          loan_payment_id: existing.id,
          installment_number: existing.installment_number,
          next_payment_date: loan.next_payment_date,
        }, error: null };
      }

      const transactionId = 1000 + state.transactions.length + 1;
      const paymentId = 2000 + state.loan_payments.length + 1;
      state.transactions.push({
        id: transactionId,
        loan_id: loan.id,
        total_amount: params.p_payment_amount,
        transaction_date: params.p_expected_due_date,
        charge_date: params.p_expected_due_date,
      });
      state.loan_payments.push({
        id: paymentId,
        loan_id: loan.id,
        transaction_id: transactionId,
        installment_number: params.p_expected_installment_number,
        payment_date: params.p_expected_due_date,
        payment_amount: params.p_payment_amount,
        principal_amount: params.p_principal_amount,
        interest_amount: params.p_interest_amount,
        annual_interest_rate: params.p_annual_interest_rate,
        source_kind: 'generated',
        payment_kind: 'installment',
        installments_covered: 1,
        other_amount: '0.0000000000',
        balance_adjustment_amount: '0.0000000000',
      });
      loan.current_balance = Number(loan.current_balance) - Number(params.p_principal_amount);
      loan.remaining_installments -= 1;
      loan.next_payment_date = loan.remaining_installments === 0
        ? null
        : addMonth(params.p_expected_due_date);
      return { data: {
        status: 'processed',
        transaction_id: transactionId,
        loan_payment_id: paymentId,
        installment_number: params.p_expected_installment_number,
        next_payment_date: loan.next_payment_date,
      }, error: null };
    },
  };
};

const loan = (overrides = {}) => ({
  id: 101,
  name: 'Synthetic fixed loan',
  original_amount: '1000.00',
  current_balance: '1000.00',
  monthly_payment: '110.00',
  interest_rate: '12.00',
  interest_type: 'fixed',
  indexation_type: 'none',
  total_installments: 10,
  remaining_installments: 10,
  status: 'active',
  calculation_mode: 'loan_payments',
  auto_payment_enabled: true,
  next_payment_date: '2026-09-02',
  payment_source_id: 3,
  ...overrides,
});

test('Target B and C due-payment splits retain the validated fixed-rate math', () => {
  for (const fixture of [
    {
      original: '21900.00', payment: '727.39', installments: 24,
      principal: '13713.0300000000', interest: '3744.3300000000', balance: '8186.97',
    },
    {
      original: '18000.00', payment: '997.48', installments: 17,
      principal: '15066.5200000000', interest: '1890.6400000000', balance: '2933.48',
    },
  ]) {
    const preceding = calculateFixedSchedule({
      originalAmount: fixture.original,
      paymentAmount: fixture.payment,
      annualInterestRate: '12.00',
      installments: fixture.installments - 1,
    });
    const due = calculateDueLoanPayment({
      openingPrincipal: preceding.at(-1).closingBalance,
      paymentAmount: fixture.payment,
      annualInterestRate: '12.00',
      interestType: 'fixed',
    });
    const summary = summarizeSchedule([...preceding, {
      paymentAmount: due.paymentAmount,
      principalAmount: due.principalAmount,
      interestAmount: due.interestAmount,
      closingBalance: due.closingBalance,
    }]);
    assert.equal(summary.principalAmount, fixture.principal);
    assert.equal(summary.interestAmount, fixture.interest);
    assert.equal(Number(summary.closingBalance).toFixed(2), fixture.balance);
  }
});

test('variable due payment uses precise outstanding principal and the current rate', () => {
  const history = calculateVariableSchedule({
    originalAmount: '21000.00',
    periods: [
      { count: 18, paymentAmount: '380.32', annualInterestRate: '12.85' },
      { count: 2, paymentAmount: '378.00', annualInterestRate: '12.60' },
      { count: 4, paymentAmount: '375.75', annualInterestRate: '12.35' },
      { count: 2, paymentAmount: '373.62', annualInterestRate: '12.10' },
    ],
  });
  const opening = calculateOutstandingPrincipal({
    originalAmount: '21000.00',
    payments: history.map((row) => ({ principalAmount: row.principalAmount })),
  });
  const due = calculateDueLoanPayment({
    openingPrincipal: opening,
    paymentAmount: '371.57',
    annualInterestRate: '11.85',
    interestType: 'prime',
  });

  assert.equal(opening, '16346.7755161592');
  assert.equal(due.paymentAmount, '371.57');
  assert.equal(due.interestAmount, '161.4244082221');
  assert.equal(due.principalAmount, '210.1455917779');
  assert.equal(due.closingBalance, '16136.6299243813');
});

test('final installment clears principal exactly and nulls the next due date', async () => {
  const fake = createDueLoanFake({
    loans: [loan({
      original_amount: '100.00', current_balance: '10.00', monthly_payment: '11.00',
      total_installments: 2, remaining_installments: 1,
    })],
    loanPayments: [{
      id: 1, loan_id: 101, transaction_id: 1, installment_number: 1,
      payment_date: '2026-08-02', payment_amount: '91.00',
      principal_amount: '90.0000000000', interest_amount: '1.0000000000',
      annual_interest_rate: '12.00', source_kind: 'existing_transaction',
    }],
  });

  const summary = await processDueLoanPayments({
    today: '2026-09-02', supabaseClient: fake, logger: { error() {} },
  });

  assert.equal(summary.processed, 1);
  const payment = fake.state.loan_payments.at(-1);
  assert.equal(payment.principal_amount, '10.0000000000');
  assert.equal(payment.payment_amount, '11.00');
  assert.equal(fake.state.loans[0].next_payment_date, null);
  assert.equal(fake.state.loans[0].remaining_installments, 0);
});

test('daily processor creates one atomic generated payment and a repeated run creates none', async () => {
  const fake = createDueLoanFake({ loans: [loan()] });

  const first = await processDueLoanPayments({
    today: '2026-09-02', supabaseClient: fake, logger: { error() {} },
  });
  const second = await processDueLoanPayments({
    today: '2026-09-02', supabaseClient: fake, logger: { error() {} },
  });

  assert.equal(first.processed, 1);
  assert.equal(second.processed, 0);
  assert.equal(fake.state.transactions.length, 1);
  assert.equal(fake.state.loan_payments.length, 1);
  assert.equal(fake.state.loan_payments[0].source_kind, 'generated');
  assert.equal(fake.state.rpcCalls.length, 1);
  assert.equal(fake.state.loans[0].next_payment_date, '2026-10-02');
});

test('one rejected loan does not prevent another due loan from processing', async () => {
  const fake = createDueLoanFake({ loans: [loan({ id: 101 }), loan({ id: 102 })] });
  const rpc = fake.rpc.bind(fake);
  fake.rpc = async (name, params) => {
    if (params.p_loan_id === 101) {
      return { data: null, error: { message: 'synthetic accounting rejection' } };
    }
    return rpc(name, params);
  };
  const logged = [];

  const summary = await processDueLoanPayments({
    today: '2026-09-02',
    supabaseClient: fake,
    logger: { error(message, details) { logged.push({ message, details }); } },
  });

  assert.equal(summary.failed, 1);
  assert.equal(summary.processed, 1);
  assert.equal(fake.state.transactions.length, 1);
  assert.equal(fake.state.transactions[0].loan_id, 102);
  assert.deepEqual(logged[0].details, {
    loanId: 101,
    dueDate: '2026-09-02',
    message: 'synthetic accounting rejection',
  });
});

test('a manual payment on the due date is reconciled without a duplicate', async () => {
  const fake = createDueLoanFake({
    loans: [loan({ current_balance: '901.00', remaining_installments: 9 })],
    loanPayments: [{
      id: 9, loan_id: 101, transaction_id: 99, installment_number: 1,
      payment_date: '2026-09-02', payment_amount: '110.00',
      principal_amount: '99.0000000000', interest_amount: '11.0000000000',
      annual_interest_rate: '12.00', source_kind: 'manual',
    }],
  });

  const summary = await processDueLoanPayments({
    today: '2026-09-02', supabaseClient: fake, logger: { error() {} },
  });

  assert.equal(summary.alreadyProcessed, 1);
  assert.equal(fake.state.transactions.length, 0);
  assert.equal(fake.state.loan_payments.length, 1);
  assert.equal(fake.state.loans[0].next_payment_date, '2026-10-02');
});

test('automatic processing counts only regular installments, never an early payoff row', async () => {
  const fake = createDueLoanFake({
    loans: [loan({ current_balance: '901.00', remaining_installments: 9 })],
    loanPayments: [
      {
        id: 1, loan_id: 101, transaction_id: 1, installment_number: 1,
        payment_date: '2026-08-02', payment_amount: '110.00',
        principal_amount: '99.0000000000', interest_amount: '11.0000000000',
        annual_interest_rate: '12.00', source_kind: 'manual',
      },
      {
        id: 2, loan_id: 101, transaction_id: 2, installment_number: null,
        payment_date: '2026-08-15', payment_amount: '0.00',
        principal_amount: '0.0000000000', interest_amount: '0.0000000000',
        annual_interest_rate: null, source_kind: 'manual',
        payment_kind: 'early_payoff',
      },
    ],
  });

  const summary = await processDueLoanPayments({
    today: '2026-09-02', supabaseClient: fake, logger: { error() {} },
  });

  assert.equal(summary.processed, 1);
  assert.equal(fake.state.rpcCalls[0].params.p_expected_installment_number, 2);
});

test('automatic processing advances from catch-up coverage and ignores balance snapshots', async () => {
  const fake = createDueLoanFake({
    loans: [loan({ current_balance: '901.00', remaining_installments: 6 })],
    loanPayments: [
      {
        id: 1, loan_id: 101, transaction_id: 1, installment_number: null,
        payment_date: '2026-06-02', payment_amount: '330.00',
        principal_amount: '0.0000000000', interest_amount: '0.0000000000',
        annual_interest_rate: null, source_kind: 'manual', payment_kind: 'catch_up',
        installments_covered: 3, other_amount: '330.0000000000',
      },
      {
        id: 2, loan_id: 101, transaction_id: null, installment_number: null,
        payment_date: '2026-07-01', payment_amount: '0.00',
        principal_amount: '0.0000000000', interest_amount: '0.0000000000',
        annual_interest_rate: null, source_kind: 'manual',
        payment_kind: 'balance_adjustment', installments_covered: 0,
        balance_adjustment_amount: '9.0000000000',
      },
      {
        id: 3, loan_id: 101, transaction_id: 3, installment_number: 4,
        payment_date: '2026-08-02', payment_amount: '110.00',
        principal_amount: '99.0000000000', interest_amount: '11.0000000000',
        annual_interest_rate: '12.00', source_kind: 'manual',
        installments_covered: 1,
      },
    ],
  });

  const summary = await processDueLoanPayments({
    today: '2026-09-02', supabaseClient: fake, logger: { error() {} },
  });

  assert.equal(summary.processed, 1);
  assert.equal(fake.state.rpcCalls[0].params.p_expected_installment_number, 5);
  assert.equal(fake.state.loan_payments.at(-1).installments_covered, 1);
});

test('automatic processing ignores irregular cash evidence and still generates a normal installment', async () => {
  const fake = createDueLoanFake({
    loans: [loan()],
    loanPayments: [{
      id: 1, loan_id: 101, transaction_id: 88, installment_number: null,
      payment_date: '2026-08-15', payment_amount: '75.00',
      principal_amount: '0.0000000000', interest_amount: '0.0000000000',
      annual_interest_rate: null, source_kind: 'existing_transaction',
      payment_kind: 'irregular_payment', installments_covered: 0,
      other_amount: '75.0000000000', balance_adjustment_amount: '0.0000000000',
    }],
  });

  const summary = await processDueLoanPayments({
    today: '2026-09-02', supabaseClient: fake, logger: { error() {} },
  });

  assert.equal(summary.processed, 1);
  assert.equal(fake.state.rpcCalls[0].params.p_expected_installment_number, 1);
  assert.equal(fake.state.loan_payments.at(-1).payment_kind, 'installment');
  assert.equal(fake.state.loan_payments.at(-1).installments_covered, 1);
});

test('legacy, future, and disabled loans are ignored and ancillary transactions are irrelevant', async () => {
  const fake = createDueLoanFake({
    loans: [
      loan({ id: 1, calculation_mode: 'legacy' }),
      loan({ id: 2, next_payment_date: '2026-10-02' }),
      loan({ id: 3, auto_payment_enabled: false }),
      loan({ id: 4, indexation_type: 'cpi' }),
    ],
  });
  fake.state.transactions.push({ id: 70, loan_id: 2, total_amount: '165.70' });

  const summary = await processDueLoanPayments({
    today: '2026-09-02', supabaseClient: fake, logger: { error() {} },
  });

  assert.equal(summary.processed, 0);
  assert.equal(fake.state.rpcCalls.length, 0);
  assert.equal(fake.state.loan_payments.length, 0);
});

test('CPI-indexed loans are excluded before automatic payment calculation', async () => {
  const fake = createDueLoanFake({ loans: [loan({ indexation_type: 'cpi' })] });

  const summary = await processDueLoanPayments({
    today: '2026-09-02', supabaseClient: fake, logger: { error() {} },
  });

  assert.equal(summary.processed, 0);
  assert.equal(summary.failed, 0);
  assert.equal(fake.state.rpcCalls.length, 0);
  assert.equal(fake.state.transactions.length, 0);
});

test('Jerusalem business date is independent of the host UTC date', () => {
  assert.equal(getJerusalemDate(new Date('2026-09-01T21:30:00.000Z')), '2026-09-02');
});

test('job endpoint rejects missing/wrong secrets and invokes the processor when authorized', async () => {
  const original = process.env.LOAN_JOB_SECRET;
  const response = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  });
  try {
    delete process.env.LOAN_JOB_SECRET;
    const unconfigured = response();
    requireLoanJobSecret(
      { headers: { authorization: 'Bearer anything' } },
      unconfigured,
      () => assert.fail('unconfigured middleware must not continue'),
    );
    assert.equal(unconfigured.statusCode, 503);

    process.env.LOAN_JOB_SECRET = 'test-only-secret';
    for (const authorization of [undefined, 'Bearer wrong']) {
      const res = response();
      let called = false;
      requireLoanJobSecret({ headers: { authorization } }, res, () => { called = true; });
      assert.equal(res.statusCode, 401);
      assert.equal(called, false);
    }

    const res = response();
    let nextCalled = false;
    requireLoanJobSecret(
      { headers: { authorization: 'Bearer test-only-secret' } },
      res,
      () => { nextCalled = true; },
    );
    assert.equal(nextCalled, true);

    let processorCalls = 0;
    const handler = createProcessDueLoansHandler(async () => {
      processorCalls += 1;
      return { processed: 1 };
    });
    await handler({}, res);
    assert.equal(processorCalls, 1);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { processed: 1 });

    const partialFailure = createProcessDueLoansHandler(async () => ({
      processed: 1,
      failed: 1,
    }));
    await partialFailure({}, res);
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { processed: 1, failed: 1 });
  } finally {
    if (original === undefined) delete process.env.LOAN_JOB_SECRET;
    else process.env.LOAN_JOB_SECRET = original;
  }
});

test('migration 009 and canonical schema define the bounded automatic-payment feature', () => {
  const migration = fs.readFileSync(migrationPath, 'utf8');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  for (const sql of [migration, schema]) {
    assert.match(sql, /auto_payment_enabled\s+BOOLEAN NOT NULL DEFAULT true/);
    assert.match(sql, /'existing_transaction', 'reconstructed', 'manual', 'generated'/);
    assert.match(sql, /create_due_loan_payment\(/);
    assert.match(sql, /FOR UPDATE/);
    assert.match(sql, /p_expected_due_date \+ INTERVAL '1 month'/);
    assert.match(sql, /'generated'/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.create_due_loan_payment\([\s\S]*FROM PUBLIC, anon, authenticated, service_role;/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.create_due_loan_payment\([\s\S]*TO service_role;/);
    assert.doesNotMatch(sql, /GRANT EXECUTE ON ALL FUNCTIONS/i);
  }

  assert.match(migration, /SET search_path = pg_catalog, public/);
  assert.match(migration, /calculation_mode <> 'loan_payments'/);
  assert.match(migration, /source_kind,[\s\S]*'generated'/);
  assert.equal((migration.match(/INSERT INTO public\.transactions/g) || []).length, 1);
  assert.doesNotMatch(migration, /generate_series/i);
  assert.match(schema, /loan_payments_unique_installment[\s\S]*payment_kind = 'installment'/);
});
