const test = require('node:test');
const assert = require('node:assert/strict');
const { loadControllerWithFake, createMockResponse } = require('./helpers/fakeSupabase');

const setup = (initial = []) => {
  const tables = { shopping_lists: structuredClone(initial), shopping_checkouts: [], transactions: [] };
  const calls = [];
  const client = { from(table) {
    calls.push(table);
    assert.ok(tables[table], `Unexpected table ${table}`);
    let operation = 'read'; let payload; const filters = [];
    const execute = () => {
      let rows = tables[table].filter((row) => filters.every(([key, value]) => String(row[key]) === String(value)));
      if (operation === 'insert') {
        rows = payload.map((row) => ({ id: tables[table].length + 1, ...row }));
        tables[table].push(...rows);
      }
      if (operation === 'update') rows.forEach((row) => Object.assign(row, payload));
      return { data: structuredClone(rows), error: null };
    };
    const query = {
      select() { return query; }, order() { return query; },
      eq(key, value) { filters.push([key, value]); return query; },
      insert(rows) { operation = 'insert'; payload = rows; return query; },
      update(values) { operation = 'update'; payload = values; return query; },
      single: async () => { const result = execute(); return { ...result, data: result.data[0] }; },
      then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
    };
    return query;
  } };
  const controller = loadControllerWithFake('../../controllers/shoppingController', client);
  const invoke = async (method, body = {}, id = 1) => {
    const res = createMockResponse();
    await controller[method]({ body, params: { id }, query: {} }, res);
    return res;
  };
  return { tables, calls, invoke };
};

const fields = { store: 'חנות לדוגמה', link: 'https://example.com/list?a=1&b=2', target_date: '2028-02-29' };

test('old clients can create/read lists with all optional fields omitted', async () => {
  const { invoke, tables } = setup();
  const created = await invoke('createShoppingList', { title: 'רשימה', list_type_id: 1 });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.status, 'draft');
  assert.equal(created.body.store, undefined);
  assert.equal((await invoke('getShoppingListById')).body.title, 'רשימה');
  assert.equal(tables.transactions.length, 0);
});

test('create/detail/overview return all three normalized header values', async () => {
  const { invoke } = setup();
  await invoke('createShoppingList', { title: 'קניות', list_type_id: 1, ...fields, store: `  ${fields.store}  ` });
  for (const row of [(await invoke('getShoppingListById')).body, (await invoke('getShoppingLists')).body[0]]) {
    for (const key of Object.keys(fields)) assert.equal(row[key], fields[key]);
  }
});

test('partial edits preserve omitted metadata and allow individual edits and explicit clearing', async () => {
  const { invoke, tables } = setup([{ id: 1, title: 'ישן', status: 'draft', ...fields }]);
  await invoke('updateShoppingList', { title: 'חדש', status: 'active' });
  for (const key of Object.keys(fields)) assert.equal(tables.shopping_lists[0][key], fields[key]);
  await invoke('updateShoppingList', { store: 'אחרת' });
  assert.equal(tables.shopping_lists[0].store, 'אחרת');
  assert.equal(tables.shopping_lists[0].link, fields.link);
  await invoke('updateShoppingList', { store: '', link: null, target_date: '  ' });
  for (const key of Object.keys(fields)) assert.equal(tables.shopping_lists[0][key], null);
});

test('empty strings and null normalize consistently on create', async () => {
  const { invoke } = setup();
  const res = await invoke('createShoppingList', { title: 'רשימה', list_type_id: 1, store: ' ', link: '', target_date: null });
  for (const key of Object.keys(fields)) assert.equal(res.body[key], null);
});

for (const invalid of [
  { link: 'javascript:alert(1)' }, { link: 'ftp://example.com' }, { link: 'example.com' },
  { link: 'https://user:password@example.com' }, { link: 'https://exa mple.com' }, { link: 42 },
  { target_date: '2026-02-29' }, { target_date: '2026-04-31' }, { target_date: '0000-01-01' },
  { target_date: '2026-09-07T00:00:00Z' }, { target_date: [] }, { store: {} },
]) {
  test(`invalid metadata rejected before any database access: ${JSON.stringify(invalid)}`, async () => {
    const { invoke, calls } = setup();
    for (const method of ['createShoppingList', 'updateShoppingList']) {
      const res = await invoke(method, { title: 'רשימה', list_type_id: 1, ...invalid });
      assert.equal(res.statusCode, 400);
      assert.match(res.body.error, /יש להזין/);
    }
    assert.deepEqual(calls, []);
  });
}

for (const metadata of [{}, fields]) {
  test(`checkout preserves optional headers and financial/item behavior (${Object.keys(metadata).length} fields)`, async () => {
    const items = [{ id: 7, quantity: 2, price: 10, is_purchased: true }, { id: 8, quantity: 4, price: 5, is_purchased: false }];
    const { invoke, tables } = setup([{ id: 1, title: 'רשימה', status: 'active', ...metadata, shopping_list_items: items }]);
    const result = await invoke('checkoutList', { payment_source_id: 4, category_id: 3 });
    assert.equal(result.body.total_amount, 20);
    assert.equal(tables.transactions[0].total_amount, 20);
    assert.equal(tables.transactions[0].description, 'רשימה');
    assert.equal(tables.transactions[0].payment_source_id, 4);
    assert.equal(tables.shopping_checkouts[0].transaction_id, 1);
    assert.equal(tables.shopping_lists[0].status, 'checked_out');
    assert.deepEqual(tables.shopping_lists[0].shopping_list_items, items);
    for (const key of Object.keys(metadata)) assert.equal(tables.shopping_lists[0][key], metadata[key]);
    assert.equal(tables.transactions[0].store, undefined);
    assert.equal(tables.transactions[0].target_date, undefined);
  });
}
