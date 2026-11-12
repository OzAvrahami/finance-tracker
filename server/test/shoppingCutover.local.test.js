'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { createIsolatedDatabase } = require('./helpers/shoppingIsolatedDatabase');
const { createFence, createRunner, guard } = require('./helpers/shoppingCutoverRehearsal');
const { approvedFixture } = require('../modules/shopping/list-types/fixtures/approvedTaxonomy');
const { createListCommands } = require('../modules/shopping/lists/listCommands');
const { removeFunctions, retainFunctions } = require('../modules/shopping/shared/migrationReadiness');
const quote = x => "'" + String(x).replaceAll("'", "''") + "'";
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const deferred = () => { let resolve;const promise = new Promise(r => { resolve = r; });return { promise, resolve }; };

// Public taxonomy only. IDs, names, purchase/receipt/cash evidence are synthetic.
function seed(env) {
  const f = approvedFixture();
  const ids = new Map(f.categories.map((c, i) => [String(c.id), c.is_neutral ? -1 : i === 0 ? 1 : 1000 + i]));
  const target = f.categories.map(c => ({ id: ids.get(String(c.id)), name: c.name,
    parent: c.parent_id === null ? null : ids.get(String(c.parent_id)), active: true }));
  for (let i = 2; i <= 26; i++) target.push({ id: i, name: `Synthetic history ${i}`, parent: null, active: false });
  const rows = f.products.map((p, i) => ({ id: i + 1, old: 1 + i % 26, target: ids.get(String(p.category_id)) }));
  const links = f.links.map(l => `(${ids.get(String(l.category_id))},${l.list_type_id})`);
  for (let i = 1; i <= 6; i++) links.push(`(-1,${i})`);
  env.sql(`INSERT INTO shopping_list_types(id,name,slug) SELECT i,'Synthetic type '||i,'synthetic-'||i FROM generate_series(1,6)i;
    INSERT INTO shopping_catalog_categories(id,name) VALUES ${target.filter(c => c.id >= 1 && c.id <= 26).map(c => `(${c.id},${quote(c.name)})`).join(',')};
    INSERT INTO shopping_catalog_items(id,name,category_id,default_price,default_unit) VALUES ${rows.map(r => `(${r.id},'Synthetic product ${r.id}',${r.old},0,'unit')`).join(',')};
    INSERT INTO shopping_lists(id,title,list_type_id) VALUES(1,'Synthetic retained list',1);
    INSERT INTO shopping_list_items(id,list_id,catalog_item_id,category_id,quantity,unit,price,is_purchased,purchased_at,notes)
    SELECT i,1,i,1,1.25,'unit',0,i<=50,CASE WHEN i<=50 THEN '2026-01-02 12:34:56.123456Z'::timestamptz END,'Synthetic retained note' FROM generate_series(1,85)i;
    INSERT INTO shopping_purchase_plans(list_id,items) VALUES(1,'[{"catalog_item_id":1,"category_id":1,"price":0}]');
    INSERT INTO shopping_receipts(list_id,image_hash,image_hashes,state,extracted,review_draft) VALUES(1,repeat('a',64),ARRAY[repeat('a',64)],'review','{"identity":{"merchant":"Synthetic"}}','{"items":[]}');
    INSERT INTO transactions(description,total_amount,movement_type,transaction_date,charge_date) VALUES('Synthetic retained financial identity',12.34,'expense','2026-01-01','2026-01-01');
    SELECT setval(pg_get_serial_sequence('shopping_lists','id'),1);
    GRANT USAGE ON SCHEMA public TO service_role,anon,authenticated;
    GRANT SELECT,INSERT,UPDATE,DELETE ON shopping_lists TO service_role;
    GRANT USAGE,SELECT ON SEQUENCE shopping_lists_id_seq TO service_role;`);
  return `CREATE TEMP TABLE shopping_mapping_categories(id bigint PRIMARY KEY,name text,parent_id bigint,is_active boolean);
    CREATE TEMP TABLE shopping_mapping_products(id bigint PRIMARY KEY,category_id bigint);
    CREATE TEMP TABLE shopping_mapping_links(category_id bigint,list_type_id bigint,PRIMARY KEY(category_id,list_type_id));
    INSERT INTO shopping_mapping_categories VALUES ${target.map(c => `(${c.id},${quote(c.name)},${c.parent ?? 'NULL'},${c.active})`).join(',')};
    INSERT INTO shopping_mapping_products VALUES ${rows.map(r => `(${r.id},${r.target})`).join(',')};
    INSERT INTO shopping_mapping_links VALUES ${links.join(',')};`;
}

function snapshot(env, database = 'postgres') {
  return env.sql(`SELECT jsonb_build_object(
    'rows',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM shopping_list_items t),
    'plans',(SELECT jsonb_agg(to_jsonb(t) ORDER BY list_id) FROM shopping_purchase_plans t),
    'receipts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM shopping_receipts t),
    'confirmed',(SELECT jsonb_agg(to_jsonb(t) ORDER BY list_id) FROM shopping_confirmed_purchases t),
    'checkout',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM shopping_checkouts t),
    'cash',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM transactions t));`, false, database).stdout.trim();
}

test('outer migration guard rejects missing/foreign identities and an unfenced runner', () => {
  let touched = false;
  assert.throws(() => guard({ identity: 'hosted', guard() { touched = true; } }));
  assert.equal(touched, false);
  const fence = createFence();assert.throws(() => createRunner({}, fence).apply(0));
  for (const identity of ['', 'foreign']) assert.throws(() => guard({ identity: 'shopping102-' + randomUUID(), guard() {}, sql() { return { stdout: identity }; } }));
});

test('local fence drains an admitted HTTP writer, migrates 060-063, rejects old writes and activates JS persistence', async () => {
  const env = await createIsolatedDatabase();let server;
  try {
    const sql = text => env.sql(text).stdout.trim();
    sql(read('full_schema.sql'));
    const baseline = fs.readFileSync(process.env.SHOPPING_059_BASELINE, 'utf8');
    assert.equal(createHash('sha256').update(baseline).digest('hex'), '600d47c9eafd0bc069a7aecef2f83f58632c5035dcb885e738967cb94b1bc257');
    sql(baseline);const mapping = seed(env), fence = createFence(), runner = createRunner(env, fence);
    const admitted = deferred(), release = deferred();let commands;
    const actor = randomUUID();const app = express();app.use(fence.middleware);
    // This gateway models maintenance routing/drain only. Real authentication,
    // complete existing routes and browser persistence are tested in HTTP suites.
    app.post('/old', async (req, res) => {
      if (fence.phase === 'replacement') return res.status(410).end();
      admitted.resolve();await release.promise;
      sql("SET ROLE service_role; INSERT INTO shopping_lists(title,list_type_id) VALUES('Synthetic admitted write',1);");res.status(201).end();
    });
    app.post('/new', async (req, res) => {
      if (fence.phase !== 'replacement') return res.status(503).end();
      try {
        const r = await commands.execute({ user: { id: actor }, headers: { 'Idempotency-Key': req.headers['idempotency-key'] }, body: { title: 'Synthetic replacement write', list_type_id: 1 } }, 'list.create');
        res.status(r.http.status).set(r.http.headers).json(r.result);
      } catch (e) { res.status(500).json({ error: e.code || e.message }); }
    });
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const old = fetch(origin + '/old', { method: 'POST' });await admitted.promise;
    const draining = fence.drain();assert.equal(fence.active, 1);
    assert.equal((await fetch(origin + '/old', { method: 'POST' })).status, 503);
    assert.throws(() => runner.apply(0, mapping));release.resolve();assert.equal((await old).status, 201);await draining;
    assert.equal(sql("SELECT count(*) FROM shopping_lists WHERE title='Synthetic admitted write'"), '1');
    const before = snapshot(env), backup = env.backup();
    assert(backup.length > 10000);const backupSha = createHash('sha256').update(backup).digest('hex');
    // Verified restoration BEFORE schema changes. No hosted snapshot is used.
    sql('CREATE DATABASE restore_test;');env.sql(backup, false, 'restore_test');assert.equal(snapshot(env, 'restore_test'), before);
    runner.apply(0, mapping);assert.throws(() => runner.apply(2));assert.throws(() => runner.activate());
    for (let i = 1; i <= 3; i++) runner.apply(i);
    assert.equal(snapshot(env), before);
    assert.deepEqual(JSON.parse(sql(`SELECT jsonb_build_array((SELECT count(*) FROM shopping_catalog_categories),
      (SELECT count(*) FROM shopping_catalog_categories WHERE is_active),(SELECT count(*) FROM shopping_catalog_categories WHERE NOT is_active),
      (SELECT count(*) FROM shopping_catalog_items),(SELECT count(*) FROM shopping_catalog_category_list_types),(SELECT count(*) FROM shopping_list_items));`)), [99, 74, 25, 173, 21, 85]);
    for (const name of removeFunctions) assert.equal(sql(`SELECT to_regprocedure(${quote(name)}) IS NULL;`), 't');
    for (const name of retainFunctions) assert.equal(sql(`SELECT to_regprocedure(${quote(name)}) IS NOT NULL;`), 't');
    assert.notEqual(env.sql("SET ROLE service_role; INSERT INTO shopping_lists(title) VALUES('forbidden');", true).status, 0);
    assert.notEqual(env.sql('SET ROLE authenticated; UPDATE shopping_list_items SET price=99 WHERE id=1;', true).status, 0);
    const endpoint = await env.startApi();
    const client = createClient(endpoint, env.token('service_role'), { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => {
      const u = new URL(typeof input === 'string' ? input : input.url);assert.equal(u.origin, endpoint);
      assert(u.pathname.startsWith('/rest/v1/'));return fetch(endpoint + u.pathname.slice(8) + u.search, { ...init, redirect: 'error' });
    } } });
    commands = createListCommands({ supabase: client, authorize: ({ actor: who }) => who === actor });
    await commands.read({ user: { id: actor } }); // Schema cache + new runtime readiness before admission.
    runner.activate();assert.equal((await fetch(origin + '/old', { method: 'POST' })).status, 410);
    const key = randomUUID(), post = () => fetch(origin + '/new', { method: 'POST', headers: { 'Idempotency-Key': key } });
    const first = await post();assert.equal(first.status, 201);const body = await first.json();
    const replay = await post();assert.equal(replay.status, 201);assert.equal(replay.headers.get('etag'), first.headers.get('etag'));assert.deepEqual(await replay.json(), body);
    assert.equal(sql("SELECT count(*) FROM shopping_lists WHERE title='Synthetic replacement write'"), '1');assert.equal(snapshot(env), before);
    // Restored old schema still supports the old writer; never pair it with new runtime.
    env.sql("SET ROLE service_role; INSERT INTO shopping_lists(title,list_type_id) VALUES('Synthetic restored legacy',1);", false, 'restore_test');
    assert.equal(snapshot(env, 'restore_test'), before);
    console.log(JSON.stringify({ identity: env.identity, origin, backupSha, journal: runner.journal, preserved: '85 items, purchase states, plans, receipt and financial identity', production: false }));
  } finally { if (server) await new Promise(r => server.close(r));await env.close(); }
});

test('failure between immutable migration transactions remains fenced and a pre-cutover backup restores old compatibility', async () => {
  const env = await createIsolatedDatabase();
  try {
    const sql = text => env.sql(text).stdout.trim();sql(read('full_schema.sql'));
    const mapping = seed(env), before = snapshot(env), backup = env.backup(), fence = createFence();await fence.drain();
    const runner = createRunner(env, fence);runner.apply(0, mapping);
    // An event trigger injects a DDL failure; migration bytes are never edited.
    sql("CREATE FUNCTION public.synthetic_fail_ddl() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic cutover fault'; END $$; CREATE EVENT TRIGGER synthetic_failure ON ddl_command_start EXECUTE FUNCTION public.synthetic_fail_ddl();");
    assert.throws(() => runner.apply(1), /synthetic cutover fault/);
    assert.equal(runner.journal.length, 1);assert.equal(fence.phase, 'fenced');assert.throws(() => runner.activate());
    assert.equal(sql("SELECT to_regnamespace('shopping_private') IS NOT NULL;"), 't');assert.equal(snapshot(env), before);
    sql('CREATE DATABASE restore_test;');env.sql(backup, false, 'restore_test');
    assert.equal(snapshot(env, 'restore_test'), before);
    assert.equal(env.sql("SELECT to_regprocedure('shopping_checkout(bigint,bigint,bigint,jsonb)') IS NOT NULL;", false, 'restore_test').stdout.trim(), 't');
    env.sql("SET ROLE service_role; INSERT INTO shopping_lists(title,list_type_id) VALUES('Synthetic recovery writer',1);", false, 'restore_test');
    assert.equal(snapshot(env, 'restore_test'), before);
  } finally { await env.close(); }
});

test('drain timeout fails closed and cannot activate with an outstanding operation', async () => {
  const fence = createFence();const { EventEmitter } = require('node:events');const res = new EventEmitter();
  fence.middleware({ method: 'POST' }, res, () => {});
  await assert.rejects(fence.drain(10), /timed out/);assert.equal(fence.phase, 'fenced');assert.throws(() => fence.activate());
  res.emit('finish');await fence.drain();assert.equal(fence.active, 0);
});
