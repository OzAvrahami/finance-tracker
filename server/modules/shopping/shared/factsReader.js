'use strict';
const { requireRule } = require('./errors');
// Read-only adapter for retained receipt algorithms. Every row came from one
// authoritative RPC snapshot; no independent REST read can race the decision.
function factsReader(facts) {
  const tables = { shopping_catalog_items: 'products', shopping_product_identifiers: 'identifiers',
    shopping_product_mappings: 'mappings', shopping_commercial_products: 'commercial', shopping_product_lookup_cache: 'cache' };
  return Object.freeze({ shoppingFacts: facts,
    from(table) {
      requireRule(Object.hasOwn(tables, table) && Array.isArray(facts[tables[table]]), 'shopping_snapshot_invalid');
      let rows = [...facts[tables[table]]], single = false;
      const q = {
        select() { return q; }, eq(k, v) { rows = rows.filter(r => String(r[k]) === String(v));return q; },
        in(k, values) { rows = rows.filter(r => values.map(String).includes(String(r[k])));return q; },
        maybeSingle() { single = true;return q; },
        then(resolve, reject) { return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: single && rows.length > 1 ? Error('shopping_snapshot_invalid') : null }).then(resolve, reject); },
      };return q;
    },
  });
}
module.exports = { factsReader };
