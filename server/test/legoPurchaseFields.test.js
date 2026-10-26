const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMockResponse,
  loadControllerWithFake,
} = require('./helpers/fakeSupabase');

function createLegoFake(initial = { id: 'set-id', set_number: '10001-1', status: 'New' }, options = {}) {
  const inserts = [];
  const updates = [];
  const rows = initial ? [{ ...initial }] : [];
  return {
    inserts,
    updates,
    rows,
    from(table) {
      assert.equal(table, 'lego_sets');
      const filters = [];
      const matches = (row) => filters.every((test) => test(row));
      const read = {
        eq(field, value) { filters.push((row) => row[field] === value); return read; },
        neq(field, value) { filters.push((row) => row[field] !== value); return read; },
        maybeSingle: async () => ({ data: rows.find(matches) || null, error: options.failRead || null }),
        then(resolve, reject) { return Promise.resolve({ data: rows.filter(matches), error: null }).then(resolve, reject); },
      };
      return {
        select() { return read; },
        insert(newRows) {
          inserts.push(...newRows);
          rows.push(...newRows);
          return { select: async () => ({ data: newRows, error: null }) };
        },
        update(payload) {
          updates.push(payload);
          const update = {
            eq(field, value) { filters.push((row) => row[field] === value); return update; },
            is(field, value) { filters.push((row) => row[field] === value); return update; },
            select: async () => {
              options.beforeUpdate?.(rows);
              if (options.failUpdate) return { data: null, error: options.failUpdate };
              const changed = rows.filter(matches);
              changed.forEach((row) => Object.assign(row, payload));
              return { data: changed, error: null };
            },
          };
          return update;
        },
      };
    },
  };
}

async function addSet(acquisitionType, overrides = {}) {
  const fake = createLegoFake(null);
  const controller = loadControllerWithFake('../../controllers/legoController', fake);
  const res = createMockResponse();
  await controller.addSet({ body: {
    set_number: ({ purchase: '10001-1', gift: '10002-1', gwp: '10003-1' })[acquisitionType] || '10004-1',
    name: 'Acquisition model set',
    acquisition_type: acquisitionType,
    pieces: '7541',
    image_url: 'https://cdn.rebrickable.com/media/sets/10001-1.jpg',
    original_price: '200.00',
    receipt_price: '90.00',
    purchase_price: '70.00',
    market_value: '999.00',
    ...overrides,
  } }, res);
  return { fake, res };
}

test('direct Purchase preserves the three purchase-cost fields', async () => {
  const { fake, res } = await addSet('purchase');
  assert.equal(res.statusCode, 201);
  assert.equal(fake.inserts[0].acquisition_type, 'purchase');
  assert.equal(fake.inserts[0].original_price, 200);
  assert.equal(fake.inserts[0].receipt_price, 90);
  assert.equal(fake.inserts[0].purchase_price, 70);
  assert.equal(fake.inserts[0].pieces, 7541);
  assert.equal(fake.inserts[0].image_url, 'https://cdn.rebrickable.com/media/sets/10001-1.jpg');
});

test('direct Gift is distinct from GWP and always has zero receipt and paid cost', async () => {
  const { fake, res } = await addSet('gift');
  assert.equal(res.statusCode, 201);
  assert.equal(fake.inserts[0].acquisition_type, 'gift');
  assert.equal(fake.inserts[0].receipt_price, 0);
  assert.equal(fake.inserts[0].purchase_price, 0);
  assert.equal(fake.inserts[0].original_price, 200);
  assert.equal(Object.hasOwn(fake.inserts[0], 'transaction_id'), false);
});

test('direct GWP is explicit and always has zero receipt and paid cost', async () => {
  const { fake, res } = await addSet('gwp');
  assert.equal(res.statusCode, 201);
  assert.equal(fake.inserts[0].acquisition_type, 'gwp');
  assert.equal(fake.inserts[0].receipt_price, 0);
  assert.equal(fake.inserts[0].purchase_price, 0);
});

test('obsolete current-value input is not serialized to lego_sets', async () => {
  const { fake, res } = await addSet('purchase');
  assert.equal(res.statusCode, 201);
  assert.equal(Object.hasOwn(fake.inserts[0], 'market_value'), false);
});

test('legacy acquisition values cannot be written through the API', async () => {
  const { fake, res } = await addSet('trade');
  assert.equal(res.statusCode, 400);
  assert.equal(fake.inserts.length, 0);
});

test('edit keeps the bounded LEGO payload and enforces GWP zero cost', async () => {
  const fake = createLegoFake();
  const controller = loadControllerWithFake('../../controllers/legoController', fake);
  const res = createMockResponse();
  await controller.updateSet({ params: { id: 'set-id' }, body: {
    name: 'Updated GWP',
    acquisition_type: 'gwp',
    original_price: '109.32',
    receipt_price: '10',
    purchase_price: '10',
    market_value: '150',
  } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(fake.updates[0], {
    name: 'Updated GWP',
    acquisition_type: 'gwp',
    original_price: 109.32,
    receipt_price: 0,
    purchase_price: 0,
  });
});

test('create preserves the parent theme and trimmed subtheme', async () => {
  const { fake, res } = await addSet('purchase', {
    theme: 'Collectible Minifigures',
    subtheme: ' Shrek ',
  });

  assert.equal(res.statusCode, 201);
  assert.equal(fake.inserts[0].theme, 'Collectible Minifigures');
  assert.equal(fake.inserts[0].subtheme, 'Shrek');
});

test('edit can explicitly clear the subtheme', async () => {
  const fake = createLegoFake();
  const controller = loadControllerWithFake('../../controllers/legoController', fake);
  const res = createMockResponse();

  await controller.updateSet({
    params: { id: 'set-id' },
    body: { subtheme: null },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(fake.updates[0], { subtheme: null });
});

test('changing status sends no changes to other set fields', async () => {
  const fake = createLegoFake();
  const controller = loadControllerWithFake('../../controllers/legoController', fake);
  const res = createMockResponse();

  await controller.updateSet({
    params: { id: 'set-id' },
    body: { status: 'Disassembled' },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(fake.updates[0], { status: 'Disassembled' });
});

const soldRecord = {
  id: '9fa904bf-b63f-43e0-a24e-dcd42d48bcb5',
  set_number: '42207', name: 'Synthetic test set', status: 'Sold',
  acquisition_type: 'purchase', transaction_id: 42, purchase_date: '2025-01-01',
  purchase_price: 574.60, receipt_price: 600, original_price: 650,
};
const returnInput = {
  action: 'return', status: 'New', acquisition_type: 'purchase',
  purchase_price: 500, receipt_price: null, original_price: null, purchase_date: null,
};
const updateWith = async (fake, body, id = soldRecord.id) => {
  const controller = loadControllerWithFake('../../controllers/legoController', fake);
  const res = createMockResponse();
  await controller.updateSet({ params: { id }, body }, res);
  return res;
};

test('sale persists only Sold status and GET retains all acquisition fields and the UUID', async () => {
  const initial = { ...soldRecord, status: 'Built' };
  const fake = createLegoFake(initial);
  const res = await updateWith(fake, { status: 'Sold' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(fake.updates, [{ status: 'Sold' }]);
  const read = createMockResponse();
  await loadControllerWithFake('../../controllers/legoController', fake).getAllSets({}, read);
  assert.deepEqual(read.body, [soldRecord]);
  assert.equal(fake.inserts.length, 0);
});

test('return updates the same UUID and clears acquisition fields and the old link in one write', async () => {
  const fake = createLegoFake(soldRecord);
  const res = await updateWith(fake, { ...returnInput, set_number: soldRecord.set_number });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body[0].id, soldRecord.id);
  assert.equal(fake.rows.length, 1);
  assert.equal(fake.inserts.length, 0);
  assert.deepEqual(fake.updates, [{
    set_number: '42207', status: 'New', acquisition_type: 'purchase',
    purchase_price: 500, receipt_price: null, original_price: null,
    purchase_date: null, transaction_id: null,
  }]);
  // Model the existing SQL deletion predicate, without contacting a database.
  const remainingAfterOldTransactionDeletion = fake.rows.filter((row) => row.transaction_id !== 42);
  assert.equal(remainingAfterOldTransactionDeletion[0].id, soldRecord.id);
  const duplicate = await updateWith(fake, { ...returnInput, purchase_price: 1 });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(fake.rows[0].purchase_price, 500);
  assert.equal(fake.updates.length, 1);
});

test('return replaces rather than merges previous receipt, price, date and physical condition', async () => {
  const fake = createLegoFake(soldRecord);
  const res = await updateWith(fake, {
    ...returnInput, status: 'Disassembled', receipt_price: 520, original_price: 550, purchase_date: '2026-10-26',
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(fake.rows[0], {
    ...soldRecord, status: 'Disassembled', purchase_price: 500, receipt_price: 520, original_price: 550,
    purchase_date: '2026-10-26', transaction_id: null,
  });
});

for (const previousType of ['gift', 'gwp']) {
  test(`returning a former ${previousType} as a purchase preserves the newly paid amount`, async () => {
    const fake = createLegoFake({ ...soldRecord, acquisition_type: previousType, purchase_price: 0 });
    const res = await updateWith(fake, returnInput);
    assert.equal(res.statusCode, 200);
    assert.equal(fake.rows[0].acquisition_type, 'purchase');
    assert.equal(fake.rows[0].purchase_price, 500);
  });
  test(`explicit ${previousType} return preserves the zero-cost rule`, async () => {
    const fake = createLegoFake(soldRecord);
    const res = await updateWith(fake, { ...returnInput, acquisition_type: previousType, receipt_price: 100 });
    assert.equal(res.statusCode, 200);
    assert.equal(fake.rows[0].purchase_price, 0);
    assert.equal(fake.rows[0].receipt_price, 0);
  });
}

test('ordinary edits cannot reactivate Sold or detach its old purchase link', async () => {
  const fake = createLegoFake(soldRecord);
  for (const status of ['New', 'Built', 'In Progress', 'Disassembled']) {
    const res = await updateWith(fake, { status });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'LEGO_RETURN_REQUIRED');
  }
  assert.equal((await updateWith(fake, { brand: 'Cobi' })).statusCode, 200);
  assert.equal(fake.rows[0].status, 'Sold');
  assert.equal(fake.rows[0].transaction_id, 42);
});

test('return refuses missing and non-Sold records', async () => {
  for (const status of ['Built', null, '']) {
    const fake = createLegoFake({ ...soldRecord, status });
    assert.equal((await updateWith(fake, returnInput)).statusCode, 409);
    assert.equal(fake.updates.length, 0);
  }
  assert.equal((await updateWith(createLegoFake(null), returnInput)).statusCode, 404);
});

test('invalid return inputs and client transaction links fail without touching the record', async () => {
  const bodies = [
    { ...returnInput, status: 'Sold' }, { ...returnInput, status: 'All' },
    { ...returnInput, status: null }, { ...returnInput, status: '' },
    { ...returnInput, acquisition_type: 'trade' }, { ...returnInput, acquisition_type: '' },
    { ...returnInput, action: 'restore' }, { ...returnInput, transaction_id: 99 },
    { ...returnInput, transaction_id: null }, { ...returnInput, set_number: '99999' },
    { ...returnInput, purchase_price: -1 }, { ...returnInput, purchase_price: 'NaN' },
    { ...returnInput, purchase_price: true }, { ...returnInput, purchase_price: [] },
    { ...returnInput, receipt_price: '' }, { ...returnInput, original_price: Infinity },
    { ...returnInput, purchase_date: '2026-02-30' }, { ...returnInput, purchase_date: 'invalid' },
    { status: 'Sold', purchase_price: 450 }, { status: 'Sold', acquisition_type: 'gift' },
    { status: 'Sold', sale_price: 450 },
    ...['acquisition_type', 'purchase_price', 'receipt_price', 'original_price', 'purchase_date'].map((omitted) =>
      Object.fromEntries(Object.entries(returnInput).filter(([field]) => field !== omitted))),
  ];
  for (const body of bodies) {
    const fake = createLegoFake(soldRecord);
    assert.equal((await updateWith(fake, body)).statusCode, 400, JSON.stringify(body));
    assert.deepEqual(fake.rows, [soldRecord]);
    assert.equal(fake.updates.length, 0);
  }
});

test('create cannot masquerade as return, start Sold, or set a transaction link', async () => {
  for (const input of [{ status: 'Sold' }, { action: 'return' }, { transaction_id: 42 }, { status: 'invalid' }]) {
    const { fake, res } = await addSet('purchase', input);
    assert.equal(res.statusCode, 400);
    assert.equal(fake.inserts.length, 0);
  }
});

test('conditional updates prevent raced reactivation and raced duplicate returns', async () => {
  const edit = createLegoFake({ ...soldRecord, status: 'Built' }, {
    beforeUpdate: (rows) => { rows[0].status = 'Sold'; },
  });
  assert.equal((await updateWith(edit, { status: 'New', purchase_price: 1 })).statusCode, 409);
  assert.equal(edit.rows[0].status, 'Sold');
  assert.equal(edit.rows[0].purchase_price, 574.60);
  const returned = createLegoFake(soldRecord, {
    beforeUpdate: (rows) => { Object.assign(rows[0], { status: 'Built', purchase_price: 900, transaction_id: null }); },
  });
  assert.equal((await updateWith(returned, returnInput)).statusCode, 409);
  assert.equal(returned.rows[0].purchase_price, 900);
});

test('read and update failures leave Sold and the original acquisition/link unchanged', async () => {
  for (const options of [{ failRead: { message: 'read failed' } }, { failUpdate: { message: 'write failed' } }]) {
    const fake = createLegoFake(soldRecord, options);
    assert.equal((await updateWith(fake, returnInput)).statusCode, 400);
    assert.deepEqual(fake.rows, [soldRecord]);
  }
});

test('legacy empty statuses remain editable and can be sold without changing acquisition data', async () => {
  for (const status of [null, '']) {
    const fake = createLegoFake({ ...soldRecord, status });
    assert.equal((await updateWith(fake, { brand: 'Cobi' })).statusCode, 200);
    assert.equal(fake.rows[0].status, status);
    assert.equal((await updateWith(fake, { status: 'Sold' })).statusCode, 200);
    assert.equal(fake.rows[0].transaction_id, 42);
    assert.equal(fake.rows[0].purchase_price, 574.60);
  }
});
