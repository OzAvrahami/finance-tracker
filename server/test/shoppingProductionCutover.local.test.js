'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const express = require('express');
const { createIsolatedDatabase } = require('./helpers/shoppingIsolatedDatabase');
const { seed } = require('./helpers/shoppingProductionSeed');
const { buildBundle, fenceSql, fingerprint, sources, quote, check } = require('../scripts/shoppingProductionBundle');
const ledger = [{ version:'20261109184027', name:'059_manual_owner_refunds' }];

test('production derivation: guarded full migration, exact preservation and transactional failure recovery', async t => {
  const env = await createIsolatedDatabase();
  try {
    const sql = s => env.sql(s).stdout.trim();
    sql(fs.readFileSync(path.join(__dirname,'../full_schema.sql'),'utf8'));
    const mappingSql = seed(env);
    sql("CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]); INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES('20261109184027','059_manual_owner_refunds');");
    const tables = JSON.parse(sql("SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'shopping_%';"));
    const baseline = tables.map(name=>({ name, count:Number(sql(`SELECT count(*) FROM public.${name}`)), hash:sql('SELECT '+fingerprint(name)) }));
    const key=randomBytes(32).toString('hex'), systemId=sql('SELECT system_identifier FROM pg_control_system()');
    const options={ targetProject:'ohhvzveyreolguztcnqx',databaseSystemIdentifier:systemId,ownerAuthorization:'issue-102-owner-production-authorized-backup-waived',fenceKey:key,baseline,ledger,mappingSql };
    const snapshot=()=>JSON.parse(sql("SELECT jsonb_build_object('rows',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM shopping_list_items t),'cash',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM transactions t),'seq',(SELECT jsonb_build_array(last_value,is_called) FROM shopping_catalog_categories_id_seq),'ledger',(SELECT jsonb_agg(to_jsonb(t) ORDER BY version) FROM supabase_migrations.schema_migrations t))"));
    const before=snapshot();
    await t.test('missing owner authorization and wrong target fail before SQL',()=>{
      assert.notEqual(env.sql(check('NULL', 'null_guard_rejected'),true).status,0);
      assert.throws(()=>buildBundle({...options,ownerAuthorization:''}));
      assert.throws(()=>buildBundle({...options,targetProject:'foreign'}));
    });
    await t.test('unfenced execution and wrong physical database fail closed',()=>{
      assert.notEqual(env.sql(buildBundle(options),true).status,0);
      assert.notEqual(env.sql(buildBundle({...options,databaseSystemIdentifier:'1111111111111111111'}),true).status,0);
      assert.deepEqual(snapshot(),before);
    });
    sql(fenceSql(tables,key,false,systemId));
    await t.test('legacy direct writes and callback writes are fenced',()=>{
      assert.notEqual(env.sql("SET ROLE service_role; INSERT INTO shopping_lists(title,list_type_id) VALUES('rejected',1)",true).status,0);
      assert.notEqual(env.sql("UPDATE shopping_receipts SET state='failed'",true).status,0);
      assert.deepEqual(snapshot(),before);
    });
    await t.test('unexpected ledger and unexplained data fingerprint reject',()=>{
      assert.notEqual(env.sql(buildBundle({...options,ledger:[{...ledger[0],version:'unexpected'}]}),true).status,0);
      assert.notEqual(env.sql(buildBundle({...options,baseline:baseline.map((r,i)=>i? r:{...r,hash:'0'.repeat(32)})}),true).status,0);
      assert.deepEqual(snapshot(),before);
    });
    await t.test('failure after all four bodies rolls back DDL, rows, ledger AND sequence state',()=>{
      const failed=env.sql(buildBundle({...options,postAssertions:'SELECT 1/0;'}),true);
      assert.notEqual(failed.status,0);assert.match(failed.stderr,/division by zero/);
      assert.equal(sql("SELECT to_regnamespace('shopping_private') IS NULL"),'t');
      assert.deepEqual(snapshot(),before);
    });
    await t.test('successful bounded transaction records four versions and preserves evidence',()=>{
      sql(buildBundle(options));const after=snapshot();
      assert.deepEqual(after.rows,before.rows);assert.deepEqual(after.cash,before.cash);
      assert.equal(after.ledger.length,5);
      assert.deepEqual(after.ledger.slice(1).map(r=>r.version),sources.map(r=>r[2]));
      assert.equal(sql('SELECT count(*) FROM shopping_catalog_categories'),'99');
      assert.equal(sql('SELECT count(*) FROM shopping_catalog_category_list_types'),'21');
      assert.notEqual(env.sql("SET ROLE service_role; INSERT INTO shopping_lists(title) VALUES('still fenced')",true).status,0);
    });
    await t.test('release leaves retired paths denied and narrow persistence available',()=>{
      sql(fenceSql(tables,key,true,systemId));
      assert.notEqual(env.sql("SET ROLE service_role; INSERT INTO shopping_lists(title) VALUES('old writer')",true).status,0);
      assert.equal(sql("SELECT to_regprocedure('shopping_checkout(bigint,bigint,bigint,jsonb)') IS NULL"),'t');
      assert.equal(sql("SELECT has_function_privilege('service_role','shopping_list_commit(uuid,uuid,jsonb,jsonb,jsonb)','EXECUTE')"),'t');
      assert.equal(sql("SELECT has_function_privilege('authenticated','shopping_list_commit(uuid,uuid,jsonb,jsonb,jsonb)','EXECUTE')"),'f');
      sql(fs.readFileSync(path.join(__dirname,'../migrations/20261114152838_shopping_owner_http_read_boundary.sql'),'utf8'));
      assert.notEqual(env.sql('SET ROLE anon; SELECT id FROM shopping_catalog_items LIMIT 1',true).status,0);
      assert.notEqual(env.sql('SET ROLE authenticated; SELECT id FROM shopping_lists LIMIT 1',true).status,0);
      assert.equal(env.sql('SET ROLE service_role; SELECT id FROM shopping_catalog_items LIMIT 1',true).status,0);
      assert.deepEqual(snapshot().cash,before.cash);
    });
  } finally { await env.close(); }
});

test('production HTTP composition uses real Auth, owner scope, revision protocol and no legacy fallback',async()=>{
  const f=await require('./helpers/shoppingWorkflowFixture').createWorkflowFixture();let server;
  try {
    const environment={ NODE_ENV:'production',SHOPPING_PRODUCTION_MODE:'active',SHOPPING_PRODUCTION_PROJECT:'ohhvzveyreolguztcnqx',SUPABASE_URL:'https://ohhvzveyreolguztcnqx.supabase.co',FLOWLINK_OWNER_USER_IDS:JSON.stringify([f.users[0].id]),SHOPPING_HISTORICAL_CATEGORY_IDS:f.historical.join(',') };
    const app=express();app.use(require('../middleware/requireUser').createRequireAuth(f.client));
    app.use('/api',require('../modules/shopping/http/productionRouter').createProductionRouter({supabase:f.client,environment}));
    app.get('/api/financial-probe',(req,res)=>res.json({available:true}));
    server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
    const base=`http://127.0.0.1:${server.address().port}/api`;
    const get=(p,user=0)=>fetch(base+p,{headers:{Authorization:'Bearer '+f.users[user].token}});
    assert.equal((await get('/shopping/lists')).status,200);
    assert.equal((await get('/shopping/lists',1)).status,403);
    assert.equal((await get('/Settings/Shopping/catalog-items',1)).status,403);
    assert.equal((await get('/shopping/category-tree?include_inactive=true')).status,200);
    assert.equal((await get('/settings/shopping/catalog-items?activity=all')).status,200);
    assert.equal((await get('/financial-probe')).status,200);
    const oversized = express();
    oversized.use(express.json({ limit:'2mb', verify:(req,res,bytes)=>{req.transactionBodyBytes=bytes.length;} }));
    oversized.use(require('../modules/shopping/http/productionRouter').createProductionRouter({supabase:f.client,environment}));
    const largeServer=await new Promise(r=>{const s=oversized.listen(0,'127.0.0.1',()=>r(s));});
    try { assert.equal((await fetch(`http://127.0.0.1:${largeServer.address().port}/settings/shopping/catalog-items`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'x'.repeat(65536)})})).status,413); }
    finally { await new Promise(r=>largeServer.close(r)); }
    assert.equal((await fetch(base+'/shopping/lists',{method:'POST',headers:{Authorization:'Bearer '+f.users[0].token,'Content-Type':'application/json'},body:'{}'})).status,426);
    const created=await fetch(base+'/shopping/lists',{method:'POST',headers:{Authorization:'Bearer '+f.users[0].token,'Content-Type':'application/json','X-Shopping-Contract':'hierarchy-v1','Idempotency-Key':require('crypto').randomUUID()},body:JSON.stringify({title:'Synthetic production composition',list_type_id:1})});
    assert.equal(created.status,201,await created.clone().text());
    assert.equal(f.sql("SELECT count(*) FROM shopping_lists WHERE title='Synthetic production composition'"),'1');
    environment.SHOPPING_PRODUCTION_MODE='fenced';
    assert.equal((await get('/shopping/lists')).status,503);
    assert.equal((await get('/financial-probe')).status,200);
  } finally { if(server)await new Promise(r=>server.close(r));await f.close(); }
});
