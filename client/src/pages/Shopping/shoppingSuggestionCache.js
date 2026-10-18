// One cache per mounted entry/authenticated user/list type. Never a complete catalog.
export const CATALOG_SUGGESTIONS_CHANGED = 'shopping-catalog-suggestions-changed';
const key = value => String(value).normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('he');
const ttl = 30_000;

export function createSuggestionCache(fetchItems, listTypeId) {
  const items = new Map(), queries = new Map(), pending = new Map();
  let generation = 0;
  return {
    matches(text) {
      const query = key(text);
      if (!query) return [];
      const rank = item => key(item.name) === query ? 0 : key(item.name).startsWith(query) ? 1 : 2;
      return [...items.values()].filter(entry => Date.now()-entry.at < 120_000).map(entry => entry.item)
        .filter(item => key(item.name).includes(query))
        .sort((a,b) => rank(a)-rank(b) || a.name.localeCompare(b.name,'he') || String(a.id).localeCompare(String(b.id)))
        .slice(0,8);
    },
    async load(text = '') {
      const query = key(text);
      if (Date.now() - (queries.get(query) ?? -Infinity) < ttl) return;
      if (pending.has(query)) return pending.get(query).request;
      // Keep at most the preload and the latest remote query in flight.
      for (const [other, work] of pending) if (other && other !== query) {
        work.controller.abort(); pending.delete(other);
      }
      const revision = generation;
      const controller = new AbortController();
      const request = fetchItems({ search: text.trim(), list_type_id: listTypeId, limit: query ? 8 : 20 }, { signal: controller.signal, timeout: 8000 })
        .then(({data}) => {
          if (revision !== generation || controller.signal.aborted) return;
          for (const item of Array.isArray(data) ? data : []) {
            items.delete(String(item.id)); items.set(String(item.id),{ item, at:Date.now() });
          }
          while (items.size > 128) {
            items.delete(items.keys().next().value);
            queries.clear(); // Eviction cannot turn a previously fetched query into a false empty hit.
          }
          queries.delete(query); queries.set(query,Date.now());
          while (queries.size > 32) queries.delete(queries.keys().next().value);
        }).finally(() => { if (pending.get(query)?.request === request) pending.delete(query); });
      pending.set(query,{ request, controller });
      return request;
    },
    clear() { ++generation; for (const work of pending.values()) work.controller.abort(); items.clear(); queries.clear(); pending.clear(); },
  };
}
