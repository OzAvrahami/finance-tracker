import { MoneyAmount, NumberField } from '../../components/ui';

const calculateFinalUnitPrice = (price, discountType, discountValue) => {
  if (!price) return 0;
  const numericPrice = Number(price);
  const numericDiscount = Number(discountValue);
  return discountType === 'percent'
    ? numericPrice - (numericPrice * (numericDiscount / 100))
    : numericPrice - numericDiscount;
};

const calculateItemValues = (items) => items.reduce((summary, item) => {
  const quantity = Number(item.quantity) || 0;
  const unitPrice = Number(item.price_per_unit) || 0;
  const finalUnitPrice = calculateFinalUnitPrice(
    item.price_per_unit,
    item.discount_type,
    item.discount_value,
  );

  return {
    subtotal: summary.subtotal + (unitPrice * quantity),
    itemDiscounts: summary.itemDiscounts + ((unitPrice - finalUnitPrice) * quantity),
  };
}, { subtotal: 0, itemDiscounts: 0 });

const SummaryRow = ({ label, value }) => (
  <div className="transaction-totals__row">
    <span>{label}</span>
    <MoneyAmount value={value} />
  </div>
);

const TransactionTotals = ({ items, globalDiscount, total, onDiscountChange }) => {
  const { subtotal, itemDiscounts } = calculateItemValues(items);
  const discountedItemsTotal = subtotal - itemDiscounts;

  return (
    <aside className="transaction-totals" aria-label="סיכום סכום התנועה">
      <SummaryRow label="סה״כ פריטים" value={discountedItemsTotal} />
      {itemDiscounts > 0 && (
        <SummaryRow label="הנחות בפריטים" value={-itemDiscounts} />
      )}
      <NumberField
        className="transaction-totals__discount"
        name="global_discount"
        label="הנחה על כל התנועה"
        value={globalDiscount}
        onChange={onDiscountChange}
        min="0"
        step="0.01"
        suffix="₪"
        size="compact"
      />
      <div className="transaction-totals__final">
        <span>סכום התנועה</span>
        <MoneyAmount value={total} />
      </div>
    </aside>
  );
};

export default TransactionTotals;
