// Node-only synthetic adapter. Never imported by browser components.
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { commandRoute } from '../services/catalogApi.js';
const require = createRequire(import.meta.url);
const { approvedFixture } = require('../../../../../server/modules/shopping/list-types/fixtures/approvedTaxonomy');
const { createCatalogCommands } = require('../../../../../server/modules/shopping/shared/catalogCommands');
const { catalogView } = require('../../../../../server/modules/shopping/shared/repository');
const { createVisibilityEngine, validateBranchSelection } = require('../../../../../server/modules/shopping/list-types/listTypeService');
const { ShoppingDomainError } = require('../../../../../server/modules/shopping/shared/errors');
const { httpError } = require('../../../../../server/modules/shopping/shared/persistenceErrors');

const actor = '00000000-0000-4000-8000-000000000102';
export function createCatalogPreview() {
  const fixture = approvedFixture();
  const names = ['סופר', 'סופר-פארם', 'חומרי בניה', 'לגו', 'כללי', 'בית'];
  let state = {
    categories: fixture.categories.map(c => ({ ...c, revision: '1', name: c.is_neutral ? 'ללא קטגוריה' : c.name })),
    products: fixture.products.map((p, i) => ({ ...p, id: String(p.id), name: `מוצר הדגמה ${i + 1}`, default_unit: 'יח׳', default_price: i === 0 ? '0' : null, revision: '1' })),
    listTypes: fixture.listTypes.map((t, i) => ({ ...t, id: String(t.id), name: names[i], revision: '1' })),
    links: fixture.links.map(l => ({ ...l, list_type_id: String(l.list_type_id) })),
  };
  for (let i = 0; i < 25; i++) state.categories.push({ id: String(20001 + i), name: `קטגוריה היסטורית לדוגמה ${i + 1}`, parent_id: null, is_active: false, is_neutral: false, revision: '1', historical: true });
  state.links.push(...state.listTypes.map(t => ({ list_type_id: t.id, category_id: '-99' })));
  // Same display name, separate categories/identities: a review suggestion only.
  state.products[117].name = state.products[0].name;
  let revision = 1;
  const ledger = new Map();
  const snapshot = () => ({ ...structuredClone(state), etag: `"preview-${revision}"`, expected: { catalog_revision: String(revision), token: `preview-${revision}` }, command: null });
  const commands = createCatalogCommands({
    authorize: async () => true, // Synthetic actor only; NOT a production authorizer.
    repository: { async readCatalog({ key }) { return { ...snapshot(), command: ledger.get(key) || null }; } },
    persistence: { async commitCatalog(command) {
      const { p_key: key, p_intent: intent, p_expected: expected, p_decision: decision } = command;
      const prior = ledger.get(key);
      if (prior) {
        if (!isDeepStrictEqual(prior.intent, intent)) throw new ShoppingDomainError('shopping_key_conflict');
        return { committed: true, replayed: true, result: prior.result, catalog_revision: prior.catalog_revision };
      }
      if (expected.catalog_revision !== String(revision)) throw new ShoppingDomainError('shopping_revision_stale');
      const next = structuredClone(state);
      let result = {};
      if (decision.kind.endsWith('.create')) {
        const table = decision.kind.startsWith('category') ? 'categories' : 'products';
        const id = String(Math.max(...next[table].map(r => Number(r.id))) + 1);
        next[table].push({ id, ...decision.values, revision: '1' }); result = { id };
      } else if (decision.kind === 'branches.replace') {
        next.links = next.links.filter(l => String(l.list_type_id) !== decision.id);
        next.links.push(...decision.category_ids.map(category_id => ({ list_type_id: decision.id, category_id })));
        const type = next.listTypes.find(t => t.id === decision.id); type.revision = String(Number(type.revision) + 1);
      } else {
        const table = decision.kind.startsWith('category') ? 'categories' : 'products';
        const updates = decision.updates || [decision];
        for (const update of updates) {
          const row = next[table].find(r => String(r.id) === update.id);
          Object.assign(row, update.changes, { revision: String(Number(row.revision) + 1) });
        }
        if (decision.updates) result = { updated: updates.length, product_ids: updates.map(u => u.id) };
      }
      state = next; revision++;
      const record = { actor, key, intent, result, catalog_revision: String(revision) };
      if (key) ledger.set(key, record);
      return { committed: true, replayed: false, result, catalog_revision: String(revision) };
    } },
  });
  function view() {
    const raw = snapshot(), domain = catalogView(raw), tree = domain.tree;
    const categories = tree.categories({ includeInactive: true }).map(c => ({ ...c,
      historical: raw.categories.find(r => r.id === c.id)?.historical === true,
      path: tree.path(c.id), ancestor_ids: tree.ancestorIds(c.id), child_ids: tree.childrenIds(c.id), descendant_ids: tree.descendantIds(c.id),
      direct_count: raw.products.filter(p => p.category_id === c.id && p.is_active).length,
      subtree_count: raw.products.filter(p => p.is_active && tree.isDescendant(p.category_id, c.id, { includeSelf: true })).length,
    }));
    const groups = new Map();
    for (const product of raw.products) {
      const key = product.name.normalize('NFKC').trim().toLocaleLowerCase('he');
      groups.set(key, [...(groups.get(key) || []), product.id]);
    }
    return { mode: 'preview', etag: raw.etag, categories, products: raw.products, listTypes: raw.listTypes, links: raw.links,
      visibility: Object.fromEntries(raw.listTypes.map(t => [t.id, domain.visibility.forListType(t.id)])),
      duplicateCandidates: [...groups.values()].filter(ids => ids.length > 1),
    };
  }
  return {
    view,
    async handle(method, path, body, headers = {}) {
      if (method === 'GET' && path === '/snapshot') return view();
      if (method === 'POST' && path.startsWith('/visibility-preview/')) {
        const id = path.split('/').at(-1), raw = snapshot(), tree = catalogView(raw).tree;
        const branches = validateBranchSelection(tree, body.categoryIds);
        return createVisibilityEngine(tree, { ...raw, links: [...raw.links.filter(l => l.list_type_id !== id), ...branches.map(category_id => ({ list_type_id: id, category_id }))] }).forListType(id);
      }
      for (const operation of ['category.create', 'category.change', 'product.create', 'product.edit', 'product.deactivate', 'product.bulk-category', 'branches.replace']) {
        const id = operation === 'branches.replace' ? path.split('/').at(-2) : path.split('/').at(-1);
        const [verb, route] = commandRoute(operation, id);
        if (verb === method && route === path) {
          const needsId = ['category.change', 'product.edit', 'product.deactivate', 'branches.replace'].includes(operation);
          const result = await commands.execute({ user: { id: actor }, body, headers }, operation, needsId ? id : null);
          return { ...result, mode: 'preview' };
        }
      }
      throw new ShoppingDomainError('shopping_operation_invalid');
    },
  };
}

export function shoppingPreviewPlugin() {
  return {
    name: 'shopping-synthetic-preview', apply: 'serve',
    configureServer(server) {
      const preview = createCatalogPreview();
      server.middlewares.use('/__shopping-preview/api', async (req, res) => {
        const allowed = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
        const host = req.headers.host || '';
        if (!allowed.includes(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
          || (req.headers.origin && req.headers.origin !== `http://${host}`)
          || req.headers['x-shopping-preview'] !== 'synthetic-only') { res.statusCode = 403; res.end(); return; }
        res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Shopping-Preview', 'synthetic-only');
        try {
          let raw = '';
          for await (const chunk of req) { raw += chunk; if (raw.length > 65536) throw new Error('Request too large'); }
          const data = await preview.handle(req.method, req.url.split('?')[0], raw ? JSON.parse(raw) : undefined, req.headers);
          res.end(JSON.stringify(data));
        } catch (error) {
          const response = httpError(error); res.statusCode = response.status; res.end(JSON.stringify(response.body));
        }
      });
    },
  };
}

