// Real local PostgreSQL + Auth + PostgREST + application HTTP. Synthetic data
// only; the helper creates and removes its own isolated Docker resources.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { createClient } = require('@supabase/supabase-js');
const { start } = require('./helpers/refundEnvironment');
const core = require('../services/ingestion/core');
const quote = v => `'${(typeof v === 'object' ? JSON.stringify(v) : String(v)).replaceAll("'", "''")}'`;
const item = (key, extra = {}) => ({ type: 'expense', amount: 137.29, date: '2026-04-03', charge_date: '2026-04-02',
  description: 'Synthetic FX store', payment_source_id: 6, currency: 'USD', original_amount: 35.12, external_id: key, ...extra });

test('FX ingestion and explicit links: real HTTP, forward/fresh schema and atomic persistence', async t => {
  const env = await start({ schemaBoundary: '-- Migration 064:', postgresImage: 'postgres:17-alpine' });
  try {
    const version = env.sql('SHOW server_version;');
    assert.match(version, /^17\./, 'The focused FX suite must exercise the hosted PostgreSQL major');
    t.diagnostic(`Disposable PostgreSQL ${version}`);
    process.env.FLOWLINK_OWNER_USER_IDS = JSON.stringify([env.session.user.id]);
    const db = createClient(env.url, env.service);
    const migration = fs.readFileSync(path.join(__dirname, '../migrations/064_fx_owner_links.sql'), 'utf8').replaceAll('\r\n', '\n');
    const fullSchema = fs.readFileSync(path.join(__dirname, '../full_schema.sql'), 'utf8').replaceAll('\r\n', '\n');
    const schema = fullSchema.slice(0, fullSchema.indexOf('-- Migration 065:')).trimEnd();
    const count = () => Number(env.sql('SELECT count(*) FROM transactions;'));
    const cash = id => env.sql(`SELECT to_jsonb(t) FROM transactions t WHERE id=${Number(id)};`);
    const post = async body => {
      const r = await fetch(`${env.apiUrl}/v1/transactions`, { method: 'POST',
        headers: { Authorization: 'Bearer synthetic-refund-external', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json() };
    };
    const rpc = async (name, args) => { const r = await db.rpc(name, args); assert.ifError(r.error); return r.data; };
    const snapshot = async scope => rpc('ingestion_core_snapshot', { p_scope: scope });
    const configure = async () => (await rpc('configure_ingestion_source', { p_request_key: randomUUID(), p_command: {
      source_kind: 'cal', instance_key: `fx-${randomUUID()}`, configuration: { payment_source_ids: ['6'] }, actor: 'synthetic' } })).source_id;
    const observe = async (sid, key, extra = {}) => core.observation(db, String(sid), { idempotency_key: key, merchant: 'Synthetic FX store',
      accounting_amount: '137.29', currency: 'ILS', movement_type: 'expense', transaction_date: '2026-04-03',
      charge_date: '2026-04-02', payment_source_id: '6', ...extra });
    const target = (amount = 137.29, extra = '') => env.sql(`INSERT INTO transactions(description,notes,movement_type,total_amount,
      payment_source_id,transaction_date,charge_date,currency,original_amount,exchange_rate)
      VALUES('Owner description','Previous name: retained; owner note','expense',${amount},6,'2026-04-03','2026-04-10','USD',35.12,3.8) RETURNING id;${extra}`).split('\n')[0];
    const review = async (oid, tid) => {
      const r = await env.api(`/reconciliation/observation/${oid}`); assert.equal(r.status, 200, JSON.stringify(r));
      const candidate = r.body.candidates.find(c => String(c.id) === String(tid)); assert.ok(candidate, JSON.stringify(r));
      return { view: r.body, candidate, command: { request_key: randomUUID(), expected_revision: r.body.observation.revision,
        action: 'link', transaction_id: String(tid), expected_transaction_fingerprint: candidate.fingerprint,
        expected_candidate_fingerprints: r.body.candidate_fingerprints } };
    };
    const resolve = (oid, command) => env.api(`/reconciliation/observation/${oid}/resolve`, command);

    await t.test('forward migration preserves financial evidence and grants, rejects drift/replay, and equals fresh installation', async () => {
      const historical = await post(item('pre-upgrade-fx')); assert.equal(historical.status, 201, JSON.stringify(historical));
      const frozen = () => env.sql("SELECT jsonb_build_object('cash',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM transactions t),'obs',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM transaction_source_observations o),'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM transaction_reconciliation_events e));");
      const grants = () => env.sql("SELECT jsonb_object_agg(oid::regprocedure::text,jsonb_build_array(proowner,proacl::text,prosecdef,proconfig)) FROM pg_proc WHERE proname LIKE 'ingestion_core_%' OR proname IN ('apy_protected','apy_captured');");
      const before = frozen(), beforeGrants = grants();
      assert.notEqual(env.sqlFailure(migration.replace('COMMIT;', 'SELECT 1/0; COMMIT;')).status, 0);
      assert.equal(frozen(), before); assert.equal(grants(), beforeGrants);
      const original = env.sql("SELECT pg_get_functiondef('ingestion_core_apply(jsonb,jsonb,jsonb)'::regprocedure);");
      env.sql(original.replace('DECLARE f JSONB=p_facts;', 'DECLARE f JSONB=p_facts; /* unexpected definition */'));
      const drift = env.sqlFailure(migration); assert.notEqual(drift.status, 0); assert.match(drift.stderr, /requires the reviewed 059/);
      env.sql(original);
      for (const metadata of ['STABLE', 'STRICT', 'SECURITY INVOKER', 'SET search_path = public']) {
        env.sql(`ALTER FUNCTION ingestion_core_apply(jsonb,jsonb,jsonb) ${metadata};`);
        assert.match(env.sqlFailure(migration).stderr, /requires the reviewed 059/, metadata);
        env.sql(original);
      }
      env.sql(migration); assert.equal(frozen(), before); assert.equal(grants(), beforeGrants);
      assert.notEqual(env.sqlFailure(migration).status, 0, 'repeat migration must not silently overwrite');
      assert.ok(schema.endsWith(migration.trimEnd()));
      env.sql('CREATE DATABASE fx_fresh;');
      const fresh = spawnSync('docker', ['exec', '-i', `${env.prefix}-db`, 'psql', '-U', 'postgres', '-d', 'fx_fresh', '-v', 'ON_ERROR_STOP=1', '-Atq'],
        { input: schema, encoding: 'utf8', timeout: 90000, maxBuffer: 32e6 });
      assert.equal(fresh.status, 0, fresh.stderr);
      const defs = "SELECT jsonb_object_agg(oid::regprocedure::text,jsonb_build_array(replace(pg_get_functiondef(oid),chr(13),''),proacl::text,prosecdef,proconfig)) FROM pg_proc WHERE pronamespace='public'::regnamespace;";
      const freshDefs = spawnSync('docker', ['exec', '-i', `${env.prefix}-db`, 'psql', '-U', 'postgres', '-d', 'fx_fresh', '-Atq'], { input: defs, encoding: 'utf8', maxBuffer: 32e6 });
      assert.equal(freshDefs.status, 0, freshDefs.stderr); assert.deepEqual(JSON.parse(freshDefs.stdout), JSON.parse(env.sql(defs)));
      // Bring the legacy consolidated reference up to its current checkout boundary.
      const finish = spawnSync('docker', ['exec', '-i', `${env.prefix}-db`, 'psql', '-U', 'postgres', '-d', 'fx_fresh', '-v', 'ON_ERROR_STOP=1', '-Atq'],
        { input: fullSchema.slice(schema.length) + "\nSELECT has_function_privilege('service_role','shopping_checkout(bigint,bigint,bigint,jsonb)','execute');", encoding:'utf8' });
      assert.equal(finish.status, 0, finish.stderr);
      assert.equal(finish.stdout.trim(), 'f');
      for (const role of ['anon', 'authenticated', 'service_role']) {
        assert.equal(env.sql(`SELECT has_function_privilege('${role}','ingestion_core_apply(jsonb,jsonb,jsonb)','EXECUTE');`), 'f');
        assert.equal(env.sql(`SELECT has_function_privilege('${role}','ingestion_core_commit(jsonb,text,jsonb)','EXECUTE');`), role === 'service_role' ? 't' : 'f');
      }
      assert.equal((await post(item('pre-upgrade-fx'))).body.replayed, true);
    });

    await t.test('Single and Bulk preserve actual ILS, optional FX rates and exact immutable evidence; retry and conflict are durable', async () => {
      for (const type of ['expense', 'refund']) for (const rate of [undefined, 3.8]) {
        const request = item(`single-${type}-${rate}`, { type, exchange_rate: rate, date: type === 'refund' ? '2026-05-03' : '2026-06-03' });
        const r = await post(request); assert.equal(r.status, 201, JSON.stringify(r));
        const row = JSON.parse(cash(r.body.id)); assert.equal(row.total_amount, type === 'refund' ? -137.29 : 137.29);
        assert.equal(row.currency, 'USD'); assert.equal(row.original_amount, 35.12); assert.equal(row.exchange_rate, rate ?? null);
        assert.equal(row.movement_type, 'expense'); assert.equal(row.bank_movement, type === 'refund' ? 'refund' : null);
        const evidence = env.sql(`SELECT accepted_payload::text||payload_fingerprint FROM transaction_source_observations WHERE id=${r.body.observation_id};`);
        const total = count(); const replay = await post(request); assert.equal(replay.status, 409); assert.equal(replay.body.id, r.body.id); assert.equal(count(), total);
        for (const change of [{ amount: 137.30 }, { original_amount: 35.13 }, { currency: 'EUR' }, { exchange_rate: 4 }]) {
          const conflict = await post({ ...request, ...change }); assert.equal(conflict.status, 409); assert.equal(conflict.body.reason_code, 'idempotency_key_conflict');
        }
        assert.equal(env.sql(`SELECT accepted_payload::text||payload_fingerprint FROM transaction_source_observations WHERE id=${r.body.observation_id};`), evidence);
        assert.equal(count(), total);
      }
      const items = [item('bulk-expense', { date: '2026-07-03' }), item('bulk-refund', { type: 'refund', date: '2026-07-03', exchange_rate: 3.8 }),
        item('bulk-no-original', { type: 'refund', date: '2026-08-03', original_amount: undefined })];
      const bulk = await post({ items }); assert.equal(bulk.status, 200, JSON.stringify(bulk));
      assert.equal(bulk.body.created, 2); assert.equal(bulk.body.review_required, 1);
      assert.equal((await post({ items })).body.already_exists, 2);
      const held = await post(items[2]); assert.equal(held.status, 202); assert.equal(held.body.reason_code, 'original_amount_required');
      const s = await snapshot({ command: { observation_id: held.body.observation_id } }), o = s.facts.observations.find(o => o.id === held.body.observation_id);
      const separate = await core.command(db, 'resolve', randomUUID(), { observation_id: o.id, expected_revision: o.decision_revision,
        expected_candidate_fingerprints: o.review_fingerprints, action: 'separate', actor: 'owner:synthetic', reason: 'Cannot invent original amount' }, true);
      assert.equal(separate.reason_code, 'evidence_correction_required');
      assert.equal((await post(item(undefined, { type: 'refund', date: '2026-08-05' }))).body.reason_code, 'identity_evidence_required');
      for (const field of ['amount', 'original_amount', 'exchange_rate']) assert.equal((await post(item(`invalid-${field}`, { [field]: '3.8' }))).status, 400);
    });

    await t.test('owner HTTP link attaches only provenance; replay, changed key content and source exclusivity prevent duplication', async () => {
      const tid = target(), sid = await configure(), held = await observe(sid, 'owner-link');
      assert.equal(held.transaction_id, null); assert.equal(held.review_required, true);
      const r = await review(held.observation_id, tid); assert.equal(r.candidate.can_link, true);
      const frozen = cash(tid), total = count();
      const linked = await resolve(held.observation_id, r.command); assert.equal(linked.status, 200, JSON.stringify(linked));
      assert.equal(linked.body.transaction_id, String(tid)); assert.equal(linked.body.review_required, false);
      assert.equal(cash(tid), frozen); assert.equal(count(), total);
      const persisted = JSON.parse(env.sql(`SELECT to_jsonb(o) FROM transaction_source_observations o WHERE id=${held.observation_id};`));
      assert.equal(persisted.transaction_id, Number(tid)); assert.equal(persisted.review_required, false);
      assert.equal((await resolve(held.observation_id, r.command)).body.replayed, true);
      assert.equal((await resolve(held.observation_id, { ...r.command, expected_revision: '999' })).status, 409);
      const second = await observe(sid, 'same-source-second-identity'); assert.equal(second.transaction_id, null);
      assert.equal((await review(second.observation_id, tid)).candidate.can_link, false);
      assert.equal(cash(tid), frozen); assert.equal(count(), total);
      const s = await snapshot({ command: { transaction_id: String(tid) } });
      const cancel = await core.command(db, 'cancel', randomUUID(), { transaction_id: String(tid), expected_revision: persisted.decision_revision.toString(),
        expected_transaction_fingerprint: s.facts.transactions.find(t => t.id === String(tid)).cash_fingerprint, actor: 'owner:synthetic', reason: 'Generic FX cancel must remain blocked' });
      assert.equal(cancel.reason_code, 'protected_transaction'); assert.equal(cash(tid), frozen);
    });

    await t.test('conflicting or incomplete FX evidence stays in review; matching evidence and accounting-only refunds can link', async () => {
      const tid = target();
      for (const [i, extra] of [{ currency: 'EUR' }, { original_amount: 35.13 }, { exchange_rate: 3.81 }, { original_amount: undefined }].entries()) {
        const held = await post(item(`fx-conflict-${i}`, extra)); assert.equal(held.body.transaction_id, null, JSON.stringify(held));
        const r = await review(held.body.observation_id, tid); assert.equal(r.candidate.can_link, false);
        const frozen = cash(tid); assert.equal((await resolve(held.body.observation_id, r.command)).status, 409);
        assert.equal(cash(tid), frozen);
        assert.equal(env.sql(`SELECT transaction_id IS NULL AND review_required FROM transaction_source_observations WHERE id=${held.body.observation_id};`), 't');
      }
      const sid = await configure();
      const held = await observe(sid, 'matching-original', { original_amount: '35.120000', original_currency: 'USD', original_scale: '6' });
      const r = await review(held.observation_id, tid), frozen = cash(tid);
      assert.equal(r.candidate.can_link, true); assert.equal((await resolve(held.observation_id, r.command)).body.review_required, false);
      assert.equal(cash(tid), frozen);
      const credit = target(-79.23);
      const refund = await post(item('explicit-refund', { type: 'refund', amount: 79.23, currency: 'ILS', original_amount: undefined }));
      assert.equal(refund.body.transaction_id, null);
      const refundReview = await review(refund.body.observation_id, credit), creditBefore = cash(credit);
      assert.equal(refundReview.candidate.can_link, true);
      assert.equal((await resolve(refund.body.observation_id, refundReview.command)).body.transaction_id, String(credit));
      assert.equal(cash(credit), creditBefore);
    });

    await t.test('date correction invalidates old reviews; fresh review links without changing owner-controlled billing', async () => {
      const tid = target(151.01), sid = await configure(), held = await observe(sid, 'date-review', { accounting_amount: '151.01' });
      const old = await review(held.observation_id, tid);
      env.sql(`UPDATE transactions SET charge_date='2026-04-11' WHERE id=${tid};`);
      assert.equal((await resolve(held.observation_id, old.command)).status, 409);
      const fresh = await review(held.observation_id, tid), before = cash(tid);
      assert.notDeepEqual(fresh.command.expected_candidate_fingerprints, old.command.expected_candidate_fingerprints);
      assert.equal((await resolve(held.observation_id, fresh.command)).body.review_required, false); assert.equal(cash(tid), before);
      assert.equal((await resolve(held.observation_id, { ...fresh.command, request_key: randomUUID() })).status, 409);
    });

    await t.test('locked snapshot and exact owner-command binding reject stale or forged decisions atomically', async () => {
      const tid = target(152.01), sid = await configure(), held = await observe(sid, 'atomic-link', { accounting_amount: '152.01' });
      const r = await review(held.observation_id, tid), { request_key, ...command } = r.command;
      const scope = { command_kind: 'resolve', request_key, review: true,
        command: { ...command, observation_id: held.observation_id, actor: `owner:${env.session.user.id}`, reason: 'Synthetic owner link' } };
      const s = await snapshot(scope), d = core.decideCommand(s.facts, scope); assert.equal(d.action, 'link');
      const frozen = () => env.sql(`SELECT jsonb_build_object('cash',(SELECT to_jsonb(t) FROM transactions t WHERE id=${tid}),
        'obs',(SELECT to_jsonb(o) FROM transaction_source_observations o WHERE id=${held.observation_id}),
        'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM transaction_reconciliation_events e));`);
      const before = frozen();
      const commitFailure = (sc, snap, dec) => env.sqlFailure(`SET ROLE service_role; SELECT ingestion_core_commit(${quote(sc)},${quote(snap.token)},${quote(dec)});`);
      for (const changed of [{ ...d, target: s.facts.transactions.find(t => t.id !== tid).id }, { ...d, enrichment: { ok: true, transaction_id: tid, charge_date: '2026-04-02' } }]) {
        assert.notEqual(commitFailure(scope, s, changed).status, 0); assert.equal(frozen(), before);
      }
      for (const commandChange of [{ expected_revision: '999' }, { action: 'separate' }, { expected_candidate_fingerprints: {} }]) {
        const forged = { ...scope, command: { ...scope.command, ...commandChange } }, snap = await snapshot(forged);
        assert.notEqual(commitFailure(forged, snap, d).status, 0); assert.equal(frozen(), before);
      }
      env.sql(`CREATE FUNCTION fx_fail_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic atomic failure'; END $$;
        CREATE TRIGGER fx_fail_event BEFORE INSERT ON transaction_reconciliation_events FOR EACH ROW EXECUTE FUNCTION fx_fail_event();`);
      const failed = commitFailure(scope, s, d); assert.notEqual(failed.status, 0); assert.match(failed.stderr, /synthetic atomic failure/); assert.equal(frozen(), before);
      const postFailure = await post(item('atomic-refund', { type: 'refund', amount: 4.29, date: '2026-09-09' }));
      assert.equal(postFailure.status, 503); assert.equal(env.sql("SELECT count(*) FROM transactions WHERE external_id='atomic-refund';"), '0');
      assert.equal(env.sql("SELECT count(*) FROM transaction_source_observations WHERE idempotency_key='atomic-refund';"), '0');
      env.sql('DROP TRIGGER fx_fail_event ON transaction_reconciliation_events;');
      env.sql(`INSERT INTO transaction_items(transaction_id,item_name) VALUES(${tid},'Concurrent linked item');`);
      const stale = commitFailure(scope, s, d); assert.notEqual(stale.status, 0); assert.match(stale.stderr, /40001.*stale_ingestion_snapshot/);
      const protectedScope = await snapshot(scope), forged = { ...d, revision: protectedScope.facts.observations.find(o => o.id === held.observation_id).decision_revision };
      assert.notEqual(commitFailure(scope, protectedScope, forged).status, 0);
      assert.equal(env.sql(`SELECT transaction_id IS NULL FROM transaction_source_observations WHERE id=${held.observation_id};`), 't');
    });

    await t.test('concurrent Single/Bulk retries create one credit, never an automatic FX link', async () => {
      const request = item('concurrent-fx-refund', { type: 'refund', amount: 2.31, date: '2026-09-10' }), before = count();
      const results = await Promise.all([post(request), post({ items: [request] })]);
      assert.ok(results.every(r => [200, 201, 409].includes(r.status)), JSON.stringify(results));
      assert.equal(count(), before + 1);
      assert.equal(env.sql("SELECT count(*) FROM transactions WHERE external_id='concurrent-fx-refund' AND total_amount=-2.31 AND original_amount=35.12 AND exchange_rate IS NULL;"), '1');
      const sid = await configure(), held = await observe(sid, 'no-auto-fx', { accounting_amount: '137.29' });
      assert.equal(held.transaction_id, null); assert.equal(held.review_required, true);
    });

    await t.test('linked domains, voids and closed-budget history remain protected in HTTP and private persistence', async () => {
      const ordinary = await post(item('void-target', { amount: 178, currency: 'ILS', original_amount: undefined }));
      assert.equal(ordinary.status, 201, JSON.stringify(ordinary));
      const os = await snapshot({ command: { transaction_id: ordinary.body.transaction_id } });
      const cancelled = await core.command(db, 'cancel', randomUUID(), { transaction_id: ordinary.body.transaction_id,
        expected_revision: ordinary.body.decision_revision, expected_transaction_fingerprint: os.facts.transactions.find(t => t.id === ordinary.body.transaction_id).cash_fingerprint,
        actor: 'owner:synthetic', reason: 'Synthetic ordinary cancellation' });
      assert.equal(cancelled.disposition, 'cancelled');
      const voidSource = await configure(), voidHeld = await observe(voidSource, 'void-held', { accounting_amount: '178.00' });
      const vr = await review(voidHeld.observation_id, ordinary.body.transaction_id), voidBefore = cash(ordinary.body.transaction_id);
      assert.equal(vr.candidate.can_link, false); assert.equal((await resolve(voidHeld.observation_id, vr.command)).status, 422);
      assert.equal(cash(ordinary.body.transaction_id), voidBefore);

      env.sql("INSERT INTO loans(id,name,original_amount,current_balance,monthly_payment,total_installments,remaining_installments,start_date,next_payment_date) VALUES(1,'Synthetic FX loan',1000,1000,100,10,10,'2026-04-01','2026-05-01');");
      env.sql("INSERT INTO shopping_list_types(name,slug) VALUES('Synthetic protected shopping','fx-protected-shopping');");
      const protections = {
        loan: id => `UPDATE transactions SET loan_id=1 WHERE id=${id};`,
        installment: id => `UPDATE transactions SET installment_count=3,installment_number=1,installments_info='1/3' WHERE id=${id};`,
        parent: id => `UPDATE transactions SET parent_transaction_id=1 WHERE id=${id};`,
        child: id => `INSERT INTO transactions(description,movement_type,total_amount,transaction_date,parent_transaction_id) VALUES('Child','expense',1,'2026-04-03',${id});`,
        item: id => `INSERT INTO transaction_items(transaction_id,item_name) VALUES(${id},'Protected item');`,
        lego: id => `INSERT INTO lego_sets(set_number,name,transaction_id) VALUES('synthetic','Protected LEGO',${id});`,
        shopping: id => `WITH list AS (INSERT INTO shopping_lists(title,list_type_id) SELECT 'Protected Shopping',id FROM shopping_list_types ORDER BY id LIMIT 1 RETURNING id)
          INSERT INTO shopping_checkouts(list_id,total_amount,transaction_id) SELECT id,1,${id} FROM list;`,
        loan_payment: id => `INSERT INTO loan_payments(loan_id,transaction_id,payment_date,payment_amount,principal_amount,interest_amount,source_kind,payment_kind,installments_covered)
          VALUES(1,${id},'2026-04-03',1,1,0,'manual','irregular_payment',0);`,
        discount: id => `UPDATE transactions SET global_discount=1 WHERE id=${id};`,
      };
      let amount = 160;
      for (const [kind, protect] of Object.entries(protections)) {
        const tid = target(++amount), sid = await configure(), held = await observe(sid, `protect-${kind}`, { accounting_amount: `${amount}.00` });
        // Fixture writes follow the application's cash-before-domain lock order,
        // including while a transport retry is finishing on another connection.
        env.sql(`BEGIN; LOCK TABLE transactions IN EXCLUSIVE MODE; ${protect(tid)} COMMIT;`);
        const r = await review(held.observation_id, tid), before = cash(tid); assert.equal(r.candidate.can_link, false, kind);
        assert.equal((await resolve(held.observation_id, r.command)).status, 422, kind); assert.equal(cash(tid), before);
        const { request_key, ...cmd } = r.command;
        const scope = { command_kind: 'resolve', request_key, review: true, command: { ...cmd, observation_id: held.observation_id, actor: 'owner:synthetic', reason: 'forged protected link' } };
        const s = await snapshot(scope), d = { action: 'link', observation_id: held.observation_id, revision: cmd.expected_revision, target: tid, enrichment: null, reason: 'owner_link' };
        const failed = env.sqlFailure(`SET ROLE service_role; SELECT ingestion_core_commit(${quote(scope)},${quote(s.token)},${quote(d)});`);
        assert.notEqual(failed.status, 0, kind); assert.match(failed.stderr, /inconsistent_link/, kind); assert.equal(cash(tid), before);
      }
      env.sql(`SELECT create_savings_account(${quote(randomUUID())},'{"name":"Synthetic protected savings","opened_on":"2026-01-01","tracking_start_date":"2026-01-01"}','0','0',NULL);`);
      const account = JSON.parse(env.sql('SELECT to_jsonb(a) FROM savings_accounts a ORDER BY id DESC LIMIT 1;'));
      const savings = JSON.parse(env.sql(`SELECT post_savings_event(${quote(randomUUID())},${quote({ action: 'create_cash', account_id: String(account.id),
        expected_revision: String(account.revision), event_kind: 'deposit', amount: '176.00', effective_date: '2026-04-03', charge_date: '2026-04-10',
        description: 'Protected savings deposit', category_id: env.sql("SELECT id FROM categories WHERE savings_role='deposit';"), payment_source_id: '6' })});`));
      const savingsSource = await configure(), savingsHeld = await observe(savingsSource, 'savings-held', { accounting_amount: '176.00' });
      const sr = await review(savingsHeld.observation_id, savings.transaction_id), savingsBefore = cash(savings.transaction_id);
      assert.equal(sr.candidate.can_link, false); assert.equal((await resolve(savingsHeld.observation_id, sr.command)).status, 422);
      assert.equal(cash(savings.transaction_id), savingsBefore);
      const tid = target(175), sid = await configure(), held = await observe(sid, 'closed-budget', { accounting_amount: '175.00' });
      env.sql(`INSERT INTO budget_months(month_start) VALUES('2026-04-01');
        INSERT INTO budget_operations(budget_month_id,request_key,request_fingerprint,operation_type,effective_date)
        SELECT id,${quote(randomUUID())},'synthetic-close','month_close','2026-04-30' FROM budget_months WHERE month_start='2026-04-01';`);
      const r = await review(held.observation_id, tid), before = cash(tid); assert.equal(r.candidate.can_link, false);
      assert.equal((await resolve(held.observation_id, r.command)).status, 422); assert.equal(cash(tid), before);
      const unauthorized = await fetch(`${env.apiUrl}/reconciliation/observation/${held.observation_id}/resolve`, { method: 'POST',
        headers: { Authorization: 'Bearer synthetic-refund-external', 'Content-Type': 'application/json' }, body: JSON.stringify(r.command) });
      assert.equal(unauthorized.status, 401);
    });
  } finally { await env.stop(); }
});
