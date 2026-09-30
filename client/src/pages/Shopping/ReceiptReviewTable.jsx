import { Fragment, useState } from "react";
import ReceiptProductDetails from './ReceiptProductDetails';
import {projectPrice,priceBreakdown} from '../../../../shared/receiptPricing.mjs';

import { rowTotal } from "./receiptReviewMoney";
import {mappedQuantity,aggregatePlanning} from '../../../../shared/shoppingQuantities.mjs';
const targetField = (field) =>
  ["discount", "line_total"].includes(field) ? "price" : field;
const unresolved = (row) =>
  (row.field_conflicts ?? []).filter(
    (c) => !row.owner_edited_fields?.includes(targetField(c.field)) &&
      !(c.field==='discount' && row.owner_edited_fields?.includes('row_discount')) &&
      !(['price','line_total'].includes(c.field) && row.owner_edited_fields?.includes('original_unit_price')),
  );
const comparison = (row, plan, rows) => {
  const p = plan.find(
    (item) =>
      row.catalog_item_id &&
      String(item.catalog_item_id) === String(row.catalog_item_id),
  );
  if (!p) return "נוסף לתוכנית";
  const sum=aggregatePlanning(rows,p);
  return sum.unresolved ? `תוכנן: ${p.quantity} ${p.unit} · המרה חסרה`
    : `בתוכנית: ${sum.quantity} מתוך ${p.quantity} ${p.unit}`;
};
export default function ReceiptReviewTable({
  rows,
  plan,
  catalog,
  readOnly,
  onChange,
  onRemove,
  onAdd,
  onResolved,
  onMapped,
  onApproveName,
  listTypeId,
  merchant,
}) {
  const [expanded, setExpanded] = useState(null);
  const toggle = (i) => setExpanded(expanded === i ? null : i);
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
              {["מוצר", "כמות", "יחידה", "מחיר מקורי ליחידה", "הנחה לשורה", "מחיר לאחר הנחה ליחידה", "סה״כ", "פעולות"].map(
                (t) => (
                  <th scope="col" key={t} title={t === "הנחה לשורה" ? "ההנחה עבור כל השורה, לא ליחידה" : undefined}>
                    {t}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(projectPrice).map((row, i) => (
              <Fragment key={row.row_id??i}>
                <tr>
                  <td className="receipt-product-cell">
                    {cell(row, i, "name", "שם מוצר")}
                    {row.resolved_product&&!row.resolved_product.owner_approved&&!row.owner_edited_fields?.includes('name')&&<span className="receipt-name-proposal" title={row.resolved_product.full_name}>
                      <span>{row.resolved_product.full_name}</span><button type="button" onClick={()=>onApproveName?.(i)}>אישור שם</button>
                    </span>}
                    {(row.overlap_uncertain ||
                      priceBreakdown(row).source_mismatch ||
                      unresolved(row).length ||
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
                          : unresolved(row).length
                            ? "סתירה"
                            : "התאמה"}
                      </button>
                    )}
                  </td>
                  <td>
                    {cell(row, i, "quantity", "כמות", {
                      numeric: true,
                      step: "0.001",
                    })}
                  </td>
                  <td>{cell(row, i, "unit", "יחידה")}</td>
                  <td>{cell(row,i,"original_unit_price","מחיר מקורי ליחידה",{numeric:true,step:"0.01"})}</td>
                  <td>{cell(row,i,"row_discount","הנחה לכל השורה",{numeric:true,step:"0.01"})}</td>
                  <td>
                    {cell({...row,price:priceBreakdown(row).net_unit_price}, i, "price", "מחיר לאחר הנחה ליחידה", {
                      numeric: true,
                      step: "0.01",
                    })}
                  </td>
                  <td className="receipt-line-total" dir="ltr">
                    {rowTotal(row)}
                  </td>
                  <td className="receipt-row-actions">
                    <button
                      type="button"
                      onClick={() => toggle(i)}
                      aria-expanded={expanded === i}
                      aria-label={`פרטי שורה ${i + 1}`}
                      title="פרטים"
                    >
                      ⋯
                    </button>
                    {!readOnly && (
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
                      <ReceiptProductDetails row={row} index={i} merchant={merchant} listTypeId={listTypeId} readOnly={readOnly} catalog={catalog}
                        onChange={(key,value)=>onChange(i,key,value)} onResolved={product=>onResolved?.(row.row_id??i,product)} onMapped={product=>onMapped?.(row.row_id??i,product)}/>
                      {!!row.mapping_snapshot?.personal_item_id&&<span>{mappedQuantity(row)?`${mappedQuantity(row).quantity} ${mappedQuantity(row).unit} עבור ${row.mapping_snapshot.personal_name}`:'המרת הכמות לפריט האישי אינה ידועה; כמויות הקבלה נשמרות.'}</span>}
                      {row.price_basis==='line_discount' && priceBreakdown(row).net_unit_price==null && priceBreakdown(row).final!=null && <span>מחיר נטו ליחידה אינו מדויק בשתי ספרות; סכום השורה מחושב מהברוטו פחות ההנחה.</span>}
                      {priceBreakdown(row).conflict && <span role="alert">ההנחה גדולה מסכום הברוטו; נדרש תיקון.</span>}
                      {priceBreakdown(row).source_mismatch && <span role="status">הכמות ומחיר הנטו שנבחרו אינם תואמים לברוטו פחות ההנחה המודפסת. התיקון שלך נשמר; בדקו את קריאות המקור.</span>}
                      {row.raw_price && <span>מקור מודפס — מחיר מקורי: {row.raw_price.original_unit_price??'לא ידוע'} · ברוטו: {row.raw_price.gross_total??'לא ידוע'} · הנחה: {row.raw_price.discount??'לא ידועה'}{row.raw_price.discount_percent!=null?` · ${row.raw_price.discount_percent}%`:''} {row.raw_price.promotion??''}</span>}
                      {!row.product_code&&!row.commercial_product_id&&<label>
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
                          {catalog.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>}
                      <span>{comparison(row, plan, rows)}</span>
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
                              (s) =>
                                `תמונה ${s.photo_number}, שורה ${s.line_number}`,
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
                                  catalog_item_id: "התאמה",
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
              </Fragment>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="receipt-table-empty">
            אין פריטים לבדיקה. הוסיפו תמונות לסריקה.
          </p>
        )}
      </div>
      {!readOnly && (
        <button type="button" className="receipt-add-row" onClick={onAdd}>
          + הוספת שורה
        </button>
      )}
    </>
  );
}
