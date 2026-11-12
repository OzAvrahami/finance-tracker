'use strict';
const express = require('express');
const { createRequireAuth } = require('../../../middleware/requireUser');
const { createListCommands, operations } = require('../lists/listCommands');
const { legacyReads } = require('../lists/listReads');
const { requireRule } = require('../shared/errors');
const { httpError } = require('../shared/persistenceErrors');
const { createWorkflowCommands } = require('../shared/workflowCommands');
const { createWorkflowIntelligenceRouter } = require('./workflowIntelligenceRouter');

// Deliberately not registered in server/index.js or the deployed legacy router.
// The caller must prove disposable isolation before constructing this composition.
function createWorkflowRouter({ supabase, authorize, isolation, environment = process.env, extract, lookupOptions, settingsOnly = false }) {
  requireRule(environment.NODE_ENV !== 'production' && isolation?.identity?.startsWith('shopping102-') &&
    new URL(isolation.endpoint).hostname === '127.0.0.1' && typeof isolation.assert === 'function', 'shopping_forbidden');
  isolation.assert();
  const commands = createListCommands({ supabase, authorize }), router = express.Router();
  const workflows = createWorkflowCommands({ supabase, authorize });
  router.use((req, res, next) => {
    const host = req.headers.host || '';
    if (environment.NODE_ENV === 'production') return res.status(404).end();
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) ||
      !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) || (req.headers.origin && req.headers.origin !== `http://${host}`)) return res.status(403).end();
    res.set('Cache-Control', 'no-store');res.set('X-Shopping-Isolated', isolation.identity);next();
  });
  router.use(createRequireAuth(supabase, { codes: true }));
  const ordinaryJson = express.json({ limit: '64kb' }), receiptJson = express.json({ limit: '2mb' });
  router.use((req, res, next) => /\/receipt\/(draft|confirm)$/.test(req.path) ? receiptJson(req, res, next) : ordinaryJson(req, res, next));
  const handle = fn => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
  async function read(req, res, id = null) {
    const operation = req.query.operation || 'list.read';
    requireRule(operations.has(operation) || (id !== null && operation === 'checkout'), 'shopping_operation_invalid');
    const facts = operation === 'checkout' ? await workflows.read(req, operation, id) : await commands.read(req, operation, id, req.query.item_id ?? null);
    res.set('ETag', facts.etag);
    return { facts, view: legacyReads(facts) };
  }
  if (settingsOnly) {
    router.get('/list-types', handle(async (req,res) => {
      const facts=await workflows.read(req,req.query.operation||'type.read',req.query.id??null);
      res.set('ETag',facts.etag).set('X-Shopping-Catalog-Revision',facts.catalog_revision).json(facts.listTypes.map(t=>({...t,
        _mutation_tokens:{'type.edit':facts.read_tokens?.['type.edit:'+t.id],'type.deactivate':facts.read_tokens?.['type.deactivate:'+t.id]}})));
    }));
    for(const [method,op,path] of [['post','type.create','/list-types'],['put','type.edit','/list-types/:id'],['delete','type.deactivate','/list-types/:id']])router[method](path,handle(async(req,res)=>{const r=await workflows.execute(req,op,req.params.id??null,req.body??{});res.status(r.http.status).set(r.http.headers).json(r.result);}));
  } else {
  router.post('/catalog-categories',handle(async(req,res)=>{const r=await workflows.execute(req,'entry.category',null);res.status(r.http.status).set(r.http.headers).json(r.result);}));
  router.get('/list-types', handle(async (req, res) => {
    const { facts } = await read(req, res);res.json(facts.listTypes.filter(t => t.is_active));
  }));
  router.get('/catalog-categories', handle(async (req, res) => {
    const { view } = await read(req, res);res.json(view.categories(req.query.list_type_id));
  }));
  router.get('/catalog-items', handle(async (req, res) => {
    const { view } = await read(req, res);res.json(view.products(req.query));
  }));
  router.get('/lists', handle(async (req, res) => {
    const { view } = await read(req, res);res.json(view.lists(req.query.status));
  }));
  router.get('/lists/:id', handle(async (req, res) => {
    const { view } = await read(req, res, req.params.id);res.json(view.detail(req.params.id));
  }));
  const mutate = operation => handle(async (req, res) => {
    const result = await commands.execute(req, operation, req.params.id ?? null, req.params.itemId ?? null);
    res.status(result.http.status).set(result.http.headers).json(result.result);
  });
  router.post('/lists', mutate('list.create'));
  router.put('/lists/:id', mutate('list.edit'));
  router.delete('/lists/:id', mutate('list.delete'));
  router.post('/lists/:id/items', mutate('item.append'));
  router.put('/lists/:id/items/:itemId', mutate('item.edit'));
  router.delete('/lists/:id/items/:itemId', mutate('item.remove'));
  router.patch('/lists/:id/items/:itemId/toggle', mutate('item.toggle'));
  router.post('/lists/:id/suggestions', mutate('suggestion.accept'));
  router.use(createWorkflowIntelligenceRouter({ commands: workflows, supabase, authorize, extract, lookupOptions }));
  }
  router.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
    const failure = error.type === 'entity.too.large' ? { status: 413, body: { error: 'shopping_input_invalid', code: 'shopping_input_invalid' } }
      : error.type === 'entity.parse.failed' || error.name === 'ZodError' || error instanceof SyntaxError ? { status: 400, body: { error: 'shopping_input_invalid', code: 'shopping_input_invalid' } } : httpError(error);
    res.status(failure.status).json(failure.body);
  });
  return router;
}
module.exports = { createWorkflowRouter };
