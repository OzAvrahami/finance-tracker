const { z } = require('zod');
const { createProductLookup, enrichKnownProducts } = require('../services/shoppingProductLookup');
const { identifier } = require('../services/shoppingProductIdentifiers');
const {commercialProduct,validateMappingSnapshots,hydrateCommercialRows}=require('../services/shoppingCommercialProducts');
const {unitCode}=require('../../shared/shoppingQuantities.mjs');
const { reviewSchema, reviewProjection, confirmationItems } = require('../services/shoppingReceiptReview');
const { normalizeReceiptRow } = require("../services/shoppingReceiptOverlap");
const express = require("express");
const multer = require("multer");
const { rateLimit } = require("express-rate-limit");
const { createHash } = require("node:crypto");
const {
  id,
  receiptIdentitySchema,
  regularSchema,
  confirmationSchema,
  suggestions,
  reconcile,
} = require("../services/shoppingHabitsService");
const {
  extractReceipt,
  validateImages,
} = require("../services/shoppingReceiptExtractor");
const unwrap = async (query) => {
  const { data, error } = await query;
  if (error) throw error;
  return data;
};
const errorResponse = (res, error) => {
  if (error.name === "ZodError" || error instanceof SyntaxError)
    return res.status(400).json({ error: "shopping_input_invalid" });
  const code = error.message || "";
  if (error.code === "23505")
    return res.status(409).json({ error: "receipt_duplicate" });
  if (/^(receipt_|shopping_|checkout_|suggestion_)[a-z_]+$/.test(code))
    return res.status(error.status || 409).json({
      error: code,
      ...(error.diagnosticId ? { diagnostic_id: error.diagnosticId } : {}),
    });
  return res.status(503).json({ error: "shopping_service_unavailable" });
};
function createShoppingIntelligenceRouter({ db, extract = extractReceipt, lookup = createProductLookup(db) }) {
  const router = express.Router();
  const handle = (fn) => async (req, res) => {
    try {
      if (req.params.id) id.parse(req.params.id);
      await fn(req, res);
    } catch (e) {
      errorResponse(res, e);
    }
  };
  const rpc = (list, action, data) =>
    unwrap(
      db.rpc("shopping_receipt_command", {
        p_list: list,
        p_action: action,
        p_data: data,
      }),
    );
  router.get(
    "/lists/:id/intelligence",
    handle(async (req, res) => {
      const list = await unwrap(
        db
          .from("shopping_lists")
          .select("list_type_id")
          .eq("id", req.params.id)
          .single(),
      );
      const links = await unwrap(
        db
          .from("shopping_catalog_category_list_types")
          .select("category_id")
          .eq("list_type_id", list.list_type_id),
      );
      const catalog = links.length
        ? await unwrap(
            db
              .from("shopping_catalog_items")
              .select("*")
              .eq("is_active", true)
              .in(
                "category_id",
                links.map((l) => l.category_id),
              )
              .order("name"),
          )
        : [];
      const [regulars, history, plans, receipts] = await Promise.all([
        unwrap(db.from("shopping_regular_products").select("*")),
        unwrap(
          db
            .from("shopping_confirmed_purchases")
            .select("*")
            .order("purchase_date", { ascending: false })
            .limit(500),
        ),
        unwrap(
          db
            .from("shopping_purchase_plans")
            .select("*")
            .eq("list_id", req.params.id),
        ),
        unwrap(
          db.from("shopping_receipts").select("*").eq("list_id", req.params.id),
        ),
      ]);
      res.json({
        duplicate_candidates: await unwrap(
          db.rpc("shopping_receipt_duplicates", { p_list: req.params.id }),
        ),
        catalog,
        regulars,
        suggestions: suggestions(catalog, regulars, history),
        plan: plans[0]?.items ?? null,
        receipt: receipts[0] ?? null,
        reconciliation: receipts[0]?.extracted
          ? reconcile(
              plans[0]?.items ?? [],
              receipts[0].state === "confirmed"
                ? receipts[0].confirmed.items
                : await enrichKnownProducts(await reviewProjection(receipts[0].review_draft?.items ?? receipts[0].extracted.items.map(normalizeReceiptRow), receipts[0].attempts),db),
              catalog,
            )
          : null,
      });
    }),
  );
  const lookupInput = z.object({code:z.string().regex(/^\d{3,20}$/),kind:z.enum(['gtin','retailer']).default('gtin'),retailer_scope:z.string().max(120).default(''),provider:z.enum(['open_food_facts','open_products_facts']).default('open_food_facts')}).strict();
  router.post('/products/lookup', rateLimit({windowMs:60000,limit:30,standardHeaders:true,legacyHeaders:false,message:{error:'shopping_lookup_rate_limited'}}), handle(async(req,res)=> {
    res.json(await lookup(lookupInput.parse(req.body)));
  }));
  router.post('/products/approve', handle(async(req,res)=> {
    const input=commercialInput.parse(req.body);
    const key=identifier(input.code,input.kind,input.retailer_scope);
    if(!key) throw Error('shopping_identifier_invalid');
    if(!req.user?.id) return res.status(401).json({error:'unauthorized'});
    try {
      const product=await unwrap(db.rpc('shopping_approve_product_identifier',{p_data:{...input,...key},p_owner:req.user.id}));
      res.json(commercialProduct(product,key));
    } catch(e) {
      if(e.code==='23505') throw Error('shopping_product_name_conflict');
      throw e;
    }
  }));
  const amount=z.string().regex(/^\d{1,5}(?:\.\d{1,3})?$/).refine(v=>Number(v)>0);
  const commercialInput=lookupInput.extend({name:z.string().trim().min(1).max(200),brand:z.string().max(200).nullable().optional(),
    package_quantity:amount.nullable().optional(),package_unit:z.enum(['unit','package','pack','g','kg','ml','l']).nullable().optional(),
    provenance:z.object({source:z.enum(['owner','open_food_facts','open_products_facts','owner_catalog']),environment:z.enum(['staging','production']).optional(),source_url:z.string().max(200).optional(),full_name:z.string().max(200).optional()}).strict().optional()}).strict();
  router.post('/products/map',handle(async(req,res)=>{
    if(!req.user?.id)return res.status(401).json({error:'unauthorized'});
    const input=commercialInput.extend({personal_item_id:id.nullable(),expected_revision:z.number().int().nonnegative(),request_key:z.string().uuid(),
      receipt_unit:z.string().max(30),planning_unit:z.string().max(30).nullable(),factor:z.string().regex(/^\d{1,5}(?:\.\d{1,6})?$/).refine(v=>Number(v)>0).nullable(),
      new_personal:z.object({name:z.string().trim().min(1).max(200),unit:z.string().trim().min(1).max(30),category_id:id}).strict().nullable().optional()}).parse(req.body);
    const key=identifier(input.code,input.kind,input.retailer_scope);if(!key)throw Error('shopping_identifier_invalid');
    if(input.factor!==null&&!unitCode(input.receipt_unit))throw Error('shopping_conversion_invalid');
    const target=input.new_personal?.unit??input.planning_unit;
    const product=await unwrap(db.rpc('shopping_commercial_command',{p_data:{...input,...key,action:'map',receipt_unit:unitCode(input.receipt_unit),planning_unit:target,planning_unit_code:unitCode(target)},p_owner:req.user.id}));
    res.json(commercialProduct(product,key));
  }));
  router.get('/personal-items/:id/products',handle(async(req,res)=>{
    const mappings=await unwrap(db.from('shopping_product_mappings').select('commercial_product_id').eq('personal_item_id',req.params.id));
    const products=[];
    for(const p_id of new Set(mappings.map(m=>m.commercial_product_id))) {
      const p=await unwrap(db.rpc('shopping_commercial_detail',{p_id}));
      if(String(p.mapping?.personal_item_id)===req.params.id)products.push(commercialProduct(p,p.identifiers[0]));
    }
    res.json(products);
  }));
  router.put('/lists/:id/receipt/draft', handle(async(req,res)=> {
    const input=z.object({attempt:z.number().int().min(1).max(5),revision:z.number().int().nonnegative(),draft:reviewSchema}).strict().parse(req.body);
    if(Buffer.byteLength(JSON.stringify(input.draft))>262144) return res.status(413).json({error:'receipt_draft_too_large'});
    res.json(await unwrap(db.rpc('shopping_save_receipt_draft',{p_list:req.params.id,p_attempt:input.attempt,p_revision:input.revision,p_draft:input.draft})));
  }));
  router.post(
    "/lists/:id/receipt/duplicates",
    handle(async (req, res) => {
      const body = require("zod")
        .z.object({ identity: receiptIdentitySchema.optional() })
        .strict()
        .parse(req.body);
      res.json(
        await unwrap(
          db.rpc("shopping_receipt_duplicates", {
            p_list: req.params.id,
            ...(body.identity ? { p_identity: body.identity } : {}),
          }),
        ),
      );
    }),
  );
  router.put(
    "/regular-products/:product",
    handle(async (req, res) => {
      const product = id.parse(req.params.product),
        values = regularSchema.parse(req.body);
      await unwrap(
        db.from("shopping_regular_products").upsert(
          {
            catalog_item_id: product,
            ...values,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "catalog_item_id" },
        ),
      );
      res.json({ ok: true });
    }),
  );
  router.delete(
    "/regular-products/:product",
    handle(async (req, res) => {
      await unwrap(
        db
          .from("shopping_regular_products")
          .delete()
          .eq("catalog_item_id", id.parse(req.params.product)),
      );
      res.json({ ok: true });
    }),
  );
  router.post(
    "/lists/:id/suggestions",
    handle(async (req, res) => {
      const { catalog_item_id, ...rest } = req.body;
      const values = regularSchema.parse(rest);
      res.json(
        await unwrap(
          db.rpc("shopping_accept_suggestion", {
            p_list: req.params.id,
            p_product: id.parse(catalog_item_id),
            p_quantity: values.quantity,
            p_unit: values.unit,
          }),
        ),
      );
    }),
  );
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 8 * 1024 * 1024,
      files: 6,
      fields: 5,
      fieldSize: 131072,
      parts: 12,
    },
  }).array("receipt", 6);
  router.post(
    "/lists/:id/receipt",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "receipt_rate_limited" },
    }),
    (req, res, next) =>
      upload(req, res, (e) =>
        e
          ? res.status(e.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
              error:
                e.code === "LIMIT_FILE_SIZE"
                  ? "receipt_photo_size"
                  : "receipt_photo_count",
            })
          : next(),
      ),
    handle(async (req, res) => {
      const { z } = require("zod");
      const values = z
        .object({
          reprocess: z.literal("true").optional(),
          reprocess_key: z.string().uuid().optional(),
          draft_revision: z.string().regex(/^\d+$/).optional(),
          review_draft: z
            .string()
            .max(131072)
            .optional()
            .transform((v) => (v ? JSON.parse(v) : undefined))
            .pipe(reviewSchema.optional()),
          expected_attempt: z
            .string()
            .regex(/^[0-5]$/)
            .optional(),
        })
        .strict()
        .refine(
          (v) =>
            !v.reprocess || (v.reprocess_key && v.expected_attempt != null),
        )
        .parse(req.body);
      const images = (req.files ?? []).map((f) => f.buffer);
      validateImages(images);
      const hashes = images.map((image) =>
        createHash("sha256").update(image).digest("hex"),
      );
      if (new Set(hashes).size !== hashes.length)
        return res.status(400).json({ error: "receipt_duplicate_photo" });
      const r = await rpc(req.params.id, "begin", {
        image_hash:
          hashes.length === 1
            ? hashes[0]
            : createHash("sha256").update(JSON.stringify(hashes)).digest("hex"),
        image_hashes: hashes,
        expected_attempt: Number(values.expected_attempt ?? 0),
        ...(values.draft_revision != null ? {draft_revision:Number(values.draft_revision)} : {}),
        ...(values.reprocess
          ? { reprocess: true, reprocess_key: values.reprocess_key }
          : {}),
        ...(values.review_draft ? { review_draft: values.review_draft } : {}),
      });
      if (r.state !== "extracting" || r.processing_replay)
        return res.status(r.state === "extracting" ? 202 : 200).json(r);
      try {
        const extracted = await extract(images);
        extracted.items=(await hydrateCommercialRows(extracted.items,db)).map(row=>({...row,mapping_snapshot:row.mapping_snapshot??null}));
        res.json(
          await rpc(req.params.id, "extracted", {
            attempt: r.attempts,
            extracted,
          }),
        );
      } catch (e) {
        await rpc(req.params.id, "failed", { attempt: r.attempts });
        throw e;
      }
    }),
  );
  router.post(
    "/lists/:id/receipt/confirm",
    handle(async (req, res) => {
      // Preserve metadata/identifiers and independently derive discounted totals.
      // Legacy clients retain their exact confirmation payload and replay meaning.
      const base = confirmationSchema.omit({items:true}).extend({items:reviewSchema.shape.items.min(1),draft_revision:z.number().int().nonnegative().optional()}).parse(req.body);
      res.json(await rpc(req.params.id, 'confirm', {...base,items:await validateMappingSnapshots(await confirmationItems(base.items),db)}));
    }),
  );
  return router;
}
module.exports = { createShoppingIntelligenceRouter, errorResponse };
