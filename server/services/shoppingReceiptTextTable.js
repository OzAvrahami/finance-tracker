const {scaled,moneyText}=require('../../shared/receiptPricing.mjs');
// Validate the printed RTL grid, independently of the model. This adapter applies
// only when EVERY model occurrence has an ordered, unambiguous physical table row.
// Other layouts retain provider extraction and owner review; nothing is truncated.
function reconcileEmbeddedTable(section,source) {
  if(source.kind!=='pdf_text')return section;
  const groups=[];
  for(const run of JSON.parse(source.text)) {
    let group=groups.find(g=>Math.abs(g.y-run.y)<=2);
    if(!group){group={y:run.y,runs:[]};groups.push(group);}
    group.runs.push(run);
  }
  groups.sort((a,b)=>b.y-a.y);
  const rows=section.photos[0].items;
  const physical=[];
  for(let index=0;index<groups.length;index++) {
    const g=groups[index];
    const anchors=g.runs.filter(r=>/^\d{3,20}$/.test(r.text)).sort((a,b)=>a.x-b.x);
    for(const code of anchors) {
      const cells=g.runs.filter(r=>r.x<code.x&&/^\d{1,6}(?:\.\d{1,3})?$/.test(r.text)).sort((a,b)=>b.x-a.x);
      if(cells.length!==3||!/^\d+\.\d{2}$/.test(cells[0].text)||!/^\d+\.\d{2}$/.test(cells[2].text))continue;
      if(!g.runs.some(r=>r.x>code.x+code.width&&/[\p{L}]/u.test(r.text)))continue;
      physical.push({index,code:code.text,cells});
      break; // A number inside the product name/package is not a second grid row.
    }
  }
  if(!physical.length)return section;
  if(!rows.length)throw Object.assign(Error('receipt_text_rows_incomplete'),{status:422});
  if(physical.length!==rows.length||physical.some((p,i)=>p.code!==rows[i].product_code)) {
    if(physical.filter(p=>rows.some(r=>r.product_code===p.code)).length>=Math.ceil(rows.length*.8))
      throw Object.assign(Error('receipt_text_rows_incomplete'),{status:422});
    return section;
  }
  const totalX=physical[0].cells[2].x;
  const support=(start,end)=>{
    let cents=0n;const descriptions=[];
    for(const g of groups.slice(start,end)) {
      const text=g.runs.map(r=>r.text).join(' ');
      if(/כמות|quantity/i.test(text)&&/מחיר|price/i.test(text))continue;
      if(/סה.?כ|לתשלום|אשראי|מזומן|total|payment|balance/i.test(text))break;
      const amount=g.runs.filter(r=>Math.abs(r.x-totalX)<20&&/^[₪\s]*-\d{1,6}\.\d{2}$/.test(r.text));
      if(amount.length===1){cents+=scaled(amount[0].text.replace(/[^\d.]/g,''),2);descriptions.push(text);}
    }
    return {discount:moneyText(cents),description:descriptions.join(' · ').slice(0,300)};
  };
  const items=rows.map((row,i)=>{
    const p=physical[i],attached=support(p.index+1,physical[i+1]?.index??groups.length);
    return {...row,price:p.cells[0].text,quantity:p.cells[1].text,line_total:p.cells[2].text,
      discount:attached.discount,promotion:attached.description||row.promotion,
      layout_y:groups[p.index].y};
  });
  const leading=support(0,physical[0].index);
  return {...section,photos:[{...section.photos[0],items}],
    leading_support:leading.description?{...section.leading_support,quantity:null,unit:null,price:null,line_total:null,...leading}:section.leading_support};
}
module.exports={reconcileEmbeddedTable};
