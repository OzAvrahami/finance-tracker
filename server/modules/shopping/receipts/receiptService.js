'use strict';
const { isDeepStrictEqual } = require('node:util');
const { z } = require('zod');
const { requireRule, ShoppingDomainError } = require('../shared/errors');
const { catalogView } = require('../shared/repository');
const { factsReader } = require('../shared/factsReader');
const { openList, listProjection } = require('../lists/listService');
const { planCommercial } = require('../catalog/commercialService');
const { prepareConfirmation } = require('../../../services/shoppingReceiptConfirmation');
const { confirmationSchema } = require('../../../services/shoppingHabitsService');
const { reviewSchema, confirmationItems } = require('../../../services/shoppingReceiptReview');

const confirmSchema = confirmationSchema.omit({ items: true }).extend({ items: reviewSchema.shape.items.min(1),
  draft_revision: z.number().int().nonnegative().optional(), context_token: z.string().length(32),
  merchant_acknowledgment: z.string().max(4000).optional(), identity_conflict_reviewed: z.boolean().optional() });

async function planReceipt(facts, intent, actor, context) {
  const action = intent.operation.slice('receipt.'.length), body = intent.body;
  const projection = listProjection(facts, intent.id);
  if (action === 'confirm') {
    const base = confirmSchema.parse(body), receipt = facts.receipts[0];
    if (receipt?.state === 'confirmed') {
      requireRule(isDeepStrictEqual(receipt.confirmation_request, base), 'receipt_confirmation_conflict');
      return { action, data: { ...base, _request: base, _projection: projection } };
    }
    openList(facts, intent.id);
    let prepared;
    try { prepared = await prepareConfirmation({ ...base, items: await confirmationItems(base.items) }, context, factsReader(facts), actor); }
    catch (error) { if (/^(receipt_|shopping_mapping_)[a-z_]+$/.test(error.message)) throw new ShoppingDomainError(error.message);throw error; }
    const view = catalogView(facts), scope = view.visibility.forListType(facts.lists[0].list_type_id);
    const effects = new Map();
    prepared.items = prepared.items.map(row => {
      if (row.catalog_item_id !== null) requireRule(scope.product_ids.includes(String(row.catalog_item_id)) ||
        facts.items.some(i => String(i.catalog_item_id) === String(row.catalog_item_id)), 'receipt_product_invalid');
      if (!row._mapping) return row;
      const { action: ignored, ...mapping } = row._mapping; // fixed internal action, not client effect data
      const key = JSON.stringify(mapping);
      if (!effects.has(key)) effects.set(key, planCommercial(facts, 'map', mapping, actor));
      const { _mapping, ...value } = row;
      return { ...value, _commercial_effect: effects.get(key) };
    });
    return { action, data: { ...prepared, _request: base, _projection: projection } };
  }
  if (action === 'move') {
    requireRule(body.context_token === context.token, 'receipt_stale');
    requireRule(facts.target, 'shopping_list_missing');
    openList(facts.target, body.target_list_id);
    return { action, data: { ...body, _projection: projection, _target_projection: listProjection(facts.target, body.target_list_id) } };
  }
  if (action === 'draft') {
    const input = z.object({ attempt: z.number().int().min(1).max(5), revision: z.number().int().nonnegative(), draft: reviewSchema }).strict().parse(body);
    return { action, data: input };
  }
  requireRule(['begin', 'progress', 'extracted', 'failed'].includes(action), 'receipt_action_invalid');
  // These are internal extraction callbacks, never an HTTP arbitrary-effect API.
  return { action, data: { ...body, _projection: projection } };
}
module.exports = { planReceipt, confirmSchema };
