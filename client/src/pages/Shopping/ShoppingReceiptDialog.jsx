import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Dialog,
  ConfirmDialog,
  PrimaryButton,
  SecondaryButton,
  TextField,
} from "../../components/ui";
import ReceiptReviewTable from "./ReceiptReviewTable";
import {productInput} from './receiptProductInput';
import { receiptTotals } from "./receiptReviewMoney";
import {editPrice,projectPrice,priceBreakdown} from '../../../../shared/receiptPricing.mjs';
import ReceiptDuplicateWarning from "./ReceiptDuplicateWarning";
import {
  getShoppingIntelligence,
  getShoppingReceiptDuplicates,
  uploadShoppingReceipt,
  confirmShoppingReceipt,
  saveShoppingReceiptDraft,
  lookupShoppingProduct,
  approveShoppingProduct,
} from "../../services/api";
const emptyIdentity = () => ({
  merchant: null,
  receipt_number: null,
  purchase_date: null,
});
const localDate = () => new Date().toLocaleDateString("en-CA");
const messages = {
  receipt_provider_unconfigured:
    "סריקת קבלות טרם הוגדרה בשרת. אפשר לנסות שוב לאחר ההגדרה.",
  receipt_duplicate:
    "אחת התמונות כבר משויכת לרשימה אחרת. אין לאשר שוב את אותה קנייה.",
  receipt_duplicate_photo: "אותה תמונה נבחרה פעמיים. הסירו את העותק הכפול.",
  receipt_photo_count: "יש לבחור 1–6 תמונות JPEG/PNG של קבלה אחת.",
  receipt_photo_size: "כל תמונה עד 8 MiB, וכל התמונות יחד עד 24 MiB.",
  receipt_image_invalid: "יש לבחור תמונות JPEG או PNG תקינות.",
  receipt_stale:
    "הקבלה השתנתה במסך אחר. סגרו את הרשימה ופתחו אותה מחדש כדי לבדוק את הגרסה העדכנית.",
  receipt_reprocess_conflict:
    "בקשת הסריקה כבר שימשה לתמונות אחרות. פתחו מחדש את הקבלה לפני ניסיון נוסף.",
  receipt_processing: "הקבלה עדיין בעיבוד. המתינו לפני ניסיון נוסף.",
  receipt_attempt_limit:
    "מוצו חמשת ניסיונות הסריקה לרשימה. אין לאשר תוצאה ישנה; נדרשת בדיקה.",
  receipt_already_exists: "קבלה שאושרה אינה ניתנת להחלפה.",
  receipt_duplicate_review_required:
    "נמצאה קבלה נוספת מאז הבדיקה. בדקו כפילויות מחדש לפני אישור.",
  receipt_provider_configuration:
    "הגדרת ספק הסריקה אינה תקינה. נדרשת בדיקת מפתח, מודל ותמיכה בתמונות ובפלט מובנה בשרת.",
  receipt_provider_unavailable:
    "ספק הסריקה אינו זמין כרגע. התמונות והתיקונים נשמרו במסך; נסו שוב מאוחר יותר.",
  receipt_provider_timeout:
    "ספק הסריקה לא השיב בזמן. התמונות והתיקונים נשמרו; אפשר לנסות שוב.",
  receipt_provider_rate_limited:
    "ספק הסריקה הגביל את הבקשות. המתינו לפני ניסיון נוסף; ייתכן שנדרשת בדיקת מכסה.",
  receipt_rate_limited:
    "בוצעו יותר מדי ניסיונות סריקה. המתינו לפני ניסיון נוסף.",
  receipt_extraction_truncated:
    "תשובת הסריקה נקטעה לפני שהושלמה. זו אינה בהכרח בעיית צילום; נסו שוב, ואם התקלה חוזרת נדרשת בדיקת מגבלת הפלט בשרת.",
  receipt_provider_response_invalid:
    "ספק הסריקה החזיר תשובה בפורמט לא תקין. נסו שוב; אם התקלה חוזרת נדרשת בדיקת ספק הסריקה.",
  receipt_extraction_invalid:
    "תוצאת הספק לא עברה בדיקת נתונים. התמונות והתיקונים נשמרו; נסו שוב או העבירו את קוד האבחון לבדיקה.",
  receipt_currency_unsupported:
    "זוהה מטבע שאינו ILS. ניתן לסרוק קבלות בשקלים בלבד; אין המרת מטבע אוטומטית.",
  receipt_extraction_refused:
    "ספק הסריקה סירב לעבד את התמונות. ודאו שאלו תמונות קבלה בלבד; אם התקלה חוזרת נדרשת בדיקה.",
  receipt_no_readable_items:
    "לא זוהו פריטי קבלה בשקלים. ודאו שזו קבלה אחת ושהשורות גלויות וברורות בכל התמונות.",
  receipt_confirmation_conflict:
    "הקבלה כבר אושרה עם ערכים אחרים. אין לאשר שוב.",
};
function Photo({ file, index, total, onRemove, onMove, readOnly }) {
  const imageRef = useRef(null);
  useEffect(() => {
    const value = URL.createObjectURL(file);
    if (imageRef.current) imageRef.current.src = value;
    return () => URL.revokeObjectURL(value);
  }, [file]);
  return (
    <li className="shopping-receipt-photo">
      <img ref={imageRef} alt={`תמונה ${index + 1}: ${file.name}`} />
      <strong className="shopping-receipt-photo-number">
        תמונה {index + 1}
      </strong>
      <span className="shopping-receipt-filename" title={file.name} dir="auto">
        {file.name}
      </span>
      <div hidden={readOnly}>
        <SecondaryButton
          disabled={!index}
          onClick={() => onMove(index, -1)}
          aria-label={`הקדמת תמונה ${index + 1}`}
        >
          הקדמה
        </SecondaryButton>
        <SecondaryButton
          disabled={index === total - 1}
          onClick={() => onMove(index, 1)}
          aria-label={`העברת תמונה ${index + 1} אחורה`}
        >
          אחורה
        </SecondaryButton>
        <SecondaryButton
          onClick={() => onRemove(index)}
          aria-label={`הסרת תמונה ${index + 1}`}
        >
          הסרה
        </SecondaryButton>
      </div>
    </li>
  );
}
export default function ShoppingReceiptDialog({ list, onChanged }) {
  const [open, setOpen] = useState(false),
    [data, setData] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [files, setFiles] = useState([]),
    [photosChanged, setPhotosChanged] = useState(false),
    [dirty, setDirty] = useState(false),
    [tab, setTab] = useState("upload");
  const [scanState, setScanState] = useState("idle");
  const fileInput = useRef(null);
  const pendingScan = useRef(null),
    running = useRef(false);
  const [rows, setRows] = useState([]),
    [date, setDate] = useState(localDate),
    [reviewed, setReviewed] = useState(false),
    [identity, setIdentity] = useState(emptyIdentity);
  const [duplicates, setDuplicates] = useState([]),
    [duplicateReviewed, setDuplicateReviewed] = useState(false),
    [identityChecked, setIdentityChecked] = useState(true);
  const [details, setDetails] = useState(false);
  const [restoreDraft, setRestoreDraft] = useState(null);
  const [closing, setClosing] = useState(false),
    [replacing, setReplacing] = useState(false);
  const entry = useRef(null),
    titleFocus = useRef(null);
  const draftRevision = useRef(0);
  const lookupQueue=useRef(false);
  const [looking,setLooking]=useState(false),[lookupSummary,setLookupSummary]=useState('');
  useEffect(()=>()=>{lookupQueue.current=false;},[]);
  const readData = async () => {
    const { data: next } = await getShoppingIntelligence(list.id);
    setData(next);
    draftRevision.current=next.receipt?.draft_revision??0;
    setRows(next.receipt?.confirmed?.items ?? next.reconciliation?.items ?? []);
    setIdentity(
      next.receipt?.confirmed?.identity ??
        next.receipt?.review_draft?.identity ?? next.receipt?.extracted?.identity ??
        emptyIdentity(),
    );
    setDuplicates(next.duplicate_candidates ?? []);
    setDuplicateReviewed(false);
    setIdentityChecked(true);
    setReviewed(false);
    setDate(
      next.receipt?.confirmed?.purchase_date ??
        next.receipt?.review_draft?.purchase_date ?? next.receipt?.extracted?.identity?.purchase_date ??
        localDate(),
    );
    return next;
  };
  useEffect(() => {
    let active = true;
    getShoppingIntelligence(list.id)
      .then(({ data: next }) => {
        if (active) {
          setData(next);
          draftRevision.current=next.receipt?.draft_revision??0;
          setRows(
            next.receipt?.confirmed?.items ?? next.reconciliation?.items ?? [],
          );
          setIdentity(
            next.receipt?.confirmed?.identity ??
              next.receipt?.review_draft?.identity ?? next.receipt?.extracted?.identity ??
              emptyIdentity(),
          );
          setDuplicates(next.duplicate_candidates ?? []);
          setDate(
            next.receipt?.confirmed?.purchase_date ??
              next.receipt?.review_draft?.purchase_date ?? next.receipt?.extracted?.identity?.purchase_date ??
              localDate(),
          );
          setTab(
            ["review", "confirmed"].includes(next.receipt?.state)
              ? "review"
              : "upload",
          );
        }
      })
      .catch(() => {
        if (active) setError("טעינת הקבלה נכשלה. פתחו את החלון כדי לנסות שוב.");
      });
    return () => {
      active = false;
    };
  }, [list.id]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function run(action) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      const code = e.response?.data?.diagnostic_id;
      const diagnostic =
        typeof code === "string" && /^[a-f0-9-]{36}$/i.test(code)
          ? ` קוד אבחון: ${code}`
          : "";
      setError(
        (messages[e.response?.data?.error] ??
          "הפעולה לא הושלמה. הטיוטה נשמרה במסך; אפשר לנסות שוב.") + diagnostic,
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  const change = (index, key, value) => {
    setRows((all) =>
      all.map((r, i) =>
        i === index
          ? ['quantity','price','original_unit_price','row_discount'].includes(key)
            ? editPrice(r,key,value)
            : {...r,[key]:value,owner_edited_fields:[...new Set([...(r.owner_edited_fields??[]),key])],
              ...(['lookup_code','identifier_kind','retailer_scope'].includes(key)?{resolved_product:null,commercial_product_id:null,mapping_snapshot:null,catalog_item_id:null}: {})}
          : r,
      ),
    );
    setReviewed(false);
    setDirty(true);
  };
  const resolveProduct = (index,product) => {
    setRows(all=>all.map((r,i)=>(typeof index==='string'?r.row_id!==index:i!==index)?r:{...r,original_name:r.original_name??r.name,
      resolved_product:product,name:!product.owner_approved||r.owner_edited_fields?.includes('name')?r.name:product.full_name}));
    setDirty(true);setReviewed(false);
  };
  const mapProduct=(index,product)=>{
    setRows(all=>all.map((r,i)=>(typeof index==='string'?r.row_id!==index:i!==index)?r:{...r,commercial_product_id:product.commercial_product_id,
      mapping_snapshot:product.mapping,catalog_item_id:product.mapping?.personal_item_id??null,resolved_product:{...product}}));
    setDirty(true);setReviewed(false);
    getShoppingIntelligence(list.id).then(({data:next})=>setData(previous=>({...previous,catalog:next.catalog}))).catch(()=>{});
  };
  const approveName=index=>run(async()=>{
    const row=rows[index],{data:product}=await approveShoppingProduct(productInput(row,identity.merchant,row.resolved_product.full_name));
    resolveProduct(index,product);
  });
  async function lookupNames() {
    if(lookupQueue.current)return;
    lookupQueue.current=true;setLooking(true);
    const keys=[...new Map(rows.filter(r=>r.lookup_code||r.product_code).map(r=>{const p=productInput(r,identity.merchant);return [JSON.stringify([p.kind,p.retailer_scope,p.code]),{code:p.code,kind:p.kind,retailer_scope:p.retailer_scope}];})).values()];
    let found=0,missing=0,failed=0,done=0;
    try {for(const key of keys) {
      if(!lookupQueue.current)break;
      try {
        const {data:result}=await lookupShoppingProduct(key);
        if(['rate_limited','pending'].includes(result.status)) {setLookupSummary('מגבלת חיפוש זמנית. התוצאות נשמרו; אפשר להמשיך בעוד דקה.');return;}
        if(result.status==='found') {
          found++;
          setRows(all=>all.map(r=>{const p=productInput(r,identity.merchant);return p.code===key.code&&p.kind===key.kind&&p.retailer_scope===key.retailer_scope?
            {...r,resolved_product:result.product,name:result.product.owner_approved&&!r.owner_edited_fields?.includes('name')?result.product.full_name:r.name}:r;}));
          setDirty(true);setReviewed(false);
        } else if(['missing','invalid_identifier'].includes(result.status))missing++;else failed++;
      } catch {failed++;}
      done++;setLookupSummary(`${done}/${keys.length} קודים · נמצאו ${found} · ללא התאמה ${missing} · כשל ${failed}`);
      if(done<keys.length)await new Promise(resolve=>setTimeout(resolve,5500));
    }}finally{lookupQueue.current=false;setLooking(false);}
  }
  const saveDraft = async () => {
    if(data?.receipt?.state!=='review') return;
    const draft={items:rows,identity,purchase_date:date};
    const {data:result}=await saveShoppingReceiptDraft(list.id,{attempt:data.receipt.attempts,revision:draftRevision.current,draft});
    draftRevision.current=result.revision;
    setData(previous=>({...previous,receipt:{...previous.receipt,review_draft:draft,draft_revision:result.revision}}));
    setDirty(false);
  };
  const changeIdentity = (key, value) => {
    setIdentity((v) => ({ ...v, [key]: value || null }));
    setIdentityChecked(false);
    setDuplicateReviewed(false);
    setDirty(true);
  };
  const checkDuplicates = async () => {
    const result = await getShoppingReceiptDuplicates(list.id, { identity });
    setDuplicates(result.data);
    setDuplicateReviewed(false);
    setIdentityChecked(true);
  };
  const setPhotos = (next) => {
    pendingScan.current = null;
    setFiles(next);
    setPhotosChanged(true);
    setReviewed(false);
    setDirty(true);
  };
  function addPhotos(event) {
    const additions = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!additions.length) return;
    const next = [...files, ...additions];
    if (next.length > 6) {
      setError(messages.receipt_photo_count);
      return;
    }
    if (next.some((f) => !["image/jpeg", "image/png"].includes(f.type))) {
      setError(messages.receipt_image_invalid);
      return;
    }
    if (
      next.some((f) => f.size > 8 * 1024 * 1024) ||
      next.reduce((n, f) => n + f.size, 0) > 24 * 1024 * 1024
    ) {
      setError(messages.receipt_photo_size);
      return;
    }
    setError("");
    setPhotos(next);
  }
  const movePhoto = (i, delta) => {
    const next = [...files];
    [next[i], next[i + delta]] = [next[i + delta], next[i]];
    setPhotos(next);
  };
  const scan = (reprocess = false) =>
    run(async () => {
      setScanState("scanning");
      setReviewed(false);
      try {
        if (!pendingScan.current)
          pendingScan.current = {
            attempt: data?.receipt?.attempts ?? 0,
            options: {
              draft_revision:draftRevision.current,
              ...(reprocess ? { reprocess_key: crypto.randomUUID() } : {}),
              review_draft: {
                items: rows,
                identity,
                purchase_date: date,
              },
            },
          };
        const response = await uploadShoppingReceipt(
          list.id,
          files,
          pendingScan.current.attempt,
          pendingScan.current.options,
        );
        if (response.data?.state === "extracting")
          throw { response: { data: { error: "receipt_processing" } } };
        if (response.data?.state === "failed")
          throw { response: { data: { error: "receipt_extraction_invalid" } } };
        pendingScan.current = null;
        await readData();
        setScanState("succeeded");
        setPhotosChanged(false);
        setDirty(false);
        setTab("review");
      } catch (error) {
        setScanState("failed");
        if (
          error.response?.data?.error &&
          error.response.data.error !== "receipt_processing"
        )
          pendingScan.current = null;
        // Refresh only the server revision, never discard the user's correction draft.
        try {
          const { data: latest } = await getShoppingIntelligence(list.id);
          setData(latest);
        } catch {
          /* A same-set retry remains safe; changed sets fail closed as stale. */
        }
        throw error;
      }
    });
  const canConfirm =
    data?.receipt?.state === "review" &&
    !busy &&
    !photosChanged &&
    !["scanning", "failed"].includes(scanState) &&
    reviewed &&
    identityChecked &&
    (!duplicates.length || duplicateReviewed) &&
    rows.length > 0 &&
    !(data?.receipt?.extracted?.receipt_adjustments?.length) &&
    rows.every(
      (r) =>
        priceBreakdown(r).final!==null &&
        r.quantity !== null &&
        r.quantity !== "" &&
        Number(r.quantity) > 0 &&
        !!r.unit?.trim(),
    );
  const confirm = () =>
    run(async () => {
      await confirmShoppingReceipt(list.id, {
        purchase_date: date,
        reviewed: true,
        extraction_attempt: data.receipt.attempts,
        draft_revision:draftRevision.current,
        items: rows,
        ...(Object.values(identity).some(Boolean) ? { identity } : {}),
        ...(duplicates.length
          ? { duplicate_reviewed_ids: duplicates.map((c) => c.receipt_id) }
          : {}),
      });
      await readData();
      setDirty(false);
      await onChanged();
    });
  const close = () => {
    lookupQueue.current=false;
    if (busy) return;
    if (dirty) setClosing(true);
    else setOpen(false);
  };
  const previousDraft =
    photosChanged ||
    ["scanning", "failed"].includes(scanState) ||
    data?.receipt?.state === "failed";
  const incompleteTotal = rows.some(
    (r) =>
      priceBreakdown(r).final==null ||
      r.quantity == null ||
      r.quantity === "",
  );
  const { total, discrepancy } = receiptTotals(
    rows,
    data?.receipt?.extracted?.receipt_total,
  );
  return (
    <section className="shopping-receipt-summary" dir="rtl" aria-label="קבלה">
      <div>
        <strong>קבלה מול התוכנית</strong>
        <p>
          {dirty
            ? "שינויים שטרם נשמרו — שמרו טיוטה לפני יציאה"
            : data?.receipt?.state === "confirmed"
              ? "הקנייה אושרה להיסטוריה — ההוצאה נוצרת בנפרד בסגירת קנייה"
              : data?.receipt?.state === "review"
                ? "הסריקה מוכנה לבדיקה"
                : "תמונות של קבלה אחת, בדיקה ואישור בנפרד מהוצאה"}
        </p>
      </div>
      <SecondaryButton
        ref={entry}
        onClick={() => {
          setOpen(true);
          if (!data) run(readData);
        }}
      >
        {data?.receipt?.extracted ? "בדיקת קבלה" : "סריקת קבלה"}
      </SecondaryButton>
      <Dialog
        open={open}
        onClose={close}
        title="בדיקת קבלה"
        description="אישור להיסטוריה בלבד · הוצאה נוצרת בסגירת קנייה"
        size="lg"
        className="shopping-receipt-dialog"
        returnFocusRef={entry}
        initialFocusRef={titleFocus}
        closeDisabled={busy}
        footer={
          <>
            <div aria-live="polite">
              {!rows.length ? (
                "אין עדיין תוצאת סריקה תקפה"
              ) : (
                <>
                  {previousDraft
                    ? "טיוטה קודמת — לא הסריקה הנוכחית"
                    : data?.receipt?.state === "confirmed"
                      ? "סכום הקנייה השמורה"
                      : "סה״כ פריטים"}
                  : ₪{total}
                  {!previousDraft && discrepancy && (
                    <small className="receipt-discrepancy">{discrepancy}</small>
                  )}
                  {incompleteTotal ? " · חלקי" : ""}
                </>
              )}
            </div>
            <SecondaryButton disabled={busy} onClick={close}>
              סגירה
            </SecondaryButton>
            {data?.receipt?.state==='review' && <SecondaryButton disabled={busy||!dirty||photosChanged} onClick={()=>run(saveDraft)}>שמירת טיוטה</SecondaryButton>}
            {data?.receipt?.state !== "confirmed" && tab === "review" && (
              <SecondaryButton
                disabled={busy}
                onClick={() => {
                  setTab("upload");
                  setError("בחרו את כל תמונות הקבלה, ואז אשרו סריקה מחדש.");
                }}
              >
                סריקה מחדש
              </SecondaryButton>
            )}
            {data?.receipt?.state !== "confirmed" &&
              (tab === "upload" ? (
                <PrimaryButton
                  disabled={busy || !files.length}
                  onClick={() => {
                    if (data?.receipt?.state === "review") setReplacing(true);
                    else scan();
                  }}
                >
                  סריקת התמונות
                </PrimaryButton>
              ) : (
                <PrimaryButton disabled={!canConfirm} onClick={confirm}>
                  אישור להיסטוריה
                </PrimaryButton>
              ))}
          </>
        }
      >
        <div dir="rtl">
          <div className="shopping-receipt-tabs">
            <SecondaryButton
              ref={titleFocus}
              aria-pressed={tab === "upload"}
              onClick={() => setTab("upload")}
            >
              תמונות הקבלה
            </SecondaryButton>
            <SecondaryButton
              aria-pressed={tab === "review"}
              onClick={() => setTab("review")}
            >
              בדיקת פריטים
            </SecondaryButton>
          </div>
          {busy && <p role="status">מעבד… אין לסגור עד לסיום.</p>}
          {error && (
            <Alert variant="error" urgent>
              {error}
            </Alert>
          )}
          <fieldset className="shopping-receipt-fields" disabled={busy}>
            {tab === "upload" && (
              <div>
                <p className="shopping-receipt-order-guide">
                  <strong>תמונה 1 צריכה להציג את ראש הקבלה.</strong> המשיכו לפי
                  הסדר עד התחתית. המספרים קובעים את סדר השליחה; במחשב מתחילים
                  מימין. הקדמה מעבירה למספר קטן יותר.
                </p>
                <p>
                  צלמו את הקבלה לפי הסדר מלמעלה למטה. אפשר חפיפה קטנה בין
                  התמונות. 1–6 תמונות JPEG/PNG, עד 8 MiB לתמונה ו־24 MiB יחד.
                  התמונות נשלחות לספק זיהוי חיצוני.
                </p>
                {data?.receipt?.state !== "confirmed" && (
                  <div className="shopping-receipt-upload">
                    <input
                      ref={fileInput}
                      hidden
                      aria-label="הוספת תמונות קבלה"
                      type="file"
                      accept="image/jpeg,image/png"
                      multiple
                      onChange={addPhotos}
                    />
                    <SecondaryButton onClick={() => fileInput.current?.click()}>
                      הוספת תמונות
                    </SecondaryButton>
                    <span role="status" aria-live="polite">
                      נבחרו {files.length} מתוך 6 תמונות
                    </span>
                  </div>
                )}
                <ol className="shopping-receipt-photos">
                  {files.map((file, i) => (
                    <Photo
                      key={`${i}-${file.name}`}
                      file={file}
                      readOnly={data?.receipt?.state === "confirmed"}
                      index={i}
                      total={files.length}
                      onMove={movePhoto}
                      onRemove={(n) =>
                        setPhotos(files.filter((_, j) => j !== n))
                      }
                    />
                  ))}
                </ol>
                {!files.length && data?.receipt && (
                  <p>
                    התמונות אינן נשמרות בשרת. נסרקו{" "}
                    {data.receipt.image_hashes?.length ?? 1} תמונות; לתיקון סדרת
                    הצילומים יש לבחור מחדש את כל התמונות.
                  </p>
                )}
                {photosChanged && data?.receipt?.extracted && (
                  <Alert>
                    סדרת התמונות השתנתה. התוצאה הקודמת אינה ניתנת לאישור עד
                    לסריקה חדשה. סריקה חדשה תחליף את תיקוני הטיוטה רק לאחר
                    אישורכם.
                  </Alert>
                )}
              </div>
            )}
            {tab === "review" && data && (
              <div className="receipt-review-workspace">
                <div className="receipt-review-toolbar">
                  <input
                    aria-label="בית עסק"
                    placeholder="בית עסק"
                    value={identity.merchant ?? ""}
                    onChange={(e) => changeIdentity("merchant", e.target.value)}
                    readOnly={data.receipt?.state === "confirmed"}
                  />
                  <input
                    aria-label="תאריך הקנייה בפועל"
                    type="date"
                    value={date}
                    onChange={(e) => {
                      setDate(e.target.value);
                      setReviewed(false);
                      setDirty(true);
                    }}
                    readOnly={data.receipt?.state === "confirmed"}
                  />
                  <SecondaryButton
                    aria-expanded={details}
                    onClick={() => setDetails(!details)}
                  >
                    פרטי קבלה
                  </SecondaryButton>
                </div>
                {details && (
                  <div className="receipt-secondary-details">
                    {data.receipt?.extracted?.extraction_run && (
                      <small>
                        מודל: {data.receipt.extracted.extraction_run.model} ·
                        ניסיון {data.receipt.attempts}/5
                      </small>
                    )}
                    {data.receipt?.state !== "confirmed" &&
                      data.receipt?.previous_drafts?.map((b) => (
                        <SecondaryButton
                          key={b.attempt}
                          onClick={() => setRestoreDraft(b)}
                        >
                          שחזור טיוטה מניסיון {b.attempt}
                        </SecondaryButton>
                      ))}
                    <div className="shopping-smart-grid">
                      <TextField
                        label="מספר קבלה מודפס"
                        value={identity.receipt_number ?? ""}
                        onValueChange={(v) =>
                          changeIdentity("receipt_number", v)
                        }
                        disabled={data.receipt?.state === "confirmed"}
                      />
                      <TextField
                        label="תאריך מודפס בקבלה"
                        type="date"
                        value={identity.purchase_date ?? ""}
                        onValueChange={(v) =>
                          changeIdentity("purchase_date", v)
                        }
                        disabled={data.receipt?.state === "confirmed"}
                      />
                    </div>
                    <p>
                      המזהים המודפסים משמשים לבדיקת כפילות; תאריך הקנייה לאישור
                      נפרד.
                    </p>
                    {data.receipt?.extracted?.receipt_total && (
                      <p>סה״כ מודפס: ₪{data.receipt.extracted.receipt_total}</p>
                    )}
                    {!!data.receipt?.extracted?.receipt_adjustments?.length && <div role="alert">התאמות לכל הקבלה — לא חולקו לפריטים ולא נכללות בסכום הטבלה. יש להסדירן לפני אישור להיסטוריה.
                      {data.receipt.extracted.receipt_adjustments.map((a,i)=><p key={i}>{a.description}: {a.amount??'לא ידוע'}</p>)}
                    </div>}
                    {!!data.receipt?.extracted?.overlap_resolution
                      ?.merged_count && (
                      <p>
                        חפיפה אוחדה אוטומטית:{" "}
                        {data.receipt.extracted.overlap_resolution.merged_count}{" "}
                        שורות צילום חוזרות.
                      </p>
                    )}
                    <details>
                      <summary>
                        התוכנית המקורית · {(data.plan ?? []).length} פריטים
                      </summary>
                      <ul>
                        {(data.plan ?? []).map((p, i) => (
                          <li key={i}>
                            {p.name}: {p.quantity} {p.unit}
                          </li>
                        ))}
                      </ul>
                      <p>פריט שלא זוהה אינו בהכרח פריט שלא נקנה.</p>
                    </details>
                    {!!data.receipt?.extracted?.overlap_warnings?.length && (
                      <details>
                        <summary>הערות מקור</summary>
                        <ul>
                          {data.receipt.extracted.overlap_warnings.map(
                            (w, i) => (
                              <li key={i}>{w}</li>
                            ),
                          )}
                        </ul>
                      </details>
                    )}
                  </div>
                )}
                {!identityChecked && (
                  <div className="receipt-context-action">
                    מזהי הקבלה השתנו.{" "}
                    <button type="button" onClick={() => run(checkDuplicates)}>
                      בדיקת כפילויות
                    </button>
                  </div>
                )}
                {duplicates.length > 0 && (
                  <details className="receipt-duplicate-details">
                    <summary>קבלה דומה קיימת · נדרשת בדיקה לפני אישור</summary>
                    <ReceiptDuplicateWarning
                      candidates={duplicates}
                      checked={duplicateReviewed}
                      onChange={setDuplicateReviewed}
                    />
                  </details>
                )}
                {data.receipt?.state!=='confirmed'&&<div className="receipt-lookup-toolbar">
                  <button type="button" disabled={busy||looking||!rows.length} onClick={lookupNames}>איתור שמות מוצרים</button>
                  {looking&&<button type="button" onClick={()=>{lookupQueue.current=false;}}>עצירת איתור</button>}
                  {!!lookupSummary&&<span role="status">{lookupSummary}</span>}
                </div>}
                <ReceiptReviewTable
                  rows={rows}
                  plan={data.plan ?? []}
                  catalog={data.catalog ?? []}
                  readOnly={data.receipt?.state === "confirmed"}
                  merchant={identity.merchant}
                  listTypeId={list.list_type_id}
                  onResolved={resolveProduct}
                  onMapped={mapProduct}
                  onApproveName={approveName}
                  onChange={change}
                  onRemove={(i) => {
                    setRows(rows.filter((_, j) => j !== i));
                    setReviewed(false);
                    setDirty(true);
                  }}
                  onAdd={() => {
                    setRows([
                      ...rows,
                      {
                        row_id:crypto.randomUUID(),
                        name: "",
                        quantity: "1",
                        unit: "יח׳",
                        price: null,
                        catalog_item_id: null,
                      },
                    ]);
                    setReviewed(false);
                    setDirty(true);
                  }}
                />
                {data.receipt?.state !== "confirmed" && (
                  <label className="receipt-confirm-check">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      onChange={(e) => {
                        setReviewed(e.target.checked);
                        setDirty(true);
                      }}
                    />
                    בדקתי את השורות; הקנייה לא אושרה ברשימה אחרת
                  </label>
                )}
              </div>
            )}
          </fieldset>
        </div>
      </Dialog>
      <ConfirmDialog
        open={closing}
        onClose={() => setClosing(false)}
        title="סגירה עם טיוטה לא מאושרת"
        message="התיקונים יישמרו כטיוטה ללא אישור להיסטוריה וללא הוצאה. תמונות שטרם נסרקו נשמרות רק במסך."
        confirmLabel="שמירת טיוטה וסגירה"
        cancelLabel="המשך בדיקה"
        onConfirm={() => run(async()=>{await saveDraft();setClosing(false);setOpen(false);})}
      />
      <ConfirmDialog
        open={!!restoreDraft}
        onClose={() => setRestoreDraft(null)}
        title="שחזור טיוטה קודמת"
        message="הטיוטה השמורה תחליף את העריכות במסך בלבד. הסריקה החדשה תישאר שמורה. בדקו מחדש לפני אישור להיסטוריה."
        confirmLabel="שחזור הטיוטה"
        cancelLabel="ביטול"
        onConfirm={() => {
          const d = restoreDraft.review_draft;
          setRows((d?.items ?? restoreDraft.extracted?.items ?? []).map(projectPrice));
          setIdentity(
            d?.identity ?? restoreDraft.extracted?.identity ?? emptyIdentity(),
          );
          setDate(d?.purchase_date ?? date);
          setDirty(true);
          setReviewed(false);
          setIdentityChecked(false);
          setDuplicateReviewed(false);
          setRestoreDraft(null);
          setTab("review");
          setError("שוחזרה טיוטה קודמת. בדקו את השורות מול הסריקה הנוכחית.");
        }}
      />
      <ConfirmDialog
        open={replacing}
        onClose={() => setReplacing(false)}
        title="סריקה מחדש של הקבלה"
        message="הסריקה תשתמש במודל הנוכחי ותצרוך ניסיון נוסף (עד 5). התוצאה והתיקונים הנוכחיים יישמרו לשחזור בפרטי הקבלה. יש לבחור שוב את כל התמונות לפי סדרן."
        confirmLabel="סריקה מחדש"
        cancelLabel="שמירת התיקונים"
        onConfirm={() => {
          setReplacing(false);
          scan(true);
        }}
      />
    </section>
  );
}
