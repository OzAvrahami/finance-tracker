'use strict';
const { isDeepStrictEqual } = require('node:util');
const { requireRule, ShoppingDomainError } = require('./errors');
const { identity } = require('./contracts');
const { authenticatedActor, parseHeaders, uuid } = require('./httpContracts');
const { repositoryError } = require('./persistenceErrors');
const { frozenCopy, catalogView } = require('./repository');
const { validateResult } = require('../lists/listCommands');
const { planCommercial } = require('../catalog/commercialService');
const { planReceipt } = require('../receipts/receiptService');
const { listProjection, fields, openList } = require('../lists/listService');
const { regularSchema } = require('../../../services/shoppingHabitsService');

const allowed = new Set(['receipt.read', 'receipt.begin', 'receipt.progress', 'receipt.extracted', 'receipt.failed', 'receipt.draft', 'receipt.confirm', 'receipt.move',
  'commercial.read', 'commercial.approve', 'commercial.map', 'regular.set', 'regular.remove', 'checkout', 'lookup.read', 'lookup.claim', 'lookup.finalize', 'type.read', 'type.create', 'type.edit', 'type.deactivate', 'entry.category']);
function translate(error, committing = false) {
  if (error?.code === 'P0001' && /^(receipt_|checkout_|shopping_mapping_|shopping_legacy_result_)[a-z_]+$/.test(error.message)) return new ShoppingDomainError(error.message);
  return repositoryError(error, { committing });
}
function createWorkflowCommands({ supabase, authorize }) {
  requireRule(typeof authorize === 'function', 'shopping_authorizer_required');
  async function read(request, operation, id = null, targetId = null, key = null) {
    requireRule(allowed.has(operation), 'shopping_operation_invalid');
    const actor = authenticatedActor(request);
    requireRule(await authorize({ actor, operation, listId: id, targetListId: targetId }) === true, 'shopping_forbidden');
    const { data, error } = await supabase.rpc('shopping_state', { p_scope: operation.split('.')[0], p_ids: { actor, operation, id, target_id: targetId, request_key: key } });
    if (error) throw translate(error);
    requireRule(data?.complete === true && data.operation === operation && typeof data.expected?.token === 'string', 'shopping_snapshot_invalid');
    return frozenCopy(data);
  }
  async function context(request, facts, id, operation = 'receipt.read', targetId = null) {
    const { data, error } = await supabase.rpc('shopping_receipt_context_for_projection', { p_list: id,
      p_projection: listProjection(facts, id), p_expected: { ...facts.expected, actor: authenticatedActor(request), operation, target_id: targetId } });
    if (error) throw translate(error);return data;
  }
  return Object.freeze({ read, context,
    async execute(request, operation, id = null, body = request.body, internalPlan = null) {
      const actor = authenticatedActor(request), headers = { ...parseHeaders(request.headers) };
      const target = operation === 'receipt.move' ? identity(body.target_list_id) : null;
      if (operation === 'commercial.map') {
        const bodyKey = uuid(body.request_key);
        requireRule(headers.key === null || headers.key === bodyKey, 'shopping_key_conflict');
        headers.key = bodyKey;
      }
      const facts = await read(request, operation, id, target, headers.key);
      const intent = { operation, id, body: structuredClone(body) };
      if (facts.command) {
        requireRule(facts.command.actor === actor && facts.command.key === headers.key, 'shopping_snapshot_invalid');
        requireRule(isDeepStrictEqual(facts.command.intent, intent), 'shopping_key_conflict');
        requireRule(facts.command.http, 'shopping_legacy_result_unavailable');
        return validateResult({ committed: true, replayed: true, result: facts.command.result, http: facts.command.http });
      }
      const naturalCheckout = operation === 'checkout' && facts.checkouts.length > 0;
      const naturalReceipt = operation === 'receipt.confirm' && facts.receipts[0]?.state === 'confirmed';
      requireRule(!['commercial.approve', 'regular.set', 'regular.remove', 'type.edit', 'type.deactivate', 'checkout'].includes(operation) || naturalCheckout || headers.ifMatch !== null, 'shopping_precondition_required');
      if (headers.ifMatch !== null && !naturalCheckout && !naturalReceipt) requireRule(headers.ifMatch === facts.etag, 'shopping_revision_stale');
      let decision, rpc;
      if (operation.startsWith('type.') || operation === 'entry.category') {
        decision = require('../list-types/typeCommands').planType(facts, intent);rpc = 'shopping_catalog_commit';
      } else if (operation.startsWith('commercial.')) {
        decision = planCommercial(facts, operation.slice(11), body, actor);rpc = 'shopping_commercial_commit';
      } else if (operation.startsWith('receipt.')) {
        decision = await planReceipt(facts, intent, actor, ['receipt.confirm', 'receipt.move'].includes(operation) ? await context(request, facts, id, operation, target) : null);
        rpc = 'shopping_receipt_commit';
      } else if (operation.startsWith('regular.')) {
        const view = catalogView(facts), product = view.product(id);
        requireRule(product.is_active && view.tree.get(product.category_id).effective_active, 'shopping_product_invalid');
        if (operation === 'regular.remove') fields(body, []);
        decision = { kind: operation, values: operation === 'regular.set' ? regularSchema.parse(body) : {} };rpc = 'shopping_list_commit';
      } else if (operation === 'checkout') {
        fields(body, ['category_id', 'payment_source_id', 'duplicate_reviewed_ids']);
        if (!naturalCheckout) openList(facts, id);
        decision = { projection: listProjection(facts, id) };rpc = 'shopping_checkout_commit';
      } else {
        requireRule(typeof internalPlan === 'function', 'shopping_operation_invalid');
        decision = internalPlan(facts, intent);rpc = 'shopping_lookup_commit';
      }
      let response;
      try { response = await supabase.rpc(rpc, { p_actor: actor, p_key: headers.key, p_intent: intent, p_expected: facts.expected, p_decision: decision }); }
      catch (e) { throw translate(e, true); }
      if (response.error) throw translate(response.error, true);
      return validateResult(response.data);
    },
  });
}
module.exports = { createWorkflowCommands, translate };
