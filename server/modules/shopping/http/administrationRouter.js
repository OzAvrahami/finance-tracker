'use strict';
const express = require('express');
const { createRequireAuth } = require('../../../middleware/requireUser');
const { createRepository } = require('../shared/repository');
const { createPersistence } = require('../shared/persistence');
const { createCatalogCommands, publicIntent } = require('../shared/catalogCommands');
const { catalogHttpResponse } = require('../shared/catalogResponse');
const { httpError } = require('../shared/persistenceErrors');
const { requireRule } = require('../shared/errors');
const { identity } = require('../shared/contracts');
const { administrationView } = require('./administrationReads');
const { bulkIds } = require('../catalog/catalogService');

// Not registered in server/index.js. Only the verified isolated launcher mounts
// this router. A client preview flag cannot enable it, even in a production build.
function createAdministrationRouter({ supabase, isolation, adminIds, historicalCategoryIds = [], environment = process.env }) {
  requireRule(environment.NODE_ENV !== 'production' && isolation?.identity?.startsWith('shopping102-')
    && new URL(isolation.endpoint).hostname === '127.0.0.1' && typeof isolation.assert === 'function', 'shopping_forbidden');
  isolation.assert();
  const admins = new Set(adminIds);
  requireRule(admins.size > 0, 'shopping_authorizer_required');
  const repository = createRepository(supabase), authorize = async ({ actor }) => admins.has(actor);
  const commands = createCatalogCommands({ repository, persistence: createPersistence(supabase), authorize });
  const router = express.Router();
  router.use((req, res, next) => {
    if (environment.NODE_ENV === 'production') return res.status(404).end();
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return res.status(403).end();
    const host = req.headers.host || '';
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
      || (req.headers.origin && req.headers.origin !== `http://${host}`)) return res.status(403).end();
    res.set('Cache-Control', 'no-store');res.set('X-Shopping-Isolated', isolation.identity);next();
  });
  router.use(createRequireAuth(supabase, { codes: true }));
  router.use((req, res, next) => admins.has(req.user.id) ? next() : res.status(403).json({ error: 'shopping_forbidden', code: 'shopping_forbidden' }));
  router.use(express.json({ limit: '64kb' }));
  const handle = fn => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
  const ids = value => { requireRule(typeof value === 'string' && value.length <= 2400, 'shopping_input_invalid'); return value === '' ? [] : value.split(',').map(v => identity(v, { signed: true })); };
  function query(req, allowed) {
    requireRule(Object.keys(req.query).every(k => allowed.includes(k)) && Object.values(req.query).every(v => typeof v === 'string'), 'shopping_input_invalid');
    for (const k of ['include_inactive', 'descendants', 'uncategorized']) if (req.query[k] !== undefined) requireRule(['true', 'false'].includes(req.query[k]), 'shopping_input_invalid');
    if (req.query.activity) requireRule(['active', 'inactive', 'all'].includes(req.query.activity), 'shopping_input_invalid');
  }
  async function read(req, res, operation = 'catalog.read', id = null, productIds = []) {
    const snap = await repository.readCatalog({ actor: req.user.id, operation, id, productIds });
    res.set('ETag', snap.etag);res.set('X-Shopping-Catalog-Revision', snap.expected.catalog_revision);
    return { snap, view: administrationView(snap, historicalCategoryIds) };
  }
  const cats = '/settings/shopping/catalog-categories', prods = '/settings/shopping/catalog-items', types = '/settings/shopping/list-types';
  router.get(['/shopping/category-tree', cats], handle(async (req, res) => {
    query(req, ['include_inactive', 'operation']);
    const op = req.query.operation || 'catalog.read';requireRule(['catalog.read', 'category.create'].includes(op), 'shopping_operation_invalid');
    const { view } = await read(req, res, op);
    res.json(view.categories.filter(c => req.query.include_inactive === 'true' || c.effective_active));
  }));
  router.get(`${cats}/:id`, handle(async (req, res) => {
    query(req, ['operation']);const op = req.query.operation || 'category.edit';requireRule(['category.edit', 'category.change'].includes(op), 'shopping_operation_invalid');
    const { view } = await read(req, res, op, req.params.id);res.json(view.category(req.params.id));
  }));
  router.get(`${prods}/duplicate-candidates`, handle(async (req, res) => { query(req, []); const { view } = await read(req, res);res.json(view.duplicates); }));
  router.get(prods, handle(async (req, res) => {
    query(req, ['search','category_id','descendants','uncategorized','activity','list_type_id','operation','id','product_ids']);
    const op = req.query.operation || 'catalog.read';requireRule(['catalog.read','product.create','product.edit','product.deactivate','product.bulk-category'].includes(op), 'shopping_operation_invalid');
    const target = ['product.edit','product.deactivate'].includes(op) ? identity(req.query.id) : null;
    requireRule(target !== null || req.query.id === undefined, 'shopping_input_invalid');
    const selection = op === 'product.bulk-category' ? bulkIds(ids(req.query.product_ids)) : [];
    requireRule(op === 'product.bulk-category' || req.query.product_ids === undefined, 'shopping_input_invalid');
    requireRule(op !== 'product.bulk-category' || (selection.length > 0 && selection.length <= 100 && new Set(selection).size === selection.length), 'shopping_bulk_size_invalid');
    const { view } = await read(req, res, op, target, selection);
    if (target) view.product(target);
    res.json(view.filteredProducts(req.query));
  }));
  router.get(types, handle(async (req, res) => { query(req, []); const { view } = await read(req, res);res.json(view.listTypes); }));
  router.get(`${types}/:id/categories`, handle(async (req, res) => {
    query(req, []);const { view, snap } = await read(req, res, 'branches.replace', req.params.id);
    view.visibility(req.params.id);const linked = new Set(snap.links.filter(l => String(l.list_type_id) === req.params.id).map(l => String(l.category_id)));
    res.json(view.categories.map(c => ({ ...c, linked: linked.has(c.id) })));
  }));
  router.get(`${types}/:id/visibility`, handle(async (req, res) => {
    query(req, ['categoryIds']);const { view } = await read(req, res);res.json(view.visibility(req.params.id, req.query.categoryIds === undefined ? undefined : ids(req.query.categoryIds)));
  }));
  const mutation = (op, withId = false, fixedBody) => handle(async (req, res) => {
    query(req, []);
    if (fixedBody) { requireRule(!req.body || Object.keys(req.body).length === 0, 'shopping_input_invalid');req.body = fixedBody; }
    const id = withId ? req.params.id : null;
    const intent = publicIntent(op, id, req.body);
    const response = catalogHttpResponse(await commands.execute(req, op, id), intent);
    res.status(response.status).set(response.headers).json(response.body);
  });
  router.post(cats, mutation('category.create'));
  router.put(`${cats}/:id`, mutation('category.edit', true));
  router.delete(`${cats}/:id`, mutation('category.change', true, { type: 'delete' }));
  router.post(prods, mutation('product.create'));
  router.post(`${prods}/bulk-category`, mutation('product.bulk-category'));
  router.put(`${prods}/:id`, mutation('product.edit', true));
  router.delete(`${prods}/:id`, mutation('product.deactivate', true, {}));
  router.put(`${types}/:id/categories`, mutation('branches.replace', true));
  router.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
    const failure = error.type === 'entity.parse.failed' ? { status: 400, body: { error:'shopping_input_invalid',code:'shopping_input_invalid' } }
      : error.type === 'entity.too.large' ? { status: 413, body: { error:'shopping_input_invalid',code:'shopping_input_invalid' } } : httpError(error);
    res.status(failure.status).json(failure.body);
  });
  return router;
}
module.exports = { createAdministrationRouter };
