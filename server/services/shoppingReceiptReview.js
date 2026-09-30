const { z } = require('zod');
const { identifier } = require('./shoppingProductIdentifiers');
const text=z.string().max(200), value=z.string().max(30).nullable();
const source=z.object({photo_number:z.number().int().min(1).max(6),line_number:z.number().int().min(1).max(200)}).strict();
const conflict=z.object({field:z.string().max(40),values:z.array(value).max(12),resolution:z.string().max(40).optional()}).strict();
const mappingSchema=z.object({commercial_product_id:z.string().uuid(),revision:z.number().int().positive(),personal_item_id:z.string().regex(/^\d+$/).nullable(),personal_name:text.nullable(),planning_unit:value,receipt_unit:value,factor:value}).strict();
const product=z.object({code:z.string().regex(/^\d{3,20}$/),full_name:text,source:z.enum(['open_food_facts','open_products_facts','owner_catalog']),
  kind:z.enum(['gtin','retailer']).optional(),retailer_scope:z.string().max(120).optional(),catalog_item_id:z.string().regex(/^\d+$/).optional(),
  owner_approved:z.boolean().optional(),product_name:text.optional(),brand:text.optional(),package_size:text.optional(),
  commercial_product_id:z.string().uuid().optional(),mapping_revision:z.number().int().nonnegative().optional(),mapping:mappingSchema.nullable().optional(),
  package_quantity:value.optional(),package_unit:value.optional(),
  language:z.string().max(10).nullable().optional(),source_url:z.string().regex(/^https:\/\/world\.open(food|products)facts\.(org|net)\/product\/\d{8,14}$/).optional(),license:text.optional(),environment:z.enum(['staging','production']).optional()}).strict();
const reviewItemSchema=z.object({
 name:text,quantity:value,unit:value,price:value,catalog_item_id:z.union([z.string().regex(/^\d+$/),z.number().int().positive()]).nullable().optional(),
 row_id:z.string().max(120).optional(),original_name:text.optional(),product_code:z.string().regex(/^\d{3,20}$/).nullable().optional(),
 resolved_product:product.nullable().optional(),identifier_kind:z.enum(['gtin','retailer']).optional(),retailer_scope:z.string().max(120).optional(),
 lookup_status:z.string().max(40).optional(),lookup_code:z.string().regex(/^\d{0,20}$/).optional(),
 commercial_product_id:z.string().uuid().nullable().optional(),mapping_snapshot:mappingSchema.nullable().optional(),
 planning_quantity:value.optional(),planning_unit:value.optional(),
 suggested_personal_items:z.array(z.object({id:z.string(),name:text}).strict()).max(200).optional(),
 price_basis:z.enum(['legacy_net','line_discount']).optional(), original_unit_price:value.optional(),row_discount:value.optional(),printed_gross_total:value.optional(),
 line_total:value.optional(),discount:value.optional(),discount_percent:value.optional(),promotion:z.string().max(300).nullable().optional(),
 raw_price:z.object({gross_total:value,discount:value,original_unit_price:value,discount_percent:value.optional(),promotion:z.string().max(300).nullable().optional()}).strict().optional(),
 source_lines:z.array(source).max(6).optional(),photo_numbers:z.array(z.number().int().min(1).max(6)).max(6).optional(),
 source_readings:z.array(source.extend({name:text,product_code:value,quantity:value,unit:value,price:value,line_total:value,discount:value,discount_percent:value,promotion:z.string().max(300).nullable()})).max(6).optional(),
 possible_overlap_sources:z.array(source).max(12).optional(),overlap_uncertain:z.boolean().optional(),
 field_conflicts:z.array(conflict).max(10).optional(),resolved_conflicts:z.array(conflict).max(10).optional(),raw_unit_readings:z.array(value).max(12).optional(),
 owner_edited_fields:z.array(z.string().max(40)).max(20).optional(),
 match_requires_review:z.boolean().optional(),comparison:z.string().max(40).optional(),possible_substitutions:z.array(text).max(200).optional(),
}).strict();
const reviewSchema=z.object({items:z.array(reviewItemSchema).max(200),identity:require('./shoppingHabitsService').receiptIdentitySchema,
 purchase_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).strict();
function sourceIdentity(row,index,attempt) {
 return row.row_id ?? `a${attempt}:${row.source_lines?.length?row.source_lines.map(s=>`p${s.photo_number}l${s.line_number}`).join('-'):`r${index+1}`}`;
}
async function reviewProjection(items,attempt) {
 const {projectPrice}=await import('../../shared/receiptPricing.mjs');
 return items.map((r,i)=>({...projectPrice(r),row_id:sourceIdentity(r,i,attempt),original_name:r.original_name??r.name}));
}
async function confirmationItems(items) {
 const {priceBreakdown,scaled,moneyText}=await import('../../shared/receiptPricing.mjs');
 return items.map(input=>{
  const r=reviewItemSchema.parse(input),b=priceBreakdown(r);
  if(!r.name.trim() || !r.unit?.trim() || b.final===null || b.conflict || scaled(r.quantity,3)>10000000n) throw Error('receipt_invalid');
  if(r.resolved_product && !identifier(r.resolved_product.code,r.resolved_product.kind??'gtin',r.resolved_product.retailer_scope??'')) throw Error('receipt_invalid');
  return {...r,...(r.price_basis==='line_discount'?{price:b.net_unit_price,final_total:b.final,
    calculated_gross_total:moneyText(scaled(b.final,2)+scaled(r.row_discount,2))}:{} )};
 });
}
module.exports={reviewItemSchema,reviewSchema,reviewProjection,confirmationItems};
