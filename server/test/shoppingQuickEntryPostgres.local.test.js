// Disposable PostgreSQL only. Never reads .env or application credentials.
const { before, after, test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const container = `finance-shopping-050-${process.pid}`;
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
const receipt = (db, action, data) =>
  JSON.parse(
    scalar(
      db,
      `SET ROLE service_role;SELECT shopping_receipt_command(1,'${action}',${q(data)});`,
    ),
  );
const hash = "a".repeat(64);
const lines = [
  {
    catalog_item_id: "1",
    name: "Milk",
    quantity: "2",
    unit: "unit",
    price: "5.00",
  },
];
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
  return db;
};
const extract = (db) => {
  receipt(db, "begin", { image_hash: hash });
  return receipt(db, "extracted", {
    attempt: 1,
    extracted: { currency: "ILS", items: lines },
  });
};
before(async () => {
  docker([
    "run",
    "-d",
    "--rm",
    "--name",
    container,
    "--label",
    "finance.disposable=shopping050",
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
test('050 upgrades the 049 schema without changing existing rows, plans or checkmarks', () => {
 const db='upgrade050'; sql('postgres',`CREATE DATABASE ${db};`);
 sql(db,full.split('-- Migration 050:')[0]); seed(db);
 sql(db,'INSERT INTO shopping_purchase_plans(list_id,items) VALUES(1,shopping_snapshot(1));');
 const before=scalar(db,'SELECT items FROM shopping_purchase_plans;SELECT shopping_snapshot(1);');
 sql(db,read('server/migrations/050_shopping_quick_entry.sql'));
 assert.equal(scalar(db,'SELECT items FROM shopping_purchase_plans;SELECT shopping_snapshot(1);'),before);
 assert.equal(scalar(db,"SELECT count(*) FROM pg_trigger WHERE tgname='shopping_item_write_lock' AND tgenabled='O';"),'1');
});
test('list-only default, repeated occurrences and neutral scoping including a new type with no categories',()=>{
 const db=make();sql(db,"INSERT INTO shopping_list_types(id,name,slug) VALUES(3,'General','general');INSERT INTO shopping_lists(id,title,list_type_id) VALUES(3,'Gifts',3);");
 const before=scalar(db,'SELECT count(*) FROM shopping_catalog_items;');
 const a=add(db,{custom_name:'Gift for Dana'},3),b=add(db,{custom_name:'Gift for Dana'},3);
 assert.equal(a.catalog_item_id,null);assert.equal(a.quantity,1);assert.notEqual(a.id,b.id);
 assert.equal(a.category_id,b.category_id);assert.equal(a.category_id,-1);
 assert.equal(scalar(db,'SELECT count(*) FROM shopping_catalog_items;'),before);
 assert.equal(scalar(db,'SELECT count(*) FROM shopping_catalog_category_list_types WHERE category_id=-1 AND list_type_id=3;'),'1');
 assert.equal(scalar(db,'SELECT count(*) FROM transactions;SELECT count(*) FROM shopping_confirmed_purchases;'),'0\n0');
});
test('existing catalog selection derives category, preserves identity and respects scope',()=>{
 const db=make();const a=add(db,{catalog_item_id:1,category_id:999,quantity:'0.5',planned_name:'Milk lactose free',notes:'lactose free'});
 assert.equal(a.catalog_item_id,1);assert.equal(a.category_id,1);assert.equal(a.unit,'unit');assert.equal(a.price,5);assert.equal(a.quantity,.5);
 assert.equal(a.planned_name,'Milk lactose free');
 assert.equal(scalar(db,"SELECT name FROM shopping_catalog_items WHERE id=1;"),'Milk');
 sql(db,"INSERT INTO shopping_list_types(id,name,slug) VALUES(3,'General','general');INSERT INTO shopping_lists(id,title,list_type_id) VALUES(3,'General',3);");
 assert.match(sql(db,`SELECT shopping_add_planned_item(3,${q({catalog_item_id:1})});`,true).stderr,/shopping_category_scope/);
});
test('explicit reuse is atomic, package contents are not converted, explicit zero/null defaults survive',()=>{
 const db=make();sql(db,"SELECT setval(pg_get_serial_sequence('shopping_catalog_items','id'),1);");
 const a=add(db,{custom_name:'Mayonnaise 500 g',quantity:'2',unit:'package',price:0,save_to_catalog:true,notes:'500 g each'});
 assert.ok(a.catalog_item_id);assert.equal(a.quantity,2);assert.equal(a.unit,'package');assert.equal(a.price,0);
 const b=add(db,{catalog_item_id:a.catalog_item_id,price:null,unit:null});assert.equal(b.price,null);assert.equal(b.unit,null);
 const before=scalar(db,'SELECT count(*) FROM shopping_list_items;SELECT count(*) FROM shopping_catalog_items;');
 assert.match(sql(db,`SELECT shopping_add_planned_item(1,${q({custom_name:'Mayonnaise 500 g',save_to_catalog:true})});`,true).stderr,/unique constraint/);
 assert.equal(scalar(db,'SELECT count(*) FROM shopping_list_items;SELECT count(*) FROM shopping_catalog_items;'),before);
});
test('correction preserves catalog, frozen plan and checkmark; invalidates receipt context',()=>{
 const db=make();extract(db);
 const frozen=scalar(db,'SELECT items FROM shopping_purchase_plans;');
 const token=scalar(db,"SELECT shopping_receipt_context(1)->>'token';");
 sql(db,"UPDATE shopping_list_items SET planned_name='Milk lactose free',notes='explicit requirement' WHERE list_id=1;");
 assert.notEqual(scalar(db,"SELECT shopping_receipt_context(1)->>'token';"),token);
 assert.equal(scalar(db,'SELECT items FROM shopping_purchase_plans;'),frozen);
 const snapshot=JSON.parse(scalar(db,'SELECT shopping_snapshot(1);'))[0];
 assert.equal(snapshot.name,'Milk lactose free');assert.equal(snapshot.catalog_item_id,'1');assert.equal(snapshot.is_purchased,true);
 assert.equal(snapshot.notes,'explicit requirement');
 const stale={purchase_date:'2026-10-01',reviewed:true,extraction_attempt:1,items:lines,context_token:token,_owner:'11111111-1111-4111-8111-111111111111',_merchant_state:'matched',_request:{test:1},_fulfilled:[]};
 assert.match(sql(db,`SELECT shopping_receipt_command(1,'confirm',${q(stale)});`,true).stderr,/receipt_stale/);
});
test('closed lists, invalid quantities and unauthorized RPC calls cannot create reusable items',()=>{
 const db=make();
 for(const quantity of [0,-1,'NaN','Infinity',10001]) assert.match(sql(db,`SELECT shopping_add_planned_item(1,${q({custom_name:'Bad',quantity,save_to_catalog:true})});`,true).stderr,/shopping_item_invalid/);
 sql(db,"UPDATE shopping_lists SET status='archived' WHERE id=1;");
 assert.match(sql(db,`SELECT shopping_add_planned_item(1,${q({custom_name:'Closed',save_to_catalog:true})});`,true).stderr,/shopping_list_closed/);
 assert.match(sql(db,"UPDATE shopping_list_items SET planned_name='Changed' WHERE list_id=1;",true).stderr,/shopping_list_closed/);
 assert.match(sql(db,`SET ROLE authenticated;SELECT shopping_add_planned_item(2,${q({custom_name:'No'})});`,true).stderr,/permission denied/);
 assert.equal(scalar(db,'SELECT count(*) FROM shopping_catalog_items;'),'1');
});
