const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const {
  createShoppingIntelligenceRouter,
} = require("../routes/shoppingIntelligenceRoutes");
async function app(t, extract, options={}) {
  const calls = [];
  const db = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if(options.rpc)return options.rpc(name,args);
      return {
        data: {
          id: "receipt",
          state:
            args.p_action === "begin"
              ? "extracting"
              : args.p_action === "confirm"
                ? "confirmed"
                : "review",
          attempts: 1,
        },
        error: null,
      };
    },
    from(table) {
      if(options.tables){const q={select(){return q},eq(){return q},in(){return q},order(){return q},limit(){return q},single(){return q},then(resolve){return resolve({data:options.tables[table]});}};return q;}
      throw Error("unexpected table");
    },
  };
  const a = express();
  a.use(express.json({ limit: "2mb" }));
  if(options.user)a.use((req,res,next)=>{req.user=options.user;next();});
  a.use("/shopping", createShoppingIntelligenceRouter({ db, extract, ...(options.lookup?{lookup:options.lookup}:{}) }));
  const server = await new Promise((r) => {
    const s = a.listen(0, "127.0.0.1", () => r(s));
  });
  t.after(() => new Promise((r) => server.close(r)));
  return { calls, url: `http://127.0.0.1:${server.address().port}/shopping` };
}
const post = (url, body) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
test('confirmed reconciliation reads immutable owner-approved occurrences, never old extraction or current product mappings',async t=>{
 const actual={name:'Owner corrected',quantity:'1',price:'13.00',unit:'unit',catalog_item_id:null,row_id:'retained'};
 const {url}=await app(t,()=>{throw Error('No extraction');},{rpc:async()=>({data:[]}),tables:{
  shopping_lists:{list_type_id:1},shopping_catalog_category_list_types:[],shopping_regular_products:[],shopping_confirmed_purchases:[],shopping_purchase_plans:[{items:[]}],
  shopping_receipts:[{state:'confirmed',extracted:{items:[{...actual,row_id:'deleted',quantity:'2'}]},confirmed:{items:[actual]}}]
 }});
 const response=await fetch(url+'/lists/1/intelligence');assert.equal(response.status,200);
 const data=await response.json();assert.equal(data.reconciliation.items.length,1);assert.equal(data.reconciliation.items[0].row_id,'retained');assert.equal(data.reconciliation.items[0].quantity,'1');
});
const photo = () => {
  const form = new FormData();
  form.append(
    "receipt",
    new Blob([Buffer.from([255, 216, 255])], { type: "image/jpeg" }),
    "test.jpg",
  );
  return form;
};

test('commercial name approval and personal mapping use separate authenticated commands, never financial RPCs',async(t)=>{
 const id='11111111-1111-4111-8111-111111111111',user={id};
 const {url,calls}=await app(t,()=>{throw Error('no OCR')},{user,rpc:async()=>({data:{id,approved_name:'Full brand',mapping_revision:0,mapping:null}})});
 const base={code:'7622210453327',kind:'gtin',retailer_scope:'',name:'Full brand',package_quantity:'1',package_unit:'l'};
 let r=await post(url+'/products/approve',base);assert.equal(r.status,200);
 assert.equal(calls[0].name,'shopping_approve_product_identifier');assert.equal(calls[0].args.p_owner,id);
 assert.equal((await r.json()).commercial_product_id,id);
 r=await post(url+'/products/map',{...base,personal_item_id:'1',expected_revision:0,request_key:id,receipt_unit:'unit',planning_unit:'liter',factor:null});
 assert.equal(r.status,200);assert.equal(calls[1].name,'shopping_commercial_command');
 assert.equal(calls[1].args.p_data.planning_unit_code,'l');assert.equal(calls[1].args.p_data.receipt_unit,'unit');
 assert.equal((await post(url+'/products/approve',{...base,regular:true})).status,400);
 assert.equal(calls.length,2);
});

test('barcode lookup is exact and failures nonblocking; raw images and financial payloads reject',async(t)=>{
 let seen;
 const {url,calls}=await app(t,()=>{throw Error('no OCR')},{lookup:async input=>{seen=input;return {status:'missing'}}});
 const r=await post(url+'/products/lookup',{code:'00036000291452',provider:'open_products_facts'});
 assert.equal(r.status,200);assert.equal(seen.code,'00036000291452');assert.equal(seen.provider,'open_products_facts');
 assert.equal((await post(url+'/products/lookup',{code:'00036000291452',receipt_image:'data:'})).status,400);
 assert.equal(calls.length,0);
});
test("upload extracts only into review RPCs, no checkout/transaction command", async (t) => {
  const { url, calls } = await app(t, async () => ({
    currency: "ILS",
    items: [{ name: "Milk", quantity: "1", unit: "unit", price: "3" }],
  }));
  const res = await fetch(url + "/lists/1/receipt", {
    method: "POST",
    body: photo(),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(
    calls.map((c) => c.args.p_action),
    ["begin", "extracted"],
  );
  assert.ok(calls.every((c) => c.name === "shopping_receipt_command"));
  assert.match(calls[0].args.p_data.image_hash, /^[a-f0-9]{64}$/);
});

test('durable draft saves metadata/deletions without confirmation; malformed IDs reject',async(t)=>{
 const {url,calls}=await app(t,()=>{throw Error('no OCR');});
 const draft={items:[],identity:{merchant:null,receipt_number:null,purchase_date:null},purchase_date:'2026-09-30'};
 let r=await fetch(url+'/lists/1/receipt/draft',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({attempt:5,revision:0,draft})});
 assert.equal(r.status,200);assert.equal(calls[0].name,'shopping_save_receipt_draft');assert.deepEqual(calls[0].args.p_draft,draft);
 r=await fetch(url+'/lists/1/receipt/draft',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({attempt:5,revision:0,draft:{...draft,items:[{name:'a',quantity:'1',price:'1',unit:'u',product_code:123}]}})});
 assert.equal(r.status,400);assert.equal(calls.length,1);
});
test('weighted row discount is server-derived; caller cannot forge final total',async(t)=>{
 const {url,calls}=await app(t,()=>{throw Error('no OCR');});
 const body={purchase_date:'2026-09-30',reviewed:true,extraction_attempt:1,items:[{name:'Weighted',quantity:'0.333',unit:'kg',price:null,price_basis:'line_discount',original_unit_price:'10.00',row_discount:'1.00',catalog_item_id:null}]};
 assert.equal((await post(url+'/lists/1/receipt/confirm',body)).status,200);
 assert.equal(calls[0].args.p_data.items[0].final_total,'2.33');
 assert.equal((await post(url+'/lists/1/receipt/confirm',{...body,items:[{...body.items[0],final_total:'0.01'}]})).status,400);
 assert.equal(calls.length,1);
});
test("provider unconfigured preserves failed receipt and sends safe retry response", async (t) => {
  const { url, calls } = await app(t, async () => {
    throw Object.assign(Error("receipt_provider_unconfigured"), {
      status: 503,
    });
  });
  const res = await fetch(url + "/lists/1/receipt", {
    method: "POST",
    body: photo(),
  });
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), {
    error: "receipt_provider_unconfigured",
  });
  assert.deepEqual(
    calls.map((c) => c.args.p_action),
    ["begin", "failed"],
  );
});
test("confirmation is explicit, bounded, and rejects unknown financial fields before RPC", async (t) => {
  const { url, calls } = await app(t);
  const input = {
    purchase_date: "2026-09-30",
    reviewed: true,
    extraction_attempt: 1,
    items: [
      {
        name: "Milk",
        quantity: "1",
        unit: "unit",
        price: "3",
        catalog_item_id: null,
      },
    ],
  };
  assert.equal(
    (
      await post(url + "/lists/1/receipt/confirm", {
        ...input,
        transaction_id: 1,
      })
    ).status,
    400,
  );
  assert.equal(calls.length, 0);
  assert.equal(
    (await post(url + "/lists/1/receipt/confirm", input)).status,
    200,
  );
  assert.equal(calls[0].args.p_action, "confirm");
});
test("invalid file signature and oversized upload never reach database", async (t) => {
  const { url, calls } = await app(t);
  for (const size of [10, 8 * 1024 * 1024 + 1]) {
    const form = new FormData();
    form.append(
      "receipt",
      new Blob([Buffer.alloc(size)], { type: "image/jpeg" }),
      "spoof.jpg",
    );
    const res = await fetch(url + "/lists/1/receipt", {
      method: "POST",
      body: form,
    });
    assert.equal(res.status, size === 10 ? 415 : 413);
  }
  assert.equal(calls.length, 0);
});
test("suggestion input is validated and calls only idempotent list-add command", async (t) => {
  const { url, calls } = await app(t);
  assert.equal(
    (
      await post(url + "/lists/1/suggestions", {
        catalog_item_id: 1,
        quantity: "2",
        unit: "unit",
        extra: 1,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post(url + "/lists/1/suggestions", {
        catalog_item_id: 1,
        quantity: "2",
        unit: "unit",
      })
    ).status,
    200,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "shopping_accept_suggestion");
});

test("duplicate comparison accepts bounded printed identifiers, rejects invented trusted fields and calls read-only RPC", async (t) => {
  const { url, calls } = await app(t);
  const identity = {
    merchant: "Market",
    receipt_number: "R-17",
    purchase_date: "2026-09-30",
  };
  assert.equal(
    (
      await post(url + "/lists/1/receipt/duplicates", {
        identity,
        transaction_id: 4,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post(url + "/lists/1/receipt/duplicates", {
        identity: { ...identity, purchase_date: "2026-02-30" },
      })
    ).status,
    400,
  );
  assert.equal(calls.length, 0);
  assert.equal(
    (await post(url + "/lists/1/receipt/duplicates", { identity })).status,
    200,
  );
  assert.deepEqual(calls, [
    {
      name: "shopping_receipt_duplicates",
      args: { p_list: "1", p_identity: identity },
    },
  ]);
});

test("multi-photo upload passes ordered images to ONE extraction, set hash and revision to ONE receipt", async (t) => {
  let images;
  const { url, calls } = await app(t, async (buffers) => {
    images = buffers;
    return {
      currency: "ILS",
      items: [{ name: "Milk", quantity: "1", unit: "unit", price: "3" }],
    };
  });
  const f = new FormData();
  for (const n of [1, 2])
    f.append(
      "receipt",
      new Blob([Buffer.from([255, 216, 255, n])], { type: "image/jpeg" }),
      n + ".jpg",
    );
  f.append("expected_attempt", "2");
  assert.equal(
    (await fetch(url + "/lists/1/receipt", { method: "POST", body: f })).status,
    200,
  );
  assert.equal(images.length, 2);
  assert.equal(images[0][3], 1);
  assert.equal(images[1][3], 2);
  assert.equal(calls[0].args.p_data.image_hashes.length, 2);
  assert.equal(calls[0].args.p_data.expected_attempt, 2);
  assert.deepEqual(
    calls.map((c) => c.args.p_action),
    ["begin", "extracted"],
  );
});
test("multi-photo count, combined bytes and identical file reject BEFORE any receipt command", async (t) => {
  const { url, calls } = await app(t);
  for (const [count, size, same] of [
    [7, 4, false],
    [4, 7 * 1024 * 1024, false],
    [2, 4, true],
  ]) {
    const f = new FormData();
    for (let n = 0; n < count; n++) {
      const b = Buffer.alloc(size);
      b.set([255, 216, 255, same ? 1 : n]);
      f.append("receipt", new Blob([b], { type: "image/jpeg" }), n + ".jpg");
    }
    const response = await fetch(url + "/lists/1/receipt", {
      method: "POST",
      body: f,
    });
    assert.equal(response.status, size > 4 ? 413 : 400);
  }
  assert.equal(calls.length, 0);
});

test("six distinct images plus expected revision are accepted at the configured multipart boundary", async (t) => {
  const { url } = await app(t, async () => ({
    currency: "ILS",
    items: [{ name: "Milk", quantity: "1", unit: "unit", price: "3" }],
  }));
  const f = new FormData();
  for (let i = 0; i < 6; i++)
    f.append(
      "receipt",
      new Blob([Buffer.from([255, 216, 255, i])], { type: "image/jpeg" }),
      i + ".jpg",
    );
  f.append("expected_attempt", "0");
  const r = await fetch(url + "/lists/1/receipt", { method: "POST", body: f });
  assert.equal(r.status, 200, await r.text());
});
test("provider validation failure returns a safe diagnostic receipt, never checkout or raw provider data", async (t) => {
  const { url, calls } = await app(t, async () => {
    throw Object.assign(Error("receipt_extraction_invalid"), {
      status: 502,
      diagnosticId: "0c9393d2-ae65-4aa4-afc1-05c1ca83d8d9",
      raw: "private receipt",
    });
  });
  const response = await fetch(url + "/lists/1/receipt", {
    method: "POST",
    body: photo(),
  });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: "receipt_extraction_invalid",
    diagnostic_id: "0c9393d2-ae65-4aa4-afc1-05c1ca83d8d9",
  });
  assert.deepEqual(
    calls.map((c) => c.args.p_action),
    ["begin", "failed"],
  );
});

test("explicit reprocessing validates UUID/revision and sends bounded recoverable draft", async (t) => {
  const { url, calls } = await app(t, async () => ({
    currency: "ILS",
    items: [],
  }));
  const f = photo();
  f.append("reprocess", "true");
  f.append("reprocess_key", "00000000-0000-4000-8000-000000000041");
  f.append("expected_attempt", "4");
  f.append(
    "review_draft",
    JSON.stringify({
      items: [],
      identity: { merchant: null, receipt_number: null, purchase_date: null },
      purchase_date: "2026-09-30",
    }),
  );
  const r = await fetch(url + "/lists/1/receipt", { method: "POST", body: f });
  assert.equal(r.status, 200);
  assert.equal(calls[0].args.p_data.reprocess, true);
  assert.equal(calls[0].args.p_data.expected_attempt, 4);
  assert.deepEqual(calls[0].args.p_data.review_draft.items, []);
  const bad = photo();
  bad.append("reprocess", "true");
  assert.equal(
    (await fetch(url + "/lists/1/receipt", { method: "POST", body: bad }))
      .status,
    400,
  );
});
test("in-flight reprocessing replay never launches another provider request", async (t) => {
  let extracted = 0;
  const a = express();
  a.use(
    "/shopping",
    createShoppingIntelligenceRouter({
      db: {
        rpc: async () => ({
          data: { state: "extracting", attempts: 5, processing_replay: true },
          error: null,
        }),
      },
      extract: async () => {
        extracted++;
      },
    }),
  );
  const server = await new Promise((r) => {
    const s = a.listen(0, "127.0.0.1", () => r(s));
  });
  t.after(() => new Promise((r) => server.close(r)));
  const r = await fetch(
    `http://127.0.0.1:${server.address().port}/shopping/lists/1/receipt`,
    { method: "POST", body: photo() },
  );
  assert.equal(r.status, 202);
  assert.equal(extracted, 0);
});

test("saved unconfirmed GET projects equivalent units without mutating raw or confirmed owner evidence", async (t) => {
  const raw = {
      id: "receipt",
      state: "review",
      extracted: {
        items: [
          {
            name: "Item",
            quantity: "1",
            price: null,
            unit: null,
            line_total: "13.90",
            discount: "3.90",
            field_conflicts: [{ field: "unit", values: ["יח'", "יח׳"] }],
          },
        ],
      },
    },
    original = JSON.stringify(raw);
  const db = {
    rpc: async () => ({ data: [], error: null }),
    from: (name) => {
      const data =
        name === "shopping_lists"
          ? { list_type_id: 1 }
          : name === "shopping_receipts"
            ? [raw]
            : [];
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        single: () => chain,
        then: (resolve) => resolve({ data, error: null }),
      };
      return chain;
    },
  };
  const a = express();
  a.use("/shopping", createShoppingIntelligenceRouter({ db }));
  const server = await new Promise((r) => {
    const s = a.listen(0, "127.0.0.1", () => r(s));
  });
  t.after(() => new Promise((r) => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}/shopping/lists/1/intelligence`;
  const data = await (await fetch(url)).json();
  assert.equal(data.reconciliation.items[0].price, "10.00");
  assert.equal(data.reconciliation.items[0].unit, "יח׳");
  assert.equal(data.receipt.extracted.items[0].price, null);
  assert.equal(JSON.stringify(raw), original);
  raw.state = "confirmed";
  raw.confirmed = {
    items: [
      {
        name: "Owner value",
        quantity: "2",
        price: "7.50",
        unit: "custom package",
      },
    ],
  };
  const confirmed = await (await fetch(url)).json();
  assert.deepEqual(confirmed.receipt.confirmed, raw.confirmed);
  assert.equal(confirmed.reconciliation.items[0].price, "7.50");
  assert.equal(confirmed.reconciliation.items[0].unit, "custom package");
  assert.equal(confirmed.reconciliation.items[0].name, "Owner value");
  assert.equal(confirmed.receipt.extracted.items[0].price, null);
});
