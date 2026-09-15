import { useEffect, useRef, useState } from 'react';
import { Alert, DateField, Dialog, PrimaryButton, SecondaryButton, Select, TextField } from '../../components/ui';
import { correctSavingsEvent, getCategories, getPaymentSources, getSavingsAccount, getTransactionById, getTransactions, postSavingsEvent, updateSavingsAccount } from '../../services/api';
import { currentBusinessDate, formatCalendarDate } from '../../utils/calendarDate';
import { invalidateFinance } from '../../utils/financeInvalidation';

const SavingsMonthlyDialog = ({ context, onClose, onSaved, returnFocusRef }) => {
  const [account, setAccount] = useState(null), [sources, setSources] = useState([]), [category, setCategory] = useState(null);
  const [form, setForm] = useState({}), [cash, setCash] = useState(null), [rows, setRows] = useState([]), [cursor, setCursor] = useState(null);
  const [error, setError] = useState(''), [pending, setPending] = useState(false), [loading, setLoading] = useState(false);
  const receipt = useRef(null);
  const entry = context?.entry;
  const loadAccount = async id => { const { data } = await getSavingsAccount(id); setAccount(data.account); return data.account; };
  useEffect(() => {
    if (!context) return undefined;
    let active = true;
    setAccount(null); setError(''); setCash(null); setRows([]); setCursor(null); receipt.current = null;
    Promise.all([getSavingsAccount(String(context.account.id || context.account.account_id)), getCategories(), getPaymentSources()])
      .then(([result, categories, paymentSources]) => {
        if (!active) return;
        const a = result.data.account;
        setAccount(a); setCategory(categories.data.find(c => c.savings_role === 'deposit')); setSources(paymentSources.data);
        setForm({ mode: 'create', amount: entry?.amount && entry.amount !== '0.00' ? entry.amount : a.monthly_amount || '', date: currentBusinessDate(),
          source: a.default_payment_source_id || '', reason: '', override: false, cutoff: false, confirmed: false });
      }).catch(() => { if (active) setError('לא ניתן לטעון את התוכנית. סגרו ופתחו מחדש.'); });
    return () => { active = false; };
  }, [context, entry]);
  const update = key => value => setForm(old => ({ ...old, [key]: value, confirmed: false }));
  const candidates = async next => {
    setLoading(true); setError('');
    try {
      const { data } = await getTransactions({ limit: 50, cursor: next || undefined });
      const eligible = data.data.filter(t => t.movement_type === 'expense' && !t.voided_at && !t.loan_id
        && (!t.savings || (t.savings.active && t.savings.account_id === account.id && t.savings.event_kind === 'deposit' && t.savings.source_kind !== 'budget_surplus')));
      setRows(old => next ? [...old, ...eligible] : eligible); setCursor(data.pagination.nextCursor);
    } catch { setError('לא ניתן לטעון תנועות קיימות'); } finally { setLoading(false); }
  };
  const choose = async id => {
    setCash(null); if (!id) return;
    setLoading(true); setError('');
    try {
      const { data } = await getTransactionById(id); setCash(data);
      setForm(old => ({ ...old, amount: data.total_amount, date: data.transaction_date, source: String(data.payment_source_id), confirmed: false }));
    } catch { setError('לא ניתן לטעון את התנועה; בחרו אותה מחדש'); } finally { setLoading(false); }
  };
  const run = async (payload, operation) => {
    const fingerprint = JSON.stringify(payload);
    if (receipt.current?.fingerprint !== fingerprint) receipt.current = { fingerprint, key: crypto.randomUUID() };
    setPending(true); setError('');
    try {
      const { data } = await operation({ ...payload, request_key: receipt.current.key });
      invalidateFinance(data); await onSaved(); await loadAccount(account.id); setForm(old => ({ ...old, confirmed: false }));
      if (entry) onClose();
    } catch (failure) { setError(failure.response?.data?.error || 'הפעולה נכשלה. רעננו את הפרטים לפני ניסיון נוסף.'); }
    finally { setPending(false); }
  };
  const toggle = () => {
    if (!form.confirmed) { setError('יש לאשר במפורש את השינוי'); return; }
    run({ expected_revision: account.revision, account: { auto_deposit_enabled: !account.auto_deposit_enabled } }, body => updateSavingsAccount(account.id, body));
  };
  const save = event => {
    event.preventDefault(); if (pending || loading || !account) return;
    if (!form.confirmed) { setError('יש לאשר את הפעולה וההשפעה לפני השמירה'); return; }
    const due = entry?.scheduled_due_date || account.next_due_date;
    if (!due || (!entry && due > currentBusinessDate())) { setError('המועד טרם הגיע; לא נוצרות הוצאות עתידיות'); return; }
    const command = { account_id: account.id, expected_revision: account.revision, occurrence_month: due.slice(0, 7) + '-01', expected_due_date: due, plan_revision: account.plan_revision };
    if (form.mode === 'skip') {
      if (!form.reason.trim()) { setError('דילוג מחייב סיבה'); return; }
      return run({ command: { ...command, action: 'skip', reason: form.reason } }, postSavingsEvent);
    }
    if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(form.amount) || !form.source || !category || (form.mode === 'existing' && !cash)) {
      setError('יש לבחור סכום מדויק, מקור תשלום ותנועה קיימת אם נבחר קישור'); return;
    }
    const fields = { action: cash ? 'link_cash' : 'create_cash', event_kind: 'deposit', amount: form.amount, effective_date: form.date,
      charge_date: cash?.charge_date || form.date, category_id: String(category.id), payment_source_id: form.source,
      description: cash?.description || `הפקדה חודשית — ${account.name}`, notes: cash?.notes || null, cutoff_confirmed: form.cutoff,
      ...(cash ? { transaction_id: String(cash.id), expected_transaction_fingerprint: cash.transaction_fingerprint } : {}) };
    if (entry) {
      if (!form.reason.trim()) { setError('החזרת מועד מחייבת סיבה'); return; }
      return run({ expected_revision: account.revision, reason: form.reason, replacement: { ...fields, account_id: account.id, reinstate: true } }, body => correctSavingsEvent(entry.id, body));
    }
    return run({ command: { ...command, ...fields, plan_override: form.override, reason: form.reason || null } }, postSavingsEvent);
  };
  const busy = pending || loading || !account;
  return <Dialog open={Boolean(context)} title={entry ? 'החזרת מועד שדולג' : 'תוכנית הפקדות חודשית'} size="lg" onClose={onClose} closeDisabled={pending} returnFocusRef={returnFocusRef}
    footer={<><SecondaryButton disabled={pending} onClick={onClose}>סגירה</SecondaryButton><PrimaryButton form="savings-monthly-form" type="submit" disabled={busy || account?.status !== 'active'} loading={pending}>הסדרת המועד</PrimaryButton></>}>
    {error && <Alert variant="error" urgent>{error}</Alert>}
    {account && <form id="savings-monthly-form" className="savings-form" onSubmit={save}>
      <p><strong>{account.name}</strong> · {account.auto_deposit_enabled ? 'רישום אוטומטי פעיל' : 'רישום אוטומטי כבוי'}</p>
      <p>המועד הבא: {formatCalendarDate(entry?.scheduled_due_date || account.next_due_date)} · היום הנומינלי: {account.monthly_day || 'ללא תוכנית'}</p>
      <p>הרישום מתעד פעילות באפליקציה בלבד, ללא העברה בנקאית. בכל הרצה מוסדר רק המועד הישן ביותר שהגיע. בחודש קצר היום נצמד לסוף החודש וחוזר ליום המקורי בחודש הבא. השהיה אינה מוחקת מועדים.</p>
      {!entry && <SecondaryButton type="button" disabled={busy || !account.next_due_date || account.status !== 'active'} onClick={toggle}>{account.auto_deposit_enabled ? 'השהיית הרישום האוטומטי' : 'הפעלת רישום אוטומטי'}</SecondaryButton>}
      <fieldset disabled={busy}><legend>הסדרה מפורשת של המועד</legend>
        {!entry && <Select label="אופן ההסדרה" id="monthly-mode" value={form.mode} onValueChange={value => { update('mode')(value); setCash(null); if (value === 'existing') candidates(); }}>
          <option value="create">הוצאה והפקדה חדשות</option><option value="existing">קישור תנועה או הפקדה קיימת</option><option value="skip">דילוג ללא כסף</option>
        </Select>}
        {form.mode === 'existing' && <><Select label="תנועה קיימת" id="monthly-cash" value={cash?.id || ''} onValueChange={choose}><option value="">בחרו תנועה</option>{rows.map(t => <option key={t.id} value={t.id}>{t.description} · {t.total_amount} · {t.transaction_date}</option>)}</Select>{cursor && <SecondaryButton type="button" onClick={() => candidates(cursor)}>תנועות נוספות</SecondaryButton>}<p>הכסף הקיים יישמר. הפקדה שכבר מקושרת לא תגדיל שוב את היתרה. התאמה סופית נבדקת בשמירה.</p></>}
        {form.mode !== 'skip' && <div className="savings-form-grid">
          <TextField id="monthly-amount" label="סכום ההפקדה (₪)" value={form.amount} onValueChange={update('amount')} inputMode="decimal" technicalLtr disabled={Boolean(cash)} />
          <DateField id="monthly-date" label="תאריך הכסף בפועל" value={form.date} onValueChange={update('date')} disabled={Boolean(cash)} />
          <Select id="monthly-source" label="אמצעי תשלום" value={form.source} onValueChange={update('source')} disabled={Boolean(cash)}><option value="">בחרו מקור</option>{sources.filter(s => s.is_active !== false).map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}</Select>
        </div>}
        <TextField id="monthly-reason" label="סיבה לדילוג, חריגה או החזרה" value={form.reason} onValueChange={update('reason')} maxLength={2000} />
        {form.mode !== 'skip' && <><label className="savings-confirm"><input type="checkbox" checked={form.override} onChange={e => update('override')(e.target.checked)} />אני מאשר/ת סכום או מקור שונים מהתוכנית, עם סיבה</label>
          <label className="savings-confirm"><input type="checkbox" checked={form.cutoff} onChange={e => update('cutoff')(e.target.checked)} />אם התאריך ביום הפתיחה, הכסף אינו כלול ביתרת הפתיחה</label></>}
        <label className="savings-confirm"><input type="checkbox" checked={form.confirmed} onChange={e => setForm(old => ({ ...old, confirmed: e.target.checked }))} />אישרתי את המועד והפעולה: {form.mode === 'skip' ? 'ללא כסף או שינוי יתרה' : cash?.savings?.active ? 'ללא כסף נוסף וללא גידול נוסף ביתרה' : `הוצאה אחת והגדלת החיסכון ב־${form.amount || '0'} ₪`}. הפעלה/השהיה משנה את הרישום האוטומטי בלבד.</label>
      </fieldset>
    </form>}
  </Dialog>;
};
export default SavingsMonthlyDialog;
