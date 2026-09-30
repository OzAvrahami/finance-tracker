// Disposable PostgreSQL only. Never reads .env or application credentials.
const { before, after, test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const container = `finance-shopping-039-${process.pid}`;
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
const confirmation = {
  purchase_date: "2026-09-30",
  items: lines,
  reviewed: true, extraction_attempt: 1,
};

test('042 draft revision replay and concurrent edits preserve deletions without history/cash', async () => {
  const db=make();extract(db);
  const draft={items:[],identity:{merchant:null,receipt_number:null,purchase_date:null},purchase_date:'2026-09-30'};
  const command=`SET ROLE service_role;SELECT shopping_save_receipt_draft(1,1,0,${q(draft)});`;
  const results=await Promise.all([race(db,command),race(db,command)]);
  assert.ok(results.every(r=>r.status===0));
  assert.equal(scalar(db,'SELECT draft_revision FROM shopping_receipts;'),'1');
  const conflict=sql(db,`SELECT shopping_save_receipt_draft(1,1,0,${q({...draft,items:lines})});`,true);
  assert.notEqual(conflict.status,0);assert.match(conflict.stderr,/receipt_stale/);
  assert.equal(scalar(db,'SELECT count(*) FROM transactions;SELECT count(*) FROM shopping_confirmed_purchases;'),'0\n0');
  assert.equal(scalar(db,"SELECT jsonb_array_length(review_draft->'items') FROM shopping_receipts;"),'0');
});
test('042 identifiers retain exact strings, scoped retailer codes and explicit approved catalog names',()=>{
 const db='legacy042',owner='11111111-1111-4111-8111-111111111111';
 sql('postgres',`CREATE DATABASE ${db};`);sql(db,full.split('-- 044:')[0]);seed(db);
 sql(db,"SELECT setval(pg_get_serial_sequence('shopping_catalog_items','id'),(SELECT max(id) FROM shopping_catalog_items));");
 const data={kind:'gtin',retailer_scope:'',code:'00036000291452',name:'Owner full name',unit:'unit',catalog_item_id:'1',category_id:null,lookup_source:'owner'};
 sql(db,`SET ROLE service_role; SELECT shopping_approve_product_identifier(${q(data)},'${owner}');`);
 assert.equal(scalar(db,'SELECT code FROM shopping_product_identifiers;'),'00036000291452');
 assert.equal(scalar(db,'SELECT name FROM shopping_catalog_items WHERE id=1;'),'Owner full name');
 assert.notEqual(sql(db,`SELECT shopping_approve_product_identifier(${q({...data,code:'00036000291453'})},'${owner}');`,true).status,0);
 for(const scope of ['retailer a','retailer b']) sql(db,`SELECT shopping_approve_product_identifier(${q({...data,kind:'retailer',retailer_scope:scope,name:scope+' product',code:'00123',catalog_item_id:null,category_id:'1'})},'${owner}');`);
 assert.equal(scalar(db,"SELECT count(*) FROM shopping_product_identifiers WHERE code='00123';"),'2');
 assert.equal(scalar(db,'SELECT count(*) FROM shopping_confirmed_purchases;SELECT count(*) FROM transactions;'),'0\n0');
});
test('042 lookup lease is single-flight and cache response reused',async()=>{
 const db=make(),cmd="SET ROLE service_role; SELECT shopping_claim_product_lookup('7622210453327','staging');";
 const result=await Promise.all([race(db,cmd),race(db,cmd)]);
 assert.ok(result.every(r=>r.status===0));
 assert.equal(result.filter(r=>JSON.parse(r.out.trim()).claimed).length,1);
 sql(db,`UPDATE shopping_product_lookup_cache SET result='{"status":"found"}'::jsonb;`);
 assert.equal(JSON.parse(scalar(db,cmd)).result.status,'found');
});
test('042 discounted weighted total is applied once; repeat checkout is one financial effect',()=>{
 const db=make();extract(db);
 const item={...lines[0],quantity:'0.333',price:null,price_basis:'line_discount',original_unit_price:'10.00',calculated_gross_total:'3.33',row_discount:'1.00',final_total:'2.33'};
 receipt(db,'confirm',{...confirmation,items:[item]});
 assert.equal(scalar(db,'SELECT count(*) FROM transactions;'),'0');
 assert.equal(Number(checkout(db).total_amount),2.33);assert.equal(checkout(db).replay,true);
 assert.equal(scalar(db,'SELECT count(*) FROM transactions;SELECT count(*) FROM shopping_confirmed_purchases;'),'1\n1');
});
test('042 security denies direct browser writes and private RPC execution',()=>{
 const db=make();
 for(const role of ['anon','authenticated']) {
  assert.notEqual(sql(db,`SET ROLE ${role}; SELECT shopping_claim_product_lookup('7622210453327','staging');`,true).status,0);
  assert.notEqual(sql(db,`SET ROLE ${role}; INSERT INTO shopping_product_lookup_cache(code,environment,result,expires_at) VALUES('7622210453327','staging','{}',now());`,true).status,0);
 }
 assert.equal(scalar(db,"SELECT count(*) FROM pg_class WHERE relname IN ('shopping_product_identifiers','shopping_product_lookup_cache') AND relrowsecurity;"),'2');
});

test('044 commercial name approval creates no personal item/history; two brands map independently to one need',()=>{
 const db=make(),owner='11111111-1111-4111-8111-111111111111';
 const command=data=>JSON.parse(scalar(db,`SELECT shopping_commercial_command(${q(data)},'${owner}');`));
 const base={kind:'gtin',retailer_scope:'',name:'Exact brand milk',package_quantity:'1',package_unit:'l'};
 const a=command({...base,code:'7622210453327',action:'approve_name'});
 const b=command({...base,code:'7622300356767',name:'Second brand milk',action:'register'});
 assert.notEqual(a.id,b.id);assert.equal(a.approved_name,base.name);assert.equal(b.approved_name,null);
 assert.equal(scalar(db,'SELECT count(*) FROM shopping_catalog_items;SELECT count(*) FROM shopping_regular_products;'),'1\n0');
 const m={action:'map',personal_item_id:'1',receipt_unit:'unit',planning_unit:'liter',planning_unit_code:'l',factor:null,expected_revision:0};
 const ma=command({...m,commercial_product_id:a.id}),mb=command({...m,commercial_product_id:b.id});
 assert.equal(Number(ma.mapping.factor),1);assert.equal(Number(mb.mapping.factor),1);
 assert.equal(ma.mapping.personal_item_id,mb.mapping.personal_item_id);
 assert.equal(scalar(db,'SELECT count(*) FROM shopping_confirmed_purchases;SELECT count(*) FROM transactions;'),'0\n0');
});

test('044 changed mappings retain immutable revisions; unknown conversions stay null; concurrent stale mapping rejected',async()=>{
 const db=make(),owner='11111111-1111-4111-8111-111111111111';
 const base={kind:'gtin',retailer_scope:'',name:'Lactose free',code:'7622210453327',action:'map',personal_item_id:'1',receipt_unit:'unit',planning_unit:'liter',planning_unit_code:'l',expected_revision:0,factor:null};
 const cmd=d=>`SELECT shopping_commercial_command(${q(d)},'${owner}');`;
 const first=JSON.parse(scalar(db,cmd(base)));assert.equal(first.mapping.factor,null);
 const races=await Promise.all([race(db,cmd({...base,expected_revision:1,factor:'1'})),race(db,cmd({...base,expected_revision:1,factor:'2'}))]);
 assert.equal(races.filter(r=>r.status===0).length,1);
 assert.equal(scalar(db,'SELECT count(*) FROM shopping_product_mappings;'),'2');
 assert.equal(scalar(db,"SELECT factor IS NULL FROM shopping_product_mappings WHERE revision=1;"),'t');
 assert.notEqual(sql(db,'SET ROLE service_role; UPDATE shopping_product_mappings SET factor=100;',true).status,0);
});

test('044 explicit new personal creation is replay-safe and never implicitly regular or financially confirmed',()=>{
 const db=make(),owner='11111111-1111-4111-8111-111111111111';
 sql(db,"SELECT setval(pg_get_serial_sequence('shopping_catalog_items','id'),1);");
 const body={action:'map',kind:'gtin',retailer_scope:'',code:'7622210453327',name:'Brand',personal_item_id:null,new_personal:{name:'Milk 3%',unit:'liter',category_id:'1'},receipt_unit:'unit',planning_unit:'liter',planning_unit_code:'l',factor:'1',expected_revision:0,request_key:'22222222-2222-4222-8222-222222222222'};
 const cmd=d=>`SELECT shopping_commercial_command(${q(d)},'${owner}');`;
 const a=JSON.parse(scalar(db,cmd(body))),b=JSON.parse(scalar(db,cmd(body)));
 assert.equal(a.mapping.personal_item_id,b.mapping.personal_item_id);
 assert.notEqual(sql(db,cmd({...body,name:'Conflicting'}),true).status,0);
 assert.equal(scalar(db,'SELECT count(*) FROM shopping_catalog_items;SELECT count(*) FROM shopping_regular_products;SELECT count(*) FROM transactions;'),'2\n0\n0');
});

test('044 forward upgrade preserves old catalog, draft, occurrences and confirmed history; browser privileges denied',()=>{
 const db='upgrade044';sql('postgres',`CREATE DATABASE ${db};`);sql(db,full.split('-- 044:')[0]);seed(db);extract(db);
 const owner='11111111-1111-4111-8111-111111111111';
 sql(db,`SELECT shopping_approve_product_identifier(${q({kind:'gtin',retailer_scope:'',code:'7622210453327',name:'Existing owner product',unit:'unit',catalog_item_id:'1',lookup_source:'owner'})},'${owner}');`);
 receipt(db,'confirm',confirmation);checkout(db);
 const before=scalar(db,"SELECT to_jsonb(r) FROM shopping_receipts r;SELECT to_jsonb(p) FROM shopping_confirmed_purchases p;SELECT to_jsonb(t) FROM transactions t;SELECT to_jsonb(c) FROM shopping_catalog_items c;");
 sql(db,read('server/migrations/044_shopping_personal_commercial.sql'));
 assert.equal(scalar(db,"SELECT to_jsonb(r) FROM shopping_receipts r;SELECT to_jsonb(p) FROM shopping_confirmed_purchases p;SELECT to_jsonb(t) FROM transactions t;SELECT to_jsonb(c) FROM shopping_catalog_items c;"),before);
 assert.equal(scalar(db,'SELECT count(*) FROM shopping_commercial_products;SELECT count(*) FROM shopping_product_mappings;'),'1\n1');
 for(const role of ['anon','authenticated'])assert.notEqual(sql(db,`SET ROLE ${role};SELECT shopping_commercial_command('{}','${owner}');`,true).status,0);
 assert.equal(scalar(db,"SELECT count(*) FROM pg_class WHERE relname IN ('shopping_commercial_products','shopping_product_mappings') AND relrowsecurity;"),'2');
});

test('044 mapping edits after confirmation cannot rewrite occurrence snapshots or duplicate checkout cash',()=>{
 const db=make();extract(db);
 const owner='11111111-1111-4111-8111-111111111111';
 const input={action:'map',kind:'gtin',retailer_scope:'',code:'7622210453327',name:'Exact milk',personal_item_id:'1',receipt_unit:'unit',planning_unit:'liter',planning_unit_code:'l',expected_revision:0,factor:'1'};
 const p=JSON.parse(scalar(db,`SELECT shopping_commercial_command(${q(input)},'${owner}');`));
 const items=[{...lines[0],quantity:'2',commercial_product_id:p.id,mapping_snapshot:p.mapping,planning_quantity:'2',planning_unit:'liter'},{...lines[0],quantity:'1',commercial_product_id:p.id,mapping_snapshot:p.mapping,planning_quantity:'1',planning_unit:'liter'}];
 receipt(db,'confirm',{...confirmation,items});
 const history=scalar(db,'SELECT items FROM shopping_confirmed_purchases;');
 sql(db,`SELECT shopping_commercial_command(${q({...input,expected_revision:1,factor:'2'})},'${owner}');`);
 assert.equal(scalar(db,'SELECT items FROM shopping_confirmed_purchases;'),history);
 assert.equal(Number(checkout(db).total_amount),15);assert.equal(checkout(db).replay,true);
 assert.equal(scalar(db,'SELECT count(*) FROM transactions;'),'1');
});
test('042 forward upgrade and failed rerun preserve 041 extraction, financial state and attempts',()=>{
 const db='product_upgrade';sql('postgres',`CREATE DATABASE ${db};`);
 sql(db,full.split('-- 042:')[0]);seed(db);extract(db);
 const before=scalar(db,"SELECT to_jsonb(r) FROM shopping_receipts r; SELECT count(*) FROM transactions;");
 const m=read('server/migrations/042_shopping_product_identity_prices.sql');sql(db,m);
 assert.equal(scalar(db,"SELECT to_jsonb(r)-'review_draft'-'draft_revision' FROM shopping_receipts r; SELECT count(*) FROM transactions;"),before);
 assert.notEqual(sql(db,m,true).status,0);
 assert.equal(scalar(db,"SELECT count(*) FROM shopping_product_identifiers; SELECT count(*) FROM shopping_confirmed_purchases;"),'0\n0');
});

test('043 archives newer unsaved edits, rejects stale replacement and replays after a later draft save',()=>{
 const db=make();extract(db);
 const draft={items:[{...lines[0],name:'Saved correction'}],identity:{merchant:null,receipt_number:null,purchase_date:null},purchase_date:'2026-09-30'};
 sql(db,`SELECT shopping_save_receipt_draft(1,1,0,${q(draft)});`);
 const current={...draft,items:[]};
 const request={image_hash:hash,image_hashes:[hash],expected_attempt:1,draft_revision:1,reprocess:true,reprocess_key:'11111111-1111-4111-8111-111111111111',review_draft:current};
 assert.notEqual(sql(db,`SELECT shopping_receipt_command(1,'begin',${q({...request,draft_revision:0})});`,true).status,0);
 const next=receipt(db,'begin',request);
 assert.deepEqual(next.previous_drafts[0].review_draft,current);
 receipt(db,'extracted',{attempt:2,extracted:{currency:'ILS',items:lines}});
 sql(db,`SELECT shopping_save_receipt_draft(1,2,2,${q(draft)});`);
 const replay=receipt(db,'begin',request);
 assert.equal(replay.processing_replay,true);assert.equal(replay.attempts,2);
 assert.equal(replay.draft_revision,3);
 assert.equal(scalar(db,'SELECT count(*) FROM transactions;SELECT count(*) FROM shopping_confirmed_purchases;'),'0\n0');
});
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
test("038 upgrade preserves canonical tables and checkbox rows; no inferred purchase backfill", () => {
  const db = "shopping_upgrade";
  seed(db);
  const before = scalar(
    db,
    "SELECT jsonb_agg(to_jsonb(i)) FROM shopping_list_items i;SELECT count(*) FROM transactions;",
  );
  sql(db, migration);
  sql(db, photoMigration);
  assert.equal(
    scalar(
      db,
      "SELECT jsonb_agg(to_jsonb(i)) FROM shopping_list_items i;SELECT count(*) FROM transactions;",
    ),
    before,
  );
  assert.equal(
    scalar(db, "SELECT count(*) FROM shopping_confirmed_purchases;"),
    "0",
  );
  // Migration is single-run transactional; rerun fails at CREATE TABLE without changing data.
  assert.notEqual(sql(db, migration, true).status, 0);
  assert.equal(scalar(db, "SELECT count(*) FROM shopping_receipts;"), "0");
});
test("scan + corrected confirmation preserve plan and create zero financial cash", () => {
  const db = make();
  extract(db);
  const plan = scalar(db, "SELECT items FROM shopping_purchase_plans;");
  sql(db, "UPDATE shopping_list_items SET quantity=3 WHERE list_id=1;");
  const result = receipt(db, "confirm", confirmation);
  assert.equal(result.state, "confirmed");
  assert.equal(scalar(db, "SELECT items FROM shopping_purchase_plans;"), plan);
  assert.equal(scalar(db, "SELECT count(*) FROM transactions;"), "0");
  assert.equal(scalar(db, "SELECT count(*) FROM shopping_checkouts;"), "0");
  assert.equal(receipt(db, "confirm", confirmation).id, result.id);
  assert.equal(
    scalar(db, "SELECT count(*) FROM shopping_confirmed_purchases;"),
    "1",
  );
  assert.notEqual(
    sql(
      db,
      `SELECT shopping_receipt_command(1,'confirm',${q({ ...confirmation, items: [{ ...lines[0], quantity: "4" }] })});`,
      true,
    ).status,
    0,
  );
});
test("reupload reuses receipt; same image on another list fails without another history record", () => {
  const db = make();
  const r = extract(db);
  assert.equal(receipt(db, "begin", { image_hash: hash }).id, r.id);
  assert.notEqual(
    sql(
      db,
      `SELECT shopping_receipt_command(2,'begin',${q({ image_hash: hash })});`,
      true,
    ).status,
    0,
  );
  assert.equal(scalar(db, "SELECT count(*) FROM shopping_receipts;"), "1");
  assert.equal(
    scalar(db, "SELECT count(*) FROM shopping_purchase_plans;"),
    "1",
  );
});
test("checkout uses reviewed actuals; concurrent retries create one expense and purchase event", async () => {
  const db = make();
  extract(db);
  receipt(db, "confirm", {
    ...confirmation,
    items: [{ ...lines[0], quantity: "3" }],
  });
  const results = await Promise.all([
    race(db, "SELECT shopping_checkout(1,NULL,NULL);"),
    race(db, "SELECT shopping_checkout(1,NULL,NULL);"),
  ]);
  results.forEach((r) => assert.equal(r.status, 0, r.err));
  assert.equal(scalar(db, "SELECT count(*) FROM transactions;"), "1");
  assert.equal(checkout(db).total_amount, 15);
  assert.equal(
    scalar(db, "SELECT count(*) FROM shopping_confirmed_purchases;"),
    "1",
  );
});
test("checkout first then receipt replaces history only, never cash or original plan", () => {
  const db = make();
  const initial = checkout(db);
  const plan = scalar(db, "SELECT items FROM shopping_purchase_plans;");
  extract(db);
  receipt(db, "confirm", {
    ...confirmation,
    items: [{ ...lines[0], quantity: "4" }],
  });
  assert.equal(checkout(db).transaction_id, initial.transaction_id);
  assert.equal(checkout(db).total_amount, 10);
  assert.equal(
    scalar(db, "SELECT count(*) FROM shopping_confirmed_purchases;"),
    "1",
  );
  assert.equal(scalar(db, "SELECT items FROM shopping_purchase_plans;"), plan);
  assert.notEqual(
    sql(db, "DELETE FROM shopping_list_items WHERE list_id=1;", true).status,
    0,
  );
  assert.notEqual(sql(db, "SELECT shopping_delete_draft(1);", true).status, 0);
});
test("concurrent confirmation is one purchase; concurrent conflicting confirmation rejects one", async () => {
  const db = make();
  extract(db);
  const s = `SELECT shopping_receipt_command(1,'confirm',${q(confirmation)});`;
  const same = await Promise.all([race(db, s), race(db, s)]);
  same.forEach((r) => assert.equal(r.status, 0, r.err));
  assert.equal(
    scalar(db, "SELECT count(*) FROM shopping_confirmed_purchases;"),
    "1",
  );
  const other = make();
  extract(other);
  const conflict = await Promise.all([
    race(other, s),
    race(
      other,
      `SELECT shopping_receipt_command(1,'confirm',${q({ ...confirmation, purchase_date: "2026-09-29" })});`,
    ),
  ]);
  assert.deepEqual(conflict.map((r) => r.status).sort(), [0, 3]);
});
test("concurrent suggestion acceptance is idempotent and does not increment existing quantity", async () => {
  const db = make();
  sql(db, "DELETE FROM shopping_list_items WHERE list_id=1;");
  const s = "SELECT shopping_accept_suggestion(1,1,2,'unit');";
  const results = await Promise.all([race(db, s), race(db, s)]);
  results.forEach((r) => assert.equal(r.status, 0, r.err));
  assert.equal(scalar(db, "SELECT count(*) FROM shopping_list_items;"), "1");
  assert.equal(scalar(db, "SELECT quantity FROM shopping_list_items;"), "2");
});
test("failed financial insertion rolls back checkout and history; missing reviewed prices fail safely", () => {
  const db = make();
  sql(
    db,
    "CREATE FUNCTION fail_test() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'test failure';END$$;CREATE TRIGGER fail_test BEFORE INSERT ON transactions FOR EACH ROW EXECUTE FUNCTION fail_test();",
  );
  assert.notEqual(
    sql(db, "SELECT shopping_checkout(1,NULL,NULL);", true).status,
    0,
  );
  assert.equal(
    scalar(
      db,
      "SELECT count(*) FROM shopping_checkouts;SELECT count(*) FROM shopping_confirmed_purchases;SELECT count(*) FROM shopping_purchase_plans;",
    ),
    "0\n0\n0",
  );
  const other = make();
  extract(other);
  assert.notEqual(
    sql(
      other,
      `SELECT shopping_receipt_command(1,'confirm',${q({ ...confirmation, items: [{ ...lines[0], price: null }] })});`,
      true,
    ).status,
    0,
  );
});
test("RLS/grants prohibit browser mutation or commands; new writes leave APY/Savings untouched", () => {
  const db = make();
  assert.notEqual(
    sql(
      db,
      "SET ROLE authenticated;SELECT shopping_checkout(1,NULL,NULL);",
      true,
    ).status,
    0,
  );
  assert.notEqual(
    sql(db, "SET ROLE anon;SELECT * FROM shopping_receipts;", true).status,
    0,
  );
  assert.equal(
    scalar(
      db,
      "SELECT bool_and(relrowsecurity) FROM pg_class WHERE relname IN ('shopping_regular_products','shopping_receipts','shopping_purchase_plans','shopping_confirmed_purchases');",
    ),
    "t",
  );
  checkout(db);
  assert.equal(
    scalar(
      db,
      "SELECT count(*) FROM transaction_source_observations;SELECT count(*) FROM savings_entries;SELECT count(*) FROM loan_payments;",
    ),
    "0\n0\n0",
  );
});

const identity = {merchant: 'Market branch 1', receipt_number: 'R-543', purchase_date: '2026-09-30'};
function photoReceipt(db, list, image, identityValue = identity) {
  scalar(db, "SELECT shopping_receipt_command("+list+",'begin',"+q({image_hash:image.repeat(64)})+");");
  return JSON.parse(scalar(db,"SELECT shopping_receipt_command("+list+",'extracted',"+q({attempt:1,extracted:{currency:'ILS',identity:identityValue,items:lines}})+");"));
}
test('duplicate identifiers on different photos warn before history AND financial checkout; acknowledged distinct purchases remain separate', () => {
 const db=make(); photoReceipt(db,1,'a'); receipt(db,'confirm',{...confirmation,identity}); checkout(db);
 photoReceipt(db,2,'b');
 const candidates=JSON.parse(scalar(db,'SET ROLE service_role;SELECT shopping_receipt_duplicates(2);'));
 assert.equal(candidates.length,1);assert.equal(candidates[0].list_title,'Trip');assert.equal(candidates[0].history_confirmed,true);assert.ok(candidates[0].transaction_id);assert.equal(candidates[0].checkout_total,10);
 const confirm="SELECT shopping_receipt_command(2,'confirm',"+q({...confirmation,identity})+");";
 assert.match(sql(db,confirm,true).stderr,/receipt_duplicate_review_required/);
 assert.match(sql(db,'SELECT shopping_checkout(2,NULL,NULL);',true).stderr,/receipt_duplicate_review_required/);
 assert.equal(scalar(db,'SELECT count(*) FROM shopping_confirmed_purchases;SELECT count(*) FROM transactions;'),'1\n1');
 const ids=candidates.map(c=>c.receipt_id), data={...confirmation,identity,duplicate_reviewed_ids:ids};
 const command="SELECT shopping_receipt_command(2,'confirm',"+q(data)+");";
 const first=scalar(db,command); assert.equal(scalar(db,command),first);
 const cash='SELECT shopping_checkout(2,NULL,NULL,'+q(ids)+');';
 const t=JSON.parse(scalar(db,cash));assert.equal(JSON.parse(scalar(db,cash)).transaction_id,t.transaction_id);
 assert.equal(scalar(db,'SELECT count(*) FROM shopping_confirmed_purchases;SELECT count(*) FROM transactions;'),'2\n2');
});
test('duplicate identifiers arriving after a stale review/checkout screen are rechecked, including concurrent confirmation', async()=>{
 const db=make(); photoReceipt(db,1,'a'); assert.equal(scalar(db,'SELECT shopping_receipt_duplicates(1);'),'[]');
 photoReceipt(db,2,'b');
 const result=await Promise.all([1,2].map(n=>race(db,"SELECT shopping_receipt_command("+n+",'confirm',"+q({...confirmation,identity})+");")));
 result.forEach(r=>assert.match(r.err,/receipt_duplicate_review_required/));
 assert.equal(scalar(db,'SELECT count(*) FROM shopping_confirmed_purchases;SELECT count(*) FROM transactions;'),'0\n0');
 assert.match(sql(db,'SELECT shopping_checkout(1,NULL,NULL);',true).stderr,/receipt_duplicate_review_required/);
});
test('duplicate detection requires printed reference, merchant scope and date; amount/date similarity alone is not identity',()=>{
 const db=make();photoReceipt(db,1,'a');photoReceipt(db,2,'b',{...identity,receipt_number:null});
 assert.equal(scalar(db,'SELECT shopping_receipt_duplicates(2);'),'[]');
 for(const different of [{...identity,receipt_number:'Other'}, {...identity,merchant:'Other branch'}, {...identity,purchase_date:'2026-09-29'}]) {
  assert.equal(scalar(db,'SELECT shopping_receipt_duplicates(2,'+q(different)+');'),'[]');
 }
 assert.equal(JSON.parse(scalar(db,'SELECT shopping_receipt_duplicates(2,'+q({...identity,merchant:' MARKET   branch 1 '})+');')).length,1);
});

test('duplicate guard does not let checkout outrun in-flight extraction; existing cash replay remains harmless',()=>{
 const db=make();receipt(db,'begin',{image_hash:hash});
 assert.match(sql(db,'SELECT shopping_checkout(1,NULL,NULL);',true).stderr,/receipt_processing/);
 assert.equal(scalar(db,'SELECT count(*) FROM transactions;'),'0');
 const other=make();const first=checkout(other);receipt(other,'begin',{image_hash:hash});
 assert.equal(checkout(other).transaction_id,first.transaction_id);
});

test("multi-photo replacement invalidates old extraction and stale confirmation; retries preserve plan/history/cash",()=>{
 const db=make();const r=extract(db);const plan=scalar(db,'SELECT items FROM shopping_purchase_plans;');
 const hashes=['b'.repeat(64),'c'.repeat(64)];
 const request={image_hash:'d'.repeat(64),image_hashes:hashes,expected_attempt:1};
 const changed=receipt(db,'begin',request);assert.equal(changed.attempts,2);assert.equal(changed.extracted,null);assert.deepEqual(changed.image_hashes,hashes);
 assert.match(sql(db,"SELECT shopping_receipt_command(1,'extracted',"+q({attempt:1,extracted:{currency:'ILS',items:lines}})+");",true).stderr,/receipt_stale/);
 receipt(db,'extracted',{attempt:2,extracted:{currency:'ILS',items:lines}});
 assert.equal(receipt(db,'begin',request).attempts,2); // lost response: reuse completed set
 assert.match(sql(db,"SELECT shopping_receipt_command(1,'confirm',"+q(confirmation)+");",true).stderr,/receipt_stale/);
 receipt(db,'confirm',{...confirmation,extraction_attempt:2});
 assert.equal(scalar(db,'SELECT count(*) FROM shopping_confirmed_purchases;SELECT count(*) FROM transactions;'),'1\n0');
 assert.equal(scalar(db,'SELECT items FROM shopping_purchase_plans;'),plan);
 assert.match(sql(db,"SELECT shopping_receipt_command(1,'begin',"+q({...request,image_hash:'e'.repeat(64),expected_attempt:2})+");",true).stderr,/receipt_already_exists/);
 assert.match(sql(db,"SELECT shopping_receipt_command(2,'begin',"+q({...request,image_hash:'f'.repeat(64),expected_attempt:0})+");",true).stderr,/receipt_duplicate/);
 assert.equal(r.id,changed.id);
});
test("040 upgrades existing 039 receipt without rewriting confirmed history or cash",()=>{
 const db='upgrade_photos';sql('postgres','CREATE DATABASE '+db+';');
 sql(db,full.split('-- 040:')[0]);seed(db);extract(db);receipt(db,'confirm',confirmation);checkout(db);
 const before=scalar(db,'SELECT to_jsonb(t) FROM transactions t;SELECT to_jsonb(h) FROM shopping_confirmed_purchases h;SELECT items FROM shopping_purchase_plans;');
 sql(db,photoMigration);
 assert.equal(scalar(db,'SELECT to_jsonb(t) FROM transactions t;SELECT to_jsonb(h) FROM shopping_confirmed_purchases h;SELECT items FROM shopping_purchase_plans;'),before);
 assert.equal(scalar(db,'SELECT image_hashes[1]=image_hash AND cardinality(image_hashes)=1 FROM shopping_receipts;'),'t');
 assert.notEqual(sql(db,photoMigration,true).status,0); // single-run rollback, like 039
 assert.equal(checkout(db).replay,true);
});

test("explicit same-photo reprocessing archives corrections and serializes identical/conflicting concurrent retries",async()=>{
 const db=make();extract(db);
 const key='00000000-0000-4000-8000-000000000041';
 const draft={items:[{...lines[0],name:'Owner correction'}],identity:{merchant:'Shop'},purchase_date:'2026-09-29'};
 const data={image_hash:hash,expected_attempt:1,reprocess:true,reprocess_key:key,review_draft:draft};
 const command=`SET ROLE service_role;SELECT shopping_receipt_command(1,'begin',${q(data)});`;
 const results=await Promise.all([race(db,command),race(db,command)]);
 assert.ok(results.every(r=>r.status===0));
 const saved=JSON.parse(scalar(db,'SELECT to_jsonb(r) FROM shopping_receipts r;'));
 assert.equal(saved.attempts,2);assert.equal(saved.previous_drafts.length,1);assert.deepEqual(saved.previous_drafts[0].review_draft,draft);assert.equal(saved.previous_drafts[0].extracted.items.length,1);
 assert.equal(results.filter(r=>JSON.parse(r.out.trim()).processing_replay===true).length,1);
 assert.equal(receipt(db,'begin',data).processing_replay,true);
 assert.match(sql(db,`SELECT shopping_receipt_command(1,'begin',${q({...data,reprocess_key:'00000000-0000-4000-8000-000000000042'})});`,true).stderr,/receipt_stale/);
 receipt(db,'extracted',{attempt:2,extracted:{currency:'ILS',items:lines}});
 assert.equal(receipt(db,'begin',data).attempts,2);
 assert.equal(receipt(db,'begin',{image_hash:hash}).attempts,2);
 assert.equal(scalar(db,'SELECT count(*) FROM transactions;SELECT count(*) FROM shopping_confirmed_purchases;'),'0\n0');
});
test("041 forward install preserves old review; final attempt archived and limit retained",()=>{
 const db='forward_reprocess';sql('postgres',`CREATE DATABASE ${db};`);
 sql(db,full.split('-- 041:')[0]);seed(db);extract(db);
 const before=scalar(db,'SELECT id::text FROM shopping_receipts');
 sql(db,read('server/migrations/041_shopping_receipt_reprocessing.sql'));
 assert.equal(scalar(db,'SELECT id::text FROM shopping_receipts'),before);
 assert.equal(scalar(db,"SELECT has_function_privilege('anon','shopping_receipt_command(bigint,text,jsonb)','execute');"),'f');
 for(let attempt=1;attempt<5;attempt++){
  receipt(db,'begin',{image_hash:hash,expected_attempt:attempt,reprocess:true,reprocess_key:`00000000-0000-4000-8000-${String(attempt).padStart(12,'0')}`});
  receipt(db,'failed',{attempt:attempt+1});
 }
 assert.equal(scalar(db,'SELECT jsonb_array_length(previous_drafts) FROM shopping_receipts'),'4');
 assert.match(sql(db,`SELECT shopping_receipt_command(1,'begin',${q({image_hash:hash,expected_attempt:5,reprocess:true,reprocess_key:'00000000-0000-4000-8000-000000000099'})});`,true).stderr,/receipt_attempt_limit/);
 assert.notEqual(sql(db,read('server/migrations/041_shopping_receipt_reprocessing.sql'),true).status,0);
});
