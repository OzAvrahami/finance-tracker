const {test}=require('node:test');
const assert=require('node:assert/strict');
const {suggestions,reconcile}=require('../services/shoppingHabitsService');
const {applyCommercial,validateMappingSnapshots}=require('../services/shoppingCommercialProducts');
const {convertQuantity,mappedQuantity,packageFromText}=require('../../shared/shoppingQuantities.mjs');
const id='11111111-1111-4111-8111-111111111111';
const mapping={commercial_product_id:id,revision:1,personal_item_id:'1',personal_name:'Milk 3%',receipt_unit:'unit',planning_unit:'liter',factor:'1'};
const line=(q='1')=>({name:'Brand milk',quantity:q,unit:'unit',price:'7.50',row_discount:'1',line_total:'8.50',product_code:'7622210453327',commercial_product_id:id,catalog_item_id:'1',mapping_snapshot:mapping});
const catalog=[{id:1,name:'Milk 3%',default_unit:'liter',is_active:true},{id:2,name:'Lactose free',default_unit:'liter',is_active:true}];
test('two brands fulfill one personal need without changing separate occurrences or money',()=>{
 const rows=[line('2'),{...line(),name:'Second brand',product_code:'7622300356767'}];
 const before=JSON.stringify(rows),plan=[{catalog_item_id:'1',name:'Milk 3%',quantity:'3',unit:'liter'}];
 const result=reconcile(plan,rows,catalog);
 assert.equal(result.items.length,2);assert.equal(result.fulfillment[0].quantity,'3');assert.equal(result.fulfillment[0].unresolved,0);
 assert.ok(result.items.every(i=>i.comparison==='bought'));assert.equal(JSON.stringify(rows),before);
});
test('dietary similarities suggest only; no exact-name auto grouping or catalogue creation',()=>{
 const result=reconcile([{catalog_item_id:'1',name:'Milk 3%',quantity:'3',unit:'liter'}],[{name:'Milk 3%',quantity:'1',unit:'unit',price:'5'},{name:'Lactose free',quantity:'1',unit:'unit',price:'5'}],catalog);
 assert.ok(result.items.every(r=>r.catalog_item_id===null));
 assert.deepEqual(result.items[1].suggested_personal_items,[{id:'2',name:'Lactose free'}]);
});
test('same printed product repetitions remain separate but count as one confirmed trip',()=>{
 const history=[{list_id:10,purchase_date:'2026-09-01',items:[line(),line(),line()]}];
 const [s]=suggestions(catalog,[],history,new Date('2026-09-30'));
 assert.equal(s.quantity,'3');assert.equal(s.purchase_occasions,1);assert.equal(s.interval_days,null);
 assert.equal(reconcile([],history[0].items,catalog).items.length,3);
});
test('quantity dimensions and known package parsing never equate packages/litres or guess multipacks',()=>{
 assert.equal(convertQuantity('1000','ml','liter'),'1');assert.equal(convertQuantity('0.25','kg','g'),'250');
 assert.equal(convertQuantity('2','package','liter'),null);assert.equal(convertQuantity('2','kg','liter'),null);
 assert.deepEqual(packageFromText('1 L'),{package_quantity:'1',package_unit:'l'});
 assert.deepEqual(packageFromText('6 x 1 L'),{package_quantity:null,package_unit:null});
 assert.equal(mappedQuantity({...line(),mapping_snapshot:{...mapping,factor:null}}),null);
 assert.equal(mappedQuantity({...line(),unit:'kg'}),null);
});
test('unresolved confirmed quantity gives honest fallback, no invented stock or compatible quantity',()=>{
 const [s]=suggestions(catalog,[],[{list_id:1,purchase_date:'2026-09-20',items:[{...line(),mapping_snapshot:{...mapping,factor:null}}]}],new Date('2026-09-30'));
 assert.equal(s.quantity_unresolved,true);assert.equal(s.quantity,'1');assert.equal(s.purchase_occasions,1);
 assert.match(s.explanation,/המרת הכמות/);
});
test('saved mapping snapshot and owner financial corrections survive changed commercial mapping',()=>{
 const r={...line(),quantity:'2',price:'6.30',owner_edited_fields:['price']};
 const next=applyCommercial(r,{id,mapping:{...mapping,revision:2,personal_item_id:'2'}});
 assert.equal(next.mapping_snapshot.revision,1);assert.equal(next.catalog_item_id,'1');assert.equal(next.price,'6.30');
 assert.equal(applyCommercial(r,{id,mapping:{...mapping,revision:2,personal_item_id:'2'}},{replaceMapping:true}).catalog_item_id,'2');
});
test('confirmation validates immutable revision and recomputes planning quantity, preserving monetary fields',async()=>{
 const stored={...mapping,personal_item_id:1,factor:1};
 const db={from(table){const q={select(){return q},eq(){return q},async maybeSingle(){return {data:table==='shopping_product_mappings'?stored:{commercial_product_id:id}}}};return q},rpc:async()=>({data:{id,mapping:{...mapping,revision:2,personal_item_id:'2'}}})};
 const [r]=await validateMappingSnapshots([{...line('2'),mapping_snapshot:{...mapping,factor:'999'},planning_quantity:'999'}],db);
 assert.equal(r.planning_quantity,'2');assert.equal(r.price,'7.50');assert.equal(r.row_discount,'1');assert.equal(r.mapping_snapshot.revision,1);
});
