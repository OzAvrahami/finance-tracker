const {planningRow,aggregatePlanning}=require('../../shared/shoppingQuantities.mjs');
const { z } = require("zod");
const id = z
  .union([
    z.string().regex(/^[1-9]\d{0,15}$/),
    z.number().int().positive().safe(),
  ])
  .transform(String);
const decimal = (places, positive = false) =>
  z
    .union([z.string(), z.number()])
    .transform(String)
    .refine(
      (v) =>
        new RegExp(`^\\d{1,6}(?:\\.\\d{1,${places}})?$`).test(v) &&
        Number(v) <= 10000 &&
        (!positive || Number(v) > 0),
      "invalid decimal",
    );
const itemSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    quantity: decimal(3, true),
    unit: z.string().trim().min(1).max(30),
    price: decimal(2),
    catalog_item_id: id.nullable(),
  })
  .strict();
const receiptIdentitySchema = z.object({
  merchant: z.string().trim().min(1).max(200).nullable(),
  receipt_number: z.string().trim().min(1).max(100).nullable(),
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v + 'T12:00:00Z')) && new Date(v + 'T12:00:00Z').toISOString().slice(0,10) === v).nullable(),
}).strict();
const duplicateReviewSchema = z.array(z.string().uuid()).max(200);
const confirmationSchema = z
  .object({
    purchase_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (v) =>
          !Number.isNaN(Date.parse(v + "T12:00:00Z")) &&
          new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v,
      ),
    items: z.array(itemSchema).min(1).max(200),
    reviewed: z.literal(true),
    extraction_attempt: z.number().int().min(1).max(5),
    identity: receiptIdentitySchema.optional(),
    duplicate_reviewed_ids: duplicateReviewSchema.optional(),
  })
  .strict();
const regularSchema = z
  .object({
    quantity: decimal(3, true),
    unit: z.string().trim().min(1).max(30),
  })
  .strict();
const normalizeName = (v) =>
  String(v)
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("he")
    .replace(/[\s\p{P}]+/gu, " ");
const median = (values) => {
  const a = [...values].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
};
function suggestions(catalog, regulars, history, now = new Date()) {
  const regular = new Map(regulars.map((r) => [String(r.catalog_item_id), r]));
  return catalog
    .filter((c) => c.is_active !== false)
    .flatMap((c) => {
      const purchases = history
        .flatMap((p) => {
          const rows = p.items.filter(i=>String(i.mapping_snapshot?.personal_item_id??i.catalog_item_id)===String(c.id));
          if(!rows.length)return [];
          const targetUnit=c.default_unit??planningRow(rows.at(-1))?.unit;
          const total=aggregatePlanning(rows,{id:c.id,unit:targetUnit});
          return [{date:p.purchase_date,quantity:total.unresolved?null:total.quantity,unit:targetUnit,unresolved:total.unresolved}];
        })
        .sort((a, b) => a.date.localeCompare(b.date));
      const r = regular.get(String(c.id));
      const latest = purchases.at(-1);
      if (!r && !latest) return [];
      const days = latest
        ? Math.max(
            0,
            Math.floor(
              (Date.parse(now.toISOString().slice(0, 10)) -
                Date.parse(latest.date)) /
                86400000,
            ),
          )
        : null;
      const dates = [...new Set(purchases.map((p) => p.date))];
      const interval =
        dates.length >= 3
          ? median(
              dates
                .slice(1)
                .map(
                  (d, i) => (Date.parse(d) - Date.parse(dates[i])) / 86400000,
                ),
            )
          : null;
      if (!r && interval !== null && days < interval) return [];
      return [
        {
          catalog_item_id: String(c.id),
          name: c.name,
          quantity: r ? String(r.quantity) : String(latest?.quantity ?? 1),
          unit: r?.unit ?? latest?.unit ?? c.default_unit ?? "יח׳",
          regular: !!r,
          last_purchase: latest?.date ?? null,
          interval_days: interval,
          purchase_occasions: purchases.length,
          quantity_unresolved: !!latest?.unresolved,
          explanation:
            latest?.unresolved ? "הקנייה אושרה אך המרת הכמות לא הושלמה; הכמות המוצעת היא ברירת מחדל." : interval !== null
              ? `נרכש בדרך כלל כל ${interval} ימים; עברו ${days} ימים. אין מידע על המלאי בבית.`
              : latest
                ? `נרכש לאחרונה לפני ${days} ימים; עדיין אין מספיק היסטוריה להערכת תדירות.`
                : "מוצר קבוע שבחרת; עדיין אין רכישה מאושרת.",
        },
      ];
    });
}
function reconcile(plan, items, catalog) {
  const actual = items.map((i) => {
    const exact = catalog.filter(
      (c) => normalizeName(c.name) === normalizeName(i.name),
    );
    const catalog_item_id = i.mapping_snapshot?.personal_item_id ?? i.catalog_item_id ?? null;
    const planned = plan.find(
      (p) => catalog_item_id && String(p.catalog_item_id) === catalog_item_id,
    );
    return {
      ...i,
      catalog_item_id,
      match_requires_review: true,
      suggested_personal_items: !catalog_item_id?exact.map(c=>({id:String(c.id),name:c.name})):[],
      comparison: planned
        ? aggregatePlanning(items,{...planned,unit:planned.unit}).unresolved===0 &&
          Number(planned.quantity) === Number(aggregatePlanning(items,{...planned,unit:planned.unit}).quantity)
          ? "bought"
          : "quantity_changed"
        : "added",
      possible_substitutions: !planned
        ? plan
            .filter((p) =>
              normalizeName(p.name)
                .split(" ")
                .some(
                  (w) =>
                    w.length > 2 &&
                    normalizeName(i.name).split(" ").includes(w),
                ),
            )
            .map((p) => p.name)
        : [],
    };
  });
  return {
    items: actual,
    fulfillment:plan.map(p=>({...aggregatePlanning(actual,p),catalog_item_id:String(p.catalog_item_id),planned_quantity:String(p.quantity),name:p.name})),
    absent: plan.filter(
      (p) =>
        !actual.some(
          (i) =>
            i.catalog_item_id &&
            String(p.catalog_item_id) === i.catalog_item_id,
        ),
    ),
  };
}
module.exports = {
  id,
  receiptIdentitySchema,
  duplicateReviewSchema,
  itemSchema,
  regularSchema,
  confirmationSchema,
  suggestions,
  reconcile,
};
