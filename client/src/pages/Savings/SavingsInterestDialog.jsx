import { useEffect, useRef, useState } from 'react';
import { Alert, DateField, Dialog, PrimaryButton, SecondaryButton, Select, TextArea, TextField } from '../../components/ui';
import { cancelSavingsEvent, correctSavingsEvent, getCategories, getPaymentSources, getTransactionById, getTransactions, postSavingsEvent } from '../../services/api';
import { currentBusinessDate, formatCalendarDate, isCalendarDate } from '../../utils/calendarDate';
import { invalidateFinance } from '../../utils/financeInvalidation';

// All writes use decimal strings and the same audited RPCs as transaction entry.
const SavingsInterestDialog = ({ context, accounts, onClose, onSaved, returnFocusRef }) => {
  const [form, setForm] = useState({});
  const [sources, setSources] = useState([]);
  const [category, setCategory] = useState(null);
  const [cash, setCash] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const receipt = useRef(null);
  const amountRef = useRef(null);
  const entry = context?.entry;
  const restoring = Boolean(entry?.reversed_by_entry_id);
  const cancelling = context?.cancel === true;
  useEffect(() => {
    if (!context) return undefined;
    let active = true;
    const date = entry?.effective_date || currentBusinessDate();
    setForm({ account_id: String(context.account.id || context.account.account_id), amount: entry?.amount || '', effective_date: date,
      destination: entry?.event_kind || '', payment_source_id: entry?.cash_payment_source_id || '', charge_date: entry?.cash_charge_date || date,
      description: `ריבית — ${context.account.name}`, notes: '', reason: '', cutoff_confirmed: false, confirmed: false, mode: 'create' });
    setCash(null); setError(''); setLoaded(false); setCandidates([]); setCursor(null); receipt.current = null;
    Promise.all([getCategories(), getPaymentSources(), entry?.transaction_id ? getTransactionById(entry.transaction_id) : Promise.resolve(null)])
      .then(([categories, paymentSources, transaction]) => {
        if (!active) return;
        setCategory(categories.data.find(c => c.savings_role === 'interest_payout'));
        setSources(paymentSources.data || []); setCash(transaction?.data || null);
        if (transaction) setForm(old => ({ ...old, description: transaction.data.description, notes: transaction.data.notes || '' }));
        setLoaded(true);
      }).catch(() => { if (active) setError('טעינת פרטי הריבית נכשלה. סגרו ופתחו מחדש לפני השמירה.'); });
    return () => { active = false; };
  }, [context, entry]);
  const update = key => value => setForm(old => ({ ...old, [key]: value }));
  const loadCandidates = async (next = null) => {
    setLoading(true); setError('');
    try {
      const { data } = await getTransactions({ limit: 50, cursor: next });
      // SQL remains authoritative for source, item/Loan/checkout and cutoff eligibility.
      const rows = data.data.filter(t => t.movement_type === 'income' && !t.savings && !t.voided_at && !t.loan_id && (t.currency || 'ILS') === 'ILS');
      setCandidates(old => next ? [...old, ...rows] : rows); setCursor(data.pagination.nextCursor);
    } catch { setError('לא ניתן לטעון הכנסות קיימות. נסו שוב.'); }
    finally { setLoading(false); }
  };
  const chooseCash = async id => {
    setLoading(true); setError('');
    try {
      const { data } = await getTransactionById(id);
      setCash(data); setForm(old => ({ ...old, amount: data.total_amount, effective_date: data.transaction_date,
        charge_date: data.charge_date, payment_source_id: String(data.payment_source_id), description: data.description, notes: data.notes || '', confirmed: false }));
    } catch { setError('טעינת ההכנסה נכשלה. בחרו אותה מחדש.'); }
    finally { setLoading(false); }
  };
  const save = async event => {
    event.preventDefault(); if (pending || loading || !loaded) return;
    const account = accounts.find(a => String(a.account_id) === form.account_id);
    if (!account) { setError('בחרו חשבון חיסכון'); return; }
    if ((entry && !form.reason.trim()) || !form.confirmed) { setError('יש לאשר את השפעת הפעולה ולהזין סיבה לתיקון או לביטול'); return; }
    const payout = form.destination === 'interest_payout';
    if (!cancelling && (!['interest_capitalized', 'interest_payout'].includes(form.destination) || !/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(form.amount) || !/[1-9]/.test(form.amount) || !isCalendarDate(form.effective_date))) { setError('בחרו יעד, סכום נטו חיובי עם עד שתי ספרות עשרוניות ותאריך תקין'); return; }
    if (!cancelling && payout && (!category || !form.payment_source_id || !isCalendarDate(form.charge_date) || !form.description.trim())) { setError('לריבית לעו״ש נדרשים קטגוריית ריבית פעילה, אמצעי תשלום, תאריך חיוב ותיאור'); return; }
    if (!entry && form.mode === 'link' && !cash) { setError('בחרו במפורש את ההכנסה הקיימת'); return; }
    const command = { account_id: form.account_id, event_kind: form.destination, amount: form.amount, effective_date: form.effective_date,
      action: payout ? (!entry && form.mode === 'link' ? 'link_cash' : restoring && cash && !cash.voided_at ? 'link_cash' : 'create_cash') : 'noncash', cutoff_confirmed: form.cutoff_confirmed };
    if (payout) Object.assign(command, { category_id: String(category.id), payment_source_id: form.payment_source_id, charge_date: form.charge_date, description: form.description, notes: form.notes || null });
    if (cash) Object.assign(command, { transaction_id: String(cash.id), expected_transaction_fingerprint: cash.transaction_fingerprint });
    if (entry) {
      if (restoring) command.reinstate = true;
      if (form.account_id !== String(entry.account_id)) command.expected_destination_revision = String(account.revision);
    } else command.expected_revision = String(account.revision);
    const body = entry ? cancelling ? { expected_revision: String(context.account.revision), cash_action: entry.transaction_id ? 'void' : 'none', reason: form.reason } : { expected_revision: String(context.account.revision), replacement: command, reason: form.reason } : { command };
    const fingerprint = JSON.stringify(body);
    if (receipt.current?.fingerprint !== fingerprint) receipt.current = { fingerprint, key: crypto.randomUUID() };
    setPending(true); setError('');
    try {
      const payload = { ...body, request_key: receipt.current.key };
      const { data } = await (entry ? cancelling ? cancelSavingsEvent(entry.id, payload) : correctSavingsEvent(entry.id, payload) : postSavingsEvent(payload));
      invalidateFinance(data); onClose(); await onSaved();
    } catch (failure) { setError(failure.response?.data?.error || 'הפעולה לא הושלמה. בדקו את הפרטים ורעננו אם היתרה השתנתה.'); }
    finally { setPending(false); }
  };
  const linked = !entry && form.mode === 'link';
  const payout = form.destination === 'interest_payout';
  const explanation = cancelling ? (entry?.transaction_id ? 'ההכנסה המקושרת תבוטל והרווח הממומש יוסר. יתרת החיסכון לא תשתנה.' : 'הריבית תוסר מהיתרה ומהרווח הממומש. הביטול יידחה אם ייצור יתרה שלילית בהיסטוריה.')
    : payout ? 'הכנסה אחת בעו״ש ורווח ממומש בחיסכון. יתרת הכסף המוחזק בחיסכון אינה גדלה.' : 'הריבית נטו נשארה בחיסכון: היתרה והרווח הממומש יגדלו. לא נוצרת תנועת הכנסה.';
  return <Dialog open={Boolean(context)} title={cancelling ? 'ביטול ריבית שנרשמה' : restoring ? 'החזרת ריבית שבוטלה' : entry ? 'תיקון ריבית שנרשמה' : 'רישום ריבית'} size="lg" onClose={onClose} closeDisabled={pending} initialFocusRef={cancelling ? undefined : amountRef} returnFocusRef={returnFocusRef}
    footer={<><SecondaryButton disabled={pending} onClick={onClose}>סגירה</SecondaryButton><PrimaryButton form="savings-interest-form" type="submit" loading={pending} disabled={!loaded || loading}>{cancelling ? 'אישור ביטול הריבית' : 'שמירת הריבית'}</PrimaryButton></>}>
    <form id="savings-interest-form" className="savings-form" onSubmit={save} noValidate>
      {error && <Alert variant="error" urgent>{error}</Alert>}
      <p>רישום סכום נטו שהתקבל בפועל בלבד. אין חישוב משוער, חישוב מס או העברה בנקאית.</p>
      {!cancelling && <div className="savings-form-grid">
        <Select label="חשבון חיסכון" value={form.account_id || ''} onValueChange={update('account_id')} disabled={pending} required>{accounts.filter(a => a.status === 'active' || String(a.account_id) === String(entry?.account_id)).map(a => <option key={a.account_id} value={a.account_id}>{a.name}{a.status === 'archived' ? ' (בארכיון)' : ''}</option>)}</Select>
        <Select label="לאן התקבלה הריבית?" value={form.destination || ''} onValueChange={value => { update('destination')(value); if (!entry) { setCash(null); update('mode')('create'); } }} disabled={pending || restoring} placeholder="בחירת יעד הריבית" required><option value="interest_capitalized">נשארה בתוך החיסכון</option><option value="interest_payout">שולמה ישירות לעו״ש</option></Select>
        <TextField ref={amountRef} label="סכום הריבית נטו (₪)" value={form.amount || ''} onValueChange={update('amount')} inputMode="decimal" technicalLtr required disabled={pending || linked} />
        <DateField label="תאריך קבלת הריבית" value={form.effective_date || ''} onValueChange={update('effective_date')} disabled={pending || linked} required />
      </div>}
      {!cancelling && payout && <fieldset disabled={pending}><legend>ההכנסה בעו״ש</legend>
        {!entry && <Select label="רישום ההכנסה" value={form.mode || 'create'} onValueChange={value => { update('mode')(value); setCash(null); if (value === 'link') loadCandidates(); }}><option value="create">יצירת הכנסה חדשה אחת</option><option value="link">קישור הכנסה קיימת ללא הכנסה נוספת</option></Select>}
        {linked && <><Select label="הכנסה קיימת לקישור" value={cash?.id || ''} onValueChange={chooseCash} placeholder="בחרו הכנסה" disabled={loading}>{candidates.map(t => <option key={t.id} value={t.id}>{t.description} · {t.total_amount} ₪ · {formatCalendarDate(t.transaction_date)}</option>)}</Select><SecondaryButton size="sm" disabled={loading} onClick={() => loadCandidates(cursor)}>{cursor ? 'הכנסות קודמות' : 'רענון הכנסות'}</SecondaryButton></>}
        <div className="savings-form-grid"><Select label="אמצעי תשלום / מקור ההכנסה" value={form.payment_source_id || ''} onValueChange={update('payment_source_id')} placeholder="בחירת מקור" disabled={linked} required>{sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select><DateField label="תאריך חיוב / זיכוי" value={form.charge_date || ''} onValueChange={update('charge_date')} disabled={linked} required /></div>
        <TextField label="תיאור ההכנסה" value={form.description || ''} onValueChange={update('description')} required />
      </fieldset>}
      {(form.destination || cancelling) && <Alert variant="info">{explanation}{entry && !cancelling && entry.event_kind !== form.destination && <p>{payout ? 'תיקון היעד יסיר את הריבית מהיתרה וייצור הכנסה חדשה אחת.' : 'תיקון היעד יבטל את ההכנסה המקורית ויוסיף את הריבית ליתרה.'} הרווח הישן מוחלף, ולא נספר פעמיים.</p>}{restoring && <p>{cash ? cash.voided_at ? 'תיווצר הכנסה חדשה; התנועה שבוטלה תישאר בהיסטוריה.' : 'אותה הכנסה חיה תקושר מחדש ללא כסף נוסף.' : 'הריבית תוחזר ברישום חדש בהיסטוריה ללא תנועת כסף.'}</p>}</Alert>}
      {!cancelling && <label className="savings-confirm"><input type="checkbox" checked={Boolean(form.cutoff_confirmed)} onChange={e => update('cutoff_confirmed')(e.target.checked)} disabled={pending} />הריבית אינה כלולה ביתרת הפתיחה (נדרש ביום תחילת המעקב)</label>}
      {entry && <TextArea label="סיבת התיקון / הביטול" value={form.reason || ''} onValueChange={update('reason')} required disabled={pending} />}
      <label className="savings-confirm"><input type="checkbox" checked={Boolean(form.confirmed)} onChange={e => update('confirmed')(e.target.checked)} disabled={pending} />אישרתי את הסכום, היעד והשפעת הפעולה המתוארת</label>
    </form>
  </Dialog>;
};
export default SavingsInterestDialog;
