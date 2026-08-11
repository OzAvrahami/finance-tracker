const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(__dirname, '..', 'migrations', '005_lego_acquisition_method.sql');
const imageMigrationPath = path.join(__dirname, '..', 'migrations', '006_lego_set_image_url.sql');
const schemaPath = path.join(__dirname, '..', 'full_schema.sql');

test('migration promotes only the explicit historical transaction GWP pattern', () => {
  const migration = fs.readFileSync(migrationPath, 'utf8');
  assert.match(migration, /discount_type = 'percent'/);
  assert.match(migration, /discount_value = 100/);
  assert.match(migration, /final_price = 0/);
  assert.match(migration, /lego\.transaction_id = item\.transaction_id/);
  assert.ok(
    migration.indexOf('DROP CONSTRAINT IF EXISTS transaction_items_acquisition_type_check')
      < migration.indexOf("SET acquisition_type = 'gwp'"),
  );
  assert.doesNotMatch(migration, /purchase_price\s*=\s*0[^;]*SET acquisition_type/s);
});

test('schema exposes only purchase, gift, and gwp and no current-value column', () => {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const migration = fs.readFileSync(migrationPath, 'utf8');
  assert.match(schema, /acquisition_type\s+TEXT NOT NULL DEFAULT 'purchase'/);
  assert.match(schema, /CHECK \(acquisition_type IN \('purchase', 'gift', 'gwp'\)\)/);
  assert.doesNotMatch(schema, /market_value/);
  assert.match(migration, /DROP COLUMN IF EXISTS market_value/);
});

test('ambiguous legacy acquisition values stop the migration instead of being guessed', () => {
  const migration = fs.readFileSync(migrationPath, 'utf8');
  assert.match(migration, /Ambiguous legacy LEGO acquisition values require manual classification/);
  assert.doesNotMatch(migration, /SET acquisition_type = '(?:gift|gwp)'\s+WHERE acquisition_type IN \('trade', 'other'\)/);
});

test('schema and migration preserve the optional lookup image without rewriting historical rows', () => {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const migration = fs.readFileSync(imageMigrationPath, 'utf8');
  assert.match(schema, /image_url\s+TEXT/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS image_url TEXT/);
  assert.doesNotMatch(migration, /UPDATE\s+lego_sets/i);
});
