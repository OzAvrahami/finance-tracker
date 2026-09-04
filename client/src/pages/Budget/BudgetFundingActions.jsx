import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, ShieldCheck } from 'lucide-react';
import {
  Alert,
  Dialog,
  NumberField,
  PrimaryButton,
  SecondaryButton,
  Select,
} from '../../components/ui';
import {
  applyBudgetReallocation,
  applyDeficitResolution,
  applyUnbudgetedResolution,
  getBudgetReallocationPreview,
  getDeficitResolutionPreview,
  getUnbudgetedResolutionPreview,
} from '../../services/api';
import { addMoney, compareMoney } from '../../utils/money';
import BudgetMoneyAmount from './BudgetMoneyAmount';

const requestKey = () => globalThis.crypto.randomUUID();

const endpoint = (value) => {
  if (value === 'unallocated') return { kind: 'unallocated', categoryId: null };
  return { kind: 'category', categoryId: Number(value.replace('category:', '')) };
};

export const UnbudgetedResolutionDialog = ({ open, month, category, rows, unallocated, savings, onClose, onApplied }) => {
  const [requestedAmount, setRequestedAmount] = useState('');
  const [amounts, setAmounts] = useState({});
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setRequestedAmount(category?.actual_spent || '');
      setAmounts({}); setPreview(null); setError('');
    }
  }, [open, category?.category_id, category?.actual_spent]);

  const candidates = rows.filter((candidate) => candidate.category_id !== category?.category_id
    && compareMoney(candidate.sourceCapacity) > 0);
  const legs = useMemo(() => Object.entries(amounts)
    .filter(([, amount]) => isPositiveMoney(amount))
    .map(([key, amount]) => {
      if (key === 'unallocated' || key === 'savings') return { source_kind: key, amount };
      return { source_kind: 'category', category_id: Number(key.replace('category:', '')), amount };
    }), [amounts]);
  const selectedTotal = useMemo(
    () => legs.reduce((sum, leg) => addMoney(sum, leg.amount), '0.00'),
    [legs]
  );
  const isZeroReactivation = category?.budget_id && compareMoney(requestedAmount || '0.00') === 0;
  const canReview = (isPositiveMoney(requestedAmount) && compareMoney(selectedTotal, requestedAmount) === 0)
    || (isZeroReactivation && legs.length === 0);

  const updateAmount = (key, value) => {
    setAmounts((current) => ({ ...current, [key]: value }));
    setPreview(null);
  };

  const review = async () => {
    if (!category || !canReview || loading) return;
    setLoading(true); setError(''); setPreview(null);
    try {
      const response = await getUnbudgetedResolutionPreview(month, category.category_id, {
        requested_amount: requestedAmount, legs,
      });
      setPreview(response.data);
    } catch (requestError) {
      setError(apiError(requestError, 'לא ניתן להכין את סקירת הקצאת התקציב.'));
    } finally { setLoading(false); }
  };

  const apply = async () => {
    if (!category || !preview?.can_apply || applying) return;
    setApplying(true); setError('');
    try {
      await applyUnbudgetedResolution(month, category.category_id, {
        requested_amount: requestedAmount,
        legs,
        request_key: requestKey(),
        preview_fingerprint: preview.fingerprint,
      });
      onApplied();
      onClose('applied');
    } catch (requestError) {
      setError(apiError(requestError, 'הקצאת התקציב נכשלה. הסכום ומקורות המימון נשמרו לסקירה חוזרת.'));
    } finally { setApplying(false); }
  };

  return (
    <Dialog
      open={open && Boolean(category)}
      onClose={onClose}
      title={`${category?.budget_id ? 'הפעלת תקציב מחדש' : 'יצירת תקציב חודשי'} — ${category?.categories?.name || ''}`}
      description="התקציב נפתח בסכום בסיס אפס. המימון שנבחר נרשם כתוספת מאוחרת ומפורשת, בלי לשנות את היסטוריית התנועות."
      size="lg"
      closeDisabled={applying}
      className="budget-funding-dialog"
      footer={(
        <>
          <SecondaryButton type="button" disabled={!canReview || applying} onClick={review} loading={loading} loadingText="בודק...">סקירת ההקצאה</SecondaryButton>
          <PrimaryButton type="button" disabled={!preview?.can_apply} loading={applying} loadingText="מקצה..." onClick={apply}>
            <ShieldCheck size={16} aria-hidden="true" /> הקצה תקציב לחודש זה
          </PrimaryButton>
        </>
      )}
    >
      <div className="budget-deficit-summary">
        <span>הוצאה ללא תקציב <BudgetMoneyAmount value={category?.actual_spent || '0.00'} /></span>
        <span>מימון קיים <BudgetMoneyAmount value={category?.final_funded || '0.00'} /></span>
        <strong>{category?.budget_id ? 'תקציב קיים לא פעיל' : 'לא היה תקציב פעיל בתחילת החודש'}</strong>
      </div>
      <NumberField id="unbudgeted-resolution-amount" label="סכום להקצאה" min="0" step="0.01" value={requestedAmount} onChange={(event) => { setRequestedAmount(event.target.value); setPreview(null); }} />
      <div className="budget-deficit-sources">
        <NumberField id="unbudgeted-source-unallocated" label={`כסף פנוי (זמין ${unallocated})`} min="0" step="0.01" value={amounts.unallocated || ''} onChange={(event) => updateAmount('unallocated', event.target.value)} />
        <NumberField id="unbudgeted-source-savings" label={`חיסכון (זמין ${savings})`} min="0" step="0.01" value={amounts.savings || ''} onChange={(event) => updateAmount('savings', event.target.value)} />
        {candidates.map((candidate) => (
          <NumberField key={candidate.id} id={`unbudgeted-source-${candidate.id}`} label={`${candidate.categoryName} (זמין ${candidate.sourceCapacity})`} min="0" step="0.01" value={amounts[`category:${candidate.category_id}`] || ''} onChange={(event) => updateAmount(`category:${candidate.category_id}`, event.target.value)} />
        ))}
      </div>
      <p className="budget-funding-dialog__selected">נבחר למימון: <BudgetMoneyAmount value={selectedTotal} /></p>
      {preview && (
        <div className="budget-funding-preview" aria-label="סקירת הקצאת תקציב להוצאה ללא תקציב">
          <span>מצב <strong>{preview.resolution_mode === 'reactivated' ? 'הפעלה מחדש' : 'יצירה'}</strong></span>
          <span>מימון לאחר ההקצאה <BudgetMoneyAmount value={preview.resulting_funded} /></span>
          <strong>גירעון שיישאר <BudgetMoneyAmount value={preview.remaining_deficit} /></strong>
          {!preview.can_apply && <Alert variant="error">{preview.reason}</Alert>}
        </div>
      )}
      {error && <Alert variant="error" urgent>{error}</Alert>}
    </Dialog>
  );
};

const apiError = (error, fallback) => error?.response?.data?.error || fallback;
const CANONICAL_POSITIVE_MONEY = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const isPositiveMoney = (value) => (
  typeof value === 'string' && CANONICAL_POSITIVE_MONEY.test(value) && compareMoney(value) > 0
);

export const BudgetReallocationDialog = ({ open, month, rows, unallocated, onClose, onApplied }) => {
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setSource(''); setDestination(''); setAmount(''); setPreview(null); setError('');
    }
  }, [open]);

  const body = useMemo(() => {
    if (!source || !destination || !isPositiveMoney(amount)) return null;
    const from = endpoint(source);
    const to = endpoint(destination);
    return {
      source_kind: from.kind,
      source_category_id: from.categoryId,
      destination_kind: to.kind,
      destination_category_id: to.categoryId,
      amount,
    };
  }, [amount, destination, source]);

  const review = async () => {
    if (!body || loading) return;
    setLoading(true); setError(''); setPreview(null);
    try {
      const response = await getBudgetReallocationPreview(month, body);
      setPreview(response.data);
    } catch (requestError) {
      setError(apiError(requestError, 'לא ניתן להכין את סקירת העברת התקציב.'));
    } finally { setLoading(false); }
  };

  const apply = async () => {
    if (!body || !preview?.can_apply || applying) return;
    setApplying(true); setError('');
    try {
      await applyBudgetReallocation(month, {
        ...body, request_key: requestKey(), preview_fingerprint: preview.fingerprint,
      });
      onApplied();
      onClose('applied');
    } catch (requestError) {
      setError(apiError(requestError, 'העברת התקציב נכשלה. הפרטים נשמרו ואפשר לסקור שוב.'));
    } finally { setApplying(false); }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="העברת תקציב"
      description="העברה מתוכננת בחודש הנוכחי בלבד, ללא שינוי בסכום המימון הכולל."
      closeDisabled={applying}
      className="budget-funding-dialog"
      footer={(
        <>
          <SecondaryButton type="button" disabled={applying} onClick={review} loading={loading} loadingText="בודק...">
            סקירת ההעברה
          </SecondaryButton>
          <PrimaryButton type="button" disabled={!preview?.can_apply} loading={applying} loadingText="מעביר..." onClick={apply}>
            <ArrowLeftRight size={16} aria-hidden="true" /> העברת התקציב
          </PrimaryButton>
        </>
      )}
    >
      <div className="budget-funding-dialog__fields">
        <Select id="budget-reallocation-source" label="מקור" value={source} onValueChange={(value) => { setSource(value); setPreview(null); }} placeholder="בחירת מקור">
          <option value="unallocated">טרם הוקצה — {unallocated}</option>
          {rows.filter((row) => compareMoney(row.sourceCapacity) > 0).map((row) => (
            <option key={row.id} value={`category:${row.category_id}`}>{row.categoryName} — {row.sourceCapacity}</option>
          ))}
        </Select>
        <Select id="budget-reallocation-destination" label="יעד" value={destination} onValueChange={(value) => { setDestination(value); setPreview(null); }} placeholder="בחירת יעד">
          <option value="unallocated">כסף שטרם הוקצה</option>
          {rows.map((row) => <option key={row.id} value={`category:${row.category_id}`}>{row.categoryName}</option>)}
        </Select>
        <NumberField id="budget-reallocation-amount" label="סכום להעברה" min="0.01" step="0.01" value={amount} onChange={(event) => { setAmount(event.target.value); setPreview(null); }} />
      </div>
      {preview && (
        <div className="budget-funding-preview" aria-label="סקירת העברת תקציב">
          <span>זמין במקור <BudgetMoneyAmount value={preview.source_capacity} /></span>
          <span>יעד לפני <BudgetMoneyAmount value={preview.destination_before} /></span>
          <span>יעד אחרי <BudgetMoneyAmount value={preview.destination_after} /></span>
          <span>טרם הוקצה אחרי <BudgetMoneyAmount value={preview.unallocated_after} /></span>
          {!preview.can_apply && <Alert variant="error">{preview.reason}</Alert>}
        </div>
      )}
      {error && <Alert variant="error" urgent>{error}</Alert>}
    </Dialog>
  );
};

export const DeficitResolutionDialog = ({ open, month, row, rows, unallocated, savings, onClose, onApplied }) => {
  const [amounts, setAmounts] = useState({});
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setAmounts({}); setPreview(null); setError(''); }
  }, [open, row?.id]);

  const candidates = rows.filter((candidate) => candidate.id !== row?.id && compareMoney(candidate.sourceCapacity) > 0);
  const legs = useMemo(() => Object.entries(amounts)
    .filter(([, amount]) => isPositiveMoney(amount))
    .map(([key, amount]) => {
      if (key === 'unallocated' || key === 'savings') return { source_kind: key, amount };
      return { source_kind: 'category', category_id: Number(key.replace('category:', '')), amount };
    }), [amounts]);
  const selectedTotal = useMemo(() => legs.reduce((sum, leg) => addMoney(sum, leg.amount), '0.00'), [legs]);

  const updateAmount = (key, value) => {
    setAmounts((current) => ({ ...current, [key]: value }));
    setPreview(null);
  };

  const review = async () => {
    if (!row || legs.length === 0 || loading) return;
    setLoading(true); setError(''); setPreview(null);
    try {
      const response = await getDeficitResolutionPreview(month, row.category_id, { legs });
      setPreview(response.data);
    } catch (requestError) {
      setError(apiError(requestError, 'לא ניתן להכין את סקירת פתרון החריגה.'));
    } finally { setLoading(false); }
  };

  const apply = async () => {
    if (!row || !preview?.can_apply || applying) return;
    setApplying(true); setError('');
    try {
      await applyDeficitResolution(month, row.category_id, {
        legs, request_key: requestKey(), preview_fingerprint: preview.fingerprint,
      });
      onApplied();
      onClose('applied');
    } catch (requestError) {
      setError(apiError(requestError, 'פתרון החריגה נכשל. בחירת מקורות המימון נשמרה.'));
    } finally { setApplying(false); }
  };

  return (
    <Dialog
      open={open && Boolean(row)}
      onClose={onClose}
      title={`פתרון חריגה — ${row?.categoryName || ''}`}
      description="אפשר לממן את החריגה באופן מלא או חלקי מכמה מקורות בפעולה אטומית אחת."
      size="lg"
      closeDisabled={applying}
      className="budget-funding-dialog"
      footer={(
        <>
          <SecondaryButton type="button" disabled={applying || legs.length === 0} onClick={review} loading={loading} loadingText="בודק...">סקירת המימון</SecondaryButton>
          <PrimaryButton type="button" disabled={!preview?.can_apply} loading={applying} loadingText="מממן..." onClick={apply}>
            <ShieldCheck size={16} aria-hidden="true" /> פתרון החריגה
          </PrimaryButton>
        </>
      )}
    >
      <div className="budget-deficit-summary">
        <span>ממומן <BudgetMoneyAmount value={row?.planned || '0.00'} /></span>
        <span>בפועל <BudgetMoneyAmount value={row?.actual || '0.00'} /></span>
        <strong>חריגה <BudgetMoneyAmount value={row?.remainingAbsolute || '0.00'} /></strong>
      </div>
      <div className="budget-deficit-sources">
        <NumberField id="deficit-source-unallocated" label={`טרם הוקצה (זמין ${unallocated})`} min="0" step="0.01" value={amounts.unallocated || ''} onChange={(event) => updateAmount('unallocated', event.target.value)} />
        <NumberField id="deficit-source-savings" label={`חיסכון (זמין ${savings})`} min="0" step="0.01" value={amounts.savings || ''} onChange={(event) => updateAmount('savings', event.target.value)} />
        {candidates.map((candidate) => (
          <NumberField key={candidate.id} id={`deficit-source-${candidate.id}`} label={`${candidate.categoryName} (זמין ${candidate.sourceCapacity})`} min="0" step="0.01" value={amounts[`category:${candidate.category_id}`] || ''} onChange={(event) => updateAmount(`category:${candidate.category_id}`, event.target.value)} />
        ))}
      </div>
      <p className="budget-funding-dialog__selected">נבחר למימון: <BudgetMoneyAmount value={selectedTotal} /></p>
      {preview && (
        <div className="budget-funding-preview" aria-label="סקירת פתרון חריגה">
          <span>סכום שיוחל <BudgetMoneyAmount value={preview.requested_resolution} /></span>
          <span>מימון אחרי <BudgetMoneyAmount value={preview.resulting_funded} /></span>
          <strong>חריגה שתישאר <BudgetMoneyAmount value={preview.remaining_deficit} /></strong>
          {!preview.can_apply && <Alert variant="error">{preview.reason}</Alert>}
        </div>
      )}
      {error && <Alert variant="error" urgent>{error}</Alert>}
    </Dialog>
  );
};
