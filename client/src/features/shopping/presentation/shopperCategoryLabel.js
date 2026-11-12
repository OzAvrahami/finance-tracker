// Shopper presentation only. Consume the canonical root-first path from the API;
// never parse a name, mutate a path, or reuse this rule in administration.
export function shopperCategoryLabel(category, fallback = '') {
  if (category?.is_neutral === true || String(category?.id) === '-1') return 'ללא קטגוריה';
  const path = category?.path;
  if (Array.isArray(path) && path.length > 0
    && path.every(node => node?.id != null && typeof node.name === 'string' && node.name.trim())
    && new Set(path.map(node => String(node.id))).size === path.length
    && category?.id != null && String(path.at(-1).id) === String(category.id)) {
    // A root-only category still needs a usable label.
    return (path.length > 1 ? path.slice(1) : path).map(node => node.name).join(' / ');
  }
  return category?.name || fallback;
}
