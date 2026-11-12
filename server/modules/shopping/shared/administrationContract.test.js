'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalIntent}=require('./requestIdentity');
const {catalogHttpResponse}=require('./catalogResponse');
const {publicIntent}=require('./catalogCommands');
test('logical request identity normalizes wire IDs and unordered selections without changing input',()=>{
 const a=publicIntent('product.bulk-category',null,{category_id:3,product_ids:[2,1]}),copy=structuredClone(a);
 assert.deepEqual(canonicalIntent(a),canonicalIntent(publicIntent('product.bulk-category',null,{product_ids:['1','2'],category_id:'3'})));
 assert.deepEqual(a,copy);
 assert.deepEqual(canonicalIntent(publicIntent('product.edit',1,{default_price:0})),canonicalIntent(publicIntent('product.edit','1',{default_price:'000.000'})));
});
test('request identity distinguishes omitted, null, changed values and selection multiplicity',()=>{
 const f=b=>canonicalIntent(publicIntent('product.edit',1,b));
 assert.notDeepEqual(f({name:'X'}),f({name:'X',default_unit:null}));
 assert.notDeepEqual(f({default_price:0}),f({default_price:null}));
 const b=ids=>canonicalIntent(publicIntent('branches.replace',1,{categoryIds:ids}));
 assert.notDeepEqual(b([1]),b([1,1]));assert.deepEqual(b([2,1]),b(['1','2']));
});
test('every legacy family fails closed without durable HTTP metadata',()=>{
 for(const op of ['category.create','category.edit','category.change','product.create','product.edit','product.deactivate','product.bulk-category','branches.replace'])
  assert.throws(()=>catalogHttpResponse({result:{id:'1'},http:null},{operation:op}),e=>e.code==='shopping_legacy_result_unavailable');
});
test('response adapter refuses cookie/auth/transport headers and incompatible status',()=>{
 const intent=publicIntent('branches.replace',1,{categoryIds:[]});
 const good={result:{linked:0},http:{status:200,headers:{ETag:'"'+'a'.repeat(64)+'"'}}};
 assert.equal(catalogHttpResponse(good,intent).body.linked,0);
 for(const name of ['Set-Cookie','Authorization','Date','X-Other'])assert.throws(()=>catalogHttpResponse({...good,http:{...good.http,headers:{...good.http.headers,[name]:'not-replayable'}}},intent));
 assert.throws(()=>catalogHttpResponse({...good,http:{...good.http,status:201}},intent));
});
