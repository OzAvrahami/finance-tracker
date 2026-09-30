import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, it, expect, vi } from "vitest";
import ShoppingIntelligence from "./ShoppingIntelligence";
import * as api from "../../services/api";
vi.mock("../../services/api", () => ({
  getShoppingReceiptDuplicates: vi.fn().mockResolvedValue({data: []}),
  getShoppingIntelligence: vi.fn(),
  saveShoppingRegular: vi.fn(),
  removeShoppingRegular: vi.fn(),
  acceptShoppingSuggestion: vi.fn(),
  uploadShoppingReceipt: vi.fn(),
  confirmShoppingReceipt: vi.fn(),
}));
const catalog = [
  { id: 1, name: "חלב" },
  { id: 2, name: "לחם" },
];
const base = () => ({
  catalog,
  regulars: [],
  suggestions: [],
  plan: null,
  receipt: null,
  reconciliation: null,
});
const list = { id: 1, status: "active", shopping_list_items: [] };
const open = async () => {
  fireEvent.click(
    screen.getByRole("button", { name: "מוצרים קבועים, הצעות וקבלות" }),
  );
  await screen.findByRole("heading", { name: "המוצרים הקבועים שלי" });
};
beforeEach(() => {
  vi.resetAllMocks();
  api.getShoppingReceiptDuplicates.mockResolvedValue({data: []});
  api.getShoppingIntelligence.mockResolvedValue({ data: base() });
  URL.createObjectURL=vi.fn(()=>"blob:test");URL.revokeObjectURL=vi.fn();
});
it("first use supports explicit regulars without pretending to know stock", async () => {
  render(<ShoppingIntelligence list={list} onChanged={vi.fn()} />);
  await open();
  expect(screen.getByText(/אין היסטוריה/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/מוצר קבוע/), {
    target: { value: "1" },
  });
  fireEvent.change(screen.getByLabelText(/כמות רגילה/), {
    target: { value: "3" },
  });
  fireEvent.click(screen.getByRole("button", { name: "שמירת מוצר קבוע" }));
  await waitFor(() =>
    expect(api.saveShoppingRegular).toHaveBeenCalledWith("1", {
      quantity: "3",
      unit: "יח׳",
    }),
  );
});
it("suggestions explain, edit, skip and accept; existing product is not offered again", async () => {
  const s = {
    catalog_item_id: "1",
    name: "חלב",
    quantity: "2",
    unit: "ליטר",
    regular: false,
    explanation: "רכישה אחת בלבד; אין מספיק היסטוריה",
  };
  api.getShoppingIntelligence.mockResolvedValue({
    data: { ...base(), suggestions: [s] },
  });
  const changed = vi.fn();
  const { rerender } = render(
    <ShoppingIntelligence list={list} onChanged={changed} />,
  );
  await open();
  expect(screen.getByText(s.explanation)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("כמות מוצעת: חלב"), {
    target: { value: "4" },
  });
  fireEvent.click(screen.getByRole("button", { name: "דילוג: חלב" }));
  expect(
    screen.queryByRole("button", { name: "הוספה: חלב" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "הצגת הצעות שדולגו" }));
  fireEvent.click(screen.getByRole("button", { name: "הוספה: חלב" }));
  await waitFor(() =>
    expect(api.acceptShoppingSuggestion).toHaveBeenCalledWith(1, {
      catalog_item_id: "1",
      quantity: "4",
      unit: "ליטר",
    }),
  );
  rerender(
    <ShoppingIntelligence
      list={{ ...list, shopping_list_items: [{ catalog_item_id: 1 }] }}
      onChanged={changed}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "הוספה: חלב" }),
  ).not.toBeInTheDocument();
});
it("review preserves plan, requires corrections and confirmation; absent is uncertain", async () => {
  const data = {
    ...base(),
    plan: [
      { catalog_item_id: "1", name: "חלב", quantity: "2", unit: "ליטר" },
      { catalog_item_id: "2", name: "לחם", quantity: "1", unit: "יח׳" },
    ],
    receipt: { state: "review", attempts: 1 },
    reconciliation: {
      items: [
        {
          name: "זיהוי שגוי",
          quantity: "1",
          unit: "ליטר",
          price: null,
          catalog_item_id: null,
          comparison: "added",
          possible_substitutions: ["חלב"],
        },
      ],
    },
  };
  api.getShoppingIntelligence.mockResolvedValue({ data });
  const changed = vi.fn();
  render(<ShoppingIntelligence list={list} onChanged={changed} />);
  await open();
  fireEvent.click(screen.getByRole("button",{name:/^(סריקת קבלה|בדיקת קבלה)$/}));
  expect(screen.getByRole("table")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"פרטי קבלה"}));
  expect(screen.getByText(/פריט שלא זוהה אינו בהכרח/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"פרטי שורה 1"}));
  expect(screen.getByText(/תחליף אפשרי/)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "אישור להיסטוריה" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText("שם מוצר 1"), {
    target: { value: "חלב" },
  });
  fireEvent.change(screen.getByLabelText("מחיר לאחר הנחה ליחידה 1"), {
    target: { value: "6.50" },
  });
  fireEvent.change(screen.getByLabelText("התאמה לקטלוג 1"), {
    target: { value: "1" },
  });
  fireEvent.change(screen.getByLabelText(/תאריך הקנייה בפועל/), {
    target: { value: "2026-09-29" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(
    screen.getByRole("button", { name: "אישור להיסטוריה" }),
  );
  await waitFor(() =>
    expect(api.confirmShoppingReceipt).toHaveBeenCalledWith(1, expect.objectContaining({
      purchase_date: "2026-09-29",
      reviewed: true, extraction_attempt: 1,
      items: [
        expect.objectContaining({
          name: "חלב",
          quantity: "1",
          unit: "ליטר",
          price: "6.50",
          catalog_item_id: "1",
        }),
      ],
    })),
  );
  expect(data.plan[0].quantity).toBe("2");
  expect(screen.getByText("חלב: 2 ליטר")).toBeInTheDocument();
});
it("upload failure shows actionable provider message and remains retryable", async () => {
  api.uploadShoppingReceipt.mockRejectedValue({
    response: { data: { error: "receipt_provider_unconfigured" } },
  });
  render(<ShoppingIntelligence list={list} onChanged={vi.fn()} />);
  await open();
  fireEvent.click(screen.getByRole("button",{name:/^(סריקת קבלה|בדיקת קבלה)$/}));
  fireEvent.change(screen.getByLabelText(/הוספת תמונות קבלה/), {
    target: {
      files: [new File(["fixture"], "receipt.jpg", { type: "image/jpeg" })],
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "סריקת התמונות" }));
  expect(await screen.findByText(/טרם הוגדרה בשרת/)).toBeInTheDocument();
  expect(api.confirmShoppingReceipt).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "סריקת התמונות" })).toBeEnabled();
});
it("checked-out lists still permit receipt review without a financial action", async () => {
  const data = {
    ...base(),
    plan: [],
    receipt: {
      state: "confirmed",
      confirmed: { purchase_date: "2026-09-29", items: [] },
    },
  };
  api.getShoppingIntelligence.mockResolvedValue({ data });
  render(
    <ShoppingIntelligence
      list={{ ...list, status: "checked_out" }}
      onChanged={vi.fn()}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "מוצרים קבועים, הצעות וקבלות" }),
  );
  fireEvent.click(await screen.findByRole("button",{name:"סריקת קבלה"}));
  expect(await screen.findByRole("table")).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"אישור להיסטוריה"})).not.toBeInTheDocument();
  expect(api.confirmShoppingReceipt).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "שמירת מוצר קבוע" }),
  ).not.toBeInTheDocument();
});

it('duplicate warning shows prior list/history/expense and requires distinct-purchase review; identifier edits recheck', async () => {
 const identity={merchant:'סופר בדיקה',receipt_number:'R-17',purchase_date:'2026-09-29'};
 const candidate={receipt_id:'123e4567-e89b-42d3-a456-426614174000',list_id:'2',list_title:'קנייה קודמת',identity,history_confirmed:true,transaction_id:'45',checkout_total:10};
 const items=[{name:'חלב',quantity:'2',unit:'יח׳',price:'5',catalog_item_id:'1'}];
 api.getShoppingIntelligence.mockResolvedValue({data:{...base(),receipt:{state:'review',attempts:1,extracted:{identity}},reconciliation:{items},duplicate_candidates:[candidate]}});
 api.getShoppingReceiptDuplicates.mockResolvedValue({data:[candidate]});
 render(<ShoppingIntelligence list={list} onChanged={vi.fn()} />);await open();
  fireEvent.click(screen.getByRole("button",{name:/^(סריקת קבלה|בדיקת קבלה)$/}));
 fireEvent.click(screen.getByText('קבלה דומה קיימת · נדרשת בדיקה לפני אישור'));
 expect(screen.getByText('קנייה קודמת')).toBeInTheDocument();expect(screen.getByText(/כבר נוצרה הוצאה/)).toBeInTheDocument();
 fireEvent.click(screen.getByLabelText(/בדקתי את השורות/));
 const confirm=screen.getByRole('button',{name:'אישור להיסטוריה'});expect(confirm).toBeDisabled();
 fireEvent.click(screen.getByLabelText(/אלו רכישות נפרדות/));expect(confirm).toBeEnabled();
 fireEvent.click(screen.getByRole('button',{name:'פרטי קבלה'}));
 fireEvent.change(screen.getByLabelText('מספר קבלה מודפס'),{target:{value:'R-18'}});expect(confirm).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'בדיקת כפילויות'}));
 await waitFor(()=>expect(api.getShoppingReceiptDuplicates).toHaveBeenCalledWith(1,{identity:{...identity,receipt_number:'R-18'}}));
 await waitFor(()=>expect(screen.queryByRole('button',{name:'בדיקת כפילויות'})).not.toBeInTheDocument());
 expect(confirm).toBeDisabled();fireEvent.click(screen.getByLabelText(/אלו רכישות נפרדות/));fireEvent.click(confirm);
 await waitFor(()=>expect(api.confirmShoppingReceipt).toHaveBeenCalledWith(1,expect.objectContaining({duplicate_reviewed_ids:[candidate.receipt_id],identity:{...identity,receipt_number:'R-18'}})));
});
