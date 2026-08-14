import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  DateField,
  Dialog,
  NumberField,
  PrimaryButton,
  SecondaryButton,
  SegmentedControl,
  Select,
  TextField,
} from '../../components/ui';
import { getPaymentSources } from '../../services/api';

const INITIAL_FORM = {
  name: '',
  lender_name: '',
  original_amount: '',
  total_installments: '',
  start_date: '',
  end_date: '',
  interest_type: 'fixed',
  interest_rate: '',
  prime_margin: '',
  indexation_type: 'none',
  base_index: '',
  monthly_payment: '',
  payment_source_id: '',
  next_payment_date: '',
  auto_payment_enabled: true,
};

const INTEREST_OPTIONS = [
  { value: 'fixed', label: 'ריבית קבועה' },
  { value: 'prime', label: 'ריבית פריים / משתנה' },
];

const INDEXATION_OPTIONS = [
  { value: 'none', label: 'ללא הצמדה' },
  { value: 'cpi', label: 'מדד המחירים לצרכן' },
];

const isFiniteNumber = (value) => value !== '' && value !== null && value !== undefined
  && Number.isFinite(Number(value));
const isPositiveNumber = (value) => isFiniteNumber(value) && Number(value) > 0;
const isNonNegativeNumber = (value) => isFiniteNumber(value) && Number(value) >= 0;

const CreateLoanDialog = ({ open, onClose, onSubmit, returnFocusRef }) => {
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [paymentSources, setPaymentSources] = useState([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState('');
  const [formError, setFormError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const nameInputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    let active = true;
    setSourcesLoading(true);
    setSourcesError('');
    getPaymentSources()
      .then(({ data }) => {
        if (active) setPaymentSources(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (active) setSourcesError('לא ניתן לטעון את מקורות התשלום. נסו שוב לפני השמירה.');
      })
      .finally(() => {
        if (active) setSourcesLoading(false);
      });

    return () => { active = false; };
  }, [open]);

  const updateField = (name, value) => {
    setFormData((previous) => ({
      ...previous,
      [name]: value,
      ...(name === 'interest_type' && value === 'fixed' ? { prime_margin: '' } : {}),
      ...(name === 'indexation_type' && value === 'cpi'
        ? { auto_payment_enabled: false }
        : {}),
      ...(name === 'indexation_type' && value === 'none' ? { base_index: '' } : {}),
    }));
    setFormError('');
  };

  const handleChange = (event) => updateField(event.target.name, event.target.value);

  const fieldErrors = submitted ? {
    name: !formData.name.trim() ? 'יש להזין שם הלוואה' : undefined,
    original_amount: !isPositiveNumber(formData.original_amount) ? 'יש להזין סכום מקורי גדול מאפס' : undefined,
    total_installments: !Number.isInteger(Number(formData.total_installments)) || Number(formData.total_installments) <= 0
      ? 'יש להזין מספר תשלומים חיובי ושלם'
      : undefined,
    start_date: !formData.start_date ? 'יש להזין תאריך תחילה' : undefined,
    interest_rate: !isNonNegativeNumber(formData.interest_rate) ? 'יש להזין ריבית שנתית תקינה' : undefined,
    prime_margin: formData.interest_type === 'prime' && !isFiniteNumber(formData.prime_margin)
      ? 'יש להזין מרווח פריים תקין'
      : undefined,
    base_index: formData.base_index && !isPositiveNumber(formData.base_index)
      ? 'מדד בסיס חייב להיות מספר גדול מאפס'
      : undefined,
    monthly_payment: !isPositiveNumber(formData.monthly_payment) ? 'יש להזין החזר חודשי גדול מאפס' : undefined,
    payment_source_id: formData.auto_payment_enabled && !formData.payment_source_id
      ? 'מקור תשלום נדרש לתשלום אוטומטי'
      : undefined,
    next_payment_date: formData.auto_payment_enabled && !formData.next_payment_date
      ? 'תאריך התשלום הבא נדרש לתשלום אוטומטי'
      : undefined,
  } : {};

  const handleClose = () => {
    if (saving) return;
    onClose();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;

    setSubmitted(true);
    const hasErrors = [
      !formData.name.trim(),
      !isPositiveNumber(formData.original_amount),
      !Number.isInteger(Number(formData.total_installments)) || Number(formData.total_installments) <= 0,
      !formData.start_date,
      !isNonNegativeNumber(formData.interest_rate),
      formData.interest_type === 'prime' && !isFiniteNumber(formData.prime_margin),
      formData.base_index && !isPositiveNumber(formData.base_index),
      !isPositiveNumber(formData.monthly_payment),
      formData.auto_payment_enabled && !formData.payment_source_id,
      formData.auto_payment_enabled && !formData.next_payment_date,
    ].some(Boolean);

    if (hasErrors) {
      setFormError('יש לתקן את השדות המסומנים לפני יצירת ההלוואה.');
      return;
    }

    const payload = {
      name: formData.name.trim(),
      lender_name: formData.lender_name.trim() || null,
      original_amount: Number(formData.original_amount),
      total_installments: Number(formData.total_installments),
      start_date: formData.start_date,
      end_date: formData.end_date || null,
      interest_type: formData.interest_type,
      interest_rate: Number(formData.interest_rate),
      prime_margin: formData.interest_type === 'prime' ? Number(formData.prime_margin) : 0,
      indexation_type: formData.indexation_type,
      base_index: formData.indexation_type === 'cpi' && formData.base_index
        ? Number(formData.base_index)
        : null,
      monthly_payment: Number(formData.monthly_payment),
      payment_source_id: formData.payment_source_id ? Number(formData.payment_source_id) : null,
      next_payment_date: formData.next_payment_date || null,
      auto_payment_enabled: formData.auto_payment_enabled,
    };

    setSaving(true);
    setFormError('');
    try {
      await onSubmit(payload);
    } catch (error) {
      setFormError(error.response?.data?.error || 'נכשל בשמירת ההלוואה. הפרטים נשמרו וניתן לנסות שוב.');
    } finally {
      setSaving(false);
    }
  };

  const primePreview = formData.interest_type === 'prime'
    && isFiniteNumber(formData.prime_margin)
    && isNonNegativeNumber(formData.interest_rate)
    ? `P ${Number(formData.prime_margin) >= 0 ? '+' : '−'} ${Math.abs(Number(formData.prime_margin)).toFixed(2)}% · ריבית נוכחית: ${Number(formData.interest_rate).toFixed(2)}%`
    : '';

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="הלוואה חדשה"
      size="lg"
      className="loan-create-dialog"
      bodyClassName="loan-create-dialog__body"
      footerClassName="loan-create-dialog__footer"
      closeDisabled={saving}
      initialFocusRef={nameInputRef}
      returnFocusRef={returnFocusRef}
      footer={(
        <>
          <PrimaryButton type="submit" form="create-loan-form" loading={saving} loadingText="יוצר הלוואה">
            יצירת ההלוואה
          </PrimaryButton>
          <SecondaryButton type="button" disabled={saving} onClick={handleClose}>ביטול</SecondaryButton>
        </>
      )}
    >
      <form id="create-loan-form" className="loan-create-form" onSubmit={handleSubmit} noValidate>
        {formError && <Alert variant="error" urgent>{formError}</Alert>}
        {sourcesError && <Alert variant="error">{sourcesError}</Alert>}

        <fieldset className="loan-create-section loan-create-section--first">
          <legend>פרטי הלוואה</legend>
          <div className="loan-create-grid">
            <TextField
              ref={nameInputRef}
              name="name"
              label="שם ההלוואה"
              placeholder="למשל: הלוואת רכב"
              value={formData.name}
              onChange={handleChange}
              error={fieldErrors.name}
              required
            />
            <TextField
              name="lender_name"
              label="מלווה"
              placeholder="בנק או חברת מימון"
              value={formData.lender_name}
              onChange={handleChange}
            />
            <NumberField
              name="original_amount"
              label="סכום מקורי"
              min="0.01"
              step="0.01"
              value={formData.original_amount}
              onChange={handleChange}
              error={fieldErrors.original_amount}
              suffix="₪"
              required
            />
            <NumberField
              name="total_installments"
              label="מספר תשלומים"
              min="1"
              step="1"
              inputMode="numeric"
              value={formData.total_installments}
              onChange={handleChange}
              error={fieldErrors.total_installments}
              required
            />
            <DateField
              name="start_date"
              label="תאריך תחילה"
              value={formData.start_date}
              onChange={handleChange}
              error={fieldErrors.start_date}
              required
            />
            <DateField
              name="end_date"
              label="סיום מתוכנן"
              value={formData.end_date}
              onChange={handleChange}
            />
          </div>
        </fieldset>

        <fieldset className="loan-create-section">
          <legend>ריבית</legend>
          <SegmentedControl
            label="סוג ריבית"
            size="compact"
            value={formData.interest_type}
            options={INTEREST_OPTIONS}
            onValueChange={(value) => updateField('interest_type', value)}
          />
          <div className="loan-create-grid">
            <NumberField
              name="interest_rate"
              label="ריבית שנתית נומינלית נוכחית"
              min="0"
              step="0.01"
              value={formData.interest_rate}
              onChange={handleChange}
              error={fieldErrors.interest_rate}
              suffix="%"
              required
            />
            {formData.interest_type === 'prime' && (
              <NumberField
                name="prime_margin"
                label="מרווח פריים"
                helperText={primePreview || 'לדוגמה: 6.85 עבור P + 6.85%'}
                step="0.01"
                value={formData.prime_margin}
                onChange={handleChange}
                error={fieldErrors.prime_margin}
                suffix="%"
                required
              />
            )}
          </div>
          <SegmentedControl
            label="הצמדה"
            size="compact"
            value={formData.indexation_type}
            options={INDEXATION_OPTIONS}
            onValueChange={(value) => updateField('indexation_type', value)}
          />
          {formData.indexation_type === 'cpi' && (
            <>
              <div className="loan-create-conditional">
                <NumberField
                  name="base_index"
                  label="מדד בסיס"
                  helperText="אופציונלי — יש להזין רק ערך מאומת ממסמך המקור"
                  min="0.0001"
                  step="0.0001"
                  value={formData.base_index}
                  onChange={handleChange}
                  error={fieldErrors.base_index}
                />
              </div>
              <Alert variant="info">
                תשלום אוטומטי להלוואה צמודת מדד אינו נתמך עדיין
              </Alert>
            </>
          )}
        </fieldset>

        <fieldset className="loan-create-section">
          <legend>תשלומים</legend>
          <div className="loan-create-grid">
            <NumberField
              name="monthly_payment"
              label="החזר חודשי נוכחי"
              min="0.01"
              step="0.01"
              value={formData.monthly_payment}
              onChange={handleChange}
              error={fieldErrors.monthly_payment}
              suffix="₪"
              required
            />
            <Select
              name="payment_source_id"
              label="מקור תשלום"
              placeholder={sourcesLoading ? 'טוען מקורות תשלום…' : 'בחירת מקור תשלום'}
              value={formData.payment_source_id}
              onChange={handleChange}
              error={fieldErrors.payment_source_id}
              loading={sourcesLoading}
              required={formData.auto_payment_enabled}
            >
              {paymentSources.map((source) => (
                <option key={source.id} value={source.id}>{source.name}</option>
              ))}
            </Select>
            <DateField
              name="next_payment_date"
              label="תאריך התשלום הבא"
              helperText="התאריך בפועל אצל המלווה או חברת האשראי"
              value={formData.next_payment_date}
              onChange={handleChange}
              error={fieldErrors.next_payment_date}
              required={formData.auto_payment_enabled}
            />
          </div>

          <label className="loan-create-auto-payment">
            <input
              type="checkbox"
              name="auto_payment_enabled"
              checked={formData.auto_payment_enabled}
              disabled={formData.indexation_type === 'cpi'}
              onChange={(event) => updateField('auto_payment_enabled', event.target.checked)}
            />
            <span className="loan-create-auto-payment__copy">
              <strong>תשלום אוטומטי</strong>
              <small>כשהתשלום מגיע למועדו, המערכת תרשום אוטומטית את התנועה ואת רכיבי ההלוואה.</small>
            </span>
          </label>
        </fieldset>
      </form>
    </Dialog>
  );
};

export default CreateLoanDialog;
