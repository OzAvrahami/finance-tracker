const test = require('node:test');
const assert = require('node:assert/strict');
const { loadControllerWithFake, createMockResponse } = require('./helpers/fakeSupabase');

function setup() {
 const tables={shopping_catalog_items:[{id:7,name:'Milk',category_id:2,default_unit:'package',default_price:5,is_active:true}],
 shopping_catalog_category_list_types:[{category_id:2,list_type_id:1,shopping_catalog_categories:{is_active:true}}],shopping_list_items:[],shopping_lists:[{id:1}]};
 const calls=[];
 const db={rpc:async(name,args)=>{calls.push({rpc:name,args});return {data:{id:99,...args.p_item},error:null};},from(table){
  let filters=[],op='read',payload,limit=Infinity,single=false;
  const run=()=>{let rows=tables[table].filter(r=>filters.every(fn=>fn(r)));if(op==='insert'){rows=payload.map((p,i)=>({id:100+i,...p}));tables[table].push(...rows);}if(op==='update')rows.forEach(r=>Object.assign(r,payload));rows=rows.slice(0,limit);return {data:single?rows[0]:structuredClone(rows),error:null};};
  const q={select(){return q;},order(){return q;},eq(k,v){filters.push(r=>String(r[k])===String(v));return q;},
   ilike(k,v){calls.push({ilike:v});filters.push(r=>r[k].toLowerCase().includes(v.replaceAll('%','').toLowerCase()));return q;},
   in(k,v){filters.push(r=>v.includes(r[k]));return q;},limit(n){calls.push({limit:n});limit=n;return q;},
   insert(v){op='insert';payload=v;return q;},update(v){op='update';payload=v;return q;},single(){single=true;return q;},
   then(a,b){return Promise.resolve(run()).then(a,b);}};return q;
 }};
 const controller=loadControllerWithFake('../../controllers/shoppingController',db);
 return {tables,calls,async invoke(method,body={},query={}){const res=createMockResponse();await controller[method]({params:{id:1,itemId:100},body,query},res);return res;}};
}
test('new contract dispatches atomic RPC; legacy free text still saves catalog and catalog selection derives category',async()=>{
 const {invoke,tables,calls}=setup();
 assert.equal((await invoke('addListItem',{entry_mode:'name_first',custom_name:'Gift',save_to_catalog:false})).statusCode,201);
 assert.equal(calls[0].rpc,'shopping_add_planned_item');assert.equal(tables.shopping_catalog_items.length,1);
 await invoke('addListItem',{custom_name:'Charger',category_id:2,quantity:1});
 assert.equal(tables.shopping_catalog_items.length,2);assert.ok(tables.shopping_list_items[0].catalog_item_id);
 await invoke('addListItem',{catalog_item_id:7,category_id:999});
 assert.equal(tables.shopping_list_items[1].category_id,2);assert.equal(tables.shopping_list_items[1].catalog_item_id,7);
});
test('suggestion API bounds requests and enforces list-type scope, including empty categories',async()=>{
 const {invoke,calls}=setup();
 const ok=await invoke('getCatalogItems',{}, {list_type_id:1,search:'Milk',limit:999});assert.equal(ok.body.length,1);assert.ok(calls.some(c=>c.limit===20));
 const empty=await invoke('getCatalogItems',{}, {list_type_id:9,search:'Milk'});assert.deepEqual(empty.body,[]);
});
test('deliberate rename and notes only update the list; invalid edits are rejected',async()=>{
 const {invoke,tables}=setup();await invoke('addListItem',{catalog_item_id:7});
 await invoke('updateListItem',{planned_name:'Milk lactose free',notes:'500g package',quantity:2});
 const item=tables.shopping_list_items[0];assert.equal(item.catalog_item_id,7);assert.equal(item.planned_name,'Milk lactose free');assert.equal(item.notes,'500g package');
 assert.equal(tables.shopping_catalog_items[0].name,'Milk');
 assert.equal((await invoke('updateListItem',{planned_name:' '})).statusCode,400);
 assert.equal((await invoke('updateListItem',{planned_name:'Milk',quantity:-1})).statusCode,400);
});

test('controlled entry canonicalizes known units without changing quantity; category resolution stays in RPC',async()=>{
 const {invoke,calls}=setup();
 await invoke('addListItem',{entry_mode:'name_first',custom_name:'Nuts 500g',quantity:'0.125',unit:'ק״ג',unit_mode:'controlled',category_name:' Food  supplies '});
 assert.equal(calls[0].args.p_item.unit,'kg');assert.equal(calls[0].args.p_item.quantity,'0.125');
 assert.equal(calls[0].args.p_item.category_name,' Food  supplies ');
 assert.equal((await invoke('addListItem',{entry_mode:'name_first',unit_mode:'controlled',unit:123})).statusCode,400);
});

test('row unit restriction is opt-in, preserves existing custom units and catalog identity, rejects invented replacements',async()=>{
 const {invoke,tables}=setup();await invoke('addListItem',{catalog_item_id:7,quantity:0.125,unit:'custom box'});
 const item=tables.shopping_list_items[0];
 assert.equal((await invoke('updateListItem',{planned_name:'Milk 500g',quantity:'0.125',unit:'custom box',unit_mode:'controlled'})).statusCode ?? 200,200);
 assert.equal((await invoke('updateListItem',{unit:'invented',unit_mode:'controlled'})).statusCode,400);
 assert.equal(item.unit,'custom box');
 assert.equal((await invoke('updateListItem',{quantity:'0.1251',unit_mode:'controlled'})).statusCode,400);
 assert.equal((await invoke('updateListItem',{unit:'זוג',unit_mode:'controlled'})).statusCode ?? 200,200);
 assert.equal(item.unit,'pair');assert.equal(item.quantity,'0.125');assert.equal(item.catalog_item_id,7);
 assert.equal(tables.shopping_catalog_items[0].default_unit,'package');
 assert.equal((await invoke('updateListItem',{unit:'legacy caller unit'})).statusCode ?? 200,200);
 assert.equal(item.unit,'legacy caller unit');
});
