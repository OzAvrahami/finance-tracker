import { useState } from 'react';
import { PrimaryButton, SecondaryButton, TextField } from '../../components/ui';
import { receiptMatchesPlan } from '../../../../shared/shoppingReceiptMatching.mjs';
import { receiptReplacementOptions } from './receiptReviewLinks';

const statusText = {
  full: 'נרכש במלואו',
  partial: 'נרכש חלקית',
  absent: 'לא נמצא בקבלה',
  unresolved: 'התאמה או המרת כמות לא פתורה',
};

function ReplacementPicker({ item, rows, plan, matches, onAssign, onCancel }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const { suggested, available } = receiptReplacementOptions(rows, item, query);
  const option = ({ row, index }) => {
    const previous = plan.find(p => receiptMatchesPlan(row, p));
    const assignment = previous === item ? ' · השורה המשויכת כרגע' : previous ? ` · משויך ל${previous.name}` : '';
    return <option key={row.row_id ?? index} value={index}>
      {row.name || 'שורה ללא שם'} · שורה {index + 1}{assignment}
    </option>;
  };
  return <div className="receipt-link-editor">
    <TextField label="חיפוש שורת קבלה" value={query} onValueChange={value => { setQuery(value); setSelected(''); }} />
    <label>
      {matches.length ? 'שורה מחליפה' : 'שורה לשיוך'}
      <select value={selected} onChange={event => setSelected(event.target.value)}>
        <option value="">{suggested.length || available.length ? 'בחר שורה מהקבלה'
          : query.trim() ? 'אין תוצאות בשורות הזמינות' : 'אין שורות ללא שיוך מאושר'}</option>
        {!!suggested.length && <optgroup label="התאמות מוצעות">{suggested.map(option)}</optgroup>}
        {!!available.length && <optgroup label="שורות זמינות">{available.map(option)}</optgroup>}
      </select>
    </label>
    {matches.length > 0 && selected !== '' && !matches.some(match => match.index === Number(selected)) &&
      <p>השורה שבחרת תחליף את השיוך הנוכחי לפריט.</p>}
    <div className="receipt-plan-actions">
      <SecondaryButton onClick={onCancel}>ביטול</SecondaryButton>
      <PrimaryButton disabled={selected === ''} onClick={() => onAssign(Number(selected))}>שמירה בטיוטה</PrimaryButton>
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
    item.name.toLowerCase().includes(query.trim().toLowerCase()) &&
    (filter === 'all' || (filter === 'linked' && matches.length > 0) ||
      (filter === 'unlinked' && matches.length === 0) ||
      (filter === 'confirmed' && matches.some(({ row }) => row.review_link?.confirmed))));

  const shownEditor = activePlan;
  const select = onEdit;
  if (!visible.length) return <p className="receipt-table-empty">אין פריטים בתצוגה הזו.</p>;

  return <section aria-label="פריטי הרשימה" className="receipt-plan-rows">
    <p role="status">{visible.length} מתוך {fulfillment.length} פריטים</p>
    {visible.map(({ item, key, matches }) => {
      const confirmed = matches.some(({ row }) => row.review_link?.confirmed);
      const editable = !readOnly && item.list_item_id != null && !confirmed;
      return <article key={key} id={`${rowPrefix}-plan-${key}`} tabIndex={-1} className="receipt-plan-row">
        <div>
          <strong>{item.name}</strong>
          <p>תוכנן {item.quantity} {item.unit} · {statusText[item.status]}</p>
        </div>
        <div className="receipt-plan-matches">
          {matches.length ? matches.map(({ row, index }) => (
            <div key={row.row_id ?? index} className="receipt-plan-match">
              <button type="button" className="receipt-text-action" onClick={() => onShowRow(index)}>
                {row.name || 'שורה ללא שם'} · שורת קבלה {index + 1}
              </button>
              <small>{row.quantity} {row.unit}</small>
            </div>
          )) : <p>ללא שיוך לקבלה</p>}
          {confirmed && <span className="receipt-link-confirmed">שיוך מאושר</span>}
        </div>
        {!readOnly && <div className="receipt-plan-actions">
          {editable && <SecondaryButton aria-expanded={shownEditor === key} onClick={() => select(shownEditor === key ? null : key)}>עריכה</SecondaryButton>}
          {item.list_item_id != null && (confirmed || (matches.length === 1 && shownEditor !== key)) && (
            <SecondaryButton onClick={() => { select(null); onConfirm(item, !confirmed); }}>
              {confirmed ? 'בטל אישור' : 'אשר שיוך'}
            </SecondaryButton>
          )}
          {editable && matches.length > 0 && shownEditor === key && (
            <SecondaryButton onClick={() => { select(null); onAssign(item, null); }}>הסר שיוך</SecondaryButton>
          )}
        </div>}
        {editable && shownEditor === key && <ReplacementPicker
          item={item} rows={rows} plan={fulfillment} matches={matches} onCancel={() => select(null)}
          onAssign={index => { onAssign(item, index); select(null); }}
        />}
      </article>;
    })}
  </section>;
}
