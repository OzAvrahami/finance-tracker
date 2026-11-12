'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHierarchy } = require('./hierarchy');
const { planCategoryEdit, planCategoryCreate } = require('./categoryService');
const { categoryProjection, categoryHttpResponse } = require('./categoryResponse');
const { publicIntent } = require('../shared/catalogCommands');
const snapshot = { categories: [
  {id:-1,name:'System',parent_id:null,is_neutral:true,is_active:true},
  {id:1,name:'Root',parent_id:null,is_active:true},
  {id:2,name:'Child',parent_id:1,is_active:true},
  {id:3,name:'Hidden',parent_id:null,is_active:false},
], products:[{id:1,category_id:2,is_active:true},{id:2,category_id:2,is_active:false}] };
test('combined plan preserves final graph, zero order and icon canonicalization without mutating facts',()=>{
  const before=structuredClone(snapshot),tree=buildHierarchy(snapshot.categories);
  const plan=planCategoryEdit(tree,2,{name:' Renamed ',icon:' \uFEFFbox\u00a0',parent_id:3,is_active:true,display_order:0});
  assert.deepEqual(plan.changes,{name:'Renamed',icon:'box',parent_id:'3',is_active:true,display_order:0});
  const projection=categoryProjection(snapshot,plan);assert.equal(projection.effective_active,false);
  assert.deepEqual(projection.path,[{id:'3',name:'Hidden'},{id:'2',name:'Renamed'}]);
  assert.deepEqual(projection.counts,{direct_active:1,direct_total:2,subtree_active:1,subtree_total:2});assert.deepEqual(snapshot,before);
});
test('create icon is optional and empty/null clears without invented enum or name normalization',()=>{
  const tree=buildHierarchy(snapshot.categories);
  for(const icon of [null,' \uFEFF ']) assert.equal(planCategoryCreate(tree,{name:'New',parent_id:null,icon}).values.icon,null);
  assert.equal(planCategoryCreate(tree,{name:'New',parent_id:null,icon:' ＢＯＸ '}).values.icon,'ＢＯＸ');
});
test('combined input rejects empty/unknown/immutable fields and invalid null/type/order values',()=>{
  const tree=buildHierarchy(snapshot.categories);
  for(const input of [{},{id:2},{revision:'2'},{name:null},{icon:42},{icon:'a\0b'},{is_active:null},{display_order:2147483648},{parent_id:2},{parent_id:-1}])
    assert.throws(()=>planCategoryEdit(tree,2,input));
  for(const input of [{name:undefined},{icon:undefined},{display_order:undefined}]) assert.throws(()=>publicIntent('category.edit',2,input));
  assert.throws(()=>planCategoryEdit(tree,-1,{icon:'no'}),e=>e.code==='shopping_neutral_protected');
});
test('old identity-only ledger result fails closed at the future HTTP response boundary',()=>{
  assert.throws(()=>categoryHttpResponse({result:{id:'2'}}),e=>e.code==='shopping_legacy_result_unavailable');
  assert.throws(()=>categoryHttpResponse({result:{id:'2'},http:{status:200,headers:{ETag:'"bad"'}}}),e=>e.code==='shopping_commit_result_invalid');
});
