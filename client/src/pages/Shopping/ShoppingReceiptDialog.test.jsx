import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import { beforeEach, it, expect, vi } from "vitest";
import ShoppingReceiptDialog from "./ShoppingReceiptDialog";
import * as api from "../../services/api";
vi.mock("../../services/api", () => ({
  getShoppingIntelligence: vi.fn(),
  getShoppingReceiptDuplicates: vi.fn(),
  uploadShoppingReceipt: vi.fn(),
  confirmShoppingReceipt: vi.fn(),
  saveShoppingReceiptDraft: vi.fn(),
  lookupShoppingProduct: vi.fn(),
  approveShoppingProduct: vi.fn(),
  getShoppingCatalogCategories: vi.fn(),
  mapShoppingProduct: vi.fn(),
}));
const list = { id: 1, status: "active" };
const item = {
  name: "חלב",
  quantity: "2",
  unit: "יח׳",
  price: "5",
  catalog_item_id: "1",
  photo_numbers: [1, 2],
  overlap_uncertain: true,
};
const base = {
  receipt: null,
  plan: [],
  catalog: [{ id: 1, name: "חלב" }],
  duplicate_candidates: [],
};
const review = {
  ...base,
  receipt: {
    state: "review",
    attempts: 1,
    image_hashes: ["hash"],
    extracted: {
      items: [item],
      overlap_warnings: ["בדקו את שורת החלב בחפיפה"],
    },
  },
  reconciliation: { items: [item] },
};
const photo = (name, size = 4, type = "image/jpeg") =>
  new File([new Uint8Array(size)], name, { type });
const open = async (data = base) => {
  api.getShoppingIntelligence.mockResolvedValue({ data });
  render(<ShoppingReceiptDialog list={list} onChanged={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "סריקת קבלה" }));
  await screen.findByRole("dialog");
  await waitFor(() => expect(api.getShoppingIntelligence).toHaveBeenCalled());
  await waitFor(() =>
    expect(
      document.querySelector(".shopping-receipt-fields"),
    ).not.toBeDisabled(),
  );
};
const add = (files) =>
  fireEvent.change(screen.getByLabelText("הוספת תמונות קבלה"), {
    target: { files },
  });
beforeEach(() => {
  vi.resetAllMocks();
  api.saveShoppingReceiptDraft.mockResolvedValue({data:{revision:1}});
  api.uploadShoppingReceipt.mockResolvedValue({ data: { state: "review" } });
  URL.createObjectURL = vi.fn((f) => "blob:" + f.name);
  URL.revokeObjectURL = vi.fn();
  api.getShoppingReceiptDuplicates.mockResolvedValue({ data: [] });
});
it("ordered previews accept additions, remove/reorder and send all images in one extraction", async () => {
  await open();
  const a = photo("top.jpg"),
    b = photo("middle.jpg"),
    c = photo("bottom.jpg");
  add([a, b]);
  add([c]);
  expect(screen.getAllByRole("img")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "הקדמת תמונה 3" }));
  fireEvent.click(screen.getByRole("button", { name: "הסרת תמונה 3" }));
  expect(screen.getAllByRole("img").map((n) => n.alt)).toEqual([
    "תמונה 1: top.jpg",
    "תמונה 2: bottom.jpg",
  ]);
  api.getShoppingIntelligence.mockResolvedValue({ data: review });
  fireEvent.click(screen.getByRole("button", { name: "סריקת התמונות" }));
  await waitFor(() =>
    expect(api.uploadShoppingReceipt).toHaveBeenCalledWith(
      1,
      [a, c],
      0,
      expect.objectContaining({ review_draft: expect.any(Object) }),
    ),
  );
  await screen.findByLabelText("שם מוצר 1");
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "בדיקת מקור והתאמה 1" }),
  ).toHaveTextContent("חפיפה?");
  expect(screen.getByText(/סה״כ פריטים: ₪10.00/)).toBeInTheDocument();
  expect(api.confirmShoppingReceipt).not.toHaveBeenCalled();
});
it("invalid type, image count and bytes are actionable and leave prior selection untouched", async () => {
  await open();
  add([photo("ok.jpg")]);
  add([photo("bad.pdf", 4, "application/pdf")]);
  expect(screen.getByRole("alert")).toHaveTextContent("JPEG");
  expect(screen.getAllByRole("img")).toHaveLength(1);
  add(Array.from({ length: 6 }, (_, i) => photo(i + ".jpg")));
  expect(screen.getByRole("alert")).toHaveTextContent("1–6");
  add([photo("huge.jpg", 8 * 1024 * 1024 + 1)]);
  expect(screen.getByRole("alert")).toHaveTextContent("24 MiB");
  expect(api.uploadShoppingReceipt).not.toHaveBeenCalled();
});
it("dialog close deliberately retains corrections and restores focus; changing photos blocks stale confirmation", async () => {
  await open(review);
  await screen.findByLabelText("שם מוצר 1");
  fireEvent.change(screen.getByLabelText("שם מוצר 1"), {
    target: { value: "חלב מתוקן" },
  });
  fireEvent.click(screen.getByRole("button", { name: "תמונות הקבלה" }));
  fireEvent.click(screen.getByRole("button", { name: "בדיקת פריטים" }));
  expect(screen.getByLabelText("שם מוצר 1")).toHaveValue("חלב מתוקן");
  fireEvent.keyDown(document, { key: "Escape" });
  const closing = await screen.findByRole("dialog", {
    name: "סגירה עם טיוטה לא מאושרת",
  });
  expect(
    within(closing).getByText(/יישמרו כטיוטה ללא אישור להיסטוריה/),
  ).toBeInTheDocument();
  fireEvent.click(
    within(closing).getByRole("button", { name: "שמירת טיוטה וסגירה" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(api.saveShoppingReceiptDraft).toHaveBeenCalledWith(1,expect.objectContaining({revision:0,draft:expect.objectContaining({items:expect.arrayContaining([expect.objectContaining({name:'חלב מתוקן'})])})}));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "בדיקת קבלה" })).toHaveFocus(),
  );
  fireEvent.click(screen.getByRole("button", { name: "בדיקת קבלה" }));
  expect(screen.getByLabelText("שם מוצר 1")).toHaveValue("חלב מתוקן");
  fireEvent.click(screen.getByLabelText(/בדקתי את השורות/));
  expect(screen.getByRole("button", { name: "אישור להיסטוריה" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "תמונות הקבלה" }));
  add([photo("replacement.jpg")]);
  fireEvent.click(screen.getByRole("button", { name: "בדיקת פריטים" }));
  expect(
    screen.getByRole("button", { name: "אישור להיסטוריה" }),
  ).toBeDisabled();
  expect(screen.getByLabelText("שם מוצר 1")).toHaveValue("חלב מתוקן");
  fireEvent.click(screen.getByRole("button", { name: "תמונות הקבלה" }));
  fireEvent.click(screen.getByRole("button", { name: "סריקת התמונות" }));
  expect(
    await screen.findByRole("dialog", { name: "סריקה מחדש של הקבלה" }),
  ).toBeInTheDocument();
  expect(api.uploadShoppingReceipt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "שמירת התיקונים" }));
  expect(api.uploadShoppingReceipt).not.toHaveBeenCalled();
});
it("re-extraction uses current revision and confirmation submits the newly loaded revision only", async () => {
  await open(review);
  await screen.findByLabelText("שם מוצר 1");
  fireEvent.click(screen.getByRole("button", { name: "תמונות הקבלה" }));
  const images = [photo("new.jpg")];
  add(images);
  api.getShoppingIntelligence.mockResolvedValue({
    data: { ...review, receipt: { ...review.receipt, attempts: 2 } },
  });
  fireEvent.click(screen.getByRole("button", { name: "סריקת התמונות" }));
  fireEvent.click(await screen.findByRole("button", { name: "סריקה מחדש" }));
  await waitFor(() =>
    expect(api.uploadShoppingReceipt).toHaveBeenCalledWith(
      1,
      images,
      1,
      expect.objectContaining({
        reprocess_key: expect.any(String),
        review_draft: expect.any(Object),
      }),
    ),
  );
  await screen.findByLabelText("שם מוצר 1");
  fireEvent.click(screen.getByLabelText(/בדקתי את השורות/));
  fireEvent.click(screen.getByRole("button", { name: "אישור להיסטוריה" }));
  await waitFor(() =>
    expect(api.confirmShoppingReceipt).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        extraction_attempt: 2,
        items: [expect.objectContaining({ name: "חלב" })],
      }),
    ),
  );
  expect(
    api.confirmShoppingReceipt.mock.calls[0][1].items[0],
  ).toHaveProperty("photo_numbers",[1,2]);
});
it("styled picker counts selected photos and preserves full filenames with explicit order", async () => {
  await open();
  const input = screen.getByLabelText("הוספת תמונות קבלה");
  expect(input).toHaveAttribute("hidden");
  expect(screen.getByRole("button", { name: "הוספת תמונות" })).toBeEnabled();
  add([photo("long-footer-file.jpg"), photo("long-header-file.jpg")]);
  expect(screen.getByText("נבחרו 2 מתוך 6 תמונות")).toBeInTheDocument();
  expect(
    screen.getByText("תמונה 1 צריכה להציג את ראש הקבלה."),
  ).toBeInTheDocument();
  expect(screen.getByTitle("long-header-file.jpg")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "הקדמת תמונה 2" }));
  expect(screen.getAllByRole("img")[0]).toHaveAttribute(
    "alt",
    "תמונה 1: long-header-file.jpg",
  );
  expect(screen.getByText("אין עדיין תוצאת סריקה תקפה")).toBeInTheDocument();
});
it("failed scan preserves corrections and photos, labels previous total and retries with current revision", async () => {
  await open(review);
  await screen.findByLabelText("שם מוצר 1");
  fireEvent.change(screen.getByLabelText("שם מוצר 1"), {
    target: { value: "תיקון שמור" },
  });
  fireEvent.click(screen.getByRole("button", { name: "תמונות הקבלה" }));
  const images = [photo("top.jpg"), photo("bottom.jpg")];
  add(images);
  api.uploadShoppingReceipt.mockRejectedValueOnce({
    response: { data: { error: "receipt_extraction_invalid" } },
  });
  api.getShoppingIntelligence.mockResolvedValue({
    data: { ...base, receipt: { state: "failed", attempts: 2 } },
  });
  fireEvent.click(screen.getByRole("button", { name: "סריקת התמונות" }));
  fireEvent.click(await screen.findByRole("button", { name: "סריקה מחדש" }));
  await screen.findByText(/תוצאת הספק לא עברה/);
  expect(screen.getByText(/טיוטה קודמת.*₪10.00/)).toBeInTheDocument();
  expect(screen.queryByText(/סה״כ פריטים: ₪10.00/)).not.toBeInTheDocument();
  expect(screen.getAllByRole("img")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "בדיקת פריטים" }));
  expect(screen.getByLabelText("שם מוצר 1")).toHaveValue("תיקון שמור");
  fireEvent.click(screen.getByLabelText(/בדקתי את השורות/));
  expect(
    screen.getByRole("button", { name: "אישור להיסטוריה" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "תמונות הקבלה" }));
  api.getShoppingIntelligence.mockResolvedValue({
    data: { ...review, receipt: { ...review.receipt, attempts: 3 } },
  });
  api.uploadShoppingReceipt.mockResolvedValue({ data: {} });
  fireEvent.click(screen.getByRole("button", { name: "סריקת התמונות" }));
  await screen.findByText(/סה״כ פריטים: ₪10.00/);
  expect(api.uploadShoppingReceipt).toHaveBeenLastCalledWith(
    1,
    images,
    2,
    expect.objectContaining({
      review_draft: expect.objectContaining({
        items: [expect.objectContaining({ name: "תיקון שמור" })],
      }),
    }),
  );
  expect(api.confirmShoppingReceipt).not.toHaveBeenCalled();
});
it("unknown extracted quantity and unit remain blank and block confirmation until corrected", async () => {
  await open({
    ...review,
    reconciliation: { items: [{ ...item, quantity: null, unit: null }] },
  });
  const quantity = await screen.findByLabelText("כמות 1");
  expect(quantity).toHaveValue(null);
  expect(screen.getByText(/חלקי/)).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/בדקתי את השורות/));
  expect(
    screen.getByRole("button", { name: "אישור להיסטוריה" }),
  ).toBeDisabled();
  fireEvent.change(quantity, { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("יחידה 1"), {
    target: { value: "יח׳" },
  });
  fireEvent.click(screen.getByLabelText(/בדקתי את השורות/));
  expect(screen.getByRole("button", { name: "אישור להיסטוריה" })).toBeEnabled();
});
it("products lead the review and extracted date is autofilled without conflating printed and confirmed dates", async () => {
  const data = {
    ...review,
    receipt: {
      ...review.receipt,
      extracted: {
        ...review.receipt.extracted,
        receipt_total: "12.00",
        identity: {
          merchant: "סופר",
          receipt_number: "123",
          purchase_date: "2026-09-29",
        },
      },
    },
  };
  await open(data);
  await screen.findByLabelText("שם מוצר 1");
  expect(
    screen.getByRole("dialog", { name: "בדיקת קבלה" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("תאריך הקנייה בפועל")).toHaveValue("2026-09-29");
  expect(screen.getByLabelText("בית עסק")).toHaveValue("סופר");
  expect(screen.queryByLabelText("מספר קבלה מודפס")).not.toBeInTheDocument();
  expect(screen.getByText(/מודפס ₪12.00.*פער −₪2.00/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("תאריך הקנייה בפועל"), {
    target: { value: "2026-09-30" },
  });
  fireEvent.click(screen.getByRole("button", { name: "פרטי קבלה" }));
  expect(screen.getByLabelText("תאריך מודפס בקבלה")).toHaveValue("2026-09-29");
  fireEvent.click(screen.getByLabelText(/בדקתי את השורות/));
  fireEvent.click(screen.getByRole("button", { name: "אישור להיסטוריה" }));
  await waitFor(() =>
    expect(api.confirmShoppingReceipt).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        purchase_date: "2026-09-30",
        identity: expect.objectContaining({ purchase_date: "2026-09-29" }),
      }),
    ),
  );
});

it("saved correction backup can be recovered without confirming history", async () => {
  await open({
    ...review,
    receipt: {
      ...review.receipt,
      previous_drafts: [
        {
          attempt: 1,
          review_draft: {
            items: [{ ...item, name: "תיקון קודם" }],
            identity: { merchant: "סופר" },
            purchase_date: "2026-09-29",
          },
        },
      ],
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "פרטי קבלה" }));
  fireEvent.click(
    screen.getByRole("button", { name: "שחזור טיוטה מניסיון 1" }),
  );
  await act(async()=>{fireEvent.click(screen.getByRole("button", { name: "שחזור הטיוטה" }));});
  expect(screen.getByLabelText("שם מוצר 1")).toHaveValue("תיקון קודם");
  expect(
    screen.getByRole("button", { name: "אישור להיסטוריה" }),
  ).toBeDisabled();
  expect(api.confirmShoppingReceipt).not.toHaveBeenCalled();
});

it("lost-response retry reuses the exact reprocessing key and frozen correction draft", async () => {
  await open(review);
  await screen.findByLabelText("שם מוצר 1");
  fireEvent.click(screen.getByRole("button", { name: "תמונות הקבלה" }));
  add([photo("same.jpg")]);
  api.uploadShoppingReceipt.mockRejectedValueOnce(new Error("lost response"));
  fireEvent.click(screen.getByRole("button", { name: "סריקת התמונות" }));
  fireEvent.click(await screen.findByRole("button", { name: "סריקה מחדש" }));
  await screen.findByText(/הפעולה לא הושלמה/);
  const first = api.uploadShoppingReceipt.mock.calls[0];
  fireEvent.click(screen.getByRole("button", { name: "סריקת התמונות" }));
  fireEvent.click(await screen.findByRole("button", { name: "סריקה מחדש" }));
  await waitFor(() =>
    expect(api.uploadShoppingReceipt).toHaveBeenCalledTimes(2),
  );
  expect(api.uploadShoppingReceipt.mock.calls[1]).toEqual(first);
});

it("durable draft restores only retained rows and a stale save leaves owner edits visible", async () => {
  await open({...review,receipt:{...review.receipt,draft_revision:3,
    extracted:{items:[item,{...item,name:'Removed occurrence'}]},
    review_draft:{items:[item],identity:{merchant:'Owner shop'},purchase_date:'2026-09-28'}},
    reconciliation:{items:[{...item,row_id:'retained',name:'Owner correction'}]}});
  expect(await screen.findByLabelText('שם מוצר 1')).toHaveValue('Owner correction');
  expect(screen.queryByLabelText('שם מוצר 2')).not.toBeInTheDocument();
  expect(screen.getByLabelText('תאריך הקנייה בפועל')).toHaveValue('2026-09-28');
  fireEvent.change(screen.getByLabelText('שם מוצר 1'),{target:{value:'New correction'}});
  api.saveShoppingReceiptDraft.mockRejectedValueOnce({response:{data:{error:'receipt_stale'}}});
  fireEvent.keyDown(document,{key:'Escape'});
  fireEvent.click(await screen.findByRole('button',{name:'שמירת טיוטה וסגירה'}));
  await waitFor(()=>expect(api.saveShoppingReceiptDraft).toHaveBeenCalledWith(1,expect.objectContaining({revision:3})));
  await waitFor(()=>expect(screen.getByLabelText('שם מוצר 1')).toHaveValue('New correction'));
  expect(api.confirmShoppingReceipt).not.toHaveBeenCalled();
});

it("exact product lookup preserves owner name, quantity and price; changing lookup code clears its attribution", async () => {
  await open({...review,reconciliation:{items:[{...item,name:'Owner name',product_code:'7622210453327',owner_edited_fields:['name']}]}});
  await screen.findByLabelText('שם מוצר 1');
  fireEvent.click(screen.getByRole('button',{name:'פרטי שורה 1'}));
  api.lookupShoppingProduct.mockResolvedValue({data:{status:'found',product:{code:'7622210453327',full_name:'Provider name',source:'open_food_facts',source_url:'https://world.openfoodfacts.net/product/7622210453327'}}});
  fireEvent.click(screen.getByRole('button',{name:'חיפוש שם מלא'}));
  await screen.findByText(/נמצא קוד תואם/);
  expect(screen.getByLabelText('שם מוצר 1')).toHaveValue('Owner name');
  expect(screen.getByLabelText('כמות 1')).toHaveValue(2);
  expect(screen.getByLabelText('מחיר לאחר הנחה ליחידה 1')).toHaveValue(5);
  expect(screen.getByText(/שם ממקור: Provider name/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('קוד לחיפוש 1'),{target:{value:''}});
  expect(screen.queryByText(/שם ממקור: Provider name/)).not.toBeInTheDocument();
  expect(api.confirmShoppingReceipt).not.toHaveBeenCalled();
  expect(api.approveShoppingProduct).not.toHaveBeenCalled();
});

it("whole-row discount edits derive prices once and unknown discount stays unresolved", async () => {
  await open({...review,reconciliation:{items:[{...item,quantity:'2',price:'7.50',line_total:'30.20',discount:'15.20'}]}});
  await screen.findByLabelText('שם מוצר 1');
  expect(screen.getByLabelText('מחיר מקורי ליחידה 1')).toHaveValue(15.1);
  fireEvent.change(screen.getByLabelText('הנחה לכל השורה 1'),{target:{value:'15.20'}});
  expect(screen.getByText(/סה״כ פריטים: ₪15.00/)).toBeInTheDocument();
  expect(screen.getByLabelText('מחיר לאחר הנחה ליחידה 1')).toHaveValue(7.5);
  fireEvent.change(screen.getByLabelText('הנחה לכל השורה 1'),{target:{value:''}});
  expect(screen.getByLabelText('מחיר לאחר הנחה ליחידה 1')).toHaveValue(null);
  fireEvent.click(screen.getByLabelText(/בדקתי את השורות/));
  expect(screen.getByRole('button',{name:'אישור להיסטוריה'})).toBeDisabled();
});

it('receipt-wide lookup proposes names only; inline approval does not link or confirm a purchase',async()=>{
 await open({...review,reconciliation:{items:[{...item,product_code:'7622210453327',catalog_item_id:null}]}});
 await screen.findByLabelText('שם מוצר 1');
 const product={code:'7622210453327',full_name:'Exact sourced name',source:'open_food_facts',environment:'staging'};
 api.lookupShoppingProduct.mockResolvedValue({data:{status:'found',product}});
 fireEvent.click(screen.getByRole('button',{name:'איתור שמות מוצרים'}));
 await screen.findByRole('button',{name:'אישור שם'});
 expect(screen.getByLabelText('שם מוצר 1')).toHaveValue(item.name);
 expect(api.approveShoppingProduct).not.toHaveBeenCalled();
 api.approveShoppingProduct.mockResolvedValue({data:{...product,source:'owner_catalog',owner_approved:true,commercial_product_id:'11111111-1111-4111-8111-111111111111',mapping:null,mapping_revision:0}});
 fireEvent.click(screen.getByRole('button',{name:'אישור שם'}));
 await waitFor(()=>expect(screen.getByLabelText('שם מוצר 1')).toHaveValue('Exact sourced name'));
 expect(screen.getByLabelText('כמות 1')).toHaveValue(2);
 expect(screen.getByLabelText('מחיר לאחר הנחה ליחידה 1')).toHaveValue(5);
 expect(api.mapShoppingProduct).not.toHaveBeenCalled();expect(api.confirmShoppingReceipt).not.toHaveBeenCalled();
});
