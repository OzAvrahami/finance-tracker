'use strict';

const { requireRule } = require('../shared/errors');
const { identity, record, array, boolean, compareIds } = require('../shared/contracts');

function validateBranchSelection(tree, branchIds) {
  const selected = new Set(array(branchIds).map(value => {
    const node = tree.get(value);
    requireRule(!node.is_neutral, 'shopping_neutral_not_branch');
    return node.id;
  }));
  return Object.freeze(tree.categoryIds.filter(id => selected.has(id)));
}

/** Detached raw-fact input; no query predicates/RPCs choose visibility.
 * Inactive list types can be previewed. Whether a type can be used to create a
 * new list is a separate integration policy, not a category-scope calculation.
 */
function createVisibilityEngine(tree, facts) {
  const { listTypes, links, products } = record(facts);
  const types = new Map(), branches = new Map(), catalog = new Map();
  for (const raw of array(listTypes)) {
    record(raw);
    const id = identity(raw.id);
    requireRule(!types.has(id), 'shopping_list_type_duplicate');
    types.set(id, Object.freeze({ id, is_active: boolean(raw.is_active) }));
    branches.set(id, new Set());
  }
  const type = value => {
    const id = identity(value);
    requireRule(types.has(id), 'shopping_list_type_missing');
    return types.get(id);
  };
  for (const raw of array(links)) {
    record(raw);
    const id = type(raw.list_type_id).id;
    const node = tree.get(raw.category_id);
    // Existing explicit system links are valid raw facts, not ordinary branches.
    if (!node.is_neutral) branches.get(id).add(node.id);
  }
  for (const raw of array(products)) {
    record(raw);
    const id = identity(raw.id);
    requireRule(!catalog.has(id), 'shopping_product_id_duplicate');
    const category = tree.get(raw.category_id);
    catalog.set(id, Object.freeze({ id, category_id: category.id, is_active: boolean(raw.is_active) }));
  }
  const positions = new Map(tree.categoryIds.map((id, i) => [id, i]));
  const orderedProducts = [...catalog.values()].sort((a, b) => positions.get(a.category_id) - positions.get(b.category_id) || compareIds(a.id, b.id));

  function forListType(value) {
    const selectedType = type(value), selected = branches.get(selectedType.id);
    const visible = new Set(), roots = [], rootById = new Map();
    for (const id of tree.categoryIds) {
      const node = tree.get(id);
      if (!node.effective_active || (!node.is_neutral && !selected.has(id) && !visible.has(node.parent_id))) continue;
      visible.add(id);
      if (!visible.has(node.parent_id)) { roots.push(id); rootById.set(id, id); }
      else rootById.set(id, rootById.get(node.parent_id));
    }
    const categoryIds = Object.freeze([...visible]);
    const productIds = Object.freeze(orderedProducts.filter(p => p.is_active && visible.has(p.category_id)).map(p => p.id));
    return Object.freeze({
      list_type_id: selectedType.id, list_type_active: selectedType.is_active,
      branch_ids: Object.freeze(tree.categoryIds.filter(id => selected.has(id))),
      root_ids: Object.freeze(roots), category_ids: categoryIds, product_ids: productIds,
      categoryPath: value => {
        const id = tree.get(value).id;
        requireRule(visible.has(id), 'shopping_category_unavailable');
        const full = tree.path(id), root = rootById.get(id);
        const start = full.findIndex(node => node.id === root);
        return Object.freeze({ visible_root_id: root, path: full,
          relative_path: Object.freeze(full.slice(start)),
          display_path: id === root ? full : Object.freeze(full.slice(start + 1)) });
      },
    });
  }
  return Object.freeze({ forListType });
}

module.exports = { createVisibilityEngine, validateBranchSelection };
