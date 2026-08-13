const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMockResponse,
  loadControllerWithFake,
} = require('./helpers/fakeSupabase');

function createTransactionFake(options = {}) {
  const state = { transactions: [], rpcCalls: [] };
  let transactionId = 500;

  return {
    state,
    rpc: async (name, params) => {
      state.rpcCalls.push({ name, params });
      if (options.failRpc === name) {
        return { data: null, error: { message: 'atomic operation rejected' } };
      }
      if (name === 'create_transaction_with_loan_payment') {
        const inserted = { ...params.p_transaction, id: transactionId += 1 };
        state.transactions.push(inserted);
        return { data: inserted.id, error: null };
      }
      if (name === 'update_transaction_with_loan_payment') {
        const index = state.transactions.findIndex(
          (row) => row.id === Number(params.p_transaction_id),
        );
        if (index >= 0) {
          state.transactions[index] = {
            ...state.transactions[index],
            ...params.p_transaction,
          };
        }
        return { data: Number(params.p_transaction_id), error: null };
      }
      if (name === 'delete_transaction_with_loan_payment') {
        state.transactions = state.transactions.filter(
          (row) => row.id !== Number(params.p_transaction_id),
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

const request = (overrides = {}) => ({
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
  },
});

test('loan-linked transaction records one full cash row and no future siblings', async () => {
  const fake = createTransactionFake();
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();

  await controller.createTransaction(request({ loan_id: 3 }), res);

  assert.equal(res.statusCode, 201);
  assert.equal(fake.state.transactions.length, 1);
  assert.equal(fake.state.transactions[0].total_amount, 727.39);
  assert.equal(fake.state.transactions[0].installment_count, 36);
  assert.equal(fake.state.transactions[0].installment_number, null);
  assert.equal(fake.state.rpcCalls.length, 1);
  assert.equal(fake.state.rpcCalls[0].name, 'create_transaction_with_loan_payment');
  assert.equal(fake.state.rpcCalls[0].params.p_record_loan_payment, true);
  assert.equal(fake.state.rpcCalls[0].params.p_transaction.loan_id, 3);
  assert.equal(fake.state.rpcCalls[0].params.p_transaction.total_amount, 727.39);
  assert.equal(Object.hasOwn(fake.state.rpcCalls[0].params.p_transaction, 'id'), false);
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

test('ancillary loan expense remains linked but does not create a loan payment', async () => {
  const fake = createTransactionFake();
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();

  await controller.createTransaction(request({
    description: 'ריבית גישור',
    total_amount: '165.70',
    loan_id: 4,
    installment_count: 1,
    record_loan_payment: false,
  }), res);

  assert.equal(res.statusCode, 201);
  assert.equal(fake.state.transactions.length, 1);
  assert.equal(fake.state.transactions[0].loan_id, 4);
  assert.equal(fake.state.rpcCalls.length, 1);
  assert.equal(fake.state.rpcCalls[0].name, 'create_transaction_with_loan_payment');
  assert.equal(fake.state.rpcCalls[0].params.p_record_loan_payment, false);
});

test('loan transaction update uses one atomic RPC including a move between loans', async () => {
  const fake = createTransactionFake();
  fake.state.transactions.push({ id: 42, loan_id: 3, total_amount: 727.39 });
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();
  const req = request({ loan_id: 4, installment_number: 12, installment_count: 20 });
  req.body.transaction.record_loan_payment = true;
  req.params = { id: '42' };

  await controller.updateTransaction(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(fake.state.rpcCalls.length, 1);
  assert.equal(fake.state.rpcCalls[0].name, 'update_transaction_with_loan_payment');
  assert.equal(fake.state.rpcCalls[0].params.p_transaction_id, '42');
  assert.equal(fake.state.rpcCalls[0].params.p_transaction.loan_id, 4);
  assert.equal(fake.state.rpcCalls[0].params.p_transaction.installment_number, 12);
  assert.equal(fake.state.rpcCalls[0].params.p_record_loan_payment, true);
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
  assert.equal(fake.state.rpcCalls[0].name, 'update_transaction_with_loan_payment');
  assert.equal(fake.state.rpcCalls[0].params.p_record_loan_payment, null);
});

test('transaction delete uses one atomic RPC and no separate table delete', async () => {
  const fake = createTransactionFake();
  fake.state.transactions.push({ id: 42, loan_id: 3, total_amount: 727.39 });
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();

  await controller.deleteTransaction({ params: { id: '42' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(fake.state.rpcCalls, [{
    name: 'delete_transaction_with_loan_payment',
    params: { p_transaction_id: '42' },
  }]);
  assert.equal(fake.state.transactions.length, 0);
});

test('an atomic create RPC failure leaves no controller-side ledger fallback', async () => {
  const fake = createTransactionFake({ failRpc: 'create_transaction_with_loan_payment' });
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await controller.createTransaction(request({ loan_id: 3 }), res);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'atomic operation rejected');
  assert.equal(fake.state.transactions.length, 0);
  assert.equal(fake.state.rpcCalls.length, 1);
});
