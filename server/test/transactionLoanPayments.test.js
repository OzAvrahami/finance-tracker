const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMockResponse,
  loadControllerWithFake,
} = require('./helpers/fakeSupabase');

function createTransactionFake(options = {}) {
  const state = { transactions: [], loanPayments: [], rpcCalls: [] };
  let transactionId = 500;

  return {
    state,
    rpc: async (name, params) => {
      state.rpcCalls.push({ name, params });
      if (options.failRpc === name) {
        return { data: null, error: { message: 'atomic operation rejected' } };
      }
      if (name === 'create_transaction_with_manual_loan_payment') {
        const inserted = { ...params.p_transaction, id: transactionId += 1 };
        state.transactions.push(inserted);
        const loanPayment = params.p_loan_payment ? {
          id: 900 + state.loanPayments.length,
          transaction_id: inserted.id,
          loan_id: inserted.loan_id,
          source_kind: 'manual',
          payment_kind: 'installment',
          ...params.p_loan_payment,
        } : null;
        if (loanPayment) state.loanPayments.push(loanPayment);
        return {
          data: { transaction: inserted, loanPayment, loan: { id: inserted.loan_id } },
          error: null,
        };
      }
      if (name === 'update_transaction_with_manual_loan_payment') {
        const index = state.transactions.findIndex(
          (row) => row.id === Number(params.p_transaction_id),
        );
        if (index >= 0) {
          state.transactions[index] = {
            ...state.transactions[index],
            ...params.p_transaction,
          };
        }
        const paymentIndex = state.loanPayments.findIndex(
          (row) => row.transaction_id === Number(params.p_transaction_id),
        );
        let loanPayment = null;
        if (params.p_loan_payment) {
          loanPayment = {
            ...(paymentIndex >= 0 ? state.loanPayments[paymentIndex] : {
              id: 900 + state.loanPayments.length,
              transaction_id: Number(params.p_transaction_id),
            }),
            loan_id: params.p_transaction.loan_id,
            source_kind: 'manual',
            payment_kind: 'installment',
            ...params.p_loan_payment,
          };
          if (paymentIndex >= 0) state.loanPayments[paymentIndex] = loanPayment;
          else state.loanPayments.push(loanPayment);
        } else if (paymentIndex >= 0) {
          state.loanPayments.splice(paymentIndex, 1);
        }
        return {
          data: {
            transaction: state.transactions[index],
            loanPayment,
            loan: params.p_transaction.loan_id ? { id: params.p_transaction.loan_id } : null,
          },
          error: null,
        };
      }
      if (name === 'delete_transaction_with_loan_payment') {
        state.transactions = state.transactions.filter(
          (row) => row.id !== Number(params.p_transaction_id),
        );
        state.loanPayments = state.loanPayments.filter(
          (row) => row.transaction_id !== Number(params.p_transaction_id),
        );
        return { data: Number(params.p_transaction_id), error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
    from(table) {
      if (table === 'categories') {
        return {
          select() {
            return {
              eq() {
                return { single: async () => ({ data: { name: 'הלוואות' }, error: null }) };
              },
            };
          },
          update() {
            return { eq: async () => ({ error: null }) };
          },
        };
      }

      return {
        select() {
          return {
            eq(_column, value) {
              if (table === 'transactions') {
                return {
                  single: async () => ({
                    data: state.transactions.find((row) => row.id === Number(value)) || null,
                    error: null,
                  }),
                };
              }
              if (table === 'loan_payments') {
                return {
                  maybeSingle: async () => ({
                    data: state.loanPayments.find(
                      (row) => row.transaction_id === Number(value),
                    ) || null,
                    error: null,
                  }),
                };
              }
              return { single: async () => ({ data: null, error: null }) };
            },
          };
        },
        insert(rows) {
          if (table === 'transactions') {
            const inserted = rows.map((row) => ({ ...row, id: transactionId += 1 }));
            state.transactions.push(...inserted);
            return {
              data: inserted,
              error: null,
              select: async () => ({ data: [inserted[0]], error: null }),
            };
          }
          return { data: rows, error: null, select: async () => ({ data: rows, error: null }) };
        },
        delete() {
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };
}

const request = (overrides = {}, loanHandling) => {
  const normalizedLoanHandling = loanHandling?.mode === 'repayment'
    && !Object.prototype.hasOwnProperty.call(loanHandling, 'next_scheduled_due_date')
    ? { ...loanHandling, next_scheduled_due_date: '2026-09-15' }
    : loanHandling;
  return ({
  body: {
    transaction: {
      description: 'תשלום חודשי הלוואה',
      movement_type: 'expense',
      category_id: 24,
      total_amount: '727.39',
      global_discount: 0,
      payment_source_id: 3,
      transaction_date: '2026-09-02',
      charge_date: '2026-09-02',
      installment_count: 36,
      ...overrides,
    },
    items: [],
    ...(normalizedLoanHandling ? { loan_handling: normalizedLoanHandling } : {}),
  },
  });
};

test('loan-linked transaction defaults to link-only and creates no future siblings', async () => {
  const fake = createTransactionFake();
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();

  await controller.createTransaction(request({ loan_id: 3 }), res);

  assert.equal(res.statusCode, 201);
  assert.equal(fake.state.transactions.length, 1);
  assert.equal(fake.state.transactions[0].total_amount, 727.39);
  assert.equal(fake.state.transactions[0].installment_count, 36);
  assert.equal(fake.state.transactions[0].installment_number, null);
  assert.equal(fake.state.loanPayments.length, 0);
  assert.equal(fake.state.rpcCalls.length, 1);
  assert.equal(fake.state.rpcCalls[0].name, 'create_transaction_with_manual_loan_payment');
  assert.equal(fake.state.rpcCalls[0].params.p_loan_payment, null);
  assert.equal(fake.state.rpcCalls[0].params.p_transaction.loan_id, 3);
  assert.equal(fake.state.rpcCalls[0].params.p_transaction.total_amount, 727.39);
  assert.equal(Object.hasOwn(fake.state.rpcCalls[0].params.p_transaction, 'id'), false);
});

test('manual repayment sends an exact component split through one atomic RPC', async () => {
  const fake = createTransactionFake();
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();

  await controller.createTransaction(request({
    loan_id: 1,
    total_amount: '1611.58',
    installment_count: 60,
  }, {
    mode: 'repayment',
    principal_amount: '1103.36',
    interest_amount: '508.22',
    other_amount: '0',
  }), res);

  assert.equal(res.statusCode, 201);
  assert.equal(fake.state.transactions.length, 1);
  assert.equal(fake.state.loanPayments.length, 1);
  assert.equal(fake.state.loanPayments[0].source_kind, 'manual');
  assert.equal(fake.state.rpcCalls.length, 1);
  assert.equal(fake.state.rpcCalls[0].name, 'create_transaction_with_manual_loan_payment');
  assert.deepEqual(fake.state.rpcCalls[0].params.p_loan_payment, {
    principal_amount: '1103.36',
    interest_amount: '508.22',
    other_amount: '0.00',
    next_scheduled_due_date: '2026-09-15',
  });
});

test('server rejects a manual repayment whose components do not reconcile', async () => {
  const fake = createTransactionFake();
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await controller.createTransaction(request({ loan_id: 1, total_amount: '1611.58' }, {
      mode: 'repayment',
      principal_amount: '1103.36',
      interest_amount: '500.00',
      other_amount: '0',
    }), res);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(res.statusCode, 400);
  assert.equal(fake.state.rpcCalls.length, 0);
  assert.equal(fake.state.transactions.length, 0);
});

test('ordinary installment transaction still creates every future sibling', async () => {
  const fake = createTransactionFake();
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();

  await controller.createTransaction(request({ installment_count: 3, loan_id: null }), res);

  assert.equal(res.statusCode, 201);
  assert.equal(fake.state.transactions.length, 3);
  assert.deepEqual(
    fake.state.transactions.map((row) => row.installment_number),
    [1, 2, 3],
  );
  assert.equal(fake.state.rpcCalls.length, 0);
});

test('explicit link-only ancillary expense remains linked without a loan payment', async () => {
  const fake = createTransactionFake();
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();

  await controller.createTransaction(request({
    description: 'ריבית גישור',
    total_amount: '165.70',
    loan_id: 4,
    installment_count: 1,
  }, { mode: 'link_only' }), res);

  assert.equal(res.statusCode, 201);
  assert.equal(fake.state.transactions.length, 1);
  assert.equal(fake.state.transactions[0].loan_id, 4);
  assert.equal(fake.state.rpcCalls.length, 1);
  assert.equal(fake.state.rpcCalls[0].name, 'create_transaction_with_manual_loan_payment');
  assert.equal(fake.state.rpcCalls[0].params.p_loan_payment, null);
});

test('manual repayment edit updates the one existing payment through one atomic RPC', async () => {
  const fake = createTransactionFake();
  fake.state.transactions.push({ id: 42, loan_id: 3, total_amount: 1611.58 });
  fake.state.loanPayments.push({
    id: 901,
    transaction_id: 42,
    loan_id: 3,
    source_kind: 'manual',
    principal_amount: '1103.36',
    interest_amount: '508.22',
    other_amount: '0.00',
    next_scheduled_due_date: '2026-09-15',
  });
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();
  const req = request({ loan_id: 3, total_amount: '1611.58' }, {
    mode: 'repayment',
    principal_amount: '1100.00',
    interest_amount: '500.00',
    other_amount: '11.58',
  });
  req.params = { id: '42' };

  await controller.updateTransaction(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(fake.state.rpcCalls.length, 1);
  assert.equal(fake.state.rpcCalls[0].name, 'update_transaction_with_manual_loan_payment');
  assert.equal(fake.state.rpcCalls[0].params.p_transaction_id, '42');
  assert.equal(fake.state.rpcCalls[0].params.p_transaction.loan_id, 3);
  assert.equal(fake.state.loanPayments.length, 1);
  assert.equal(fake.state.loanPayments[0].principal_amount, '1100.00');
  assert.equal(fake.state.loanPayments[0].other_amount, '11.58');
  assert.equal(fake.state.loanPayments[0].next_scheduled_due_date, '2026-09-15');
});

test('payment-date edits retain the schedule transition and an explicit schedule edit changes it', async () => {
  const fake = createTransactionFake();
  fake.state.transactions.push({
    id: 46,
    loan_id: 3,
    total_amount: 1611.58,
    transaction_date: '2026-08-16',
    charge_date: '2026-08-16',
  });
  fake.state.loanPayments.push({
    id: 904,
    transaction_id: 46,
    loan_id: 3,
    source_kind: 'manual',
    principal_amount: '1103.36',
    interest_amount: '508.22',
    other_amount: '0.00',
    next_scheduled_due_date: '2026-09-15',
  });
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);

  const dateEditResponse = createMockResponse();
  const dateEdit = request({
    loan_id: 3,
    total_amount: '1611.58',
    transaction_date: '2026-08-17',
    charge_date: '2026-08-17',
  }, {
    mode: 'repayment',
    principal_amount: '1103.36',
    interest_amount: '508.22',
    other_amount: '0',
    next_scheduled_due_date: '2026-09-15',
  });
  dateEdit.params = { id: '46' };
  await controller.updateTransaction(dateEdit, dateEditResponse);
  assert.equal(fake.state.loanPayments[0].next_scheduled_due_date, '2026-09-15');

  const scheduleEditResponse = createMockResponse();
  const scheduleEdit = request({ loan_id: 3, total_amount: '1611.58' }, {
    mode: 'repayment',
    principal_amount: '1103.36',
    interest_amount: '508.22',
    other_amount: '0',
    next_scheduled_due_date: '2026-09-16',
  });
  scheduleEdit.params = { id: '46' };
  await controller.updateTransaction(scheduleEdit, scheduleEditResponse);
  assert.equal(fake.state.loanPayments[0].next_scheduled_due_date, '2026-09-16');
});

test('link-only to repayment edit creates exactly one authoritative payment', async () => {
  const fake = createTransactionFake();
  fake.state.transactions.push({ id: 44, loan_id: 3, total_amount: 1611.58 });
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();
  const req = request({ loan_id: 3, total_amount: '1611.58' }, {
    mode: 'repayment',
    principal_amount: '1103.36',
    interest_amount: '508.22',
    other_amount: '0',
  });
  req.params = { id: '44' };

  await controller.updateTransaction(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(fake.state.loanPayments.length, 1);
  assert.equal(fake.state.loanPayments[0].transaction_id, 44);
});

test('moving a repayment between loans keeps one payment and uses one atomic update RPC', async () => {
  const fake = createTransactionFake();
  fake.state.transactions.push({ id: 45, loan_id: 3, total_amount: 1611.58 });
  fake.state.loanPayments.push({
    id: 905,
    transaction_id: 45,
    loan_id: 3,
    source_kind: 'manual',
    principal_amount: '1103.36',
    interest_amount: '508.22',
    other_amount: '0.00',
  });
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();
  const req = request({ loan_id: 4, total_amount: '1611.58' }, {
    mode: 'repayment',
    principal_amount: '1103.36',
    interest_amount: '508.22',
    other_amount: '0',
  });
  req.params = { id: '45' };

  await controller.updateTransaction(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(fake.state.rpcCalls.length, 1);
  assert.equal(fake.state.rpcCalls[0].name, 'update_transaction_with_manual_loan_payment');
  assert.equal(fake.state.loanPayments.length, 1);
  assert.equal(fake.state.loanPayments[0].id, 905);
  assert.equal(fake.state.loanPayments[0].loan_id, 4);
});

test('editing a linked ancillary expense preserves the no-payment distinction', async () => {
  const fake = createTransactionFake();
  fake.state.transactions.push({ id: 70, loan_id: 4, total_amount: 165.70 });
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();
  const req = request({
    description: 'Bridging interest',
    total_amount: '165.70',
    loan_id: 4,
    installment_count: 1,
  });
  req.params = { id: '70' };

  await controller.updateTransaction(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(fake.state.rpcCalls.length, 1);
  assert.equal(fake.state.rpcCalls[0].name, 'update_transaction_with_manual_loan_payment');
  assert.equal(fake.state.rpcCalls[0].params.p_loan_payment, null);
});

test('repayment to link-only edit removes the authoritative payment but keeps the transaction', async () => {
  const fake = createTransactionFake();
  fake.state.transactions.push({ id: 42, loan_id: 3, total_amount: 727.39 });
  fake.state.loanPayments.push({
    id: 901, transaction_id: 42, loan_id: 3, source_kind: 'manual',
  });
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();
  const req = request({ loan_id: 3 }, { mode: 'link_only' });
  req.params = { id: '42' };

  await controller.updateTransaction(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(fake.state.transactions.length, 1);
  assert.equal(fake.state.loanPayments.length, 0);
});

test('transaction delete uses one atomic RPC and no separate table delete', async () => {
  const fake = createTransactionFake();
  fake.state.transactions.push({ id: 42, loan_id: 3, total_amount: 727.39 });
  fake.state.loanPayments.push({
    id: 901, transaction_id: 42, loan_id: 3, source_kind: 'manual',
  });
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();

  await controller.deleteTransaction({ params: { id: '42' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(fake.state.rpcCalls, [{
    name: 'delete_transaction_with_loan_payment',
    params: { p_transaction_id: '42' },
  }]);
  assert.equal(fake.state.transactions.length, 0);
  assert.equal(fake.state.loanPayments.length, 0);
});

test('deleting a link-only transfer never touches loan payment state', async () => {
  const fake = createTransactionFake();
  fake.state.transactions.push({ id: 70, loan_id: 1, total_amount: 5000 });
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();

  await controller.deleteTransaction({ params: { id: '70' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(fake.state.transactions.length, 0);
  assert.equal(fake.state.loanPayments.length, 0);
});

test('single-transaction API exposes the linked loan payment without inferring from loan_id', async () => {
  const fake = createTransactionFake();
  fake.state.transactions.push({ id: 42, loan_id: 1, transaction_items: [] });
  fake.state.loanPayments.push({
    id: 901,
    transaction_id: 42,
    loan_id: 1,
    source_kind: 'manual',
    principal_amount: '1103.36',
    interest_amount: '508.22',
    other_amount: '0.00',
  });
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();

  await controller.getTransactionById({ params: { id: '42' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.loan_id, 1);
  assert.equal(res.body.loan_payment.id, 901);
  assert.equal(res.body.loan_payment.principal_amount, '1103.36');
});

test('an atomic create RPC failure leaves no controller-side ledger fallback', async () => {
  const fake = createTransactionFake({ failRpc: 'create_transaction_with_manual_loan_payment' });
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await controller.createTransaction(request({ loan_id: 3 }, { mode: 'link_only' }), res);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'atomic operation rejected');
  assert.equal(fake.state.transactions.length, 0);
  assert.equal(fake.state.rpcCalls.length, 1);
});
