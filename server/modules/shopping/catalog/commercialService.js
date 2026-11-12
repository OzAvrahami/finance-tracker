'use strict';
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { requireRule } = require('../shared/errors');
const { identity } = require('../shared/contracts');
const { catalogView } = require('../shared/repository');
const { fields, text, numberText } = require('../lists/listService');
const { identifier } = require('../../../services/shoppingProductIdentifiers');
const { unitCode } = require('../../../../shared/shoppingQuantities.mjs');

function detail(facts, id) {
  const product = facts.commercial.find(p => p.id === id);
  requireRule(product, 'shopping_product_missing');
  return { ...product, mapping: facts.mappings.find(m => m.commercial_product_id === id && m.revision === product.mapping_revision) ?? null,
    identifiers: facts.identifiers.filter(i => i.commercial_product_id === id) };
}
function find(facts, key) {
  const row = key && facts.identifiers.find(i => i.kind === key.kind && i.retailer_scope === key.retailer_scope && i.code === key.code);
  return row ? detail(facts, row.commercial_product_id) : null;
}
function unitFactor(from, to) {
  const a = unitCode(from), b = unitCode(to);
  if (!a || !b) return null;
  if (a === b) return '1';
  if ((a === 'kg' && b === 'g') || (a === 'l' && b === 'ml')) return '1000';
  if ((a === 'g' && b === 'kg') || (a === 'ml' && b === 'l')) return '0.001';
  return null;
}
function multiply(a, b) {
  const parts = value => { const [x, y = ''] = String(value).split('.');return { n: BigInt(x + y), places: y.length }; };
  const x = parts(a), y = parts(b), places = x.places + y.places;
  const n = (x.n * y.n).toString().padStart(places + 1, '0');
  return places ? `${n.slice(0, -places)}.${n.slice(-places)}`.replace(/\.?0+$/, '') : n;
}
function planCommercial(facts, action, body, actor) {
  fields(body, ['code', 'kind', 'retailer_scope', 'provider', 'name', 'brand', 'package_quantity', 'package_unit', 'provenance',
    ...(action === 'map' ? ['personal_item_id', 'expected_revision', 'request_key', 'receipt_unit', 'planning_unit', 'planning_unit_code', 'factor', 'new_personal'] : [])]);
  const key = identifier(body.code, body.kind ?? 'gtin', body.retailer_scope ?? '');
  requireRule(key, 'shopping_identifier_invalid');
  const existing = find(facts, key), id = existing?.id ?? randomUUID();
  const name = text(body.name, 200, false), changes = {};
  for (const k of ['brand', 'package_unit']) if (Object.hasOwn(body, k)) changes[k] = body[k] === null ? null : text(body[k], 200);
  if (Object.hasOwn(body, 'package_quantity')) changes.package_quantity = body.package_quantity === null ? null : numberText(body.package_quantity, 99999, { positive: true, places: 3 });
  if (Object.hasOwn(body, 'provenance')) {
    requireRule(body.provenance && typeof body.provenance === 'object' && !Array.isArray(body.provenance) && Buffer.byteLength(JSON.stringify(body.provenance)) <= 4096, 'shopping_input_invalid');
    changes.provenance = body.provenance;
  }
  const base = existing ?? { id, receipt_name: name, brand: null, package_quantity: null, package_unit: null, provenance: {}, mapping_revision: 0 };
  const proposed = { ...base, ...changes };
  requireRule((proposed.package_quantity === null) === (proposed.package_unit === null), 'shopping_input_invalid');
  requireRule(proposed.package_unit === null || ['unit', 'package', 'pack', 'g', 'kg', 'ml', 'l'].includes(proposed.package_unit), 'shopping_input_invalid');
  const effect = { kind: 'commercial.write', id, identifier: key,
    create: existing ? null : { receipt_name: name, brand: proposed.brand, package_quantity: proposed.package_quantity, package_unit: proposed.package_unit, provenance: proposed.provenance },
    approve: action === 'approve' ? { ...changes, approved_name: name } : null, mapping: null, create_personal: null };
  if (action !== 'map') return effect;
  const prior = body.request_key && facts.mappings.find(m => m.request_key === body.request_key);
  if (prior) {
    // Historical mapping records predate HTTP replay. Preserve their established
    // current-detail response, but never manufacture an unavailable old response.
    const target = body.new_personal?.unit ?? body.planning_unit;
    const legacy = { ...body, ...key, action: 'map', receipt_unit: unitCode(body.receipt_unit), planning_unit: target, planning_unit_code: unitCode(target) };
    requireRule(prior.commercial_product_id === id && (isDeepStrictEqual(prior.request_payload, body) || isDeepStrictEqual(prior.request_payload, legacy)), 'shopping_mapping_conflict');
    return { kind: 'commercial.historical-replay', id };
  }
  requireRule(Number.isInteger(body.expected_revision) && body.expected_revision === base.mapping_revision, 'shopping_mapping_stale');
  const view = catalogView(facts);
  let personal = null;
  if (body.new_personal != null) {
    requireRule(body.personal_item_id === null, 'shopping_input_invalid');
    fields(body.new_personal, ['name', 'unit', 'category_id']);
    const category = view.tree.get(body.new_personal.category_id);
    requireRule(category.effective_active, 'shopping_category_unavailable');
    personal = { name: text(body.new_personal.name, 200, false), default_unit: text(body.new_personal.unit, 30, false), category_id: category.id };
    requireRule(!facts.products.some(p => String(p.category_id) === category.id && p.name === personal.name), 'shopping_product_collision');
    effect.create_personal = personal;
  } else if (body.personal_item_id !== null) {
    personal = view.product(identity(body.personal_item_id));
    requireRule(personal.is_active && view.tree.get(personal.category_id).effective_active, 'shopping_product_invalid');
  }
  const pack = existing ?? proposed;
  const receiptUnit = unitCode(body.receipt_unit), planning = personal ? text(personal.id ? body.planning_unit : personal.default_unit, 30, false) : null;
  let factor = null;
  if (personal) {
    factor = body.factor === null ? unitFactor(receiptUnit, planning) : numberText(body.factor, 100000, { positive: true, places: 6 });
    if (factor === null && ['unit', 'package'].includes(receiptUnit) && pack.package_quantity !== null) {
      const conversion = unitFactor(pack.package_unit, planning);
      if (conversion !== null) factor = multiply(pack.package_quantity, conversion);
    }
  }
  if (factor !== null) { requireRule(receiptUnit, 'shopping_conversion_invalid');factor = numberText(factor, 100000, { positive: true, places: 6 }); }
  effect.mapping = { revision: base.mapping_revision + 1, personal_item_id: personal?.id ? String(personal.id) : null,
    personal_name: personal?.name ?? null, planning_unit: planning, receipt_unit: receiptUnit, factor,
    request_key: body.request_key ?? null, request_payload: body, approved_by: actor };
  return effect;
}
module.exports = { planCommercial, detail, find, unitFactor, multiply };
