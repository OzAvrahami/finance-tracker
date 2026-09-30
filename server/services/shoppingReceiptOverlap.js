const {
  canonicalReceiptUnit,
  equivalentReceiptUnits,
} = require("./shoppingReceiptUnits");
// A printed occurrence is not a product identity. Only adjacent-photo boundary
// sequences can collapse; repeated occurrences inside a photo are always retained.
const decimal = (value) => {
  if (value == null || !/^\d+(?:\.\d+)?$/.test(String(value))) return null;
  const [whole, fraction = ""] = String(value).split(".");
  return `${BigInt(whole)}.${fraction.replace(/0+$/, "")}`;
};
const key = (row) => row.product_code || null;
const source = (row, photo) => ({
  photo_number: photo,
  line_number: row.line_number,
});
const reading = (row,photo) => ({...source(row,photo),name:row.name,product_code:row.product_code??null,
 quantity:row.quantity,unit:row.unit,price:row.price,line_total:row.line_total??null,discount:row.discount??null,
 discount_percent:row.discount_percent??null,promotion:row.promotion??null});
function resolvePhotoOverlap(photos) {
  const output = [],
    mappings = [];
  let merged = 0;
  for (let index = 0; index < photos.length; index++) {
    const current = photos[index],
      previous = photos[index - 1],
      map = [],
      alignments = [];
    if (previous) {
      // At most two clipped, code-less head rows may precede a readable overlap.
      // They are preserved as uncertain evidence, never silently removed.
      for (let skip = 0; skip <= Math.min(2, current.items.length); skip++) {
        if (current.items.slice(0, skip).some(key)) continue;
        for (
          let k = 1;
          k <= Math.min(previous.items.length, current.items.length - skip);
          k++
        ) {
          if (
            previous.items
              .slice(-k)
              .every(
                (r, j) => key(r) && key(r) === key(current.items[skip + j]),
              )
          )
            alignments.push({ skip, k });
        }
      }
    }
    const { skip = 0, k = 0 } = alignments.at(-1) ?? {};
    const tail = previous?.items.slice(-k) ?? [];
    const confident =
      k >= 3 &&
      alignments.length === 1 &&
      new Set(tail.map(key)).size >= 2 &&
      previous.items.length - k >=
        Math.min(2, Math.floor(previous.items.length * 0.35)) &&
      skip + k - 1 <= Math.max(2, Math.ceil(current.items.length * 0.65));
    for (let j = 0; j < current.items.length; j++) {
      const row = current.items[j];
      if (confident && j >= skip && j < skip + k) {
        const existing =
          mappings[index - 1][previous.items.length - k + j - skip];
        const conflicts = [];
        for (const field of [
          "quantity",
          "price",
          "line_total",
          "discount",
          "unit",
        ]) {
          if (
            existing[field] != null &&
            row[field] != null &&
            (field === "unit"
              ? !equivalentReceiptUnits(existing[field], row[field]) &&
                existing[field].trim() !== row[field].trim()
              : decimal(existing[field]) !== decimal(row[field]))
          ) {
            conflicts.push({ field, values: [existing[field], row[field]] });
            existing[field] = null;
          } else if (
            existing[field] == null &&
            row[field] != null &&
            !existing.field_conflicts?.some((c) => c.field === field)
          )
            existing[field] = row[field];
        }
        if (conflicts.length) {
          existing.field_conflicts = [
            ...(existing.field_conflicts ?? []),
            ...conflicts,
          ];
          existing.price = null;
        }
        existing.raw_unit_readings = [
          ...new Set(
            [...(existing.raw_unit_readings ?? []), row.unit].filter(
              (v) => v != null,
            ),
          ),
        ];
        existing.source_lines.push(source(row, current.photo_number));
        existing.source_readings.push(reading(row,current.photo_number));
        existing.photo_numbers.push(current.photo_number);
        map.push(existing);
        merged++;
      } else {
        const value = {
          ...row,
          raw_unit_readings: row.unit == null ? [] : [row.unit],
          source_lines: [source(row, current.photo_number)],
          source_readings: [reading(row,current.photo_number)],
          photo_numbers: [current.photo_number],
          overlap_uncertain: confident && j < skip,
        };
        delete value.line_number;
        delete value.y;
        output.push(value);
        map.push(value);
      }
    }
    if (previous && !confident) {
      for (let j = 0; j < current.items.length; j++) {
        if (j > Math.ceil(current.items.length * 0.65)) continue;
        for (
          let h = Math.floor(previous.items.length * 0.35);
          h < previous.items.length;
          h++
        ) {
          if (
            !key(current.items[j]) ||
            key(current.items[j]) !== key(previous.items[h])
          )
            continue;
          const a = mappings[index - 1][h],
            b = map[j];
          a.overlap_uncertain = b.overlap_uncertain = true;
          a.possible_overlap_sources = [
            ...(a.possible_overlap_sources ?? []),
            source(current.items[j], current.photo_number),
          ];
          b.possible_overlap_sources = [
            ...(b.possible_overlap_sources ?? []),
            source(previous.items[h], previous.photo_number),
          ];
        }
      }
    }
    mappings.push(map);
  }
  return {
    items: output.map(normalizeReceiptRow),
    overlap_resolution: {
      merged_count: merged,
      method: "adjacent_printed_sequence_v1",
    },
  };
}
// Existing checkout uses quantity * price. Apply a printed line discount only
// when its exact net unit price is representable in that existing 2dp contract.
function applyPrintedDiscount(input) {
  const row = {...input, original_name: input.original_name ?? input.name,
    original_unit_price: input.price ?? null,
    raw_price: input.raw_price ?? {original_unit_price:input.price??null,gross_total:input.line_total??null,
      discount:input.discount??null,discount_percent:input.discount_percent??null,promotion:input.promotion??null}};
  if (row.field_conflicts?.length) return { ...row, price: null };
  if (row.discount === null) return { ...row, price: null };
  if (!row.discount || decimal(row.discount) === "0.") return row;
  const cents = (v) => {
    const [whole, fraction = ""] = String(v).split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  };
  if (!row.quantity || !row.line_total) return { ...row, price: null };
  const [whole, fraction = ""] = row.quantity.split(".");
  const milli = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
  const net = cents(row.line_total) - cents(row.discount);
  if (milli <= 0n || net < 0n || (net * 1000n) % milli !== 0n)
    return { ...row, price: null };
  const price = (net * 1000n) / milli;
  return {
    ...row,
    price: `${price / 100n}.${String(price % 100n).padStart(2, "0")}`,
  };
}
// Pure read projection for saved unconfirmed extraction. Never edits source JSON,
// confirmed purchases, archived owner drafts or non-null owner corrections.
function normalizeReceiptRow(input) {
  const row = { ...input };
  const resolved = (row.field_conflicts ?? []).filter(
    (c) =>
      c.field === "unit" &&
      c.values.length > 1 &&
      c.values.every((v) => equivalentReceiptUnits(v, c.values[0])),
  );
  row.raw_unit_readings = [
    ...new Set(
      [
        ...(row.raw_unit_readings ?? []),
        row.unit,
        ...resolved.flatMap((c) => c.values),
      ].filter((v) => v != null),
    ),
  ];
  if (resolved.length) {
    row.field_conflicts = (row.field_conflicts ?? []).filter(
      (c) => !resolved.includes(c),
    );
    row.resolved_conflicts = [
      ...(row.resolved_conflicts ?? []),
      ...resolved.map((c) => ({ ...c, resolution: "equivalent_unit" })),
    ];
    if (row.unit == null && !row.owner_edited_fields?.includes("unit"))
      row.unit = canonicalReceiptUnit(resolved[0].values[0]);
    if (
      row.price == null &&
      !row.owner_edited_fields?.includes("price") &&
      !row.field_conflicts.length &&
      row.discount != null
    ) {
      row.price = exactNetUnitPrice(row);
    }
  }
  if (!row.owner_edited_fields?.includes("unit"))
    row.unit = canonicalReceiptUnit(row.unit);
  return row;
}
function exactNetUnitPrice(row) {
  if (
    !/^\d{1,5}(?:\.\d{1,3})?$/.test(String(row.quantity)) ||
    !/^\d{1,6}(?:\.\d{1,2})?$/.test(String(row.line_total)) ||
    !/^\d{1,6}(?:\.\d{1,2})?$/.test(String(row.discount))
  )
    return null;
  const scaled = (v, n) => {
    const [a, b = ""] = String(v).split(".");
    return BigInt(a) * 10n ** BigInt(n) + BigInt(b.padEnd(n, "0"));
  };
  const milli = scaled(row.quantity, 3),
    net = scaled(row.line_total, 2) - scaled(row.discount, 2);
  if (milli <= 0n || net < 0n || (net * 1000n) % milli !== 0n) return null;
  const cents = (net * 1000n) / milli;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}
module.exports = {
  resolvePhotoOverlap,
  applyPrintedDiscount,
  normalizeReceiptRow,
};
