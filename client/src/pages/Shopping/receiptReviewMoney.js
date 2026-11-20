import {priceBreakdown,receiptSum,scaled} from '../../../../shared/receiptPricing.mjs';
const product = (row) => priceBreakdown(row).units;
const money = (cents) =>
  (Number(cents) / 100).toLocaleString("he-IL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export const rowTotal = (row) => {
  const value = product(row);
  return value === null ? "—" : money((value + 500n) / 1000n);
};
export function receiptTotals(rows, printed) {
  // Same sum-then-round boundary as checkout; retain weighted quantities exactly.
  const cents = receiptSum(rows);
  const receipt = scaled(String(printed ?? ''), 2),
    delta = receipt === null ? null : cents - receipt;
  return {
    total: money(cents),
    difference: delta === null ? null : (delta < 0n ? "−" : delta > 0n ? "+" : "") + money(delta < 0n ? -delta : delta),
    discrepancy:
      delta === null || delta === 0n
        ? null
        : `מודפס ₪${money(receipt)} · פער ${delta > 0n ? "+" : "−"}₪${money(delta < 0n ? -delta : delta)}`,
  };
}
