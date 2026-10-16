const { identifier } = require('./shoppingProductIdentifiers');
const { findCommercial, snapshot, validateMappingSnapshots } = require('./shoppingCommercialProducts');
const { unitCode } = require('../../shared/shoppingQuantities.mjs');
const { allocateReceipt, receiptPlanningQuantity } = require('../../shared/shoppingReceiptMatching.mjs');
const { merchantReview, merchantKey } = require('../../shared/shoppingMerchant.mjs');
async function prepareConfirmation(base, context, db, owner) {
  if (base.context_token !== context.token) throw Error('receipt_stale');
  const receipt = context.receipt;
  const review = merchantReview(context.store, base.identity ?? receipt.extracted?.identity,
    receipt.extracted?.identity_evidence?.merchant ?? [], context.token);
  if (review.state !== 'matched' && base.merchant_acknowledgment !== review.acknowledgment) throw Error('receipt_merchant_review_required');
  if (receipt.extracted?.identity_conflict && !base.identity_conflict_reviewed) throw Error('receipt_identity_review_required');
  let items = await validateMappingSnapshots(base.items, db);
  const planned = context.plan ?? [];
  items = await Promise.all(items.map(async row => {
    if (row.mapping_snapshot || !row.catalog_item_id) return row;
    const target = planned.find(p => String(p.catalog_item_id) === String(row.catalog_item_id));
    const code = row.lookup_code ?? row.product_code;
    const kind = row.identifier_kind ?? (identifier(code,'gtin','') ? 'gtin' : /^\d{3,7}$/.test(code??'') ? 'retailer' : null);
    if (!kind) return row; // An unreadable/invalid GTIN is not automatically a retailer SKU.
    const scope = kind === 'retailer' ? merchantKey(base.identity?.merchant) : '';
    const key = identifier(code, kind, row.retailer_scope || scope || '');
    if (!key || !target) return row;
    const existing = await findCommercial(db,key);
    if (existing?.mapping_revision) {
      if (String(existing.mapping?.personal_item_id) !== String(row.catalog_item_id)) throw Error('shopping_mapping_conflict');
      return { ...row, commercial_product_id: existing.id, mapping_snapshot: snapshot(existing.mapping) };
    }
    const factor = receiptPlanningQuantity({...row,quantity:'1'},target);
    return { ...row, identifier_kind:kind, retailer_scope:key.retailer_scope, _mapping: { ...key, action:'map', name:row.original_name??row.name,
      personal_item_id:String(row.catalog_item_id),expected_revision:0,
      receipt_unit:unitCode(row.unit),planning_unit:target.unit,planning_unit_code:unitCode(target.unit),factor,
      provenance:{source:'receipt_review'},
      package_quantity:row.package_quantity??(row.resolved_product?.owner_approved?row.resolved_product.package_quantity??null:null),
      package_unit:row.package_unit??(row.resolved_product?.owner_approved?row.resolved_product.package_unit??null:null) } };
  }));
  const fulfillment = allocateReceipt(context.current_items,items);
  // Only rows present in the frozen plan may receive receipt-driven checkmarks.
  const eligible = fulfillment.filter(p => p.status==='full' && planned.some(old =>
    old.list_item_id ? String(old.list_item_id)===String(p.list_item_id) && old.quantity===p.quantity && old.unit===p.unit && old.name===p.name
      : String(old.catalog_item_id)===String(p.catalog_item_id) && old.quantity===p.quantity && old.unit===p.unit && old.name===p.name));
  return { ...base, items, _owner:owner, _request:base, _fulfilled:eligible.map(p=>p.list_item_id),
    _merchant_state:review.state };
}
module.exports={prepareConfirmation};
