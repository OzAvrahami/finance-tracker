'use strict';
const { catalogView } = require('../shared/repository');
const { identity, compareIds } = require('../shared/contracts');
const { requireRule } = require('../shared/errors');
const { list } = require('./listService');

function legacyReads(facts) {
  const view = catalogView(facts);
  const categories = new Map(facts.categories.map(c => [String(c.id), c]));
  const products = new Map(facts.products.map(p => [String(p.id), p]));
  const scopeFor = value => value === undefined ? null : view.visibility.forListType(identity(value));
  function item(row, scope) {
    const c = categories.get(String(row.category_id)), p = products.get(String(row.catalog_item_id));
    return { ...row, _mutation_tokens: facts.read_tokens?.[row.list_id] ?? {}, shopping_catalog_items: p ? { name: p.name, default_unit: p.default_unit, default_price: p.default_price } : null,
      shopping_catalog_categories: c ? { ...c, path: view.tree.path(c.id) } : null,
      category_unavailable: scope ? !scope.category_ids.includes(String(row.category_id)) : !view.tree.get(row.category_id).effective_active };
  }
  return {
    categories(type) {
      const scope = scopeFor(type);
      return view.tree.categories().filter(c => c.effective_active && (!scope || scope.category_ids.includes(c.id)))
        .map(c => ({ ...categories.get(c.id), path: view.tree.path(c.id), ...(scope ? scope.categoryPath(c.id) : {}) }));
    },
    products(query = {}) {
      const scope = scopeFor(query.list_type_id), name = String(query.search ?? '').slice(0, 300).toLowerCase();
      let rows = view.products().filter(p => (!scope || scope.product_ids.includes(p.id)) && (!query.category_id || p.category_id === identity(query.category_id, { signed: true })) && p.name.toLowerCase().includes(name))
        .map(p => ({ ...p, shopping_catalog_categories: categories.get(p.category_id), path: view.tree.path(p.category_id) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'he') || compareIds(a.id, b.id));
      // Keep established suggestion pagination; visibility totals use the full engine.
      if (query.limit !== undefined || query.list_type_id) rows = rows.slice(0, Math.min(20, Math.max(1, Number.parseInt(query.limit, 10) || 8)));
      return rows;
    },
    lists(status) {
      requireRule(status === undefined || ['draft', 'active', 'checked_out', 'archived'].includes(status), 'shopping_input_invalid');
      return facts.lists.filter(l => !status || l.status === status).map(l => ({ ...l, _mutation_tokens: facts.read_tokens?.[l.id] ?? {},
        shopping_list_types: { name: facts.listTypes.find(t => String(t.id) === String(l.list_type_id))?.name },
        item_count: facts.items.filter(i => String(i.list_id) === String(l.id)).length,
        purchased_count: facts.items.filter(i => String(i.list_id) === String(l.id) && i.is_purchased).length,
      })).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    },
    detail(id) {
      const row = list(facts, id), scope = scopeFor(String(row.list_type_id));
      return { ...row, _mutation_tokens: facts.read_tokens?.[row.id] ?? {}, shopping_confirmed_purchases: facts.confirmed[0] ? { items: facts.confirmed[0].items, basis: facts.confirmed[0].basis, purchase_date: facts.confirmed[0].purchase_date } : null,
        shopping_list_items: facts.items.filter(i => String(i.list_id) === String(row.id)).map(i => item(i, scope)) };
    },
  };
}
module.exports = { legacyReads };
