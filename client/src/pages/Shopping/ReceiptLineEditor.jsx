import { priceBreakdown } from '../../../../shared/receiptPricing.mjs';
import ReceiptReviewTable from './ReceiptReviewTable';

export default function ReceiptLineEditor({ index, rows, fulfillment, onDone, onRemove, onChange, readOnly, ...editor }) {
  const row = rows[index];
  return <section className="rr-row-editor" aria-label={`עריכת שורת קבלה ${index + 1}`}>
    <strong>{row.original_name || row.name || `שורה ${index+1}`}</strong>
    <div className="rr-inline-fields">{[
      ['name','שם המוצר',row.name], ['quantity','כמות',row.quantity], ['unit','יחידה',row.unit],
      ['reviewed_line_total','סכום השורה אחרי הנחה',Object.hasOwn(row,'reviewed_line_total') ? row.reviewed_line_total : priceBreakdown(row).final],
    ].map(([key,label,value]) => <label key={key}>{label}
      <input readOnly={readOnly} type={['name','unit'].includes(key) ? 'text' : 'number'}
        step={key === 'quantity' ? '0.001' : key === 'reviewed_line_total' ? '0.01' : undefined}
        value={value ?? ''} onChange={e => onChange(index,key,e.target.value)}/>
    </label>)}</div>
    <details><summary>מחירים, שיוך ומידע מהמקור</summary>
      <ReceiptReviewTable {...editor} rows={rows} indices={[index]} readOnly={readOnly} plan={fulfillment}
        fulfillment={fulfillment} initialExpanded={index} onChange={onChange} onRemove={onRemove}/>
    </details>
    <button type="button" className="rr-text" onClick={onDone}>סיום עריכה</button>
  </section>;
}
