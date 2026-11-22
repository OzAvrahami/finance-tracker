'use strict';

const { requireRule } = require('../shared/errors');
const { listProjection } = require('./listService');
const { parseDecimalRatio, fromMinorUnits, roundDivide } = require('../../../utils/transactionPricing');

const localDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
});

function purchaseTotal(items) {
  // List inputs allow up to twelve decimal places. Keep the full product and
  // align powers of ten before rounding the sum once, as for historical checkouts.
  let sum = 0n;
  let scale = 1n;
  for (const row of items) {
    let numerator, denominator;
    if (row.price_basis === 'line_discount') {
      requireRule(row.final_total != null, 'checkout_receipt_price_required');
      ({ numerator, denominator } = parseDecimalRatio(row.final_total, 'final_total'));
    } else {
      const quantity = parseDecimalRatio(row.quantity, 'quantity');
      const price = parseDecimalRatio(row.price ?? '0', 'price');
      numerator = quantity.numerator * price.numerator;
      denominator = quantity.denominator * price.denominator;
    }
    const common = denominator > scale ? denominator : scale;
    sum = sum * (common / scale) + numerator * (common / denominator);
    scale = common;
  }
  const cents = roundDivide(sum * 100n, scale);
  requireRule(cents >= 0n, 'checkout_total_invalid');
  return fromMinorUnits(cents);
}

function planCheckout(facts, listId, expenseId) {
  const projection = listProjection(facts, listId);
  const purchase = facts.confirmed[0];
  const items = purchase ? purchase.items : projection.filter(item => item.is_purchased);
  requireRule(!facts.receipts.some(receipt => receipt.state === 'extracting'), 'receipt_processing');
  requireRule(items.length > 0, 'checkout_empty');
  requireRule(!purchase || items.every(item => item.price != null || item.final_total != null), 'checkout_receipt_price_required');
  return {
    transaction_id: expenseId,
    projection,
    history_items: purchase ? null : items,
    purchase_date: purchase ? purchase.purchase_date : localDate.format(new Date(facts.db_time)),
    total_amount: purchaseTotal(items),
  };
}

module.exports = { planCheckout };
