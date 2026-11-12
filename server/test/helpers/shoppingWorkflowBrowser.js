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
  await page.getByRole('button',{name:'סגירת קנייה',exact:true}).click();await page.getByRole('button',{name:'סגירת הקנייה ויצירת תנועה',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(f.sql("SELECT count(*) FROM shopping_checkouts c JOIN shopping_lists l ON l.id=c.list_id WHERE l.title='Browser workflow' AND c.total_amount=0"),'1');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(evidence,'workflow-checkout-mobile.png'),fullPage:true});
  assert(blocked.every(o=>o==='https://fonts.googleapis.com'));assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(evidence,'workflow-browser.json'),JSON.stringify({url:frontend.origin+'/shopping',requests,blocked,errors,checks:['existing React/Auth/layout','list creation','custom catalog/list append','zero price edit','purchase toggle','reload persisted state','checkout one financial record','desktop/mobile screenshots']},null,2));
 }catch(e){if(page)await page.screenshot({path:path.join(evidence,'workflow-failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(evidence,'workflow-failure.json'),JSON.stringify({requests,errors},null,2));throw e;}
 finally{if(browser)await browser.close();if(frontend)await frontend.close();}
};
