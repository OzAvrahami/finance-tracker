export function productInput(row,merchant='',name=row.name) {
 const p=row.resolved_product;
 const kind=row.identifier_kind??p?.kind??'gtin';
 return {code:row.lookup_code??row.product_code??p?.code,kind,
  retailer_scope:kind==='retailer'?(row.retailer_scope??p?.retailer_scope??merchant??''):'',name,
  ...(p?.brand?{brand:p.brand}:{}),
  ...(p?.package_quantity&&p?.package_unit?{package_quantity:p.package_quantity,package_unit:p.package_unit}:{}),
  provenance:{source:p?.source??'owner',...(p?.environment?{environment:p.environment}:{}),...(p?.source_url?{source_url:p.source_url}:{}),...(p?.full_name?{full_name:p.full_name}:{})}};
}
