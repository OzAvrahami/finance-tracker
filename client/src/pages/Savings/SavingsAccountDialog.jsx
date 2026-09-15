import { useEffect, useRef, useState } from 'react';
import { Alert, DateField, Dialog, PrimaryButton, SecondaryButton, Select, TextArea, TextField } from '../../components/ui';
import { getPaymentSources } from '../../services/api';
import { initialSavingsForm, savingsFormError, savingsPayload } from './savingsForm';

const SavingsAccountDialog = ({ open, account, onClose, onSave, returnFocusRef }) => {
  const [form, setForm] = useState(() => initialSavingsForm(account));
  const [confirmed, setConfirmed] = useState(false);
  const [sources, setSources] = useState([]);
  const [sourcesError, setSourcesError] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const nameRef = useRef(null);
  const receipt = useRef(null);
  const editing = Boolean(account);
  useEffect(() => {
    if (!open) return undefined;
    setForm(initialSavingsForm(account)); setConfirmed(false); setError(''); receipt.current = null;
    let active = true;
    setSourcesError(false);
    getPaymentSources().then(({ data }) => { if (active) setSources(data || []); })
      .catch(() => { if (active) setSourcesError(true); });
    return () => { active = false; };
  }, [open, account]);
  const update = (key) => (value) => setForm((old) => ({ ...old, [key]: value }));
  const field = (key, label, props = {}) => <TextField id={`savings-${key}`} label={label} value={form[key]} onValueChange={update(key)} disabled={pending} {...props} />;
  const date = (key, label, required = false) => <DateField id={`savings-${key}`} label={label} required={required} value={form[key]} onValueChange={update(key)} disabled={pending} />;
  const save = async (event) => {
    event.preventDefault();
    if (pending) return;
    const validation = savingsFormError(form, editing, confirmed);
    if (validation) { setError(validation); return; }
    const payload = savingsPayload(form, editing);
    if (editing) payload.expected_revision = account.revision;
    const fingerprint = JSON.stringify(payload);
    if (receipt.current?.fingerprint !== fingerprint) receipt.current = { fingerprint, key: crypto.randomUUID() };
    setPending(true); setError('');
    try { await onSave({ ...payload, request_key: receipt.current.key }); }
    catch (failure) { setError(failure.response?.data?.error || 'השמירה נכשלה. הפרטים נשמרו; ניתן לנסות שוב.'); }
    finally { setPending(false); }
  };
  return <Dialog open={open} title={editing ? 'עריכת חשבון חיסכון' : 'חשבון חיסכון חדש'} size="lg"
    description="פרטי החשבון, יעד ותוכנית חודשית. שמירת פרטים אינה מבצעת העברה בנקאית."
    onClose={onClose} closeDisabled={pending} initialFocusRef={nameRef} returnFocusRef={returnFocusRef}
    footer={<><SecondaryButton disabled={pending} onClick={onClose}>ביטול</SecondaryButton><PrimaryButton form="savings-account-form" type="submit" loading={pending}>שמירת החיסכון</PrimaryButton></>}>
    <form id="savings-account-form" onSubmit={save} className="savings-form" noValidate>
      {error && <Alert variant="error" urgent>{error}</Alert>}
      <fieldset disabled={pending}><legend>פרטי החשבון</legend><div className="savings-form-grid">
        {field('name', 'שם החיסכון', { required: true, ref: nameRef, maxLength: 200 })}
        {field('purpose', 'מטרת החיסכון', { maxLength: 2000 })}
        {field('institution_name', 'בנק או גוף מנהל', { maxLength: 200 })}
        {field('product_name', 'שם המוצר', { maxLength: 200 })}
        {field('reference', 'מספר אסמכתה (רשות)', { maxLength: 200 })}
      </div></fieldset>
      {!editing && <fieldset disabled={pending}><legend>יתרת פתיחה ותחילת מעקב</legend>
        <p>יתרת הפתיחה היא הסכום שאומת בתחילת יום המעקב. תנועה באותו יום נכללת אחריה רק אם אינה כלולה ביתרה. לא נוצרת תנועת הכנסה.</p>
        <div className="savings-form-grid">
          {date('opened_on', 'תאריך פתיחת החשבון', true)}{date('tracking_start_date', 'תחילת המעקב', true)}
          {field('opening_amount', 'יתרת פתיחה מאומתת (₪)', { required: true, inputMode: 'decimal', technicalLtr: true })}
          {field('legacy_overlap_amount', 'סכום שכבר כלול ברזרבת התקציב הישנה (₪)', { required: true, inputMode: 'decimal', technicalLtr: true, helperText: 'הזינו 0 אם אין חפיפה. חפיפה מאושרת תוסר מהרזרבה בלבד, בלי הפקדה נוספת.' })}
        </div>
        {field('overlap_reason', 'הסבר ואסמכתה לחפיפה', { maxLength: 2000 })}
        <label className="savings-confirm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />אימתתי את יתרת הפתיחה, גבול המעקב והחפיפה לרזרבה</label>
      </fieldset>}
      <fieldset disabled={pending}><legend>יעד (רשות)</legend><div className="savings-form-grid">
        {field('target_amount', 'סכום יעד (₪)', { inputMode: 'decimal', technicalLtr: true })}{date('target_date', 'תאריך יעד')}
      </div><p>אפשר לחסוך ללא יעד. הגעה ליעד אינה סוגרת את החשבון.</p></fieldset>
      <fieldset disabled={pending}><legend>ריבית ותנאי נזילות (מידע בלבד)</legend><div className="savings-form-grid">
        {field('annual_interest_rate', 'ריבית שנתית תיאורית (%)', { inputMode: 'decimal', technicalLtr: true })}{date('release_date', 'מועד נזילות או שחרור')}
      </div>{field('terms', 'תנאי החיסכון', { maxLength: 10000 })}{field('liquidity_notes', 'מידע על נזילות', { maxLength: 10000 })}
        <p>הריבית נשמרת כתיאור בלבד; אינה מחושבת או נרשמת ביתרה.</p>
      </fieldset>
      <fieldset disabled={pending}><legend>תוכנית חודשית (שמירת הגדרות בלבד)</legend><div className="savings-form-grid">
        {field('monthly_amount', 'סכום חודשי (₪)', { inputMode: 'decimal', technicalLtr: true })}
        {field('monthly_day', 'יום בחודש (1–31)', { inputMode: 'numeric', technicalLtr: true })}
        {date('plan_start_date', 'תחילת התוכנית')}
        <Select id="savings-default-source" label="אמצעי תשלום מתוכנן" value={form.default_payment_source_id} onValueChange={update('default_payment_source_id')}>
          <option value="">ללא מקור ברירת מחדל</option>
          {sources.filter((s) => s.is_active !== false || String(s.id) === form.default_payment_source_id).map((s) => <option key={s.id} value={String(s.id)} disabled={s.is_active === false}>{s.name}{s.is_active === false ? ' (לא פעיל)' : ''}</option>)}
        </Select>
      </div>{sourcesError && <Alert variant="warning">לא ניתן לטעון אמצעי תשלום. אפשר לשמור ללא מקור חדש ולבחור אותו מאוחר יותר.</Alert>}
        <p>שמירת התוכנית אינה מפעילה רישום אוטומטי. הפעלה או השהיה מפורשות זמינות ב״תוכנית חודשית״. אין יצירת תנועות עתידיות; בחודש קצר המועד יהיה ביום האחרון.</p>
      </fieldset>
      <TextArea id="savings-notes" label="הערות" value={form.notes} onValueChange={update('notes')} maxLength={10000} disabled={pending} />
    </form>
  </Dialog>;
};
export default SavingsAccountDialog;
