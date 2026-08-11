const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

const toCents = (value) => {
  if (value === '' || value == null) return 0n;
  let text = String(value).trim();
  if (/e/i.test(text) && Number.isFinite(Number(value))) {
    text = Number(value).toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
  }
  const match = DECIMAL_PATTERN.exec(text);
  if (!match) return 0n;
  const fraction = match[3] || '';
  let cents = (BigInt(match[2]) * 100n) + BigInt(fraction.padEnd(2, '0').slice(0, 2) || '0');
  if (fraction.length > 2 && Number(fraction[2]) >= 5) cents += 1n;
  return match[1] === '-' ? -cents : cents;
};

const fromCents = (value) => {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
};

const roundDivide = (numerator, denominator) => {
  if (denominator <= 0n) return 0n;
  return (numerator + (denominator / 2n)) / denominator;
};

const percentRatio = (value) => {
  const match = DECIMAL_PATTERN.exec(String(value || 0));
  if (!match) return { numerator: 0n, denominator: 1n };
  const fraction = match[3] || '';
  const numerator = BigInt(`${match[2]}${fraction}`);
  return {
    numerator: match[1] === '-' ? -numerator : numerator,
    denominator: 10n ** BigInt(fraction.length),
  };
};

const receiptUnitCents = (item) => {
  const original = toCents(item.price_per_unit);
  const discount = item.discount_type === 'percent'
    ? (() => {
      const ratio = percentRatio(item.discount_value);
      return roundDivide(original * ratio.numerator, 100n * ratio.denominator);
    })()
    : toCents(item.discount_value);
  return original - discount > 0n ? original - discount : 0n;
};

export const getTransactionPricingPreview = (items = [], globalDiscount = 0) => {
  const discountCents = toCents(globalDiscount);
  const pricedItems = items.map((item, index) => {
    const quantity = /^\d+$/.test(String(item.quantity)) && BigInt(item.quantity) > 0n
      ? BigInt(item.quantity)
      : 1n;
    const originalCents = toCents(item.price_per_unit) * quantity;
    const receiptCents = receiptUnitCents(item) * quantity;
    return {
      index,
      originalCents,
      receiptCents,
      eligible: (item.acquisition_type || 'purchased') !== 'gift' && receiptCents > 0n,
      allocatedCents: 0n,
    };
  });
  const eligibleSubtotal = pricedItems.reduce(
    (sum, item) => sum + (item.eligible ? item.receiptCents : 0n),
    0n,
  );
  const originalSubtotal = pricedItems.reduce((sum, item) => sum + item.originalCents, 0n);
  const receiptSubtotal = pricedItems.reduce((sum, item) => sum + item.receiptCents, 0n);

  let error = '';
  if (discountCents < 0n) error = 'ההנחה הכללית לא יכולה להיות שלילית.';
  else if (discountCents > 0n && eligibleSubtotal === 0n) error = 'נדרש לפחות פריט אחד בתשלום כדי לחלק הנחה כללית.';
  else if (discountCents > eligibleSubtotal) error = 'ההנחה הכללית גבוהה מסכום הפריטים הזכאים.';

  if (!error && discountCents > 0n) {
    let allocated = 0n;
    const remainders = [];
    pricedItems.forEach((item) => {
      if (!item.eligible) return;
      const weighted = discountCents * item.receiptCents;
      item.allocatedCents = weighted / eligibleSubtotal;
      allocated += item.allocatedCents;
      remainders.push({ item, remainder: weighted % eligibleSubtotal });
    });
    remainders.sort((left, right) => {
      if (left.remainder === right.remainder) return left.item.index - right.item.index;
      return left.remainder > right.remainder ? -1 : 1;
    });
    let remaining = discountCents - allocated;
    for (let index = 0; remaining > 0n; index += 1) {
      remainders[index].item.allocatedCents += 1n;
      remaining -= 1n;
    }
  }

  return {
    error,
    totals: {
      originalSubtotal: fromCents(originalSubtotal),
      itemDiscounts: fromCents(originalSubtotal - receiptSubtotal),
      receiptSubtotal: fromCents(receiptSubtotal),
      globalDiscount: fromCents(discountCents),
      actualTotal: fromCents(receiptSubtotal - discountCents),
    },
    items: pricedItems.map((item) => ({
      receiptPrice: fromCents(item.receiptCents),
      allocatedGlobalDiscount: fromCents(item.allocatedCents),
      actualPaid: fromCents(item.receiptCents - item.allocatedCents),
    })),
  };
};

export const getTransactionTotalValue = (items = [], globalDiscount = 0) => {
  const { totals } = getTransactionPricingPreview(items, globalDiscount);
  const value = Number(totals.actualTotal);
  return Number.isFinite(value) && value > 0 ? value : 0;
};
