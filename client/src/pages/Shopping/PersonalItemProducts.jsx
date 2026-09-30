import {useState} from 'react';
import {getPersonalItemProducts} from '../../services/api';
import ProductPersonalLink from './ProductPersonalLink';
export default function PersonalItemProducts({catalog,listTypeId}) {
 const [selected,setSelected]=useState(''),[products,setProducts]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(id) {
  setSelected(id);setProducts([]);setError('');if(!id)return;
  setBusy(true);try{const {data}=await getPersonalItemProducts(id);setProducts(data);}catch{setError('טעינת השיוכים נכשלה.');}finally{setBusy(false);}
 }
 return <details className="shopping-personal-products"><summary>המוצרים המקושרים לפריטים שלי</summary>
  <select aria-label="הצגת מוצרים של פריט אישי" value={selected} disabled={busy} onChange={e=>load(e.target.value)}><option value="">בחירת פריט אישי</option>{catalog.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
  {!!error&&<span role="alert">{error}</span>}
  {selected&&!busy&&!products.length&&<span>אין מוצרים מקושרים. אפשר לשייך דרך פרטי שורה בקבלה.</span>}
  {products.map(p=><div key={p.commercial_product_id} className="shopping-smart-row"><span>{p.full_name} · <bdi>{p.code}</bdi></span>
    <ProductPersonalLink row={{name:p.full_name,product_code:p.code,identifier_kind:p.kind,retailer_scope:p.retailer_scope,commercial_product_id:p.commercial_product_id,resolved_product:p,mapping_snapshot:p.mapping,unit:p.mapping?.receipt_unit??'יח׳'}} catalog={catalog} listTypeId={listTypeId} onMapped={()=>load(selected)}/>
  </div>)}
 </details>;
}
