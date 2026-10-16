import { decimal, quantityText, unitCode } from './shoppingQuantities.mjs';

// Planning UI only: do not restrict receipt/legacy ingestion or infer conversions.
export const planningUnits = Object.freeze([
  { value: 'unit', label: 'יח׳' }, { value: 'kg', label: 'ק״ג' },
  { value: 'g', label: 'גרם' }, { value: 'l', label: 'ליטר' },
  { value: 'ml', label: 'מ״ל' }, { value: 'pack', label: 'מארז' },
  { value: 'pair', label: 'זוג' },
]);
export const defaultPlanningUnit = 'unit';
export function planningUnit(value) {
  if (value == null || value === '') return defaultPlanningUnit;
  const code = /^(pair|pairs|זוג|זוגות)$/i.test(value.trim()) ? 'pair' : unitCode(value);
  // package and pack are distinct. Never replace a legacy/custom value implicitly.
  return planningUnits.some(option => option.value === code) ? code : value;
}
export const supportedPlanningUnit = value => planningUnits.some(option => option.value === value);
export const planningUnitLabel = value => planningUnits.find(option => option.value === planningUnit(value))?.label || value;
export function stepPlanningQuantity(value, direction) {
  const parsed = decimal(value);
  if (parsed === null) return null;
  const next = parsed + BigInt(direction) * 1000n;
  return next > 0n && next <= 10000000n ? quantityText(next) : null;
}

// Same NFKC, whitespace set and ASCII case fold as migration 051. Hebrew/English
// names match consistently without locale-specific lowercasing or fuzzy assignment.
export const categoryNameLimit = 300;
export const categoryDisplayName = value => typeof value === 'string'
  ? value.normalize('NFKC').replace(/[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/g, ' ').replace(/^ | $/g, '') : '';
export const categoryNameKey = value => categoryDisplayName(value).replace(/[A-Z]/g, c => c.toLowerCase());
