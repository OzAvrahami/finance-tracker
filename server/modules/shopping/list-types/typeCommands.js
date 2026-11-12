'use strict';
const {fields,text}=require('../lists/listService');
const {requireRule}=require('../shared/errors');
const {identity}=require('../shared/contracts');
const {catalogView}=require('../shared/repository');
const {planCategoryCreate}=require('../categories/categoryService');
function planType(facts,intent){
 const {operation:op,id,body}=intent;
 if(op==='entry.category'){
  fields(body,['name','icon','parent_id','list_type_id']);const view=catalogView(facts);
  requireRule(body.parent_id!==null && body.parent_id!==undefined,'shopping_category_parent_required');
  const type=identity(body.list_type_id),scope=view.visibility.forListType(type);
  requireRule(scope.list_type_active && scope.category_ids.includes(identity(body.parent_id,{signed:true})),'shopping_category_scope');
  return {kind:op,values:planCategoryCreate(view.tree,{name:body.name,parent_id:body.parent_id,...(body.icon===undefined?{}:{icon:body.icon})}).values,list_type_id:type};
 }
 fields(body,op==='type.deactivate'?[]:['name','slug','is_active']);const values={};
 const current=op==='type.create'?null:facts.listTypes.find(t=>String(t.id)===identity(id));
 requireRule(op==='type.create'||current,'shopping_list_type_missing');
 for(const key of ['name','slug'])if(op==='type.create'||Object.hasOwn(body,key))values[key]=text(body[key],200,false);
 if(values.slug!==undefined)requireRule(/^[a-z0-9-]+$/.test(values.slug),'shopping_input_invalid');
 if(Object.hasOwn(body,'is_active')){requireRule(typeof body.is_active==='boolean','shopping_input_invalid');values.is_active=body.is_active;}
 if(op==='type.create')values.is_active=true;if(op==='type.deactivate')values.is_active=false;
 requireRule(Object.keys(values).length,'shopping_input_invalid');
 if(values.is_active===false)requireRule(!facts.lists.some(l=>String(l.list_type_id)===String(id)&&l.status!=='archived'),'shopping_list_type_in_use');
 requireRule(!facts.listTypes.some(t=>String(t.id)!==String(id)&&t.slug===(values.slug??current?.slug)),'shopping_uniqueness_conflict');
 return {kind:op,values};
}
module.exports={planType};
