'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { createIsolatedDatabase } = require('./helpers/shoppingIsolatedDatabase');
const { approvedFixture } = require('../modules/shopping/list-types/fixtures/approvedTaxonomy');
const { createRepository } = require('../modules/shopping/shared/repository');
const { createPersistence, prepareCatalogCommand } = require('../modules/shopping/shared/persistence');
const { createCatalogCommands, publicIntent, decideCatalog } = require('../modules/shopping/shared/catalogCommands');
const { removeFunctions, retainFunctions } = require('../modules/shopping/shared/migrationReadiness');

const read = p => fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const migration=read('migrations/060_shopping_hierarchy_persistence.sql'), base=read('full_schema.sql');
const q = x => x===null ? 'NULL' : `'${String(typeof x==='object'?JSON.stringify(x):x).replaceAll("'","''")}'`;
let env, client, commands, endpoint, oldSnapshot, oldIdentity, initialInventory, initialFunctions, retainedBodies, upgradedCatalog;
const actor=randomUUID(), otherActor=randomUUID();
const sql=(s,db='postgres')=>env.sql(s,false,db).stdout.trim();
const json=(s,db)=>JSON.parse(sql(s,db));
const preserved=(database='postgres')=>sql(`SELECT jsonb_build_object('rows',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM shopping_list_items r),
 'plans',(SELECT jsonb_agg(to_jsonb(r) ORDER BY list_id) FROM shopping_purchase_plans r),
 'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM shopping_receipts r),
 'confirmed',(SELECT jsonb_agg(to_jsonb(r) ORDER BY list_id) FROM shopping_confirmed_purchases r),
 'cash',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM transactions r));`,database);
const inventory=()=>json(`SELECT jsonb_agg(oid::regprocedure::text ORDER BY oid::regprocedure::text) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'shopping_%';`);
const identityFields=()=>sql(`SELECT jsonb_build_object(
 'products',(SELECT jsonb_agg(to_jsonb(p)-ARRAY['category_id','revision','updated_at'] ORDER BY id) FROM shopping_catalog_items p),
 'categories',(SELECT jsonb_agg(jsonb_build_array(id,name,is_neutral) ORDER BY id) FROM shopping_catalog_categories WHERE id IN (${syntheticMapping().categories.map(c=>c.id).join(',')})),
 'types',(SELECT jsonb_agg(to_jsonb(t)-'revision' ORDER BY id) FROM shopping_list_types t));`);
const schemaCatalog=db=>json(`SELECT jsonb_build_object(
 'columns',(SELECT jsonb_agg(jsonb_build_array(table_schema,table_name,column_name,data_type,is_nullable,column_default) ORDER BY table_schema,table_name,ordinal_position) FROM information_schema.columns WHERE table_schema='shopping_private' OR (table_schema='public' AND table_name LIKE 'shopping_%')),
 'constraints',(SELECT jsonb_agg(jsonb_build_array(conrelid::regclass::text,conname,pg_get_constraintdef(oid)) ORDER BY conrelid::regclass::text,conname) FROM pg_constraint WHERE connamespace='shopping_private'::regnamespace OR conrelid IN(SELECT oid FROM pg_class WHERE relname LIKE 'shopping_%' AND relnamespace='public'::regnamespace)),
 'functions',(SELECT jsonb_agg(jsonb_build_array(oid::regprocedure::text,pg_get_functiondef(oid),proacl::text) ORDER BY oid::regprocedure::text) FROM pg_proc WHERE pronamespace='shopping_private'::regnamespace OR (pronamespace='public'::regnamespace AND proname LIKE 'shopping_%')),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname) FROM pg_policies p WHERE schemaname='public' AND tablename LIKE 'shopping_%'),
 'triggers',(SELECT jsonb_agg(pg_get_triggerdef(oid) ORDER BY tgname) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN(SELECT oid FROM pg_class WHERE relname LIKE 'shopping_%' AND relnamespace='public'::regnamespace)),
 'acl',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relrowsecurity,coalesce(c.relacl,acldefault('r',c.relowner))::text) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND (n.nspname='shopping_private' OR (n.nspname='public' AND c.relname LIKE 'shopping_%'))));`,db);

// PUBLIC taxonomy and deliberately artificial product allocation, not private rows.
function syntheticMapping() {
 if(process.env.SHOPPING_GATE2_MANIFEST) {
  // Read-only private mapping input. Only approved topology/identity dispositions
  // are used; all names outside the public taxonomy and every user field are synthetic.
  const m=JSON.parse(fs.readFileSync(process.env.SHOPPING_GATE2_MANIFEST,'utf8'));
  assert.equal(createHash('sha256').update(JSON.stringify(m.canonicalMapping.arrays)).digest('hex'),
   '7b4b0547363ebd6066aca8cee5871467cb0a1db1ed6271c36b7de80a6f8d4fdf');
  const [dictionary,dispositions,mapping,assignments]=m.canonicalMapping.arrays;
  const ids=new Map(dictionary.map(([code,,,reuse],i)=>[code,reuse??1000+i]));
  const target=dictionary.map(([code,parent,name])=>({id:ids.get(code),name,parent_id:parent===null?null:ids.get(parent),is_active:true}));
  const categories=dispositions.map(([id])=>({id,name:target.find(t=>t.id===id)?.name??`Synthetic historical ${id}`}));
  for(const c of categories)if(!target.some(t=>t.id===c.id))target.push({...c,parent_id:null,is_active:false});
  return {categories,target,products:mapping.map(([id,category_id,code],i)=>({id,category_id,target:ids.get(code),name:`Synthetic product ${i+1}`})),
   links:assignments.flatMap(([list_type_id,codes])=>[...new Set([...codes,'N'])].map(code=>({list_type_id,category_id:ids.get(code)})))};
 }
 const f=approvedFixture(), ids=new Map(f.categories.map((c,i)=>[String(c.id),c.is_neutral?-1:i===0?1:1000+i]));
 const target=f.categories.map(c=>({id:ids.get(String(c.id)),name:c.name,parent_id:c.parent_id===null?null:ids.get(String(c.parent_id)),is_active:true}));
 for(let i=2;i<=26;i++)target.push({id:i,name:`Synthetic historical ${i}`,parent_id:null,is_active:false});
 const categories=[{id:-1,name:'Synthetic neutral'},{id:1,name:target.find(c=>c.id===1).name},...target.filter(c=>!c.is_active)];
 const products=f.products.map((p,i)=>({id:i+1,name:`Synthetic product ${i+1}`,category_id:1+i%26,target:ids.get(String(p.category_id))}));
 const links=f.links.map(l=>({category_id:ids.get(String(l.category_id)),list_type_id:l.list_type_id}));
 for(let i=1;i<=6;i++)links.push({category_id:-1,list_type_id:i});
 return {categories,target,products,links};
}

function productionShape(db='postgres') {
 // Recorded differences, synthetic schema only. Preserve actual timestamp behavior.
 sql(`CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
 ALTER TABLE shopping_catalog_categories RENAME CONSTRAINT shopping_catalog_categories_name_key TO catalog_categories_name_key;
 ALTER TABLE shopping_catalog_items RENAME CONSTRAINT shopping_catalog_items_category_id_name_key TO catalog_items_category_id_name_key;
 ALTER TABLE shopping_list_types RENAME CONSTRAINT shopping_list_types_slug_key TO list_types_slug_key;
 ALTER TABLE shopping_catalog_items DROP CONSTRAINT shopping_catalog_items_category_id_fkey,
 ADD CONSTRAINT catalog_items_category_id_fkey FOREIGN KEY(category_id) REFERENCES shopping_catalog_categories(id) ON DELETE RESTRICT;
 ALTER TABLE shopping_catalog_category_list_types DROP CONSTRAINT shopping_catalog_category_list_types_category_id_fkey,
 DROP CONSTRAINT shopping_catalog_category_list_types_list_type_id_fkey,
 ADD CONSTRAINT category_list_types_category_id_fkey FOREIGN KEY(category_id) REFERENCES shopping_catalog_categories(id) ON DELETE CASCADE,
 ADD CONSTRAINT category_list_types_list_type_id_fkey FOREIGN KEY(list_type_id) REFERENCES shopping_list_types(id) ON DELETE CASCADE;
 ALTER TABLE shopping_lists DROP CONSTRAINT shopping_lists_list_type_id_fkey,
 ADD CONSTRAINT shopping_lists_list_type_id_fkey FOREIGN KEY(list_type_id) REFERENCES shopping_list_types(id) ON DELETE RESTRICT;
 ALTER TABLE shopping_list_items DROP CONSTRAINT shopping_list_items_catalog_item_id_fkey,
 DROP CONSTRAINT shopping_list_items_category_id_fkey, DROP CONSTRAINT shopping_list_items_list_id_fkey,
 ADD CONSTRAINT shopping_list_items_catalog_item_id_fkey FOREIGN KEY(catalog_item_id) REFERENCES shopping_catalog_items(id) ON DELETE SET NULL,
 ADD CONSTRAINT shopping_list_items_category_id_fkey FOREIGN KEY(category_id) REFERENCES shopping_catalog_categories(id) ON DELETE RESTRICT,
 ADD CONSTRAINT shopping_list_items_list_id_fkey FOREIGN KEY(list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE;
 ALTER TABLE shopping_checkouts DROP CONSTRAINT shopping_checkouts_list_id_fkey,
 ADD CONSTRAINT shopping_checkouts_list_id_fkey FOREIGN KEY(list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE;
 CREATE TRIGGER trg_shopping_lists_updated_at BEFORE UPDATE ON shopping_lists FOR EACH ROW EXECUTE FUNCTION set_updated_at();
 CREATE TRIGGER trg_shopping_list_items_updated_at BEFORE UPDATE ON shopping_list_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
 CREATE TRIGGER trg_catalog_categories_updated_at BEFORE UPDATE ON shopping_catalog_categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();
 CREATE TRIGGER trg_catalog_items_updated_at BEFORE UPDATE ON shopping_catalog_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
 GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
 DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['shopping_list_types','shopping_catalog_categories','shopping_catalog_items','shopping_catalog_category_list_types','shopping_lists','shopping_list_items','shopping_checkouts'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY synthetic_legacy_all ON public.%I FOR ALL USING(true)',t);
 EXECUTE format('GRANT ALL ON public.%I TO anon,authenticated,service_role',t); END LOOP; END $$;`,db);
}

function seedUpgrade() {
 const m=syntheticMapping();
 sql(`INSERT INTO shopping_list_types(id,name,slug) SELECT i,'Synthetic type '||i,'synthetic-'||i FROM generate_series(1,6)i;
 INSERT INTO shopping_catalog_categories(id,name) VALUES ${m.categories.filter(c=>c.id!==-1).map(c=>`(${c.id},${q(c.name)})`).join(',')};
 INSERT INTO shopping_catalog_items(id,name,category_id,default_price,default_unit) VALUES ${m.products.map(p=>`(${p.id},${q(p.name)},${p.category_id},0,'unit')`).join(',')};
 INSERT INTO shopping_lists(id,title,list_type_id) VALUES(1,'Synthetic history',1);
 INSERT INTO shopping_list_items(id,list_id,catalog_item_id,custom_name,category_id,quantity,unit,price,is_purchased,purchased_at,notes,created_at,updated_at)
 SELECT i,1,CASE WHEN i<=78 THEN (ARRAY[${m.products.slice(0,78).map(p=>p.id).join(',')}])[i] END,CASE WHEN i>78 THEN 'Synthetic custom '||i END,${m.categories.find(c=>c.id!==-1).id},1.125,'unit',CASE WHEN i%2=0 THEN 0 ELSE 3.40 END,
 i<=50,CASE WHEN i<=50 THEN '2026-01-02 12:34:56.123456Z'::timestamptz END,'Synthetic note',
 '2026-01-01 00:00:00Z',CASE WHEN i<=50 THEN '2026-01-02 12:34:56.123456Z'::timestamptz ELSE '2026-01-01 00:00:00Z'::timestamptz END FROM generate_series(1,85)i;
 INSERT INTO shopping_purchase_plans(list_id,items) VALUES(1,${q([{catalog_item_id:m.products[0].id,category_id:m.categories.find(c=>c.id!==-1).id,price:0,frozen:'synthetic'}])});
 INSERT INTO shopping_receipts(list_id,image_hash,image_hashes,state,extracted,review_draft) VALUES(1,repeat('a',64),ARRAY[repeat('a',64)],'review','{"identity":{"merchant":"Synthetic"}}','{"items":[]}');
 INSERT INTO transactions(description,total_amount,movement_type,transaction_date,charge_date) VALUES('Synthetic retained cash',12.34,'expense','2026-01-01','2026-01-01');
 SELECT setval(pg_get_serial_sequence('shopping_catalog_items','id'),${Math.max(...m.products.map(p=>p.id))});`);
 return `CREATE TEMP TABLE shopping_mapping_categories(id bigint PRIMARY KEY,name text,parent_id bigint,is_active boolean);
 CREATE TEMP TABLE shopping_mapping_products(id bigint PRIMARY KEY,category_id bigint);
 CREATE TEMP TABLE shopping_mapping_links(category_id bigint,list_type_id bigint,PRIMARY KEY(category_id,list_type_id));
 INSERT INTO shopping_mapping_categories VALUES ${m.target.map(c=>`(${c.id},${q(c.name)},${c.parent_id??'NULL'},${c.is_active})`).join(',')};
 INSERT INTO shopping_mapping_products VALUES ${m.products.map(p=>`(${p.id},${p.target})`).join(',')};
 INSERT INTO shopping_mapping_links VALUES ${m.links.map(l=>`(${l.category_id},${l.list_type_id})`).join(',')};`;
}

function localClient(role,sub=actor) {
 const key=env.token(role,sub), url=new URL(endpoint);
 assert.equal(url.hostname,'127.0.0.1');
 return createClient(endpoint,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
  const target=new URL(typeof input==='string'?input:input.url);
  assert.equal(target.origin,url.origin); assert.match(target.pathname,/^\/rest\/v1(?:\/|$)/);
  target.pathname=target.pathname.replace(/^\/rest\/v1/,'');
  return fetch(target,init);
 }}});
}
function service(c=client,authorized=true) {
 return createCatalogCommands({repository:createRepository(c),persistence:createPersistence(c),authorize:async()=>authorized});
}
async function prepared(operation,body,id=null,who=actor,key=randomUUID()) {
 const intent=publicIntent(operation,id,body);
 const repository=createRepository(client);
 const snap=await repository.readCatalog({operation,actor:who,key,id:intent.id,productIds:operation==='product.bulk-category'?[...body.product_ids].map(String).sort((a,b)=>Number(a)-Number(b)):[]});
 return prepareCatalogCommand({actor:who,key,intent,expected:snap.expected,decision:decideCatalog(intent,snap)});
}
async function execute(op,body,id=null,key=randomUUID(),who=actor) {
 const intent=publicIntent(op,id,body), snap=await createRepository(client).readCatalog({operation:op,actor:who,key,id:intent.id,
  productIds:op==='product.bulk-category'?[...body.product_ids].map(String).sort((a,b)=>Number(a)-Number(b)):[]});
 return commands.execute({user:{id:who},headers:{'If-Match':snap.etag,'Idempotency-Key':key},body},op,id);
}
const commit=p=>createPersistence(client).commitCatalog(p);
let sequence=0;
async function category(parent=null) {return (await execute('category.create',{name:`Synthetic case ${++sequence}`,parent_id:parent})).result.id;}
async function product(cat) {return (await execute('product.create',{name:`Synthetic case product ${++sequence}`,category_id:cat,default_price:0})).result.id;}
const rejects=(promise,code)=>assert.rejects(promise,e=>e.code===code);

before(async()=>{
 // Deliberately unusable ambient values demonstrate there is no hosted fallback.
 process.env.SUPABASE_URL='https://hosted.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='forbidden-fallback';
 env=await createIsolatedDatabase();
 // No environment URL/key is consulted. 059 is read from an explicit offline file.
 assert.ok(process.env.SHOPPING_059_BASELINE,'Explicit reviewed 059 file required');
 const text=fs.readFileSync(process.env.SHOPPING_059_BASELINE,'utf8');
 assert.equal(createHash('sha256').update(text).digest('hex'),'600d47c9eafd0bc069a7aecef2f83f58632c5035dcb885e738967cb94b1bc257');
 sql(base);sql(text);productionShape();
 initialInventory=inventory();initialFunctions=json(`SELECT jsonb_object_agg(oid::regprocedure::text,pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname NOT LIKE 'shopping_%';`);
 retainedBodies=json(`SELECT jsonb_object_agg(oid::regprocedure::text,pg_get_functiondef(oid)) FROM pg_proc WHERE oid::regprocedure::text IN (${retainFunctions.map(q).join(',')});`);
 const seed=seedUpgrade();oldSnapshot=preserved();oldIdentity=identityFields();
 const guard=`SET shopping.isolated_migration=${q(env.identity)};`;
 assert.match(env.sql(migration,true).stderr,/shopping_isolated_migration_required/);
 assert.match(env.sql(guard+migration,true).stderr,/shopping_complete_mapping_required/);
 assert.equal(preserved(),oldSnapshot);assert.deepEqual(inventory(),initialInventory);
 const failed=env.sql(guard+seed+migration.replace('COMMIT;','SELECT 1/0; COMMIT;'),true);
 assert.notEqual(failed.status,0);assert.match(failed.stderr,/division by zero/);assert.equal(preserved(),oldSnapshot);assert.deepEqual(inventory(),initialInventory);
 assert.equal(sql("SELECT to_regnamespace('shopping_private') IS NULL;"),'t');
 sql(guard+seed+migration);
 // Exercise a genuine 060 command before the upgrade, without any new response
 // fields. 061 must preserve it, not pretend its missing HTTP row is recoverable.
 const legacyId=String(syntheticMapping().target.find(c=>c.id>0&&c.is_active).id),legacyKey=randomUUID();
 const legacyIntent=publicIntent('category.change',legacyId,{type:'activate'});
 const legacySnapshot=json(`SELECT shopping_state('catalog',${q({actor,request_key:legacyKey,operation:'category.change',id:legacyId,product_ids:[]})});`);
 const legacyDecision=structuredClone(decideCatalog(legacyIntent,legacySnapshot));delete legacyDecision.response;
 const legacyResult=json(`SELECT shopping_catalog_commit(${q(actor)},${q(legacyKey)},${q(legacyIntent)},${q(legacySnapshot.expected)},${q(legacyDecision)});`);
 const legacyLedger=sql('SELECT jsonb_agg(to_jsonb(c) ORDER BY actor,request_key) FROM shopping_private.commands c;');
 const before061=schemaCatalog('postgres');
 const correction=read('migrations/061_shopping_category_contract.sql');
 assert.match(env.sql(correction,true).stderr,/shopping_isolated_migration_required/);
 assert.notEqual(env.sql(guard+correction.replace('COMMIT;','SELECT 1/0; COMMIT;'),true).status,0);
 assert.deepEqual(schemaCatalog('postgres'),before061);
 assert.equal(preserved(),oldSnapshot);
 sql(guard+read('migrations/061_shopping_category_contract.sql'));
 assert.equal(sql("SELECT jsonb_agg(to_jsonb(c)-'http' ORDER BY actor,request_key) FROM shopping_private.commands c;"),legacyLedger);
 const legacyReplay=json(`SELECT shopping_catalog_commit(${q(actor)},${q(legacyKey)},${q(legacyIntent)},'{}','{}');`);
 assert.deepEqual(legacyReplay.result,legacyResult.result);assert.equal(legacyReplay.http,null);
 assert.throws(()=>require('../modules/shopping/categories/categoryResponse').categoryHttpResponse(legacyReplay),e=>e.code==='shopping_legacy_result_unavailable');
 const productId=String(syntheticMapping().products[0].id),productIntent=publicIntent('product.edit',productId,{default_price:0});
 const productKey=randomUUID(),productSnap=json(`SELECT shopping_state('catalog',${q({actor,request_key:productKey,operation:'product.edit',id:productId,product_ids:[]})});`);
 // A genuine pre-062 mutation preserving the initial data/counts; retain its ledger.
 const oldProduct=json(`SELECT shopping_catalog_commit(${q(actor)},${q(productKey)},${q(productIntent)},${q(productSnap.expected)},${q(decideCatalog(productIntent,productSnap))});`);
 assert.equal(oldProduct.http,null);
 const before062=schemaCatalog('postgres'),ledger062=sql('SELECT jsonb_agg(to_jsonb(c) ORDER BY actor,request_key) FROM shopping_private.commands c;');
 const administration=read('migrations/062_shopping_administration_contract.sql');
 sql('COMMENT ON DATABASE postgres IS NULL;');
 try { assert.match(env.sql(administration,true).stderr,/shopping_isolated_migration_required/); }
 finally { sql(`COMMENT ON DATABASE postgres IS ${q(env.identity)};`); }
 assert.match(env.sql(administration,true).stderr,/shopping_isolated_migration_required/);
 assert.notEqual(env.sql(guard+administration.replace('COMMIT;','SELECT 1/0; COMMIT;'),true).status,0);
 assert.deepEqual(schemaCatalog('postgres'),before062);assert.equal(preserved(),oldSnapshot);
 sql(guard+administration);
 assert.equal(sql("SELECT jsonb_agg(to_jsonb(c)-'request_hash' ORDER BY actor,request_key) FROM shopping_private.commands c;"),ledger062);
 const oldProductReplay=json(`SELECT shopping_catalog_commit(${q(actor)},${q(productKey)},${q(productIntent)},'{}','{}');`);
 assert.deepEqual(oldProductReplay.result,oldProduct.result);assert.equal(oldProductReplay.http,null);
 assert.throws(()=>require('../modules/shopping/shared/catalogResponse').catalogHttpResponse(oldProduct,productIntent),e=>e.code==='shopping_legacy_result_unavailable');
 upgradedCatalog=schemaCatalog('postgres');
 endpoint=await env.startApi();client=localClient('service_role');commands=service();
 console.log(JSON.stringify({isolatedProject:env.identity,endpoint,databasePortPublished:false,databaseNetwork:'internal',apiGateway:'dedicated bridge, loopback port only',credentials:'generated for this run only',postgres:sql('SHOW server_version;'),postgrest:'16.5',mapping:process.env.SHOPPING_GATE2_MANIFEST?'checksum-bound classifications with synthetic fields':'public synthetic allocation'}));
});
after(async()=>{if(env)await env.close();});

test('migration rollback, 99/74/25/173/21/85 mapping and full historical/financial preservation',async()=>{
 assert.equal(preserved(),oldSnapshot);
 assert.equal(identityFields(),oldIdentity);
 assert.deepEqual(json('SELECT jsonb_agg(jsonb_build_array(id,category_id) ORDER BY id) FROM shopping_catalog_items;'),
  syntheticMapping().products.map(p=>[p.id,p.target]).sort((a,b)=>a[0]-b[0]));
 assert.deepEqual(json(`SELECT jsonb_build_array((SELECT count(*) FROM shopping_catalog_categories),(SELECT count(*) FROM shopping_catalog_categories WHERE is_active),(SELECT count(*) FROM shopping_catalog_categories WHERE NOT is_active),(SELECT count(*) FROM shopping_catalog_items),(SELECT count(*) FROM shopping_catalog_category_list_types),(SELECT count(*) FROM shopping_list_items));`),[99,74,25,173,21,85]);
 const view=await commands.read({user:{id:actor}});
 assert.deepEqual([1,2,3,4,5,6].map(id=>{const v=view.visibility.forListType(id);return[v.category_ids.length,v.product_ids.length];}),[[57,144],[11,19],[1,1],[10,21],[9,12],[11,21]]);
 assert.equal(view.product(1).default_price,'0');assert.equal(view.tree.neutralId,'-1');
});

test('fresh installation and upgraded schema converge; 059 financial definitions remain unchanged',()=>{
 sql('CREATE DATABASE restore_test;');sql(base,'restore_test');sql(fs.readFileSync(process.env.SHOPPING_059_BASELINE,'utf8'),'restore_test');productionShape('restore_test');
 sql(`COMMENT ON DATABASE restore_test IS ${q(env.identity)}; SET shopping.isolated_migration=${q(env.identity)};`+migration,'restore_test');
 sql(`SET shopping.isolated_migration=${q(env.identity)};`+read('migrations/061_shopping_category_contract.sql'),'restore_test');
 sql(`SET shopping.isolated_migration=${q(env.identity)};`+read('migrations/062_shopping_administration_contract.sql'),'restore_test');
 assert.deepEqual(schemaCatalog('restore_test'),upgradedCatalog);
 assert.deepEqual(json(`SELECT jsonb_object_agg(oid::regprocedure::text,pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname NOT LIKE 'shopping_%';`),initialFunctions);
 sql('DROP DATABASE restore_test;');
});

test('15 obsolete signatures and trigger absent, seven retained bodies and integrity triggers present',()=>{
 assert.deepEqual(initialInventory.filter(x=>!removeFunctions.includes(x)).sort(),[...retainFunctions].sort());
 const current=inventory();for(const sig of removeFunctions)assert.ok(!current.includes(sig));
 for(const sig of retainFunctions)assert.ok(current.includes(sig));assert.equal(current.length,9);
 assert.deepEqual(json(`SELECT jsonb_object_agg(oid::regprocedure::text,pg_get_functiondef(oid)) FROM pg_proc WHERE oid::regprocedure::text IN (${retainFunctions.map(q).join(',')});`),retainedBodies);
 const userFunctions=json("SELECT jsonb_agg(pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','shopping_private') AND p.prokind='f';");
 for(const sig of removeFunctions)assert.ok(!userFunctions.some(body=>new RegExp(`\\b${sig.split('(')[0]}\\s*\\(`).test(body)),`obsolete consumer remains: ${sig}`);
 assert.equal(sql("SELECT count(*) FROM pg_trigger WHERE tgname='shopping_category_name_guard';"),'0');
 assert.equal(sql("SELECT count(*) FROM pg_trigger WHERE tgname IN ('shopping_item_write_lock','trg_shopping_lists_updated_at','trg_shopping_list_items_updated_at','trg_catalog_categories_updated_at','trg_catalog_items_updated_at');"),'5');
});

test('two simultaneous same-sibling creates commit once and reject stale second decision',async()=>{
 const parent=await category(),body={name:'Repeated',parent_id:parent};
 const plans=await Promise.all([prepared('category.create',body),prepared('category.create',body)]);
 const results=await Promise.allSettled(plans.map(commit));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.code,'shopping_revision_stale');
 assert.equal(sql(`SELECT count(*) FROM shopping_catalog_categories WHERE parent_id=${parent};`),'1');
 await rejects(execute('category.create',body),'shopping_category_sibling_duplicate');
});

test('competing reparent requests cannot form an indirect cycle',async()=>{
 const a=await category(),b=await category();
 const plans=await Promise.all([prepared('category.change',{type:'reparent',parent_id:b},a),prepared('category.change',{type:'reparent',parent_id:a},b)]);
 const results=await Promise.allSettled(plans.map(commit));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.code,'shopping_revision_stale');
 await commands.read({user:{id:actor}}); // Gate 3A validates resulting full graph.
});

test('reparent races product reassignment through the same catalog guard',async()=>{
 const a=await category(),b=await category(),p=await product(a);
 const plans=await Promise.all([prepared('category.change',{type:'reparent',parent_id:b},a),prepared('product.edit',{category_id:b},p)]);
 const results=await Promise.allSettled(plans.map(commit));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.code,'shopping_revision_stale');
 await commands.read({user:{id:actor}});
});

test('deactivation races insertion without stale eligibility acceptance',async()=>{
 const a=await category();
 const plans=await Promise.all([prepared('category.change',{type:'deactivate'},a),prepared('product.create',{name:`Race ${++sequence}`,category_id:a})]);
 const results=await Promise.allSettled(plans.map(commit));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.code,'shopping_revision_stale');
});

test('same key concurrent execution, replay after stale ETag, and payload conflict',async()=>{
 const a=await category(),key=randomUUID(),body={name:`Once ${++sequence}`,category_id:a};
 const plans=await Promise.all([prepared('product.create',body,null,actor,key),prepared('product.create',body,null,actor,key)]);
 const results=await Promise.all(plans.map(commit));assert.equal(results.filter(r=>r.replayed).length,1);assert.deepEqual(results[0].result,results[1].result);
 const replay=await commands.execute({user:{id:actor},headers:{'Idempotency-Key':key},body},'product.create');assert.equal(replay.replayed,true);
 await rejects(commands.execute({user:{id:actor},headers:{'Idempotency-Key':key},body:{...body,name:'Changed'}},'product.create'),'shopping_key_conflict');
 assert.equal(sql(`SELECT count(*) FROM shopping_private.commands WHERE actor=${q(actor)} AND request_key=${q(key)};`),'1');
});

test('real C-X wait is observed, then concurrent stale If-Match decisions reject safely',async()=>{
 const a=await category(),b=await category(),key=randomUUID();
 const plans=await Promise.all([prepared('category.change',{type:'rename',name:`Context A ${++sequence}`},a,actor,key),
  prepared('category.change',{type:'rename',name:`Context B ${++sequence}`},b,otherActor,key)]);
 env.guard();
 const child=spawn('docker',['exec','-i',env.db,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq']);
 let err='';child.stderr.on('data',b=>err+=b);
 const locked=new Promise((resolve,reject)=>{child.stdout.on('data',b=>{if(String(b).includes('locked'))resolve();});child.on('error',reject);child.on('exit',c=>{if(c)reject(Error(err));});});
 const ended=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',c=>c?reject(Error(err)):resolve());});
 child.stdin.end("BEGIN; SELECT revision FROM shopping_private.catalog_state WHERE singleton FOR UPDATE; SELECT 'locked'; SELECT pg_sleep(2); COMMIT;");
 await locked;const pending=Promise.allSettled(plans.map(commit));
 await new Promise(r=>setTimeout(r,100));
 assert.ok(Number(sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%shopping_catalog_commit%';"))>=1);
 await ended;const results=await pending;assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.code,'shopping_revision_stale');
 const win=results.findIndex(r=>r.status==='fulfilled');
 assert.equal(sql(`SELECT count(*) FROM shopping_private.commands WHERE request_key=${q(key)} AND actor=${q(win===0?actor:otherActor)};`),'1');
 const staleRequest={user:{id:actor},headers:{'If-Match':'"obsolete"','Idempotency-Key':randomUUID()},body:{type:'rename',name:'Should not write'}};
 await rejects(commands.execute(staleRequest,'category.change',a),'shopping_revision_stale');
});

test('100-product batch failure after preliminary writes rolls back rows, revision and ledger',async()=>{
 const a=await category(),b=await category();
 sql(`INSERT INTO shopping_catalog_items(name,category_id,default_price) SELECT 'Batch '||i,${a},0 FROM generate_series(1,100)i;`);
 const ids=json(`SELECT jsonb_agg(id ORDER BY id) FROM shopping_catalog_items WHERE category_id=${a};`),key=randomUUID();
 const plan=await prepared('product.bulk-category',{product_ids:ids,category_id:b},null,actor,key);
 const state=()=>sql(`SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM shopping_catalog_items p),(SELECT revision FROM shopping_private.catalog_state), (SELECT count(*) FROM shopping_private.commands));`);
 const old=state();
 sql(`CREATE FUNCTION shopping_private.test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected test failure' USING ERRCODE='23514'; END $$;
 CREATE TRIGGER test_failure AFTER UPDATE ON shopping_catalog_items FOR EACH ROW WHEN(NEW.name='Batch 75') EXECUTE FUNCTION shopping_private.test_failure();`);
 await rejects(commit(plan),'shopping_reference_conflict');assert.equal(state(),old);
 sql('DROP TRIGGER test_failure ON shopping_catalog_items; DROP FUNCTION shopping_private.test_failure();');
 const result=await commit(plan);assert.equal(result.result.updated,100);assert.equal(sql(`SELECT count(*) FROM shopping_catalog_items WHERE category_id=${b};`),'100');
 assert.equal((await commit(plan)).replayed,true);
});

test('100-item batch containing a missing final identity is wholly rolled back by PostgreSQL',async()=>{
 const a=await category(),b=await category();
 const real=json('SELECT jsonb_agg(id ORDER BY id) FROM (SELECT id FROM shopping_catalog_items ORDER BY id LIMIT 99)p;');
 const ids=[...real,99999999],key=randomUUID(),intent=publicIntent('product.bulk-category',null,{product_ids:ids,category_id:b});
 const snap=await createRepository(client).readCatalog({operation:intent.operation,actor,key,productIds:ids.map(String)});
 const decision={kind:intent.operation,updates:ids.map(id=>({id:String(id),revision:snap.products.find(p=>p.id===String(id))?.revision??'1',changes:{category_id:b}}))};
 const before=sql('SELECT shopping_private.catalog_facts();');
 const r=await client.rpc('shopping_catalog_commit',{p_actor:actor,p_key:key,p_intent:intent,p_expected:snap.expected,p_decision:decision});
 assert.equal(r.error?.message,'shopping_revision_stale');assert.equal(sql('SELECT shopping_private.catalog_facts();'),before);
 assert.equal(sql(`SELECT count(*) FROM shopping_private.commands WHERE request_key=${q(key)};`),'0');
 await rejects(execute('product.bulk-category',{product_ids:ids,category_id:a}),'shopping_product_missing');
});

test('parallel updates to shared branch assignments use stale rejection, not partial replacement',async()=>{
 const a=await category(),b=await category();
 const plans=await Promise.all([prepared('branches.replace',{categoryIds:[a]},1),prepared('branches.replace',{categoryIds:[b]},2)]);
 const results=await Promise.allSettled(plans.map(commit));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.code,'shopping_revision_stale');
 for(const id of [1,2])assert.equal(sql(`SELECT count(*) FROM shopping_catalog_category_list_types WHERE list_type_id=${id} AND category_id=-1;`),'1');
});

test('neutral identity, sibling uniqueness, cycles and hard deletion have actual integrity enforcement',async()=>{
 const a=await category(),b=await category(a);
 for(const statement of ["UPDATE shopping_catalog_categories SET is_active=false WHERE id=-1;",
  "UPDATE shopping_catalog_categories SET name='Forged' WHERE id=-1;",`UPDATE shopping_catalog_categories SET parent_id=${b} WHERE id=${a};`,
  `UPDATE shopping_catalog_categories SET parent_id=-1 WHERE id=${a};`,`DELETE FROM shopping_catalog_categories WHERE id=${b};`,
  `INSERT INTO shopping_catalog_categories(name,parent_id) SELECT name,parent_id FROM shopping_catalog_categories WHERE id=${b};`])
  assert.notEqual(env.sql(statement,true).status,0);
 await rejects(execute('category.change',{type:'deactivate'},-1),'shopping_neutral_protected');
 await execute('category.change',{type:'rename',name:' Renamed   category '},a);
 assert.equal(sql(`SELECT name FROM shopping_catalog_categories WHERE id=${a};`),'Renamed category');
 await execute('category.change',{type:'deactivate'},a);
 await rejects(execute('product.create',{name:'Unavailable',category_id:b}),'shopping_category_unavailable');
 assert.equal(preserved(),oldSnapshot);
});

test('actual anon/authenticated/service table and sequence writes are denied; only service may commit',async()=>{
 const a=await category(),plan=await prepared('category.change',{type:'rename',name:'Authorized'},a);
 for(const role of ['anon','authenticated']) {
  const c=localClient(role);assert.ok((await c.rpc('shopping_catalog_commit',plan)).error);
  assert.ok((await c.rpc('shopping_state',{p_scope:'catalog',p_ids:{actor,operation:'catalog.read',product_ids:[]}})).error);
  assert.equal((await c.from('shopping_catalog_categories').select('id').limit(1)).error,null);
 }
 for(const role of ['anon','authenticated','service_role']) {
  assert.ok((await localClient(role).from('shopping_catalog_categories').update({name:'Denied'}).eq('id',a)).error);
  assert.notEqual(env.sql(`SET ROLE ${role}; SELECT nextval(pg_get_serial_sequence('shopping_catalog_categories','id'));`,true).status,0);
  assert.notEqual(env.sql(`SET ROLE ${role}; SELECT shopping_private.catalog_facts();`,true).status,0);
  assert.equal(sql(`SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'shopping_%'
   AND has_table_privilege(${q(role)},('public.'||tablename),'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');`),'0');
 }
 await commit(plan);assert.equal(sql(`SELECT name FROM shopping_catalog_categories WHERE id=${a};`),'Authorized');
 assert.equal(sql("SELECT count(*) FROM pg_tables t JOIN pg_class c ON c.oid=('public.'||t.tablename)::regclass WHERE t.schemaname='public' AND t.tablename LIKE 'shopping_%' AND NOT c.relrowsecurity;"),'0');
 assert.equal(sql("SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'shopping_%' AND cmd<>'SELECT';"),'0');
});

test('authenticated authorization failure, actor-scoped replay and cross-scope forgery are rejected',async()=>{
 const a=await category(),key=randomUUID(),body={name:`Actor bound ${++sequence}`,category_id:a};
 await execute('product.create',body,null,key);
 const other=await createRepository(client).readCatalog({operation:'product.create',actor:otherActor,key});assert.equal(other.command,null);
 await rejects(service(client,false).execute({user:{id:otherActor},headers:{'Idempotency-Key':key},body},'product.create'),'shopping_forbidden');
 const plan=await prepared('category.change',{type:'rename',name:'Scope bound'},a);
 const forged={...plan,p_actor:otherActor};assert.equal((await client.rpc('shopping_catalog_commit',forged)).error?.message,'shopping_revision_stale');
 const bad={...plan,p_expected:{...plan.p_expected,token:'forged'}};assert.equal((await client.rpc('shopping_catalog_commit',bad)).error?.message,'shopping_revision_stale');
 const wrong={...plan,p_intent:{...plan.p_intent,operation:'checkout'}};assert.ok((await client.rpc('shopping_catalog_commit',wrong)).error);
 const edited={...plan,p_decision:{...plan.p_decision,changes:{name:'Not requested'}}};assert.ok((await client.rpc('shopping_catalog_commit',edited)).error);
 await commit(plan);
});

test('zero amount survives actual Supabase/PostgREST serialization and editing',async()=>{
 const a=await category(),p=await product(a);assert.equal((await commands.read({user:{id:actor}})).product(p).default_price,'0');
 await execute('product.edit',{default_price:'0.0000'},p);assert.equal((await commands.read({user:{id:actor}})).product(p).default_price,'0.0000');
 await execute('product.edit',{default_price:null},p);assert.equal((await commands.read({user:{id:actor}})).product(p).default_price,null);
});

test('deep SQL parent chains and products on intermediate nodes remain compatible with Gate 3A',async()=>{
 const root=await category();
 sql(`DO $$ DECLARE parent bigint=${root}; BEGIN FOR i IN 1..256 LOOP
 INSERT INTO shopping_catalog_categories(name,parent_id) VALUES('Deep node '||i,parent) RETURNING id INTO parent;
 END LOOP; END $$;`);
 const leaf=sql("SELECT id FROM shopping_catalog_categories WHERE name='Deep node 256';");
 const p=await product(root),view=await commands.read({user:{id:actor}});
 assert.equal(view.tree.path(leaf).length,257);assert.equal(view.product(p).category_id,root);
});

test('PostgREST hoists the configured statement timeout and aborts every preliminary effect',async()=>{
 const a=await category(),key=randomUUID(),body={name:`Timeout ${++sequence}`,category_id:a};
 const plan=await prepared('product.create',body,null,actor,key),before=sql('SELECT shopping_private.catalog_facts();');
 sql(`CREATE FUNCTION shopping_private.timeout_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(20);RETURN NEW; END $$;
 CREATE TRIGGER timeout_probe AFTER INSERT ON shopping_catalog_items FOR EACH ROW EXECUTE FUNCTION shopping_private.timeout_probe();`);
 const start=Date.now();
 try { await rejects(commit(plan),'shopping_busy');assert.ok(Date.now()-start>=14000 && Date.now()-start<19000); }
 finally {sql('DROP TRIGGER timeout_probe ON shopping_catalog_items;DROP FUNCTION shopping_private.timeout_probe();');}
 assert.equal(sql('SELECT shopping_private.catalog_facts();'),before);assert.equal(sql(`SELECT count(*) FROM shopping_private.commands WHERE request_key=${q(key)};`),'0');
});

test('isolated backup restores schema, grants, durable replay and full synthetic history',async()=>{
 const before=schemaCatalog('postgres'),history=preserved(),facts=sql('SELECT shopping_private.catalog_facts();');
 const ledger=sql('SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY actor,request_key),\'[]\') FROM shopping_private.commands c;');
 const backup=env.backup();assert.ok(backup.includes('shopping_catalog_commit'));sql('CREATE DATABASE restore_test;');
 sql(backup,'restore_test');assert.deepEqual(schemaCatalog('restore_test'),before);assert.equal(preserved('restore_test'),history);
 assert.equal(sql('SELECT shopping_private.catalog_facts();','restore_test'),facts);
 assert.equal(sql('SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY actor,request_key),\'[]\') FROM shopping_private.commands c;','restore_test'),ledger);
 const first=json('SELECT to_jsonb(c) FROM shopping_private.commands c ORDER BY created_at LIMIT 1;','restore_test');
 const replay=json(`SET ROLE service_role; SELECT shopping_catalog_commit(${q(first.actor)},${q(first.request_key)},${q(first.intent)},'{}','{}');`,'restore_test');
 assert.equal(replay.replayed,true);assert.deepEqual(replay.result,first.result);
 assert.equal(sql("SELECT has_table_privilege('service_role','shopping_catalog_items','UPDATE');",'restore_test'),'f');
 sql('DROP DATABASE restore_test;');
});

test('supported concurrent patterns left no database deadlocks or history changes',()=>{
 assert.equal(sql('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database();'),'0');
 assert.equal(preserved(),oldSnapshot);
});

require('./helpers/shoppingCategoryContractCases')({ test, assert, sql, json, execute, prepared, commit, category,
  actor, otherActor, q, rejects, preserved, getClient: () => client, getEnv: () => env, getHistory: () => oldSnapshot });
require('./helpers/shoppingAdministrationContractCases')({ test, assert, sql, json, execute, prepared, commit, category, product,
  actor, otherActor, q, rejects, preserved, getClient: () => client, getEnv: () => env, getHistory: () => oldSnapshot });


test('063 upgrades the production-shaped 060-062 lineage without rewriting preserved evidence',async()=>{
 const history=preserved(),identity=identityFields();
 env.guard();assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()"),env.identity);
 sql('SET shopping.isolated_migration='+q(env.identity)+';'+read('migrations/063_shopping_workflow_persistence.sql'));
 assert.equal(preserved(),history);assert.equal(identityFields(),identity);
 assert.equal(sql("SELECT has_function_privilege('authenticated','shopping_list_commit(uuid,uuid,jsonb,jsonb,jsonb)','EXECUTE')"),'f');
 sql("SELECT setval(pg_get_serial_sequence('shopping_lists','id'),(SELECT max(id) FROM shopping_lists))");
 const f=json('SELECT shopping_state(\'list\','+q({actor,operation:'list.create',id:null,item_id:null})+');');
 const intent={operation:'list.create',id:null,item_id:null,body:{title:'Upgrade workflow',list_type_id:'1'}};
 const effect=require('../modules/shopping/lists/listService').planList(f,intent);
 const result=json('SET ROLE service_role;SELECT shopping_list_commit('+[q(actor),q(randomUUID()),q(intent),q(f.expected),q(effect)].join(',')+');');
 assert.equal(result.committed,true);assert.equal(result.http.status,201);
 assert.equal(preserved(),history);
});
