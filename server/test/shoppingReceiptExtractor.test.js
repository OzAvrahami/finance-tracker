const test = require("node:test");
const assert = require("node:assert/strict");
const { extractReceipt } = require("../services/shoppingReceiptExtractor");
const { confirmationSchema } = require("../services/shoppingHabitsService");
const env = {
  SHOPPING_RECEIPT_OPENAI_KEY: "secret-test-value",
  SHOPPING_RECEIPT_MODEL: "test-model",
};
const images = [1, 2, 3, 4].map((n) => Buffer.from([255, 216, 255, n]));
const line = {
  name: "Private product",
  quantity: "2",
  unit: "unit",
  price: "3.00",
  photo_numbers: [1],
  overlap_uncertain: false,
};
const value = { currency: "ILS", items: [line] };
const completion = (v) => ({
  ok: true,
  status: 200,
  json: async () => ({
    choices: [
      { finish_reason: "stop", message: { content: JSON.stringify(v) } },
    ],
  }),
});
test("four independently transcribed photos preserve order and nullable review fields", async () => {
  const sent = [];
  const result = await extractReceipt(images, {
    env,
    fetchImpl: async (_, options) => {
      const request = JSON.parse(options.body);
      sent.push(request.messages[1].content[0].image_url.url.split(",")[1]);
      assert.equal(request.messages[1].content.length, 1);
      assert.ok(
        request.response_format.json_schema.schema.properties.items.items
          .properties.quantity.pattern,
      );
      return completion({
        currency: "ILS",
        receipt_total: null,
        photos: [
          {
            photo_number: 1,
            items: [
              { ...line, quantity: "", unit: "", line_number: 1, y: 500 },
            ],
          },
        ],
      });
    },
  });
  assert.deepEqual(
    sent,
    images.map((i) => i.toString("base64")),
  );
  assert.deepEqual(
    result.items.map((i) => i.quantity),
    [null, null, null, null],
  );
  assert.deepEqual(
    result.items.map((i) => i.photo_numbers),
    [[1], [2], [3], [4]],
  );
  const confirm = (items) =>
    confirmationSchema.safeParse({
      purchase_date: "2026-09-30",
      items,
      reviewed: true,
      extraction_attempt: 1,
    }).success;
  const plain = {
    catalog_item_id: null,
    name: line.name,
    quantity: line.quantity,
    unit: line.unit,
    price: line.price,
  };
  assert.equal(confirm([plain]), true);
  assert.equal(confirm([{ ...plain, quantity: null }]), false);
  assert.equal(confirm([{ ...plain, unit: null }]), false);
});

test("failure stages are distinct and diagnostics never include provider content or credentials", async () => {
  const cases = [
    [
      { ok: false, status: 401 },
      "receipt_provider_configuration",
      "provider_http",
    ],
    [
      { ok: false, status: 429 },
      "receipt_provider_rate_limited",
      "provider_http",
    ],
    [
      { ok: false, status: 500 },
      "receipt_provider_unavailable",
      "provider_http",
    ],
    [
      {
        ok: true,
        status: 200,
        json: async () => {
          throw Error("private body");
        },
      },
      "receipt_provider_response_invalid",
      "response_json",
    ],
    [
      {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            { finish_reason: "length", message: { content: '{"private' } },
          ],
        }),
      },
      "receipt_extraction_truncated",
      "completion",
    ],
    [
      {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { refusal: "private receipt" } }],
        }),
      },
      "receipt_extraction_refused",
      "completion",
    ],
    [
      {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "private invalid json" } }],
        }),
      },
      "receipt_provider_response_invalid",
      "content_json",
    ],
    [
      completion({ ...value, currency: "USD" }),
      "receipt_currency_unsupported",
      "currency",
    ],
    [completion({ ...value, items: [] }), "receipt_no_readable_items", "items"],
    [
      completion({
        ...value,
        items: [{ ...line, quantity: "private invalid quantity" }],
      }),
      "receipt_extraction_invalid",
      "validation",
    ],
    [
      completion({ ...value, items: [{ ...line, photo_numbers: [6] }] }),
      "receipt_extraction_invalid",
      "photo_references",
    ],
  ];
  for (const [response, code, stage] of cases) {
    const diagnostics = [];
    await assert.rejects(
      extractReceipt(images[0], {
        env,
        fetchImpl: async () => response,
        diagnostic: (d) => diagnostics.push(d),
      }),
      (e) => {
        assert.equal(e.message, code);
        assert.match(e.diagnosticId, /^[a-f0-9-]{36}$/);
        return true;
      },
    );
    assert.equal(diagnostics[0].stage, stage);
    assert.doesNotMatch(
      JSON.stringify(diagnostics),
      /private|secret-test-value|base64|Authorization/i,
    );
  }
});
test("transport timeout is actionable and strict numeric precision remains enforced", async () => {
  await assert.rejects(
    extractReceipt(images[0], {
      env,
      diagnostic: () => {},
      fetchImpl: async () => {
        throw Object.assign(Error(), { name: "TimeoutError" });
      },
    }),
    /receipt_provider_timeout/,
  );
  for (const quantity of ["1,5", "1.2345", "-1", "not a number"]) {
    await assert.rejects(
      extractReceipt(images[0], {
        env,
        diagnostic: () => {},
        fetchImpl: async () =>
          completion({ ...value, items: [{ ...line, quantity }] }),
      }),
      /receipt_extraction_invalid/,
    );
  }
});

test("expired shared deadline makes no further provider request", async () => {
  let calls = 0;
  await assert.rejects(
    extractReceipt(images[0], {
      env,
      deadline: Date.now() - 1,
      diagnostic: () => {},
      fetchImpl: async () => {
        calls++;
        return completion(value);
      },
    }),
    /receipt_provider_timeout/,
  );
  assert.equal(calls, 0);
});
test("multi-photo transcription requires occurrence sequence rather than silently accepting unpositioned items", async () => {
  await assert.rejects(
    extractReceipt(images.slice(0, 2), {
      env,
      diagnostic: () => {},
      fetchImpl: async () => completion(value),
    }),
    /receipt_extraction_invalid/,
  );
});

test("production-shaped per-image output resolves one boundary, preserves repeated occurrences and exact total", async () => {
  let call = 0;
  const sections = [
    ["100", "200", "200", "300"],
    ["200", "200", "300", "400"],
  ];
  const result = await extractReceipt(images.slice(0, 2), {
    env,
    diagnostic: () => {},
    fetchImpl: async () => {
      const i = call++;
      return completion({
        currency: "ILS",
        identity: { merchant: null, receipt_number: null, purchase_date: null },
        receipt_total: i ? "30.00" : "30",
        items: sections[i].map((code, j) => ({
          name: "Product",
          quantity: "1",
          unit: "unit",
          price: "6.00",
          product_code: code,
          line_total: "6.00",
          discount: "0.00",
          line_number: j + 1,
        })),
      });
    },
  });
  assert.equal(call, 2);
  assert.equal(result.overlap_resolution.merged_count, 3);
  assert.equal(result.items.length, 5);
  assert.equal(result.items.filter((i) => i.product_code === "200").length, 2);
  assert.equal(result.receipt_total, "30.00");
  assert.deepEqual(result.items[1].source_lines, [
    { photo_number: 1, line_number: 2 },
    { photo_number: 2, line_number: 1 },
  ]);
});

test("a footer-only photo contributes its printed total; an all-empty photo set is rejected", async () => {
  const footer = {
    currency: "ILS",
    identity: { merchant: null, receipt_number: null, purchase_date: null },
    receipt_total: "6.00",
    items: [],
  };
  let call = 0;
  const result = await extractReceipt(images.slice(0, 2), {
    env,
    diagnostic: () => {},
    fetchImpl: async () =>
      completion(
        call++
          ? footer
          : {
              ...footer,
              receipt_total: null,
              items: [{ ...line, line_number: 1 }],
            },
      ),
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.receipt_total, "6.00");
  assert.equal(result.overlap_warnings.length, 1);
  await assert.rejects(
    extractReceipt(images.slice(0, 2), {
      env,
      diagnostic: () => {},
      fetchImpl: async () => completion(footer),
    }),
    /receipt_no_readable_items/,
  );
});
