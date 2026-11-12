'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createWorkflowFixture } = require('./helpers/shoppingWorkflowFixture');
let f, receiptRows = [], extractionCalls = 0, providerCalls = 0;
before(async () => { f = await createWorkflowFixture({ extract: async (images, { onProgress }) => {
  extractionCalls++;await onProgress({ stage: 'extracting', completed: 1, total: 1 });
  return { items: receiptRows, identity: { merchant: 'Synthetic shop', receipt_number: randomUUID(), purchase_date: '2026-11-01' } };
}, lookupOptions: { fetchProduct: async code => { providerCalls++;return { status: 'found', product: { code, full_name: 'Synthetic provider result' } }; } } });
const initial=await f.client.rpc('shopping_state',{p_scope:'list',p_ids:{actor:f.users[0].id,operation:'list.read',id:'1',item_id:null}});assert.ifError(initial.error);f.initial=initial.data;
console.log(JSON.stringify({ identity: f.env.identity, endpoint: f.legacyEndpoint, credentials: 'fresh isolated only' })); });
after(async () => { if (f) await f.close(); });
async function request(method, path, body, headers = {}, user = 0) {
  const r = await fetch(f.legacyEndpoint + path, { method, headers: { 'Content-Type': 'application/json', ...(user === null ? {} : { Authorization: `Bearer ${f.users[user].token}` }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json(), etag: r.headers.get('etag') };
}
async function revision(id, operation, itemId) {
  const r = await request('GET', `/lists/${id}?operation=${operation}${itemId ? `&item_id=${itemId}` : ''}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));return r.etag;
}
async function create() {
  const r = await request('POST', '/lists', { title: 'Synthetic workflow', list_type_id: 1 }, { 'Idempotency-Key': randomUUID() });
  assert.equal(r.status, 201, JSON.stringify(r.body));return r.body.id;
}

test('migrated baseline has exact 99/74/25/173/21/85 counts and six effective scopes',()=>{
 const s=f.initial,v=require('../modules/shopping/shared/repository').catalogView(s);
 assert.deepEqual([s.categories.length,s.categories.filter(c=>c.is_active).length,s.categories.filter(c=>!c.is_active).length,s.products.length,s.links.length,s.items.length],[99,74,25,173,21,85]);
 assert.deepEqual(s.listTypes.map(t=>{const scope=v.visibility.forListType(t.id);return[scope.category_ids.length,scope.product_ids.length];}),[[57,144],[11,19],[1,1],[10,21],[9,12],[11,21]]);
});
test('list create, metadata edit and exact replay after later changes', async () => {
  const key = randomUUID(), body = { title: 'Synthetic original', list_type_id: 1, store: 'Synthetic store', target_date: '2026-12-01' };
  const a = await request('POST', '/lists', body, { 'Idempotency-Key': key });assert.equal(a.status, 201, JSON.stringify(a.body));
  const edit = await request('PUT', `/lists/${a.body.id}`, { title: 'Synthetic later' }, { 'If-Match': await revision(a.body.id, 'list.edit'), 'Idempotency-Key': randomUUID() });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));assert.equal(edit.body.revision, '2');
  assert.deepEqual(await request('POST', '/lists', body, { 'Idempotency-Key': key }), a);
  assert.equal((await request('POST', '/lists', { ...body, title: 'different' }, { 'Idempotency-Key': key })).status, 409);
});
test('catalog/custom/name-first appends preserve zero, omission, null and catalog identity', async () => {
  const id = await create();
  const cat = await request('GET', '/catalog-items?list_type_id=1');assert.equal(cat.status, 200);
  const product = cat.body[0];
  for (const body of [{ catalog_item_id: product.id, quantity: 2, price: 0 },
    { custom_name: 'Synthetic reusable', category_id: -1, quantity: 1, price: 0 },
    { entry_mode: 'name_first', custom_name: 'Synthetic list only', quantity: 1, price: null }]) {
    const r = await request('POST', `/lists/${id}/items`, body, { 'Idempotency-Key': randomUUID() });
    assert.equal(r.status, 201, JSON.stringify(r.body));assert.equal(r.body.price, body.price === null ? null : '0');
  }
  assert.equal(f.sql(`SELECT count(*) FROM shopping_list_items WHERE list_id=${id}`), '3');
  assert.equal(f.sql("SELECT count(*) FROM shopping_catalog_items WHERE name='Synthetic list only'"), '0');
  assert.equal(f.sql("SELECT default_price::text FROM shopping_catalog_items WHERE name='Synthetic reusable'"), '0');
});
test('item editing, reversible keyed toggle, stale edits and item removal use one aggregate revision', async () => {
  const id = await create();
  const add = await request('POST', `/lists/${id}/items`, { entry_mode: 'name_first', custom_name: 'Synthetic item' });assert.equal(add.status, 201, JSON.stringify(add.body));
  const itemId = add.body.id, key = randomUUID(), etag = await revision(id, 'item.toggle', itemId);
  const a = await request('PATCH', `/lists/${id}/items/${itemId}/toggle`, {}, { 'If-Match': etag, 'Idempotency-Key': key });
  assert.equal(a.status, 200, JSON.stringify(a.body));assert.equal(a.body.is_purchased, true);assert(a.body.purchased_at);
  assert.deepEqual(await request('PATCH', `/lists/${id}/items/${itemId}/toggle`, {}, { 'Idempotency-Key': key }), a);
  const b = await request('PATCH', `/lists/${id}/items/${itemId}/toggle`, {}, { 'If-Match': await revision(id, 'item.toggle', itemId), 'Idempotency-Key': randomUUID() });
  assert.equal(b.status, 200);assert.equal(b.body.is_purchased, false);assert.equal(b.body.purchased_at, null);
  const stale = await revision(id, 'item.edit', itemId);
  const edit = await request('PUT', `/lists/${id}/items/${itemId}`, { quantity: 3, unit: 'kg', price: 0, notes: 'Synthetic note' }, { 'If-Match': stale });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));assert.equal(edit.body.price, '0');assert.equal(edit.body.quantity, '3');
  assert.equal((await request('PUT', `/lists/${id}/items/${itemId}`, { price: 5 }, { 'If-Match': stale })).status, 409);
  assert.equal((await request('DELETE', `/lists/${id}/items/${itemId}`, {}, { 'If-Match': await revision(id, 'item.remove', itemId) })).status, 200);
  assert.equal(f.sql(`SELECT count(*) FROM shopping_list_items WHERE id=${itemId}`), '0');
});

test('receipt upload/progress/frozen plan/confirmation and checkout preserve exact evidence and one financial effect', async () => {
  const id = await create();
  assert.equal((await request('PUT', `/lists/${id}`, { store: 'Synthetic shop' }, { 'If-Match': await revision(id, 'list.edit') })).status, 200);
  assert.equal((await request('POST', `/lists/${id}/items`, { entry_mode: 'name_first', custom_name: 'Synthetic purchase', quantity: 2, unit: 'unit', price: '7.25' })).status, 201);
  receiptRows = [{ row_id: 'synthetic-row', name: 'Synthetic purchase', quantity: '2', unit: 'unit', price: '7.25', catalog_item_id: null }];
  const image = await require('sharp')({ create: { width: 20, height: 20, channels: 3, background: '#ff1234' } }).png().toBuffer();
  const form = new FormData();form.append('receipt', new Blob([image], { type: 'image/png' }), 'synthetic.png');
  const upload = await fetch(f.legacyEndpoint + `/lists/${id}/receipt`, { method: 'POST', headers: { Authorization: `Bearer ${f.users[0].token}` }, body: form });
  const receipt = await upload.json();assert.equal(upload.status, 200, JSON.stringify(receipt));assert.equal(receipt.state, 'review');assert.equal(extractionCalls, 1);
  const plan = f.sql(`SELECT items FROM shopping_purchase_plans WHERE list_id=${id}`);
  const context = await request('GET', `/lists/${id}/intelligence`);assert.equal(context.status, 200, JSON.stringify(context.body));
  const body = { context_token: context.body.context_token, reviewed: true, extraction_attempt: 1, purchase_date: '2026-11-01', identity: receipt.extracted.identity, items: receiptRows };
  const before = f.sql('SELECT count(*) FROM transactions');
  const confirm = await request('POST', `/lists/${id}/receipt/confirm`, body);assert.equal(confirm.status, 200, JSON.stringify(confirm.body));assert.equal(confirm.body.state, 'confirmed');
  assert.equal(f.sql('SELECT count(*) FROM transactions'), before, 'confirmation cannot post cash');
  assert.equal(f.sql(`SELECT items FROM shopping_purchase_plans WHERE list_id=${id}`), plan);
  assert.deepEqual((await request('POST', `/lists/${id}/receipt/confirm`, body)).body, confirm.body);
  const key = randomUUID(), checkoutHeaders = { 'If-Match': await revision(id, 'checkout'), 'Idempotency-Key': key };
  const paid = await request('POST', `/lists/${id}/checkout`, {}, checkoutHeaders);assert.equal(paid.status, 200, JSON.stringify(paid.body));assert.equal(Number(paid.body.total_amount), 14.5);
  assert.equal(f.sql('SELECT count(*) FROM transactions'), String(Number(before) + 1));
  assert.deepEqual(await request('POST', `/lists/${id}/checkout`, {}, { 'Idempotency-Key': key }), paid);
  const natural = await request('POST', `/lists/${id}/checkout`, {});assert.equal(natural.status, 200, JSON.stringify(natural.body));assert.equal(natural.body.replay, true);
  assert.equal(f.sql('SELECT count(*) FROM transactions'), String(Number(before) + 1));
  assert.equal((await request('POST', `/lists/${id}/items`, { entry_mode: 'name_first', custom_name: 'Cannot alter history' })).status, 409);
});

test('commercial approval/mapping and cache claim/finalize use JavaScript decisions and durable results', async () => {
  const lookup = await request('POST', '/products/lookup', { code: '7290000000008' });assert.equal(lookup.status, 200, JSON.stringify(lookup.body));
  assert.equal(lookup.body.status, 'found');assert.equal(providerCalls, 1);
  assert.equal((await request('POST', '/products/lookup', { code: '7290000000008' })).body.status, 'found');assert.equal(providerCalls, 1);
  const body = { code: '7290000000008', name: 'Synthetic approved product' }, key = randomUUID();
  const approve = await request('POST', '/products/approve', body, { 'If-Match': lookup.etag, 'Idempotency-Key': key });
  assert.equal(approve.status, 200, JSON.stringify(approve.body));assert.equal(approve.body.owner_approved, true);
  const mapped = await request('POST', '/products/map', { ...body, personal_item_id: null, expected_revision: 0, request_key: randomUUID(), receipt_unit: 'unit', planning_unit: null, factor: null });
  assert.equal(mapped.status, 200, JSON.stringify(mapped.body));assert.equal(mapped.body.mapping_revision, 1);
  assert.deepEqual(await request('POST', '/products/approve', body, { 'Idempotency-Key': key }), approve);
});

test('pre-ledger commercial mapping request retains established normalized replay semantics',async()=>{
 const body={code:'7290000000008',name:'Synthetic approved product',personal_item_id:null,expected_revision:0,request_key:randomUUID(),receipt_unit:'unit',planning_unit:null,factor:null};
 const state=await f.client.rpc('shopping_state',{p_scope:'commercial',p_ids:{actor:f.users[0].id,operation:'commercial.read',id:null,target_id:null}});assert.ifError(state.error);
 const commercial=state.data.commercial.find(p=>state.data.identifiers.some(i=>i.code===body.code&&i.commercial_product_id===p.id));assert(commercial);body.expected_revision=commercial.mapping_revision;
 const saved=await request('POST','/products/map',body);assert.equal(saved.status,200,JSON.stringify(saved.body));
 const normalized={...body,kind:'gtin',retailer_scope:'',provider:'open_food_facts',action:'map',planning_unit_code:null};
 f.sql("UPDATE shopping_product_mappings SET request_payload='"+JSON.stringify(normalized).replaceAll("'","''")+"'::jsonb WHERE request_key='"+body.request_key+"'; DELETE FROM shopping_private.commands WHERE request_key='"+body.request_key+"';");
 const replay=await request('POST','/products/map',body);assert.equal(replay.status,200,JSON.stringify(replay.body));assert.equal(replay.body.mapping_revision,saved.body.mapping_revision);
 assert.equal(f.sql("SELECT count(*) FROM shopping_product_mappings WHERE request_key='"+body.request_key+"'"),'1');
 assert.equal((await request('POST','/products/map',{...body,name:'Conflicting request'})).status,409);
});


test('all six hierarchy scopes, intermediate products and historical rows remain correct', async()=>{
 const counts=[57,11,1,10,9,11];for(let i=1;i<=6;i++)assert.equal((await request('GET','/catalog-categories?list_type_id='+i)).body.length,counts[i-1]);
 const history=await request('GET','/lists/1');assert.equal(history.body.shopping_list_items.length,85);
 assert.equal(f.sql('SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM shopping_list_items r WHERE list_id=1;'),f.history);
 const id=await create();const cats=(await request('GET','/catalog-categories?list_type_id=1')).body;
 const nested=cats.find(c=>c.parent_id!==null);assert(nested);
 const r=await request('POST','/lists/'+id+'/items',{entry_mode:'name_first',custom_name:'Nested',category_id:nested.id});assert.equal(r.status,201,JSON.stringify(r.body));
 assert.equal(String(r.body.category_id),String(nested.id));
 assert.equal((await request('POST','/lists/'+id+'/items',{entry_mode:'name_first',custom_name:'Historical forbidden',category_id:20001})).status,409);
});

test('authentication, actor-bound scope tokens and direct RPC/write denial',async()=>{
 const id=await create();assert.equal((await request('GET','/lists/'+id,undefined,{},null)).status,401);
 assert.equal((await request('GET','/lists/'+id,undefined,{},2)).status,403);
 const token=await revision(id,'list.edit');assert.equal((await request('PUT','/lists/'+id,{title:'Other actor'},{'If-Match':token},1)).status,409);
 assert.equal((await request('PUT','/lists/'+id,{title:'Forged'},{'If-Match':'"forged"'})).status,409);
 assert.equal((await request('PUT','/lists/'+id,{title:'No token'})).status,428);
 for(const role of ['anon','authenticated']){
  const h={Authorization:'Bearer '+f.env.token(role), 'Content-Type':'application/json'};
  const write=await fetch(f.rest+'/shopping_list_items',{method:'POST',headers:h,body:JSON.stringify({list_id:id,category_id:-1,custom_name:'denied'})});assert([401,403].includes(write.status));
  for(const primitive of ['shopping_list_commit','shopping_commercial_commit','shopping_receipt_commit','shopping_checkout_commit','shopping_lookup_commit','shopping_catalog_commit']){
   const rpc=await fetch(f.rest+'/rpc/'+primitive,{method:'POST',headers:h,body:JSON.stringify({p_actor:f.users[0].id,p_key:null,p_intent:{},p_expected:{},p_decision:{}})});assert([401,403].includes(rpc.status),primitive);
  }
 }
});

test('concurrent identical toggles apply once; competing edits have one stale loser',async()=>{
 const id=await create(),add=await request('POST','/lists/'+id+'/items',{entry_mode:'name_first',custom_name:'Race'}),item=add.body.id;
 const h={'If-Match':await revision(id,'item.toggle',item),'Idempotency-Key':randomUUID()};
 const results=await Promise.all(Array.from({length:5},()=>request('PATCH','/lists/'+id+'/items/'+item+'/toggle',{},h)));
 results.forEach(r=>assert.deepEqual(r,results[0]));assert.equal(results[0].status,200);
 assert.equal(f.sql('SELECT is_purchased FROM shopping_list_items WHERE id='+item),'t');
 const token=await revision(id,'item.edit',item);
 const raced=await Promise.all([1,2].map(quantity=>request('PUT','/lists/'+id+'/items/'+item,{quantity},{'If-Match':token,'Idempotency-Key':randomUUID()})));
 assert.deepEqual(raced.map(r=>r.status).sort(),[200,409]);
});

test('independent list writes coexist without global Shopping table locks',async()=>{
 const ids=[];for(let i=0;i<12;i++)ids.push(await create());
 const results=await Promise.all(ids.map(id=>request('POST','/lists/'+id+'/items',{entry_mode:'name_first',custom_name:'Parallel list'})));
 results.forEach(r=>assert.equal(r.status,201,JSON.stringify(r.body)));
 assert.equal(f.sql('SELECT count(*) FROM shopping_list_items WHERE list_id IN('+ids.join(',')+')'),'12');
});

test('invalid atomic append rolls back catalog/category/list/ledger changes',async()=>{
 const id=await create(),actor=f.users[0].id;
 const snap=await f.client.rpc('shopping_state',{p_scope:'list',p_ids:{actor,operation:'item.append',id:String(id),item_id:null}});assert.ifError(snap.error);
 const {planList}=require('../modules/shopping/lists/listService');const intent={operation:'item.append',id:String(id),item_id:null,body:{custom_name:'Rollback catalog',category_id:'-1'}};
 const effect=planList(snap.data,intent);effect.values.quantity='invalid';
 const counts=f.sql("SELECT (SELECT count(*) FROM shopping_catalog_items)||'/'||(SELECT count(*) FROM shopping_list_items)||'/'||(SELECT count(*) FROM shopping_private.commands)");
 const result=await f.client.rpc('shopping_list_commit',{p_actor:actor,p_key:randomUUID(),p_intent:intent,p_expected:snap.data.expected,p_decision:effect});assert(result.error);
 assert.equal(f.sql("SELECT (SELECT count(*) FROM shopping_catalog_items)||'/'||(SELECT count(*) FROM shopping_list_items)||'/'||(SELECT count(*) FROM shopping_private.commands)"),counts);
});

test('checkout rejects malformed projections; concurrent retries create one zero-valued cash record',async()=>{
 const id=await create(),add=await request('POST','/lists/'+id+'/items',{entry_mode:'name_first',custom_name:'Zero checkout',quantity:1,price:0});
 await request('PATCH','/lists/'+id+'/items/'+add.body.id+'/toggle',{}, {'If-Match':await revision(id,'item.toggle',add.body.id),'Idempotency-Key':randomUUID()});
 const {createWorkflowCommands}=require('../modules/shopping/shared/workflowCommands');const cmd=createWorkflowCommands({supabase:f.client,authorize:async()=>true});const req={user:{id:f.users[0].id},headers:{}};
 const facts=await cmd.read(req,'checkout',String(id)),projection=require('../modules/shopping/lists/listService').listProjection(facts,id);
 const forged=await f.client.rpc('shopping_checkout_commit',{p_actor:f.users[0].id,p_key:randomUUID(),p_intent:{operation:'checkout',id:String(id),body:{}},p_expected:facts.expected,p_decision:{projection:[...projection,...projection]}});assert(forged.error);
 assert.equal(f.sql('SELECT count(*) FROM shopping_checkouts WHERE list_id='+id),'0');
 const h={'If-Match':facts.etag,'Idempotency-Key':randomUUID()};const replies=await Promise.all([1,2,3].map(()=>request('POST','/lists/'+id+'/checkout',{},h)));replies.forEach(r=>assert.deepEqual(r,replies[0]));assert.equal(replies[0].status,200,JSON.stringify(replies[0]));assert.equal(Number(replies[0].body.total_amount),0);
 assert.equal(f.sql('SELECT count(*) FROM shopping_checkouts WHERE list_id='+id),'1');
});

test('receipt movement freezes target plan, removes no items and protects historical deletion',async()=>{
 const {createWorkflowCommands}=require('../modules/shopping/shared/workflowCommands');const c=createWorkflowCommands({supabase:f.client,authorize:async()=>true});const req={user:{id:f.users[0].id},headers:{}};
 const source=await create(),target=await create();for(const id of [source,target])await request('POST','/lists/'+id+'/items',{entry_mode:'name_first',custom_name:'Receipt move '+id});
 const begun=await c.execute(req,'receipt.begin',String(source),{image_hash:'a'.repeat(64),image_hashes:['a'.repeat(64)],expected_attempt:0});
 await c.execute(req,'receipt.extracted',String(source),{attempt:begun.result.attempts,extracted:{items:[{name:'Synthetic',quantity:1,price:0}]}});
 const context=await request('GET','/lists/'+source+'/intelligence');assert.equal(context.status,200,JSON.stringify(context.body));
 const move=await request('POST','/lists/'+source+'/receipt/move',{target_list_id:target,context_token:context.body.context_token});assert.equal(move.status,200,JSON.stringify(move.body));
 assert.equal(f.sql("SELECT list_id FROM shopping_receipts WHERE id='"+begun.result.id+"'"),String(target));
 assert.equal(f.sql('SELECT count(*) FROM shopping_list_items WHERE list_id IN('+source+','+target+')'),'2');
 assert.equal((await request('DELETE','/lists/'+target,{}, {'If-Match':await revision(target,'list.delete')})).status,409);
});


test('list-type metadata and public category creation use atomic catalog persistence',async()=>{
 const settings=f.workflowOrigin+'/api/settings/shopping/list-types',headers={Authorization:'Bearer '+f.users[0].token,'Content-Type':'application/json'};
 let r=await fetch(settings,{method:'POST',headers:{...headers,'Idempotency-Key':randomUUID()},body:JSON.stringify({name:'Synthetic new type',slug:'synthetic-new-type'})});let type=await r.json();assert.equal(r.status,201,JSON.stringify(type));
 let read=await fetch(settings,{headers});const displayed=(await read.json()).find(t=>String(t.id)===String(type.id));
 r=await fetch(settings+'/'+type.id,{method:'PUT',headers:{...headers,'If-Match':displayed._mutation_tokens['type.edit']},body:JSON.stringify({name:'Renamed synthetic type'})});assert.equal(r.status,200,await r.text());
 const list=await request('POST','/lists',{title:'Type dependency',list_type_id:type.id});assert.equal(list.status,201);
 read=await fetch(settings+'?operation=type.deactivate&id='+type.id,{headers});
 r=await fetch(settings+'/'+type.id,{method:'DELETE',headers:{...headers,'If-Match':read.headers.get('etag')},body:'{}'});assert.equal(r.status,409);
 const parent=(await request('GET','/catalog-categories?list_type_id=1')).body.find(c=>!c.is_neutral);
 const category=await request('POST','/catalog-categories',{name:'Entry subtree',icon:'entry',parent_id:parent.id,list_type_id:1},{'Idempotency-Key':randomUUID()});assert.equal(category.status,201,JSON.stringify(category.body));
 assert.equal(f.sql('SELECT count(*) FROM shopping_catalog_category_list_types WHERE category_id='+category.body.id+' AND list_type_id=1'),'1');
 assert.equal((await request('POST','/catalog-categories',{name:'No invented root',parent_id:null,list_type_id:1})).status,409);
});

test('canonical legacy receipt projection bytes, recovery and retired-function absence',async()=>{
 const snapshot=await f.client.rpc('shopping_state',{p_scope:'list',p_ids:{actor:f.users[0].id,operation:'list.read',id:'1',item_id:null}});assert.ifError(snapshot.error);
 const {listProjection}=require('../modules/shopping/lists/listService');const projection=listProjection(snapshot.data,'1');
 const old=f.sql("SELECT coalesce(jsonb_agg(jsonb_build_object('list_item_id',i.id::text,'catalog_item_id',i.catalog_item_id::text,'notes',i.notes,'name',coalesce(i.planned_name,c.name,i.custom_name),'quantity',coalesce(i.quantity,1)::text,'unit',coalesce(i.unit,chr(1497)||chr(1495)||chr(1523)),'price',i.price::text,'is_purchased',i.is_purchased) ORDER BY i.id),'[]') FROM shopping_list_items i LEFT JOIN shopping_catalog_items c ON c.id=i.catalog_item_id WHERE i.list_id=1");assert.deepEqual(projection,JSON.parse(old));
 const history=f.sql('SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM shopping_list_items r WHERE list_id=1');assert.equal(history,f.history);
 const ledger=f.sql('SELECT jsonb_agg(to_jsonb(c) ORDER BY actor,request_key) FROM shopping_private.commands c');
 await f.env.restart();assert.equal(f.sql('SELECT jsonb_agg(to_jsonb(c) ORDER BY actor,request_key) FROM shopping_private.commands c'),ledger);
 const backup=f.env.backup();f.sql('CREATE DATABASE restore_test');f.env.sql(backup,false,'restore_test');
 assert.equal(f.env.sql('SELECT jsonb_agg(to_jsonb(c) ORDER BY actor,request_key) FROM shopping_private.commands c',false,'restore_test').stdout.trim(),ledger);
 assert.equal(f.env.sql('SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM shopping_list_items r WHERE list_id=1',false,'restore_test').stdout.trim(),history);
 for(let attempt=0;attempt<100;attempt++){
  const ready=await f.client.rpc('shopping_state',{p_scope:'list',p_ids:{actor:f.users[0].id,operation:'list.read',id:'1',item_id:null}});
  if(!ready.error)break;if(attempt===99)throw Error('PostgREST recovery not ready');await new Promise(resolve=>setTimeout(resolve,200));
 }
 const retired=[...require('node:fs').readFileSync(require('node:path').join(__dirname,'../migrations/060_shopping_hierarchy_persistence.sql'),'utf8').matchAll(/^DROP FUNCTION public\.([a-z_]+)\(/gm)].map(m=>m[1]);assert.equal(retired.length,15);
 assert.equal(f.sql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','shopping_private') AND p.proname=ANY(ARRAY["+retired.map(n=>"'"+n+"'").join(',')+"])"),'0');
 assert.equal(f.sql('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()'),'0');
});

test('existing React Shopping workflow persists through real HTTP/database/reload',{skip:!process.env.SHOPPING_PLAYWRIGHT_MODULE},async()=>{await require('./helpers/shoppingWorkflowBrowser')(f,assert);});

test('receipt drafts, reprocessing and historical assignments preserve frozen evidence',async()=>{
 const {createWorkflowCommands}=require('../modules/shopping/shared/workflowCommands');const c=createWorkflowCommands({supabase:f.client,authorize:async()=>true}),req={user:{id:f.users[0].id},headers:{}};
 const id=await create();assert.equal((await request('PUT','/lists/'+id,{store:'Synthetic history'},{'If-Match':await revision(id,'list.edit')})).status,200);
 const add=await request('POST','/lists/'+id+'/items',{custom_name:'Synthetic historical receipt product',category_id:-1,price:0});assert.equal(add.status,201);
 // Simulate an already-existing historical reference, never a new UI selection.
 f.sql('UPDATE shopping_catalog_items SET category_id=20001 WHERE id='+add.body.catalog_item_id);
 const began=await c.execute(req,'receipt.begin',String(id),{image_hash:'b'.repeat(64),image_hashes:['b'.repeat(64)],expected_attempt:0});
 const rows=[{name:'Synthetic historical receipt product',catalog_item_id:add.body.catalog_item_id,quantity:'1',unit:'unit',price:'0'}],identity={merchant:'Synthetic history',receipt_number:randomUUID(),purchase_date:'2026-11-01'};
 await c.execute(req,'receipt.extracted',String(id),{attempt:1,extracted:{items:rows,identity}});
 const plan=f.sql('SELECT items FROM shopping_purchase_plans WHERE list_id='+id),draft={items:rows,identity,purchase_date:'2026-11-01'},key=randomUUID();
 const save=await request('PUT','/lists/'+id+'/receipt/draft',{attempt:1,revision:0,draft},{'Idempotency-Key':key});assert.equal(save.status,200,JSON.stringify(save.body));
 assert.deepEqual(await request('PUT','/lists/'+id+'/receipt/draft',{attempt:1,revision:0,draft},{'Idempotency-Key':key}),save);
 assert.equal((await request('PUT','/lists/'+id+'/receipt/draft',{attempt:1,revision:0,draft:{...draft,purchase_date:'2026-11-02'}})).status,409);
 const restarted=await c.execute(req,'receipt.begin',String(id),{image_hash:'c'.repeat(64),image_hashes:['c'.repeat(64)],expected_attempt:1,reprocess:true,reprocess_key:randomUUID(),draft_revision:save.body.revision,review_draft:draft});assert.equal(restarted.result.attempts,2);
 await c.execute(req,'receipt.extracted',String(id),{attempt:2,extracted:{items:rows,identity}});
 const current=(await request('GET','/lists/'+id+'/intelligence')).body;
 const confirm=await request('POST','/lists/'+id+'/receipt/confirm',{context_token:current.context_token,reviewed:true,extraction_attempt:2,purchase_date:'2026-11-01',identity,items:rows});assert.equal(confirm.status,200,JSON.stringify(confirm.body));
 assert.equal(confirm.body.id,began.result.id);assert.equal(f.sql('SELECT items FROM shopping_purchase_plans WHERE list_id='+id),plan);
 assert.equal(f.sql('SELECT jsonb_array_length(previous_drafts) FROM shopping_receipts WHERE list_id='+id),'1');
});

test('checkout failure after preliminary cash insert rolls back all financial effects',async()=>{
 const id=await create(),add=await request('POST','/lists/'+id+'/items',{entry_mode:'name_first',custom_name:'Financial rollback',price:3});
 await request('PATCH','/lists/'+id+'/items/'+add.body.id+'/toggle',{}, {'If-Match':await revision(id,'item.toggle',add.body.id),'Idempotency-Key':randomUUID()});
 const before=f.sql('SELECT count(*) FROM transactions'),key=randomUUID();
 // Test-only failing trigger in a verified disposable database, after the
 // financial tail inserts its transaction and before checkout can complete.
 f.sql("CREATE FUNCTION public.synthetic_checkout_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$; CREATE TRIGGER synthetic_checkout_failure BEFORE INSERT ON shopping_checkouts FOR EACH ROW EXECUTE FUNCTION public.synthetic_checkout_failure();");
 try{
  const failed=await request('POST','/lists/'+id+'/checkout',{}, {'If-Match':await revision(id,'checkout'),'Idempotency-Key':key});assert.equal(failed.status,503);assert.equal(failed.body.code,"shopping_commit_unknown");
  assert.equal(f.sql('SELECT count(*) FROM transactions'),before);assert.equal(f.sql('SELECT count(*) FROM shopping_checkouts WHERE list_id='+id),'0');
  assert.equal(f.sql("SELECT count(*) FROM shopping_private.commands WHERE request_key='"+key+"'"),'0');
 }finally{f.sql('DROP TRIGGER synthetic_checkout_failure ON shopping_checkouts; DROP FUNCTION public.synthetic_checkout_failure();');}
});


test('regular preferences, suggestion presence and active-list deletion retain established behavior',async()=>{
 const id=await create(),data=(await request('GET','/lists/'+id+'/intelligence')).body,product=data.catalog[0];
 let r=await request('PUT','/regular-products/'+product.id,{quantity:'2',unit:'unit'},{'If-Match':data._mutation_tokens['regular.set:'+product.id],'Idempotency-Key':randomUUID()});assert.equal(r.status,200,JSON.stringify(r.body));
 const body={catalog_item_id:product.id,quantity:2,unit:'unit'},a=await request('POST','/lists/'+id+'/suggestions',body),b=await request('POST','/lists/'+id+'/suggestions',body);assert.equal(a.status,200,JSON.stringify(a.body));assert.equal(b.body.id,a.body.id);
 assert.equal(f.sql('SELECT count(*) FROM shopping_list_items WHERE list_id='+id),'1');
 const next=(await request('GET','/lists/'+id+'/intelligence')).body;r=await request('DELETE','/regular-products/'+product.id,{}, {'If-Match':next._mutation_tokens['regular.remove:'+product.id]});assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal((await request('PUT','/lists/'+id,{status:'active'},{'If-Match':await revision(id,'list.edit')})).status,200);
 assert.equal((await request('DELETE','/lists/'+id,{}, {'If-Match':await revision(id,'list.delete')})).status,200);
});

test('063 preserves 062 administrative bulk and branch atomic contracts',async()=>{
 const auth={Authorization:'Bearer '+f.users[0].token,'Content-Type':'application/json'},base=f.endpoint+'/api/settings/shopping';
 const ids=JSON.parse(f.sql('SELECT jsonb_agg(id::text) FROM (SELECT id FROM shopping_catalog_items ORDER BY id LIMIT 100)t'));
 let r=await fetch(base+'/catalog-items?operation=product.bulk-category&product_ids='+ids.join(','),{headers:auth});assert.equal(r.status,200);
 const key=randomUUID(),body={product_ids:ids,category_id:-1};let headers={...auth,'If-Match':r.headers.get('etag'),'Idempotency-Key':key};
 r=await fetch(base+'/catalog-items/bulk-category',{method:'POST',headers,body:JSON.stringify(body)});const saved=await r.json();assert.equal(r.status,200,JSON.stringify(saved));assert.equal(saved.updated,100);
 const replay=await fetch(base+'/catalog-items/bulk-category',{method:'POST',headers,body:JSON.stringify(body)});assert.deepEqual(await replay.json(),saved);
 const bad=[...ids.slice(0,99),'9999999'];r=await fetch(base+'/catalog-items?operation=product.bulk-category&product_ids='+bad.join(','),{headers:auth});
 const before=f.sql('SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM shopping_catalog_items p');
 const failed=await fetch(base+'/catalog-items/bulk-category',{method:'POST',headers:{...auth,'If-Match':r.headers.get('etag')||'"invalid"','Idempotency-Key':randomUUID()},body:JSON.stringify({product_ids:bad,category_id:-1})});assert(failed.status>=400);assert.equal(f.sql('SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM shopping_catalog_items p'),before);
 const categories=(await request('GET','/catalog-categories?list_type_id=1')).body;const child=categories.find(c=>c.parent_id!==null);r=await fetch(base+'/list-types/1/categories',{headers:auth});
 const branches=await fetch(base+'/list-types/1/categories',{method:'PUT',headers:{...auth,'If-Match':r.headers.get('etag'),'Idempotency-Key':randomUUID()},body:JSON.stringify({categoryIds:[child.parent_id,child.id]})});assert.equal(branches.status,200,await branches.text());
 const visible=(await request('GET','/catalog-categories?list_type_id=1')).body;assert.equal(new Set(visible.map(c=>c.id)).size,visible.length);
});

test('lookup late leases, receipt callbacks and privileged projection tampering fail without effects',async()=>{
 const {createWorkflowCommands}=require('../modules/shopping/shared/workflowCommands'),{planLookup}=require('../modules/shopping/intelligence/lookupService');
 const c=createWorkflowCommands({supabase:f.client,authorize:async()=>true}),req={user:{id:f.users[0].id},headers:{'Idempotency-Key':randomUUID()}};
 const body={code:'4006381333931',provider:'open_food_facts',environment:'staging',lease_id:randomUUID()};const claim=await c.execute(req,'lookup.claim',null,body,planLookup);assert.equal(claim.result.claimed,true);
 await assert.rejects(c.execute({...req,headers:{'Idempotency-Key':randomUUID()}},'lookup.finalize',null,{...body,lease_id:randomUUID(),result:{status:'found'}},planLookup),{code:'shopping_lookup_lease_stale'});
 const id=await create();await request('POST','/lists/'+id+'/items',{entry_mode:'name_first',custom_name:'Callback safety'});
 const begin=await c.execute({...req,headers:{}},'receipt.begin',String(id),{image_hash:'b'.repeat(64),image_hashes:['b'.repeat(64)],expected_attempt:0});
 await assert.rejects(c.execute({...req,headers:{}},'receipt.extracted',String(id),{attempt:begin.result.attempts+1,extracted:{items:[]}}),{code:'receipt_stale'});
 assert.equal(f.sql('SELECT state FROM shopping_receipts WHERE list_id='+id),'extracting');
 await c.execute({...req,headers:{}},'receipt.failed',String(id),{attempt:begin.result.attempts});
 const retired=require('../modules/shopping/shared/migrationReadiness').removeFunctions.map(s=>s.split('(')[0].replace(/^public\./,''));
 assert(!f.rpcCalls.some(name=>retired.includes(name)),JSON.stringify(f.rpcCalls));
});
