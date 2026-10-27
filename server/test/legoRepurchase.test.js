const test = require('node:test');
const assert = require('node:assert/strict');
const { createRepurchaseService } = require('../services/legoRepurchaseService');
const { createMockResponse, loadControllerWithFake } = require('./helpers/fakeSupabase');

const sold = (overrides = {}) => ({
  id: 'lego-uuid', set_number: '42207', name: 'Test set', status: 'Sold',
  purchase_price: '574.60', receipt_price: '574.60', original_price: '700.00',
  purchase_date: '2025-01-01', acquisition_type: 'purchase', transaction_id: 1, ...overrides,
});
const purchase = (overrides = {}) => ({
  id: 2, movement_type: 'expense', category_id: 2, transaction_date: '2026-10-26',
  total_amount: 450, installment_count: null, parent_transaction_id: null, ...overrides,
});
const line = (overrides = {}) => ({
  id: 10, transaction_id: 2, set_number: '42207', quantity: 1,
  price_per_unit: '600.00', final_price: '500.00', allocated_global_discount: '50.00',
  acquisition_type: 'purchase', ...overrides,
});
// In-memory PostgREST/RPC contract double; never loads credentials or calls a DB.
function fakeDb({ sets = [sold()], transactions = [purchase()], items = [line()] } = {}) {
  const state = { lego_sets: structuredClone(sets), transactions: structuredClone(transactions),
    transaction_items: structuredClone(items), categories: [{ id: 2, name: 'Lego' }] };
  let sequence = 100;
  const db = {
    state, writes: 0, failNext: false, ambiguous: false, race: null,
    async rpc(name, args) {
      const id = args.p_transaction_id;
      if (name === 'delete_transaction_with_loan_payment') {
        state.transactions = state.transactions.filter((r) => String(r.id) !== String(id));
        state.transaction_items = state.transaction_items.filter((r) => String(r.transaction_id) !== String(id));
        state.lego_sets = state.lego_sets.filter((r) => String(r.transaction_id) !== String(id));
        return { data: {}, error: null };
      }
      assert.equal(name, 'update_transaction_with_manual_loan_payment');
      const row = state.transactions.find((r) => String(r.id) === String(id));
      Object.assign(row, args.p_transaction);
      return { data: { transaction: structuredClone(row) }, error: null };
    },
    from(table) {
      let action = 'read'; let payload; let columns = '*';
      const filters = [];
      const matches = (row) => filters.every((filter) => filter(row));
      const run = async (single = false) => {
        if (db.failTransactionRead && action === 'read' && table === 'transactions') return { error: new Error('offline') };
        if (action === 'update' && table === 'lego_sets') {
          if (db.race) { db.race(state); db.race = null; }
          if (db.failNext) { db.failNext = false; return { error: new Error('offline') }; }
        }
        let rows = state[table].filter(matches);
        if (action === 'insert') {
          rows = payload.map((row) => ({ id: ++sequence, ...row }));
          state[table].push(...rows);
        }
        if (action === 'update') {
          rows.forEach((row) => Object.assign(row, payload));
          if (table === 'lego_sets') db.writes += rows.length;
          if (db.ambiguous) { db.ambiguous = false; return { error: new Error('response lost') }; }
        }
        if (action === 'delete') state[table] = state[table].filter((row) => !matches(row));
        rows = structuredClone(rows);
        if (table === 'transactions' && columns.includes('transaction_items')) rows.forEach((row) => {
          row.transaction_items = structuredClone(state.transaction_items.filter((item) => item.transaction_id === row.id));
        });
        return { data: single ? rows[0] || null : rows, error: null };
      };
      const query = {
        select(value = '*') { columns = value; return query; },
        eq(key, value) { filters.push((row) => String(row[key]) === String(value)); return query; },
        neq(key, value) { filters.push((row) => String(row[key]) !== String(value)); return query; },
        is(key, value) { filters.push((row) => row[key] === value); return query; },
        in(key, values) { filters.push((row) => values.includes(row[key])); return query; },
        insert(value) { action = 'insert'; payload = value; return query; },
        update(value) { action = 'update'; payload = value; return query; },
        delete() { action = 'delete'; return query; },
        single() { return run(true); }, maybeSingle() { return run(true); },
        then(resolve, reject) { return run().then(resolve, reject); },
      };
      return query;
    },
  };
  return db;
}
async function setup(options, serviceOptions) {
  const db = fakeDb(options);
  const service = createRepurchaseService(serviceOptions);
  const [candidate] = await service.issue(db, 'owner', 2, db.state.lego_sets);
  return { db, service, token: candidate?.confirmation_token };
}
const confirm = ({ db, service, token }) => service.confirm(db, 'owner', token);
const rejectsStale = (work) => assert.rejects(work, { code: 'LEGO_REPURCHASE_STALE' });

test('explicit confirmation preserves UUID/transaction and replaces all acquisition fields, including original link', async () => {
  const context = await setup();
  const transactions = structuredClone(context.db.state.transactions);
  assert.equal(context.db.state.lego_sets[0].status, 'Sold'); // Detection alone has no mutation.
  const row = await confirm(context);
  assert.deepEqual(row, { ...sold(), status: 'New', transaction_id: 2, purchase_date: '2026-10-26',
    purchase_price: '450.00', receipt_price: '500.00', original_price: '600.00' });
  assert.equal(context.db.state.lego_sets.length, 1);
  assert.deepEqual(context.db.state.transactions, transactions);
  await context.db.rpc('delete_transaction_with_loan_payment', { p_transaction_id: 1 });
  assert.equal(context.db.state.lego_sets[0].id, 'lego-uuid');
});

test('declining an offer leaves both the saved transaction and Sold row untouched', async () => {
  const { db } = await setup();
  assert.deepEqual(db.state.lego_sets, [sold()]);
  assert.deepEqual(db.state.transactions, [purchase()]);
  assert.equal(db.writes, 0);
});

test('concurrent/repeated confirmations perform one update and return the same UUID', async () => {
  const context = await setup();
  const rows = await Promise.all([confirm(context), confirm(context), confirm(context)]);
  assert.deepEqual(rows.map((row) => row.id), ['lego-uuid', 'lego-uuid', 'lego-uuid']);
  assert.equal(context.db.writes, 1);
});

test('transient failure retries without another purchase or collection record', async () => {
  const context = await setup();
  context.db.failNext = true;
  await assert.rejects(confirm(context), /offline/);
  assert.equal(context.db.state.lego_sets[0].status, 'Sold');
  await confirm(context);
  assert.equal(context.db.state.transactions.length, 1);
  assert.equal(context.db.state.lego_sets.length, 1);
});

test('lost database response is reconciled on retry without a second update', async () => {
  const context = await setup();
  context.db.ambiguous = true;
  await assert.rejects(confirm(context), /response lost/);
  await confirm(context);
  assert.equal(context.db.writes, 1);
});

test('changed, deleted, voided, or non-expense saved transactions cannot restore a set', async () => {
  for (const mutate of [
    (db) => { db.state.transaction_items[0].final_price = '1.00'; },
    (db) => { db.state.transactions = []; },
    (db) => { db.state.transactions[0].voided_at = '2026-10-26'; },
    (db) => { db.state.transactions[0].movement_type = 'income'; },
  ]) {
    const context = await setup(); mutate(context.db);
    await rejectsStale(confirm(context));
    assert.equal(context.db.state.lego_sets[0].status, 'Sold');
  }
});

test('guarded update rejects changes between revalidation and write', async () => {
  const context = await setup();
  context.db.race = (state) => { state.lego_sets[0].purchase_price = '300.00'; };
  await rejectsStale(confirm(context));
  assert.equal(context.db.state.lego_sets[0].purchase_price, '300.00');
  assert.equal(context.db.state.lego_sets[0].status, 'Sold');
});

test('active or otherwise changed collection record rejects stale confirmation', async () => {
  const context = await setup();
  context.db.state.lego_sets[0].status = 'Built';
  await rejectsStale(confirm(context));
  assert.equal(context.db.writes, 0);
});

test('newer purchase offer revokes the older offer', async () => {
  const context = await setup();
  context.db.state.transactions.push(purchase({ id: 3 }));
  context.db.state.transaction_items.push(line({ id: 11, transaction_id: 3, final_price: '550.00' }));
  const [newer] = await context.service.issue(context.db, 'owner', 3, context.db.state.lego_sets);
  await rejectsStale(confirm(context));
  const row = await context.service.confirm(context.db, 'owner', newer.confirmation_token);
  assert.equal(row.transaction_id, 3);
  assert.equal(row.purchase_price, '500.00');
});

test('a delayed older create cannot replace a newer offer, even after the newer offer is revoked', async () => {
  const context = await setup();
  context.db.state.transactions.push(purchase({ id: 3 }));
  context.db.state.transaction_items.push(line({ id: 11, transaction_id: 3 }));
  await context.service.issue(context.db, 'owner', 3, context.db.state.lego_sets);
  await context.service.guardMutation('transaction', async () => {})({ params: { id: 3 } }, {});
  assert.deepEqual(await context.service.issue(context.db, 'owner', 2, context.db.state.lego_sets), []);
  await rejectsStale(confirm(context));
});

test('a transaction edit already in flight revokes confirmation before Return can write', async () => {
  const context = await setup();
  let releaseEdit;
  let entered;
  const editing = new Promise((resolve) => { entered = resolve; });
  const edit = context.service.guardMutation('transaction', async () => {
    entered();
    await new Promise((resolve) => { releaseEdit = resolve; });
    context.db.state.transactions[0].transaction_date = '2026-10-25';
  })({ params: { id: 2 } }, {});
  await editing;
  const rejected = rejectsStale(confirm(context));
  releaseEdit();
  await Promise.all([edit, rejected]);
  assert.equal(context.db.writes, 0);
});

test('confirmation is bound to the authenticated user and cannot be forged', async () => {
  const context = await setup();
  await rejectsStale(context.service.confirm(context.db, 'another-user', context.token));
  await rejectsStale(context.service.confirm(context.db, null, context.token));
  await rejectsStale(context.service.confirm(context.db, 'owner', 'forged'));
  await confirm(context);
});

test('expiry, process restart and bounded-store eviction fail closed', async () => {
  let clock = 0;
  const context = await setup(undefined, { now: () => clock, ttl: 10, limit: 1 });
  clock = 11;
  await rejectsStale(confirm(context));
  await rejectsStale(createRepurchaseService().confirm(context.db, 'owner', context.token));
  const [first] = await context.service.issue(context.db, 'owner', 2, context.db.state.lego_sets);
  context.db.state.lego_sets.push(sold({ id: 'another-uuid', set_number: '42208' }));
  context.db.state.transaction_items.push(line({ id: 11, set_number: '42208' }));
  await context.service.issue(context.db, 'owner', 2, [context.db.state.lego_sets[1]]);
  await rejectsStale(context.service.confirm(context.db, 'owner', first.confirmation_token));
});

test('historical edit or manual return/resale revokes even an already completed offer', async () => {
  for (const kind of ['set', 'transaction']) {
    const context = await setup();
    await confirm(context);
    await context.service.guardMutation(kind, async () => {
      context.db.state.lego_sets[0].status = 'Sold';
    })({ params: { id: kind === 'set' ? 'lego-uuid' : 2 } }, {});
    await rejectsStale(confirm(context));
    assert.equal(context.db.state.lego_sets[0].status, 'Sold');
  }
});

test('equivalent numeric/UUID route spelling cannot bypass offer revocation', async () => {
  for (const [kind, id] of [['transaction', '002'], ['set', 'LEGO-UUID']]) {
    const context = await setup();
    await context.service.guardMutation(kind, async () => {})({ params: { id } }, {});
    await rejectsStale(confirm(context));
  }
});

test('installments use the entire line allocation, not the installment payment amount', async () => {
  const context = await setup({ transactions: [purchase({ total_amount: 150, installment_count: 3 })] });
  assert.equal((await confirm(context)).purchase_price, '450.00');
});

test('legacy quantity uses existing per-unit discount rounding without adding copies', async () => {
  const context = await setup({ items: [line({ quantity: 3, allocated_global_discount: '50.00' })] });
  assert.equal((await confirm(context)).purchase_price, '483.33');
  assert.equal(context.db.state.lego_sets.length, 1);
});

test('Gift/GWP to purchase replaces zero cost; new Gift/GWP retains zero-cost rules', async () => {
  for (const type of ['gift', 'gwp']) {
    const paid = await setup({ sets: [sold({ acquisition_type: type, purchase_price: '0.00' })] });
    const paidRow = await confirm(paid);
    assert.equal(paidRow.acquisition_type, 'purchase');
    assert.equal(paidRow.purchase_price, '450.00');
    const free = await setup({ items: [line({ acquisition_type: type, final_price: '0.00', allocated_global_discount: '0.00' })] });
    const freeRow = await confirm(free);
    assert.equal(freeRow.acquisition_type, type);
    assert.equal(freeRow.purchase_price, '0.00');
    assert.equal(freeRow.receipt_price, '0.00');
  }
});

const createRequest = (transaction = {}, items = []) => ({ user: { id: 'owner' }, body: {
  transaction: { description: 'New LEGO purchase test', movement_type: 'expense', category_id: 2,
    transaction_date: '2026-10-26', total_amount: '450', global_discount: '50', installment_count: 1, ...transaction },
  items: items.length ? items : [{ item_name: 'Test set', set_number: '42207', quantity: 1,
    price_per_unit: '600', discount_type: 'amount', discount_value: '100', acquisition_type: 'purchase' }],
} });
async function create(db, request = createRequest()) {
  const controller = loadControllerWithFake('../../controllers/transactionController', db);
  const response = createMockResponse();
  await controller.createTransaction(request, response);
  assert.equal(response.statusCode, 201);
  return { controller, response };
}

test('new purchase detects Sold, preserves active skip and inserts missing exact numbers', async () => {
  const db = fakeDb({ sets: [sold(), sold({ id: 'active', set_number: '42208', status: 'Built' })], transactions: [], items: [] });
  const items = ['42207', '42208', '42207-1'].map((set_number) => ({ set_number, item_name: 'Test set', quantity: 1, price_per_unit: '10' }));
  const { response } = await create(db, createRequest({ total_amount: '30', global_discount: 0 }, items));
  assert.equal(response.body.lego_repurchase_candidates.length, 1);
  assert.equal(response.body.lego_repurchase_candidates[0].set_number, '42207');
  assert.deepEqual(db.state.lego_sets[0], sold());
  assert.equal(db.state.lego_sets[1].status, 'Built');
  assert.equal(db.state.lego_sets[2].set_number, '42207-1');
  assert.equal(db.state.lego_sets[2].status, 'New');
});

test('API confirmation only accepts a capability, never client prices or transaction IDs', async () => {
  const db = fakeDb();
  const { response } = await create(db);
  const lego = loadControllerWithFake('../../controllers/legoController', db);
  const candidate = response.body.lego_repurchase_candidates[0];
  for (const body of [{ ...candidate, transaction_id: 1 }, { confirmation_token: candidate.confirmation_token, purchase_price: 0 }]) {
    const denied = createMockResponse();
    await lego.confirmRepurchase({ user: { id: 'owner' }, body }, denied);
    assert.equal(denied.statusCode, 400);
  }
  const result = createMockResponse();
  await lego.confirmRepurchase({ user: { id: 'owner' }, body: { confirmation_token: candidate.confirmation_token } }, result);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.set.id, 'lego-uuid');
  assert.equal(result.body.set.transaction_id, response.body.id);
});

test('controller deletion of the original purchase cannot delete a returned set', async () => {
  const db = fakeDb({ transactions: [purchase({ id: 1 })] });
  const { controller, response } = await create(db);
  const lego = loadControllerWithFake('../../controllers/legoController', db);
  const confirmation = createMockResponse();
  await lego.confirmRepurchase({ user: { id: 'owner' }, body: {
    confirmation_token: response.body.lego_repurchase_candidates[0].confirmation_token,
  } }, confirmation);
  assert.equal(confirmation.statusCode, 200);
  const deleted = createMockResponse();
  await controller.deleteTransaction({ params: { id: 1 } }, deleted);
  assert.equal(deleted.statusCode, 200);
  assert.equal(db.state.lego_sets[0].id, 'lego-uuid');
  assert.equal(db.state.lego_sets[0].transaction_id, response.body.id);
  assert.equal(db.state.transactions.length, 1);
});

test('historical edit neither prompts nor reactivates, and revokes new-purchase confirmation', async () => {
  const db = fakeDb();
  const { controller, response } = await create(db);
  const edit = createMockResponse();
  await controller.updateTransaction({ ...createRequest(), params: { id: response.body.id } }, edit);
  assert.equal(edit.statusCode, 200);
  assert.equal(edit.body.lego_repurchase_candidates, undefined);
  assert.equal(db.state.lego_sets[0].status, 'Sold');
  const lego = loadControllerWithFake('../../controllers/legoController', db);
  const confirmation = createMockResponse();
  await lego.confirmRepurchase({ user: { id: 'owner' }, body: {
    confirmation_token: response.body.lego_repurchase_candidates[0].confirmation_token,
  } }, confirmation);
  assert.equal(confirmation.statusCode, 409);
});

test('offer failure still reports successful saved purchase, with manual fallback', async () => {
  const db = fakeDb(); db.failTransactionRead = true;
  const { response } = await create(db);
  assert.equal(response.body.lego_repurchase_unavailable, true);
  assert.equal(db.state.transactions.length, 2);
  assert.equal(db.state.lego_sets[0].status, 'Sold');
});

test('new installment purchase confirms whole acquisition and retains sibling amounts', async () => {
  const db = fakeDb({ transactions: [], items: [] });
  const { response } = await create(db, createRequest({ installment_count: 3 }));
  assert.deepEqual(db.state.transactions.map((t) => t.total_amount), [150, 150, 150]);
  const lego = loadControllerWithFake('../../controllers/legoController', db);
  const result = createMockResponse();
  await lego.confirmRepurchase({ user: { id: 'owner' }, body: {
    confirmation_token: response.body.lego_repurchase_candidates[0].confirmation_token,
  } }, result);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.set.purchase_price, '450.00');
});

test('income and ambiguous legacy duplicate set numbers do not offer repurchase', async () => {
  for (const [sets, request] of [
    [[sold()], createRequest({ movement_type: 'income' })],
    [[sold(), sold({ id: 'duplicate' })], createRequest()],
  ]) {
    const db = fakeDb({ sets });
    const { response } = await create(db, request);
    assert.equal(response.body.lego_repurchase_candidates, undefined);
    assert.equal(db.writes, 0);
  }
});
