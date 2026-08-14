const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(
  __dirname, '..', 'migrations', '013_loan_indexation.sql',
), 'utf8');
const schema = fs.readFileSync(path.join(__dirname, '..', 'full_schema.sql'), 'utf8');

test('migration 013 and canonical schema define independent optional CPI metadata', () => {
  for (const sql of [migration, schema]) {
    assert.match(sql, /indexation_type\s+TEXT NOT NULL DEFAULT 'none'/);
    assert.match(sql, /indexation_type IN \('none', 'cpi'\)/);
    assert.match(sql, /base_index\s+NUMERIC\(18,4\)/);
    assert.match(sql, /base_index IS NULL OR base_index > 0/);
  }

  assert.doesNotMatch(migration, /UPDATE\s+public\.loans/i);
  assert.doesNotMatch(migration, /loan_payments/i);
  assert.doesNotMatch(migration, /interest_type\s*=/i);
});
