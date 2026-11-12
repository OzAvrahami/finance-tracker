'use strict';
const fs=require('node:fs'),path=require('node:path');
const {startIntegrationFrontend}=require('./shoppingIntegrationFrontend');
module.exports=async function({fixture:f,assert}) {
  const root=path.resolve(__dirname,'../../..'),evidence=path.resolve(process.env.SHOPPING_BROWSER_EVIDENCE||'');
  assert(process.env.SHOPPING_BROWSER_EVIDENCE && !evidence.toLowerCase().startsWith(root.toLowerCase()),'Browser evidence must be outside the worktree');fs.mkdirSync(evidence,{recursive:true});
  const {chromium}=require(process.env.SHOPPING_PLAYWRIGHT_MODULE);
  let frontend,browser;const checks=[],blocked=[],requests=[],errors=[];
  try{
    frontend=await startIntegrationFrontend(f);const {origin}=frontend;
    browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'he-IL'});
    await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==origin){blocked.push(u.origin);return route.abort();}return route.continue();});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push({method:r.method(),path:new URL(r.url()).pathname});});page.on('dialog',d=>d.accept());
    const ready=()=>page.getByRole('button',{name:'קטגוריה חדשה',exact:true}).waitFor();
    const shot=name=>page.screenshot({path:path.join(evidence,name+'.png'),fullPage:true});
    const save=async()=>{await page.getByRole('dialog').getByRole('button',{name:'שמירה במסד המקומי',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});};
    await page.goto(origin+'/__shopping-integration');await page.getByLabel(/אימייל/).fill(f.users[0].email);await page.getByLabel(/סיסמה/).fill(f.users[0].password);await page.getByRole('button',{name:'התחברות',exact:true}).click();await ready();
    assert.equal(await page.getByRole('main').getAttribute('dir'),'rtl');checks.push('Existing React Login/AuthProvider → local Supabase Auth → authorized Express reads');
    await page.getByRole('button',{name:'קטגוריה חדשה',exact:true}).click();await page.getByRole('dialog').getByLabel(/^שם הקטגוריה/).fill('קטגוריית דפדפן');await page.getByLabel('סמל הקטגוריה',{exact:true}).fill('browser');await save();
    await page.getByRole('treeitem',{name:/^קטגוריית דפדפן/}).click();await page.getByRole('button',{name:'עריכת פרטי קטגוריה',exact:true}).click();
    await page.getByRole('dialog').getByLabel(/^שם הקטגוריה/).fill('קטגוריה נשמרה');await page.getByLabel('סמל הקטגוריה',{exact:true}).fill('saved-icon');await save();await page.reload();await ready();
    await page.getByRole('treeitem',{name:/^קטגוריה נשמרה/}).click();await page.getByRole('button',{name:'עריכת פרטי קטגוריה',exact:true}).click();assert.equal(await page.getByLabel('סמל הקטגוריה',{exact:true}).inputValue(),'saved-icon');assert.equal(f.sql("SELECT icon FROM shopping_catalog_categories WHERE name='קטגוריה נשמרה';"),'saved-icon');await shot('category-persisted-1440');await page.getByRole('dialog').getByRole('button',{name:'ביטול',exact:true}).click();checks.push('Combined category name/icon → HTTP → PostgreSQL → browser reload');
    await page.getByRole('tab',{name:'מוצרים',exact:true}).click();await page.getByRole('button',{name:'מוצר חדש',exact:true}).click();
    await page.getByLabel(/^שם המוצר/).fill('מוצר דפדפן');await page.getByLabel('מחיר ברירת מחדל',{exact:true}).fill('0');
    const categorySelect=page.getByRole('dialog').getByRole('combobox',{name:'קטגוריית יעד',exact:true});await categorySelect.selectOption({label:'קטגוריה נשמרה'});await save();
    await page.getByLabel('חיפוש מוצר',{exact:true}).fill('מוצר דפדפן');const productId=f.sql("SELECT id FROM shopping_catalog_items WHERE name='מוצר דפדפן';");
    await page.getByRole('button',{name:`עריכת מוצר ${productId}`,exact:true}).click();await page.getByLabel('יחידת ברירת מחדל',{exact:true}).fill('קופסה');await save();await page.reload();await ready();await page.getByRole('tab',{name:'מוצרים',exact:true}).click();await page.getByLabel('חיפוש מוצר',{exact:true}).fill('מוצר דפדפן');await page.getByRole('button',{name:`עריכת מוצר ${productId}`,exact:true}).click();assert.equal(await page.getByLabel('יחידת ברירת מחדל',{exact:true}).inputValue(),'קופסה');assert.equal(await page.getByLabel('מחיר ברירת מחדל',{exact:true}).inputValue(),'0');await shot('product-persisted-1440');await page.getByRole('dialog').getByRole('button',{name:'ביטול',exact:true}).click();checks.push('Product create/edit/zero → HTTP → PostgreSQL → browser reload');
    await page.getByRole('tab',{name:'סוגי רשימות',exact:true}).click();await page.getByLabel('סוג רשימה לעריכה',{exact:true}).selectOption('3');
    await page.getByRole('group',{name:'ענפי הרשימה'}).getByLabel('קטגוריה נשמרה',{exact:true}).check();await page.getByRole('button',{name:'סקירה ושמירת מיפוי',exact:true}).click();await save();await page.reload();await ready();await page.getByRole('tab',{name:'סוגי רשימות',exact:true}).click();await page.getByLabel('סוג רשימה לעריכה',{exact:true}).selectOption('3');assert.equal(await page.getByRole('group',{name:'ענפי הרשימה'}).getByLabel('קטגוריה נשמרה',{exact:true}).isChecked(),true);
    const catId=f.sql("SELECT id FROM shopping_catalog_categories WHERE name='קטגוריה נשמרה';");assert.equal(f.sql(`SELECT count(*) FROM shopping_catalog_category_list_types WHERE list_type_id=3 AND category_id=${catId};`),'1');await shot('branches-persisted-1440');checks.push('List-type replacement → HTTP → PostgreSQL → browser reload');
    await page.getByRole('tab',{name:'קטגוריות',exact:true}).click();await page.getByRole('treeitem',{name:/^קטגוריה נשמרה/}).click();await page.getByRole('button',{name:'שינוי שם',exact:true}).click();await page.getByRole('dialog').getByLabel(/^שם הקטגוריה/).fill('טיוטה נשמרת');
    const before=await fetch(f.endpoint+'/api/settings/shopping/catalog-categories/'+catId,{headers:{Authorization:'Bearer '+f.users[1].token}});
    const update=await fetch(f.endpoint+'/api/settings/shopping/catalog-categories/'+catId,{method:'PUT',headers:{Authorization:'Bearer '+f.users[1].token,'Content-Type':'application/json','If-Match':before.headers.get('etag'),'Idempotency-Key':require('node:crypto').randomUUID()},body:JSON.stringify({icon:'other-user'})});assert.equal(update.status,200);
    await page.getByRole('dialog').getByRole('button',{name:'שמירה במסד המקומי',exact:true}).click();await page.getByRole('dialog').getByText(/הקטלוג השתנה/).waitFor();assert.equal(await page.getByRole('dialog').getByLabel(/^שם הקטגוריה/).inputValue(),'טיוטה נשמרת');await shot('stale-draft');await page.getByRole('dialog').getByRole('button',{name:'ביטול',exact:true}).click();checks.push('Real concurrent writer produces stale feedback and preserves unsaved draft');
    await page.setViewportSize({width:390,height:844});await shot('integration-mobile-390');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));checks.push('RTL and mobile 390px overflow check');
    const preview=await context.newPage();await preview.goto(origin+'/__shopping-preview');await preview.getByRole('button',{name:'קטגוריה חדשה',exact:true}).waitFor();assert(await preview.getByText(/השינויים נשמרים בזיכרון/).isVisible());await preview.close();checks.push('Separate development-only in-memory preview still works');
    assert(blocked.every(origin=>origin==='https://fonts.googleapis.com'),JSON.stringify(blocked));assert.deepEqual(errors,[]);assert(requests.some(r=>r.method==='PUT'&&r.path.includes('/catalog-categories/')));assert(requests.some(r=>r.method==='PUT'&&r.path.includes('/catalog-items/')));
    assert.equal(f.sql('SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM shopping_list_items r;'),f.history);
    fs.writeFileSync(path.join(evidence,'browser-result.json'),JSON.stringify({url:origin+'/__shopping-integration',checks,requests,blocked,errors},null,2));console.log(JSON.stringify({browserUrl:origin+'/__shopping-integration',browserChecks:checks.length,screenshots:evidence}));
  }catch(error){if(browser){const pages=browser.contexts().flatMap(c=>c.pages());for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:path.join(evidence,`failure-${i}.png`),fullPage:true}).catch(()=>{});}throw error;}
  finally{if(browser)await browser.close();if(frontend)await frontend.close();}
};
