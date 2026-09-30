const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validGTIN,identifier}=require('../services/shoppingProductIdentifiers');
const {fetchFoodProduct,createProductLookup}=require('../services/shoppingProductLookup');
const {reviewProjection,confirmationItems,reviewSchema}=require('../services/shoppingReceiptReview');
const {enrichKnownProducts}=require('../services/shoppingProductLookup');
test('GTIN lengths/check digit preserve leading zeros; retailer scope explicit',()=>{
 for(const c of ['96385074','036000291452','7622210453327','00036000291452']) assert.equal(validGTIN(c),true,c);
 for(const c of ['7622210453328','12345',7622210453327,'762221045332']) assert.equal(validGTIN(c),false);
 assert.equal(identifier('12345'),null); assert.equal(identifier('12345','retailer',''),null);
 assert.deepEqual(identifier('00123','retailer','  SHOP A  '),{kind:'retailer',code:'00123',retailer_scope:'shop a'});
});
test('provider sends only exact code/public fields; Hebrew brand and size, no translation',async()=>{
 let request;
 const result=await fetchFoodProduct('7622210453327',{fetchImpl:async(url,opts)=>{
  request={url,opts};return new Response(JSON.stringify({product:{code:'7622210453327',product_name_he:'עוגיות',product_name:'Cookies',brands:'Milka',quantity:'135 g'}}));
 }});
 assert.equal(result.product.full_name,'עוגיות · Milka · 135 g');
 assert.match(request.url,/\.net\/api\/v3\/product\/7622210453327\?fields=/);
 assert.equal(request.opts.redirect,'error');assert.match(request.opts.headers['User-Agent'],/FinanceTracker/);
 assert.equal(request.opts.body,undefined);
});
test('missing, mismatched identifier, unsupported type, timeout and rate limit are non-blocking',async()=>{
 for(const [data,status,want] of [[{},404,'missing'],[{},429,'rate_limited'],[{product:{code:'0007622210453327',product_name:'Other'}},200,'identifier_mismatch'],[{product:{code:'7622210453327',product_type:'beauty'}},200,'identifier_mismatch']]) {
  assert.equal((await fetchFoodProduct('7622210453327',{fetchImpl:async()=>new Response(JSON.stringify(data),{status})})).status,want);
 }
 assert.equal((await fetchFoodProduct('7622210453327',{fetchImpl:async()=>{throw Object.assign(Error(),{name:'TimeoutError'});}})).status,'timeout');
});
test('local approved catalog wins without provider/cache call',async()=>{
 const row={commercial_product_id:'11111111-1111-4111-8111-111111111111'};
 const q={select(){return this;},eq(){return this;},async maybeSingle(){return {data:row};}};
 const lookup=createProductLookup({from:()=>q,rpc(name){assert.equal(name,'shopping_commercial_detail');return {data:{id:row.commercial_product_id,approved_name:'Owner name',mapping_revision:0,mapping:null}};}},{fetchImpl:()=>{throw Error('no network');}});
 const result=await lookup({code:'7622210453327',kind:'gtin'});
 assert.equal(result.product.full_name,'Owner name');assert.equal(result.product.commercial_product_id,row.commercial_product_id);assert.equal(result.product.mapping,null);
});
test('successful cache is reused without provider call',async()=>{
 const q={select(){return this;},eq(){return this;},async maybeSingle(){return {data:null};}};
 const result={status:'found',product:{code:'7622210453327',full_name:'Cookies'}};
 const lookup=createProductLookup({from:()=>q,rpc:async()=>({data:{claimed:false,result}})},{fetchImpl:()=>{throw Error('no network');}});
 assert.deepEqual(await lookup({code:'7622210453327'}),result);
});
test('complementary catalog uses documented public host, separate cache and no staging authorization',async()=>{
 let requested;
 const result=await fetchFoodProduct('7290109060385',{provider:'open_products_facts',env:{SHOPPING_PRODUCT_LOOKUP_ENV:'staging'},fetchImpl:async(url,opts)=>{
  requested={url,opts};return new Response(JSON.stringify({product:{code:'7290109060385',product_type:'product',product_name:'Wipes'}}));
 }});
 assert.match(requested.url,/world\.openproductsfacts\.org/);assert.equal(requested.opts.headers.Authorization,undefined);
 assert.equal(result.product.environment,'production');assert.equal(result.product.source,'open_products_facts');
 const q={select(){return this},eq(){return this},async maybeSingle(){return {data:null}}};
 const lookup=createProductLookup({from:()=>q,rpc:async(name,args)=>{assert.equal(args.p_provider,'open_products_facts');assert.equal(args.p_environment,'production');return {data:{claimed:false,result}};}},{env:{SHOPPING_PRODUCT_LOOKUP_ENV:'staging'}});
 assert.deepEqual(await lookup({code:'7290109060385',provider:'open_products_facts'}),result);
});
test('price compatibility, exact line discounts and weighted aggregate rounding',async()=>{
 const {projectPrice,priceBreakdown,editPrice}=await import('../../shared/receiptPricing.mjs');
 const legacy={quantity:'2',price:'7.50',line_total:'30.20',discount:'15.20'};
 assert.equal(priceBreakdown(legacy).final,'15.00');
 assert.equal(projectPrice(legacy).original_unit_price,'15.10');
 assert.equal(projectPrice({quantity:'1',price:'13.00'}).row_discount,null);
 let edited=editPrice(legacy,'row_discount','15.20');
 assert.equal(edited.price,'7.50');assert.equal(priceBreakdown(edited).final,'15.00');
 assert.equal(priceBreakdown(editPrice(edited,'price','8.00')).final,'16.00');
 const weighted={quantity:'0.333',original_unit_price:'10.00',row_discount:'1.00',price_basis:'line_discount'};
 assert.equal(priceBreakdown(weighted).final,'2.33');assert.equal(priceBreakdown(weighted).net_unit_price,null);
 assert.equal(priceBreakdown({...weighted,row_discount:null}).final,null);
 assert.equal(priceBreakdown({...weighted,row_discount:'5.00'}).conflict,true);
 assert.equal(priceBreakdown({quantity:'0.333',price:'10.01'}).units,333333n);
 assert.equal(projectPrice({...legacy,row_discount:null}).row_discount,null);
 assert.equal(priceBreakdown(editPrice(edited,'original_unit_price','')).final,null);
 const owner={quantity:'2',price:'13.00',line_total:'16.90',discount:'3.90',owner_edited_fields:['quantity','price']};
 assert.equal(priceBreakdown(owner).source_mismatch,true);
 assert.equal(priceBreakdown(owner).final,'26.00');
});
test('stable occurrences stay separate; raw names and owner corrections survive projection/confirmation',async()=>{
 const rows=[{name:'Owner corrected',original_name:'abbr',product_code:'7622210453327',quantity:'1',unit:'unit',price:'13.00',source_lines:[{photo_number:3,line_number:20}],owner_edited_fields:['name','price']},
 {name:'second occurrence',product_code:'7622210453327',quantity:'1',unit:'unit',price:'13.00',source_lines:[{photo_number:3,line_number:21}]}];
 const result=await reviewProjection(rows,5);
 assert.equal(result.length,2);assert.notEqual(result[0].row_id,result[1].row_id);
 assert.equal(result[0].name,'Owner corrected');assert.equal(result[0].original_name,'abbr');
 const confirmed=await confirmationItems(result);
 assert.equal(confirmed[0].price,'13.00');assert.equal(confirmed[0].product_code,'7622210453327');
 assert.equal(confirmed[0].raw_price.original_unit_price,null);
});
test('draft retains removed rows as absent, identifiers/raw prices and rejects arbitrary fields',()=>{
 const d={items:[{name:'A',quantity:'1',unit:'unit',price:'2.00',row_id:'a5:p3l20',product_code:'00036000291452'}],identity:{merchant:null,purchase_date:null,receipt_number:null},purchase_date:'2026-09-30'};
 assert.deepEqual(reviewSchema.parse(d),d);assert.equal(reviewSchema.safeParse({...d,transaction_id:5}).success,false);
});
test('cached enrichment changes names only; owner names/matches and repeated occurrences survive',async()=>{
 const input=[{name:'Abbreviation',product_code:'7622210453327',quantity:'1',price:'13.00',discount:'3.90'},
 {name:'My correction',product_code:'7622210453327',quantity:'1',price:'12.00',owner_edited_fields:['name','catalog_item_id'],catalog_item_id:null}];
 const original=JSON.stringify(input),p={code:'7622210453327',full_name:'Cookies · 156g',source:'open_food_facts'};
 const db={from(name){const data=name==='shopping_product_lookup_cache'?[{code:p.code,expires_at:'2099-01-01',result:{status:'found',product:p}}]:[];const q={select(){return q},in(){return q},eq(){return q},then(resolve){return resolve({data})}};return q;}};
 const rows=await enrichKnownProducts(input,db);
 assert.equal(rows.length,2);assert.equal(rows[0].name,'Abbreviation');assert.equal(rows[0].resolved_product.full_name,p.full_name);assert.equal(rows[1].name,'My correction');
 assert.equal(rows[1].catalog_item_id,null);assert.equal(rows[0].price,'13.00');assert.equal(rows[0].discount,'3.90');
 assert.equal(JSON.stringify(input),original);
});

test('reconciliation cannot replace an explicitly cleared owner catalog match',()=>{
 const {reconcile}=require('../services/shoppingHabitsService');
 const result=reconcile([],[{name:'Milk',quantity:'1',price:'2',catalog_item_id:null,owner_edited_fields:['catalog_item_id']}],[{id:7,name:'Milk'}]);
 assert.equal(result.items[0].catalog_item_id,null);
});
