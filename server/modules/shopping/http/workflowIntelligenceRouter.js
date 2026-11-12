'use strict';
const express = require('express');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const { createHash } = require('node:crypto');
const { z } = require('zod');
const { requireRule } = require('../shared/errors');
const { identity } = require('../shared/contracts');
const { catalogView } = require('../shared/repository');
const { factsReader } = require('../shared/factsReader');
const { detail } = require('../catalog/commercialService');
const { createWorkflowLookup } = require('../intelligence/lookupService');
const { receiptLimits } = require('../../../services/shoppingReceiptLimits');
const { validateFiles } = require('../../../services/shoppingReceiptSources');
const { receiptStorage } = require('../../../services/shoppingReceiptUpload');
const { extractReceipt } = require('../../../services/shoppingReceiptExtractor');
const { commercialProduct, hydrateCommercialRows } = require('../../../services/shoppingCommercialProducts');
const { reviewSchema, reviewProjection } = require('../../../services/shoppingReceiptReview');
const { normalizeReceiptRow } = require('../../../services/shoppingReceiptOverlap');
const { id, receiptIdentitySchema, suggestions, reconcile } = require('../../../services/shoppingHabitsService');
const { enrichKnownProducts } = require('../../../services/shoppingProductLookup');
const { merchantKey } = require('../../../../shared/shoppingMerchant.mjs');

function createWorkflowIntelligenceRouter({ commands, supabase, authorize, extract = extractReceipt, lookupOptions = {} }) {
  const router = express.Router(), limits = receiptLimits(), lookup = createWorkflowLookup(commands, lookupOptions);
  const handle = fn => async (req, res, next) => { try { if (req.params.id) identity(req.params.id);await fn(req, res); } catch (e) { next(e); } };
  const respond = (res, result) => res.status(result.http.status).set(result.http.headers).json(result.result);
  const lookupInput = z.object({ code: z.string().regex(/^\d{3,20}$/), kind: z.enum(['gtin', 'retailer']).default('gtin'),
    retailer_scope: z.string().max(120).default(''), provider: z.enum(['open_food_facts', 'open_products_facts']).default('open_food_facts') }).strict();
  const commercialInput = lookupInput.extend({ name: z.string().trim().min(1).max(200), brand: z.string().max(200).nullable().optional(),
    package_quantity: z.string().regex(/^\d{1,5}(?:\.\d{1,3})?$/).nullable().optional(),
    package_unit: z.enum(['unit', 'package', 'pack', 'g', 'kg', 'ml', 'l']).nullable().optional(),
    provenance: z.object({ source: z.enum(['owner', 'open_food_facts', 'open_products_facts', 'owner_catalog']), environment: z.enum(['staging', 'production']).optional(),
      source_url: z.string().max(200).optional(), full_name: z.string().max(200).optional() }).strict().optional() }).strict();

  router.get('/lists/:id/intelligence', handle(async (req, res) => {
    const facts = await commands.read(req, 'receipt.read', req.params.id), view = catalogView(facts);
    requireRule(facts.lists.length === 1, 'shopping_list_missing');
    const scope = view.visibility.forListType(facts.lists[0].list_type_id), catalog = facts.products.filter(p => scope.product_ids.includes(String(p.id)));
    const context = await commands.context(req, facts, req.params.id), receipt = facts.receipts[0] ?? null, plan = facts.plans[0]?.items ?? null;
    const duplicates = await supabase.rpc('shopping_receipt_duplicates', { p_list: req.params.id });if (duplicates.error) throw duplicates.error;
    let rows = null;
    if (receipt?.extracted) rows = receipt.state === 'confirmed' ? receipt.confirmed.items
      : await enrichKnownProducts(await reviewProjection(receipt.review_draft?.items ?? receipt.extracted.items.map(normalizeReceiptRow), receipt.attempts), factsReader(facts));
    let etag = facts.etag;
    if (req.query.operation !== undefined) {
      requireRule(['regular.set', 'regular.remove', 'commercial.approve'].includes(req.query.operation), 'shopping_operation_invalid');
      const scoped = await commands.read(req, req.query.operation, req.query.operation.startsWith('regular.') ? identity(req.query.product_id) : null);
      etag = scoped.etag;
    }
    res.set('ETag', etag).json({ _mutation_tokens: facts.read_tokens, context_token: context.token, current_items: context.current_items, store: facts.lists[0].store ?? null, limits,
      duplicate_candidates: duplicates.data, catalog, regulars: facts.regulars, suggestions: suggestions(catalog, facts.regulars, facts.history.slice(0, 500)),
      plan, receipt, reconciliation: rows ? reconcile(plan ?? [], rows, catalog) : null });
  }));
  router.post('/products/lookup', rateLimit({ windowMs: 60000, limit: 30, standardHeaders: true, legacyHeaders: false }), handle(async (req, res) => {
    const result = await lookup(req, lookupInput.parse(req.body));
    const read = await commands.read(req, 'commercial.approve');res.set('ETag', read.etag).json({ ...result, _mutation_tokens: { 'commercial.approve': read.etag } });
  }));
  router.post('/products/approve', handle(async (req, res) => {
    const body = commercialInput.parse(req.body), result = await commands.execute(req, 'commercial.approve', null, body);
    respond(res, result);
  }));
  router.post('/products/map', handle(async (req, res) => {
    const body = commercialInput.extend({ personal_item_id: id.nullable(), expected_revision: z.number().int().nonnegative(), request_key: z.string().uuid(),
      receipt_unit: z.string().max(30), planning_unit: z.string().max(30).nullable(), factor: z.string().regex(/^\d{1,5}(?:\.\d{1,6})?$/).nullable(),
      new_personal: z.object({ name: z.string().trim().min(1).max(200), unit: z.string().trim().min(1).max(30), category_id: z.union([z.string(), z.number()]) }).strict().nullable().optional() }).parse(req.body);
    const result = await commands.execute(req, 'commercial.map', null, body);
    respond(res, result);
  }));
  router.get('/personal-items/:id/products', handle(async (req, res) => {
    const facts = await commands.read(req, 'commercial.read');
    const products = [...new Set(facts.mappings.filter(m => String(m.personal_item_id) === req.params.id).map(m => m.commercial_product_id))].map(id => detail(facts, id));
    res.set('ETag', facts.etag).json(products.filter(p => String(p.mapping?.personal_item_id) === req.params.id).map(p => commercialProduct(p, p.identifiers[0])));
  }));
  for (const [method, op] of [['put', 'regular.set'], ['delete', 'regular.remove']]) router[method]('/regular-products/:product', handle(async (req, res) => {
    respond(res, await commands.execute(req, op, identity(req.params.product)));
  }));
  router.put('/lists/:id/receipt/draft', handle(async (req, res) => respond(res, await commands.execute(req, 'receipt.draft', req.params.id))));
  router.post('/lists/:id/receipt/confirm', handle(async (req, res) => respond(res, await commands.execute(req, 'receipt.confirm', req.params.id))));
  router.post('/lists/:id/receipt/move', handle(async (req, res) => {
    const body = z.object({ target_list_id: id, context_token: z.string().length(32) }).strict().parse(req.body);
    respond(res, await commands.execute(req, 'receipt.move', req.params.id, body));
  }));
  router.get('/lists/:id/receipt/progress', handle(async (req, res) => {
    const f = await commands.read(req, 'receipt.read', req.params.id), r = f.receipts[0];
    res.json(r ? { state: r.state, progress: r.progress, attempts: r.attempts, error_code: r.error_code } : { state: 'idle' });
  }));
  router.post('/lists/:id/receipt/duplicates', handle(async (req, res) => {
    const body = z.object({ identity: receiptIdentitySchema.optional() }).strict().parse(req.body);
    await commands.read(req, 'receipt.read', req.params.id);
    const { data, error } = await supabase.rpc('shopping_receipt_duplicates', { p_list: req.params.id, ...(body.identity ? { p_identity: body.identity } : {}) });
    if (error) throw error;res.json(data);
  }));
  const upload = multer({ storage: receiptStorage(limits.totalBytes), limits: { fileSize: limits.fileBytes, files: limits.files, fields: 5, fieldSize: 2097152, parts: limits.files + 5 } }).array('receipt', limits.files);
  router.post('/lists/:id/receipt', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }),
    async (req, res, next) => {
      try { requireRule(await authorize({ actor: req.user.id, operation: 'receipt.begin', listId: req.params.id }) === true, 'shopping_forbidden'); }
      catch (e) { return next(e); }
      upload(req, res, e => e ? res.status(e.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: e.code === 'LIMIT_FILE_SIZE' ? 'receipt_photo_size' : 'receipt_photo_count' }) : next());
    }, handle(async (req, res) => {
      const values = z.object({ reprocess: z.literal('true').optional(), reprocess_key: z.string().uuid().optional(), draft_revision: z.string().regex(/^\d+$/).optional(),
        review_draft: z.string().max(2097152).optional().transform(v => v ? JSON.parse(v) : undefined).pipe(reviewSchema.optional()), expected_attempt: z.string().regex(/^[0-5]$/).optional() })
        .strict().refine(v => !v.reprocess || (v.reprocess_key && v.expected_attempt != null)).parse(req.body);
      const images = (req.files ?? []).map(f => f.buffer);validateFiles(images, limits);
      const hashes = images.map(image => createHash('sha256').update(image).digest('hex'));
      requireRule(new Set(hashes).size === hashes.length, 'receipt_duplicate_photo');
      // Worker callbacks use body attempt/lease contracts, not the upload's key.
      const worker = { user: req.user, headers: {} };
      const begin = await commands.execute(worker, 'receipt.begin', req.params.id, { duration_ms: limits.durationMs,
        image_hash: hashes.length === 1 ? hashes[0] : createHash('sha256').update(JSON.stringify(hashes)).digest('hex'), image_hashes: hashes,
        expected_attempt: Number(values.expected_attempt ?? 0), ...(values.draft_revision != null ? { draft_revision: Number(values.draft_revision) } : {}),
        ...(values.reprocess ? { reprocess: true, reprocess_key: values.reprocess_key } : {}), ...(values.review_draft ? { review_draft: values.review_draft } : {}) });
      const r = begin.result;
      if (r.state !== 'extracting' || r.processing_replay) return res.status(r.state === 'extracting' ? 202 : 200).json(r);
      try {
        const extracted = await extract(images, { onProgress: progress => commands.execute(worker, 'receipt.progress', req.params.id, { attempt: r.attempts, progress }) });
        extracted.items = extracted.items.map(row => ({ ...row, ...(row.product_code && row.product_code.length < 8 && merchantKey(extracted.identity?.merchant) ? { identifier_kind: 'retailer', retailer_scope: merchantKey(extracted.identity.merchant) } : {}) }));
        const facts = await commands.read(req, 'receipt.read', req.params.id);
        extracted.items = (await hydrateCommercialRows(extracted.items, factsReader(facts))).map(row => ({ ...row, mapping_snapshot: row.mapping_snapshot ?? null }));
        respond(res, await commands.execute(worker, 'receipt.extracted', req.params.id, { attempt: r.attempts, extracted }));
      } catch (e) {
        await commands.execute(worker, 'receipt.failed', req.params.id, { attempt: r.attempts });throw e;
      }
    }));
  router.post('/lists/:id/checkout', handle(async (req, res) => respond(res, await commands.execute(req, 'checkout', req.params.id))));
  return router;
}
module.exports = { createWorkflowIntelligenceRouter };
