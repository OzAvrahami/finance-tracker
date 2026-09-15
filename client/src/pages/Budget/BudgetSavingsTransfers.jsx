import { useEffect, useRef, useState } from 'react';
import { Alert, DateField, Dialog, GlassCard, PrimaryButton, SecondaryButton, Select, TextField } from '../../components/ui';
import { applyBudgetMonthClose, applySavingsSurplus, getPaymentSources, getSavingsAccounts, getSavingsSurplusPreview, getSettingsCategories, reverseSavingsSurplus } from '../../services/api';
import { currentBusinessDate, formatCalendarDate } from '../../utils/calendarDate';
import { invalidateFinance } from '../../utils/financeInvalidation';
import { addMoney, compareMoney } from '../../utils/money';
import BudgetMoneyAmount from './BudgetMoneyAmount';

// A preview is an explicit confirmation boundary. Editing any input discards it.
export default function BudgetSavingsTransfers({ month, state, closePreview, onCloseReview, onApplied }) {
  const [mode, setMode] = useState(null), [form, setForm] = useState({}), [accounts, setAccounts] = useState([]);
  const [sources, setSources] = useState([]), [policies, setPolicies] = useState([]), [previews, setPreviews] = useState(null);
  const [error, setError] = useState(''), [pending, setPending] = useState(false), [loaded, setLoaded] = useState(false);
  const [confirmed, setConfirmed] = useState(false), [reason, setReason] = useState('');
  const receipt = useRef(null), busy = useRef(false), trigger = useRef(null);
  const eligible = state.categories.filter(c => c.is_active_budget && compareMoney(c.remaining ?? '0') > 0);
  const begin = next => {
    trigger.current = document.activeElement; setMode(next); setError(''); setPreviews(null); setConfirmed(false); setReason('');
    setForm({ category_id: '', account_id: '', amount: '', payment_source_id: '', cash_date: currentBusinessDate() }); receipt.current = null;
  };
  useEffect(() => { if (closePreview) { begin('close'); onCloseReview(); } }, [closePreview, onCloseReview]);
  // Capture the full close snapshot independently of subsequent parent refreshes.
  const capturedClose = useRef(null);
  if (closePreview) capturedClose.current = closePreview;
  useEffect(() => {
    if (!mode || typeof mode === 'object') return undefined;
    let active = true; setLoaded(false);
    Promise.all([getSavingsAccounts(), getPaymentSources(), getSettingsCategories()]).then(([a, p, c]) => {
      if (active) { setAccounts(a.data); setSources(p.data); setPolicies(c.data); setLoaded(true); }
    }).catch(() => { if (active) setError('טעינת החשבונות ואמצעי התשלום נכשלה. סגרו ופתחו מחדש.'); });
    return () => { active = false; };
  }, [mode]);
  const update = (key, value) => {
    setPreviews(null); setConfirmed(false); receipt.current = null;
    setForm(old => ({ ...old, [key]: value, ...(key === 'category_id' ? {
      account_id: String(policies.find(p => String(p.id) === value)?.savings_account_id || ''),
      amount: eligible.find(c => String(c.category_id) === value)?.remaining || '',
    } : {}) }));
  };
  const commands = () => mode === 'close'
    ? capturedClose.current.categories.filter(c => c.status === 'ready' && c.policy === 'savings_account').map(c => ({
      source_month: month, category_id: String(c.category_id), account_id: String(c.savings_account?.id || ''), amount: c.eligible_unused,
      payment_source_id: form.payment_source_id, cash_date: form.cash_date,
    })) : [{ source_month: month, ...form }];
  const closingBalances = new Map();
  const displayedPreviews = previews?.map(({ preview }) => {
    if (mode !== 'close') return preview;
    const before = closingBalances.get(preview.account_id) ?? preview.savings_before;
    const after = addMoney(before, preview.amount);
    closingBalances.set(preview.account_id, after);
    return { ...preview, savings_before: before, savings_after: after };
  });
  const review = async () => {
    if (busy.current || !loaded) return; busy.current = true; setPending(true); setError('');
    try { setPreviews(await Promise.all(commands().map(async command => ({ command, preview: (await getSavingsSurplusPreview(command)).data })))); }
    catch (e) { setPreviews(null); setError(e.response?.data?.error || 'לא ניתן להכין את הסקירה. בדקו חשבון פעיל, אמצעי תשלום, סכום ותאריך.'); }
    finally { busy.current = false; setPending(false); }
  };
  const dismiss = () => { if (!busy.current) setMode(null); };
  const apply = async () => {
    if (busy.current || !confirmed || (typeof mode === 'object' ? !reason.trim() : !previews)) return;
    busy.current = true; setPending(true); setError(''); receipt.current ||= crypto.randomUUID();
    try {
      let response;
      if (typeof mode === 'object') response = await reverseSavingsSurplus(mode.operation_id, { request_key: receipt.current, preview_fingerprint: mode.fingerprint, reason });
      else if (mode === 'close') response = await applyBudgetMonthClose({ source_month: month, request_key: receipt.current, preview_fingerprint: capturedClose.current.fingerprint,
        cash_confirmations: previews.map(({ command, preview }) => ({ category_id: command.category_id, account_id: command.account_id, amount: preview.amount, payment_source_id: command.payment_source_id, cash_date: command.cash_date, preview_fingerprint: preview.fingerprint })) });
      else response = await applySavingsSurplus({ request_key: receipt.current, preview_fingerprint: previews[0].preview.fingerprint, command: previews[0].command });
      invalidateFinance(response.data); onApplied(); setMode(null);
    } catch (e) {
      setError(e.response?.data?.error || 'הפעולה לא הושלמה. לא נרשמה העברה חלקית.');
      if (e.response?.status === 409) { setPreviews(null); setConfirmed(false); onApplied(); }
    } finally { busy.current = false; setPending(false); }
  };
  return <>
    <GlassCard padding="18px" className="budget-carryover-panel">
      <div className="budget-recurring-panel__heading"><div><h2>עודף ממומן לחיסכון</h2><p>העברה מפורשת של כסף פנוי בקטגוריה לחשבון חיסכון, עם הוצאה אחת והפקדה אחת.</p></div>
        <SecondaryButton onClick={() => begin('transfer')}>העברת עודף לחיסכון</SecondaryButton></div>
      {state.cash_bridge && <p>הוצאות במעטפת: <BudgetMoneyAmount value={state.cash_bridge.envelope_actuals} /> · העברות ממומנות: <BudgetMoneyAmount value={state.cash_bridge.funded_savings_transfers} /> · סך הוצאות כספיות: <BudgetMoneyAmount value={state.cash_bridge.cash_expenses} />. הפקדות שאינן עודף ממומן בסך <BudgetMoneyAmount value={state.cash_bridge.manual_savings_deposits} /> כלולות במעטפת.</p>}
      {(state.savings_transfer_history || []).length > 0 && <ul className="budget-recurring-panel__list" aria-label="היסטוריית העברות לחיסכון">{state.savings_transfer_history.map(h => <li key={h.operation_id}><span>{h.category_name} · {h.source_month} → {h.account_name} · {formatCalendarDate(h.cash_date)} <BudgetMoneyAmount value={h.amount} />{!h.reversible && ` · ${h.reason}`}</span>{h.reversible && <SecondaryButton size="sm" onClick={() => begin(h)}>ביטול מלא</SecondaryButton>}</li>)}</ul>}
    </GlassCard>
    <Dialog open={Boolean(mode)} onClose={dismiss} returnFocusRef={trigger} closeDisabled={pending} title={typeof mode === 'object' ? 'ביטול העברת עודף' : mode === 'close' ? 'אישור הפקדות בסגירת חודש' : 'העברת עודף לחיסכון'} footer={<><SecondaryButton disabled={pending} onClick={dismiss}>חזרה</SecondaryButton>{typeof mode === 'object' || previews ? <PrimaryButton loading={pending} disabled={!confirmed || (typeof mode === 'object' && !reason.trim())} onClick={apply}>אישור הפעולה</PrimaryButton> : <PrimaryButton loading={pending} disabled={!loaded} onClick={review}>סקירת ההעברה</PrimaryButton>}</>}>
      {mode && <div className="savings-details">
        {typeof mode === 'object' ? <><p>החזרת <BudgetMoneyAmount value={mode.amount} /> למימון ולהקצאה של {mode.category_name} בחודש {mode.source_month}, ביטול ההוצאה והפקדת החיסכון יחד. ההיסטוריה נשמרת; תיקון דורש העברה חדשה לאחר הביטול.</p><TextField label="סיבת הביטול" disabled={pending} value={reason} onValueChange={v => { setReason(v); receipt.current = null; }} required /></> : <>
          <p>חודש מקור: {month}. אין שינוי אוטומטי בהכנסות או בתקציב חודש התשלום.</p>
          {mode === 'transfer' && <><Select label="קטגוריית מקור" disabled={pending || !loaded} value={form.category_id} onValueChange={v => update('category_id', v)} placeholder="בחירת קטגוריה">{eligible.map(c => <option key={c.category_id} value={String(c.category_id)}>{c.categories?.name}</option>)}</Select>
            <Select label="חשבון חיסכון יעד" disabled={pending || !loaded} value={form.account_id} onValueChange={v => update('account_id', v)} placeholder="בחירת חשבון">{accounts.map(a => <option key={a.account_id} value={a.account_id} disabled={a.status !== 'active'}>{a.name}{a.status !== 'active' ? ' — בארכיון' : ''}</option>)}</Select>
            <TextField label="סכום להעברה" disabled={pending || !loaded} value={form.amount} onValueChange={v => update('amount', v)} inputMode="decimal" technicalLtr /></>}
          {mode === 'close' && <p>יעדי החיסכון והסכומים נקבעו במדיניות הקטגוריות. נדרש אישור לכל ההפקדות; היעדים אינם מוחלפים אוטומטית.</p>}
          <Select label="אמצעי תשלום של ההוצאה" disabled={pending || !loaded} value={form.payment_source_id} onValueChange={v => update('payment_source_id', v)} placeholder="בחירת אמצעי תשלום">{sources.filter(p => p.is_active !== false).map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}</Select>
          <DateField label="תאריך ההעברה הכספית" disabled={pending || !loaded} value={form.cash_date} onValueChange={v => update('cash_date', v)} />
          {displayedPreviews?.map(p => <div key={p.category_id}><h3>{p.category_name} → {p.account_name}</h3><p>עודף זכאי: <BudgetMoneyAmount value={p.eligible_surplus} />; העברה: <BudgetMoneyAmount value={p.amount} />. מימון והקצאה: <BudgetMoneyAmount value={p.funded_before} /> → <BudgetMoneyAmount value={p.funded_after} />. יתרת חיסכון: <BudgetMoneyAmount value={p.savings_before} /> → <BudgetMoneyAmount value={p.savings_after} />.</p><p>הוצאה אחת באמצעות {p.payment_source_name} בתאריך {formatCalendarDate(p.cash_date)}; הוצאות המעטפת אינן גדלות שוב.</p>{p.opening_cutoff_confirmation_required && <Alert variant="warning">זהו תאריך חיתוך יתרת הפתיחה. ודאו שהכסף המועבר אינו כלול בפתיחה שאושרה.</Alert>}</div>)}
        </>}
        {(previews || typeof mode === 'object') && <label><input type="checkbox" disabled={pending} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> אישור ההשפעה על התקציב, ההוצאה והחיסכון; הכסף אינו כלול ביתרת הפתיחה</label>}
        {error && <Alert variant="error" urgent>{error}</Alert>}
      </div>}
    </Dialog>
  </>;
}
