import { useContext, useEffect, useRef, useState } from 'react';
import { Dialog, MoneyAmount, PrimaryButton, SecondaryButton } from '../../components/ui';
import { getReconciliationSummary, getReconciliationPending, getReconciliationDetail, resolveReconciliation } from '../../services/api';
import { invalidateFinance, FINANCE_CHANGED } from '../../utils/financeInvalidation';
import Context from './ReconciliationContext';
import { formatCalendarDate } from '../../utils/calendarDate';
import './Reconciliation.css';

const labels = { awaiting_cal: 'Apple Pay · ממתינה ל־CAL', reconciled: 'אושרה בשני המקורות', cal_only: 'CAL בלבד', cancelled: 'תנועה מבוטלת' };
const source = value => value === 'apple_pay' ? 'Apple Pay / Wallet' : 'CAL';
const stored = id => { try { return JSON.parse(sessionStorage.getItem(`apy-review:${id}`)); } catch { return null; } };
const remember = (id, command) => { sessionStorage.setItem(`apy-review:${id}`, JSON.stringify(command)); };
const forget = id => sessionStorage.removeItem(`apy-review:${id}`);

const methodLabels = { credit_card: 'כרטיס אשראי', debit_card: 'כרטיס חיוב', cash: 'מזומן', bank_transfer: 'העברה בנקאית', digital_wallet: 'ארנק דיגיטלי', check: 'המחאה' };
const cardLabel = value => {
  const text = value || '';
  const last4 = text.match(/•••• (\d{4})$/)?.[1];
  return `${methodLabels[text.split(' ')[0]] || 'אמצעי תשלום'}${last4 ? ` •••• ${last4}` : ''}`;
};
const displayTime = value => {
  if (!value) return 'לא נמסר';
  // An unzoned source timestamp must not be assigned a made-up purchase timezone.
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    return match ? `${formatCalendarDate(match[1])} ${match[2]} (אזור זמן לא נמסר)` : 'לא זמין';
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short',
  }).format(date) + ' (שעון ישראל)' : 'לא זמין';
};
const ReviewMoney = ({ value }) => <MoneyAmount value={value} minimumFractionDigits={2} maximumFractionDigits={2} />;
function SourceDetails({ item }) {
  return <details className="reconciliation-details"><summary>פרטים נוספים</summary><dl>
    <dt>מועד רכישה במקור</dt><dd>{item.occurred_at ? displayTime(item.occurred_at) : 'לא נמסר — תאריך בלבד'}</dd>
    <dt>תאריך חיוב</dt><dd>{item.charge_date ? formatCalendarDate(item.charge_date) : 'לא נמסר'}</dd>
    <dt>קליטה בשרת (אינה מועד רכישה)</dt><dd>{displayTime(item.observed_at)}</dd>
    <dt>מספר דיווח</dt><dd><bdi>{item.id}</bdi></dd>
  </dl></details>;
}
function Evidence({ item }) {
  return <div className="reconciliation-evidence">
    <small>{source(item.source)}</small>
    <div className="reconciliation-line"><strong><bdi>{item.merchant}</bdi></strong><ReviewMoney value={item.amount} /></div>
    <small><bdi>{formatCalendarDate(item.transaction_date)}</bdi> · <bdi>{cardLabel(item.payment_context)}</bdi></small>
    <SourceDetails item={item} />
  </div>;
}

function ReviewDialog({ view, onClose, onView }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [choice, setChoice] = useState(() => { const prior = view.kind === 'observation' ? stored(view.id) : null; return prior ? (prior.action === 'link' ? prior.transaction_id : 'separate') : ''; });
  const [retry, setRetry] = useState(() => view.kind === 'observation' ? stored(view.id) : null);
  const request = useRef(retry), submitting = useRef(false), alive = useRef(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    const load = view.kind === 'pending' ? getReconciliationPending(view.before) : getReconciliationDetail(view.kind, view.id);
    load.then(({ data: result }) => { if (!cancelled) { setData(result); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError('טעינת פרטי המקור נכשלה. אפשר לנסות שוב.'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [view, revision]);
  const reload = () => { setLoading(true); setError(''); setRevision(v => v + 1); };
  const observation = data?.observation;
  const validChoice = Boolean(retry || (choice === 'separate' ? data?.can_separate : data?.candidates?.some(c => c.id === choice && c.can_link)));
  const separate = (retry?.action || (choice === 'separate' ? 'separate' : 'link')) === 'separate';
  const submit = async () => {
    if (submitting.current || !observation || !validChoice) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      if (!request.current) {
        const candidate = data.candidates.find(c => c.id === choice);
        request.current = { request_key: crypto.randomUUID(), expected_revision: observation.revision,
          action: choice === 'separate' ? 'separate' : 'link', expected_candidate_fingerprints: data.candidate_fingerprints,
          ...(candidate ? { transaction_id: candidate.id, expected_transaction_fingerprint: candidate.fingerprint } : {}) };
        // Persist the exact command before transmission, including across dialog/page reload.

      }
      remember(view.id, request.current);
      const { data: result } = await resolveReconciliation(view.id, request.current);
      forget(view.id); request.current = null;
      invalidateFinance(result);
      if (alive.current) onClose();
    } catch (e) {
      if (!alive.current) return;
      if ([409, 422].includes(e.response?.status)) {
        forget(view.id); request.current = null; setRetry(null); setChoice('');
        setNotice(e.response.status === 409 ? 'המידע השתנה. הפרטים רועננו; יש לבחור מחדש.' : 'הפעולה אינה מותרת במצב הנוכחי. אין לשנות היסטוריה מוגנת.'); reload();
      } else {
        setRetry(request.current);
        setError('האישור לא התקבל. ניסיון נוסף ישלח את אותה החלטה בלבד.');
      }
    } finally { submitting.current = false; if (alive.current) setBusy(false); }
  };
  return <Dialog open onClose={onClose} title={view.kind === 'observation' ? 'האם זו אותה קנייה?' : 'התאמת עסקאות'} size="lg" closeDisabled={busy}
    className="reconciliation-dialog" footer={<>
      {observation && validChoice && <p className="reconciliation-effect" role="status">{separate
        ? <>תתווסף הוצאה של <ReviewMoney value={observation.amount} /> לסיכומים.</>
        : 'הקישור לא יוסיף הוצאה.'}</p>}
      <SecondaryButton onClick={onClose} disabled={busy}>ביטול</SecondaryButton>
      {observation && (retry || !observation.transaction_id) && <PrimaryButton onClick={submit} disabled={loading || busy || !validChoice}>
        {busy ? 'שומר…' : retry ? 'ניסיון חוזר לאותה החלטה' : !validChoice ? 'אישור התאמה' : separate ? 'יצירת הוצאה נפרדת' : 'קישור ללא הוצאה נוספת'}
      </PrimaryButton>}
    </>}>
    <div dir="rtl">
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error} {!retry && <button onClick={reload}>נסה שוב</button>}</p>}
      {loading && <p role="status">טוען עסקאות…</p>}
      {!loading && data && view.kind === 'pending' && <>
        <p className="reconciliation-caption">{data.items.length} דיווחים לבדיקה · מכל התקופות{data.next_cursor ? ' · יש דיווחים נוספים' : ''}</p>
        {!data.items.length && <p>אין עסקאות הממתינות לבדיקה.</p>}
        <ul className="reconciliation-queue">{data.items.map(item => <li key={item.id}>
          <div className="reconciliation-queue-main"><strong><bdi>{item.merchant}</bdi></strong>
            <small>{source(item.source)} · <bdi>{cardLabel(item.payment_context)}</bdi></small>
            <small>{item.transaction_id ? 'מקושר להוצאה קיימת' : 'טרם נרשמה הוצאה מהדיווח'}</small>
          </div>
          <div className="reconciliation-queue-money"><ReviewMoney value={item.amount} /><small><bdi>{formatCalendarDate(item.transaction_date)}</bdi></small></div>
          <SecondaryButton size="sm" aria-label={`בדיקה: ${item.merchant}`} onClick={() => onView({ kind: 'observation', id: item.id })}>בדיקה</SecondaryButton>
        </li>)}</ul>
        {data.next_cursor && <SecondaryButton onClick={() => onView({ kind: 'pending', before: data.next_cursor })}>הבא</SecondaryButton>}
      </>}
      {!loading && data && view.kind === 'transaction' && <>
        <strong>{data.description}</strong><p className="reconciliation-caption">{data.cancelled ? 'תנועה מבוטלת — אינה נכללת בסיכומים.' : 'ההוצאה כבר נכללת בסיכומים. התאמת המקורות אינה מוסיפה הוצאה.'}</p>
        <div className="reconciliation-comparison">{data.observations.map(item => <section key={item.id} className="reconciliation-panel"><Evidence item={item} />
          {item.review_required && <SecondaryButton onClick={() => onView({ kind: 'observation', id: item.id })}>בדיקה</SecondaryButton>}</section>)}</div>
      </>}
      {!loading && observation && <>
        {data.review_limited && <p role="status">יש יותר מדי עסקאות אפשריות. נדרשת בדיקת מקור לפני החלטה; לא נוספה הוצאה.</p>}
        {observation.transaction_id && <p>הדיווח כבר מקושר להוצאה. תיקון היסטוריה מוגנת דורש טיפול בתנועה עצמה.</p>}
        <div className="reconciliation-comparison">
          <section className="reconciliation-panel"><h3>הדיווח שהתקבל</h3><Evidence item={observation} /></section>
          {!observation.transaction_id && <fieldset className="reconciliation-options" disabled={busy || Boolean(retry)}><legend>בחירת הוצאה קיימת</legend>
            {!data.candidates.length && <p>לא נמצאו הוצאות מתאימות.</p>}
            {data.candidates.map((candidate, index) => <div key={candidate.id} className={`reconciliation-option${choice === candidate.id ? ' is-selected' : ''}`}>
              <label>
                <input type="radio" name="reconciliation-choice" value={candidate.id} checked={choice === candidate.id} disabled={!candidate.can_link}
                  aria-label={`אפשרות ${index + 1}: ${candidate.description}`} onChange={() => setChoice(candidate.id)} />
                <span className="reconciliation-option-content">
                  <small>אפשרות {index + 1}</small>
                  <span className="reconciliation-line"><strong><bdi>{candidate.description}</bdi></strong><ReviewMoney value={candidate.amount} /></span>
                  <small><bdi>{formatCalendarDate(candidate.transaction_date)}</bdi> · <bdi>{cardLabel(candidate.observations[0]?.payment_context || observation.payment_context)}</bdi></small>
                  {candidate.observations.map(item => <small key={item.id}>{source(item.source)}: <bdi>{item.merchant}</bdi></small>)}
                  {!candidate.can_link && <small>לא זמינה לקישור — הוצאה מוגנת או מבוטלת, או מקור שכבר קושר.</small>}
                </span>
              </label>
              {candidate.observations.map(item => <SourceDetails key={item.id} item={item} />)}
            </div>)}
            {data.can_separate && <label className={`reconciliation-separate${choice === 'separate' ? ' is-selected' : ''}`}>
              <input type="radio" name="reconciliation-choice" checked={choice === 'separate'} onChange={() => setChoice('separate')} />
              <span><strong>זו קנייה נפרדת</strong><small>תירשם הוצאה נוספת של <ReviewMoney value={observation.amount} /></small></span>
            </label>}
            {!data.can_separate && <small>יצירת הוצאה נפרדת אינה מותרת במצב זה.</small>}
          </fieldset>}
        </div>
      </>}
    </div>
  </Dialog>;
}

export function ReconciliationProvider({ rows, children }) {
  const [summary, setSummary] = useState(null), [error, setError] = useState(false), [version, setVersion] = useState(0), [view, setView] = useState(null);
  const ids = rows.map(r => String(r.id)).join(',');
  const returnFocus = useRef(null);
  useEffect(() => { const refresh = () => setVersion(v => v + 1); window.addEventListener(FINANCE_CHANGED, refresh); return () => window.removeEventListener(FINANCE_CHANGED, refresh); }, []);
  useEffect(() => {
    let cancelled = false;
    const all = ids ? ids.split(',') : [], batches = [];
    for (let i = 0; i < Math.max(all.length, 1); i += 100) batches.push(all.slice(i, i + 100));
    Promise.all(batches.map(batch => getReconciliationSummary(batch))).then(results => {
      if (!cancelled) { setSummary({ transactions: Object.assign({}, ...results.map(r => r.data.transactions)), pending_count: results[0].data.pending_count }); setError(false); }
    }).catch(e => { if (!cancelled) { setSummary(null); setError(e.response?.status !== 403); } });
    return () => { cancelled = true; };
  }, [ids, version]);
  const open = value => { returnFocus.current = document.activeElement; setView(value); };
  const close = () => { setView(null); requestAnimationFrame(() => returnFocus.current?.isConnected && returnFocus.current.focus()); };
  return <Context.Provider value={{ summary, open }}>{children}
    {error && <div className="reconciliation-toolbar" role="status">מצב התאמה אינו זמין. <button onClick={() => setVersion(v => v + 1)}>נסה שוב</button></div>}
    {view && <ReviewDialog key={`${view.kind}:${view.id || view.before || ''}`} view={view} onView={setView} onClose={close} />}
  </Context.Provider>;
}
export function ReconciliationToolbar() {
  const context = useContext(Context);
  return context?.summary ? <div className="reconciliation-toolbar"><SecondaryButton size="sm" onClick={() => context.open({ kind: 'pending' })}>
    התאמת עסקאות ({context.summary.pending_count})</SecondaryButton></div> : null;
}
export function ReconciliationBadge({ id }) {
  const context = useContext(Context), state = context?.summary?.transactions[String(id)];
  return state ? <button className="reconciliation-badge" onClick={() => context.open({ kind: 'transaction', id: String(id) })}
    aria-label={`פרטי התאמה: ${labels[state.status]}`}>
    {labels[state.status]}{state.review_required && ' · לבדיקה'}</button> : null;
}
