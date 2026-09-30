// Planning conversion only. Receipt quantities and all money remain untouched.
const token = value => typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase().replace(/[\s\u200e\u200f"'״׳‘’“”`]/g,'') : '';
const aliases = new Map([
  ['unit',['unit','units','יח','יחידה','יחידות']], ['package',['package','packages','חבילה','חבילות']], ['pack',['pack','מארז','מארזים']],
  ['kg',['kg','קג','קילוגרם']],['g',['g','גרם','גרמים']], ['l',['l','ליטר','ליטרים','liter','litre']], ['ml',['ml','מל','מיליליטר']],
].flatMap(([k,values])=>values.map(v=>[v,k])));
export const unitCode=value=>aliases.get(token(value))??null;
const dimensions={unit:['unit',1n],package:['package',1n],pack:['pack',1n],kg:['mass',1000n],g:['mass',1n],l:['volume',1000n],ml:['volume',1n]};
export function decimal(value,places=3) {
 const s=String(value??'');if(!new RegExp(`^\\d{1,6}(?:\\.\\d{1,${places}})?$`).test(s))return null;
 const [a,b='']=s.split('.');return BigInt(a)*10n**BigInt(places)+BigInt(b.padEnd(places,'0'));
}
export function quantityText(n) {return `${n/1000n}.${String(n%1000n).padStart(3,'0')}`.replace(/\.?0+$/,'');}
export function convertQuantity(quantity,from,to) {
 const q=decimal(quantity),a=dimensions[unitCode(from)],b=dimensions[unitCode(to)];
 if(q===null||!a||!b||a[0]!==b[0]||q*a[1]%b[1]!==0n)return null;
 return quantityText(q*a[1]/b[1]);
}
export function mappedQuantity(row) {
 const m=row.mapping_snapshot;
 if(!m?.personal_item_id || m.factor==null || !unitCode(row.unit) || unitCode(row.unit)!==m.receipt_unit)return null;
 const q=decimal(row.quantity),factor=decimal(m.factor,6);
 if(q===null||factor===null||q*factor%1000000n!==0n)return null;
 return {catalog_item_id:String(m.personal_item_id),name:m.personal_name,quantity:quantityText(q*factor/1000000n),unit:m.planning_unit};
}
export function planningRow(row) {
 // A frozen unresolved mapping must never fall back to package = litres.
 if(Object.hasOwn(row,'mapping_snapshot'))return mappedQuantity(row);
 return row.catalog_item_id?{catalog_item_id:String(row.catalog_item_id),name:row.name,quantity:String(row.quantity),unit:row.unit}:null;
}
export function aggregatePlanning(rows,target) {
 let total=0n,unresolved=0,occurrences=0;
 for(const row of rows) {
  const p=planningRow(row),id=row.mapping_snapshot?.personal_item_id??row.catalog_item_id;
  if(String(id)!==String(target.catalog_item_id??target.id))continue;
  occurrences++;
  const converted=p?convertQuantity(p.quantity,p.unit,target.unit):null;
  if(converted===null)unresolved++;else total+=decimal(converted);
 }
 return {quantity:quantityText(total),unit:target.unit,unresolved,occurrences};
}
export function packageFromText(value) {
 if(typeof value!=='string')return {package_quantity:null,package_unit:null};
 const m=value.trim().match(/^(\d{1,5}(?:[.,]\d{1,3})?)\s*(kg|g|ml|l|ק״ג|גרם|מ״ל|ליטר)$/i);
 return m?{package_quantity:m[1].replace(',','.'),package_unit:unitCode(m[2])}:{package_quantity:null,package_unit:null};
}
