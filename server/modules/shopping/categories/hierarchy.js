'use strict';

const { requireRule } = require('../shared/errors');
const { identity, record, array, boolean, displayOrder, categoryName, categoryNameKey, compareIds } = require('../shared/contracts');

/** Build a detached, immutable domain snapshot from raw category facts.
 * No IO, fixed depth, name-based identity, or eagerly materialized O(n²) paths.
 * Siblings sort by order, normalized key (ordinal), then numeric ID. Neutral is
 * outside the ordinary forest and appears last in deterministic enumeration.
 */
function buildHierarchy(rows) {
  const nodes = new Map();
  const children = new Map();
  const siblings = new Map();
  let neutralId = null;
  for (const row of array(rows)) {
    record(row);
    const isNeutral = row.is_neutral === undefined ? false : boolean(row.is_neutral);
    const id = identity(row.id, { signed: isNeutral });
    requireRule(!nodes.has(id), 'shopping_category_id_duplicate');
    categoryName(row.name); // Validate without rewriting stored historical names.
    const parent = row.parent_id === null ? null : identity(row.parent_id, { signed: true });
    requireRule(parent !== id, 'shopping_category_self_parent');
    const active = boolean(row.is_active);
    if (isNeutral) {
      requireRule(neutralId === null && parent === null && active, 'shopping_neutral_invalid');
      neutralId = id;
    }
    const key = categoryNameKey(row.name);
    if (!siblings.has(parent)) siblings.set(parent, new Set());
    requireRule(!siblings.get(parent).has(key), 'shopping_category_sibling_duplicate');
    siblings.get(parent).add(key);
    nodes.set(id, { id, parent_id: parent, name: row.name, name_key: key,
      display_order: displayOrder(row.display_order), is_active: active, is_neutral: isNeutral });
    children.set(id, []);
  }
  requireRule(neutralId !== null, 'shopping_neutral_missing');
  const roots = [];
  for (const node of nodes.values()) {
    if (node.parent_id !== null) {
      requireRule(nodes.has(node.parent_id), 'shopping_category_parent_missing');
      requireRule(node.parent_id !== neutralId, 'shopping_neutral_parent');
      children.get(node.parent_id).push(node.id);
    } else if (!node.is_neutral) roots.push(node.id);
  }
  const compare = (left, right) => {
    const a = nodes.get(left), b = nodes.get(right);
    return (a.display_order < b.display_order ? -1 : a.display_order > b.display_order ? 1 : 0)
      || (a.name_key < b.name_key ? -1 : a.name_key > b.name_key ? 1 : 0)
      || compareIds(left, right);
  };
  roots.sort(compare);
  for (const ids of children.values()) ids.sort(compare);
  const ordered = [], starts = new Map(), ends = new Map();
  const stack = [];
  stack.push({ id: neutralId, exit: false });
  for (let i = roots.length - 1; i >= 0; i--) stack.push({ id: roots[i], exit: false });
  while (stack.length) {
    const { id, exit } = stack.pop();
    if (exit) { ends.set(id, ordered.length); continue; }
    const node = nodes.get(id);
    node.effective_active = node.is_active && (node.parent_id === null || nodes.get(node.parent_id).effective_active);
    Object.freeze(node);
    starts.set(id, ordered.length);
    ordered.push(id);
    stack.push({ id, exit: true });
    const ids = children.get(id);
    for (let i = ids.length - 1; i >= 0; i--) stack.push({ id: ids[i], exit: false });
  }
  // Every node has exactly one parent. Unreachable nodes therefore form or feed
  // an indirect cycle; this also catches cycles in disconnected components.
  requireRule(ordered.length === nodes.size, 'shopping_category_cycle');
  const get = value => {
    const id = identity(value, { signed: true });
    requireRule(nodes.has(id), 'shopping_category_missing');
    return nodes.get(id);
  };
  const ancestorIds = (value, { includeSelf = false, order = 'root-first' } = {}) => {
    boolean(includeSelf);
    requireRule(order === 'root-first' || order === 'node-first', 'shopping_path_order_invalid');
    const node = get(value), ids = [];
    let id = includeSelf ? node.id : node.parent_id;
    while (id !== null) { ids.push(id); id = nodes.get(id).parent_id; }
    return Object.freeze(order === 'root-first' ? ids.reverse() : ids);
  };
  const path = value => Object.freeze(ancestorIds(value, { includeSelf: true })
    .map(id => Object.freeze({ id, name: nodes.get(id).name })));
  const descendantIds = (value, { includeSelf = false } = {}) => {
    boolean(includeSelf);
    const id = get(value).id;
    return Object.freeze(ordered.slice(starts.get(id) + (includeSelf ? 0 : 1), ends.get(id)));
  };
  const isDescendant = (value, ancestor, { includeSelf = false } = {}) => {
    boolean(includeSelf);
    const id = get(value).id, parent = get(ancestor).id;
    return starts.get(id) >= starts.get(parent) + (includeSelf ? 0 : 1) && starts.get(id) < ends.get(parent);
  };
  return Object.freeze({
    neutralId, rootIds: Object.freeze(roots), categoryIds: Object.freeze(ordered),
    get, path, ancestorIds, descendantIds, isDescendant,
    childrenIds: value => Object.freeze([...children.get(get(value).id)]),
    // Default administration/new-selection inventory hides ineffective nodes.
    categories: ({ includeInactive = false } = {}) => {
      boolean(includeInactive);
      return Object.freeze(ordered.map(id => nodes.get(id)).filter(n => includeInactive || n.effective_active));
    },
  });
}

module.exports = { buildHierarchy };
