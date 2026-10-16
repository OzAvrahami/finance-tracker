// Disposable PostgreSQL only. Never reads .env or application credentials.
const { before, after, test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const container = `finance-shopping-049-${process.pid}`;
let created = false,
  sequence = 0;
const read = (f) => fs.readFileSync(path.join(__dirname, "../..", f), "utf8");
const full = read("server/full_schema.sql"),
  migration = read("server/migrations/039_shopping_purchase_receipts.sql");
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
const photoMigration = read("server/migrations/040_shopping_receipt_photos.sql");
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
const legacyConfirmation = {
  purchase_date: "2026-09-30",
  items: lines,
  reviewed: true, extraction_attempt: 1,
};

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
  return db;
};
const checkout = (db) =>
  JSON.parse(
    scalar(db, "SET ROLE service_role;SELECT shopping_checkout(1,NULL,NULL);"),
  );
const extract = (db) => {
  receipt(db, "begin", { image_hash: hash });
  return receipt(db, "extracted", {
    attempt: 1,
    extracted: { currency: "ILS", items: lines },
  });
};
const race = (db, command) =>
  new Promise((resolve, reject) => {
    const p = spawn("docker", [
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
    ]);
    let out = "",
      err = "";
    p.stdout.on("data", (b) => (out += b));
    p.stderr.on("data", (b) => (err += b));
    p.on("error", reject);
    p.on("close", (status) => resolve({ status, out, err }));
    p.stdin.end(command);
  });
before(async () => {
  docker([
    "run",
    "-d",
    "--rm",
    "--name",
    container,
    "--label",
    "finance.disposable=shopping039",
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
    "CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE DATABASE shopping_clean;CREATE DATABASE shopping_upgrade;",
  );
  sql("shopping_clean", full);
  sql("shopping_upgrade", full.split("-- Migration 039:")[0]);
});
after(() => {
  if (created) docker(["rm", "-f", container]);
});

const owner='11111111-1111-4111-8111-111111111111';
const context=db=>JSON.parse(scalar(db,"SELECT shopping_receipt_context(1);"));
const confirmData=(db,extra={})=>({purchase_date:'2026-10-01',reviewed:true,extraction_attempt:1,items:lines,context_token:context(db).token,
 _owner:owner,_merchant_state:'matched',_request:{test:'same'},_fulfilled:[],...extra});
test('049 empty actual list rejects before creating a receipt or plan, catalog does not count',()=>{
 const db=make();sql(db,'DELETE FROM shopping_list_items;');
 const r=sql(db,`SELECT shopping_receipt_command(1,'begin',${q({image_hash:hash})});`,true);
 assert.match(r.stderr,/receipt_list_empty/);assert.equal(scalar(db,'SELECT count(*) FROM shopping_receipts;SELECT count(*) FROM shopping_purchase_plans;'),'0\n0');
});
test('049 ten file hashes persist; lease outlives bounded processing; frozen plan survives edits',()=>{
 const db=make();const hashes=Array.from({length:10},(_,i)=>String(i).repeat(64));
 const r=receipt(db,'begin',{image_hash:hash,image_hashes:hashes,duration_ms:480000});
 assert.equal(r.image_hashes.length,10);assert.ok(Date.parse(r.lease_expires_at)-Date.parse(r.updated_at)>=539000);
 const before=scalar(db,'SELECT items FROM shopping_purchase_plans;');sql(db,'UPDATE shopping_list_items SET quantity=3 WHERE list_id=1;');
 assert.equal(scalar(db,'SELECT items FROM shopping_purchase_plans;'),before);
 const conflict=sql(db,`SELECT shopping_receipt_command(1,'begin',${q({image_hash:hash,image_hashes:hashes})});`,true);assert.match(conflict.stderr,/receipt_processing/);
});
test('049 confirmation atomically stores mappings and one history event, marks only fulfilled rows, never expenses',async()=>{
 const db=make();sql(db,"UPDATE shopping_list_items SET is_purchased=false; INSERT INTO shopping_list_items(list_id,catalog_item_id,category_id,quantity,unit,is_purchased) VALUES(1,1,1,2,'unit',true);");extract(db);
 const current=context(db),first=current.current_items[0].list_item_id;
 const mapping={kind:'gtin',retailer_scope:'',code:'7290000111186',action:'map',name:'Exact product',personal_item_id:'1',expected_revision:0,receipt_unit:'unit',planning_unit:'unit',planning_unit_code:'unit',factor:'1'};
 const row={...lines[0],product_code:mapping.code,_mapping:mapping};
 const data=confirmData(db,{items:[row,{...row,quantity:'1'}],_fulfilled:[first]});
 const command=`SELECT shopping_receipt_command(1,'confirm',${q(data)});`;
 const results=await Promise.all([race(db,command),race(db,command)]);assert.ok(results.every(r=>r.status===0),results.map(r=>r.err).join());
 assert.equal(scalar(db,'SELECT count(*) FROM shopping_confirmed_purchases;SELECT count(*) FROM transactions;SELECT count(*) FROM shopping_product_mappings;'),'1\n0\n1');
 assert.equal(scalar(db,'SELECT bool_and(is_purchased) FROM shopping_list_items;'),'t');
 const saved=context(db).receipt.confirmed.items;assert.equal(saved.length,2);assert.equal(saved[0].mapping_snapshot.personal_item_id,'1');assert.equal(saved[0].mapping_snapshot.revision,1);
 assert.match(sql(db,`SELECT shopping_receipt_command(1,'confirm',${q({...data,_request:{test:'changed'}})});`,true).stderr,/receipt_confirmation_conflict/);
});
test('049 stale quantity, store, draft and receipt revisions reject without partial writes',()=>{
 for(const change of ["UPDATE shopping_list_items SET quantity=4 WHERE list_id=1;","UPDATE shopping_lists SET store='different' WHERE id=1;","UPDATE shopping_receipts SET draft_revision=draft_revision+1;"]){
 const db=make();extract(db);const data=confirmData(db);sql(db,change);
 const r=sql(db,`SELECT shopping_receipt_command(1,'confirm',${q(data)});`,true);assert.match(r.stderr,/receipt_stale/);assert.equal(scalar(db,'SELECT count(*) FROM shopping_confirmed_purchases;SELECT count(*) FROM transactions;'),'0\n0');}
});
test('049 explicit transfer preserves draft and original plan, rejects empty destination',()=>{
 const db=make();extract(db);let c=context(db);
 assert.match(sql(db,`SELECT shopping_move_receipt(1,2,'${c.token}');`,true).stderr,/receipt_list_empty/);
 sql(db,"INSERT INTO shopping_list_items(list_id,catalog_item_id,category_id,quantity,unit) VALUES(2,1,1,1,'unit');");
 const draft={items:lines,identity:{merchant:null,receipt_number:null,purchase_date:null},purchase_date:'2026-10-01'};
 sql(db,`SELECT shopping_save_receipt_draft(1,1,0,${q(draft)});`);c=context(db);
 const moved=JSON.parse(scalar(db,`SELECT shopping_move_receipt(1,2,'${c.token}');`));assert.deepEqual(moved.review_draft,draft);assert.equal(moved.origin_plan.list_id,1);
 assert.equal(scalar(db,'SELECT count(*) FROM shopping_confirmed_purchases;SELECT count(*) FROM transactions;'),'0\n0');
});
test('049 private context and transfer RPCs are not available to anonymous/authenticated roles',()=>{
 const db=make();for(const role of ['anon','authenticated'])assert.match(sql(db,`SET ROLE ${role};SELECT shopping_receipt_context(1);`,true).stderr,/permission denied/);
});
