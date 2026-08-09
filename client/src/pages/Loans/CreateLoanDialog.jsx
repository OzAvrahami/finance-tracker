import { useRef, useState } from 'react';
import {
  Alert,
  DateField,
  Dialog,
  NumberField,
  PrimaryButton,
  SecondaryButton,
  SegmentedControl,
  TextField,
} from '../../components/ui';

const INITIAL_FORM = {
  name: '',
  lender_name: '',
  loan_type: 'bank_loan',
  amortization_type: 'spitzer',
  interest_type: 'fixed',
  prime_margin: '',
  balloon_amount: '',
  grace_months: '',
  original_amount: '',
  current_balance: '',
  monthly_payment: '',
  interest_rate: '',
  total_installments: '',
  start_date: '',
  end_date: '',
};

const AMORTIZATION_OPTIONS = [
  { value: 'spitzer', label: 'שפיצר' },
  { value: 'balloon', label: 'בלון' },
  { value: 'grace', label: 'גרייס' },
];

const INTEREST_OPTIONS = [
  { value: 'fixed', label: 'קבועה' },
  { value: 'prime', label: 'פריים' },
  { value: 'cpi_linked', label: 'צמודת מדד' },
];

const CreateLoanDialog = ({ open, onClose, onSubmit, returnFocusRef }) => {
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [formError, setFormError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const nameInputRef = useRef(null);

  const updateField = (name, value) => {
    setFormData((previous) => {
      const updated = { ...previous, [name]: value };

      if (name === 'prime_margin') {
        const margin = parseFloat(value) || 0;
        updated.interest_rate = (5.5 + margin).toFixed(2);
      }

      if (name === 'interest_type' && value === 'prime') {
        updated.interest_rate = '';
        updated.prime_margin = '';
      }

      return updated;
    });
    setFormError('');
  };

  const handleChange = (event) => updateField(event.target.name, event.target.value);

  const handleClose = () => {
    if (saving) return;
    onClose();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;

    setSubmitted(true);
    const originalAmount = parseFloat(formData.original_amount);

    if (!formData.name || Number.isNaN(originalAmount)) {
      setFormError('חובה למלא שם הלוואה וסכום מקורי.');
      return;
    }

    const primeMargin = parseFloat(formData.prime_margin) || 0;
    const calculatedInterest = formData.interest_type === 'prime'
      ? parseFloat((6.0 + primeMargin).toFixed(2))
      : parseFloat(formData.interest_rate) || 0;

    const payload = {
      ...formData,
      original_amount: originalAmount,
      current_balance: formData.current_balance ? parseFloat(formData.current_balance) : originalAmount,
      monthly_payment: parseFloat(formData.monthly_payment) || 0,
      total_installments: parseInt(formData.total_installments, 10) || 0,
      remaining_installments: parseInt(formData.remaining_installments, 10) || 0,
      grace_months: parseInt(formData.grace_months, 10) || 0,
      balloon_amount: formData.amortization_type === 'balloon'
        ? (parseFloat(formData.balloon_amount) || 0)
        : 0,
      prime_margin: formData.interest_type === 'prime' ? primeMargin : 0,
      interest_rate: calculatedInterest,
      start_date: formData.start_date || null,
      end_date: formData.end_date || null,
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

  const originalError = submitted && Number.isNaN(parseFloat(formData.original_amount))
    ? 'יש להזין סכום מקורי'
    : undefined;

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
          <PrimaryButton
            type="submit"
            form="create-loan-form"
            loading={saving}
            loadingText="יוצר הלוואה"
          >
            יצירת ההלוואה
          </PrimaryButton>
          <SecondaryButton type="button" disabled={saving} onClick={handleClose}>
            ביטול
          </SecondaryButton>
        </>
      )}
    >
      <form id="create-loan-form" className="loan-create-form" onSubmit={handleSubmit} noValidate>
        {formError && <Alert variant="error" urgent>{formError}</Alert>}

        <div className="loan-create-grid">
          <TextField
            ref={nameInputRef}
            name="name"
            label="שם ההלוואה"
            placeholder="למשל: הלוואת רכב"
            value={formData.name}
            onChange={handleChange}
            error={submitted && !formData.name ? 'יש להזין שם הלוואה' : undefined}
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
            min="0"
            step="any"
            value={formData.original_amount}
            onChange={handleChange}
            error={originalError}
            suffix="₪"
            required
          />
          <NumberField
            name="current_balance"
            label="יתרה נוכחית"
            min="0"
            step="any"
            value={formData.current_balance}
            onChange={handleChange}
            suffix="₪"
          />
          <NumberField
            name="monthly_payment"
            label="החזר חודשי"
            min="0"
            step="any"
            value={formData.monthly_payment}
            onChange={handleChange}
            suffix="₪"
          />
          <NumberField
            name="total_installments"
            label="מספר תשלומים"
            min="0"
            step="1"
            inputMode="numeric"
            value={formData.total_installments}
            onChange={handleChange}
          />
        </div>

        <fieldset className="loan-create-section">
          <legend>שיטת החזר</legend>
          <SegmentedControl
            label="שיטת החזר"
            size="compact"
            value={formData.amortization_type}
            options={AMORTIZATION_OPTIONS}
            onValueChange={(value) => updateField('amortization_type', value)}
          />
          {formData.amortization_type === 'balloon' && (
            <NumberField
              className="loan-create-conditional"
              name="balloon_amount"
              label="סכום הבלון"
              min="0"
              step="any"
              value={formData.balloon_amount}
              onChange={handleChange}
              suffix="₪"
            />
          )}
          {formData.amortization_type === 'grace' && (
            <NumberField
              className="loan-create-conditional"
              name="grace_months"
              label="חודשי גרייס"
              min="0"
              step="1"
              inputMode="numeric"
              value={formData.grace_months}
              onChange={handleChange}
            />
          )}
        </fieldset>

        <fieldset className="loan-create-section">
          <legend>בסיס ריבית</legend>
          <SegmentedControl
            label="בסיס ריבית"
            size="compact"
            value={formData.interest_type}
            options={INTEREST_OPTIONS}
            onValueChange={(value) => updateField('interest_type', value)}
          />
          {formData.interest_type === 'prime' ? (
            <NumberField
              className="loan-create-conditional"
              name="prime_margin"
              label="מרווח מעל הפריים"
              helperText="מחושב לפי נתוני הריבית הקיימים במערכת"
              step="0.01"
              value={formData.prime_margin}
              onChange={handleChange}
              suffix="%"
            />
          ) : (
            <NumberField
              className="loan-create-conditional"
              name="interest_rate"
              label={formData.interest_type === 'cpi_linked'
                ? 'ריבית ריאלית מעל המדד'
                : 'ריבית שנתית קבועה'}
              min="0"
              step="0.01"
              value={formData.interest_rate}
              onChange={handleChange}
              suffix="%"
            />
          )}
        </fieldset>

        <div className="loan-create-grid loan-create-dates">
          <DateField
            name="start_date"
            label="תאריך תחילה"
            value={formData.start_date}
            onChange={handleChange}
          />
          <DateField
            name="end_date"
            label="תאריך סיום"
            value={formData.end_date}
            onChange={handleChange}
          />
        </div>
      </form>
    </Dialog>
  );
};

export default CreateLoanDialog;
