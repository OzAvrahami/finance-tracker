'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');
const { createRepository, catalogView } = require('./repository');
const { createPersistence, prepareCatalogCommand, catalogProtocol } = require('./persistence');
const { createCatalogCommands } = require('./catalogCommands');
const { parseHeaders } = require('./httpContracts');
const { httpError } = require('./persistenceErrors');

const actor = '11111111-1111-4111-8111-111111111111';
const key = '22222222-2222-4222-8222-222222222222';
const key2 = '33333333-3333-4333-8333-333333333333';
const request = (body, headers = { 'If-Match': '"catalog-1"', 'Idempotency-Key': key }) => ({ user: { id: actor }, body, headers });
const category = (id, name, parent_id = null, is_active = true) => ({ id, name, parent_id, is_active, revision: '1' });
const product = (id, name, category_id = 1) => ({ id, name, category_id, is_active: true, revision: '1', default_unit: null, default_price: null });
function facts() {
  return { categories: [{ ...category(-9, 'System'), is_neutral: true }, category(1, 'Root'), category(2, 'Leaf', 1), category(3, 'Historical', null, false)],
    products: [product(1, 'One'), product(2, 'Two', 2), product(3, 'Historical product', 3)],
    listTypes: [{ id: 1, is_active: true, revision: '1' }], links: [{ category_id: 1, list_type_id: 1 }] };
}

// Synthetic contract model, NOT PostgreSQL lock/transaction evidence. It models
// a fixed C-X critical section, durable replay and rollback to test the JS side.
function fakeDatabase(initial = facts()) {
  let data = structuredClone(initial), revision = 1, queue = Promise.resolve();
  const commands = new Map(), calls = [], effects = [];
  const db = {
    calls, effects, failAt: null, transportAfterCommit: false,
    get data() { return structuredClone(data); },
    async rpc(name, args) {
      calls.push({ name, args: structuredClone(args) });
      if (name === 'shopping_state') {
        const { operation, actor, request_key } = args.p_ids;
        return { data: { version: 1, scope: 'catalog', operation, complete: true,
          expected: { token: `state-${revision}`, catalog_revision: String(revision) }, etag: `"catalog-${revision}"`,
          ...structuredClone(data), counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
          command: structuredClone(commands.get(`${actor}:${request_key}`) ?? null) }, error: null };
      }
      assert.equal(name, 'shopping_catalog_commit');
      const previous = queue; let unlock; queue = new Promise(resolve => { unlock = resolve; }); await previous;
      try {
        const durableKey = args.p_key === null ? null : `${args.p_actor}:${args.p_key}`;
        const old = durableKey && commands.get(durableKey);
        if (old) return isDeepStrictEqual(old.intent, args.p_intent)
          ? { data: { committed: true, replayed: true, result: old.result, catalog_revision: old.catalog_revision } }
          : { error: { code: 'P0001', message: 'shopping_key_conflict' } };
        if (args.p_expected.catalog_revision !== String(revision) || args.p_expected.token !== `state-${revision}`)
          return { error: { code: 'P0001', message: 'shopping_revision_stale' } };
        const next = structuredClone(data), d = args.p_decision;
        const updates = d.kind === 'product.bulk-category' ? d.updates : [d];
        for (let index = 0; index < updates.length; index++) {
          if (db.failAt === index) return { error: { code: '23514', message: 'synthetic failure' } };
          const update = updates[index];
          if (d.kind === 'product.bulk-category' || d.kind === 'product.update') Object.assign(next.products.find(p => String(p.id) === update.id), update.changes);
          else if (d.kind === 'product.create') next.products.push({ ...d.values, id: Math.max(0, ...next.products.map(p => Number(p.id))) + 1, revision: '1' });
          else if (d.kind === 'category.update') Object.assign(next.categories.find(c => String(c.id) === d.id), d.changes);
          else if (d.kind === 'category.create') next.categories.push({ ...d.values, id: 1000, revision: '1' });
          else if (d.kind === 'branches.replace') next.links = d.category_ids.map(category_id => ({ category_id, list_type_id: d.id }));
          else assert.fail('unsupported effect');
        }
        const result = d.kind === 'product.bulk-category' ? { updated: updates.length, product_ids: updates.map(u => u.id) } : { saved: true };
        revision++; data = next; effects.push(structuredClone(d));
        if (durableKey) commands.set(durableKey, { actor: args.p_actor, key: args.p_key, intent: structuredClone(args.p_intent), result, catalog_revision: String(revision) });
        if (db.transportAfterCommit) { db.transportAfterCommit = false; throw Error('connection lost after commit'); }
        return { data: { committed: true, replayed: false, result, catalog_revision: String(revision) } };
      } finally { unlock(); }
    },
  };
  return db;
}
const service = (db, authorize = async () => true) => createCatalogCommands({ repository: createRepository(db), persistence: createPersistence(db), authorize });
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);

test('raw snapshot uses one fixed Supabase RPC and Gate 3A supplies ancestry, paths and visibility', async () => {
  const db = fakeDatabase(); const view = await service(db).read(request({}));
  assert.equal(db.calls.length, 1); assert.equal(db.calls[0].name, 'shopping_state');
  assert.equal(db.calls[0].args.p_scope, 'catalog');
  assert.deepEqual(view.tree.ancestorIds(2), ['1']);
  assert.deepEqual(view.tree.path(2).map(n => n.name), ['Root', 'Leaf']);
  assert.deepEqual(view.visibility.forListType(1).product_ids, ['1', '2']);
  assert.equal(view.categories().length, 3); assert.equal(view.categories({ includeInactive: true }).length, 4);
  assert.equal(view.product(3).name, 'Historical product');
  assert.equal(view.products().length, 2); assert.equal(view.products({ includeInactive: true }).length, 3);
  assert.equal(view.listTypes().length, 1); assert.equal(view.branches().length, 1);
});

test('raw reads preserve exact decimal text and zero rather than calculating or defaulting it', async () => {
  const f = facts(); f.products[0].default_price = '0.0000';
  const view = await service(fakeDatabase(f)).read(request({}));
  assert.equal(view.product(1).default_price, '0.0000'); assert.ok(Object.isFrozen(view.product(1)));
});

for (const mutate of [s => { s.complete = false; }, s => { s.counts.products++; }, s => { delete s.expected.token; },
  s => { s.categories[0].revision = 2; }, s => { s.operation = 'wrong'; }]) {
  test('rejects incomplete or malformed authoritative snapshot', async () => {
    const db = fakeDatabase(), rpc = db.rpc.bind(db); db.rpc = async (...args) => { const r = await rpc(...args); mutate(r.data); return r; };
    await rejects(service(db).read(request({})), 'shopping_snapshot_invalid'); assert.equal(db.effects.length, 0);
  });
}

test('header syntax accepts casing and rejects weak, wildcard, list, duplicate and non-string inputs', () => {
  assert.deepEqual(parseHeaders({ 'IF-MATCH': '"x"', 'IDEMPOTENCY-KEY': key.toUpperCase() }), { ifMatch: '"x"', key });
  for (const value of ['*', 'W/"x"', '"a", "b"', 'x', '""', '"x\n"', ['"x"']]) assert.throws(() => parseHeaders({ 'if-match': value }));
  assert.throws(() => parseHeaders({ 'If-Match': '"x"', 'if-match': '"x"' }));
  assert.throws(() => parseHeaders({ 'Idempotency-Key': 'not-a-uuid' }));
});

test('authorization is mandatory before reads or replay and body cannot supply actor/effects', async () => {
  const db = fakeDatabase(), s = service(db);
  await rejects(s.execute({ body: {} }, 'product.deactivate', 1), 'shopping_unauthenticated');
  await rejects(service(db, async () => false).read(request({})), 'shopping_forbidden');
  await rejects(s.execute(request({ actor, changes: { is_active: false } }), 'product.deactivate', 1), 'shopping_input_invalid');
  assert.equal(db.calls.length, 0);
  assert.throws(() => createCatalogCommands({ repository: {}, persistence: {} }), /shopping_authorizer_required/);
});

test('missing required E/K and stale revisions cause no commit', async () => {
  const db = fakeDatabase(), s = service(db);
  await rejects(s.execute(request({}, { 'Idempotency-Key': key }), 'product.deactivate', 1), 'shopping_precondition_required');
  await rejects(s.execute(request({}, { 'If-Match': '"catalog-1"' }), 'product.deactivate', 1), 'shopping_idempotency_required');
  await rejects(s.execute(request({}, { 'If-Match': '"stale"', 'Idempotency-Key': key }), 'product.deactivate', 1), 'shopping_revision_stale');
  assert.ok(db.calls.every(c => c.name === 'shopping_state')); assert.equal(db.effects.length, 0);
});

test('legacy category create permits missing headers but requires explicit parent context', async () => {
  const db = fakeDatabase(), s = service(db);
  await rejects(s.execute(request({ name: 'New' }, {}), 'category.create'), 'shopping_category_parent_required');
  await s.execute(request({ name: 'New', parent_id: null }, {}), 'category.create');
  assert.equal(db.effects.length, 1); assert.equal(db.calls.at(-1).args.p_key, null);
});

test('durable replay precedes missing/stale edit preconditions; changed original intent conflicts', async () => {
  const db = fakeDatabase(), s = service(db); const first = await s.execute(request({ default_price: 0 }), 'product.edit', 1);
  const replay = await s.execute(request({ default_price: 0 }, { 'Idempotency-Key': key }), 'product.edit', 1);
  assert.equal(replay.replayed, true); assert.deepEqual(replay.result, first.result); assert.equal(replay.catalog_revision, first.catalog_revision);
  await rejects(s.execute(request({ default_price: null }), 'product.edit', 1), 'shopping_key_conflict');
  assert.equal(db.effects.length, 1); assert.equal(db.data.products[0].default_price, '0');
});

test('malformed headers fail even on replay; replay remains authenticated/authorized', async () => {
  const db = fakeDatabase(), s = service(db); await s.execute(request({}), 'product.deactivate', 1);
  await rejects(s.execute(request({}, { 'Idempotency-Key': key, 'If-Match': '*' }), 'product.deactivate', 1), 'shopping_if_match_invalid');
  await rejects(service(db, async () => false).execute(request({}), 'product.deactivate', 1), 'shopping_forbidden');
  assert.equal(db.effects.length, 1);
});

test('concurrent identical keyed requests produce one effect in the transaction contract model', async () => {
  const db = fakeDatabase(), s = service(db);
  const results = await Promise.all([s.execute(request({}), 'product.deactivate', 1), s.execute(request({}), 'product.deactivate', 1)]);
  assert.equal(db.effects.length, 1); assert.equal(results.filter(r => r.replayed).length, 1);
});

test('concurrent different edits use C-X expected-state rejection, never automatic overwrite', async () => {
  const db = fakeDatabase(), s = service(db);
  const results = await Promise.allSettled([s.execute(request({ name: 'A' }), 'product.edit', 1),
    s.execute(request({ name: 'B' }, { 'If-Match': '"catalog-1"', 'Idempotency-Key': key2 }), 'product.edit', 2)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'shopping_revision_stale'); assert.equal(db.effects.length, 1);
});

test('opposing reparent commands cannot both commit against one graph revision in the model', async () => {
  const f = facts(); f.categories[2].parent_id = null; const db = fakeDatabase(f), s = service(db);
  const results = await Promise.allSettled([s.execute(request({ type: 'reparent', parent_id: 2 }), 'category.change', 1),
    s.execute(request({ type: 'reparent', parent_id: 1 }, { 'If-Match': '"catalog-1"', 'Idempotency-Key': key2 }), 'category.change', 2)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(db.effects.length, 1);
});

test('unknown commit retains original key/intent; retry returns durable result without new effect', async () => {
  const db = fakeDatabase(), s = service(db); db.transportAfterCommit = true;
  await rejects(s.execute(request({}), 'product.deactivate', 1), 'shopping_commit_unknown');
  assert.equal(db.effects.length, 1);
  assert.equal((await s.execute(request({}), 'product.deactivate', 1)).replayed, true); assert.equal(db.effects.length, 1);
});

test('bulk 100 is atomic and sorted; member failure rolls back model rows, revision and command result', async () => {
  const f = facts(); f.products = Array.from({ length: 100 }, (_, i) => product(i + 1, `Synthetic ${i}`));
  const db = fakeDatabase(f), s = service(db), body = { product_ids: f.products.map(p => p.id).reverse(), category_id: 2 };
  db.failAt = 75; await rejects(s.execute(request(body), 'product.bulk-category'), 'shopping_reference_conflict');
  assert.deepEqual(db.data, f); assert.equal(db.effects.length, 0);
  db.failAt = null; const result = await s.execute(request(body), 'product.bulk-category');
  assert.equal(result.result.updated, 100); assert.equal(result.result.product_ids[0], '1'); assert.equal(result.result.product_ids[99], '100');
  assert.ok(db.data.products.every(p => p.category_id === '2'));
});

for (const ids of [[], Array.from({ length: 101 }, (_, i) => i + 1), [1, '1']]) {
  test('invalid bulk cardinality or duplicate IDs makes no persistence request', async () => {
    const db = fakeDatabase(); await assert.rejects(service(db).execute(request({ product_ids: ids, category_id: 2 }), 'product.bulk-category'));
    assert.equal(db.calls.length, 0);
  });
}

test('missing/inactive targets, missing products and final target collisions reject whole bulk', async () => {
  const db = fakeDatabase(), s = service(db);
  for (const [body, code] of [[{ product_ids: [1, 9], category_id: 2 }, 'shopping_product_missing'],
    [{ product_ids: [1], category_id: 99 }, 'shopping_category_missing'], [{ product_ids: [1], category_id: 3 }, 'shopping_category_unavailable']])
    await rejects(s.execute(request(body), 'product.bulk-category'), code);
  const f = facts(); f.products[1].name = f.products[0].name;
  await rejects(service(fakeDatabase(f)).execute(request({ product_ids: [1, 2], category_id: 1 }), 'product.bulk-category'), 'shopping_product_collision');
  assert.equal(db.effects.length, 0);
});

test('neutral protection, historical reads and deletion-as-deactivation survive persistence integration', async () => {
  const db = fakeDatabase(), s = service(db);
  await rejects(s.execute(request({ type: 'delete' }), 'category.change', -9), 'shopping_neutral_protected');
  await rejects(s.execute(request({ type: 'reparent', parent_id: 2 }), 'category.change', 1), 'shopping_category_cycle');
  await s.execute(request({ type: 'delete' }), 'category.change', 1);
  assert.equal(db.data.categories.length, 4); assert.equal(db.data.categories.find(c => c.id === 1).is_active, false);
  assert.equal(db.data.categories.find(c => c.id === 2).is_active, true); assert.equal(db.data.products[0].category_id, 1);
});

test('branch replacement preserves neutral and deduplicates arbitrary roots with Gate 3A', async () => {
  const db = fakeDatabase(); await service(db).execute(request({ categoryIds: [1, 2, 1] }), 'branches.replace', 1);
  assert.deepEqual(db.effects[0].category_ids, ['1', '2', '-9']);
});

test('product create/edit preserve zero, null, omission, exact text and identity fields', async () => {
  const db = fakeDatabase(), s = service(db);
  await s.execute(request({ name: 'Created', category_id: 2, default_price: '0.000' }, { 'Idempotency-Key': key }), 'product.create');
  assert.equal(db.data.products.at(-1).default_price, '0.000');
  const second = fakeDatabase(); await service(second).execute(request({ default_price: null }), 'product.edit', 1);
  assert.equal(second.data.products[0].default_price, null); assert.equal(second.data.products[0].name, 'One');
  assert.equal(second.data.products[0].id, 1);
});

for (const [dbCode, domain, status] of [['23505', 'shopping_uniqueness_conflict', 409], ['42501', 'shopping_forbidden', 403],
  ['40001', 'shopping_busy', 503], ['40P01', 'shopping_busy', 503], ['55P03', 'shopping_busy', 503], ['57014', 'shopping_busy', 503]]) {
  test(`repository translates ${dbCode} without leaking SQL/row details`, async () => {
    const db = { rpc: async () => ({ error: { code: dbCode, message: 'private details' } }) };
    await assert.rejects(service(db).read(request({})), e => {
      assert.deepEqual(httpError(e), { status, body: { error: domain, code: domain } }); return true;
    });
  });
}

test('no generic write plan, REST fallback, invalid success or process-local lock is accepted', async () => {
  const db = fakeDatabase(); await rejects(createPersistence(db).commitCatalog({ p_decision: {} }), 'shopping_untrusted_plan');
  assert.equal(db.calls.length, 0);
  const rpc = db.rpc.bind(db); db.rpc = async (name, args) => name === 'shopping_catalog_commit' ? { data: { partial: true } } : rpc(name, args);
  await rejects(service(db).execute(request({}), 'product.deactivate', 1), 'shopping_commit_result_invalid');
  assert.equal(catalogProtocol.catalogLock, 'FOR UPDATE'); assert.deepEqual(catalogProtocol.order, ['K(actor,key)', 'C-X', 'entity rows(table,primary key)']);
});

test('fixed persistence effects reject extra columns and mismatched operation/identity', () => {
  const command = { actor, key, intent: { operation: 'product.edit', id: '1', body: { name: 'X' } },
    expected: { token: 'state-1', catalog_revision: '1' }, decision: { kind: 'product.update', id: '1', revision: '1', changes: { name: 'X' } } };
  assert.doesNotThrow(() => prepareCatalogCommand(command));
  assert.throws(() => prepareCatalogCommand({ ...command, decision: { ...command.decision, changes: { transaction_amount: '999' } } }), /shopping_effect_invalid/);
  assert.throws(() => prepareCatalogCommand({ ...command, decision: { ...command.decision, id: '2' } }), /shopping_effect_invalid/);
  assert.throws(() => prepareCatalogCommand({ ...command, intent: { ...command.intent, operation: 'checkout' } }), /shopping_effect_invalid/);
});

test('bulk response cannot claim a partial success', async () => {
  const db = fakeDatabase(), rpc = db.rpc.bind(db);
  db.rpc = async (name, args) => name === 'shopping_catalog_commit'
    ? { data: { committed: true, replayed: false, catalog_revision: '2', result: { updated: 1, product_ids: ['1'] } } }
    : rpc(name, args);
  await rejects(service(db).execute(request({ product_ids: [1, 2], category_id: 1 }), 'product.bulk-category'), 'shopping_commit_result_invalid');
});

test('bad raw category/product references are upstream failures, not client input failures', async () => {
  const f = facts(); f.products[0].category_id = 999;
  await rejects(service(fakeDatabase(f)).read(request({})), 'shopping_snapshot_invalid');
});

test('bulk durable replay validates the complete recorded result without another write', async () => {
  const db = fakeDatabase(), s = service(db), body = { product_ids: [2, 1], category_id: 1 };
  await s.execute(request(body), 'product.bulk-category');
  assert.equal((await s.execute(request(body), 'product.bulk-category')).replayed, true);
  const rpc = db.rpc.bind(db);
  db.rpc = async (...args) => {
    const response = await rpc(...args);
    if (response.data?.command) response.data.command.result = { updated: 1, product_ids: ['1'] };
    return response;
  };
  await rejects(s.execute(request(body), 'product.bulk-category'), 'shopping_commit_result_invalid');
  assert.equal(db.effects.length, 1);
});

test('distinct deliberate keys do not reuse another command result', async () => {
  const db = fakeDatabase(), s = service(db);
  await s.execute(request({ name: 'First', category_id: 1 }, { 'Idempotency-Key': key }), 'product.create');
  await s.execute(request({ name: 'Second', category_id: 1 }, { 'Idempotency-Key': key2 }), 'product.create');
  assert.equal(db.effects.length, 2);
  assert.equal((await s.read(request({}))).products({ includeInactive: true }).length, 5);
});
