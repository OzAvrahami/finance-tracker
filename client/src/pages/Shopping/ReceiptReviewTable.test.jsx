import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import ReceiptReviewTable from "./ReceiptReviewTable";
import { receiptTotals, rowTotal } from "./receiptReviewMoney";
const row = {
  name: "מלפפון",
  quantity: "0.984",
  unit: "ק״ג",
  price: "7.90",
  catalog_item_id: null,
  source_lines: [
    { photo_number: 1, line_number: 20, y: 600 },
    { photo_number: 2, line_number: 2, y: 60 },
  ],
  overlap_uncertain: true,
};
it("compact semantic table exposes editable cells immediately and matching only on demand", () => {
  const onChange = vi.fn(),
    onRemove = vi.fn(),
    onAdd = vi.fn();
  render(
    <ReceiptReviewTable
      rows={[row]}
      catalog={[{ id: 7, name: "מלפפון" }]}
      plan={[]}
      onChange={onChange}
      onRemove={onRemove}
      onAdd={onAdd}
    />,
  );
  expect(screen.getAllByRole("columnheader").map((e) => e.textContent)).toEqual(
    ["מוצר", "כמות", "יחידה", "מחיר מקורי ליחידה", "הנחה לשורה", "מחיר לאחר הנחה ליחידה", "סה״כ", "פעולות"],
  );
  expect(screen.getByLabelText("כמות 1")).toHaveValue(0.984);
  expect(screen.queryByLabelText("התאמה לקטלוג 1")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("מחיר לאחר הנחה ליחידה 1"), {
    target: { value: "8.20" },
  });
  expect(onChange).toHaveBeenCalledWith(0, "price", "8.20");
  fireEvent.click(screen.getByRole("button", { name: "פרטי שורה 1" }));
  expect(screen.getByLabelText("התאמה לקטלוג 1")).toBeVisible();
  expect(
    screen.getByText(/תמונה 1, שורה 20.*תמונה 2, שורה 2/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "הסרת שורה 1" }));
  expect(onRemove).toHaveBeenCalledWith(0);
  fireEvent.click(screen.getByRole("button", { name: /הוספת שורה/ }));
  expect(onAdd).toHaveBeenCalledOnce();
});
it("weighted totals round exactly at the existing sum boundary and discrepancy never fills missing values", () => {
  expect(rowTotal(row)).toBe("7.77");
  expect(
    receiptTotals(
      [
        { quantity: "0.005", price: "1" },
        { quantity: "0.005", price: "1" },
      ],
      "0.01",
    ),
  ).toEqual({ total: "0.01", discrepancy: null });
  expect(
    receiptTotals([{ quantity: "2", price: "9.00" }], "22.00").discrepancy,
  ).toContain("−₪4.00");
  expect(rowTotal({ ...row, quantity: null })).toBe("—");
  expect(receiptTotals([row], null).discrepancy).toBeNull();
});

it("resolved unit spellings stay in details, not conflict markers; owner net-price edits clear only their obsolete markers", () => {
  const { rerender } = render(
    <ReceiptReviewTable
      rows={[
        {
          ...row,
          overlap_uncertain: false,
          catalog_item_id: "7",
          field_conflicts: [],
          resolved_conflicts: [{ field: "unit", values: ["יח'", "יח׳"] }],
        },
      ]}
      catalog={[]}
      plan={[]}
      onChange={() => {}}
      onRemove={() => {}}
      onAdd={() => {}}
    />,
  );
  expect(screen.queryByText("סתירה")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "פרטי שורה 1" }));
  expect(screen.getByText(/כתיבי יחידה שקולים/)).toBeVisible();
  const conflict = {
    ...row,
    overlap_uncertain: false,
    catalog_item_id: "7",
    field_conflicts: [
      { field: "quantity", values: ["1", "2"] },
      { field: "discount", values: ["0", "3"] },
    ],
    owner_edited_fields: ["price"],
  };
  rerender(
    <ReceiptReviewTable
      rows={[conflict]}
      catalog={[]}
      plan={[]}
      onChange={() => {}}
      onRemove={() => {}}
      onAdd={() => {}}
    />,
  );
  expect(screen.getByText("סתירה")).toBeInTheDocument();
  rerender(
    <ReceiptReviewTable
      rows={[{ ...conflict, owner_edited_fields: ["price", "quantity"] }]}
      catalog={[]}
      plan={[]}
      onChange={() => {}}
      onRemove={() => {}}
      onAdd={() => {}}
    />,
  );
  expect(screen.queryByText("סתירה")).not.toBeInTheDocument();
  expect(screen.getByText(/קריאות מקור/)).toBeInTheDocument();
});
