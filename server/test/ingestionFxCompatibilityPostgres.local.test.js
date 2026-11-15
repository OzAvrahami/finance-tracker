// Real PostgreSQL 17/Auth/HTTP rollout matrix. No hosted connections or writes.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { start } = require('./helpers/refundEnvironment');
const core = require('../services/ingestion/core');
const updated = { ...core };
const root = path.resolve(__dirname, '../..');
const deployed = '71c29ce0cfb149ba15fee7096ff38da7b9962dd7';
const hashes = {
  core: '5e2024bd7833a0d611d50451f0f6549019456cbf446293916b7dcbb26285322b',
  policy: '0279f000c72a3e373b5049034ea7c74fcafb2d512f24ac01d52ca7f8aa6d4026',
  reconciliation: '939a5746b1023c444aa4f0ff134807fb068ce86f277f8a58e7594df8e7831ff9',
};
const sha = text => createHash('sha256').update(text).digest('hex');
const gitFile = (revision, file) => execFileSync('git', ['show', `${revision}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 32e6 });
const legacyModules = new Map();
function legacy(name) {
  if (legacyModules.has(name)) return legacyModules.get(name).exports;
  const relative = `server/services/ingestion/${name}.js`, filename = path.join(root, relative);
  const source = gitFile(deployed, relative); assert.equal(sha(source), hashes[name], relative);
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  legacyModules.set(name, mod);
  const localRequire = mod.require.bind(mod);
  mod.require = id => id.startsWith('./') && hashes[id.slice(2)] ? legacy(id.slice(2)) : localRequire(id);
  mod._compile(source, filename); return mod.exports;
}
const old = legacy('core');
// HTTP/auth/adapter files are unchanged; swap only the actual revision-pinned
// ingestion implementation at the module boundary used by these real routes.
for (const file of ['server/routes/reconciliationRoutes.js', 'server/services/transactionIngestionService.js', 'server/services/unifiedTransactionIngestion.js', 'server/services/ingestion/readers.js']) {
  assert.equal(fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n'), gitFile(deployed, file));
}
const quote = value => `'${JSON.stringify(value).replaceAll("'", "''")}'`;
function selectBackend(implementation) {
  Object.assign(core, implementation);
  // The read projection captures linkReason at load time. Reload that unchanged
  // adapter too, so HTTP can_link and command execution use the same revision.
  const adapter = require.cache[require.resolve('../services/transactionIngestionService')];
  if (adapter) {
    delete require.cache[require.resolve('../services/ingestion/readers')];
    adapter.exports.readReconciliation = require('../services/ingestion/readers').read;
  }
}

test('064 migration-first compatibility and function-only recovery on PostgreSQL 17', async t => {
  selectBackend(old);
  const env = await start({ schemaBoundary: '-- Migration 064:', postgresImage: 'postgres:17-alpine' });
  try {
    assert.match(env.sql('SHOW server_version;'), /^17\./);
    process.env.FLOWLINK_OWNER_USER_IDS = JSON.stringify([env.session.user.id]);
    const db = createClient(env.url, env.service);
    const rpc = async (name, args) => { const r = await db.rpc(name, args); assert.ifError(r.error); return r.data; };
    const snapshot = scope => rpc('ingestion_core_snapshot', { p_scope: scope });
    const post = async request => {
      const r = await fetch(`${env.apiUrl}/v1/transactions`, { method: 'POST', headers: { Authorization: 'Bearer synthetic-refund-external', 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
      return { status: r.status, body: await r.json() };
    };
    const row = id => env.sql(`SELECT to_jsonb(t) FROM transactions t WHERE id=${Number(id)};`);
    const frozen = () => env.sql("SELECT jsonb_build_object('cash',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM transactions t),'obs',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM transaction_source_observations o),'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM transaction_reconciliation_events e));");
    const metadata = () => env.sql("SELECT jsonb_build_object('body',md5(replace(prosrc,chr(13),'')),'owner',pg_get_userbyid(proowner),'acl',proacl::text,'security',prosecdef,'config',proconfig) FROM pg_proc WHERE oid='ingestion_core_apply(jsonb,jsonb,jsonb)'::regprocedure;");
    const baselineDefinition = env.sql("SELECT pg_get_functiondef('ingestion_core_apply(jsonb,jsonb,jsonb)'::regprocedure);");
    const baselineMetadata = metadata();
    const migration = fs.readFileSync(path.join(root, 'server/migrations/064_fx_owner_links.sql'), 'utf8');
    let sequence = 0;
    const make = async (form = 'noop', currency = 'ILS', sourceKind = 'cal') => {
      const amount = 200 + ++sequence;
      const created = await post({ type: 'expense', amount, date: '2026-04-03', description: 'Synthetic CAL transition', payment_source_id: 6,
        currency, ...(currency === 'ILS' ? {} : { original_amount: 35.12 }), external_id: randomUUID(),
        ...(['fixed_same', 'fixed_conflict'].includes(form) ? { charge_date: '2026-04-10' } : {}) });
      assert.equal(created.status, 201, JSON.stringify(created));
      const tid = String(created.body.id);
      if (form === 'owner_override') env.sql(`UPDATE transactions SET charge_date='2026-04-11' WHERE id=${tid};`);
      const source = await rpc('configure_ingestion_source', { p_request_key: randomUUID(), p_command: {
        source_kind: sourceKind, instance_key: randomUUID(), configuration: { payment_source_ids: ['6'] }, actor: 'synthetic' } });
      const held = await core.observation(db, String(source.source_id), { idempotency_key: randomUUID(), merchant: 'Synthetic CAL transition',
        accounting_amount: `${amount}.00`, currency: 'ILS', movement_type: 'expense', transaction_date: '2026-04-03', payment_source_id: '6',
        ...(form === 'noop' ? {} : { charge_date: form === 'fixed_conflict' ? '2026-04-12' : '2026-04-10' }) });
      assert.equal(held.transaction_id, null);
      const detail = await env.api(`/reconciliation/observation/${held.observation_id}`); assert.equal(detail.status, 200);
      const command = { action: 'link', observation_id: held.observation_id, expected_revision: detail.body.observation.revision,
        transaction_id: tid, expected_transaction_fingerprint: detail.body.candidates.find(c => c.id === tid || String(c.id) === tid).fingerprint,
        expected_candidate_fingerprints: detail.body.candidate_fingerprints, actor: `owner:${env.session.user.id}`, reason: 'Synthetic transition' };
      const scope = { command_kind: 'resolve', request_key: randomUUID(), review: true, command };
      const snap = await snapshot(scope), decision = core.decideCommand(snap.facts, scope);
      assert.equal(detail.body.candidates.find(c => String(c.id) === tid).can_link, decision.action === 'link');
      return { tid, oid: held.observation_id, creator: String(created.body.observation_id), scope, snap, decision };
    };
    const resolve = c => {
      const { actor, reason, observation_id, ...command } = c.scope.command;
      return env.api(`/reconciliation/observation/${c.oid}/resolve`, { ...command, request_key: c.scope.request_key });
    };
    const sqlReject = (c, decision = c.decision, snap = c.snap, scope = c.scope) => env.sqlFailure(`SET ROLE service_role; SELECT ingestion_core_commit(${quote(scope)},'${snap.token}',${quote(decision)});`);
    const legacyForms = async () => {
      for (const form of ['noop', 'fixed_same', 'provisional', 'fixed_conflict', 'owner_override']) {
        const c = await make(form), before = row(c.tid), conflict = ['fixed_conflict', 'owner_override'].includes(form);
        assert.deepEqual(c.decision.enrichment, form === 'provisional'
          ? { ok: true, transaction_id: c.tid, creator_id: c.creator, charge_date: '2026-04-10' } : { ok: !conflict });
        const r = await resolve(c); assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(r.body.transaction_id, c.tid);
        assert.equal(r.body.review_required, conflict); assert.equal(r.body.reason_code, conflict ? 'enrichment_conflict' : 'owner_link');
        if (form !== 'provisional') assert.equal(row(c.tid), before, form);
        else {
          const persisted = JSON.parse(row(c.tid)), original = JSON.parse(before);
          assert.equal(persisted.charge_date, '2026-04-10');
          delete persisted.updated_at; delete original.updated_at; original.charge_date = '2026-04-10'; assert.deepEqual(persisted, original);
          assert.equal(env.sql(`SELECT charge_date_origin FROM transaction_source_observations WHERE id=${c.creator};`), 'cal_confirmed');
        }
        const after = frozen(); assert.equal((await resolve(c)).body.replayed, true); assert.equal(frozen(), after);
      }
    };

    await t.test('deployed backend + existing database: all legitimate CAL forms persist through owner HTTP', legacyForms);
    await t.test('pin and reproduce the rejected candidate, then roll back its function locally', async () => {
      const rejectedCandidate = gitFile('9e9222fb5db8448c7460d967ea53b8a037c85bec', 'server/migrations/064_fx_owner_links.sql');
      assert.equal(sha(rejectedCandidate), '5e1a14e69c724411193feafb6b97c7b4720545e57264c60b737f325640fed09a');
      const c = await make(), before = frozen(); env.sql(rejectedCandidate);
      assert.match(sqlReject(c).stderr, /inconsistent_owner_link/); assert.equal(frozen(), before);
      env.sql(baselineDefinition); assert.equal(metadata(), baselineMetadata);
    });
    await t.test('updated backend + existing database: FX refund works, unsupported FX link fails without writes or success', async () => {
      selectBackend(updated);
      const r = await post({ type: 'refund', amount: 137.29, currency: 'USD', original_amount: 35.12,
        date: '2026-05-03', payment_source_id: 6, external_id: randomUUID() });
      assert.equal(r.status, 201); assert.equal(JSON.parse(row(r.body.id)).total_amount, -137.29);
      const c = await make('provisional', 'USD'), before = frozen();
      assert.equal(c.decision.action, 'link'); assert.equal(c.decision.enrichment, null);
      const response = await resolve(c); assert.equal(response.status, 503, JSON.stringify(response)); assert.equal(frozen(), before);
      const ils = await make('provisional'), ilsBefore = row(ils.tid);
      assert.equal((await resolve(ils)).status, 200); assert.equal(row(ils.tid), ilsBefore);
      selectBackend(old);
    });
    await t.test('corrected migration preserves rows and permissions; deployed backend remains HTTP compatible', async () => {
      const before = frozen(); env.sql(migration); assert.equal(frozen(), before);
      const meta = JSON.parse(metadata()), original = JSON.parse(baselineMetadata); delete meta.body; delete original.body; assert.deepEqual(meta, original);
      await legacyForms();
      const beforeRefund = frozen();
      const refund = await post({ type: 'refund', amount: 17.29, currency: 'USD', original_amount: 4.12,
        date: '2026-05-03', payment_source_id: 6, external_id: randomUUID() });
      assert.equal(refund.status, 422); assert.equal(refund.body.reason_code, 'refund_currency_unsupported'); assert.equal(frozen(), beforeRefund);
      const fx = await make('noop', 'USD'), beforeLink = frozen();
      assert.equal((await resolve(fx)).status, 422); assert.equal(frozen(), beforeLink);
    });
    await t.test('forged enrichment shapes, target/creator/evidence and owner override remain rejected atomically', async () => {
      const c = await make('provisional'), before = frozen();
      for (const enrichment of [{}, { ok: 'true' }, { ok: true, extra: 1 }, { ...c.decision.enrichment, ok: false },
        { ...c.decision.enrichment, transaction_id: '999999' }, { ...c.decision.enrichment, creator_id: '999999' },
        { ...c.decision.enrichment, charge_date: '2026-04-12' }, { ...c.decision.enrichment, creator_id: null }]) {
        assert.notEqual(sqlReject(c, { ...c.decision, enrichment }).status, 0, JSON.stringify(enrichment)); assert.equal(frozen(), before);
      }
      const overridden = await make('owner_override'), ownerBefore = frozen();
      assert.deepEqual(overridden.decision.enrichment, { ok: false });
      assert.match(sqlReject(overridden, { ...overridden.decision, enrichment: { ok: true, transaction_id: overridden.tid,
        creator_id: overridden.creator, charge_date: '2026-04-10' } }).stderr, /inconsistent_enrichment_evidence/);
      assert.equal(frozen(), ownerBefore);
      const atomic = await make('provisional'), atomicBefore = frozen();
      env.sql(`CREATE FUNCTION fx_legacy_review_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic legacy review failure'; END $$;
        CREATE TRIGGER fx_legacy_review_failure BEFORE INSERT ON transaction_reconciliation_events FOR EACH ROW WHEN (NEW.event_kind='review') EXECUTE FUNCTION fx_legacy_review_failure();`);
      assert.match(sqlReject(atomic).stderr, /synthetic legacy review failure/); assert.equal(frozen(), atomicBefore);
      env.sql('DROP TRIGGER fx_legacy_review_failure ON transaction_reconciliation_events;');
      env.sql(`UPDATE transactions SET notes='New owner note' WHERE id=${c.tid};`);
      assert.match(sqlReject(c).stderr, /stale_ingestion_snapshot/);
      assert.equal((await resolve(c)).status, 409);
    });
    await t.test('legacy enrichment cannot authorize FX or linked-domain targets; updated CAL links remain financial no-ops', async () => {
      selectBackend(updated);
      const nonCal = await make('noop', 'ILS', 'apple_pay'), nonCalBefore = frozen();
      assert.match(sqlReject(nonCal, { ...nonCal.decision, enrichment: { ok: true } }).stderr, /inconsistent_owner_link_enrichment/);
      assert.equal(frozen(), nonCalBefore);
      for (const currency of ['USD', 'ILS']) {
        const c = await make('provisional', currency), before = row(c.tid);
        assert.equal(c.decision.enrichment, null);
        if (currency === 'USD') assert.match(sqlReject(c, { ...c.decision, enrichment: { ok: true } }).stderr, /inconsistent_owner_link_enrichment/);
        assert.equal((await resolve(c)).status, 200); assert.equal(row(c.tid), before);
      }
      const c = await make('provisional');
      env.sql(`BEGIN; LOCK TABLE transactions IN EXCLUSIVE MODE; INSERT INTO transaction_items(transaction_id,item_name) VALUES(${c.tid},'Protected item'); COMMIT;`);
      const before = frozen(), snap = await snapshot(c.scope);
      assert.notEqual(sqlReject(c, { ...c.decision, enrichment: { ok: true } }, snap).status, 0); assert.equal(frozen(), before);
    });
    await t.test('function-only recovery restores baseline metadata and financial rows; corrected migration reapplies from baseline', async () => {
      const before = frozen(), corrected = metadata(), afterHash = JSON.parse(corrected).body;
      const restore = `BEGIN; SET LOCAL lock_timeout='3s'; LOCK TABLE transactions IN EXCLUSIVE MODE;
        DO $$ BEGIN IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid='ingestion_core_apply(jsonb,jsonb,jsonb)'::regprocedure),chr(13),'')) <> '${afterHash}'
          THEN RAISE EXCEPTION 'unexpected recovery baseline'; END IF; END $$; ${baselineDefinition}; COMMIT;`;
      env.sql(restore); assert.equal(frozen(), before); assert.equal(metadata(), baselineMetadata);
      assert.match(env.sqlFailure(restore).stderr, /unexpected recovery baseline/);
      env.sql(migration); assert.equal(metadata(), corrected); assert.equal(frozen(), before);
    });
  } finally { selectBackend(updated); await env.stop(); }
});
