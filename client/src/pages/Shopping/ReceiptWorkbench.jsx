import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { priceBreakdown } from '../../../../shared/receiptPricing.mjs';
import { receiptMatchesPlan } from '../../../../shared/shoppingReceiptMatching.mjs';
import ReceiptPlanComparison from './ReceiptPlanComparison';
import ReceiptLineEditor from './ReceiptLineEditor';
import { receiptRowMatchesSearch } from './receiptReviewLinks';

const tabs = [['issues','לטיפול'], ['plan','פריטי הרשימה'], ['rows','שורות הקבלה']];
const filters = [['all','הכול'], ['linked','עם שיוך'], ['unlinked','ללא שיוך'], ['confirmed','שיוכים מאושרים']];
const amount = value => value == null ? 'לא ידוע' : <bdi dir="ltr">₪{value}</bdi>;

function SubstitutionChoices({ names, plan, rows, onChoose }) {
  const previewPrefix = useId();
  return <section aria-label="תחליפים מוצעים">
    <h3>פריטים מוצעים מהרשימה</h3>
    <ul>{[...new Set(names)].map(name => {
      const targets = plan.filter(item => item.name === name);
      if (!targets.length) return <li key={name}>{name} · הפריט אינו ברשימה הנוכחית</li>;
      return targets.map((target, index) => {
        const matches = rows.flatMap((row, i) => receiptMatchesPlan(row, target) ? [{row, number:i + 1}] : []);
        const confirmed = matches.some(({row}) => row.review_link?.confirmed);
        const previewId = !confirmed && target.list_item_id != null && matches.length
          ? `${previewPrefix}-${target.list_item_id}` : undefined;
        return <li key={target.list_item_id ?? `${name}-${index}`}>
          <button className="rr-text" type="button" disabled={confirmed || target.list_item_id == null}
            aria-describedby={previewId}
            onClick={() => onChoose(target.list_item_id)}>שיוך אל {name}{targets.length > 1 && ` · ${target.quantity} ${target.unit} · שורה ${plan.indexOf(target)+1}`}</button>
          {confirmed && ' · קיים שיוך מאושר'}
          {previewId && <small id={previewId}>בבחירה זו יוסר השיוך של {matches.map(({row, number}) =>
            `${row.name || 'שורה ללא שם'} (שורה ${number})`).join(' · ')}.</small>}
        </li>;
      });
    })}</ul>
    <button className="rr-text" type="button" onClick={() => onChoose(null)}>השארה ללא שיוך</button>
  </section>;
}

function IssueDetail({ issue, plan, rows, onLinkRow, onBack, onEdit, onMatch, onConfirmLink, onApplyPrice }) {
  const { row, index, label, links, expected, kind, price } = issue;
  const source = row.provenance?.[0];
  const original = price.row.raw_price;
  const reading = row.source_readings?.[0];
  const sourceQuantity = reading?.quantity ?? (!row.owner_edited_fields?.includes('quantity') ? row.quantity : null);
  const sourceUnit = reading?.unit ?? (!row.owner_edited_fields?.includes('unit') ? row.unit : null);
  return <article className="rr-panel rr-detail">
    <button type="button" className="rr-back rr-text" onClick={onBack}>חזרה לפריטים ›</button>
    <header><h2>{row.name || 'שורה ללא שם'}</h2><span className="rr-badge">{label}</span></header>
    <p>{kind === 'price' ? 'בדקו את סכום השורה לאחר ההנחה מול הקבלה.' :
      kind === 'substitution' ? 'ייתכן שהמוצר נקנה כתחליף לפריט ברשימה. בחרו אם לשייך אותו.' :
      kind === 'match' ? 'השוו את המוצר והכמות לשיוך ברשימת הקניות.' : 'השוו את הפרטים שנקראו למקור בקבלה.'}</p>
    {kind === 'price' && <div className="rr-compare">
      <div><small>הסכום בטיוטה</small><strong>{amount(price.final)}</strong></div>
      <div><small>סכום לפי המקור לאחר הנחה</small><strong>{amount(expected)}</strong></div>
    </div>}
    {kind === 'match' && <div className="rr-compare">
      <div><small>ברשימת הקניות</small>{links.map(item => <strong key={item.list_item_id ?? item.name}>{item.name} · {item.quantity} {item.unit}</strong>)}</div>
      <div><small>בקבלה</small><strong>{row.name} · {row.quantity} {row.unit}</strong></div>
    </div>}
    {!!issue.conflicts.length && <ul>{issue.conflicts.map(({field,values}) => <li key={field}>
      {({quantity:'כמות',unit:'יחידה',price:'מחיר',discount:'הנחה',line_total:'סכום שורה'})[field] ?? field}: {values.join(' / ')}
    </li>)}</ul>}
    <div className="rr-paper"><header><b>מקור בקבלה</b><small>{source?.page_number && `עמוד ${source.page_number} · `}שורה {row.source_lines?.[0]?.line_number ?? index+1}</small></header>
      <div><b>{reading?.name || row.original_name || row.name}</b><span>{sourceQuantity} {sourceUnit}</span>
        {kind !== 'price' && original.gross_total != null && <b>{amount(original.gross_total)}</b>}</div>
      {kind === 'price' ? <dl className="rr-source-amounts">
        <div><dt>ברוטו לשורה</dt><dd>{amount(issue.conflicts.some(c => c.field === 'line_total') ? null : original.gross_total)}</dd></div>
        <div><dt>הנחה לשורה</dt><dd>{amount(issue.conflicts.some(c => c.field === 'discount') ? null : original.discount)}</dd></div>
        {expected != null && <div className="rr-source-net"><dt>נטו לשורה בקבלה</dt><dd>{amount(expected)}</dd></div>}
      </dl> : original.discount != null && original.discount !== '0.00' && <small>הנחה לשורה {amount(original.discount)}</small>}
    </div>
    {kind === 'substitution' ? <SubstitutionChoices names={row.possible_substitutions} plan={plan} rows={rows}
      onChoose={id => onLinkRow(index, id)}/> : <div className="rr-decision"><button className="rr-primary" type="button" onClick={() => {
      if (expected != null) onApplyPrice(index, expected);
      else if (issue.unitReview) onConfirmLink(links[0], true, index);
      else if (kind === 'match' && links[0]?.list_item_id != null) onMatch(links[0]);
      else onEdit(index);
    }}>{expected != null ? `עדכון ל־₪${expected}` : issue.unitReview ? 'אישור השיוך ללא אימות הכמות' : kind === 'match' ? 'בדיקת השיוך' : 'עריכת השורה'}</button></div>}
  </article>;
}

export default function ReceiptWorkbench({ rows, fulfillment, issues, discrepancy, selected, onSelect, mobileDetail, onMobileDetail,
  view, onView, onAssign, onConfirmLink, onLinkRow, onApplyPrice, undoPrice, readOnly, ...editor }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [activePlan, setActivePlan] = useState(null);
  const [edited, setEdited] = useState(null);
  const [focus, setFocus] = useState(null);
  const prefix = useId();
  const detail = useRef(null);
  const issue = issues.find(i => i.id === selected) ?? issues[0];
  useEffect(() => {
    if (focus == null) return;
    const el = document.getElementById(`${prefix}-${focus}`);
    el?.focus({ preventScroll:true }); el?.scrollIntoView?.({ block:'nearest' });
  }, [focus, prefix, view]);
  useEffect(() => { if (mobileDetail && view === 'issues') detail.current?.focus({preventScroll:true}); }, [mobileDetail, issue?.id, view]);
  function switchView(next) { onView(next); setQuery(''); setFilter('all'); setActivePlan(null); setEdited(null); setFocus(null); }
  function showRow(index, editing = false) { switchView('rows'); setFocus(index); if (editing) setEdited(index); }
  function showPlan(item, editing = false) {
    switchView('plan');
    const key = item.list_item_id ?? `legacy:${fulfillment.indexOf(item)}`;
    setFocus(`plan-${key}`); if (editing) setActivePlan(key);
  }
  function addRow() { editor.onAdd(); showRow(rows.length, true); }
  const visible = rows.map((row,index) => ({
    row, index, links:fulfillment.filter(item => receiptMatchesPlan(row,item)),
  })).filter(({row,index,links}) => receiptRowMatchesSearch(row,index,query) &&
    (filter === 'all' || filter === 'linked' && links.length > 0 || filter === 'unlinked' && !links.length ||
      filter === 'confirmed' && row.review_link?.confirmed));
  return <section className="rr-work receipt-reconciliation" aria-label="התאמת הקבלה לרשימה">
    <nav aria-label="תצוגות הבדיקה" className="rr-tabs">{tabs.filter(([key]) => !readOnly || key !== 'issues').map(([key,label]) =>
      <button key={key} type="button" aria-pressed={view === key} onClick={() => switchView(key)}>{label} {key === 'issues' && <b>{issues.length}</b>}</button>)}</nav>
    {undoPrice && <div className="rr-undo" role="status">סכום השורה עודכן · {undoPrice.name} <button className="rr-text" onClick={undoPrice.undo}>ביטול התיקון</button></div>}
    {view === 'issues' ? <div className={`rr-grid${mobileDetail && issue ? ' rr-mobile-detail' : ''}`}>
      <section className="rr-panel rr-queue"><h2>{issues.length ? 'פריטים לטיפול' : 'אין פריטים לטיפול'}</h2>
        {issues.length > 0 && <p>בחרו שורה כדי לראות את המקור והתיקון.</p>}
        {issues.map(i => <button key={i.id} type="button" aria-pressed={issue?.id === i.id} onClick={() => {onSelect(i.id); onMobileDetail(true);}}>
          <span className={`rr-icon ${i.kind}`} aria-hidden="true">{i.kind === 'price' ? '₪' : i.kind === 'source' ? '≠' : '↔'}</span>
          <span><b>{i.row.name || 'שורה ללא שם'}</b><small>{i.label} · שורה {i.index+1}</small></span><span aria-hidden="true">‹</span>
        </button>)}
      </section>
      <div className="rr-detail-wrap" ref={detail} tabIndex={-1}>{issue ? <IssueDetail issue={issue} plan={fulfillment} rows={rows} onLinkRow={onLinkRow} onBack={() => onMobileDetail(false)}
        onEdit={i => showRow(i,true)} onMatch={item => showPlan(item,true)} onApplyPrice={onApplyPrice} onConfirmLink={onConfirmLink}/> :
        <div className="rr-panel rr-detail"><h2>{discrepancy ? 'סכום השורות דורש בדיקה' : 'בדיקת השורות הושלמה'}</h2>{discrepancy && <p>{discrepancy}</p>}<button className="rr-text" onClick={() => switchView('rows')}>עיון בשורות הקבלה</button></div>}</div>
    </div> : <section className="rr-panel rr-records">
      <header><h2>{view === 'plan' ? 'פריטי הרשימה' : 'שורות הקבלה'}</h2>
        <input type="search" aria-label={view === 'plan' ? 'חיפוש פריט ברשימה' : 'חיפוש שורת קבלה'} placeholder="חיפוש…" value={query} onChange={e => setQuery(e.target.value)}/></header>
      <div className="rr-filters" aria-label="סינון לפי שיוך">{(view === 'plan' ? [...filters, ['pending', 'מחכים לאישור שיוך']] : filters).map(([key,label]) =>
        <button type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div>
      {view === 'plan' ? <ReceiptPlanComparison fulfillment={fulfillment} rows={rows} query={query} filter={filter} activePlan={activePlan}
        readOnly={readOnly} onEdit={setActivePlan} onAssign={onAssign} onConfirm={onConfirmLink} onShowRow={i => showRow(i)} rowPrefix={prefix}/> :
        <><div className="rr-colheads"><span>שורת קבלה</span><span>פריט ברשימה</span><span>מצב השיוך</span></div>
        {visible.map(({row,index,links}) => {
          return <Fragment key={row.row_id ?? index}><article className="rr-record" id={`${prefix}-${index}`} tabIndex={-1}>
            <div><b>{row.name || 'שורה ללא שם'}</b><small>שורה {index+1} · {row.quantity} {row.unit} · {amount(priceBreakdown(row).final)}</small></div>
            <div>{links.length ? links.map((p,i) => <button key={i} className="rr-text" onClick={() => showPlan(p)}>{p.name}</button>) : 'ללא שיוך'}</div>
            <div><span>{row.review_link?.confirmed ? 'שיוך מאושר' : links.length ? 'משויך' : 'קנייה נוספת'}</span>
              <button className="rr-text" aria-expanded={edited === index} onClick={() => setEdited(edited === index ? null : index)}>{readOnly ? 'פרטים' : 'עריכה'}</button></div>
          </article>{edited === index && <ReceiptLineEditor {...editor} index={index} rows={rows} readOnly={readOnly} fulfillment={fulfillment}
            onLinkRow={onLinkRow} onShowPlan={showPlan} onDone={() => setEdited(null)}
            onRemove={i => {editor.onRemove(i); setEdited(null);}}/>}</Fragment>;
        })}{!visible.length && <p>אין שורות בתצוגה הזו.</p>}
        {!readOnly && <button className="rr-text" onClick={addRow}>+ הוספת שורה</button>}</>}
    </section>}
  </section>;
}
