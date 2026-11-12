'use strict';

const { randomUUID } = require('node:crypto');
const { categoryHttpResponse } = require('../../modules/shopping/categories/categoryResponse');
const { createCatalogCommands } = require('../../modules/shopping/shared/catalogCommands');
const { createRepository } = require('../../modules/shopping/shared/repository');
const { createPersistence } = require('../../modules/shopping/shared/persistence');

// Registers real PostgREST/PostgreSQL cases on the existing guarded disposable fixture.
module.exports = function register({ test, assert, sql, json, execute, prepared, commit, category, actor, otherActor,
  q, rejects, preserved, getClient, getEnv, getHistory }) {
  const row = id => json(`SELECT to_jsonb(c)||jsonb_build_object('id',id::text,'parent_id',parent_id::text,'revision',revision::text) FROM shopping_catalog_categories c WHERE id=${id};`);
  const state = () => sql("SELECT jsonb_build_object('facts',shopping_private.catalog_facts(),'ledger',(SELECT jsonb_agg(to_jsonb(c) ORDER BY actor,request_key) FROM shopping_private.commands c));");
  const service = authorize => createCatalogCommands({ repository: createRepository(getClient()), persistence: createPersistence(getClient()), authorize });
  const request = (body, key, headers = {}) => ({ user: { id: actor }, headers: { 'Idempotency-Key': key, ...headers }, body });

  test('061 category create captures icon, full row, 201 and scoped ETag atomically', async () => {
    const key=randomUUID(),body={name:'Full create '+key,parent_id:null,icon:' \uFEFFbox\u00a0 ',display_order:0};
    const result=await execute('category.create',body,null,key),response=categoryHttpResponse(result),saved=row(result.result.id);
    assert.equal(response.status,201); assert.equal(saved.icon,'box');
    for(const [field,value] of Object.entries(saved)) assert.deepEqual(response.body[field],value);
    assert.deepEqual(response.body.path,[{id:saved.id,name:saved.name}]);
    assert.equal(response.body.effective_active,true);
    assert.equal(response.headers.ETag,(await createRepository(getClient()).readCatalog({actor,operation:'category.edit',id:saved.id})).etag);
    assert.deepEqual(categoryHttpResponse(await service(async()=>true).execute(request(body,key),'category.create')),response);
  });

  for(const [label,patch] of [
    ['name only',()=>({name:'Edited '+randomUUID()})], ['icon only',()=>({icon:' star '})],
    ['parent only',async()=>({parent_id:await category()})], ['activity only',()=>({is_active:false})],
    ['name and icon',()=>({name:'Combined '+randomUUID(),icon:'star'})],
    ['name parent activity icon and ordering',async()=>({name:'All '+randomUUID(),parent_id:await category(),is_active:false,icon:'star',display_order:0})],
  ]) test(`061 ${label}: one revision, unspecified fields preserved`,async()=>{
    const id=await category(),body=await patch(),before=row(id),result=await execute('category.edit',body,id),after=row(id);
    const expected={...before,...body,icon:Object.hasOwn(body,'icon')?body.icon.trim():before.icon,revision:String(BigInt(before.revision)+1n),updated_at:after.updated_at};
    assert.deepEqual(after,expected);const response=categoryHttpResponse(result);assert.equal(response.status,200);
    for(const [field,value] of Object.entries(after))assert.deepEqual(response.body[field],value);
  });

  test('061 null/empty icon clears; omitted icon and zero order are preserved',async()=>{
    const id=await category();await execute('category.edit',{icon:'x',display_order:0},id);
    await execute('category.edit',{name:'Preserved '+randomUUID()},id);assert.equal(row(id).icon,'x');assert.equal(row(id).display_order,0);
    for(const icon of [null,' \uFEFF ']) {await execute('category.edit',{icon},id);assert.equal(row(id).icon,null);}
  });

  test('061 combined final-state validation accepts rename/move without invalid intermediate states',async()=>{
    const a=await category(),b=await category(),id=await category(a);
    await execute('category.create',{name:'Target label',parent_id:a});
    await execute('category.edit',{name:'Target label',parent_id:b,icon:'ok'},id);
    assert.equal(row(id).parent_id,b);assert.equal(row(id).name,'Target label');
  });

  test('061 invalid combined changes leave every field, revision and ledger unchanged',async()=>{
    const id=await category(),child=await category(id),before=state();
    for(const body of [{name:'Would change',parent_id:child,icon:'bad'}, {name:'Would change',is_active:'false'},
      {icon:42},{name:'Would change',display_order:2147483648},{id:'999',name:'Would change'}]) {
      await assert.rejects(execute('category.edit',body,id));assert.equal(state(),before);
    }
  });

  test('061 sibling collisions and direct/indirect cycles reject entire combined edit',async()=>{
    const parent=await category(),a=await category(parent),b=await category(parent),leaf=await category(a),before=state();
    await rejects(execute('category.edit',{name:row(b).name,icon:'bad'},a),'shopping_category_sibling_duplicate');
    await rejects(execute('category.edit',{name:'Cycle',parent_id:leaf,icon:'bad'},a),'shopping_category_cycle');
    await rejects(execute('category.edit',{parent_id:a,icon:'bad'},a),'shopping_category_self_parent');
    assert.equal(state(),before);
  });

  test('061 neutral protections cover icon/order and authorized RPC tampering',async()=>{
    const before=state();await rejects(execute('category.edit',{icon:'bad',display_order:1},-1),'shopping_neutral_protected');
    const snapshot=await createRepository(getClient()).readCatalog({actor,operation:'category.edit',id:'-1'});
    const result=await getClient().rpc('shopping_catalog_commit',{p_actor:actor,p_key:randomUUID(),p_intent:{operation:'category.edit',id:'-1',body:{icon:'bad'}},p_expected:snapshot.expected,
      p_decision:{kind:'category.update',id:'-1',revision:row('-1').revision,changes:{icon:'bad'},response:{path:[{id:'-1',name:'System'}],effective_active:true,counts:{}}}});
    assert(result.error);assert.equal(state(),before);
  });

  test('061 historical/inactive ancestor flags and existing history survive combined edits',async()=>{
    const parent=await category(),id=await category(parent);await execute('category.edit',{is_active:false},parent);
    const result=await execute('category.edit',{name:'Inactive path '+randomUUID(),icon:'x'},id);
    assert.equal(row(id).is_active,true);assert.equal(result.result.effective_active,false);
    await execute('category.edit',{is_active:true},parent);assert.equal(row(id).is_active,true);
    assert.equal(preserved(),getHistory());
  });

  test('061 stale decisions and forged revisions have zero effects',async()=>{
    const id=await category(),plan=await prepared('category.edit',{name:'Stale',icon:'bad'},id);
    await execute('category.edit',{icon:'Current'},id);const before=state();await rejects(commit(plan),'shopping_revision_stale');assert.equal(state(),before);
  });

  test('061 same key replay after later edits preserves exact original status/body/ETag and revisions',async()=>{
    const id=await category(),key=randomUUID(),body={name:'Original '+randomUUID(),icon:'original'};
    const first=await execute('category.edit',body,id,key),http=categoryHttpResponse(first);
    await execute('category.edit',{name:'Newer '+randomUUID(),icon:'newer'},id);const before=state();
    const replay=await service(async()=>true).execute(request(body,key),'category.edit',id);
    assert.equal(replay.replayed,true);assert.deepEqual(categoryHttpResponse(replay),http);assert.equal(state(),before);
    assert.notEqual(row(id).name,http.body.name);assert.equal(replay.catalog_revision,first.catalog_revision);
    const direct=await getClient().rpc('shopping_catalog_commit',{p_actor:actor,p_key:key,p_intent:{operation:'category.edit',id,body},p_expected:{},p_decision:{}});
    assert.equal(direct.error,null);assert.deepEqual(categoryHttpResponse(direct.data),http);assert.equal(state(),before);
    await rejects(service(async()=>true).execute(request({...body,icon:'different'},key),'category.edit',id),'shopping_key_conflict');assert.equal(state(),before);
  });

  test('061 concurrent identical keyed commits execute once and return identical recorded responses',async()=>{
    const id=await category(),key=randomUUID(),body={name:'Concurrent '+randomUUID(),icon:'once'},before=row(id);
    const plan=await prepared('category.edit',body,id,actor,key);
    const results=await Promise.all([commit(plan),commit(plan)]);
    assert.deepEqual(categoryHttpResponse(results[0]),categoryHttpResponse(results[1]));
    assert.deepEqual(results.map(r=>r.replayed).sort(),[false,true]);
    assert.equal(row(id).revision,String(BigInt(before.revision)+1n));
    assert.equal(sql(`SELECT count(*) FROM shopping_private.commands WHERE actor=${q(actor)} AND request_key=${q(key)};`),'1');
  });

  test('061 competing combined edits commit once with stale rejection and no deadlocks',async()=>{
    const id=await category(),plans=await Promise.all([prepared('category.edit',{icon:'A'},id),prepared('category.edit',{icon:'B'},id)]);
    const results=await Promise.allSettled(plans.map(commit));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.find(r=>r.status==='rejected').reason.code,'shopping_revision_stale');
    assert.equal(sql('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database();'),'0');
  });

  test('061 failure after row UPDATE rolls back fields, timestamps, revisions and response ledger',async()=>{
    const id=await category(),plan=await prepared('category.edit',{name:'Rollback '+randomUUID(),icon:'bad'},id),before=state();
    sql(`CREATE FUNCTION shopping_private.category_failure_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure' USING ERRCODE='23514';END $$;
      CREATE TRIGGER category_failure_probe AFTER UPDATE ON shopping_catalog_categories FOR EACH ROW EXECUTE FUNCTION shopping_private.category_failure_probe();`);
    try {await assert.rejects(commit(plan));}finally {sql('DROP TRIGGER category_failure_probe ON shopping_catalog_categories; DROP FUNCTION shopping_private.category_failure_probe();');}
    assert.equal(state(),before);
  });

  test('061 authorization and actor-scoped replay remain enforced',async()=>{
    const id=await category(),key=randomUUID(),body={icon:'private'};await execute('category.edit',body,id,key);const before=state();
    await rejects(service(async()=>false).execute(request(body,key),'category.edit',id),'shopping_forbidden');
    const snap=await createRepository(getClient()).readCatalog({actor:otherActor,operation:'category.edit',id,key});assert.equal(snap.command,null);
    assert.equal(state(),before);assert(getEnv().identity.startsWith('shopping102-'));
  });

  test('061 restored backup replays the recorded combined-edit HTTP result exactly',async()=>{
    const id=await category(),key=randomUUID(),body={name:'Restore '+randomUUID(),icon:'original'},first=await execute('category.edit',body,id,key);
    await execute('category.edit',{icon:'later'},id);const before=state(),backup=getEnv().backup();
    sql('CREATE DATABASE restore_test;');
    try {
      sql(backup,'restore_test');
      const replay=json(`SET ROLE service_role; SELECT shopping_catalog_commit(${q(actor)},${q(key)},${q({operation:'category.edit',id,body})},'{}','{}');`,'restore_test');
      assert.deepEqual(categoryHttpResponse(replay),categoryHttpResponse(first));
      assert.equal(state(),before);
    } finally {sql('DROP DATABASE restore_test;');}
  });
};
