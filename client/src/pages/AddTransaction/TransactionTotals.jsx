import { Alert, MoneyAmount, NumberField, Select } from '../../components/ui';

const GLOBAL_DISCOUNT_SOURCES = [
  { value: 'loyalty_points', label: 'נקודות מועדון' },
  { value: 'coupon', label: 'קופון' },
  { value: 'store_credit', label: 'זיכוי חנות' },
  { value: 'other', label: 'אחר' },
];

const SummaryRow = ({ label, value }) => (
  <div className="transaction-totals__row">
    <span>{label}</span>
    <MoneyAmount value={value} />
  </div>
);

const TransactionTotals = ({
  globalDiscount,
  globalDiscountSource,
  total,
  pricingPreview,
  onDiscountChange,
}) => {
  const itemDiscounts = pricingPreview?.totals?.itemDiscounts || '0.00';
  const discountedItemsTotal = pricingPreview?.totals?.receiptSubtotal || '0.00';

  return (
    <aside className="transaction-totals" aria-label="סיכום סכום התנועה">
      <SummaryRow label="סה״כ פריטים" value={discountedItemsTotal} />
      {Number(itemDiscounts) > 0 && (
        <SummaryRow label="הנחות בפריטים" value={`-${itemDiscounts}`} />
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
      {Number(globalDiscount) > 0 && (
        <Select
          className="transaction-totals__discount-source"
          name="global_discount_source"
          label="מקור ההנחה"
          value={globalDiscountSource}
          onChange={onDiscountChange}
          placeholder="ללא סיווג"
          helperText="הסיווג אופציונלי ונשמר עם התנועה."
          size="compact"
        >
          {GLOBAL_DISCOUNT_SOURCES.map((source) => (
            <option key={source.value} value={source.value}>{source.label}</option>
          ))}
        </Select>
      )}
      {pricingPreview?.error && (
        <Alert variant="warning">{pricingPreview.error}</Alert>
      )}
      <div className="transaction-totals__final">
        <span>סכום התנועה</span>
        <MoneyAmount value={total} />
      </div>
    </aside>
  );
};

export default TransactionTotals;
