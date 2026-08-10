const ACQUISITION_TYPES = new Set(['purchased', 'gift', 'trade', 'other']);
const GLOBAL_DISCOUNT_SOURCES = new Set(['loyalty_points', 'coupon', 'store_credit', 'other']);

const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

function decimalText(value, fieldName) {
  if (value === '' || value == null) return '0';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${fieldName} must be a finite amount`);
    if (Number.isInteger(value)) return String(value);
    const text = String(value);
    return /e/i.test(text) ? value.toFixed(12).replace(/0+$/, '').replace(/\.$/, '') : text;
  }
  return String(value).trim();
}

function toMinorUnits(value, fieldName = 'amount') {
  const text = decimalText(value, fieldName);
  const match = DECIMAL_PATTERN.exec(text);
  if (!match) throw new Error(`${fieldName} must be a valid decimal amount`);

  const negative = match[1] === '-';
  const whole = BigInt(match[2]);
  const fraction = match[3] || '';
  const centsText = fraction.padEnd(2, '0').slice(0, 2);
  let minorUnits = (whole * 100n) + BigInt(centsText || '0');

  // Monetary inputs are stored at agorot precision. Extra decimal places are
  // rounded deterministically instead of passing binary floating artifacts on.
  if (fraction.length > 2 && Number(fraction[2]) >= 5) minorUnits += 1n;
  return negative ? -minorUnits : minorUnits;
}

function fromMinorUnits(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function roundDivide(numerator, denominator) {
  if (denominator <= 0n) throw new Error('Cannot divide by zero');
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute + (denominator / 2n)) / denominator;
  return negative ? -rounded : rounded;
}

function parseDecimalRatio(value, fieldName) {
  const text = decimalText(value, fieldName);
  const match = DECIMAL_PATTERN.exec(text);
  if (!match) throw new Error(`${fieldName} must be a valid decimal value`);
  const scale = 10n ** BigInt((match[3] || '').length);
  const magnitude = BigInt(`${match[2]}${match[3] || ''}`);
  return {
    numerator: match[1] === '-' ? -magnitude : magnitude,
    denominator: scale,
  };
}

function calculateFinalUnitCents(price, discountType, discountValue) {
  const originalCents = toMinorUnits(price, 'price_per_unit');
  if (originalCents < 0n) throw new Error('price_per_unit cannot be negative');

  let discountCents;
  if (discountType === 'percent') {
    const percent = parseDecimalRatio(discountValue, 'discount_value');
    discountCents = roundDivide(
      originalCents * percent.numerator,
      100n * percent.denominator,
    );
  } else {
    discountCents = toMinorUnits(discountValue, 'discount_value');
  }

  const finalCents = originalCents - discountCents;
  return finalCents > 0n ? finalCents : 0n;
}

function normalizeQuantity(value) {
  if (value === '' || value == null) return 1n;
  const text = String(value).trim();
  if (!/^\d+$/.test(text) || BigInt(text) < 1n) return 1n;
  return BigInt(text);
}

function normalizeAcquisitionType(value) {
  const acquisitionType = value || 'purchased';
  if (!ACQUISITION_TYPES.has(acquisitionType)) {
    throw new Error('Invalid transaction item acquisition type');
  }
  return acquisitionType;
}

function normalizeGlobalDiscountSource(value, globalDiscountCents) {
  if (globalDiscountCents === 0n || value === '' || value == null) return null;
  if (!GLOBAL_DISCOUNT_SOURCES.has(value)) {
    throw new Error('Invalid global discount source');
  }
  return value;
}

function buildTransactionPricing(items = [], globalDiscount = 0, expectedTotal = null) {
  const globalDiscountCents = toMinorUnits(globalDiscount, 'global_discount');
  if (globalDiscountCents < 0n) throw new Error('global_discount cannot be negative');

  const pricedItems = items.map((item, index) => {
    const quantity = normalizeQuantity(item.quantity);
    const originalUnitCents = toMinorUnits(item.price_per_unit, 'price_per_unit');
    const receiptUnitCents = calculateFinalUnitCents(
      item.price_per_unit,
      item.discount_type || 'amount',
      item.discount_value,
    );
    const receiptLineCents = receiptUnitCents * quantity;
    const acquisitionType = normalizeAcquisitionType(item.acquisition_type);

    return {
      index,
      item,
      quantity,
      originalUnitCents,
      receiptUnitCents,
      receiptLineCents,
      acquisitionType,
      eligible: acquisitionType !== 'gift' && receiptLineCents > 0n,
      allocatedGlobalDiscountCents: 0n,
    };
  });

  const eligibleSubtotalCents = pricedItems.reduce(
    (sum, item) => sum + (item.eligible ? item.receiptLineCents : 0n),
    0n,
  );

  if (globalDiscountCents > 0n && eligibleSubtotalCents === 0n) {
    throw new Error('global_discount requires at least one eligible paid item');
  }
  if (globalDiscountCents > eligibleSubtotalCents) {
    throw new Error('global_discount cannot exceed the eligible item subtotal');
  }

  if (globalDiscountCents > 0n) {
    const rankedRemainders = [];
    let allocatedCents = 0n;

    pricedItems.forEach((item) => {
      if (!item.eligible) return;
      const weightedDiscount = globalDiscountCents * item.receiptLineCents;
      item.allocatedGlobalDiscountCents = weightedDiscount / eligibleSubtotalCents;
      allocatedCents += item.allocatedGlobalDiscountCents;
      rankedRemainders.push({
        item,
        remainder: weightedDiscount % eligibleSubtotalCents,
      });
    });

    rankedRemainders.sort((left, right) => {
      if (left.remainder === right.remainder) return left.item.index - right.item.index;
      return left.remainder > right.remainder ? -1 : 1;
    });

    let remainderCents = globalDiscountCents - allocatedCents;
    for (let index = 0; remainderCents > 0n; index += 1) {
      rankedRemainders[index].item.allocatedGlobalDiscountCents += 1n;
      remainderCents -= 1n;
    }
  }

  pricedItems.forEach((item) => {
    item.actualLineCents = item.receiptLineCents - item.allocatedGlobalDiscountCents;
  });

  const receiptSubtotalCents = pricedItems.reduce((sum, item) => sum + item.receiptLineCents, 0n);
  const actualTotalCents = receiptSubtotalCents - globalDiscountCents;

  if (items.length > 0 && expectedTotal !== null && expectedTotal !== undefined && expectedTotal !== '') {
    const expectedTotalCents = toMinorUnits(expectedTotal, 'total_amount');
    if (expectedTotalCents !== actualTotalCents) {
      throw new Error('total_amount does not reconcile with item prices and global_discount');
    }
  }

  return {
    globalDiscountCents,
    eligibleSubtotalCents,
    receiptSubtotalCents,
    actualTotalCents,
    items: pricedItems,
  };
}

module.exports = {
  ACQUISITION_TYPES,
  GLOBAL_DISCOUNT_SOURCES,
  buildTransactionPricing,
  calculateFinalUnitCents,
  fromMinorUnits,
  normalizeGlobalDiscountSource,
  roundDivide,
  toMinorUnits,
};
