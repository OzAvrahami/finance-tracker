const {identifier}=require('./shoppingProductIdentifiers');
const {mappedQuantity}=require('../../shared/shoppingQuantities.mjs');
const unwrap=async q=>{const {data,error}=await q;if(error)throw error;return data;};
const snapshot=m=>m ? {commercial_product_id:m.commercial_product_id,revision:m.revision,
 personal_item_id:m.personal_item_id==null?null:String(m.personal_item_id),personal_name:m.personal_name,
 planning_unit:m.planning_unit,receipt_unit:m.receipt_unit,factor:m.factor==null?null:String(m.factor)} : null;
async function findCommercial(db,key) {
 if(!key)return null;
 const i=await unwrap(db.from('shopping_product_identifiers').select('commercial_product_id').eq('kind',key.kind).eq('retailer_scope',key.retailer_scope).eq('code',key.code).maybeSingle());
 return i?unwrap(db.rpc('shopping_commercial_detail',{p_id:i.commercial_product_id})):null;
}
function commercialProduct(p,key) {
 return {...key,commercial_product_id:p.id,full_name:p.approved_name??p.receipt_name,brand:p.brand??'',
  package_quantity:p.package_quantity==null?null:String(p.package_quantity),package_unit:p.package_unit,
  source:'owner_catalog',owner_approved:!!p.approved_name,mapping_revision:p.mapping_revision,mapping:snapshot(p.mapping)};
}
function applyCommercial(row,p,{replaceMapping=false}={}) {
 if(!replaceMapping&&!Object.hasOwn(row,'mapping_snapshot')&&row.owner_edited_fields?.includes('catalog_item_id'))return {...row,commercial_product_id:p.id};
 const mapping=Object.hasOwn(row,'mapping_snapshot')&&!replaceMapping?row.mapping_snapshot:snapshot(p.mapping);
 return {...row,commercial_product_id:p.id,mapping_snapshot:mapping,
   catalog_item_id:mapping?.personal_item_id??null};
}
async function hydrateCommercialRows(items,db) {
 const keys=[...new Map(items.map(r=>identifier(r.lookup_code??r.product_code,r.identifier_kind??'gtin',r.retailer_scope??'')).filter(Boolean).map(k=>[JSON.stringify(k),k])).values()];
 if(!keys.length)return items;
 const codes=[...new Set(keys.map(k=>k.code))];
 const identifiers=await unwrap(db.from('shopping_product_identifiers').select('kind,retailer_scope,code,commercial_product_id').in('code',codes));
 const products=new Map();
 for(const i of identifiers)if(!products.has(i.commercial_product_id))products.set(i.commercial_product_id,await unwrap(db.rpc('shopping_commercial_detail',{p_id:i.commercial_product_id})));
 return items.map(row=>{
  const k=identifier(row.lookup_code??row.product_code,row.identifier_kind??'gtin',row.retailer_scope??'');
  const i=k&&identifiers.find(i=>i.kind===k.kind&&i.retailer_scope===k.retailer_scope&&i.code===k.code);
  const p=i&&products.get(i.commercial_product_id);if(!p)return row;
  const r=applyCommercial(row,p);
  return {...r,...(p.approved_name?{resolved_product:commercialProduct(p,k),name:row.owner_edited_fields?.includes('name')?row.name:p.approved_name}:{} )};
 });
}
async function validateMappingSnapshots(items,db) {
 const result=[];
 for(const row of items) {
  if(!row.mapping_snapshot){result.push(row);continue;}
  const supplied=row.mapping_snapshot;
  const m=await unwrap(db.from('shopping_product_mappings').select('*').eq('commercial_product_id',supplied.commercial_product_id).eq('revision',supplied.revision).maybeSingle());
  if(!m||row.commercial_product_id!==m.commercial_product_id)throw Error('shopping_mapping_invalid');
  const key=identifier(row.lookup_code??row.product_code,row.identifier_kind??'gtin',row.retailer_scope??'');
  const p=await findCommercial(db,key);
  if(!p||p.id!==m.commercial_product_id)throw Error('shopping_mapping_invalid');
  // Immutable approved revision, not today's changed mapping. Never trust computed client totals.
  const frozen={...row,mapping_snapshot:snapshot(m),catalog_item_id:m.personal_item_id==null?null:String(m.personal_item_id)};
  const planning=mappedQuantity(frozen);
  result.push({...frozen,planning_quantity:planning?.quantity??null,planning_unit:planning?.unit??m.planning_unit??null});
 }
 return result;
}
module.exports={findCommercial,commercialProduct,applyCommercial,hydrateCommercialRows,validateMappingSnapshots,snapshot};
