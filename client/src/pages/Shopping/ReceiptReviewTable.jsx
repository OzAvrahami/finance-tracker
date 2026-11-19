import { Fragment, useState } from "react";
import ReceiptProductDetails from './ReceiptProductDetails';
import {projectPrice,priceBreakdown} from '../../../../shared/receiptPricing.mjs';

import { rowTotal } from "./receiptReviewMoney";
import {mappedQuantity} from '../../../../shared/shoppingQuantities.mjs';
import {allocateReceipt, receiptMatchesPlan} from '../../../../shared/shoppingReceiptMatching.mjs';
import { receiptRowConflicts } from './receiptReviewLinks';

const comparison = (row, fulfillment) => {
  const p = fulfillment.find(item => receiptMatchesPlan(row, item));
  if (!p) return "נוסף לתוכנית";
  return p.unresolved ? `תוכנן: ${p.quantity} ${p.unit} · התאמה או המרה חסרה`
    : `בתוכנית: ${p.purchased_quantity} מתוך ${p.quantity} ${p.unit}`;
};

function PlanLink({ row, index, plan, rows, onLink }) {
  const matches = plan.filter(item => receiptMatchesPlan(row, item));
  const current = matches.length === 1 && matches[0].list_item_id != null ? String(matches[0].list_item_id)
    : matches.length ? 'catalog' : '';
  return <label>פריט ברשימה<select aria-label={`פריט ברשימה ${index + 1}`} value={current}
    onChange={event => onLink(index, event.target.value || null)}>
    <option value="">ללא שיוך</option>
    {current === 'catalog' && <option value="catalog" disabled>שיוך לפי קטלוג</option>}
    {plan.filter(item => item.list_item_id != null).map(item => (
      <option key={item.list_item_id} value={item.list_item_id}
        disabled={rows.some(other => other.review_link?.confirmed && receiptMatchesPlan(other, item))}>
        {item.name}
      </option>
    ))}
  </select></label>;
}

export default function ReceiptReviewTable({
  mutationContext,
  rows,
  indices,
  plan,
  fulfillment = allocateReceipt(plan, rows),
  catalog,
  readOnly,
  onChange,
  onRemove,
  onAdd,
  onResolved,
  onMapped,
  onApproveName,
  onLinkRow,
  onShowPlan,
  rowPrefix,
  initialExpanded = null,
  listTypeId,
  merchant,
}) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const toggle = (i) => setExpanded(expanded === i ? null : i);
  const visibleIndices = indices ?? rows.map((_, index) => index);
  const headings = ["מוצר", "כמות", "יחידה", "מחיר מקורי ליחידה", "הנחה לשורה", "מחיר לאחר הנחה ליחידה", "סה״כ", "פעולות"];
  const cell = (row, i, key, label, { numeric = false, step } = {}) => {
    const missing = !["original_unit_price","row_discount"].includes(key) && !(key==='price' && priceBreakdown(row).final!==null) && (row[key] == null || String(row[key]).trim() === "");
    return (
      <input
        aria-label={`${label} ${i + 1}`}
        aria-invalid={missing || undefined}
        title={missing ? `${label} חסר` : undefined}
        className={numeric ? "receipt-number" : ""}
        type={numeric ? "number" : "text"}
        inputMode={numeric ? "decimal" : undefined}
        step={step}
        min={numeric ? (key === "quantity" ? "0.001" : "0") : undefined}
        value={row[key] ?? ""}
        placeholder="—"
        readOnly={readOnly}
        maxLength={numeric ? undefined : key === "name" ? 200 : 30}
        onChange={(e) => onChange(i, key, e.target.value)}
      />
    );
  };
  return (
    <>
      <div
        className="receipt-table-scroll"
        role="region"
        aria-label="פריטי הקבלה"
        tabIndex={0}
      >
        <table className="receipt-edit-table" dir="rtl">
          <thead>
            <tr>
              {headings.map(
                (t) => (
                  <th scope="col" key={t} title={t === "הנחה לשורה" ? "ההנחה עבור כל השורה, לא ליחידה" : undefined}>
                    {t}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {visibleIndices.map(i => {
              const row = projectPrice(rows[i]);
              const linked = onShowPlan ? plan.filter(item => receiptMatchesPlan(row, item)) : [];
              return <Fragment key={row.row_id??i}>
                <tr id={rowPrefix ? `${rowPrefix}-${i}` : undefined} tabIndex={rowPrefix ? -1 : undefined}>
                  <td className="receipt-product-cell">
                    {cell(row, i, "name", "שם מוצר")}
                    {onShowPlan && <div className="receipt-table-plan-link">
                      {linked.length ? linked.map((item, index) => <button type="button"
                        key={item.list_item_id ?? index} onClick={() => onShowPlan(item)}>{item.name}</button>)
                        : <small>ללא שיוך</small>}
                      {row.review_link?.confirmed && <span className="receipt-link-confirmed">שיוך מאושר</span>}
                    </div>}
                    {!readOnly&&row.resolved_product&&!row.resolved_product.owner_approved&&!row.owner_edited_fields?.includes('name')&&<span className="receipt-name-proposal" title={row.resolved_product.full_name}>
                      <span>{row.resolved_product.full_name}</span><button type="button" onClick={()=>onApproveName?.(i)}>אישור שם</button>
                    </span>}
                    {(row.overlap_uncertain ||
                      priceBreakdown(row).source_mismatch ||
                      receiptRowConflicts(row).length ||
                      !row.catalog_item_id) && (
                      <button
                        className="receipt-row-marker"
                        type="button"
                        tabIndex={-1}
                        onClick={() => toggle(i)}
                        aria-label={`בדיקת מקור והתאמה ${i + 1}`}
                        title={
                          row.overlap_uncertain
                            ? "חפיפה לא ודאית — הצגת מקור"
                            : "התאמה לקטלוג"
                        }
                      >
                        {row.overlap_uncertain
                          ? "חפיפה?"
                          : priceBreakdown(row).source_mismatch ? "פער מחיר"
                          : receiptRowConflicts(row).length
                            ? "סתירה"
                            : "התאמה"}
                      </button>
                    )}
                  </td>
                  <td data-label={headings[1]}>
                    {cell(row, i, "quantity", "כמות", {
                      numeric: true,
                      step: "0.001",
                    })}
                  </td>
                  <td data-label={headings[2]}>{cell(row, i, "unit", "יחידה")}</td>
                  <td data-label={headings[3]}>{cell(row,i,"original_unit_price","מחיר מקורי ליחידה",{numeric:true,step:"0.01"})}</td>
                  <td data-label={headings[4]}>{cell(row,i,"row_discount","הנחה לכל השורה",{numeric:true,step:"0.01"})}</td>
                  <td data-label={headings[5]}>
                    {cell({...row,price:priceBreakdown(row).net_unit_price}, i, "price", "מחיר לאחר הנחה ליחידה", {
                      numeric: true,
                      step: "0.01",
                    })}
                  </td>
                  <td className="receipt-line-total" data-label={headings[6]}>
                    <bdi dir="ltr">
                    {rowTotal(row)}
                    </bdi>
                  </td>
                  <td className="receipt-row-actions">
                    <button
                      type="button"
                      onClick={() => toggle(i)}
                      aria-expanded={expanded === i}
                      aria-label={`פרטי שורה ${i + 1}`}
                      title={readOnly ? 'פרטי שורה' : 'עריכה ופרטי שורה'}
                    >
                      ⋯
                    </button>
                    {!readOnly && !row.review_link?.confirmed && (
                      <button
                        type="button"
                        onClick={() => {
                          setExpanded(null);
                          onRemove(i);
                        }}
                        aria-label={`הסרת שורה ${i + 1}`}
                        title="הסרה"
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
                {expanded === i && (
                  <tr className="receipt-row-details">
                    <td colSpan={8}>
                      <div className="receipt-row-detail-content">
                      <span>שורה {i+1}</span>
                      <bdi>{row.row_id}</bdi>
                      {onLinkRow && !readOnly && !row.review_link?.confirmed && plan.some(item => item.list_item_id != null) &&
                        <PlanLink row={row} index={i} plan={plan} rows={rows} onLink={onLinkRow}/>}
                      {onLinkRow && !readOnly && <label>
                        סה״כ לשורה אחרי הנחה
                        {cell({ ...row, reviewed_line_total: Object.hasOwn(row, 'reviewed_line_total')
                          ? row.reviewed_line_total : priceBreakdown(row).final }, i,
                        'reviewed_line_total', 'סה״כ לשורה אחרי הנחה', { numeric: true, step: '0.01' })}
                      </label>}
                      <ReceiptProductDetails row={row} index={i} merchant={merchant} listTypeId={listTypeId} readOnly={readOnly} catalog={catalog} mutationContext={mutationContext}
                        onChange={(key,value)=>onChange(i,key,value)} onResolved={product=>onResolved?.(row.row_id??i,product)} onMapped={product=>onMapped?.(row.row_id??i,product)}/>
                      {!!row.mapping_snapshot?.personal_item_id&&<span>{mappedQuantity(row)?`${mappedQuantity(row).quantity} ${mappedQuantity(row).unit} עבור ${row.mapping_snapshot.personal_name}`:'המרת הכמות לפריט האישי אינה ידועה; כמויות הקבלה נשמרות.'}</span>}
                      {!Object.hasOwn(row,'reviewed_line_total') && row.price_basis==='line_discount' && priceBreakdown(row).net_unit_price==null && priceBreakdown(row).final!=null && <span>מחיר נטו ליחידה אינו מדויק בשתי ספרות; סכום השורה מחושב מהברוטו פחות ההנחה.</span>}
                      {priceBreakdown(row).conflict && <span role="alert">ההנחה גדולה מסכום הברוטו; נדרש תיקון.</span>}
                      {priceBreakdown(row).source_mismatch && <span role="status">הכמות ומחיר הנטו שנבחרו אינם תואמים לברוטו פחות ההנחה המודפסת. התיקון שלך נשמר; בדקו את קריאות המקור.</span>}
                      {row.raw_price && <span>מקור מודפס — מחיר מקורי: {row.raw_price.original_unit_price??'לא ידוע'} · ברוטו: {row.raw_price.gross_total??'לא ידוע'} · הנחה: {row.raw_price.discount??'לא ידועה'}{row.raw_price.discount_percent!=null?` · ${row.raw_price.discount_percent}%`:''} {row.raw_price.promotion??''}</span>}
                      {<label>
                        התאמה לקטלוג{" "}
                        <select
                          aria-label={`התאמה לקטלוג ${i + 1}`}
                          value={row.catalog_item_id ?? ""}
                          disabled={readOnly}
                          onChange={(e) =>
                            onChange(
                              i,
                              "catalog_item_id",
                              e.target.value || null,
                            )
                          }
                        >
                          <option value="">
                            ללא התאמה — לא ישפיע על הצעות
                          </option>
                          {!!row.suggested_personal_items?.length&&<optgroup label="התאמות מוצעות מהתוכנית">
                            {row.suggested_personal_items.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                          </optgroup>}
                          {catalog.filter(c=>!row.suggested_personal_items?.some(p=>String(p.id)===String(c.id))).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>}
                      {!readOnly&&row.match_requires_review&&!row.mapping_snapshot&&<span>התאמה מוצעת — תישמר רק באישור הקבלה.</span>}
                      <span>{comparison(row, fulfillment)}</span>
                      {!!row.possible_substitutions?.length && (
                        <span>
                          תחליף אפשרי: {row.possible_substitutions.join(", ")}
                        </span>
                      )}
                      {row.source_lines?.length ? (
                        <span>
                          מקור:{" "}
                          {row.source_lines
                            .map(
                              (s,index) => row.provenance?.[index]?.page_number
                                ? `קובץ ${row.provenance[index].file_number}, עמוד ${row.provenance[index].page_number}, שורה ${s.line_number}`
                                : `תמונה ${s.photo_number}, שורה ${s.line_number}`,
                            )
                            .join(" · ")}
                        </span>
                      ) : (
                        !!row.photo_numbers?.length && (
                          <span>
                            תמונות מקור: {row.photo_numbers.join(", ")}
                          </span>
                        )
                      )}
                      {!!row.possible_overlap_sources?.length && (
                        <span>
                          מקור חופף אפשרי:{" "}
                          {row.possible_overlap_sources
                            .map(
                              (s) =>
                                `תמונה ${s.photo_number}, שורה ${s.line_number}`,
                            )
                            .join(" · ")}
                        </span>
                      )}
                      {row.overlap_uncertain && (
                        <span>
                          ייתכן צילום חוזר של אותה שורה; השוו למקור לפני הסרה.
                        </span>
                      )}
                      {!!row.field_conflicts?.length && (
                        <span>
                          קריאות מקור (מחיר לפני הנחה):{" "}
                          {row.field_conflicts
                            .map(
                              (c) =>
                                `${{ quantity: "כמות", price: "מחיר", line_total: "סכום", discount: "הנחה", unit: "יחידה" }[c.field]} ${c.values.join(" / ")}`,
                            )
                            .join(" · ")}
                        </span>
                      )}
                      {!!row.resolved_conflicts?.length && (
                        <span>
                          כתיבי יחידה שקולים אוחדו:{" "}
                          {row.resolved_conflicts
                            .flatMap((c) => c.values)
                            .join(" / ")}
                        </span>
                      )}
                      {!!row.raw_unit_readings?.length && (
                        <span>
                          יחידה במקור: {row.raw_unit_readings.join(" / ")}
                        </span>
                      )}
                      {!!row.owner_edited_fields?.length && (
                        <span>
                          תוקן בבדיקה:{" "}
                          {row.owner_edited_fields
                            .map(
                              (f) =>
                                ({
                                  quantity: "כמות",
                                  price: "מחיר נטו",
                                  original_unit_price: "מחיר מקורי",
                                  row_discount: "הנחה לשורה",
                                  unit: "יחידה",
                                  name: "שם מוצר",
                                  catalog_item_id: "התאמה לקטלוג",
                                  reviewed_line_total: "סה״כ לשורה",
                                })[f],
                            )
                            .join(", ")}
                        </span>
                      )}
                      {row.line_total != null && (
                        <span>סכום שורה מודפס: ₪{row.line_total}</span>
                      )}
                      {row.discount === null && !row.owner_edited_fields?.includes("price") && (
                        <span>
                          ההנחה אינה ברורה בצילום; השלימו מחיר נטו לפי המקור.
                        </span>
                      )}
                      {row.discount && row.discount !== "0.00" && (
                        <span>
                          הנחה מודפסת: ₪{row.discount}
                          {row.price === null
                            ? " · נדרש מחיר נטו לבדיקה"
                            : " · המחיר בטבלה לאחר ההנחה"}
                        </span>
                      )}
                      {row.product_code && (
                        <span>קוד מוצר מודפס: {row.product_code}</span>
                      )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>;
            })}
          </tbody>
        </table>
        {!visibleIndices.length && (
          <p className="receipt-table-empty">
            {rows.length ? 'אין שורות בתצוגה הזו.' : 'אין פריטים לבדיקה. הוסיפו תמונות לסריקה.'}
          </p>
        )}
      </div>
      {!readOnly && onAdd && (
        <button type="button" className="receipt-add-row" onClick={onAdd}>
          + הוספת שורה
        </button>
      )}
    </>
  );
}
