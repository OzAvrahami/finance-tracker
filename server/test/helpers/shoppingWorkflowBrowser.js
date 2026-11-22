'use strict';
const fs=require('node:fs'),path=require('node:path');
const {startIntegrationFrontend}=require('./shoppingIntegrationFrontend');
module.exports=async(f,assert)=>{
 const evidence=path.resolve(process.env.SHOPPING_BROWSER_EVIDENCE);
 assert(!evidence.startsWith(path.resolve(__dirname,'../../..')));fs.mkdirSync(evidence,{recursive:true});
 const {chromium}=require(process.env.SHOPPING_PLAYWRIGHT_MODULE);let frontend,browser,page;const requests=[],blocked=[],errors=[];
 try{
  frontend=await startIntegrationFrontend({...f,endpoint:f.workflowOrigin});browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==frontend.origin){blocked.push(new URL(route.request().url()).origin);return route.abort();}return route.continue();});
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push({method:r.method(),path:new URL(r.url()).pathname});});
  page.on('response',async r=>{if(r.status()>=400&&r.url().includes('/api/'))requests.push({status:r.status(),path:new URL(r.url()).pathname,error:await r.text().catch(()=>'<unavailable>')});});
  await page.goto(frontend.origin+'/shopping');await page.getByLabel(/אימייל/).fill(f.users[0].email);await page.getByLabel(/סיסמה/).fill(f.users[0].password);
  await page.getByRole('button',{name:'התחברות',exact:true}).click();await page.waitForURL(frontend.origin+'/');await page.goto(frontend.origin+'/shopping');
  await page.getByRole('button',{name:'רשימה חדשה',exact:true}).first().click();await page.locator('#shopping-list-title').fill('Browser workflow');
  await page.locator('#shopping-list-type').selectOption('1');await page.getByRole('button',{name:'יצירת הרשימה',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  const card=page.getByRole('article').filter({has:page.getByRole('heading',{name:'Browser workflow',exact:true})});await card.getByRole('button',{name:'פתיחה',exact:true}).click();
  await page.getByRole('combobox',{name:'מה צריך לקנות?',exact:true}).fill('Browser synthetic item');
  await page.getByRole('button',{name:'הוספה',exact:true}).click();
  await page.getByRole('button',{name:'עריכת Browser synthetic item',exact:true}).click();await page.getByLabel('מחיר: Browser synthetic item',{exact:true}).fill('0');
  await page.getByRole('button',{name:'שמירת פריט',exact:true}).click();await page.getByRole('button',{name:'סימון Browser synthetic item כנקנה',exact:true}).click();
  await page.getByRole('button',{name:'סימון Browser synthetic item כטרם נקנה',exact:true}).waitFor();
  await page.reload();await card.getByRole('button',{name:'פתיחה',exact:true}).click();
  await page.getByRole('button',{name:'סימון Browser synthetic item כטרם נקנה',exact:true}).waitFor();
  assert.equal(f.sql("SELECT i.is_purchased AND i.price=0 FROM shopping_list_items i JOIN shopping_lists l ON l.id=i.list_id WHERE l.title='Browser workflow'"),'t');
  await page.screenshot({path:path.join(evidence,'workflow-persisted-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'הפעלת הרשימה',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'הפעלת הרשימה',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  const {ledgerSnapshot,seedImportedExpense}=require('./shoppingCheckoutFixture');
  const expense=seedImportedExpense(f,'Body wash store'), before=ledgerSnapshot(f);
  await page.getByRole('button',{name:'סגירת קנייה',exact:true}).click();await page.getByLabel('סגירה ללא קישור',{exact:true}).check();await page.getByRole('button',{name:'אישור סגירת הקנייה',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(f.sql("SELECT count(*) FROM shopping_checkouts c JOIN shopping_lists l ON l.id=c.list_id WHERE l.title='Browser workflow' AND c.total_amount=0 AND c.transaction_id IS NULL AND c.payment_method IS NULL"),'1');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(evidence,'workflow-checkout-mobile.png'),fullPage:true});
  await verifyReceiptAndLinkedCheckout({f, page, origin:frontend.origin, evidence, assert, expense});
  assert.equal(ledgerSnapshot(f),before);
  assert(blocked.every(o=>o==='https://fonts.googleapis.com'));assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(evidence,'workflow-browser.json'),JSON.stringify({url:frontend.origin+'/shopping',requests,blocked,errors,checks:['existing React/Auth/layout','list creation','custom catalog/list append','zero price edit','purchase toggle','reload persisted state','checkout without a financial link','three separate SKUs, approval, undo, save and reopen','desktop/mobile navigation and scroll','receipt approval into history','existing imported expense linked without ledger changes']},null,2));
 }catch(e){if(page)await page.screenshot({path:path.join(evidence,'workflow-failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(evidence,'workflow-failure.json'),JSON.stringify({requests,errors},null,2));throw e;}
 finally{if(browser)await browser.close();if(frontend)await frontend.close();}
};

async function verifyReceiptAndLinkedCheckout({f, page, origin, evidence, assert, expense}) {
 const actor = { user:{id:f.users[0].id}, headers:{} };
 const commands = require('../../modules/shopping/shared/workflowCommands').createWorkflowCommands({supabase:f.client,authorize:async()=>true});
 async function post(path, body) {
  const response = await fetch(f.legacyEndpoint+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${f.users[0].token}`},body:JSON.stringify(body)});
  assert.equal(response.status,201);
  return response.json();
 }
 const list = await post('/lists',{title:'בדיקת סבון גוף',store:'Body wash store',list_type_id:1});
 const listPath = `/lists/${list.id}`, url = origin+`/shopping/${list.id}`;
 await post(listPath+'/items',{entry_mode:'name_first',custom_name:'סבון גוף',quantity:1,unit:'unit'});
 const rows = ['לבנדר','ורדים','הדרים'].map((name,i)=>({row_id:'soap-'+i,name,product_code:String(90100+i),quantity:'1',unit:'unit',price:i===0 ? '6.00' : '5.00', ...(i===0 ? {line_total:'6.00',discount:'1.00'} : {})}));
 await commands.execute(actor,'receipt.begin',String(list.id),{image_hash:'d'.repeat(64),image_hashes:['d'.repeat(64)],expected_attempt:0});
 await commands.execute(actor,'receipt.extracted',String(list.id),{attempt:1,extracted:{items:rows,receipt_total:'15.00',identity:{merchant:'Body wash store',purchase_date:'2026-11-01',receipt_number:'SOAP-3'}}});
 const button = name => page.getByRole('button',{name,exact:true});
 await page.setViewportSize({width:1440,height:1000});
 await page.goto(url+'/receipt');
 await page.locator('.shell-sidebar').waitFor();
 await button('עדכון ל־₪5.00').waitFor();
 await page.screenshot({path:path.join(evidence,'receipt-queue-desktop.png')});
 await page.setViewportSize({width:390,height:844});
 await page.locator('.rr-queue button').first().click();
 await page.screenshot({path:path.join(evidence,'receipt-evidence-mobile.png')});
 await button('עדכון ל־₪5.00').click();
 await page.setViewportSize({width:1440,height:1000});
 await button('פריטי הרשימה').click();
 for (let i=0;i<3;i++) {
  await button(i ? 'הוספת שורת קבלה' : 'עריכה').click();
  await page.getByRole('combobox',{name:i ? 'שורה נוספת' : 'שורה לשיוך'}).selectOption(String(i));
  await button('שמירה בטיוטה').click();
  if (i===0) await button('אשר שיוך').click();
 }
 await button('מחכים לאישור שיוך').click();
 await page.getByRole('searchbox').fill('הדרים');
 await page.getByText(/נרכשו 3 /).waitFor();
 assert.equal(await page.locator('.receipt-plan-match').count(),3);
 await page.screenshot({path:path.join(evidence,'receipt-desktop.png')});
 await button('אשר שיוך').first().click();
 await button('אשר שיוך').click();
 await page.getByText('0 מתוך 1 פריטים').waitFor();
 await button('שמירה ויציאה').click();await page.waitForURL(url);
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('link',{name:'בדיקת קבלה'}).click();
 await button('פריטי הרשימה').click();
 await page.getByText(/נרכשו 3 /).waitFor();
 assert.equal(await button('בטל אישור').count(),3);
 await button('עוד').click();await page.keyboard.press('Escape');
 await button('בטל אישור').nth(1).click();
 await button('מחכים לאישור שיוך').click();
 await page.getByText('1 מתוך 1 פריטים').waitFor();
 await page.screenshot({path:path.join(evidence,'receipt-mobile.png')});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const footer=await page.locator('.rr-footer').boundingBox(), menu=await button('עוד').boundingBox();
 assert(footer.y+footer.height<=menu.y+2, 'receipt actions overlap mobile navigation');
 await button('אשר שיוך').click();
 await page.locator('.rr-steps button').last().click();
 await page.getByLabel(/בדקתי את השורות/).check();
 await button('אישור להיסטוריה').click();
 await page.getByText('הקנייה בהיסטוריה',{exact:true}).waitFor();
 assert.equal(f.sql(`SELECT jsonb_array_length(items) FROM shopping_confirmed_purchases WHERE list_id=${list.id} AND basis='receipt'`),'3');
 await button('חזרה לרשימה').click();await page.waitForURL(url);
 await button('הפעלת הרשימה').click();
 await page.getByRole('dialog').getByRole('button',{name:'הפעלת הרשימה',exact:true}).click();
 await button('סגירת קנייה').click();
 await page.getByLabel('סגירה וקישור לתנועה קיימת',{exact:true}).check();
 await page.getByLabel(/חיפוש תנועה לפי/).fill('Body wash');
 await page.getByLabel('תנועת הוצאה לקישור').selectOption(expense);
 await page.screenshot({path:path.join(evidence,'linked-checkout-mobile.png')});
 await button('אישור סגירת הקנייה').click();
 await page.getByText(`סגירת הקנייה · תנועה מקושרת ${expense}`).waitFor();
 assert.equal(f.sql(`SELECT count(*) FROM shopping_confirmed_purchases WHERE list_id=${list.id} AND basis='receipt'`),'1');
}
