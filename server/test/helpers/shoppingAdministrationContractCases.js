'use strict';
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { catalogHttpResponse } = require('../../modules/shopping/shared/catalogResponse');
const { publicIntent, createCatalogCommands } = require('../../modules/shopping/shared/catalogCommands');
const { createRepository } = require('../../modules/shopping/shared/repository');
const { createPersistence } = require('../../modules/shopping/shared/persistence');

module.exports = function register({test,assert,sql,json,execute,prepared,commit,category,product,actor,otherActor,q,rejects,preserved,getClient,getEnv,getHistory}) {
 const facts=()=>sql("SELECT jsonb_build_object('facts',shopping_private.catalog_facts(),'commands',(SELECT jsonb_agg(to_jsonb(c) ORDER BY actor,request_key) FROM shopping_private.commands c));");
 const row=id=>json(`SELECT to_jsonb(p)||jsonb_build_object('id',id::text,'category_id',category_id::text,'revision',revision::text,'default_price',default_price::text) FROM shopping_catalog_items p WHERE id=${id};`);
 const svc=(allow=true)=>createCatalogCommands({repository:createRepository(getClient()),persistence:createPersistence(getClient()),authorize:async()=>allow});
 const replay=(op,id,body,key,who=actor)=>svc().execute({user:{id:who},headers:{'Idempotency-Key':key},body},op,id);
 const response=(commit,op,id,body)=>catalogHttpResponse(commit,publicIntent(op,id,body));
 async function scenario(op) {
  const a=await category(),b=await category();
  if(op==='category.create') return {id:null,body:{name:'Linked '+randomUUID(),parent_id:a,list_type_id:1},later:r=>execute('category.edit',{icon:'later'},r.result.id)};
  if(op==='product.create')return {id:null,body:{name:'New '+randomUUID(),category_id:a,default_price:0},later:r=>execute('product.edit',{name:'Later '+randomUUID()},r.result.id)};
  if(op==='branches.replace')return {id:'1',body:{categoryIds:[a,b]},later:()=>execute(op,{categoryIds:[b]},'1')};
  const id=await product(a);
  if(op==='product.bulk-category')return {id:null,body:{product_ids:[id,await product(a)],category_id:b},later:()=>execute('product.edit',{default_price:4},id)};
  if(op==='product.deactivate')return {id,body:{},later:()=>execute('product.edit',{is_active:true},id)};
  return {id,body:{name:'Edit '+randomUUID(),category_id:b,default_unit:null,default_price:'0.0000'},later:()=>execute(op,{default_price:7},id)};
 }
 const operations=['product.create','product.edit','product.deactivate','product.bulk-category','branches.replace','category.create'];
 for(const op of operations) test(`062 ${op}: exact durable status/body/ETag survives later mutation; conflicts have zero effects`,async()=>{
  const s=await scenario(op),key=randomUUID(),first=await execute(op,s.body,s.id,key),http=response(first,op,s.id,s.body);
  assert.equal(http.status,op.endsWith('.create')?201:200);
  if(op.startsWith('product.')&&op!=='product.bulk-category')assert.deepEqual(http.body,row(first.result.id));
  if(op==='branches.replace')assert.deepEqual(http.body,{linked:2});
  const tokenOp=op==='category.create'?'category.edit':op.startsWith('product.')&&op!=='product.bulk-category'?'product.edit':op;
  const tokenId=op==='product.bulk-category'?null:s.id??first.result.id;
  const snap=await createRepository(getClient()).readCatalog({actor,operation:tokenOp,id:tokenId,productIds:s.body.product_ids||[]});
  assert.equal(http.headers.ETag,snap.etag);
  const ledger=json(`SELECT to_jsonb(c) FROM shopping_private.commands c WHERE actor=${q(actor)} AND request_key=${q(key)};`);
  assert.match(ledger.request_hash,/^[a-f0-9]{64}$/);assert.deepEqual(ledger.result,http.body);assert.deepEqual(ledger.http,first.http);
  await s.later(first);const before=facts();
  const repeated=await replay(op,s.id,s.body,key);assert.equal(repeated.replayed,true);assert.deepEqual(response(repeated,op,s.id,s.body),http);assert.equal(facts(),before);
  const different=op==='product.deactivate'?{...publicIntent(op,s.id,s.body),operation:'product.edit',body:{is_active:false}}:
   publicIntent(op,s.id,op==='product.bulk-category'?{...s.body,category_id:-1}:op==='branches.replace'?{categoryIds:[]}:{...s.body,name:'Different'});
  await rejects(replay(different.operation,different.id,different.body,key),'shopping_key_conflict');assert.equal(facts(),before);
 });
 for(const op of operations) test(`062 ${op}: simultaneous same-key requests commit once`,async()=>{
  const s=await scenario(op),key=randomUUID(),plan=await prepared(op,s.body,s.id,actor,key),before=sql('SELECT revision FROM shopping_private.catalog_state;');
  const results=await Promise.all([commit(plan),commit(plan)]);
  assert.deepEqual(results.map(r=>r.replayed).sort(),[false,true]);assert.deepEqual(response(results[0],op,s.id,s.body),response(results[1],op,s.id,s.body));
  assert.equal(sql('SELECT revision FROM shopping_private.catalog_state;'),String(BigInt(before)+1n));
  assert.equal(sql(`SELECT count(*) FROM shopping_private.commands WHERE request_key=${q(key)};`),'1');
 });
 test('062 equivalent wire IDs, unordered selections and numeric prices replay consistently in JS and SQL',async()=>{
  const a=await category(),b=await category(),p=await product(a),key=randomUUID(),body={category_id:Number(b),default_price:0};
  const first=await execute('product.edit',body,p,key),equivalent={default_price:'000.000',category_id:b};
  assert.deepEqual(response(await replay('product.edit',p,equivalent,key),'product.edit',p,equivalent),response(first,'product.edit',p,body));
  const raw=json(`SELECT shopping_catalog_commit(${q(actor)},${q(key)},${q(publicIntent('product.edit',p,equivalent))},'{}','{}');`);
  assert.deepEqual(raw.http,first.http);assert.deepEqual(raw.result,first.result);
  const k=randomUUID(),original={categoryIds:[Number(a),Number(b)]},reordered={categoryIds:[b,a]};
  const branch=await execute('branches.replace',original,'1',k);
  assert.deepEqual((await replay('branches.replace','1',reordered,k)).result,branch.result);
  assert.equal(json(`SELECT shopping_catalog_commit(${q(actor)},${q(k)},${q(publicIntent('branches.replace','1',reordered))},'{}','{}');`).replayed,true);
 });
 test('062 product omission/null/zero, stable identity, historical restriction and uniqueness',async()=>{
  const a=await category(),b=await category(),id=await product(a),original=row(id);
  const r=await execute('product.edit',{default_unit:'unit',default_price:0},id);assert.equal(r.result.default_price,'0');
  await execute('product.edit',{name:'Preserve '+randomUUID()},id);assert.equal(row(id).default_unit,'unit');assert.equal(row(id).default_price,'0');
  await execute('product.edit',{default_unit:null,default_price:null},id);assert.equal(row(id).default_price,null);assert.equal(row(id).default_unit,null);
  assert.equal(row(id).id,original.id);assert.equal(row(id).created_at,original.created_at);
  const other=await product(b);await execute('product.edit',{name:row(id).name},other);let before=facts();
  await rejects(execute('product.edit',{category_id:b,default_price:99},id),'shopping_product_collision');assert.equal(facts(),before);
  const historical=sql('SELECT id FROM shopping_catalog_categories WHERE NOT is_active ORDER BY id LIMIT 1;');
  await rejects(execute('product.edit',{category_id:historical},id),'shopping_category_unavailable');assert.equal(facts(),before);
  await execute('product.edit',{category_id:-1},id);assert.equal(row(id).category_id,'-1');
  const key=randomUUID();await execute('product.edit',{name:'Null identity '+key},id,key);before=facts();
  await rejects(replay('product.edit',id,{name:'Null identity '+key,default_unit:null},key),'shopping_key_conflict');assert.equal(facts(),before);
 });
 test('062 bulk 100 full response, equivalent-order replay, invalid 101 and missing member roll back',async()=>{
  const a=await category(),b=await category();sql(`INSERT INTO shopping_catalog_items(name,category_id) SELECT '062 batch '||i,${a} FROM generate_series(1,100)i;`);
  const ids=json(`SELECT jsonb_agg(id::text ORDER BY id) FROM shopping_catalog_items WHERE category_id=${a};`),key=randomUUID(),body={product_ids:ids,category_id:b};
  const before=facts();await rejects(execute('product.bulk-category',{...body,product_ids:[...ids.slice(0,99),'9223372036854775807']}),'shopping_product_missing');assert.equal(facts(),before);
  await rejects(execute('product.bulk-category',{...body,product_ids:[...ids,'9223372036854775807']}),'shopping_input_invalid');assert.equal(facts(),before);
  const result=await execute('product.bulk-category',body,null,key);assert.equal(result.result.updated,100);assert.deepEqual(result.result.product_ids,ids);
  assert.equal(sql(`SELECT count(*) FROM shopping_catalog_items WHERE category_id=${b};`),'100');
  await execute('product.edit',{default_unit:'later'},ids[0]);
  assert.deepEqual(response(await replay('product.bulk-category',null,{...body,product_ids:[...ids].reverse()},key),'product.bulk-category',null,body),response(result,'product.bulk-category',null,body));
 });
 test('062 branch overlap inherits descendants once; concurrent updates reject stale loser',async()=>{
  const a=await category(),b=await category(a),p=await product(b);
  await execute('branches.replace',{categoryIds:[a,b]},'1');
  const v=(await svc().read({user:{id:actor}})).visibility.forListType('1');assert.equal(v.product_ids.filter(x=>x===p).length,1);assert(v.category_ids.includes('-1'));
  const plans=await Promise.all([prepared('branches.replace',{categoryIds:[a]},'1'),prepared('branches.replace',{categoryIds:[b]},'1')]);
  const results=await Promise.allSettled(plans.map(commit));assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.code,'shopping_revision_stale');
 });
 test('062 initial category link advances type revision once; missing/failed link rolls back category and ledger',async()=>{
  const parent=await category(),rev=sql('SELECT revision FROM shopping_list_types WHERE id=1;');
  const first=await execute('category.create',{name:'Composite '+randomUUID(),parent_id:parent,list_type_id:1});
  assert.equal(sql(`SELECT count(*) FROM shopping_catalog_category_list_types WHERE list_type_id=1 AND category_id=${first.result.id};`),'1');
  assert.equal(sql('SELECT revision FROM shopping_list_types WHERE id=1;'),String(BigInt(rev)+1n));
  let before=facts();await rejects(execute('category.create',{name:'Missing link',parent_id:parent,list_type_id:'9223372036854775807'}),'shopping_list_type_missing');assert.equal(facts(),before);
  const plan=await prepared('category.create',{name:'Fail link '+randomUUID(),parent_id:parent,list_type_id:1});
  sql("CREATE FUNCTION shopping_private.link_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic link failure' USING ERRCODE='23514'; END $$; CREATE TRIGGER link_failure BEFORE INSERT ON shopping_catalog_category_list_types FOR EACH ROW EXECUTE FUNCTION shopping_private.link_failure();");
  try{await assert.rejects(commit(plan));}finally{sql('DROP TRIGGER link_failure ON shopping_catalog_category_list_types; DROP FUNCTION shopping_private.link_failure();');}
  assert.equal(facts(),before);
 });
 test('062 every mutation family enforces authorizer and actor/operation-scoped revisions',async()=>{
  for(const op of operations){
   const s=await scenario(op),plan=await prepared(op,s.body,s.id),before=facts();
   await rejects(svc(false).execute({user:{id:actor},headers:{},body:s.body},op,s.id),'shopping_forbidden');
   await rejects(svc().execute({headers:{},body:s.body},op,s.id),'shopping_unauthenticated');
   assert.equal((await getClient().rpc('shopping_catalog_commit',{...plan,p_actor:otherActor})).error.message,'shopping_revision_stale');
   assert.equal((await getClient().rpc('shopping_catalog_commit',{...plan,p_expected:{...plan.p_expected,token:'forged'}})).error.message,'shopping_revision_stale');
   assert.equal(facts(),before);
  }
  assert.equal(sql("SELECT has_function_privilege('service_role','shopping_private.command_identity(jsonb)','EXECUTE');"),'f');
 });
 test('062 database lock timeout becomes bounded busy with no partial writes',async()=>{
  const a=await category(),p=await product(a),plan=await prepared('product.edit',{default_price:3},p),before=facts();getEnv().guard();
  const child=spawn('docker',['exec','-i',getEnv().db,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1']);
  const locked=new Promise((resolve,reject)=>{child.stdout.on('data',b=>{if(String(b).includes('locked'))resolve();});child.on('error',reject);});
  const ended=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code?reject(Error('lock probe failed')):resolve());});
  child.stdin.end("BEGIN; SELECT revision FROM shopping_private.catalog_state FOR UPDATE; SELECT 'locked'; SELECT pg_sleep(4); COMMIT;");
  await locked;await rejects(commit(plan),'shopping_busy');await ended;assert.equal(facts(),before);
 });
 for(const type of ['rename','reparent','activate','deactivate','delete']) test(`062 category ${type}: lifecycle/reparent original response replays after later edit`,async()=>{
  const id=await category(),parent=await category(),key=randomUUID();
  const body=type==='rename'?{type,name:'Lifecycle '+key}:type==='reparent'?{type,parent_id:parent}:{type};
  const first=await execute('category.change',body,id,key),http=response(first,'category.change',id,body);
  assert.equal(http.status,200);assert.equal(http.body.id,id);
  if(type==='reparent')assert.equal(http.body.parent_id,parent);
  if(type==='deactivate'||type==='delete')assert.equal(http.body.is_active,false);
  await execute('category.edit',{icon:'later'},id);const before=facts();
  assert.deepEqual(response(await replay('category.change',id,body,key),'category.change',id,body),http);assert.equal(facts(),before);
 });
 test('062 restart and restored backup replay every recorded application response exactly',async()=>{
  const records=json("SELECT jsonb_agg(to_jsonb(c) ORDER BY actor,request_key) FROM shopping_private.commands c WHERE http IS NOT NULL;");
  const before=facts();await getEnv().restart();assert.equal(facts(),before);
  // Materialize only synthetic command inputs as owner, then execute each replay
  // with the real service role. One psql session avoids per-row Docker overhead.
  const replayAll=database=>{
   const values=records.map(r=>`(${q(r.actor)}::uuid,${q(r.request_key)}::uuid,${q(r.intent)}::jsonb)`).join(',');
   const replies=json(`SET ROLE service_role; SELECT jsonb_agg(shopping_catalog_commit(actor,key,intent,'{}','{}') ORDER BY actor,key) FROM (VALUES ${values}) x(actor,key,intent);`,database);
   replies.forEach((got,i)=>{assert.equal(got.replayed,true);assert.deepEqual(got.result,records[i].result);assert.deepEqual(got.http,records[i].http);});
  };
  replayAll();
  assert.equal(facts(),before);const backup=getEnv().backup();sql('CREATE DATABASE restore_test;');
  try{
   sql(backup,'restore_test');
   replayAll('restore_test');
   assert.equal(sql("SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY actor,request_key),'[]') FROM shopping_private.commands c;",'restore_test'),sql("SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY actor,request_key),'[]') FROM shopping_private.commands c;"));
   assert.equal(preserved('restore_test'),getHistory());
  }finally{sql('DROP DATABASE restore_test;');}
  assert.equal(preserved(),getHistory());assert.equal(sql('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database();'),'0');
 });
};
