const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  resolvePhotoOverlap,
  applyPrintedDiscount,
} = require("../services/shoppingReceiptOverlap");
const row = (code, n, y, changes = {}) => ({
  product_code: code,
  name: "product " + code,
  line_total: "12.00",
  discount: "0.00",
  quantity: "2",
  unit: "unit",
  price: "6.00",
  line_number: n,
  y,
  ...changes,
});
const photo = (n, codes, ys) => ({
  photo_number: n,
  items: codes.map((c, i) => row(c, i + 1, ys[i])),
});
test("adjacent suffix/prefix sequence collapses physical repeats and keeps source line evidence", () => {
  const result = resolvePhotoOverlap([
    photo(1, ["100", "200", "300", "400"], [100, 600, 750, 950]),
    photo(2, ["200", "300", "400", "500"], [50, 200, 400, 900]),
  ]);
  assert.deepEqual(
    result.items.map((r) => r.product_code),
    ["100", "200", "300", "400", "500"],
  );
  assert.equal(result.overlap_resolution.merged_count, 3);
  assert.deepEqual(result.items[1].source_lines, [
    { photo_number: 1, line_number: 2 },
    { photo_number: 2, line_number: 1 },
  ]);
  assert.ok(result.items.every((r) => !r.overlap_uncertain));
});
test("two separately printed identical cookies survive boundary matching, one occurrence each", () => {
  const result = resolvePhotoOverlap([
    photo(1, ["100", "200", "200", "300"], [100, 600, 700, 900]),
    photo(2, ["200", "200", "300", "400"], [40, 160, 300, 850]),
  ]);
  assert.equal(result.items.filter((r) => r.product_code === "200").length, 2);
  assert.equal(result.overlap_resolution.merged_count, 3);
  assert.notDeepEqual(
    result.items[1].source_lines,
    result.items[2].source_lines,
  );
});
test("single shared row or identical-only sequences stay ambiguous rather than guessed away", () => {
  for (const codes of [["200"], ["200", "200", "200"]]) {
    const a = photo(
        1,
        ["100", ...codes],
        [100, ...codes.map((_, i) => 600 + i * 100)],
      ),
      b = photo(
        2,
        [...codes, "300"],
        [...codes.map((_, i) => 50 + i * 100), 900],
      );
    const r = resolvePhotoOverlap([a, b]);
    assert.equal(r.overlap_resolution.merged_count, 0);
    assert.equal(r.items.length, a.items.length + b.items.length);
    assert.ok(r.items.some((i) => i.overlap_uncertain));
  }
});
test("same SKU/price in interiors or nonadjacent photos never becomes global purchase identity", () => {
  const r = resolvePhotoOverlap([
    photo(1, ["100", "200", "300"], [100, 300, 500]),
    photo(2, ["100", "200", "300"], [400, 650, 900]),
  ]);
  assert.equal(r.items.length, 6);
  assert.equal(r.overlap_resolution.merged_count, 0);
});
test("strong printed-code sequence merges identity but conflicting values remain blocked for correction", () => {
  const a = photo(1, ["100", "200", "300", "400"], [100, 600, 750, 900]),
    b = photo(2, ["200", "300", "400", "500"], [40, 100, 300, 900]);
  b.items[1].quantity = "3";
  b.items[1].line_total = "18.00";
  const r = resolvePhotoOverlap([a, b]);
  assert.equal(r.overlap_resolution.merged_count, 3);
  const conflict = r.items.find((i) => i.product_code === "300");
  assert.equal(conflict.quantity, null);
  assert.equal(conflict.price, null);
  assert.equal(conflict.source_lines.length, 2);
  assert.equal(conflict.field_conflicts.length, 2);
  assert.equal(applyPrintedDiscount(conflict).price, null);
});
test("missing code prevents blind merge; two clipped prefix rows are retained while the clear boundary merges", () => {
  const a = photo(1, ["100", "200", "300", "400"], [100, 600, 750, 900]),
    b = photo(
      2,
      [null, null, "200", "300", "400", "500"],
      [0, 20, 50, 100, 300, 900],
    );
  const r = resolvePhotoOverlap([a, b]);
  assert.equal(r.overlap_resolution.merged_count, 3);
  assert.equal(r.items.filter((i) => i.product_code === null).length, 2);
  assert.ok(
    r.items
      .filter((i) => i.product_code === null)
      .every((i) => i.overlap_uncertain),
  );
  b.items[3].product_code = null;
  assert.equal(resolvePhotoOverlap([a, b]).overlap_resolution.merged_count, 0);
});
test("printed discounts become exact net unit price only when representable; no hidden rounding", () => {
  assert.equal(
    applyPrintedDiscount(
      row("100", 1, 50, {
        quantity: "2",
        line_total: "22.00",
        discount: "4.00",
        price: "11.00",
      }),
    ).price,
    "9.00",
  );
  assert.equal(
    applyPrintedDiscount(
      row("100", 1, 50, {
        quantity: "4.156",
        line_total: "124.26",
        discount: "20.36",
        price: "29.90",
      }),
    ).price,
    "25.00",
  );
  assert.equal(
    applyPrintedDiscount(
      row("100", 1, 50, {
        quantity: "3",
        line_total: "10.00",
        discount: "1.00",
      }),
    ).price,
    "3.00",
  );
  assert.equal(
    applyPrintedDiscount(
      row("100", 1, 50, {
        quantity: "3",
        line_total: "10.00",
        discount: "0.99",
      }),
    ).price,
    null,
  );
  assert.equal(
    applyPrintedDiscount(
      row("100", 1, 50, { quantity: null, discount: "1.00" }),
    ).price,
    null,
  );
});

test("unit disagreement cannot restore a price via discount calculation", () => {
  const a = photo(1, ["100", "200", "300", "400"], [100, 600, 750, 900]),
    b = photo(2, ["200", "300", "400", "500"], [40, 100, 300, 900]);
  a.items[1].discount = b.items[0].discount = "2.00";
  b.items[0].unit = "kg";
  const conflict = resolvePhotoOverlap([a, b]).items[1];
  assert.equal(conflict.unit, null);
  assert.equal(applyPrintedDiscount(conflict).price, null);
  assert.equal(conflict.field_conflicts[0].field, "unit");
});

const {
  canonicalReceiptUnit,
  equivalentReceiptUnits,
} = require("../services/shoppingReceiptUnits");
const { normalizeReceiptRow } = require("../services/shoppingReceiptOverlap");
test("closed canonical unit aliases ignore spacing/quotes but never change scale or packaging", () => {
  for (const v of ["יח'", "  יח׳  ", "יחידה", "units"])
    assert.equal(canonicalReceiptUnit(v), "יח׳");
  for (const v of ['ק " ג', "ק״ג", "kg"])
    assert.equal(canonicalReceiptUnit(v), "ק״ג");
  assert.equal(equivalentReceiptUnits("גרם", "ק״ג"), false);
  assert.equal(equivalentReceiptUnits("ml", "ליטר"), false);
  assert.equal(equivalentReceiptUnits("יחידה", "חבילה"), false);
  assert.equal(equivalentReceiptUnits("מארז 6", "מארז"), false);
  assert.equal(canonicalReceiptUnit("unrecognized unit"), "unrecognized unit");
});
test("saved unit-only conflict restores exact zero/positive-discount price without changing raw input", () => {
  const input = {
    quantity: "1",
    unit: null,
    price: null,
    line_total: "13.90",
    discount: "3.90",
    field_conflicts: [{ field: "unit", values: ["יח'", "יח׳"] }],
  };
  const before = JSON.stringify(input),
    result = normalizeReceiptRow(input);
  assert.equal(result.unit, "יח׳");
  assert.equal(result.price, "10.00");
  assert.deepEqual(result.field_conflicts, []);
  assert.deepEqual(
    result.resolved_conflicts[0].values,
    input.field_conflicts[0].values,
  );
  assert.equal(JSON.stringify(input), before);
  assert.equal(
    normalizeReceiptRow({ ...input, line_total: "15.90", discount: "0.00" })
      .price,
    "15.90",
  );
  assert.deepEqual(normalizeReceiptRow(result), result);
});
test("normalization keeps genuine conflicts, unrepresentable money and owner corrections", () => {
  const input = {
    quantity: "3",
    unit: null,
    price: null,
    line_total: "10.00",
    discount: "0.99",
    field_conflicts: [{ field: "unit", values: ["יח'", "יח׳"] }],
  };
  assert.equal(normalizeReceiptRow(input).price, null);
  const edited = normalizeReceiptRow({
    ...input,
    price: "2.50",
    unit: "custom pack",
    owner_edited_fields: ["price", "unit"],
  });
  assert.equal(edited.price, "2.50");
  assert.equal(edited.unit, "custom pack");
  assert.equal(
    normalizeReceiptRow({
      ...input,
      field_conflicts: [
        ...input.field_conflicts,
        { field: "quantity", values: ["1", "3"] },
      ],
    }).price,
    null,
  );
  assert.equal(
    normalizeReceiptRow({
      ...input,
      field_conflicts: [{ field: "unit", values: ["גרם", "ק״ג"] }],
    }).unit,
    null,
  );
});
test("new photo overlap canonicalizes equivalent units and retains both raw spellings without false markers", () => {
  const a = photo(1, ["100", "200", "300", "400"], [100, 600, 750, 900]),
    b = photo(2, ["200", "300", "400", "500"], [40, 100, 300, 900]);
  a.items.forEach((r) => (r.unit = "יח׳"));
  b.items.forEach((r) => (r.unit = "יח'"));
  const r = resolvePhotoOverlap([a, b]);
  assert.equal(r.overlap_resolution.merged_count, 3);
  assert.ok(r.items.every((i) => !i.field_conflicts?.length));
  assert.deepEqual(r.items[1].raw_unit_readings, ["יח׳", "יח'"]);
});

test("eight saved unit-only rows restore 84.90, including the undiscounted 15.90 row", () => {
  const amounts = [
    ["1", "13.90", "3.90"],
    ["1", "13.90", "3.90"],
    ["1", "15.10", "3.10"],
    ["1", "15.10", "3.10"],
    ["2", "12.20", "2.20"],
    ["1", "15.90", "0.00"],
    ["1", "12.90", "5.40"],
    ["1", "12.90", "5.40"],
  ];
  const rows = amounts.map(([quantity, line_total, discount]) =>
    normalizeReceiptRow({
      quantity,
      line_total,
      discount,
      unit: null,
      price: null,
      field_conflicts: [{ field: "unit", values: ["יח'", "יח׳"] }],
    }),
  );
  const cents = rows.reduce(
    (n, r) => n + BigInt(r.price.replace(".", "")) * BigInt(r.quantity),
    0n,
  );
  assert.equal(cents, 8490n);
  assert.ok(rows.every((r) => !r.field_conflicts.length));
  // The remaining gap is a balance of absent conflicted rows and included copies,
  // not a fabricated receipt-level adjustment.
  assert.equal(
    116958n + cents + 1300n + 1300n + 1500n - 2000n - 664n - 663n,
    126221n,
  );
});
