'use strict';
const { catalogView } = require('../shared/repository');
const { identity } = require('../shared/contracts');
const { requireRule } = require('../shared/errors');
const { createVisibilityEngine, validateBranchSelection } = require('../list-types/listTypeService');

function administrationView(snapshot, historicalIds = []) {
  const view = catalogView(snapshot), tree = view.tree, history = new Set(historicalIds.map(String));
  const categories = tree.categories({ includeInactive: true }).map(c => {
    const raw = snapshot.categories.find(r => String(r.id) === c.id);
    const direct = snapshot.products.filter(p => String(p.category_id) === c.id);
    const subtree = snapshot.products.filter(p => tree.isDescendant(p.category_id, c.id, { includeSelf: true }));
    const counts = { direct_active: direct.filter(p => p.is_active).length, direct_total: direct.length,
      subtree_active: subtree.filter(p => p.is_active).length, subtree_total: subtree.length };
    return { ...raw, ...c, historical: history.has(c.id), path: tree.path(c.id), counts,
      ancestor_ids: tree.ancestorIds(c.id), child_ids: tree.childrenIds(c.id), descendant_ids: tree.descendantIds(c.id),
      direct_count: counts.direct_active, subtree_count: counts.subtree_active };
  });
  const products = view.products({ includeInactive: true }).map(p => ({ ...p, id: String(p.id), category_id: String(p.category_id), path: tree.path(p.category_id) }));
  const groups = new Map();
  for (const p of products) {
    const key = p.name.normalize('NFKC').trim().toLocaleLowerCase('he');
    groups.set(key, [...(groups.get(key) || []), p.id]);
  }
  return { categories, products, listTypes: snapshot.listTypes.map(t => ({ ...t, id: String(t.id) })),
    duplicates: [...groups.values()].filter(ids => ids.length > 1),
    visibility(id, branchIds) {
      const target = identity(id);
      if (branchIds === undefined) return view.visibility.forListType(target);
      const branches = validateBranchSelection(tree, branchIds);
      return createVisibilityEngine(tree, { ...snapshot, links: [...snapshot.links.filter(l => String(l.list_type_id) !== target),
        ...branches.map(category_id => ({ category_id, list_type_id: target }))] }).forListType(target);
    },
    filteredProducts(query) {
      let rows = products;
      if (query.category_id !== undefined) {
        const category = tree.get(query.category_id);
        rows = rows.filter(p => query.descendants === 'true' ? tree.isDescendant(p.category_id, category.id, { includeSelf: true }) : p.category_id === category.id);
      }
      if (query.uncategorized === 'true') rows = rows.filter(p => p.category_id === tree.neutralId);
      if (query.list_type_id !== undefined) { const visible = new Set(view.visibility.forListType(query.list_type_id).product_ids); rows = rows.filter(p => visible.has(p.id)); }
      if (query.activity && query.activity !== 'all') rows = rows.filter(p => p.is_active === (query.activity === 'active'));
      if (query.search) rows = rows.filter(p => p.name.toLocaleLowerCase('he').includes(query.search.toLocaleLowerCase('he')));
      return rows;
    },
    category(id) { const found = categories.find(c => c.id === identity(id, { signed: true })); requireRule(found, 'shopping_category_missing'); return found; },
    product(id) { return view.product(id); },
  };
}
module.exports = { administrationView };
