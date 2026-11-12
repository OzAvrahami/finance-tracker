'use strict';

const { isDeepStrictEqual } = require('node:util');
const { requireRule } = require('../shared/errors');
const { identity } = require('../shared/contracts');
const { parseHeaders, authenticatedActor } = require('../shared/httpContracts');
const { repositoryError } = require('../shared/persistenceErrors');
const { frozenCopy } = require('../shared/repository');
const { planList } = require('./listService');

const operations = new Set(['list.read', 'list.create', 'list.edit', 'list.delete', 'item.append', 'item.edit', 'item.remove', 'item.toggle', 'suggestion.accept']);
const requiredRevision = new Set(['list.edit', 'list.delete', 'item.edit', 'item.remove', 'item.toggle']);
function intentFor(operation, id, itemId, body) {
  requireRule(operations.has(operation) && operation !== 'list.read', 'shopping_operation_invalid');
  requireRule(body && Object.getPrototypeOf(body) === Object.prototype && !Object.values(body).includes(undefined), 'shopping_input_invalid');
  const input = structuredClone(body);
  for (const k of ['catalog_item_id', 'category_id', 'parent_id', 'list_type_id']) {
    if (input[k] != null && input[k] !== '') input[k] = identity(input[k], { signed: ['category_id', 'parent_id'].includes(k) });
  }
  return { operation, id: operation === 'list.create' ? null : identity(id),
    item_id: operation.startsWith('item.') && operation !== 'item.append' ? identity(itemId) : null, body: input };
}
function validateResult(result) {
  requireRule(result?.committed === true && typeof result.replayed === 'boolean' && result.result &&
    [200, 201].includes(result.http?.status) && typeof result.http?.headers?.ETag === 'string' &&
    Object.keys(result.http.headers).every(k => k === 'ETag'), 'shopping_commit_result_invalid');
  return frozenCopy(result);
}
function createListCommands({ supabase, authorize }) {
  requireRule(typeof authorize === 'function' && typeof supabase?.rpc === 'function', 'shopping_authorizer_required');
  async function actorFor(request, operation, id) {
    const actor = authenticatedActor(request);
    requireRule(await authorize({ actor, operation, listId: id }) === true, 'shopping_forbidden');
    return actor;
  }
  async function snapshot(actor, operation, id, itemId, key = null) {
    const { data, error } = await supabase.rpc('shopping_state', { p_scope: 'list', p_ids: { actor, operation,
      id: id === null ? null : identity(id), item_id: itemId === null ? null : identity(itemId), request_key: key } });
    if (error) throw repositoryError(error);
    requireRule(data?.version === 1 && data.scope === 'list' && data.operation === operation && data.complete === true &&
      typeof data.etag === 'string' && typeof data.expected?.token === 'string' &&
      ['categories', 'products', 'listTypes', 'links', 'lists', 'items', 'plans', 'receipts', 'checkouts', 'confirmed'].every(k => Array.isArray(data[k])), 'shopping_snapshot_invalid');
    return frozenCopy(data);
  }
  return Object.freeze({
    async read(request, operation = 'list.read', id = null, itemId = null) {
      requireRule(operations.has(operation), 'shopping_operation_invalid');
      const actor = await actorFor(request, operation, id);
      return snapshot(actor, operation, id, itemId);
    },
    async execute(request, operation, id = null, itemId = null) {
      const actor = await actorFor(request, operation, id), headers = parseHeaders(request.headers);
      const intent = intentFor(operation, id, itemId, request.body);
      const facts = await snapshot(actor, operation, intent.id, intent.item_id, headers.key);
      if (facts.command !== null) {
        const c = facts.command;
        requireRule(c.actor === actor && c.key === headers.key, 'shopping_snapshot_invalid');
        requireRule(isDeepStrictEqual(c.intent, intent), 'shopping_key_conflict');
        requireRule(c.http !== null, 'shopping_legacy_result_unavailable');
        return validateResult({ committed: true, replayed: true, result: c.result, http: c.http });
      }
      requireRule(!requiredRevision.has(operation) || headers.ifMatch !== null, 'shopping_precondition_required');
      requireRule(operation !== 'item.toggle' || headers.key !== null, 'shopping_idempotency_required');
      if (headers.ifMatch !== null) requireRule(headers.ifMatch === facts.etag, 'shopping_revision_stale');
      const decision = planList(facts, intent);
      let response;
      try { response = await supabase.rpc('shopping_list_commit', { p_actor: actor, p_key: headers.key, p_intent: intent,
        p_expected: facts.expected, p_decision: decision }); }
      catch (error) { throw repositoryError(error, { committing: true }); }
      if (response.error) throw repositoryError(response.error, { committing: true });
      return validateResult(response.data);
    },
  });
}
module.exports = { createListCommands, intentFor, validateResult, operations };
