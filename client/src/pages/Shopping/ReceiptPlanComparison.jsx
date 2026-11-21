import { useEffect, useRef, useState } from 'react';
import { PrimaryButton, SecondaryButton, TextField } from '../../components/ui';
import { planningUnitLabel } from '../../../../shared/shoppingEntryOptions.mjs';
import { receiptMatchesPlan } from '../../../../shared/shoppingReceiptMatching.mjs';
import { receiptReplacementOptions, receiptRowMatchesSearch } from './receiptReviewLinks';

const statusText = {
  full: 'נרכש במלואו',
  partial: 'נרכש חלקית',
  absent: 'לא נמצא בקבלה',
  unresolved: 'התאמה או המרת כמות לא פתורה',
};

function ReplacementPicker({ item, rows, plan, matches, adding, onAssign, onCancel }) {
  const picker = useRef(null);
  useEffect(() => { picker.current?.scrollIntoView?.({ block:'nearest' }); }, []);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [keepMatches, setKeepMatches] = useState(adding);
  const chosen = selected === '' ? null : rows[Number(selected)];
  const released = matches.filter(match => !match.row.review_link?.confirmed && match.index !== Number(selected));
  const previous = chosen && plan.find(p => p !== item && receiptMatchesPlan(chosen, p));
  const { suggested, available } = receiptReplacementOptions(rows, item, query, adding);
  const option = ({ row, index }) => {
    const previous = plan.find(p => receiptMatchesPlan(row, p));
    const assignment = previous === item ? ' · השורה המשויכת כרגע' : previous ? ` · משויך ל${previous.name}` : '';
    return <option key={row.row_id ?? index} value={index}>
      {row.name || 'שורה ללא שם'} · שורה {index + 1}{assignment}
    </option>;
  };
  return <div className="receipt-link-editor" ref={picker}>
    <strong>{item.name} · עריכת שיוך</strong>
    <div>השיוך הנוכחי: {matches.map(({row}) => row.name).join(' · ') || 'ללא שיוך'}</div>
    <div className="rr-picker-fields"><TextField label="חיפוש שורת קבלה" value={query} onValueChange={value => { setQuery(value); setSelected(''); }} />
    <label>
      {adding ? 'שורה נוספת' : matches.length ? 'שורה מחליפה' : 'שורה לשיוך'}
      <select value={selected} onChange={event => setSelected(event.target.value)}>
        <option value="">{suggested.length || available.length ? 'בחר שורה מהקבלה'
          : query.trim() ? 'אין תוצאות בשורות הזמינות' : 'אין שורות ללא שיוך מאושר'}</option>
        {!!suggested.length && <optgroup label="התאמות מוצעות">{suggested.map(option)}</optgroup>}
        {!!available.length && <optgroup label="שורות זמינות">{available.map(option)}</optgroup>}
      </select>
    </label></div>
    {!adding && chosen && released.length > 0 && <label className="receipt-keep-matches">
      <input type="checkbox" checked={keepMatches} onChange={e => setKeepMatches(e.target.checked)}/>שמירת השורות המשויכות בנוסף לשורה שנבחרה
    </label>}
    {chosen && <p role="status">בשמירה, {chosen.name} תשויך ל{item.name}.
      {previous && ` השיוך של שורה זו ל${previous.name} יוסר.`}
      {!keepMatches && released.length > 0 && ` יוסר השיוך של ${released.map(({row}) => row.name).join(' · ')}.`}
    </p>}
    <div className="receipt-plan-actions">
      <SecondaryButton onClick={onCancel}>ביטול</SecondaryButton>
      <PrimaryButton disabled={selected === ''} onClick={() => onAssign(Number(selected), keepMatches)}>שמירה בטיוטה</PrimaryButton>
    </div>
  </div>;
}

export default function ReceiptPlanComparison({
  fulfillment, rows, query, filter, activePlan, readOnly, onEdit, onAssign, onConfirm, onShowRow, rowPrefix,
}) {
  const visible = fulfillment.map((item, index) => ({
    item,
    key: item.list_item_id ?? `legacy:${index}`,
    matches: rows.flatMap((row, rowIndex) => receiptMatchesPlan(row, item) ? [{ row, index: rowIndex }] : []),
  })).filter(({ item, matches }) =>
    (item.name.toLowerCase().includes(query.trim().toLowerCase()) || matches.some(({row,index}) => receiptRowMatchesSearch(row,index,query))) &&
    (filter === 'all' || (filter === 'linked' && matches.length > 0) ||
      (filter === 'unlinked' && matches.length === 0) ||
      (filter === 'pending' && matches.some(({ row }) => !row.review_link?.confirmed)) ||
      (filter === 'confirmed' && matches.some(({ row }) => row.review_link?.confirmed))));

  const shownEditor = activePlan;
  const select = onEdit;

  return <section aria-label="פריטי הרשימה" className="receipt-plan-rows">
    <p role="status">{visible.length} מתוך {fulfillment.length} פריטים</p>
    {!visible.length && <p className="receipt-table-empty">אין פריטים בתצוגה הזו.</p>}
    {visible.map(({ item, key, matches }) => {
      const canReplace = !matches.length || matches.some(({ row }) => !row.review_link?.confirmed);
      const editable = !readOnly && item.list_item_id != null;
      const adding = shownEditor === `add-${key}`;
      return <article key={key} id={`${rowPrefix}-plan-${key}`} tabIndex={-1} className="receipt-plan-row">
        <div>
          <strong>{item.name}</strong>
          <p>תוכנן {item.quantity} {planningUnitLabel(item.unit)} · נרכשו {item.purchased_quantity} {planningUnitLabel(item.unit)} · {statusText[item.status]}</p>
        </div>
        <div className="receipt-plan-matches">
          {matches.length ? matches.map(({ row, index }) => (
            <div key={row.row_id ?? index} className="receipt-plan-match">
              <button type="button" className="receipt-text-action" onClick={() => onShowRow(index)}>
                {row.name || 'שורה ללא שם'} · שורת קבלה {index + 1}
              </button>
              <small>{row.quantity} {planningUnitLabel(row.unit)}{row.product_code && ` · מק״ט ${row.product_code}`}</small>
              {row.review_link?.confirmed && <span className="receipt-link-confirmed">שיוך מאושר</span>}
              {editable && shownEditor !== key && !adding && <SecondaryButton onClick={() => onConfirm(item, !row.review_link?.confirmed, index)}>
                {row.review_link?.confirmed ? 'בטל אישור' : 'אשר שיוך'}
              </SecondaryButton>}
            </div>
          )) : <p>ללא שיוך לקבלה</p>}
        </div>
        {!readOnly && <div className="receipt-plan-actions">
          {editable && matches.length > 0 && <SecondaryButton aria-expanded={adding} onClick={() => select(adding ? null : `add-${key}`)}>הוספת שורת קבלה</SecondaryButton>}
          {editable && canReplace && <SecondaryButton aria-expanded={shownEditor === key} onClick={() => select(shownEditor === key ? null : key)}>עריכה</SecondaryButton>}
          {editable && canReplace && matches.length > 0 && shownEditor === key && (
            <SecondaryButton onClick={() => { select(null); onAssign(item, null); }}>הסר שיוך</SecondaryButton>
          )}
        </div>}
        {editable && (shownEditor === key || adding) && <ReplacementPicker key={String(shownEditor)} adding={adding}
          item={item} rows={rows} plan={fulfillment} matches={matches} onCancel={() => select(null)}
          onAssign={(index, keepMatches) => { onAssign(item, index, keepMatches); select(null); }}
        />}
      </article>;
    })}
  </section>;
}
