'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID,randomBytes,createHash}=require('node:crypto');
const express=require('express');
const {createClient}=require('@supabase/supabase-js');
const {createIsolatedDatabase}=require('./shoppingIsolatedDatabase');
const {approvedFixture}=require('../../modules/shopping/list-types/fixtures/approvedTaxonomy');
const {createAdministrationRouter}=require('../../modules/shopping/http/administrationRouter');
const q=x=>x===null?'NULL':`'${String(x).replaceAll("'","''")}'`;

async function createShoppingHttpFixture() {
  const env=await createIsolatedDatabase();let server;
  try {
    const sql=text=>env.sql(text).stdout.trim(),read=file=>fs.readFileSync(path.join(__dirname,'../..',file),'utf8');
    sql(read('full_schema.sql'));
    const baseline=fs.readFileSync(process.env.SHOPPING_059_BASELINE,'utf8');
    assert.equal(createHash('sha256').update(baseline).digest('hex'),'600d47c9eafd0bc069a7aecef2f83f58632c5035dcb885e738967cb94b1bc257');
    sql(baseline);
    for(const file of ['060_shopping_hierarchy_persistence.sql','061_shopping_category_contract.sql','062_shopping_administration_contract.sql']) {
      env.guard();assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),env.identity);
      sql(`SET shopping.isolated_migration=${q(env.identity)};`+read('migrations/'+file));
    }
    const f=approvedFixture(),id=value=>String(value)==='-99'?'-1':String(value),names=['סופר','סופר-פארם','חומרי בניה','לגו','כללי','בית'];
    const historical=Array.from({length:25},(_,i)=>String(20001+i));
    sql(`INSERT INTO shopping_list_types(id,name,slug) VALUES ${f.listTypes.map((t,i)=>`(${t.id},${q(names[i])},'synthetic-${i}')`).join(',')};
      INSERT INTO shopping_catalog_categories(id,name,parent_id,is_active) VALUES ${f.categories.filter(c=>!c.is_neutral).map(c=>`(${id(c.id)},${q(c.name)},${c.parent_id===null?'NULL':id(c.parent_id)},true)`).join(',')};
      INSERT INTO shopping_catalog_categories(id,name,parent_id,is_active) VALUES ${historical.map((h,i)=>`(${h},'היסטוריה בדיקה ${i+1}',NULL,false)`).join(',')};
      INSERT INTO shopping_catalog_items(id,name,category_id,default_unit,default_price) VALUES ${f.products.map((p,i)=>`(${p.id},'מוצר בדיקה ${i+1}',${id(p.category_id)},'יחידה',0)`).join(',')};
      INSERT INTO shopping_catalog_category_list_types(category_id,list_type_id) VALUES ${[...f.links.map(l=>`(${id(l.category_id)},${l.list_type_id})`),...f.listTypes.map(t=>`(-1,${t.id})`)].join(',')};
      SELECT setval(pg_get_serial_sequence('shopping_catalog_categories','id'),30000); SELECT setval(pg_get_serial_sequence('shopping_catalog_items','id'),200000);
      INSERT INTO shopping_lists(id,title,list_type_id) VALUES(1,'רשימה היסטורית לבדיקה',1);
      INSERT INTO shopping_list_items(id,list_id,catalog_item_id,category_id,quantity,price,is_purchased,purchased_at,notes)
      SELECT i,1,${f.products[0].id},${id(f.products[0].category_id)},1,0,i<=50,CASE WHEN i<=50 THEN '2026-01-01'::timestamptz END,'מלאכותי' FROM generate_series(1,85)i;`);
    const rest=await env.startApi(),auth=await env.startAuth();
    const transport=async(input,init)=>{
      const u=new URL(typeof input==='string'?input:input.url);assert.equal(u.origin,rest);
      const target=u.pathname.startsWith('/auth/v1/')?auth:rest;
      const p=u.pathname.replace(/^\/(auth|rest)\/v1/,'');assert(p.startsWith('/'));
      return fetch(target+p+u.search,{...init,redirect:'error'});
    };
    const key=env.token('service_role'),anon=env.token('anon');
    const client=createClient(rest,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:transport}});
    const users=[];
    for(let i=0;i<3;i++) {
      const email=`synthetic-${randomUUID()}@example.test`,password=randomBytes(24).toString('hex');
      const created=await client.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);
      const userClient=createClient(rest,anon,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:transport}});
      const signed=await userClient.auth.signInWithPassword({email,password});assert.ifError(signed.error);
      users.push({id:created.data.user.id,email,password,token:signed.data.session.access_token});
    }
    const app=express();
    app.use('/auth/v1',async(req,res)=>{
      // Browser gateway exposes normal Auth only, never Auth admin or database RPCs.
      if(!{ '/token':'POST','/user':'GET','/logout':'POST','/settings':'GET' }[req.path]
        || req.method !== { '/token':'POST','/user':'GET','/logout':'POST','/settings':'GET' }[req.path]) return res.status(404).end();
      let body='';for await(const chunk of req){body+=chunk;if(body.length>65536)return res.status(413).end();}
      const headers={'Content-Type':'application/json'};if(req.headers.authorization)headers.Authorization=req.headers.authorization;
      const r=await fetch(auth+req.url,{method:req.method,headers,...(body?{body}:{}),redirect:'error'});
      res.status(r.status).type('json').send(await r.text());
    });
    app.use('/api',createAdministrationRouter({supabase:client,isolation:{identity:env.identity,endpoint:rest,assert:env.guard},adminIds:users.slice(0,2).map(u=>u.id),historicalCategoryIds:historical,environment:{NODE_ENV:'test'}}));
    app.use((req,res)=>res.status(404).json({error:'Not found'}));
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    const endpoint=`http://127.0.0.1:${server.address().port}`;
    const history=sql('SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM shopping_list_items r;');
    return {env,client,users,anon,rest,auth,endpoint,sql,historical,history,
      async close(){await new Promise(resolve=>server.close(resolve));await env.close();}};
  } catch(error) {if(server)await new Promise(r=>server.close(r));await env.close();throw error;}
}
module.exports={createShoppingHttpFixture};
