const assert = require('node:assert/strict');
const test = require('node:test');
const { createMockResponse, loadControllerWithFake } = require('./helpers/fakeSupabase');

const fixture = { name: 'בנק דיסקונט - 5297', method: 'bank_account', issuer: 'Discount', last4: '5297', owner: 'Synthetic owner' };
function setup() {
  const rows = []; let nextId = 1;
  const fake = { from(table) {
    assert.equal(table, 'payment_sources');
    let action, values, id;
    const query = {
      insert(input) { action = 'insert'; values = input[0]; assert.equal(values.id, undefined); return this; },
      update(input) { action = 'update'; values = input; return this; },
      eq(column, value) { assert.equal(column, 'id'); id = Number(value); return this; },
      select() { return this; },
      async order(column, options) { assert.equal(column, 'name'); assert.equal(options.ascending, true); return { data: [...rows], error: null }; },
      async single() {
        const row = action === 'insert' ? { id: nextId++, ...values } : Object.assign(rows.find(r => r.id === id), values);
        if (action === 'insert') rows.push(row);
        return { data: { ...row }, error: null };
      },
      then(resolve) { if (action === 'update') Object.assign(rows.find(r => r.id === id), values); resolve({ error: null }); },
    };
    return query;
  } };
  return { controller: loadControllerWithFake('../../controllers/settingsController', fake), rows };
}

test('bank account settings create, list, update and soft-delete preserve the assigned identity', async () => {
  const { controller, rows } = setup();
  let res = createMockResponse();
  await controller.createPaymentSource({ body: { ...fixture, id: 999 } }, res);
  assert.equal(res.statusCode, 201);
  const id = res.body.id;
  assert.notEqual(id, 999); assert.deepEqual({ ...fixture, is_active: true }, Object.fromEntries(Object.keys({ ...fixture, is_active: true }).map(k => [k, res.body[k]])));
  res = createMockResponse(); await controller.getPaymentSources({}, res);
  assert.equal(res.body[0].id, id); assert.equal(res.body[0].method, 'bank_account');
  res = createMockResponse();
  await controller.updatePaymentSource({ params: { id }, body: { ...fixture, owner: 'Edited owner', is_active: false } }, res);
  assert.equal(res.statusCode, null); assert.equal(res.body.id, id); assert.equal(res.body.is_active, false);
  assert.equal(res.body.owner, 'Edited owner');
  await controller.updatePaymentSource({ params: { id }, body: { is_active: true } }, createMockResponse());
  await controller.deletePaymentSource({ params: { id } }, createMockResponse());
  assert.equal(rows.length, 1); assert.equal(rows[0].is_active, false);
});

test('all old payment methods remain accepted; invalid methods and missing names remain rejected', async () => {
  const { controller } = setup();
  for (const method of ['credit_card', 'debit_card', 'cash', 'bank_transfer', 'digital_wallet', 'check']) {
    const res = createMockResponse();
    await controller.createPaymentSource({ body: { name: method, method } }, res);
    assert.equal(res.statusCode, 201, method);
  }
  for (const body of [{ name: 'x', method: 'invalid' }, { name: ' ', method: 'bank_account' }]) {
    const res = createMockResponse(); await controller.createPaymentSource({ body }, res); assert.equal(res.statusCode, 400);
  }
  const res = createMockResponse();
  await controller.updatePaymentSource({ params: { id: 1 }, body: { method: 'invalid' } }, res);
  assert.equal(res.statusCode, 400);
});
