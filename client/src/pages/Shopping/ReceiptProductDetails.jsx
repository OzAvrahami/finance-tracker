import { useState } from "react";
import { lookupShoppingProduct, approveShoppingProduct } from "../../services/api";
import ProductPersonalLink from './ProductPersonalLink';
import {productInput} from './receiptProductInput';
const statusText = {
 missing:"לא נמצא שם מלא; שם הקבלה נשמר.",invalid_identifier:"הקוד אינו ברקוד תקין. בדקו ספרות או בחרו קוד פנימי של החנות.",
 rate_limited:"מגבלת חיפוש זמנית; נסו שוב בעוד דקה.",pending:"חיפוש הקוד כבר מתבצע; נסו שוב בקרוב.",
 unavailable:"מאגר המוצרים אינו זמין; שם הקבלה נשמר.",timeout:"החיפוש לא השיב בזמן; אפשר לנסות שוב.",
 identifier_mismatch:"הקוד בתשובה אינו תואם; לא הוחלף שם.",invalid_response:"תשובת המאגר אינה תקינה; לא הוחלף שם."
};
export default function ReceiptProductDetails({row,index,listTypeId,merchant,readOnly,onChange,onResolved,onMapped,catalog=[]}) {
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[provider,setProvider]=useState('open_food_facts');
 const code=row.lookup_code??row.product_code??'',kind=row.identifier_kind??'gtin',scope=row.retailer_scope??merchant??'';
 async function lookup() {
  setBusy(true);setMessage('');
  try { const {data}=await lookupShoppingProduct({code,kind,retailer_scope:kind==='retailer'?scope:'',provider});
   if(data.status==='found') { onResolved(data.product);setMessage(data.product.source==='owner_catalog'?'נמצא בקטלוג המאושר.':'נמצא קוד תואם; בדקו שהמוצר והאריזה נכונים.'); }
   else setMessage(statusText[data.status]??statusText.unavailable);
  } catch {setMessage(statusText.unavailable);} finally {setBusy(false);}
 }
 async function approve() {
  setBusy(true);setMessage('');
  try {
   const {data}=await approveShoppingProduct(productInput(row,merchant));
   onResolved(data);setMessage('שם המוצר אושר; פריט אישי וקנייה לא נוצרו.');
  } catch {setMessage('שמירת המוצר לא הושלמה. בדקו קוד, קטגוריה או התאמה קיימת; לא תיווצר התאמה כפולה.');} finally {setBusy(false);}
 }
 return <div className="receipt-product-details">
  <span>שם בקבלה: {row.original_name??row.name}</span>
  <span>קוד מודפס: <bdi>{row.product_code??'לא זוהה'}</bdi></span>
  {!readOnly && <>
   <label>קוד לחיפוש <input disabled={busy} aria-label={`קוד לחיפוש ${index+1}`} inputMode="numeric" maxLength={20} value={code} onChange={e=>onChange('lookup_code',e.target.value)} /></label>
   <label>סוג קוד <select disabled={busy} aria-label={`סוג קוד ${index+1}`} value={kind} onChange={e=>onChange('identifier_kind',e.target.value)}><option value="gtin">ברקוד GTIN</option><option value="retailer">קוד פנימי בחנות</option></select></label>
   {kind==='retailer' && <label>זהות החנות <input disabled={busy} aria-label={`זהות החנות ${index+1}`} value={scope} maxLength={120} onChange={e=>onChange('retailer_scope',e.target.value)}/></label>}
   <select aria-label={`מאגר שמות ${index+1}`} value={provider} disabled={busy} onChange={e=>setProvider(e.target.value)}><option value="open_food_facts">Open Food Facts</option><option value="open_products_facts">Open Products Facts · מאגר ציבורי</option></select>
   <button type="button" disabled={busy||!code} onClick={lookup}>חיפוש שם מלא</button>
   <button type="button" disabled={busy||!code||!row.name?.trim()} onClick={approve}>אישור שם נוכחי בלבד</button>
  </>}
  {!readOnly&&<ProductPersonalLink key={row.commercial_product_id??code} row={row} catalog={catalog} listTypeId={listTypeId} merchant={merchant} onMapped={onMapped}/>}
  {row.resolved_product && <span>שם ממקור: {row.resolved_product.full_name} · {row.resolved_product.source==='owner_catalog'?'שם מאושר':<a href={row.resolved_product.source_url} target="_blank" rel="noreferrer">{row.resolved_product.source==='open_products_facts'?'Open Products Facts':'Open Food Facts'} · ODbL / DbCL</a>}{row.resolved_product.environment==='staging'?' · סביבת בדיקה':row.resolved_product.environment==='production'?' · מאגר ציבורי':''}</span>}
  {!!message && <span role="status">{message}</span>}
 </div>;
}
