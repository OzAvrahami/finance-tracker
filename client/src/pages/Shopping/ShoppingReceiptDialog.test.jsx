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
  getShoppingIntelligence: vi.fn(), getShoppingReceiptProgress:vi.fn(), moveShoppingReceipt:vi.fn(), getShoppingLists:vi.fn(), updateShoppingList:vi.fn(),
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
  context_token:'a'.repeat(32),store:'Market',current_items:[{list_item_id:'1',catalog_item_id:'1',name:'Milk',quantity:'1',unit:'unit'}],
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
      identity:{merchant:'Market',receipt_number:null,purchase_date:null},
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
it('compact receipt access keeps a waiting review visible without opening the dialog',async()=>{
  api.getShoppingIntelligence.mockResolvedValue({data:review});
  render(<ShoppingReceiptDialog list={list} compact onChanged={vi.fn()}/>);
  expect(await screen.findByText('הסריקה מוכנה לבדיקה')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'בדיקת קבלה'})).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(api.confirmShoppingReceipt).not.toHaveBeenCalled();
});
it('empty actual list blocks upload despite catalog entries',async()=>{
  await open({...base,current_items:[]});
  expect(screen.getByText(/הוסיפו לפחות פריט אחד/)).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'הוספת תמונות או PDF'})).toBeDisabled();
  add([photo('receipt.jpg')]);
  expect(screen.getByRole('button',{name:'סריקת התמונות'})).toBeDisabled();
  expect(api.uploadShoppingReceipt).not.toHaveBeenCalled();
});
it('receipt eligibility follows the first added item and its removal while the heading stays mounted',async()=>{
  api.getShoppingIntelligence.mockResolvedValue({data:{...base,current_items:[]}});
  const props={compact:true,onChanged:vi.fn()};
  const {rerender}=render(<ShoppingReceiptDialog {...props} list={{...list,shopping_list_items:[]}}/>);
  await waitFor(()=>expect(api.getShoppingIntelligence).toHaveBeenCalled());
  rerender(<ShoppingReceiptDialog {...props} list={{...list,shopping_list_items:[{id:1,custom_name:'Gift'}]}}/>);
  fireEvent.click(screen.getByRole('button',{name:'קבלות'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'הוספת תמונות או PDF'})).toBeEnabled());
  rerender(<ShoppingReceiptDialog {...props} list={{...list,shopping_list_items:[]}}/>);
  expect(screen.getByRole('button',{name:'הוספת תמונות או PDF'})).toBeDisabled();
  expect(api.uploadShoppingReceipt).not.toHaveBeenCalled();
});
it('ten images plus PDF retain ordering and a PDF preview without truncation',async()=>{
  await open();add(Array.from({length:10},(_,i)=>photo(`${i}.jpg`)));add([photo('receipt.pdf',20,'application/pdf')]);
  expect(screen.getAllByRole('img')).toHaveLength(10);
  expect(screen.getByLabelText('PDF 11')).toBeInTheDocument();
  expect(screen.getByText('נבחרו 11 מתוך 20 קבצים')).toBeInTheDocument();
});
it('merchant mismatch is prominent and acknowledgment is invalidated by merchant changes',async()=>{
  await open({...review,store:'KSP',receipt:{...review.receipt,extracted:{...review.receipt.extracted,identity:{merchant:'יוחננוף',receipt_number:null,purchase_date:null}}}});
  await screen.findByLabelText('שם מוצר 1');
  expect(screen.getByText('הקבלה שייכת לחנות אחרת')).toBeInTheDocument();
  expect(screen.getByText(/חנות הרשימה: KSP.*חנות בקבלה: יוחננוף/)).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/בדקתי את השורות/));
  expect(screen.getByRole('button',{name:'אישור להיסטוריה'})).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/בדקתי את החנויות/));
  expect(screen.getByRole('button',{name:'אישור להיסטוריה'})).toBeEnabled();
  fireEvent.change(screen.getByLabelText('בית עסק'),{target:{value:'שופרסל'}});
  expect(screen.getByLabelText(/בדקתי את החנויות/)).not.toBeChecked();
  expect(screen.getByRole('button',{name:'אישור להיסטוריה'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'בחירת רשימה קיימת אחרת'})).toBeInTheDocument();
});
beforeEach(() => {
  vi.resetAllMocks();
  api.getShoppingReceiptProgress.mockResolvedValue({data:{state:'extracting',progress:{stage:'extracting',completed:1,total:10}}});
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
  add([photo("bad.webp", 4, "image/webp")]);
  expect(screen.getByRole("alert")).toHaveTextContent("JPEG");
  expect(screen.getAllByRole("img")).toHaveLength(1);
  add(Array.from({ length: 20 }, (_, i) => photo(i + ".jpg")));
  expect(screen.getByRole("alert")).toHaveTextContent("מספר הקבצים");
  add([photo("huge.jpg", 20 * 1024 * 1024 + 1)]);
  expect(screen.getByRole("alert")).toHaveTextContent("מגבלת הגודל");
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
  expect(screen.getByRole("button", { name: "הוספת תמונות או PDF" })).toBeEnabled();
  add([photo("long-footer-file.jpg"), photo("long-header-file.jpg")]);
  expect(screen.getByText("נבחרו 2 מתוך 20 קבצים")).toBeInTheDocument();
  expect(
    screen.getByText("הקובץ הראשון צריך להציג את ראש הקבלה."),
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
    store:'סופר',
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
  expect(screen.getByRole("button", { name: "אישור להיסטוריה" })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', {name:'פרטי שורה 1'}));
  fireEvent.change(screen.getByLabelText('סה״כ לשורה אחרי הנחה 1'), {target:{value:'12.00'}});
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

it('shows all unconfirmed replacement rows, preserves approved links in both views and saves the review draft', async () => {
  const planned = [
    {list_item_id:'20',catalog_item_id:'1',name:'מלפפון',quantity:'1',unit:'ק״ג'},
    {list_item_id:'21',catalog_item_id:'2',name:'עגבנייה',quantity:'1',unit:'ק״ג'},
  ];
  const lines = [
    {row_id:'r1',name:'מלפפון חמוץ',quantity:'1',unit:'יח׳',price:'8.00',catalog_item_id:'1'},
    {row_id:'r2',name:'מלפפון טרי',quantity:'1',unit:'ק״ג',price:'5.90',product_code:'9000207',catalog_item_id:null},
    {row_id:'r3',name:'זיהוי לא מלא',quantity:'1',unit:'ק״ג',price:'7.10',catalog_item_id:null,
      suggested_personal_items:[{id:'2',name:'עגבנייה'}]},
  ];
  await open({...review,plan:planned,current_items:planned,reconciliation:{items:lines}});
  fireEvent.click(screen.getByRole('button',{name:'פריטי הרשימה'}));
  const cucumber = screen.getByText('מלפפון', {selector:'strong'}).closest('article');
  const tomato = screen.getByText('עגבנייה', {selector:'strong'}).closest('article');
  fireEvent.click(within(cucumber).getByRole('button',{name:'עריכה'}));
  const replacement = within(cucumber).getByRole('combobox',{name:'שורה מחליפה'});
  expect(within(replacement).getAllByRole('option')).toHaveLength(4);
  expect(within(replacement).getByRole('option',{name:/זיהוי לא מלא/})).toBeInTheDocument();
  expect(Array.from(replacement.querySelectorAll('optgroup'), group => group.label))
    .toEqual(['התאמות מוצעות','שורות זמינות']);
  const search = within(cucumber).getByLabelText('חיפוש שורת קבלה');
  for (const [query, name] of [['חמוץ', 'מלפפון חמוץ'], ['9000207','מלפפון טרי'], ['3','זיהוי לא מלא']]) {
    fireEvent.change(search, {target:{value:query}});
    expect(Array.from(replacement.options).slice(1).map(option => option.textContent.trim().split(' · ')[0])).toEqual([name]);
  }
  fireEvent.change(search, {target:{value:''}});
  fireEvent.change(replacement,{target:{value:'1'}});
  fireEvent.click(within(cucumber).getByRole('button',{name:'שמירה בטיוטה'}));
  expect(within(cucumber).queryByRole('button',{name:/מלפפון חמוץ/})).not.toBeInTheDocument();
  fireEvent.click(within(cucumber).getByRole('button',{name:'אשר שיוך'}));
  expect(within(cucumber).getByText('שיוך מאושר')).toBeInTheDocument();

  fireEvent.click(within(tomato).getByRole('button',{name:'עריכה'}));
  const tomatoOptions = within(tomato).getByRole('combobox',{name:'שורה לשיוך'});
  expect(within(tomatoOptions).getAllByRole('option')).toHaveLength(3);
  expect(tomatoOptions.options[1].textContent).toContain('זיהוי לא מלא');
  expect(tomatoOptions.options[1].parentElement.label).toBe('התאמות מוצעות');
  expect(within(tomatoOptions).queryByRole('option',{name:/מלפפון טרי/})).not.toBeInTheDocument();
  fireEvent.change(within(tomato).getByLabelText('חיפוש שורת קבלה'),{target:{value:'9000207'}});
  expect(within(tomatoOptions).getByRole('option',{name:'אין תוצאות בשורות הזמינות'})).toBeInTheDocument();
  fireEvent.click(within(cucumber).getByRole('button',{name:/מלפפון טרי.*שורת קבלה 2/}));
  expect(screen.getByLabelText('שם מוצר 2')).toHaveValue('מלפפון טרי');
  expect(screen.getByText('שיוך מאושר')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'שמירת טיוטה'}));
  await waitFor(() => expect(api.saveShoppingReceiptDraft).toHaveBeenCalledWith(1, expect.objectContaining({
    draft: expect.objectContaining({ items: [
      expect.objectContaining({ review_link:{list_id:'1',list_item_id:null,confirmed:false} }),
      expect.objectContaining({ review_link:{list_id:'1',list_item_id:'20',confirmed:true} }),
      expect.objectContaining({row_id:'r3'}),
    ] }),
  })));
  expect(api.confirmShoppingReceipt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'פריטי הרשימה'}));
  fireEvent.click(screen.getByRole('button',{name:'בטל אישור'}));
  const other = screen.getByText('עגבנייה', {selector:'strong'}).closest('article');
  fireEvent.click(within(other).getByRole('button',{name:'עריכה'}));
  expect(within(other).getByRole('option',{name:/מלפפון טרי/})).toBeInTheDocument();
});

it('dedicated page corrects an evidenced line, keeps an extra purchase and only exits after a successful draft save', async () => {
  const rows = [
    {row_id:'tuna',name:'טונה',quantity:'2',unit:'יחידה',price:'30.00',line_total:'60.00',discount:'30.00'},
    {row_id:'oil',name:'שמן זית',quantity:'1',unit:'יחידה',price:'19.90',match_requires_review:true},
  ];
  const data = {...review, receipt:{...review.receipt,extracted:{...review.receipt.extracted,receipt_total:'49.90'}}, reconciliation:{items:rows}};
  api.getShoppingIntelligence.mockResolvedValue({data});
  api.saveShoppingReceiptDraft.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({data:{revision:1}});
  const exit = vi.fn();
  render(<ShoppingReceiptDialog list={list} onExit={exit} onChanged={vi.fn()}/>);
  await screen.findByRole('button',{name:'לטיפול 1'});
  for (const [label, value] of [['ברוטו לשורה','₪60.00'], ['הנחה לשורה','₪30.00'], ['נטו לשורה בקבלה','₪30.00']]) {
    expect(screen.getByText(label, {selector:'dt'}).nextElementSibling).toHaveTextContent(value);
  }
  expect(screen.queryByText('שמן זית')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'עדכון ל־₪30.00'}));
  expect(screen.getByRole('button',{name:'לטיפול 0'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'ביטול התיקון'}));
  fireEvent.click(screen.getByRole('button',{name:'עדכון ל־₪30.00'}));
  const save = screen.getByRole('button',{name:'שמירה ויציאה'});
  fireEvent.click(save);
  await screen.findByRole('alert');
  expect(exit).not.toHaveBeenCalled();
  fireEvent.click(save);
  await waitFor(()=>expect(exit).toHaveBeenCalledWith(1));
  expect(api.saveShoppingReceiptDraft).toHaveBeenLastCalledWith(1,expect.objectContaining({
    draft:expect.objectContaining({items:[expect.objectContaining({reviewed_line_total:'30.00',line_total:'60.00'}), rows[1]]}),
  }));
  expect(api.confirmShoppingReceipt).not.toHaveBeenCalled();
});

it('approval with an unknown printed total still requires explicit duplicate review and acknowledgement', async () => {
  const candidate={receipt_id:'other',list_id:2,list_title:'רשימה ב',identity:{merchant:'Market',receipt_number:'123',purchase_date:'2026-11-10'}};
  api.getShoppingIntelligence.mockResolvedValue({data:{...review,duplicate_candidates:[candidate],
    reconciliation:{items:[{name:'שמן זית',quantity:'1',unit:'יחידה',price:'19.90'}]}}});
  render(<ShoppingReceiptDialog list={list} onExit={vi.fn()} onChanged={vi.fn()}/>);
  fireEvent.click(await screen.findByRole('button',{name:'מעבר לאישור'}));
  const approve = screen.getByRole('button',{name:'אישור להיסטוריה',exact:true});
  expect(screen.queryByText(/הסכום תואם לקבלה/)).not.toBeInTheDocument();
  expect(approve).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/בדקתי את השורות/));
  expect(approve).toBeDisabled();
  fireEvent.click(screen.getByText('קבלה דומה קיימת · נדרשת בדיקה לפני אישור'));
  fireEvent.click(screen.getByLabelText(/בדקתי את הרשימות המוצגות/));
  expect(approve).toBeEnabled();
  expect(api.confirmShoppingReceipt).not.toHaveBeenCalled();
});

it.each([
  ['missing', null, []],
  ['conflicting', '5.00', [{field:'discount',values:['0.00','5.00']}]],
])('leaves the source net unresolved with a %s line discount', async (_state, discount, field_conflicts) => {
  const row = {name:'טונה',quantity:'1',unit:'יחידה',price:null,line_total:'20.00',discount,field_conflicts};
  api.getShoppingIntelligence.mockResolvedValue({data:{...review, reconciliation:{items:[row]}}});
  render(<ShoppingReceiptDialog list={list} onExit={vi.fn()} onChanged={vi.fn()}/>);
  await screen.findByText('ברוטו לשורה');
  expect(screen.getByText('הנחה לשורה', {selector:'dt'}).nextElementSibling).toHaveTextContent('לא ידוע');
  expect(screen.queryByText('נטו לשורה בקבלה')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/עדכון ל־₪/})).not.toBeInTheDocument();
});

it.each([
  ['matched', '5.00', false, true],
  ['mismatched', '5.01', false, false],
  ['partial even when the subtotal matches', '5.00', true, false],
])('shows the appropriate approval summary for a %s total', async (_state, printed, partial, matched) => {
  const row = {name:'טונה', quantity:'1', unit:'יחידה', price:'5.00'};
  const items = partial ? [row, {...row, name:'שורה חסרה', price:null}] : [row];
  api.getShoppingIntelligence.mockResolvedValue({data:{...review, reconciliation:{items},
    receipt:{...review.receipt, extracted:{...review.receipt.extracted, receipt_total:printed}}}});
  render(<ShoppingReceiptDialog list={list} onExit={vi.fn()} onChanged={vi.fn()}/>);
  await screen.findByRole('heading', {name:'בדיקת קבלה'});
  fireEvent.click(within(screen.getByRole('navigation',{name:'שלבי הבדיקה'})).getByRole('button',{name:/אישור להיסטוריה/}));
  const approve = screen.getByRole('button',{name:'אישור להיסטוריה', exact:true});
  expect(approve).toBeDisabled();
  if (matched) {
    expect(screen.getByText(/הסכום תואם לקבלה/).nextElementSibling).toHaveTextContent('₪5.00');
    expect(screen.queryByText('פער בסכום')).not.toBeInTheDocument();
  } else {
    expect(screen.queryByText(/הסכום תואם לקבלה/)).not.toBeInTheDocument();
    expect(screen.getByText('פער בסכום')).toBeInTheDocument();
  }
  fireEvent.click(screen.getByLabelText(/בדקתי את השורות/));
  expect(approve.disabled).toBe(!matched);
});
