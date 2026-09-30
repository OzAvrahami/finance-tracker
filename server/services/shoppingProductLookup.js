const {findCommercial,commercialProduct,hydrateCommercialRows}=require('./shoppingCommercialProducts');
const {packageFromText}=require('../../shared/shoppingQuantities.mjs');
const { identifier } = require('./shoppingProductIdentifiers');
const unwrap = async query => { const {data,error}=await query; if(error) throw error; return data; };
const clean = (v, max=200) => typeof v === 'string' && v.trim().length <= max ? v.trim() : '';
// Only Food Facts documents a staging host. Products Facts uses its documented
// public read-only catalog, explicitly labelled/cached as production catalog data.
const catalogEnvironment=(provider,environment)=>provider==='open_products_facts'||environment==='production'?'production':'staging';
const withPackage=p=>p?.package_size?{...packageFromText(p.package_size),...p}:p;
// Provider boundary: barcode and requested public product fields only. No receipt data.
async function fetchFoodProduct(code, {fetchImpl=fetch, env=process.env, provider='open_food_facts'}={}) {
  if (!identifier(code)) return {status:'invalid_identifier'};
  const staging = catalogEnvironment(provider,env.SHOPPING_PRODUCT_LOOKUP_ENV)==='staging';
  const domain=provider==='open_products_facts'?'openproductsfacts':'openfoodfacts';
  const origin = `https://world.${domain}.${staging?'net':'org'}`;
  const url = `${origin}/api/v3/product/${code}?fields=code,product_name_he,product_name,brands,quantity,product_type&lc=he`;
  try {
    const response = await fetchImpl(url, {redirect:'error', signal:AbortSignal.timeout(8000), headers:{
      'User-Agent':'FinanceTracker/1.4.0 (https://github.com/OzAvrahami/finance-tracker)',
      ...(staging ? {Authorization:'Basic '+Buffer.from('off:off').toString('base64')} : {}),
    }});
    if(response.status===404) return {status:'missing'};
    if(response.status===429) return {status:'rate_limited'};
    if(!response.ok) return {status:'unavailable'};
    const text = await response.text();
    if(text.length>65536) return {status:'invalid_response'};
    const p=JSON.parse(text)?.product;
    if(!p) return {status:'missing'};
    // Never normalize, pad, repair or fuzzy-match a returned barcode.
    if(p.code!==code || (p.product_type && p.product_type!==(provider==='open_products_facts'?'product':'food'))) return {status:'identifier_mismatch'};
    const name=clean(p.product_name_he)||clean(p.product_name);
    if(!name) return {status:'missing'};
    const brand=clean(p.brands,120), size=clean(p.quantity,80);
    const full=[name,...[brand,size].filter(v=>v && !name.toLowerCase().includes(v.toLowerCase()))].join(' · ');
    if(full.length>200) return {status:'invalid_response'};
    return {status:'found', product:{code,full_name:full,product_name:name,brand,package_size:size,
      language:clean(p.product_name_he)?'he':null,source:provider,...packageFromText(size),
      source_url:`${origin}/product/${code}`,license:'ODbL-1.0 / DbCL-1.0',environment:staging?'staging':'production'}};
  } catch(e) { return {status:e.name==='TimeoutError'?'timeout':'unavailable'}; }
}
function createProductLookup(db, options={}) {
  return async input => {
    const key=identifier(input.code,input.kind,input.retailer_scope);
    if(!key) return {status:'invalid_identifier'};
    const local=await findCommercial(db,key);
    if(local?.approved_name)return {status:'found',product:commercialProduct(local,key)};
    if(key.kind!=='gtin') return {status:'missing'};
    const environment=options.env?.SHOPPING_PRODUCT_LOOKUP_ENV ?? process.env.SHOPPING_PRODUCT_LOOKUP_ENV;
    const provider=input.provider??'open_food_facts';
    const namespace=catalogEnvironment(provider,environment);
    // DB lease bounds concurrency and the shared provider budget across server workers.
    const claim=await unwrap(db.rpc('shopping_claim_product_lookup',{p_code:key.code,p_environment:namespace,p_provider:provider}));
    if(!claim.claimed) return claim.result?.product?{...claim.result,product:withPackage(claim.result.product)}:claim.result;
    const result=await fetchFoodProduct(key.code,{...options,provider});
    const seconds=result.status==='found'?2592000:result.status==='missing'?86400:300;
    await unwrap(db.from('shopping_product_lookup_cache').update({result,expires_at:new Date(Date.now()+seconds*1000).toISOString()}).eq('code',key.code).eq('environment',namespace).eq('provider',provider));
    return result;
  };
}
async function enrichKnownProducts(items,db,environment=process.env.SHOPPING_PRODUCT_LOOKUP_ENV) {
 const rows=await hydrateCommercialRows(items,db);
 const codes=[...new Set(rows.map(r=>r.lookup_code??r.product_code).filter(v=>identifier(v)))];
 if(!codes.length)return rows;
 const cache=await unwrap(db.from('shopping_product_lookup_cache').select('*').in('code',codes));
 return rows.map(r=>{
  if(r.resolved_product?.owner_approved)return r;
  const code=r.lookup_code??r.product_code;
  const cached=cache.filter(c=>c.code===code && (!c.environment||c.environment===catalogEnvironment(c.provider,environment)) && new Date(c.expires_at)>new Date() && c.result?.status==='found').sort((a,b)=>(a.provider==='open_food_facts'?-1:1)-(b.provider==='open_food_facts'?-1:1))[0]?.result.product;
  // A sourced proposal is not an owner-approved name. Preserve current displayed edits.
  return cached?{...r,original_name:r.original_name??r.name,resolved_product:withPackage(cached)}:r;
 });
}
module.exports={fetchFoodProduct,createProductLookup,enrichKnownProducts};
