import { useEffect, useId, useState } from 'react';
import { SecondaryButton, TextField } from '../../components/ui';
import { priceBreakdown } from '../../../../shared/receiptPricing.mjs';
import { receiptMatchesPlan } from '../../../../shared/shoppingReceiptMatching.mjs';
import ReceiptPlanComparison from './ReceiptPlanComparison';
import ReceiptReviewTable from './ReceiptReviewTable';
import { receiptRowConflicts, receiptRowMatchesSearch } from './receiptReviewLinks';

const filters = [['all', 'הכול'], ['linked', 'עם שיוך'], ['unlinked', 'ללא שיוך'], ['confirmed', 'שיוכים מאושרים']];
function needsReview(row, links) {
  const price = priceBreakdown(row);
  return !row.name.trim() || !row.unit?.trim() || price.final === null || price.source_mismatch ||
    row.overlap_uncertain ||
    receiptRowConflicts(row).length > 0 ||
    (!row.review_link?.confirmed && links.some(item => item.status === 'unresolved')) ||
    (!row.review_link && !row.mapping_snapshot && row.match_requires_review &&
      (links.length > 0 || row.possible_substitutions?.length > 0));
}

export default function ReceiptReviewWorkspace({
  rows, fulfillment, onAssign, onConfirmLink, onLinkRow, readOnly, ...editor
}) {
  const [view, setView] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [activePlan, setActivePlan] = useState(null);
  const [focusRow, setFocusRow] = useState(null);
  const [focusPlan, setFocusPlan] = useState(null);
  const [workingIndex, setWorkingIndex] = useState(null);
  const rowPrefix = useId();
  const selectedView = readOnly && view === 'issues' ? 'rows'
    : view ?? (readOnly || !fulfillment.length ? 'rows' : 'issues');
  const indexed = rows.map((row, index) => ({
    row, index, links: fulfillment.filter(item => receiptMatchesPlan(row, item)),
  }));
  const issues = indexed.filter(({ row, links }) => needsReview(row, links));
  const candidates = selectedView === 'issues'
    ? indexed.filter(entry => entry.index === workingIndex || issues.includes(entry)) : indexed;
  const visible = candidates.filter(({ row, index, links }) =>
    receiptRowMatchesSearch(row, index, query) &&
    (filter === 'all' || (filter === 'linked' && links.length > 0) ||
      (filter === 'unlinked' && links.length === 0) ||
      (filter === 'confirmed' && row.review_link?.confirmed)));
  const selectView = next => {
    setView(next); setQuery(''); setFilter('all'); setFocusRow(null); setFocusPlan(null); setActivePlan(null); setWorkingIndex(null);
  };
  const showRow = index => { selectView('rows'); setFocusRow(index); };
  useEffect(() => {
    const target = focusRow != null ? focusRow : focusPlan != null ? `plan-${focusPlan}` : null;
    if (target === null) return;
    const row = document.getElementById(`${rowPrefix}-${target}`);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [focusRow, focusPlan, rowPrefix]);
  const showAll = () => selectView('rows');

  return <section className="receipt-reconciliation" aria-label="התאמת הקבלה לרשימה">
    <nav className="shopping-receipt-tabs" aria-label="תצוגות הבדיקה">
      {!readOnly && <SecondaryButton aria-pressed={selectedView === 'issues'} onClick={() => selectView('issues')}>
        לטיפול ({issues.length})
      </SecondaryButton>}
      <SecondaryButton aria-pressed={selectedView === 'plan'} onClick={() => selectView('plan')}>פריטי הרשימה</SecondaryButton>
      <SecondaryButton aria-pressed={selectedView === 'rows'} onClick={showAll}>שורות הקבלה</SecondaryButton>
    </nav>
    <div className="receipt-list-controls">
      <TextField value={query} onValueChange={setQuery}
        label={selectedView === 'plan' ? 'חיפוש פריט ברשימה' : 'חיפוש שורת קבלה'} />
      <label>סינון לפי שיוך<select value={filter} onChange={event => setFilter(event.target.value)}>
        {filters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
    </div>
    {selectedView === 'plan' ? (
      <ReceiptPlanComparison fulfillment={fulfillment} rows={rows} query={query} filter={filter}
        activePlan={activePlan} readOnly={readOnly} onEdit={setActivePlan} onAssign={onAssign}
        onConfirm={onConfirmLink} onShowRow={showRow} rowPrefix={rowPrefix} />
    ) : (
      <>
        <p className="receipt-view-count" role="status">{visible.length} מתוך {rows.length} שורות</p>
        {!visible.length && selectedView === 'issues' && <div className="receipt-view-empty">
          <p>{issues.length ? 'אין שורות שתואמות לחיפוש ולסינון.' : 'אין שורות שסומנו לבדיקה.'}</p>
          <SecondaryButton onClick={showAll}>הצג את כל שורות הקבלה</SecondaryButton>
        </div>}
        {visible.length > 0 || selectedView === 'rows' || !rows.length ? <ReceiptReviewTable
          {...editor} key={`${selectedView}:${focusRow}`} rows={rows}
          onChange={(index, field, value) => { setWorkingIndex(index); editor.onChange(index, field, value); }}
          indices={visible.map(entry => entry.index)} plan={fulfillment} fulfillment={fulfillment}
          readOnly={readOnly} rowPrefix={rowPrefix} initialExpanded={focusRow}
          onLinkRow={(index, id) => { setWorkingIndex(index); onLinkRow(index, id); }} onShowPlan={item => { selectView('plan'); setFocusPlan(item.list_item_id ?? null); }}
          onAdd={() => { showAll(); editor.onAdd(); }} /> : null}
      </>
    )}
  </section>;
}
