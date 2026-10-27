import { useRef, useState } from 'react';
import { Alert, Button, Dialog, MoneyAmount, SecondaryButton } from '../ui';
import { confirmLegoRepurchase } from '../../services/api';
import { invalidateLegoCollection } from '../../utils/legoCollectionInvalidation';

export default function LegoRepurchaseDialog({ candidate, onDone }) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const confirm = async () => {
    if (busy.current || success || stale) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      await confirmLegoRepurchase(candidate.confirmation_token);
      invalidateLegoCollection();
      setSuccess(true);
    } catch (failure) {
      const changed = failure.response?.status === 409;
      setStale(changed);
      setError(changed
        ? 'האישור פג או שפרטי הרכישה השתנו. ניתן להחזיר את הסט ידנית דרך האוסף.'
        : 'החזרת הסט נכשלה. התנועה כבר נשמרה — ניתן לנסות שוב בלי לשמור אותה מחדש.');
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return <Dialog open size="sm" title="החזרה לאוסף לאחר רכישה"
    description="התנועה נשמרה בהצלחה. הבחירה כאן אינה משנה את התנועה הכספית."
    onClose={() => { if (!busy.current) onDone(); }} closeDisabled={pending}
    footer={<>
      {success ? <Button onClick={onDone}>המשך</Button> : <>
        <SecondaryButton disabled={pending} onClick={onDone}>לא כרגע</SecondaryButton>
        <Button onClick={confirm} disabled={stale} loading={pending} loadingText="מחזיר לאוסף…">החזר לאוסף</Button>
      </>}
    </>}>
    <div dir="rtl">
      <p><bdi>{candidate.set_number}</bdi> — {candidate.name}</p>
      {success ? <Alert variant="success" title="הסט הוחזר לאוסף">פרטי הרכישה והסיכומים באוסף עודכנו.</Alert> : <>
        <p>סט הלגו הזה נמכר בעבר. להחזיר אותו לאוסף?</p>
        <p>עלות הרכישה החדשה: <MoneyAmount value={candidate.purchase_price} /></p>
        {candidate.purchase_date && <p>תאריך רכישה: <bdi>{candidate.purchase_date}</bdi></p>}
        <p>אופן קבלה: {{ purchase: 'רכישה', gift: 'מתנה', gwp: 'מתנה ברכישה (GWP)' }[candidate.acquisition_type]}</p>
        <p>פרטי הרכישה יוחלפו לפי התנועה שנשמרה ומצב ההרכבה יהיה חדש. ניתן לשנות אותו לאחר מכן באוסף.</p>
      </>}
      {error && <Alert variant="error" urgent title="הסט לא הוחזר">{error}</Alert>}
    </div>
  </Dialog>;
}
