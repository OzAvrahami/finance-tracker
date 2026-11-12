'use strict';

// Disposable-test orchestration only. Not imported by the application and not a
// hosted migration runner. Production authorization cannot enable this helper.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const migrations = Object.freeze([
  ['060_shopping_hierarchy_persistence.sql', '0d088ec3c0851c1f38badcef6afa32381cfc1b3b075226975af26a193e0aa66e'],
  ['061_shopping_category_contract.sql', '4e19c45dc4f02c3c47ad7249f2752d587a4c6a45147047927307a2b940f545bb'],
  ['062_shopping_administration_contract.sql', '00ffef70764d50661fd23b82fe262a4e0a165121b8540ef59ef23bc7e45d661d'],
  ['063_shopping_workflow_persistence.sql', '6b87a2e9751ea6f0e03af52d65c7025426d009653b2e0d88c61a67e71584de7d'],
]);

function migrationText(index) {
  const [file, expected] = migrations[index];
  const bytes = fs.readFileSync(path.join(__dirname, '../../migrations', file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, 'Reviewed migration changed');
  return bytes.toString('utf8');
}

function guard(env) {
  assert.equal(process.env.SHOPPING_ISOLATED_TEST, 'issue-102-disposable');
  assert.match(env.identity, /^shopping102-[0-9a-f-]{36}$/);
  env.guard(); // Reinspect disposable labels, internal network and port bindings.
  const identity = env.sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();").stdout.trim();
  assert.equal(identity, env.identity, 'Missing or foreign database identity');
  return `SET shopping.isolated_migration='${env.identity}';`;
}

function createFence() {
  let phase = 'legacy', active = 0;
  const waiters = new Set();
  return {
    get phase() { return phase; }, get active() { return active; },
    middleware(req, res, next) {
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
      if (phase === 'fenced') return res.status(503).set('Retry-After', '30').json({ error: 'maintenance' });
      active++;
      // Count handler completion, not socket close: a disconnected client does
      // not prove its database/provider operation finished.
      let finished = false;
      res.once('finish', () => { if (finished) return;finished = true;active--;if (!active) for (const done of waiters) done(); });
      next();
    },
    async drain(timeout = 5000) {
      phase = 'fenced';
      if (!active) return;
      await new Promise((resolve, reject) => {
        const done = () => { clearTimeout(timer);waiters.delete(done);resolve(); };
        const timer = setTimeout(() => { waiters.delete(done);reject(Error('Writer drain timed out; fence remains closed')); }, timeout);
        waiters.add(done);
      });
    },
    activate() { assert.equal(phase, 'fenced');assert.equal(active, 0);phase = 'replacement'; },
  };
}

function createRunner(env, fence) {
  const journal = [];
  return {
    journal,
    apply(index, mapping = '') {
      assert.equal(fence.phase, 'fenced');assert.equal(fence.active, 0);
      assert.equal(index, journal.length, 'Forward-only ordered execution required');
      const prefix = guard(env);
      if (!index) assert.equal(env.sql("SELECT to_regnamespace('shopping_private') IS NULL;").stdout.trim(), 't', 'Unexpected schema ledger');
      // Each immutable authoring file owns its transaction. Do not claim the
      // four-file sequence is one atomic production transaction.
      env.sql(prefix + mapping + migrationText(index));
      journal.push({ file: migrations[index][0], sha256: migrations[index][1], completedAt: new Date().toISOString() });
    },
    activate() { assert.equal(journal.length, migrations.length);guard(env);fence.activate(); },
  };
}

module.exports = { migrations, migrationText, guard, createFence, createRunner };
