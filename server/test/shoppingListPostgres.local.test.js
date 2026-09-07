// Explicit isolated PostgreSQL check; never reads application .env or credentials.
// Run from repository root: node --test server/test/shoppingListPostgres.local.test.js
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const container = `finance-shopping-029-${process.pid}`;
let created = false;
const read = (file) => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
const schema = read('server/full_schema.sql');
const migration = read('server/migrations/029_shopping_list_optional_fields.sql');
const preflight = read('docs/MIGRATION_029_PREFLIGHT.sql');
const postflight = read('docs/MIGRATION_029_POSTFLIGHT.sql');
const tables = ['shopping_list_types', 'shopping_catalog_categories', 'shopping_catalog_items', 'shopping_lists', 'shopping_list_items', 'shopping_checkouts'];
const definitions = tables.map((name) => {
  const match = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\([\\s\\S]*?\\n\\);`));
  assert.ok(match, `Missing canonical definition: ${name}`);
  return match[0];
}).join('\n');
const legacy = definitions.replace(/^\s+(?:store|link|target_date)\s+(?:TEXT|DATE),\r?\n/gm, '');
const docker = (args, input, allowFailure = false) => {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60000 });
  if (!allowFailure) assert.equal(result.status, 0, result.error?.message || result.stderr);
  return result;
};
const sql = (input, allowFailure = false, database = 'postgres') => docker([
  'exec', '-i', container, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At',
], input, allowFailure);

before(async () => {
  docker(['run', '--detach', '--rm', '--name', container, '-e', 'POSTGRES_PASSWORD=shopping_test_only', 'postgres:16-alpine']);
  created = true;
  for (let i = 0; i < 30; i += 1) {
    if (docker(['exec', container, 'pg_isready', '-U', 'postgres'], undefined, true).status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Disposable PostgreSQL did not become ready');
});
after(() => { if (created) docker(['rm', '--force', container]); });

test('029 preserves legacy rows/items/checkout and verifies nullable header columns with consolidated scripts', () => {
  sql(`${legacy}
    INSERT INTO shopping_list_types(id,name,slug) VALUES(1,'סופר','super');
    INSERT INTO shopping_catalog_categories(id,name) VALUES(1,'מזון');
    INSERT INTO shopping_lists(id,title,list_type_id,status) VALUES(1,'רשימה קיימת',1,'active'),(2,'היסטוריה',1,'checked_out');
    INSERT INTO shopping_list_items(id,list_id,custom_name,category_id,quantity,price,is_purchased) VALUES(1,1,'לחם',1,2,10,true);
    INSERT INTO shopping_checkouts(id,list_id,total_amount) VALUES(1,2,20);
  `);
  const before = JSON.parse(sql(preflight).stdout.trim());
  assert.equal(before.result, 'MIGRATION_029_PREFLIGHT_PASS');
  const untouched = sql('SELECT jsonb_agg(to_jsonb(i)) FROM shopping_list_items i; SELECT jsonb_agg(to_jsonb(c)) FROM shopping_checkouts c;').stdout;
  sql(migration);
  const after = JSON.parse(sql(postflight).stdout.trim());
  assert.equal(after.result, 'MIGRATION_029_POSTFLIGHT_PASS');
  for (const key of ['list_count', 'item_count', 'checkout_count', 'header_fingerprint']) assert.equal(after[key], before[key]);
  assert.equal(sql('SELECT jsonb_agg(to_jsonb(i)) FROM shopping_list_items i; SELECT jsonb_agg(to_jsonb(c)) FROM shopping_checkouts c;').stdout, untouched);
  assert.equal(sql('SELECT count(*) FROM shopping_lists WHERE store IS NULL AND link IS NULL AND target_date IS NULL;').stdout.trim(), '2');
  assert.equal(JSON.parse(sql(preflight).stdout.trim()).result, 'MIGRATION_029_PREFLIGHT_STOP');
});

test('029 permits old inserts, preserves omitted fields, stores leap dates, clears values and rejects impossible dates', () => {
  sql("INSERT INTO shopping_lists(id,title,list_type_id) VALUES(3,'ישן',1);");
  assert.equal(sql('SELECT store IS NULL AND link IS NULL AND target_date IS NULL FROM shopping_lists WHERE id=3;').stdout.trim(), 't');
  sql("UPDATE shopping_lists SET store='חנות', link='https://example.com/a?x=1&y=2', target_date='2028-02-29' WHERE id=3;");
  sql("UPDATE shopping_lists SET title='חדש' WHERE id=3;");
  const row = JSON.parse(sql('SELECT to_jsonb(s) FROM shopping_lists s WHERE id=3;').stdout.trim());
  assert.equal(row.store, 'חנות'); assert.equal(row.target_date, '2028-02-29');
  assert.equal(row.link, 'https://example.com/a?x=1&y=2');
  assert.notEqual(sql("UPDATE shopping_lists SET target_date='2026-02-29' WHERE id=3;", true).status, 0);
  assert.equal(sql('SELECT target_date FROM shopping_lists WHERE id=3;').stdout.trim(), '2028-02-29');
  sql('UPDATE shopping_lists SET store=NULL, link=NULL, target_date=NULL WHERE id=3;');
  assert.equal(sql('SELECT store IS NULL AND link IS NULL AND target_date IS NULL FROM shopping_lists WHERE id=3;').stdout.trim(), 't');
});

test('full_schema shopping definitions have the same final column types/nullability/defaults as 029', () => {
  sql('CREATE DATABASE shopping_fresh;');
  sql(definitions, false, 'shopping_fresh');
  const query = "SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='shopping_lists' ORDER BY column_name;";
  assert.equal(sql(query).stdout, sql(query, false, 'shopping_fresh').stdout);
});
