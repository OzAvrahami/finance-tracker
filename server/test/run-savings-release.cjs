// Bounded integration campaign against the FINAL schema, reusing authoritative
// scenario assertions. Stage-specific upgrade assertions are not final-schema
// checks: the separate release test executes the actual 029 -> 035 chain.
// Generated runners/logs stay outside the repository. No .env is loaded.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-sav08-matrix-'));
const cases = [
  ['Manual', 'create exact cash|existing/imported cash|same-day/repeated|category/direction|detach, explicit|linked void|cutoff, inactive|concurrent withdrawals|Loan/Savings contention'],
  ['Interest', 'exact numerical contract|explicit existing income|atomic correction|stable same-day|concurrent capitalization|service commands'],
  ['Monthly', 'oldest due|future, disabled|explicit skip|manual/imported fulfillment|cancellation and repeated|two jobs|inactive source|calendar leap'],
  ['Surplus', 'same-month exact|cross-month source|preview invalidates|parallel requests|consumed Savings|month close requires|legacy return|carry-forward'],
  ['Reporting', 'authoritative 1200|cross-month funded|cash classification|corrections move|empty periods'],
];
console.log('Final-schema integration evidence: ' + output);
let failed = false;
for (const [stage, pattern] of cases) {
  const source = path.join(__dirname, `savings${stage}Postgres.local.test.js`);
  let text = fs.readFileSync(source, 'utf8');
  const migration = /^const migration = read\([^\r\n]+\);/m;
  const baseline = /^const baseline = read\('server\/full_schema.sql'\)\.split\([^\r\n]+\)\[0\];/m;
  assert(migration.test(text) && baseline.test(text), 'Scenario harness changed: review final-schema adaptation');
  assert(text.includes("path.join(__dirname, '../..', p)"));
  text = text.replace(migration, "const migration = ''; // Already at final release schema.")
    .replace(baseline, "const baseline = read('server/full_schema.sql');")
    .replace("path.join(__dirname, '../..', p)", `path.join(${JSON.stringify(root)}, p)`);
  if (stage === 'Reporting') {
    const anchor = "const r=report(db,month(db)+'-01');";
    assert(text.includes(anchor));
    text = text.replace(anchor, anchor + " const audit=json(db,read('docs/SAVINGS_RELEASE_POSTFLIGHT.sql')); assert.equal(audit.result,'SAVINGS_RELEASE_POSTFLIGHT_PASS',JSON.stringify(audit));");
  }
  const generated = path.join(output, stage + '.local.test.cjs');
  fs.writeFileSync(generated, text, 'utf8');
  const r = spawnSync(process.execPath, ['--test', '--test-name-pattern', pattern, generated], { encoding: 'utf8', maxBuffer: 20e6 });
  fs.writeFileSync(path.join(output, stage + '.log'), r.stdout + r.stderr);
  console.log(stage + ':\n' + r.stdout.split('\n').filter(l => /^(ℹ|# (tests|pass|fail|skipped))/.test(l)).join('\n'));
  if (r.status !== 0) { console.error(r.stdout + r.stderr); failed = true; }
}
console.log('Unselected historical/stage-specific assertions are excluded, not counted as passes.');
process.exitCode = failed ? 1 : 0;
