'use strict';

const { identity, compareIds } = require('./contracts');

// Request identity, not mutation defaults. Keep omission distinct from null and
// retain original values for persistence. Object key order is immaterial.
// ID wire types and unordered ID selections have one logical representation.
function canonicalIntent(intent) {
  const result = structuredClone(intent), body = result.body;
  if (result.id !== null) result.id = identity(result.id, { signed: true });
  for (const key of ['category_id', 'parent_id', 'list_type_id']) {
    if (Object.hasOwn(body, key) && body[key] !== null) body[key] = identity(body[key], { signed: key !== 'list_type_id' });
  }
  for (const key of ['product_ids', 'categoryIds']) {
    if (Object.hasOwn(body, key)) body[key] = body[key].map(value => identity(value, { signed: key === 'categoryIds' })).sort(compareIds);
  }
  if (Object.hasOwn(body, 'default_price') && body.default_price !== null) {
    const [whole, fraction = ''] = String(body.default_price).split('.');
    const tail = fraction.replace(/0+$/, '');
    body.default_price = whole.replace(/^0+(?=\d)/, '') + (tail ? `.${tail}` : '');
  }
  return result;
}

module.exports = { canonicalIntent };
