// Disposable PostgreSQL only. Never reads .env or application credentials.
const { before, after, test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const container = `finance-shopping-051-${process.pid}`;
let created = false,
  sequence = 0;
const read = (f) => fs.readFileSync(path.join(__dirname, "../..", f), "utf8");
const full = read("server/full_schema.sql");
function docker(args, input, allow = false) {
  const r = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    maxBuffer: 32e6,
    timeout: 90000,
  });
  if (!allow) assert.equal(r.status, 0, r.stderr || r.error?.message);
  return r;
}
const sql = (db, input, allow = false) =>
  docker(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      db,
      "-v",
      "ON_ERROR_STOP=1",
      "-Atq",
    ],
    input,
    allow,
  );
const scalar = (db, s) => sql(db, s).stdout.trim();
const q = (x) => `'${JSON.stringify(x).replaceAll("'", "''")}'::jsonb`;
const seed = (db) =>
  sql(
    db,
    `INSERT INTO shopping_list_types(id,name,slug) VALUES(1,'Super','super');INSERT INTO shopping_catalog_categories(id,name) VALUES(1,'Food');
 INSERT INTO shopping_catalog_items(id,category_id,name,default_unit,default_price) VALUES(1,1,'Milk','unit',5);
 INSERT INTO shopping_lists(id,title,list_type_id) VALUES(1,'Trip',1),(2,'Other trip',1);
 INSERT INTO shopping_list_items(list_id,catalog_item_id,category_id,quantity,unit,price,is_purchased) VALUES(1,1,1,2,'unit',5,true);`,
  );
const make = () => {
  const db = `case_${++sequence}`;
  sql("postgres", `CREATE DATABASE ${db} TEMPLATE shopping_clean;`);
  seed(db);
  sql(db, "INSERT INTO shopping_catalog_category_list_types(category_id,list_type_id) VALUES(1,1);");
  sql(db, "SELECT setval(pg_get_serial_sequence('shopping_catalog_categories','id'),1); SELECT setval(pg_get_serial_sequence('shopping_catalog_items','id'),1);");
  return db;
};
before(async () => {
  docker([
    "run",
    "-d",
    "--rm",
    "--name",
    container,
    "--label",
    "finance.disposable=shopping051",
    "-e",
    "POSTGRES_PASSWORD=local_test_only",
    "postgres:16-alpine",
  ]);
  created = true;
  const info = JSON.parse(docker(["inspect", container]).stdout)[0];
  assert.deepEqual(info.HostConfig.PortBindings || {}, {});
  for (let n = 0; n < 60; n++) {
    if (
      docker(
        ["exec", container, "pg_isready", "-U", "postgres"],
        undefined,
        true,
      ).status === 0
    )
      break;
    await new Promise((r) => setTimeout(r, 250));
  }
  sql(
    "postgres",
    "CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE DATABASE shopping_clean;",
  );
  sql("shopping_clean", full);
});
after(() => {
  if (created) docker(["rm", "-f", container]);
});

const add = (db, item, list=1) => JSON.parse(scalar(db, `SET ROLE service_role;SELECT shopping_add_planned_item(${list},${q(item)});`));

const asyncSql = (db, command) => new Promise((resolve,reject) => {
 const p=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-Atq']);
 let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);
 p.on('close',status=>resolve({status,out,err}));p.stdin.end(command);
});
test('051 upgrades applied 050 without rewriting categories, plans, items or financial state',()=>{
 const db='upgrade051';sql('postgres',`CREATE DATABASE ${db};`);sql(db,full.split('-- Migration 051:')[0]);seed(db);
 sql(db,"INSERT INTO shopping_catalog_categories(id,name) VALUES(10,'  Old   Name  '),(11,'old name'); INSERT INTO shopping_purchase_plans(list_id,items) VALUES(1,shopping_snapshot(1));");
 const fingerprint="SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM shopping_catalog_categories c;SELECT items FROM shopping_purchase_plans;SELECT shopping_snapshot(1);SELECT count(*) FROM transactions;";
 const before=scalar(db,fingerprint);sql(db,read('server/migrations/051_shopping_entry_categories.sql'));assert.equal(scalar(db,fingerprint),before);
 assert.match(sql(db,"INSERT INTO shopping_catalog_categories(name) VALUES('OLD NAME');",true).stderr,/shopping_category_exists/);
});
test('explicit identity and normalized exact names reuse scoped categories; partial is a distinct new name',()=>{
 const db=make();
 const exact=add(db,{custom_name:'Carrots',category_name:'  fOoD \t '});assert.equal(exact.category_id,1);assert.equal(exact.shopping_catalog_categories.name,'Food');
 const selected=add(db,{custom_name:'Carrots',category_id:1,category_name:'irrelevant stale label'});assert.equal(selected.category_id,1);
 const partial=add(db,{custom_name:'New',category_name:'Foo'});assert.notEqual(partial.category_id,1);assert.equal(partial.shopping_catalog_categories.name,'Foo');
 assert.equal(partial.catalog_item_id,null);
});
test('typed category is created only with valid item, canonical response includes it and reusable saving stays opt-in',()=>{
 const db=make();const before=scalar(db,'SELECT count(*) FROM shopping_catalog_items;');
 const a=add(db,{custom_name:'Tent',category_name:'  Camping\t\n Gear  ',unit:'unit',unit_mode:'controlled'});
 assert.equal(a.shopping_catalog_categories.name,'Camping Gear');assert.equal(a.catalog_item_id,null);
 assert.equal(scalar(db,'SELECT count(*) FROM shopping_catalog_items;'),before);
 const b=add(db,{custom_name:'Tent saved',category_name:'camping   gear',unit:'unit',unit_mode:'controlled',save_to_catalog:true});
 assert.equal(a.category_id,b.category_id);assert.ok(b.catalog_item_id);
 const none=add(db,{custom_name:'Gift',category_name:' \t '});assert.equal(none.category_id,-1);
});
test('all invalid item inputs are rejected before category resolution; later insertion failure rolls creation back',()=>{
 const db=make();const before=scalar(db,'SELECT count(*) FROM shopping_catalog_categories;');
 for(const bad of [{quantity:0},{quantity:'NaN'},{price:-1},{notes:'n'.repeat(2001)},{custom_name:''},{unit_mode:'controlled',unit:'arbitrary'},{unit_mode:'controlled',unit:'unit',quantity:'0.0001'},{category_name:'x'.repeat(301)}]) {
  const r=sql(db,`SELECT shopping_add_planned_item(1,${q({custom_name:'Bad',category_name:'Must not exist',...bad})});`,true);assert.notEqual(r.status,0);
 }
 assert.equal(scalar(db,'SELECT count(*) FROM shopping_catalog_categories;'),before);
 sql(db,"ALTER TABLE shopping_list_items ADD CONSTRAINT synthetic_insert_failure CHECK(custom_name IS DISTINCT FROM 'Fail insertion');");
 assert.match(sql(db,`SELECT shopping_add_planned_item(1,${q({custom_name:'Fail insertion',category_name:'Rolled back'})});`,true).stderr,/synthetic_insert_failure/);
 assert.equal(scalar(db,'SELECT count(*) FROM shopping_catalog_categories;'),before);
 assert.equal(scalar(db,"SELECT count(*) FROM shopping_catalog_category_list_types ct JOIN shopping_catalog_categories c ON ct.category_id=c.id WHERE c.name='Rolled back';"),'0');
});
test('incompatible scopes are never silently reused or extended; ambiguous historical names require explicit choice',()=>{
 const db=make();sql(db,"INSERT INTO shopping_list_types(id,name,slug) VALUES(3,'General','general');INSERT INTO shopping_lists(id,title,list_type_id) VALUES(3,'General',3);");
 for(const payload of [{category_name:' food '},{category_id:1}]) assert.match(sql(db,`SELECT shopping_add_planned_item(3,${q({custom_name:'Test',...payload})});`,true).stderr,/shopping_category_scope/);
 assert.equal(scalar(db,'SELECT count(*) FROM shopping_catalog_category_list_types WHERE list_type_id=3;'),'0');
 // Simulate already-existing normalization collisions, which migration 051 preserves.
 sql(db,"ALTER TABLE shopping_catalog_categories DISABLE TRIGGER shopping_category_name_guard;INSERT INTO shopping_catalog_categories(id,name) VALUES(20,' food ');ALTER TABLE shopping_catalog_categories ENABLE TRIGGER shopping_category_name_guard;INSERT INTO shopping_catalog_category_list_types VALUES(20,1,now());");
 assert.match(sql(db,`SELECT shopping_add_planned_item(1,${q({custom_name:'Test',category_name:'FOOD'})});`,true).stderr,/shopping_category_ambiguous/);
 assert.equal(add(db,{custom_name:'Explicit',category_id:20}).category_id,20);
});
test('concurrent submissions and retries resolve one category, while keeping intentional item occurrences separate',async()=>{
 const db=make();const payload={custom_name:'Tent',category_name:' Camping   Gear '};
 const results=await Promise.all([1,2,1,2].map(list=>asyncSql(db,`SELECT shopping_add_planned_item(${list},${q(payload)});`)));
 for(const r of results)assert.equal(r.status,0,r.err);
 const ids=results.map(r=>JSON.parse(r.out.trim()).category_id);assert.equal(new Set(ids).size,1);
 assert.equal(add(db,payload).category_id,ids[0]);
 assert.equal(scalar(db,"SELECT count(*) FROM shopping_catalog_categories WHERE shopping_category_key(name)='camping gear';"),'1');
 assert.equal(scalar(db,"SELECT count(*) FROM shopping_list_items WHERE custom_name='Tent';"),'5');
 // Legacy direct insert participates in the same normalization guard.
 const legacy=await Promise.all([' Gear Box ','gear   box'].map(name=>asyncSql(db,`INSERT INTO shopping_catalog_categories(name) VALUES('${name}');`)));
 assert.equal(legacy.filter(r=>r.status===0).length,1);
});
test('controlled units preserve catalog legacy values and quantities; unrestricted legacy callers stay compatible',()=>{
 const db=make();
 for(const unit of ['unit','kg','g','l','ml','pack','pair']) {const row=add(db,{custom_name:'500 grams in name',quantity:'0.125',unit,unit_mode:'controlled'});assert.equal(row.quantity,.125);assert.equal(row.unit,unit);}
 sql(db,"UPDATE shopping_catalog_items SET default_unit='custom legacy' WHERE id=1;");
 const row=add(db,{catalog_item_id:1,unit:'custom legacy',quantity:2,unit_mode:'controlled'});assert.equal(row.unit,'custom legacy');assert.equal(row.quantity,2);
 assert.match(sql(db,`SELECT shopping_add_planned_item(1,${q({catalog_item_id:1,unit:'invented',unit_mode:'controlled'})});`,true).stderr,/shopping_unit_invalid/);
 assert.equal(add(db,{custom_name:'Legacy API',unit:'custom legacy'}).unit,'custom legacy');
 assert.equal(scalar(db,'SELECT count(*) FROM transactions;SELECT count(*) FROM shopping_confirmed_purchases;'),'0\n0');
});
test('SQL and shared category normalization agree for Hebrew, English, NFKC and whitespace',()=>{
 const db=make();const {categoryDisplayName,categoryNameKey}=require('../../shared/shoppingEntryOptions.mjs');
 for(const name of ['  ציוד\t לטיולים  ',' A\u00a0 B ','Ｆｏｏｄ','\ufeffGIFT\n SHOP\u0085']) {
  const escaped=name.replaceAll("'","''");
  assert.equal(scalar(db,`SELECT shopping_category_display('${escaped}');`),categoryDisplayName(name));
  assert.equal(scalar(db,`SELECT shopping_category_key('${escaped}');`),categoryNameKey(name));
 }
});
