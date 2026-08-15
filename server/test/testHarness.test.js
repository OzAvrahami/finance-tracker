const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('canonical test bootstrap supplies safe non-secret defaults', () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.match(process.env.SUPABASE_URL, /^http:\/\/127\.0\.0\.1:/);
  assert.ok(process.env.SUPABASE_KEY);
  assert.ok(process.env.EXTERNAL_API_KEY);
  assert.ok(process.env.LOAN_JOB_SECRET);
  assert.ok(process.env.REBRICKABLE_API_KEY);
});

test('canonical server test discovery excludes the local/private naming convention', () => {
  const packageJson = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'package.json'),
    'utf8',
  ));
  const runner = fs.readFileSync(path.join(__dirname, 'run-tests.js'), 'utf8');

  assert.equal(packageJson.scripts.test, 'node test/run-tests.js');
  assert.match(runner, /endsWith\('\.test\.js'\)/);
  assert.match(runner, /endsWith\('\.local\.test\.js'\)/);
  assert.doesNotMatch(runner, /git\s/);
});
