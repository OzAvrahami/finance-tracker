'use strict';

const { requireRule } = require('./errors');
const {
  categoryDisplayName, categoryNameKey, categoryNameLimit,
} = require('../../../../shared/shoppingEntryOptions.mjs');

// Canonical decimal strings avoid lossy bigint-to-Number coercion. The marked
// neutral category may have a negative ID; ordinary entities must be positive.
function identity(value, { signed = false } = {}) {
  requireRule(typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value)), 'shopping_id_invalid');
  const text = String(value);
  requireRule(text.length <= 20 && (signed ? /^-?[1-9][0-9]*$/ : /^[1-9][0-9]*$/).test(text), 'shopping_id_invalid');
  const number = BigInt(text);
  requireRule(number >= -9223372036854775808n && number <= 9223372036854775807n, 'shopping_id_invalid');
  return text;
}

function record(value) {
  requireRule(value !== null && typeof value === 'object' && !Array.isArray(value), 'shopping_input_invalid');
  return value;
}

function array(value) {
  requireRule(Array.isArray(value), 'shopping_input_invalid');
  return value;
}

function boolean(value) {
  requireRule(typeof value === 'boolean', 'shopping_activity_invalid');
  return value;
}

function displayOrder(value = 0) {
  requireRule(Number.isSafeInteger(value), 'shopping_order_invalid');
  return value;
}

function categoryName(value) {
  const name = categoryDisplayName(value);
  requireRule(name.length > 0 && [...name].length <= categoryNameLimit && !name.includes('\0'), 'shopping_category_name_invalid');
  return name;
}

function compareIds(left, right) {
  return BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0;
}

module.exports = { identity, record, array, boolean, displayOrder, categoryName, categoryNameKey, compareIds };
