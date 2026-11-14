// Run explicitly: node --test server/test/manualRefundPostgres.local.test.js
// Docker required. Set REFUND_PLAYWRIGHT to the installed playwright module path
// to include Chromium form -> authenticated HTTP -> PostgreSQL verification.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./helpers/refundEnvironment');
const { createClient } = require('@supabase/supabase-js');
const { submitExternal } = require('../services/unifiedTransactionIngestion');
const core = require('../services/ingestion/core');
const { randomUUID } = require('node:crypto');
const body = (description, payment = 7, amount = '-557.55', extra = {}) => ({ transaction: {
  description, movement_type:'expense', total_amount:amount, category_id:100, payment_source_id:payment,
  transaction_date:'2026-11-09',charge_date:'2026-11-10',currency:'ILS',installment_count:null, ...extra,
}, items:[] });

test('manual owner refunds: real authenticated saves, reloads, evidence, guards and native form validity', async t => {
  const env = await start({ baseline:true, browser:Boolean(process.env.REFUND_PLAYWRIGHT) });
  let browser;
  try {
    const migration = fs.readFileSync(path.join(__dirname,'../migrations/059_manual_owner_refunds.sql'),'utf8');
    const before = env.sql('SELECT count(*) FROM transactions;');
    const grants=()=>env.sql("SELECT jsonb_object_agg(proname,proacl::text) FROM pg_proc WHERE proname IN ('ingestion_core_post','ingestion_core_apply','ingestion_core_commit','update_transaction_with_manual_loan_payment');");
    const oldGrants=grants();
    env.sql(migration);
    assert.equal(env.sql('SELECT count(*) FROM transactions;'),before);
    assert.equal(grants(),oldGrants);
    assert.ok(fs.readFileSync(path.join(__dirname,'../full_schema.sql'),'utf8').endsWith(migration));
    const db = createClient(env.url,env.service);
    const read = async id => { const r=await env.api(`/transactions/${id}`); assert.equal(r.status,200,JSON.stringify(r)); return r.body; };
    const check = async id => {
      const row=await read(id);
      assert.equal(row.movement_type,'expense'); assert.equal(row.bank_movement,'refund');
      assert.equal(Number(row.total_amount),-557.55); assert.equal(row.installment_count,null); assert.equal(row.installment_number,null);
      assert.equal(env.sql(`SELECT total_amount=-557.55 FROM transactions WHERE id=${id};`),'t'); return row;
    };
    await t.test('authentication and all applicable payment methods',async()=>{
      assert.equal((await fetch(`${env.apiUrl}/transactions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body('Unauthorized'))})).status,401);
      for (const payment of [6,7,14,15,16,17]) {
        const r=await env.api('/transactions',body(`Refund source ${payment}`,payment));
        assert.equal(r.status,201,JSON.stringify(r)+'\n'+(r.status===201?'':env.databaseLog())); await check(r.body.id);
      }
      assert.deepEqual(JSON.parse(env.sql("SELECT jsonb_build_object('expense',sum(total_amount) FILTER(WHERE movement_type='expense'),'income',coalesce(sum(total_amount) FILTER(WHERE movement_type='income'),0)) FROM transactions;")),{expense:-3345.3,income:0});
    });
    let importedId;
    await t.test('ordinary imported expense becomes refund without replacing evidence or identity',async()=>{
      const request={type:'expense',amount:557.55,date:'2026-10-10',charge_date:'2026-10-11',description:'Imported ordinary expense',payment_source_id:7,external_id:'synthetic-owner-refund'};
      const r=await submitExternal(db,request); assert.equal(r.status,201,JSON.stringify(r)); importedId=r.body.id;
      const evidence=()=>env.sql(`SELECT accepted_payload::text||payload_fingerprint||initial_identity::text FROM transaction_source_observations WHERE transaction_id=${importedId} AND evidence_origin='source';`);
      const frozen=evidence(), oldEvents=env.sql(`SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM transaction_reconciliation_events e WHERE transaction_id=${importedId};`);
      const old=await read(importedId);
      const result=await env.api(`/transactions/${importedId}`,body(old.description,7,'-557.55',{transaction_date:old.transaction_date,charge_date:old.charge_date,notes:'Owner correction',bank_movement:'untrusted-value'}),'PUT');
      assert.equal(result.status,200,JSON.stringify(result)); const row=await check(importedId);
      assert.equal(String(row.id),String(importedId)); assert.equal(row.external_id,request.external_id);
      assert.equal(row.transaction_date,request.date); assert.equal(row.charge_date,request.charge_date); assert.equal(evidence(),frozen);
      assert.equal(env.sql(`SELECT identity_overridden FROM transaction_source_observations WHERE transaction_id=${importedId} AND evidence_origin='source';`),'t');
      assert.equal(env.sql(`SELECT count(*) FROM transaction_reconciliation_events WHERE transaction_id=${importedId} AND event_kind='user_edit';`),'1');
      const lastOldEvent=JSON.parse(oldEvents).at(-1).id;
      assert.equal(env.sql(`SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM transaction_reconciliation_events e WHERE transaction_id=${importedId} AND id<=${lastOldEvent};`),oldEvents);
      assert.equal((await submitExternal(db,request)).body.transaction_id,String(importedId));
    });
    await t.test('unmarked negative expense and classified refund metadata edits',async()=>{
      const id=env.sql("INSERT INTO transactions(description,movement_type,total_amount,transaction_date,charge_date,payment_source_id,category_id,currency) VALUES('Legacy negative','expense',-557.55,'2026-09-01','2026-09-02',14,100,'ILS') RETURNING id;").split('\n')[0];
      for (const target of [id,importedId]) {
        const old=await read(target);
        const r=await env.api(`/transactions/${target}`,body(old.description,old.payment_source_id,'-557.55',{transaction_date:old.transaction_date,charge_date:old.charge_date,category_id:102,notes:'Reviewed refund notes'}),'PUT');
        assert.equal(r.status,200,JSON.stringify(r)); const row=await check(target);
        assert.equal(Number(row.category_id),102); assert.equal(row.notes,'Reviewed refund notes');
      }
    });
    await t.test('manual refund duplicate review resumes the same evidence after explicit owner approval',async()=>{
      const draft=body('Separate owner refund',14,'-12.34',{transaction_date:'2026-03-01',charge_date:'2026-03-02'});
      assert.equal((await env.api('/transactions',draft)).status,201);
      const held=await env.api('/transactions',draft); assert.equal(held.status,202,JSON.stringify(held));
      const id=held.body.observation_id;
      const {data:snapshot,error}=await db.rpc('ingestion_core_snapshot',{p_scope:{command:{observation_id:id}}}); assert.ifError(error);
      const o=snapshot.facts.observations.find(o=>o.id===id);
      const approved=await core.command(db,'resolve',randomUUID(),{observation_id:id,expected_revision:o.decision_revision,
        expected_candidate_fingerprints:o.review_fingerprints,action:'separate',reason:'Separate synthetic refund confirmed',actor:'owner:synthetic'},true);
      assert.equal(approved.reason_code,'manual_domain_approved',JSON.stringify(approved));
      const resumed=await env.api('/transactions',draft); assert.equal(resumed.status,201,JSON.stringify(resumed));
      assert.equal(env.sql(`SELECT count(*) FROM transactions WHERE description='Separate owner refund';`),'2');
      assert.equal(env.sql(`SELECT transaction_id=${resumed.body.id} FROM transaction_source_observations WHERE id=${id};`),'t');
    });
    await t.test('atomic owner edit rejects changed decisions and stale protected facts',async()=>{
      const id=env.sql("INSERT INTO transactions(description,movement_type,total_amount,transaction_date,payment_source_id,category_id,currency) VALUES('Atomic owner edit','expense',557.55,'2026-02-01',7,100,'ILS') RETURNING id;").split('\n')[0];
      const transaction=require('../services/ingestion/manualRefund').manualRow(body('Atomic owner edit').transaction);
      const scope={command_kind:'owner_refund_edit',command:{transaction_id:id,transaction}};
      const {data:s}=await db.rpc('ingestion_core_snapshot',{p_scope:scope});
      const decision=core.decideCommand(s.facts,scope);
      const bad={...decision,transaction:{...decision.transaction,total_amount:'-1.00'}};
      assert.equal((await db.rpc('ingestion_core_commit',{p_scope:scope,p_token:s.token,p_decision:bad})).error.code,'23514');
      env.sql(`INSERT INTO transaction_items(transaction_id,item_name,quantity,price_per_unit) VALUES(${id},'Concurrent protected item',1,557.55);`);
      // Direct PostgreSQL assertion avoids transport-level retries of SQLSTATE
      // 40001; the production service already bounds its RPC transport.
      const quote=x=>`'${JSON.stringify(x).replaceAll("'","''")}'`;
      const stale=env.sqlFailure(`SET ROLE service_role; SELECT ingestion_core_commit(${quote(scope)},'${s.token}',${quote(decision)});`);
      assert.notEqual(stale.status,0); assert.match(stale.stderr,/40001.*stale_ingestion_snapshot/);
      assert.equal(env.sql(`SELECT total_amount=557.55 AND bank_movement IS NULL FROM transactions WHERE id=${id};`),'t');
    });
    await t.test('exact monetary values and FX provenance survive save/reload',async()=>{
      const exact='-90071992547409.91';
      const r=await env.api('/transactions',body('Exact refund',7,exact,{currency:'USD',original_amount:'123.456789',exchange_rate:'3.123456789'}));
      assert.equal(r.status,201,JSON.stringify(r));
      assert.equal(env.sql(`SELECT total_amount=${exact} AND original_amount=123.456789 AND exchange_rate=3.123456789 AND currency='USD' FROM transactions WHERE id=${r.body.id};`),'t');
      const row=await read(r.body.id);
      assert.equal(row.total_amount.replace(/0+$/,''),exact);
      const edit=await env.api(`/transactions/${r.body.id}`,body('Exact refund',7,exact,{currency:'USD',original_amount:'123.456789',exchange_rate:'3.123456789',notes:'FX unchanged'}),'PUT');
      assert.equal(edit.status,200,JSON.stringify(edit));
      assert.equal(env.sql(`SELECT total_amount=${exact} AND original_amount=123.456789 AND exchange_rate=3.123456789 FROM transactions WHERE id=${r.body.id};`),'t');
    });
    await t.test('ordinary validation and untrusted external acceptance remain constrained',async()=>{
      for (const [amount,extra] of [['0',{}],['-0.00',{}],['-1.001',{}],['-1.00',{movement_type:'income'}],['-1.00',{installment_count:3}],['-1.00',{loan_id:1}]]) {
        assert.equal((await env.api('/transactions',body('Invalid',7,amount,extra))).status,400);
      }
      for (const kind of ['expense','income']) {
        const r=await env.api('/transactions',body(`Ordinary ${kind}`,14,'25.25',{movement_type:kind,category_id:kind==='income'?101:100,bank_movement:'refund'}));
        assert.equal(r.status,201,JSON.stringify(r)); assert.equal((await read(r.body.id)).bank_movement,null);
      }
      const external=await submitExternal(db,{type:'expense',amount:-557.55,date:'2026-11-09',payment_source_id:7}); assert.equal(external.status,400);
      const externalRefund=await submitExternal(db,{type:'refund',amount:11.25,date:'2026-01-03',payment_source_id:7,external_id:'external-refund-compatible'});
      assert.equal(externalRefund.status,201,JSON.stringify(externalRefund));
      const csv=await core.owned(db,'csv',body('CSV negative').transaction,'csv:synthetic:1',{},null); assert.equal(csv.outcome,'rejected');
    });
    await t.test('protected persisted item and installment history cannot be erased by a bare refund edit',async()=>{
      for (const kind of ['item','installment','loan_category','loan_link']) {
        const id=env.sql(`INSERT INTO transactions(description,movement_type,total_amount,transaction_date,payment_source_id,category_id,currency) VALUES('Protected ${kind}','expense',20,'2026-07-01',7,100,'ILS') RETURNING id;`).split('\n')[0];
        if(kind==='item') env.sql(`INSERT INTO transaction_items(transaction_id,item_name,quantity,price_per_unit) VALUES(${id},'Protected item',1,20);`);
        if(kind==='installment') env.sql(`UPDATE transactions SET installment_count=3,installment_number=1,installments_info='1/3' WHERE id=${id};`);
        if(kind==='loan_category') env.sql(`INSERT INTO categories(id,name,type) VALUES(24,'Loan','expense'); UPDATE transactions SET category_id=24 WHERE id=${id};`);
        if(kind==='loan_link') env.sql(`INSERT INTO loans(id,name,original_amount,current_balance,monthly_payment,total_installments,remaining_installments,start_date,next_payment_date) VALUES(1,'Synthetic protected loan',1000,1000,100,10,10,'2026-07-01','2026-08-01'); UPDATE transactions SET loan_id=1 WHERE id=${id};`);
        const frozen=env.sql(`SELECT to_jsonb(t) FROM transactions t WHERE id=${id};`);
        const edit=await env.api(`/transactions/${id}`,body(`Protected ${kind}`,7),'PUT'); assert.equal(edit.status,400,JSON.stringify(edit));
        assert.match(edit.body.error,/היסטוריה מוגנת/); assert.equal(env.sql(`SELECT to_jsonb(t) FROM transactions t WHERE id=${id};`),frozen);
      }
    });
    if (process.env.REFUND_PLAYWRIGHT) await t.test('Chromium normal form creates and edits signed refunds through real HTTP',async()=>{
      const {chromium}=require(process.env.REFUND_PLAYWRIGHT);
      browser=await chromium.launch({channel:'chrome',headless:true}); const page=await browser.newPage();
      await page.addInitScript(({session})=>localStorage.setItem('sb-127-auth-token',JSON.stringify(session)),{session:env.session});
      for(const payment of [7,14]) {
        await page.goto(`${env.frontend}/add`);
        await page.waitForLoadState('networkidle');
        await page.locator('input[name=description]').fill(`Browser refund ${payment}`);
        await page.getByRole('combobox',{name:/קטגוריה/}).fill('Synthetic expense');
        await page.getByRole('option',{name:'Synthetic expense',exact:true}).click();
        await page.locator('select[name=payment_source_id]').selectOption(String(payment));
        await page.locator('input[name=transaction_date]').fill(`2026-05-${String(payment).padStart(2,'0')}`);
        await page.locator('input[name=total_amount]').fill('-557.55');
        const amount=page.locator('input[name=total_amount]');
        assert.equal(await amount.evaluate(e=>e.checkValidity()),true);
        const response=page.waitForResponse(r=>r.url().endsWith('/api/transactions')&&r.request().method()==='POST');
        await page.locator('button[type=submit]').click(); const saved=await response; assert.equal(saved.status(),201,await saved.text());
        const id=(await saved.json()).id; await check(id);
      }
      for(const initial of ['557.55','-557.55']) {
        const id=env.sql(`INSERT INTO transactions(description,movement_type,total_amount,transaction_date,charge_date,payment_source_id,category_id,currency) VALUES('Browser unmarked ${initial}','expense',${initial},'2026-08-01','2026-08-02',7,100,'ILS') RETURNING id;`).split('\n')[0];
        await page.goto(`${env.frontend}/edit-transaction/${id}`); await page.waitForLoadState('networkidle');
        const amount=page.locator('input[name=total_amount]'); await amount.fill('-557.55');
        assert.equal(await amount.evaluate(e=>e.checkValidity()),true);
        await page.locator('[name=notes]').fill('Browser owner notes');
        const invalid=await page.locator('form').evaluate(f=>Array.from(f.elements).filter(e=>e.checkValidity&&!e.checkValidity()).map(e=>({name:e.name,value:e.value,message:e.validationMessage})));
        assert.deepEqual(invalid,[]);
        const response=page.waitForResponse(r=>r.url().endsWith(`/api/transactions/${id}`)&&r.request().method()==='PUT');
        await page.locator('button[type=submit]').click(); const saved=await response; assert.equal(saved.status(),200,await saved.text());
        assert.equal(saved.request().postDataJSON().transaction.total_amount,'-557.55');
        await check(id); await page.goto(`${env.frontend}/edit-transaction/${id}`);
        await page.waitForLoadState('networkidle');
        await page.locator('[name=notes]').waitFor(); assert.equal(await page.locator('[name=notes]').inputValue(),'Browser owner notes');
        await amount.fill('-557.551'); assert.equal(await amount.evaluate(e=>e.checkValidity()),false);
      }
    });
  } finally { await browser?.close(); await env.stop(); }
});
