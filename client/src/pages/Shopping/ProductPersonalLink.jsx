import {useRef,useState} from 'react';
import {mapShoppingProduct,getShoppingCatalogCategories} from '../../services/api';

import {productInput} from './receiptProductInput';
export default function ProductPersonalLink({row,catalog,listTypeId,merchant,onMapped}) {
 const [selected,setSelected]=useState(row.mapping_snapshot?.personal_item_id??row.catalog_item_id??''),[unit,setUnit]=useState(row.mapping_snapshot?.planning_unit??''),
  [receiptUnit,setReceiptUnit]=useState(row.unit??'יח׳'),[factor,setFactor]=useState(row.mapping_snapshot?.factor??''),
  [name,setName]=useState(''),[category,setCategory]=useState(''),[categories,setCategories]=useState([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const revision=useRef(row.resolved_product?.mapping_revision??row.mapping_snapshot?.revision??0),retry=useRef(null);
 const target=catalog.find(c=>String(c.id)===String(selected));
 async function choose(value) {
  setSelected(value);setFactor('');setUnit(catalog.find(c=>String(c.id)===value)?.default_unit??'');
  if(value==='new')try{const {data}=await getShoppingCatalogCategories(listTypeId);setCategories(data);}catch{setMessage('טעינת הקטגוריות נכשלה; אפשר לנסות שוב.');}
 }
 async function save() {
  setBusy(true);setMessage('');
  const body={...productInput(row,merchant),personal_item_id:selected&&selected!=='new'?String(selected):null,expected_revision:revision.current,
   receipt_unit:receiptUnit,planning_unit:selected?unit||target?.default_unit||null:null,factor:selected?factor||null:null,
   ...(selected==='new'?{new_personal:{name,unit,category_id:category}}:{})};
  const frozen=JSON.stringify(body);if(retry.current?.frozen!==frozen)retry.current={frozen,key:crypto.randomUUID()};
  try {const {data}=await mapShoppingProduct({...body,request_key:retry.current.key});revision.current=data.mapping_revision;
   onMapped(data);setMessage(data.mapping?.personal_item_id?(data.mapping.factor==null?'השיוך נשמר; המרת הכמות עדיין לא ידועה.':'השיוך נשמר להבא; היסטוריה קיימת לא השתנתה.'):'השיוך הוסר להבא.');
  }catch(e){setMessage(e.response?.data?.error==='shopping_mapping_stale'?'השיוך השתנה במקום אחר. פתחו מחדש את הפרטים לפני שינוי נוסף.':'השיוך לא נשמר; בדקו שם, יחידות או קוד ונסו שוב.');}finally{setBusy(false);}
 }
 return <details className="receipt-personal-link"><summary>שיוך לפריט אישי</summary>
  <div className="receipt-product-details">
   {!!row.suggested_personal_items?.length&&<span>לפי שם בלבד: {row.suggested_personal_items.map(p=><button key={p.id} type="button" disabled={busy} onClick={()=>choose(String(p.id))}>{p.name}</button>)}</span>}
   <label>פריט אישי <select aria-label="פריט אישי לשיוך" disabled={busy} value={selected} onChange={e=>choose(e.target.value)}><option value="">ללא שיוך</option>{catalog.map(c=><option key={c.id} value={String(c.id)}>{c.name}</option>)}<option value="new">יצירת פריט אישי…</option></select></label>
   {selected==='new'&&<><label>שם אישי <input aria-label="שם הפריט האישי החדש" value={name} maxLength={200} onChange={e=>setName(e.target.value)}/></label><label>קטגוריה <select aria-label="קטגוריית הפריט האישי" value={category} onChange={e=>setCategory(e.target.value)}><option value="">בחירה</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label></>}
   {!!selected&&<><label>יחידת קבלה <input aria-label="יחידת הכמות בקבלה" value={receiptUnit} onChange={e=>setReceiptUnit(e.target.value)}/></label><label>יחידת תכנון <input aria-label="יחידת תכנון לשיוך" value={unit} onChange={e=>setUnit(e.target.value)}/></label>
   <label>כמות תכנון לכל יחידת קבלה <input aria-label="מקדם המרה מאושר" type="number" step="0.000001" min="0.000001" placeholder="לפי יחידות או אריזה ידועה" value={factor} onChange={e=>setFactor(e.target.value)}/></label></>}
   <button type="button" disabled={busy||(selected==='new'&&(!name.trim()||!category||!unit.trim()))} onClick={save}>{selected==='new'?'יצירה ושיוך בלבד':'שמירת שיוך בלבד'}</button>
   {!!row.mapping_snapshot?.personal_item_id&&<span>{row.mapping_snapshot.personal_name} · {row.mapping_snapshot.factor??'המרה חסרה'} {row.mapping_snapshot.planning_unit} ליחידת קבלה</span>}
   {!!message&&<span role="status">{message}</span>}
  </div>
 </details>;
}
