import { convertQuantity, decimal, quantityText, mappedQuantity, unitCode } from './shoppingQuantities.mjs';
const words = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]/gu, ' ').split(/\s+/).filter(Boolean);
const variants = ['סויה','שקדים','שיבולת','טבעוני','טבעונית','ללא','soy','almond','oat','vegan','lactose'];
const compatible = (row, plan) => {
  const actual=words(row.original_name??row.name), required=words(`${plan.name} ${plan.notes??''}`);
  const approved=words(row.mapping_snapshot?.personal_name);
  const newRequirements=row.mapping_snapshot?words(plan.name).filter(t=>!approved.includes(t)):[];
  return !variants.some(v=>actual.includes(v)&&!required.includes(v)) && words(plan.notes).every(t=>actual.includes(t))
    && newRequirements.every(t=>actual.includes(t));
};
// All explicit plan tokens are requirements, including brand/diet/flavor/size.
export function suggestReceiptMatches(items, plan) {
  return items.map(row => {
    if (row.mapping_snapshot?.personal_item_id || row.catalog_item_id || row.planned_item_id || row.owner_edited_fields?.includes('catalog_item_id')) return row;
    const tokens = words(row.original_name ?? row.name);
    const candidates = plan.filter(p => (p.catalog_item_id||p.list_item_id) && words(`${p.name} ${p.notes??''}`).some(t => tokens.includes(t)));
    const clear = candidates.filter(p => compatible(row,p)&&words(`${p.name} ${p.notes??''}`).every(t => tokens.includes(t)));
    const unique = [...new Map(clear.map(p => [p.catalog_item_id?`catalog:${p.catalog_item_id}`:`list:${p.list_item_id}`, p])).values()];
    return { ...row, catalog_item_id: unique.length === 1 && unique[0].catalog_item_id ? String(unique[0].catalog_item_id) : null,
      planned_item_id:unique.length===1&&!unique[0].catalog_item_id?String(unique[0].list_item_id):null,
      match_requires_review: true, suggested_personal_items: [...new Map(candidates.filter(p=>p.catalog_item_id).map(p => [String(p.catalog_item_id), { id: String(p.catalog_item_id), name: p.name }])).values()] };
  });
}
export function receiptPlanningQuantity(row, target) {
  if (row.mapping_snapshot) {
    const p = mappedQuantity(row);
    return p ? convertQuantity(p.quantity, p.unit, target.unit) : null;
  }
  const direct = convertQuantity(row.quantity, row.unit, target.unit);
  if (direct !== null) return direct;
  // Package content is not its package count. Only explicit verified package data converts.
  const product = row.resolved_product?.owner_approved ? row.resolved_product : row.package_quantity ? {...row,owner_approved:true} : null;
  if (product?.package_quantity && ['unit','package'].includes(unitCode(row.unit)) && ['unit','package'].includes(unitCode(target.unit))) return row.quantity;
  if (!product?.owner_approved || !['unit','package'].includes(unitCode(row.unit))) return null;
  const factor = convertQuantity(product.package_quantity, product.package_unit, target.unit);
  const q = decimal(row.quantity), f = decimal(factor);
  return q !== null && f !== null && q * f % 1000n === 0n ? quantityText(q * f / 1000n) : null;
}
export function allocateReceipt(plan, rows) {
  const remaining = rows.map(r => decimal(r.quantity));
  return plan.map(p => {
    let allocated = 0n, unresolved = false;
    const required = decimal(p.quantity), matches = [];
    rows.forEach((r, index) => {
      const id = r.mapping_snapshot?.personal_item_id ?? r.catalog_item_id;
      const matchesTarget = id ? String(id)===String(p.catalog_item_id) : r.planned_item_id && String(r.planned_item_id)===String(p.list_item_id);
      if (!matchesTarget || remaining[index] === 0n) return;
      if(!compatible(r,p)&&!r.owner_edited_fields?.includes('catalog_item_id')) {unresolved=true;return;}
      const converted = receiptPlanningQuantity({ ...r, quantity: remaining[index] == null ? null : quantityText(remaining[index]) }, p);
      const available = decimal(converted);
      if (available === null || required === null) { unresolved = true; return; }
      const take = available < required - allocated ? available : required - allocated;
      if (take <= 0n) return;
      // Exact rational allocation only; never guess a conversion or duplicate quantity.
      if (available === 0n || remaining[index] * take % available !== 0n) { unresolved = true; return; }
      remaining[index] -= remaining[index] * take / available;
      allocated += take;
      matches.push({ row_id: r.row_id ?? String(index), name: r.name, quantity: quantityText(take) });
    });
    return { ...p, matches, purchased_quantity: quantityText(allocated),unresolved:unresolved?1:0,
      status: required !== null && allocated >= required ? 'full' : unresolved ? 'unresolved' : allocated > 0n ? 'partial' : 'absent' };
  });
}
