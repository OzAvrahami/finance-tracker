'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createShoppingHttpFixture}=require('./helpers/shoppingHttpFixture');
const {createAdministrationRouter}=require('../modules/shopping/http/administrationRouter');
let f;const C='/settings/shopping/catalog-categories',P='/settings/shopping/catalog-items',T='/settings/shopping/list-types';
before(async()=>{f=await createShoppingHttpFixture();console.log(JSON.stringify({identity:f.env.identity,api:f.endpoint,auth:f.auth,rest:f.rest,credentials:'fresh isolated only'}));});
after(async()=>{if(f)await f.close();});
async function http(method,path,body,headers={},token=f.users[0].token){
 const r=await fetch(f.endpoint+'/api'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {status:r.status,body:await r.json(),etag:r.headers.get('etag'),revision:r.headers.get('x-shopping-catalog-revision')};
}
async function edit(path,body,{method='PUT',key=randomUUID(),token=f.users[0].token,readPath=path}={}){
 const read=await http('GET',readPath,undefined,{},token);assert.equal(read.status,200);
 return http(method,path,body,{'If-Match':read.etag,'Idempotency-Key':key},token);
}
async function category(parent=null){const r=await http('POST',C,{name:'HTTP '+randomUUID(),parent_id:parent},{'Idempotency-Key':randomUUID()});assert.equal(r.status,201);return r.body.id;}
async function product(cat){const r=await http('POST',P,{name:'HTTP product '+randomUUID(),category_id:cat,default_price:0},{'Idempotency-Key':randomUUID()});assert.equal(r.status,201);return r.body.id;}
const facts=()=>f.sql("SELECT jsonb_build_object('catalog',shopping_private.catalog_facts(),'commands',(SELECT jsonb_agg(to_jsonb(c) ORDER BY actor,request_key) FROM shopping_private.commands c));");

test('production cannot mount admin routes; real Auth rejects missing, forged, expired and ordinary users',async()=>{
 assert.throws(()=>createAdministrationRouter({environment:{NODE_ENV:'production',VITE_SHOPPING_ADMIN_PREVIEW:'1'}}));
 for(const token of [null,'forged',f.env.expiredUserToken(f.users[0].token)])assert.equal((await http('GET',C,undefined,{},token)).status,401);
 for(const method of ['GET','POST'])assert.equal((await http(method,C,method==='POST'?{name:'Forbidden',parent_id:null}:undefined,{},f.users[2].token)).status,403);
 assert.equal((await fetch(f.endpoint+'/auth/v1/admin/users',{headers:{Authorization:'Bearer '+f.users[2].token}})).status,404);
});
test('approved initial visibility and historical reads preserve array shapes',async()=>{
 const c=await http('GET',C+'?include_inactive=true');assert.equal(c.status,200);assert.equal(c.body.length,99);assert.equal(c.body.filter(c=>c.historical).length,25);
 assert.equal((await http('GET',C)).body.length,74);assert.equal((await http('GET',P)).body.length,173);
 const values=await Promise.all([1,2,3,4,5,6].map(i=>http('GET',`${T}/${i}/visibility`)));
 assert.deepEqual(values.map(r=>[r.body.category_ids.length,r.body.product_ids.length]),[[57,144],[11,19],[1,1],[10,21],[9,12],[11,21]]);
});
test('category create + link, combined edit/icon, reparent and cycle rejection persist via HTTP',async()=>{
 const parent=await category(),other=await category();
 const made=await http('POST',C,{name:'Composite HTTP',parent_id:parent,icon:'box',list_type_id:1},{'Idempotency-Key':randomUUID()});assert.equal(made.status,201);
 assert.equal(f.sql(`SELECT count(*) FROM shopping_catalog_category_list_types WHERE category_id=${made.body.id} AND list_type_id=1;`),'1');
 const r=await edit(C+'/'+made.body.id,{name:'Combined HTTP',icon:'star',parent_id:other,is_active:true,display_order:0});assert.equal(r.status,200);assert.equal(r.body.icon,'star');assert.equal(r.body.parent_id,other);
 assert.equal(f.sql(`SELECT icon FROM shopping_catalog_categories WHERE id=${made.body.id};`),'star');
 const child=await category(made.body.id),before=facts();const bad=await edit(C+'/'+made.body.id,{parent_id:child,icon:'no'});assert.equal(bad.status,409);assert.equal(bad.body.code,'shopping_category_cycle');assert.equal(facts(),before);
});
test('category lifecycle, inactive ancestry and neutral restrictions retain history',async()=>{
 const a=await category(),b=await category(a);assert.equal((await edit(C+'/'+a,{is_active:false})).status,200);
 assert.equal((await http('GET',C+'/'+b)).body.effective_active,false);
 const p=await http('POST',P,{name:'Inactive assignment',category_id:b},{'Idempotency-Key':randomUUID()});assert.equal(p.status,409);
 assert.equal((await edit(C+'/-1',{icon:'bad'})).body.code,'shopping_neutral_protected');
 const gone=await edit(C+'/'+b,{}, {method:'DELETE',readPath:C+'/'+b+'?operation=category.change'});assert.equal(gone.status,200);assert.equal(gone.body.is_active,false);
 assert.equal(f.sql(`SELECT count(*) FROM shopping_catalog_categories WHERE id=${b};`),'1');
});
test('product metadata, zero/null/omission, reassignment, filters and duplicate review',async()=>{
 const a=await category(),b=await category(),id=await product(a),key=randomUUID();
 const result=await edit(P+'/'+id,{name:'Same synthetic review',category_id:b,default_price:0,default_unit:null},{key,readPath:P+'?operation=product.edit&id='+id});assert.equal(result.status,200);assert.equal(result.body.default_price,'0');
 const second=await http('POST',P,{name:'Same synthetic review',category_id:a},{'Idempotency-Key':randomUUID()});assert.equal(second.status,201);
 assert((await http('GET',P+'/duplicate-candidates')).body.some(ids=>ids.includes(id)&&ids.includes(second.body.id)));
 assert.equal((await http('GET',P+'?category_id='+b+'&search=Same')).body.length,1);
 assert.equal((await edit(P+'/'+id,{default_price:null},{readPath:P+'?operation=product.edit&id='+id})).body.default_price,null);
 assert.equal(f.sql(`SELECT category_id FROM shopping_catalog_items WHERE id=${id};`),b);
 assert.equal((await edit(P+'/'+id,{}, {method:'DELETE',readPath:P+'?operation=product.deactivate&id='+id})).body.is_active,false);
});
test('bulk 100 via HTTP is atomic; missing member and uniqueness leave no partial state',async()=>{
 const a=await category(),b=await category();f.sql(`INSERT INTO shopping_catalog_items(name,category_id) SELECT 'HTTP batch '||i,${a} FROM generate_series(1,100)i;`);
 const ids=JSON.parse(f.sql(`SELECT jsonb_agg(id::text ORDER BY id) FROM shopping_catalog_items WHERE category_id=${a};`));
 const badIds=[...ids.slice(0,99),'9223372036854775807'],before=facts();
 const bad=await edit(P+'/bulk-category',{product_ids:badIds,category_id:b},{method:'POST',readPath:P+'?operation=product.bulk-category&product_ids='+badIds});assert.equal(bad.status,404);assert.equal(facts(),before);
 const r=await edit(P+'/bulk-category',{product_ids:[...ids].reverse(),category_id:b},{method:'POST',readPath:P+'?operation=product.bulk-category&product_ids='+ids});assert.equal(r.status,200);assert.equal(r.body.updated,100);assert.equal(f.sql(`SELECT count(*) FROM shopping_catalog_items WHERE category_id=${b};`),'100');
 const one=await http('POST',P,{name:'HTTP batch 1',category_id:a},{'Idempotency-Key':randomUUID()});assert.equal(one.status,201);
 const snap=facts();const collision=await edit(P+'/'+one.body.id,{category_id:b},{readPath:P+'?operation=product.edit&id='+one.body.id});assert.equal(collision.status,409);assert.equal(facts(),snap);
});
test('branch replacement and GET draft preview inherit descendants without duplicates',async()=>{
 const a=await category(),b=await category(a),p=await product(b);
 const r=await edit(T+'/1/categories',{categoryIds:[a,b]});assert.deepEqual(r.body,{linked:2});
 const saved=await http('GET',T+'/1/visibility');assert.equal(saved.body.product_ids.filter(x=>x===p).length,1);
 const before=facts(),preview=await http('GET',T+'/1/visibility?categoryIds='+b);assert.equal(preview.status,200);assert(preview.body.product_ids.includes(p));assert.equal(facts(),before);
});
for(const family of ['category','product','bulk','branches'])test(`${family} exact original HTTP status/body/ETag replay after later writes`,async()=>{
 const a=await category(),b=await category(),p=await product(a),key=randomUUID();
 const spec={category:[C+'/'+a,{icon:'original'},C+'/'+a,'PUT'],product:[P+'/'+p,{default_unit:'original'},P+'?operation=product.edit&id='+p,'PUT'],bulk:[P+'/bulk-category',{product_ids:[p],category_id:b},P+'?operation=product.bulk-category&product_ids='+p,'POST'],branches:[T+'/1/categories',{categoryIds:[a]},T+'/1/categories','PUT']}[family];
 const [path,body,readPath,method]=spec,first=await edit(path,body,{key,method,readPath});assert.equal(first.status,200);
 const different=family==='category'?{icon:'different'}:family==='product'?{default_unit:'different'}:family==='bulk'?{...body,category_id:-1}:{categoryIds:[]};
 assert.equal((await edit(path,different,{method,readPath})).status,200);
 const before=facts();const again=await http(method,path,body,{'Idempotency-Key':key});assert.equal(again.status,first.status);assert.equal(again.etag,first.etag);assert.deepEqual(again.body,first.body);assert.equal(facts(),before);
 assert.equal((await http(method,path,different,{'Idempotency-Key':key})).body.code,'shopping_key_conflict');assert.equal(facts(),before);
});

test('creation replays preserve 201 and original rows after edits; competing branch writes reject stale revision',async()=>{
 for(const family of ['category','product']) {
  const path=family==='category'?C:P,key=randomUUID(),body={name:'Original '+randomUUID(),...(family==='category'?{parent_id:null}:{category_id:-1})};
  const first=await http('POST',path,body,{'Idempotency-Key':key});assert.equal(first.status,201);
  assert.equal((await edit(path+'/'+first.body.id,{name:'Later '+randomUUID()},{readPath:family==='category'?path+'/'+first.body.id:P+'?operation=product.edit&id='+first.body.id})).status,200);
  const before=facts(),again=await http('POST',path,body,{'Idempotency-Key':key});assert.equal(again.status,201);assert.equal(again.etag,first.etag);assert.deepEqual(again.body,first.body);assert.equal(facts(),before);
 }
 const a=await category(),b=await category(),read=await http('GET',T+'/2/categories');
 const competing=await Promise.all([a,b].map(id=>http('PUT',T+'/2/categories',{categoryIds:[id]},{'If-Match':read.etag,'Idempotency-Key':randomUUID()})));
 assert.deepEqual(competing.map(r=>r.status).sort(),[200,409]);assert.equal(competing.find(r=>r.status===409).body.code,'shopping_revision_stale');
 const saved=await http('GET',T+'/2/categories');assert.equal(saved.body.filter(c=>c.linked&&c.id!=='-1').length,1);
});
test('concurrent HTTP mutations, scoped revisions, missing preconditions and payload privilege escalation',async()=>{
 const a=await category(),b=await category(),read=await http('GET',C+'/'+a),key=randomUUID();
 const requests=await Promise.all([1,2].map(()=>http('PUT',C+'/'+a,{icon:'once'},{'If-Match':read.etag,'Idempotency-Key':key})));assert.deepEqual(requests[0],requests[1]);
 assert.equal((await http('PUT',C+'/'+a,{icon:'stale'},{'If-Match':read.etag,'Idempotency-Key':randomUUID()})).body.code,'shopping_revision_stale');
 assert.equal((await http('PUT',C+'/'+a,{icon:'missing'})).status,428);
 const fresh=await http('GET',C+'/'+a),before=facts();
 assert.equal((await http('PUT',C+'/'+a,{icon:'forged'},{'If-Match':'"forged-revision"','Idempotency-Key':randomUUID()})).status,409);
 for(const [id,token] of [[b,f.users[0].token],[a,f.users[1].token]])assert.equal((await http('PUT',C+'/'+id,{icon:'cross-scope'},{'If-Match':fresh.etag,'Idempotency-Key':randomUUID()},token)).status,409);
 assert.equal((await http('PUT',C+'/'+a,{icon:'bad',actor:f.users[0].id},{'If-Match':fresh.etag,'Idempotency-Key':randomUUID()})).status,400);assert.equal(facts(),before);
 const historical=await http('POST',P,{name:'Historical reject',category_id:f.historical[0]},{'Idempotency-Key':randomUUID()});assert.equal(historical.status,409);assert.equal(facts(),before);
});
test('legacy identity-only response is explicit 409; browser roles cannot invoke privileged RPC',async()=>{
 const id=await category(),key=randomUUID(),body={icon:'old'};await edit(C+'/'+id,body,{key});
 f.sql(`UPDATE shopping_private.commands SET result=jsonb_build_object('id',${id}::text),http=NULL WHERE request_key='${key}';`);
 const before=facts();assert.equal((await http('PUT',C+'/'+id,body,{'Idempotency-Key':key})).body.code,'shopping_legacy_result_unavailable');assert.equal(facts(),before);
 for(const token of [f.anon,f.users[0].token]){
  const r=await fetch(f.rest+'/rpc/shopping_catalog_commit',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({p_actor:f.users[0].id,p_key:randomUUID(),p_intent:{},p_expected:{},p_decision:{}})});assert(r.status>=400);
 }
 assert.equal(f.sql('SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM shopping_list_items r;'),f.history);
});

test('React browser edits persist through authenticated HTTP and reload', {skip:!process.env.SHOPPING_PLAYWRIGHT_MODULE},async()=>{
 await require('./helpers/shoppingBrowserCases')({fixture:f,assert});
});
