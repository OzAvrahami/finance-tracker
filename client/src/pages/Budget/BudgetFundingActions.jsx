import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  addMoney,
  compareMoney,
  moneyFromMinorUnits,
  moneyToMinorUnits,
  subtractMoney,
} from '../../utils/money';
import BudgetMoneyAmount from './BudgetMoneyAmount';
import { formatBudgetMonth } from './budgetMonth';

const requestKey = () => globalThis.crypto.randomUUID();

const endpoint = (value) => {
  if (value === 'unallocated') return { kind: 'unallocated', categoryId: null };
  return { kind: 'category', categoryId: Number(value.replace('category:', '')) };
};

// Both entry points share selection/preview UI; the operation remains explicit.
const AllocationResolutionDialog = ({ open, month, category, rows, unallocated, savings, onClose, onApplied, mode }) => {
  const isDeficit = mode === 'deficit';
  const applyingRef = useRef(false);
  const receiptRef = useRef(null);
  const [requestedAmount, setRequestedAmount] = useState('');
  const [unallocatedAmount, setUnallocatedAmount] = useState('0.00');
  const [additionalSources, setAdditionalSources] = useState([]);
  const [sourceEditorOpen, setSourceEditorOpen] = useState(false);
  const [sourcesCustomized, setSourcesCustomized] = useState(false);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const previewSequence = useRef(0);
  const sourceSequence = useRef(0);
  const categoryId = category?.category_id;

  useEffect(() => {
    if (open) {
      const retainedFunding = category?.final_funded || '0.00';
      const actual = category?.actual_spent || '0.00';
      const fundingNeeded = compareMoney(actual, retainedFunding) > 0
        ? subtractMoney(actual, retainedFunding)
        : '0.00';
      const defaultUnallocated = compareMoney(fundingNeeded, unallocated || '0.00') <= 0
        ? fundingNeeded
        : (unallocated || '0.00');
      setRequestedAmount(fundingNeeded);
      setUnallocatedAmount(defaultUnallocated);
      setAdditionalSources([]);
      setSourceEditorOpen(compareMoney(fundingNeeded, unallocated || '0.00') > 0);
      setSourcesCustomized(false);
      setPreview(null); setError(''); setPreviewAttempt(0);
    }
  }, [open, category?.category_id, category?.actual_spent, category?.final_funded, unallocated]);

  const candidates = rows.filter((candidate) => candidate.category_id !== category?.category_id
    && compareMoney(candidate.sourceCapacity) > 0);
  const sourceCapacity = (sourceKey) => {
    if (sourceKey === 'savings') return savings || '0.00';
    if (sourceKey?.startsWith('category:')) {
      return candidates.find((candidate) => `category:${candidate.category_id}` === sourceKey)?.sourceCapacity || '0.00';
    }
    return '0.00';
  };
  const legs = useMemo(() => {
    const result = [];
    if (isPositiveMoney(unallocatedAmount)) {
      result.push({ source_kind: 'unallocated', amount: canonicalMoney(unallocatedAmount) });
    }
    additionalSources.forEach((source) => {
      if (!source.sourceKey || !isPositiveMoney(source.amount)) return;
      if (source.sourceKey === 'savings') {
        result.push({ source_kind: 'savings', amount: canonicalMoney(source.amount) });
      } else {
        result.push({
          source_kind: 'category',
          category_id: Number(source.sourceKey.replace('category:', '')),
          amount: canonicalMoney(source.amount),
        });
      }
    });
    return result;
  }, [additionalSources, unallocatedAmount]);
  const selectedTotal = useMemo(
    () => legs.reduce((sum, leg) => addMoney(sum, leg.amount), '0.00'),
    [legs]
  );
  const isZeroReactivation = !isDeficit && category?.budget_id && isValidNonNegativeMoney(requestedAmount) && compareMoney(requestedAmount) === 0;
  const sourceKeys = additionalSources.map((source) => source.sourceKey).filter(Boolean);
  const hasDuplicateSources = new Set(sourceKeys).size !== sourceKeys.length;
  const safeUnallocatedAmount = isValidNonNegativeMoney(unallocatedAmount) ? canonicalMoney(unallocatedAmount) : '0.00';
  const hasInvalidUnallocated = Boolean(unallocatedAmount) && !isValidNonNegativeMoney(unallocatedAmount);
  const capacityProblem = compareMoney(safeUnallocatedAmount, unallocated || '0.00') > 0
    ? 'הסכום שנבחר מכסף שטרם הוקצה גבוה מהיתרה הזמינה.'
    : additionalSources.reduce((problem, source) => {
      if (problem || !source.sourceKey || !isPositiveMoney(source.amount)) return problem;
      return compareMoney(source.amount, sourceCapacity(source.sourceKey)) > 0
        ? 'אחד ממקורות המימון גבוה מהסכום הזמין בו.'
        : '';
    }, '');
  const hasIncompleteSource = additionalSources.some((source) => !source.sourceKey || !isPositiveMoney(source.amount));
  const requestedCanonical = isValidNonNegativeMoney(requestedAmount) ? canonicalMoney(requestedAmount) : null;
  const canPreview = Boolean(requestedCanonical) && !hasDuplicateSources && !hasIncompleteSource && !hasInvalidUnallocated && !capacityProblem
    && ((compareMoney(requestedCanonical) > 0 && compareMoney(selectedTotal, requestedCanonical) === 0)
      || (isZeroReactivation && legs.length === 0));
  const proposal = useMemo(() => (
    canPreview ? (isDeficit ? { legs } : { requested_amount: requestedCanonical, legs }) : null
  ), [canPreview, isDeficit, legs, requestedCanonical]);
  const proposalKey = proposal ? JSON.stringify(proposal) : '';
  const contextKey = JSON.stringify({ mode, month, categoryId, funded: category?.final_funded, actual: category?.actual_spent,
    unallocated, savings, capacities: rows.map(row => [row.category_id, row.sourceCapacity]) });
  const previewIsCurrent = Boolean(preview?.data && preview.proposalKey === proposalKey && preview.contextKey === contextKey);
  const requestedGap = requestedCanonical ? subtractMoney(requestedCanonical, selectedTotal) : '0.00';
  const unallocatedAfter = compareMoney(unallocated || '0.00', safeUnallocatedAmount) >= 0
    ? subtractMoney(unallocated || '0.00', safeUnallocatedAmount)
    : '0.00';

  const resetPreview = () => {
    previewSequence.current += 1;
    setPreview(null);
    setError('');
  };

  const changeRequestedAmount = (value) => {
    setRequestedAmount(value);
    if (!sourcesCustomized && isValidNonNegativeMoney(value)) {
      const canonical = canonicalMoney(value);
      const nextUnallocated = compareMoney(canonical, unallocated || '0.00') <= 0
        ? canonical
        : (unallocated || '0.00');
      setUnallocatedAmount(nextUnallocated);
      if (compareMoney(canonical, unallocated || '0.00') > 0) setSourceEditorOpen(true);
    }
    resetPreview();
  };

  const changeUnallocatedAmount = (value) => {
    setUnallocatedAmount(value);
    setSourcesCustomized(true);
    resetPreview();
  };

  const addSource = () => {
    sourceSequence.current += 1;
    setAdditionalSources((current) => [...current, { id: sourceSequence.current, sourceKey: '', amount: '' }]);
    setSourcesCustomized(true);
    resetPreview();
  };

  const updateSource = (id, changes) => {
    setAdditionalSources((current) => current.map((source) => (
      source.id === id ? { ...source, ...changes } : source
    )));
    setSourcesCustomized(true);
    resetPreview();
  };

  const removeSource = (id) => {
    setAdditionalSources((current) => current.filter((source) => source.id !== id));
    setSourcesCustomized(true);
    resetPreview();
  };

  useEffect(() => {
    if (!open || !categoryId || !proposal) {
      setLoading(false);
      setPreview(null);
      return undefined;
    }

    const sequence = ++previewSequence.current;
    setLoading(true);
    setPreview(null);
    setError('');
    const timer = setTimeout(async () => {
      try {
        const response = await (isDeficit ? getDeficitResolutionPreview : getUnbudgetedResolutionPreview)(month, categoryId, proposal);
        if (previewSequence.current === sequence) {
          setPreview({ data: response.data, proposalKey, contextKey });
        }
      } catch (requestError) {
        if (previewSequence.current === sequence) {
          setError(unbudgetedApiError(requestError, 'לא ניתן להכין את הצעת ההקצאה. אפשר לנסות שוב.'));
        }
      } finally {
        if (previewSequence.current === sequence) setLoading(false);
      }
    }, 200);

    return () => {
      clearTimeout(timer);
      if (previewSequence.current === sequence) previewSequence.current += 1;
    };
  }, [categoryId, contextKey, isDeficit, month, open, previewAttempt, proposal, proposalKey]);

  const apply = async () => {
    if (!category || !proposal || !previewIsCurrent || !preview.data.can_apply || applyingRef.current) return;
    applyingRef.current = true;
    setApplying(true); setError('');
    try {
      const signature = JSON.stringify([contextKey, proposalKey, preview.data.fingerprint]);
      if (receiptRef.current?.signature !== signature) receiptRef.current = { signature, key: requestKey() };
      await (isDeficit ? applyDeficitResolution : applyUnbudgetedResolution)(month, category.category_id, {
        ...proposal,
        request_key: receiptRef.current.key,
        preview_fingerprint: preview.data.fingerprint,
      });
      onApplied();
      onClose('applied');
    } catch (requestError) {
      setError(unbudgetedApiError(requestError, 'הקצאת התקציב נכשלה. הסכום ומקורות המימון נשמרו לסקירה חוזרת.'));
      if (String(requestError?.response?.data?.error || requestError?.response?.data?.code || '').includes('PREVIEW_STALE')) {
        setPreview(null);
      }
    } finally { applyingRef.current = false; setApplying(false); }
  };

  const previewData = previewIsCurrent ? preview.data : null;
  const categoryName = category?.categories?.name || 'הקטגוריה';
  const fundingMismatch = requestedCanonical && compareMoney(requestedGap) !== 0
    ? (compareMoney(requestedGap) > 0
      ? `חסר מקור מימון ל־${requestedGap}`
      : `נבחר מימון עודף של ${moneyFromMinorUnits(-moneyToMinorUnits(requestedGap))}`)
    : '';

  return (
    <Dialog
      open={open && Boolean(category)}
      onClose={onClose}
      title={isDeficit ? `פתרון חריגה — ${categoryName}` : `הקצאת תקציב ל${categoryName}`}
      description={isDeficit ? 'בחרו מימון נוסף לכיסוי מלא או חלקי של החריגה, ללא שינוי בהוצאה בפועל.' : 'בחרו כמה להקצות לקטגוריה. ההקצאה תתבצע רק לאחר אישור מפורש.'}
      size="lg"
      closeDisabled={applying}
      className="budget-funding-dialog budget-unbudgeted-resolution-dialog"
      footer={(
        <PrimaryButton type="button" disabled={!previewData?.can_apply || loading} loading={applying} loadingText="מקצה..." onClick={apply}>
          <ShieldCheck size={16} aria-hidden="true" /> {isDeficit ? 'פתרון החריגה' : `הקצה תקציב ל${categoryName}`}
        </PrimaryButton>
      )}
    >
      <fieldset disabled={applying} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="budget-unbudgeted-resolution__context" aria-label="פרטי ההוצאה והתקציב">
        <span>חודש <strong>{formatBudgetMonth(month)}</strong></span>
        <span>הוצאה בפועל <BudgetMoneyAmount value={category?.actual_spent || '0.00'} /></span>
        <span>מימון קיים בקטגוריה <BudgetMoneyAmount value={category?.final_funded || '0.00'} /></span>
        {isDeficit && <strong>חריגה נוכחית <BudgetMoneyAmount value={subtractMoney(category?.actual_spent || '0.00', category?.final_funded || '0.00')} /></strong>}
        {!isDeficit && category?.budget_id && <strong className="budget-unbudgeted-resolution__mode">הפעלת תקציב קיים מחדש</strong>}
      </div>
      <div className="budget-unbudgeted-resolution__amount">
        <NumberField id="unbudgeted-resolution-amount" label="סכום להקצאה" min="0" step="0.01" value={requestedAmount} onChange={(event) => changeRequestedAmount(event.target.value)} />
      </div>

      <div className="budget-unbudgeted-resolution__proposal" aria-label="הצעת הקצאה">
        <div>
          <span>מקור ברירת מחדל</span>
          <strong>כסף שטרם הוקצה</strong>
        </div>
        <div>
          <span>יוקצה ל{categoryName}</span>
          <BudgetMoneyAmount value={requestedCanonical || '0.00'} />
        </div>
        <div>
          <span>יישאר טרם מוקצה</span>
          <BudgetMoneyAmount value={unallocatedAfter} />
        </div>
      </div>

      <SecondaryButton
        type="button"
        size="sm"
        className="budget-unbudgeted-resolution__source-toggle"
        aria-expanded={sourceEditorOpen}
        aria-controls="unbudgeted-resolution-sources"
        onClick={() => setSourceEditorOpen((current) => !current)}
      >
        {sourceEditorOpen ? 'סגירת בחירת מקורות' : 'שינוי מקור המימון'}
      </SecondaryButton>

      {sourceEditorOpen && (
        <section id="unbudgeted-resolution-sources" className="budget-unbudgeted-resolution__sources" aria-labelledby="unbudgeted-resolution-sources-title">
          <div className="budget-unbudgeted-resolution__sources-heading">
            <div>
              <h3 id="unbudgeted-resolution-sources-title">מקורות מימון</h3>
              <p>אפשר לשלב כסף שטרם הוקצה עם קטגוריות אחרות או עם החיסכון.</p>
            </div>
            <SecondaryButton type="button" size="sm" onClick={addSource}>הוספת מקור נוסף</SecondaryButton>
          </div>
          <div className="budget-unbudgeted-resolution__source-row">
            <div className="budget-unbudgeted-resolution__source-name">
              <strong>כסף שטרם הוקצה</strong>
              <span>זמין: <BudgetMoneyAmount value={unallocated || '0.00'} /></span>
            </div>
            <NumberField id="unbudgeted-source-unallocated" label="סכום ממקור זה" min="0" step="0.01" value={unallocatedAmount} onChange={(event) => changeUnallocatedAmount(event.target.value)} />
          </div>
          {additionalSources.map((source) => {
            const usedByOtherRows = new Set(additionalSources
              .filter((candidate) => candidate.id !== source.id)
              .map((candidate) => candidate.sourceKey)
              .filter(Boolean));
            return (
              <div className="budget-unbudgeted-resolution__source-row budget-unbudgeted-resolution__source-row--additional" key={source.id}>
                <Select
                  id={`unbudgeted-source-kind-${source.id}`}
                  label="מקור נוסף"
                  value={source.sourceKey}
                  onValueChange={(value) => updateSource(source.id, { sourceKey: value, amount: '' })}
                  placeholder="בחירת מקור מימון"
                >
                  {compareMoney(savings || '0.00') > 0 && !usedByOtherRows.has('savings') && (
                    <option value="savings">חיסכון — זמין {savings}</option>
                  )}
                  {candidates.filter((candidate) => !usedByOtherRows.has(`category:${candidate.category_id}`)).map((candidate) => (
                    <option key={candidate.id} value={`category:${candidate.category_id}`}>
                      {candidate.categoryName} — זמין {candidate.sourceCapacity}
                    </option>
                  ))}
                </Select>
                <NumberField
                  id={`unbudgeted-source-amount-${source.id}`}
                  label="סכום להעברה"
                  min="0"
                  step="0.01"
                  value={source.amount}
                  onChange={(event) => updateSource(source.id, { amount: event.target.value })}
                />
                <SecondaryButton type="button" size="sm" onClick={() => removeSource(source.id)} aria-label={`הסרת מקור מימון ${source.id}`}>
                  הסרה
                </SecondaryButton>
                {source.sourceKey && (
                  <span className="budget-unbudgeted-resolution__capacity">זמין במקור: <BudgetMoneyAmount value={sourceCapacity(source.sourceKey)} /></span>
                )}
              </div>
            );
          })}
          <p className="budget-funding-dialog__selected">נבחר למימון: <BudgetMoneyAmount value={selectedTotal} /> מתוך <BudgetMoneyAmount value={requestedCanonical || '0.00'} /></p>
        </section>
      )}

      {compareMoney(requestedGap) > 0 && (
        <Alert variant="warning">מכסף שטרם הוקצה נבחרו <BudgetMoneyAmount value={safeUnallocatedAmount} />. {fundingMismatch}.</Alert>
      )}
      {compareMoney(requestedGap) < 0 && <Alert variant="error">{fundingMismatch}.</Alert>}
      {hasDuplicateSources && <Alert variant="error">אי אפשר לבחור את אותו מקור מימון יותר מפעם אחת.</Alert>}
      {((requestedAmount && !requestedCanonical) || hasInvalidUnallocated || additionalSources.some(source => source.amount && !isValidNonNegativeMoney(source.amount))) && <Alert variant="error">יש להזין סכום לא שלילי עם עד שתי ספרות אחרי הנקודה.</Alert>}
      {capacityProblem && <Alert variant="error">{capacityProblem}</Alert>}

      {loading && <p className="budget-unbudgeted-resolution__preview-status" role="status">מכין הצעה מאובטחת...</p>}
      {previewData && (
        <div className="budget-funding-preview" aria-label={isDeficit ? 'סקירת פתרון חריגה' : 'סקירת הקצאת תקציב להוצאה ללא תקציב'}>
          {!isDeficit && <span>מצב <strong>{previewData.resolution_mode === 'reactivated' ? 'הפעלה מחדש' : 'יצירה'}</strong></span>}
          <span>תקציב לאחר ההקצאה <BudgetMoneyAmount value={previewData.resulting_funded} /></span>
          <strong>חריגה שתישאר <BudgetMoneyAmount value={previewData.remaining_deficit} /></strong>
          {!previewData.can_apply && <Alert variant="error">{unbudgetedErrorMessage(previewData.reason)}</Alert>}
        </div>
      )}
      {error && (
        <Alert variant="error" urgent>
          {error}
          {!loading && proposal && !previewData && (
            <SecondaryButton type="button" size="sm" onClick={() => setPreviewAttempt((attempt) => attempt + 1)}>נסה שוב</SecondaryButton>
          )}
        </Alert>
      )}
      </fieldset>
    </Dialog>
  );
};

export const UnbudgetedResolutionDialog = (props) => <AllocationResolutionDialog {...props} mode="unbudgeted" />;

export const DeficitResolutionDialog = ({ row, ...props }) => (
  <AllocationResolutionDialog
    {...props}
    mode="deficit"
    category={row ? {
      category_id: row.category_id,
      final_funded: row.planned,
      actual_spent: row.actual,
      categories: { name: row.categoryName },
    } : null}
  />
);

const apiError = (error, fallback) => error?.response?.data?.error || fallback;
const UNBUDGETED_ERROR_MESSAGES = {
  DEFICIT_RESOLUTION_PREVIEW_STALE: 'נתוני התקציב השתנו מאז הכנת ההצעה. בדקו את מקורות המימון וסקרו שוב.',
  DEFICIT_RESOLUTION_EXCEEDS_DEFICIT: 'המימון הנוסף גבוה מהחריגה הנוכחית. הקטינו את הסכום וסקרו שוב.',
  UNBUDGETED_RESOLUTION_SOURCE_INSUFFICIENT: 'אין מספיק כסף במקור המימון שנבחר. בחרו מקור נוסף או הקטינו את הסכום.',
  SAVINGS_INSUFFICIENT: 'אין מספיק כסף בחיסכון עבור הסכום שנבחר.',
  UNBUDGETED_RESOLUTION_LEG_TOTAL_MISMATCH: 'סכומי מקורות המימון אינם שווים לסכום ההקצאה.',
  UNBUDGETED_RESOLUTION_PREVIEW_STALE: 'נתוני התקציב השתנו מאז הכנת ההצעה. בדקו את הסכום ומקורות המימון ונסו שוב.',
  NO_UNBUDGETED_EXPENSE: 'לא נמצאה עוד הוצאה ללא תקציב בקטגוריה הזאת. רעננו את החודש.',
  UNBUDGETED_RESOLUTION_REQUIRES_FUNDING: 'כדי ליצור את התקציב יש לבחור סכום חיובי ומקורות מימון מתאימים.',
  UNBUDGETED_RESOLUTION_PENDING_OVERRIDE: 'קיימת התאמה חודשית שממתינה לאתחול. יש להשלים אותה לפני יצירת התקציב.',
  BUDGET_MONTH_ALREADY_CLOSED: 'החודש כבר נסגר ואי אפשר לשנות בו את ההקצאה.',
  BUDGET_ACTION_MONTH_FORBIDDEN: 'אי אפשר להקצות תקציב לחודש הזה.',
  CATEGORY_NOT_ACTIVE: 'הקטגוריה אינה פעילה ולכן אי אפשר להקצות לה תקציב.',
  INVALID_BUDGET_CATEGORY: 'הקטגוריה אינה זמינה להקצאת תקציב.',
};
const unbudgetedErrorMessage = (value, fallback = 'לא ניתן להקצות את התקציב. בדקו את הפרטים ונסו שוב.') => {
  const raw = String(value || '');
  const code = raw.match(/([A-Z][A-Z0-9_]+)/)?.[1];
  if (code && UNBUDGETED_ERROR_MESSAGES[code]) return UNBUDGETED_ERROR_MESSAGES[code];
  return /[\u0590-\u05ff]/.test(raw) ? raw : fallback;
};
const unbudgetedApiError = (error, fallback) => unbudgetedErrorMessage(
  error?.response?.data?.code || error?.response?.data?.error,
  fallback
);
const CANONICAL_POSITIVE_MONEY = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const isPositiveMoney = (value) => (
  typeof value === 'string' && CANONICAL_POSITIVE_MONEY.test(value) && compareMoney(value) > 0
);
const CANONICAL_NON_NEGATIVE_MONEY = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const isValidNonNegativeMoney = (value) => (
  typeof value === 'string' && CANONICAL_NON_NEGATIVE_MONEY.test(value)
);
const canonicalMoney = (value) => moneyFromMinorUnits(moneyToMinorUnits(value));

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
