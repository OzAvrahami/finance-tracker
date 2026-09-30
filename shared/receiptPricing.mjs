// Decimal strings only; quantity is thousandths, money is cents. Never use
// binary floating point to decide identity, discounts or price consistency.
export function scaled(value, places) {
  if(typeof value!=='string' || !new RegExp(`^\\d{1,6}(?:\\.\\d{1,${places}})?$`).test(value)) return null;
  const [a,b='']=value.split('.'); return BigInt(a)*10n**BigInt(places)+BigInt(b.padEnd(places,'0'));
}
export const moneyText = cents => `${cents/100n}.${String(cents%100n).padStart(2,'0')}`;
const divideUnit=(total,q)=> q>0n && total*1000n%q===0n ? moneyText(total*1000n/q) : null;
export function projectPrice(input) {
  const r={...input};
  // Preserve the meaning of all old prices: they are net unit prices.
  r.price_basis ??= 'legacy_net';
  r.original_unit_price ??= null;
  if(r.row_discount===undefined) r.row_discount=r.discount??null;
  r.printed_gross_total ??= r.line_total ?? null;
  r.raw_price ??= {gross_total:r.line_total??null,discount:r.discount??null,original_unit_price:null,
    discount_percent:r.discount_percent??null,promotion:r.promotion??null};
  const q=scaled(String(r.quantity??''),3),gross=scaled(r.printed_gross_total,2);
  // Gross/unit derivation is unavailable when the quantity itself conflicts.
  const quantityConflict=r.field_conflicts?.some(c=>c.field==='quantity') && !r.owner_edited_fields?.includes('quantity');
  if(r.original_unit_price===null && !r.owner_edited_fields?.includes('original_unit_price') && q>0n && gross!==null && !quantityConflict) r.original_unit_price=divideUnit(gross,q);
  return r;
}
export function priceBreakdown(input) {
  const r=projectPrice(input),q=scaled(String(r.quantity??''),3),net=scaled(String(r.price??''),2);
  if(q===null || q<=0n) return {row:r,units:null,final:null,net_unit_price:r.price??null,conflict:false};
  if(r.price_basis!=='line_discount') {
    const gross=scaled(r.printed_gross_total,2),discount=scaled(r.row_discount,2);
    const mismatch=net!==null && gross!==null && discount!==null && (q*net+500n)/1000n!==gross-discount;
    return {row:r,units:net===null?null:q*net,final:net===null?null:moneyText((q*net+500n)/1000n),net_unit_price:r.price??null,conflict:false,source_mismatch:mismatch};
  }
  const original=scaled(r.original_unit_price,2),discount=scaled(r.row_discount,2);
  // An explicit original-unit edit takes precedence over the immutable printed total.
  const gross=r.owner_edited_fields?.includes('original_unit_price')
    ? original===null?null:(original*q+500n)/1000n
    : scaled(r.printed_gross_total,2) ?? (original===null?null:(original*q+500n)/1000n);
  if(gross===null || discount===null) return {row:r,units:null,final:null,net_unit_price:null,conflict:false};
  if(discount>gross) return {row:r,units:null,final:null,net_unit_price:null,conflict:true};
  const total=gross-discount;
  return {row:r,units:total*1000n,final:moneyText(total),net_unit_price:divideUnit(total,q),conflict:false};
}
export function editPrice(input,key,value) {
  const row=projectPrice(input);
  row[key]=value===''?null:value;
  row.owner_edited_fields=[...new Set([...(row.owner_edited_fields??[]),key])];
  if(['original_unit_price','row_discount'].includes(key)) row.price_basis='line_discount';
  if(key==='price') row.price_basis='legacy_net'; // explicit net correction wins; no second subtraction
  if(row.price_basis==='line_discount') row.price=priceBreakdown(row).net_unit_price;
  return row;
}
