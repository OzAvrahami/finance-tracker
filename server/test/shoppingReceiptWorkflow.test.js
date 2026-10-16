const {test}=require('node:test');
const assert=require('node:assert/strict');
const sharp=require('sharp');
const {receiptLimits}=require('../services/shoppingReceiptLimits');
const {prepareSources,validateFiles}=require('../services/shoppingReceiptSources');
const {extractReceipt,mergeSources}=require('../services/shoppingReceiptExtractor');
const {prepareConfirmation}=require('../services/shoppingReceiptConfirmation');
const {reviewSchema}=require('../services/shoppingReceiptReview');
const {merchantReview,merchantKey}=require('../../shared/shoppingMerchant.mjs');
const {suggestReceiptMatches,allocateReceipt}=require('../../shared/shoppingReceiptMatching.mjs');
const {priceBreakdown}=require('../../shared/receiptPricing.mjs');
const env={SHOPPING_RECEIPT_OPENAI_KEY:'test-only',SHOPPING_RECEIPT_MODEL:'test-model'};
const identity={merchant:'יוחננוף',receipt_number:null,purchase_date:null};
const mayo={name:'מיונז תלמה 500 גרם',product_code:'7290000111186',quantity:'1',unit:'unit',price:'10.90',line_total:'10.90',discount:'0.00',package_quantity:'500',package_unit:'g',line_number:1};
const plan=[{list_item_id:'10',catalog_item_id:'1',name:'מיונז',quantity:'2',unit:'package'}];
const section=items=>({identity,photos:[{photo_number:1,items}],receipt_adjustments:[]});
const source=(n,kind='pdf_text',text='[]')=>({kind,source_number:n,file_number:1,page_number:kind==='photo'?null:n,text});
const completion=value=>({ok:true,status:200,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]})});

// Tiny synthetic PDF writer: test data only, no private document bytes.
function pdf(pages) {
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids=[];
  for(const text of pages){const page=objects.length+1,stream=page+1;kids.push(`${page} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 3 0 R >> >> /Contents ${stream} 0 R >>`);
    const content='BT /F1 12 Tf 20 560 Td '+(text.match(/.{1,50}/g)??['']).map(t=>`(${t}) Tj 0 -18 Td`).join(' ')+' ET';
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);}
  objects[1]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
  let result='%PDF-1.4\n';const offsets=[0];
  objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(result));result+=`${i+1} 0 obj\n${o}\nendobj\n`;});
  const xref=Buffer.byteLength(result);result+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('');
  return Buffer.from(result+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}
function scannedPdf(jpeg) {
  const stream=Buffer.from('q 400 0 0 600 0 0 cm /Scan Do Q');
  const objects=[Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /XObject << /Scan 5 0 R >> >> /Contents 4 0 R >>'),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),stream,Buffer.from('\nendstream')]),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 400 /Height 600 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,Buffer.from('\nendstream')])];
  let bytes=Buffer.from('%PDF-1.4\n');const offsets=[];
  objects.forEach((o,i)=>{offsets.push(bytes.length);bytes=Buffer.concat([bytes,Buffer.from(`${i+1} 0 obj\n`),o,Buffer.from('\nendobj\n')]);});
  const xref=bytes.length;
  return Buffer.concat([bytes,Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`)]);
}
test('ten real images use bounded batches, report all sources and preserve all occurrences',async()=>{
  const images=await Promise.all(Array.from({length:10},(_,i)=>sharp({create:{width:20,height:20,channels:3,background:{r:i*20,g:10,b:10}}}).png().toBuffer()));
  let active=0,peak=0,calls=0;const progress=[];
  const out=await extractReceipt(images,{env,onProgress:p=>progress.push(p),fetchImpl:async()=>{active++;peak=Math.max(peak,active);calls++;await new Promise(r=>setTimeout(r,5));active--;return completion({currency:'ILS',identity,items:[mayo]});}});
  assert.equal(calls,10);assert.equal(peak,2);assert.equal(out.sources.length,10);assert.equal(out.items.length,10);
  assert.equal(progress.at(-1).completed,10);assert.equal(out.items.at(-1).provenance[0].file_number,10);
  assert.ok(reviewSchema.safeParse({items:out.items,identity,purchase_date:'2026-10-01'}).success);
});
test('multipage mixed PDF selects text or rendered page exactly once; file and page limits differ',async()=>{
  const bytes=pdf(['Synthetic receipt Product item 12345678 quantity 1 unit price 10.90 total 10.90. '.repeat(3),'']);
  const out=await prepareSources([bytes]);assert.deepEqual(out.map(s=>s.kind),['pdf_text','pdf_scan']);assert.deepEqual(out.map(s=>s.page_number),[1,2]);
  assert.ok(out[1].image.length>0);assert.ok(JSON.parse(out[0].text).every(r=>typeof r.x==='number'));
  await assert.rejects(prepareSources([bytes],{limits:{...receiptLimits(),pdfPages:1}}),/receipt_pdf_pages/);
  assert.equal(validateFiles([bytes],{...receiptLimits(),files:1}).length,1);
  await assert.rejects(prepareSources([Buffer.from('%PDF-unreadable')]),/receipt_pdf_unreadable/);
});
test('unreadable/oversized decoded images and expired processing fail before provider calls',async()=>{
  let calls=0;
  await assert.rejects(extractReceipt(Buffer.from([255,216,255]),{env,fetchImpl:()=>calls++}),/receipt_image_decode/);
  const image=await sharp({create:{width:100,height:100,channels:3,background:'white'}}).png().toBuffer();
  await assert.rejects(prepareSources([image],{limits:{...receiptLimits(),pixels:100}}),/receipt_image_decode/);
  await assert.rejects(extractReceipt(image,{env,deadline:Date.now()-1,fetchImpl:()=>calls++}),/receipt_provider_timeout/);
  assert.equal(calls,0);
});
test('image-only scanned PDF is rendered and sent once to the image provider boundary',async()=>{
  const jpeg=await sharp(Buffer.from('<svg width="400" height="600"><rect width="400" height="600" fill="white"/><text x="20" y="80" font-size="24">Synthetic shop 10.90</text></svg>')).jpeg().toBuffer();
  let calls=0;
  const result=await extractReceipt(scannedPdf(jpeg),{env,fetchImpl:async(_,options)=>{
    calls++;const parts=JSON.parse(options.body).messages[1].content;
    assert.ok(parts.some(p=>p.type==='image_url'));assert.ok(!parts.some(p=>p.text?.includes('"x":')));
    return completion({currency:'ILS',identity,items:[mayo]});
  }});
  assert.equal(calls,1);assert.equal(result.sources[0].kind,'pdf_scan');assert.equal(result.items[0].provenance[0].page_number,1);
});
test('PDF repeated barcodes survive page boundaries; leading discount attaches once',()=>{
  const a=section([mayo,mayo,mayo].map((r,i)=>({...r,line_number:i+1})));
  const b={...section([{...mayo}]),leading_support:{discount:'2.00',quantity:null,unit:null,price:null,line_total:null,description:'discount'}};
  const out=mergeSources([a,b],[source(1),source(2)]);
  assert.equal(out.items.length,4);assert.equal(out.items[2].discount,'2.00');assert.equal(priceBreakdown(out.items[2]).final,'8.90');
  assert.deepEqual(out.items[2].provenance.map(p=>p.page_number),[1,2]);assert.equal(out.overlap_resolution.merged_count,0);
});
test('embedded grid verifies signed discounts, skips repeated header, and preserves weighted row totals',()=>{
  const runs=(y,code,quantity='1')=>[{text:'גרם',x:560,y,width:30},{text:'500',x:520,y,width:25},{text:'מיונז תלמה',x:450,y,width:65},{text:code,x:300,y,width:85},{text:'10.90',x:170,y,width:30},{text:quantity,x:110,y,width:20},{text:'10.90',x:30,y,width:30}];
  const first=source(1,'pdf_text',JSON.stringify(runs(400,mayo.product_code)));
  const second=source(2,'pdf_text',JSON.stringify([{text:'מחיר כמות לתשלום',x:30,y:800,width:200},{text:'הנחה',x:450,y:760,width:40},{text:'₪-2.00',x:30,y:760,width:40},...runs(700,mayo.product_code),{text:'הנחה',x:450,y:660,width:40},{text:'₪-1.20',x:30,y:660,width:40}]));
  const out=mergeSources([section([mayo]),section([mayo])],[first,second]);
  assert.equal(out.items.length,2);assert.equal(out.items[0].discount,'2.00');assert.equal(out.items[1].discount,'1.20');
  assert.equal(priceBreakdown(out.items[0]).final,'8.90');
  const omitted=source(1,'pdf_text',JSON.stringify([...runs(700,mayo.product_code),...runs(600,'1234567890123')]));
  assert.throws(()=>mergeSources([section([mayo])],[omitted]),/receipt_text_rows_incomplete/);
  assert.throws(()=>mergeSources([section([])],[omitted]),/receipt_text_rows_incomplete/);
});
test('merchant aliases, branches, unrelated stores, missing identity and revision-bound acknowledgment',async()=>{
  assert.equal(merchantKey('יוחננוף סניף 024'),merchantKey('Yohananof'));
  assert.equal(merchantReview('KSP',identity).state,'mismatch');assert.equal(merchantReview('שופרסל',identity).state,'mismatch');
  assert.equal(merchantReview(null,identity).state,'missing_store');assert.equal(merchantReview('יוחננוף',{},['יוחננוף','KSP']).state,'unresolved');
  const context={token:'a'.repeat(32),store:'KSP',receipt:{extracted:{}},plan,current_items:plan};
  const base={context_token:context.token,identity,items:[]};
  await assert.rejects(prepareConfirmation(base,context,{},'owner'),/receipt_merchant_review_required/);
  const ack=merchantReview(context.store,identity,[],context.token).acknowledgment;
  assert.equal((await prepareConfirmation({...base,merchant_acknowledgment:ack},context,{},'owner'))._merchant_state,'mismatch');
  await assert.rejects(prepareConfirmation({...base,merchant_acknowledgment:ack},{...context,token:'b'.repeat(32)},{},'owner'),/receipt_stale/);
});
test('mayonnaise maps generically, two packages remain partial, no quantity is allocated twice',()=>{
  const [matched]=suggestReceiptMatches([mayo],plan);assert.equal(matched.catalog_item_id,'1');assert.equal(matched.name,mayo.name);assert.equal(matched.product_code,mayo.product_code);
  assert.equal(allocateReceipt(plan,[matched])[0].status,'partial');
  const double=[{...plan[0],quantity:'1'},{...plan[0],list_item_id:'11',quantity:'1'}];
  assert.deepEqual(allocateReceipt(double,[matched]).map(p=>p.status),['full','absent']);
  assert.equal(allocateReceipt(plan,[{...matched,quantity:'2'}])[0].status,'full');
  assert.equal(allocateReceipt([{...plan[0],unit:'l'}],[matched])[0].status,'unresolved');
  assert.equal(suggestReceiptMatches([mayo],[{...plan[0],name:'מיונז טבעוני'}])[0].catalog_item_id,null);
  assert.equal(suggestReceiptMatches([mayo],[{...plan[0],name:'מיונז 250 גרם'}])[0].catalog_item_id,null);
  const saved={...matched,mapping_snapshot:{personal_item_id:'1',personal_name:'מיונז',receipt_unit:'unit',planning_unit:'package',factor:'1'}};
  assert.equal(allocateReceipt([{...plan[0],name:'מיונז טבעוני'}],[saved])[0].status,'unresolved');
});
test('freeform plan matches without manufacturing a parallel catalog',()=>{
  const custom=[{...plan[0],catalog_item_id:null}];const rows=suggestReceiptMatches([mayo],custom);
  assert.equal(rows[0].planned_item_id,'10');assert.equal(rows[0].catalog_item_id,null);assert.equal(allocateReceipt(custom,rows)[0].status,'partial');
});
module.exports={pdf};
