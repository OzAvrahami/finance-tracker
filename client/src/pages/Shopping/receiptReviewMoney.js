import {priceBreakdown} from '../../../../shared/receiptPricing.mjs';
const scaled = (value, digits) => {
  const text = String(value ?? "");
  if (!new RegExp(`^\\d{1,6}(?:\\.\\d{1,${digits}})?$`).test(text)) return null;
  const [whole, part = ""] = text.split(".");
  return (
    BigInt(whole) * 10n ** BigInt(digits) + BigInt(part.padEnd(digits, "0"))
  );
};
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
  const cents =
    (rows.reduce((sum, row) => sum + (product(row) ?? 0n), 0n) + 500n) / 1000n;
  const receipt = scaled(printed, 2),
    delta = receipt === null ? null : cents - receipt;
  return {
    total: money(cents),
    discrepancy:
      delta === null || delta === 0n
        ? null
        : `מודפס ₪${money(receipt)} · פער ${delta > 0n ? "+" : "−"}₪${money(delta < 0n ? -delta : delta)}`,
  };
}
