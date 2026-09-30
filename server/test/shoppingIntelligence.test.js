const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  suggestions,
  reconcile,
  confirmationSchema,
  regularSchema,
} = require("../services/shoppingHabitsService");
const {
  extractReceipt,
  imageType,
} = require("../services/shoppingReceiptExtractor");
const catalog = [{ id: 1, name: "חלב", default_unit: "ליטר", is_active: true }];
const purchase = (date, quantity = "2") => ({
  purchase_date: date,
  items: [
    {
      catalog_item_id: "1",
      name: "חלב",
      quantity,
      unit: "ליטר",
      price: "7.00",
    },
  ],
});
test("no history gives no invented recommendations; explicit regulars support first use", () => {
  assert.deepEqual(suggestions(catalog, [], []), []);
  const [s] = suggestions(
    catalog,
    [{ catalog_item_id: 1, quantity: "3", unit: "ליטר" }],
    [],
  );
  assert.equal(s.quantity, "3");
  assert.match(s.explanation, /אין רכישה/);
  assert.equal(s.interval_days, null);
});
test("sparse history offers last quantity with honest explanation, not invented cadence", () => {
  const [s] = suggestions(
    catalog,
    [],
    [purchase("2026-09-20")],
    new Date("2026-09-30"),
  );
  assert.equal(s.quantity, "2");
  assert.match(s.explanation, /10 ימים/);
  assert.match(s.explanation, /אין מספיק/);
});
test("three distinct confirmed dates give deterministic interval; not due is not suggested", () => {
  const h = ["2026-09-01", "2026-09-08", "2026-09-15"].map((d) => purchase(d));
  assert.equal(suggestions(catalog, [], h, new Date("2026-09-16")).length, 0);
  const [s] = suggestions(catalog, [], h, new Date("2026-09-30"));
  assert.equal(s.interval_days, 7);
  assert.match(s.explanation, /המלאי/);
});
test("reconciliation never modifies original plan; uncertain substitutions require review", () => {
  const plan = purchase("2026-09-20").items;
  const before = JSON.stringify(plan);
  const result = reconcile(
    plan,
    [
      { name: "חלב", quantity: "1", unit: "ליטר", price: "7" },
      { name: "חלב סויה", quantity: "1", unit: "ליטר", price: "10" },
    ],
    catalog,
  );
  assert.equal(result.items[0].comparison, "added");
  assert.equal(result.items[0].catalog_item_id,null);
  assert.deepEqual(result.items[0].suggested_personal_items,[{id:'1',name:'חלב'}]);
  assert.equal(result.items[1].catalog_item_id, null);
  assert.deepEqual(result.items[1].possible_substitutions, ["חלב"]);
  assert.ok(result.items.every((i) => i.match_requires_review));
  assert.equal(JSON.stringify(plan), before);
  assert.equal(reconcile(plan, [], catalog).absent.length, 1);
});
test("confirmation requires explicit review, real date, positive quantities and known scalar shapes", () => {
  const good = {
    purchase_date: "2026-09-30",
    items: purchase("x").items,
    reviewed: true,
    extraction_attempt: 1,
  };
  assert.ok(confirmationSchema.safeParse(good).success);
  for (const bad of [
    { ...good, reviewed: false },
    { ...good, purchase_date: "2026-02-30" },
    { ...good, transaction_id: 1 },
    { ...good, items: [{ ...good.items[0], quantity: "0" }] },
    { ...good, items: [{ ...good.items[0], price: "-1" }] },
  ])
    assert.equal(confirmationSchema.safeParse(bad).success, false);
  assert.equal(
    regularSchema.safeParse({ quantity: "1.2345", unit: "kg" }).success,
    false,
  );
});
test("receipt adapter rejects file spoofing and fails closed without provider config", async () => {
  assert.throws(() => imageType(Buffer.from("not a photo")));
  await assert.rejects(
    extractReceipt(Buffer.from([255, 216, 255]), { env: {} }),
    /unconfigured/,
  );
});
test("real provider boundary sends image and strict schema, returns only reviewed candidate data", async () => {
  let request;
  const value = {
    currency: "ILS",
    identity: {
      merchant: "Market",
      receipt_number: "R-123",
      purchase_date: "2026-09-30",
    },
    items: [{ name: "חלב", quantity: "2", unit: "ליטר", price: "7.00" }],
  };
  const out = await extractReceipt(Buffer.from([255, 216, 255]), {
    env: {
      SHOPPING_RECEIPT_OPENAI_KEY: "test-only",
      SHOPPING_RECEIPT_MODEL: "test-model",
    },
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/chat/completions");
      request = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(value) } }],
        }),
      };
    },
  });
  assert.equal(request.store, false);
  assert.equal(request.response_format.json_schema.strict, true);
  const {extraction_run,...candidate}=out;
  assert.deepEqual(candidate, value);
  assert.ok(Number.isFinite(extraction_run.duration_ms) && extraction_run.duration_ms>=0);
  assert.deepEqual({...extraction_run,duration_ms:0},{model:'test-model',provider_calls:1,duration_ms:0,prompt_tokens:0,completion_tokens:0,total_tokens:0});
});
test("provider failure/refusal/foreign currency never become fake extraction", async () => {
  for (const response of [
    { ok: false },
    {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "{}" } }] }),
    },
  ])
    await assert.rejects(
      extractReceipt(Buffer.from([255, 216, 255]), {
        env: {
          SHOPPING_RECEIPT_OPENAI_KEY: "test",
          SHOPPING_RECEIPT_MODEL: "test",
        },
        fetchImpl: async () => response,
      }),
    );
});

test("independent photo transcription preserves separate printed repeats within a photo", async () => {
  const line = {
    name: "Milk",
    quantity: "1",
    unit: "unit",
    price: "3",
    product_code: "123",
    line_total: "3",
    discount: "0",
    line_number: 1,
    y: 100,
  };
  let requests = 0;
  const result = await extractReceipt(
    [Buffer.from([255, 216, 255, 1]), Buffer.from([255, 216, 255, 2])],
    {
      env: {
        SHOPPING_RECEIPT_OPENAI_KEY: "test-only",
        SHOPPING_RECEIPT_MODEL: "test-only",
      },
      fetchImpl: async (url, options) => {
        requests++;
        const request = JSON.parse(options.body);
        assert.equal(request.messages[1].content.length, 1);
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    currency: "ILS",
                    receipt_total: null,
                    photos: [
                      {
                        photo_number: 1,
                        items: [line, { ...line, line_number: 2, y: 800 }],
                      },
                    ],
                  }),
                },
              },
            ],
          }),
        };
      },
    },
  );
  assert.equal(requests, 2);
  assert.equal(result.items.length, 4);
  assert.equal(result.overlap_resolution.merged_count, 0);
});
