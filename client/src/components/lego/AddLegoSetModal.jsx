import { useEffect, useRef, useState } from 'react';
import { Blocks, Info, Search } from 'lucide-react';
import { addLegoSet, getLegoSetDetails, updateLegoSet } from '../../services/api';
import { ACQUISITION_OPTIONS, BRAND_OPTIONS, STATUS_OPTIONS } from '../../utils/legoHelpers';
import {
  Alert,
  DateField,
  Dialog,
  NumberField,
  PrimaryButton,
  SecondaryButton,
  Select,
  TextField,
} from '../ui';

const DEFAULT_FORM = {
  set_number: '',
  name: '',
  theme: '',
  brand: 'LEGO',
  status: 'New',
  pieces: '',
  acquisition_type: 'purchase',
  purchase_date: '',
  purchase_price: '',
  receipt_price: '',
  original_price: '',
};

const formFromSet = (set) => ({
  set_number: set?.set_number || '',
  name: set?.name || '',
  theme: set?.theme || '',
  brand: set?.brand || 'LEGO',
  status: set?.status || 'New',
  pieces: set?.pieces ?? '',
  acquisition_type: set?.acquisition_type === 'purchased'
    ? 'purchase'
    : (set?.acquisition_type || 'purchase'),
  purchase_date: set?.purchase_date || '',
  purchase_price: set?.purchase_price ?? '',
  receipt_price: set?.receipt_price ?? '',
  original_price: set?.original_price ?? '',
});

const AddLegoSetModal = ({
  show,
  onClose,
  onSave,
  initialData = null,
  existingSets = [],
  returnFocusRef,
}) => {
  const [form, setForm] = useState({ ...DEFAULT_FORM });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState('');
  const [lookupState, setLookupState] = useState('idle');
  const [lookupMessage, setLookupMessage] = useState('');
  const lookupInFlightRef = useRef(false);
  const setNumberRef = useRef(null);
  const isEditMode = Boolean(initialData);

  useEffect(() => {
    if (!show) return;
    setForm(initialData ? formFromSet(initialData) : { ...DEFAULT_FORM });
    setErrors({});
    setSaveError('');
    setLookupState('idle');
    setLookupMessage('');
    lookupInFlightRef.current = false;
  }, [initialData, show]);

  const isDuplicateSetNumber = (trimmed) => existingSets.some(
    (set) => set.set_number === trimmed && (!initialData || set.id !== initialData.id),
  );

  const updateField = (name, value) => {
    setForm((previous) => ({
      ...previous,
      [name]: value,
      ...(name === 'acquisition_type' && ['gift', 'gwp'].includes(value)
        ? { receipt_price: 0, purchase_price: 0 }
        : {}),
    }));
    if (errors[name]) setErrors((previous) => ({ ...previous, [name]: null }));
    if (name === 'set_number') {
      setLookupState('idle');
      setLookupMessage('');
    }
    if (saveError) setSaveError('');
  };

  const runLookup = async () => {
    const trimmed = form.set_number.trim();
    if (!trimmed || lookupInFlightRef.current) return;

    if (isDuplicateSetNumber(trimmed)) {
      const duplicateMessage = 'הסט כבר קיים באוסף';
      setErrors((previous) => ({ ...previous, set_number: duplicateMessage }));
      setLookupState('duplicate');
      setLookupMessage(duplicateMessage);
      return;
    }

    if (isEditMode && trimmed === initialData.set_number) return;

    lookupInFlightRef.current = true;
    setLookupState('loading');
    setLookupMessage('מחפש את פרטי הסט ב-Rebrickable…');
    try {
      const response = await getLegoSetDetails(trimmed);
      setForm((previous) => ({
        ...previous,
        name: !previous.name ? (response.data.name ?? previous.name) : previous.name,
        theme: !previous.theme ? (response.data.theme ?? previous.theme) : previous.theme,
        pieces: !previous.pieces ? (response.data.parts ?? previous.pieces) : previous.pieces,
      }));
      setLookupState('success');
      setLookupMessage('פרטי הסט נמצאו. אפשר לבדוק ולהמשיך לערוך אותם.');
    } catch (error) {
      const unavailable = !error.response || Number(error.response.status) >= 500;
      setLookupState(unavailable ? 'unavailable' : 'failure');
      setLookupMessage(
        unavailable
          ? 'שירות החיפוש אינו זמין כרגע. אפשר להמשיך בהזנה ידנית.'
          : 'הסט לא נמצא. אפשר לבדוק את המספר או להמשיך בהזנה ידנית.',
      );
    } finally {
      lookupInFlightRef.current = false;
    }
  };

  const validate = () => {
    const nextErrors = {};
    const trimmedSetNumber = form.set_number.trim();
    if (!trimmedSetNumber) {
      nextErrors.set_number = 'שדה חובה';
    } else if (isDuplicateSetNumber(trimmedSetNumber)) {
      nextErrors.set_number = 'הסט כבר קיים באוסף';
    }
    if (!form.name.trim()) nextErrors.name = 'שדה חובה';
    return nextErrors;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;

    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      if (validationErrors.set_number) setNumberRef.current?.focus();
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const numberOrNull = (value) => (value !== '' && value != null ? Number(value) : null);
      const payload = {
        set_number: form.set_number.trim(),
        name: form.name.trim(),
        theme: form.theme.trim() || null,
        brand: form.brand,
        status: form.status,
        acquisition_type: form.acquisition_type,
        pieces: numberOrNull(form.pieces),
        purchase_price: numberOrNull(form.purchase_price),
        receipt_price: numberOrNull(form.receipt_price),
        original_price: numberOrNull(form.original_price),
        purchase_date: form.purchase_date || null,
      };

      if (isEditMode) await updateLegoSet(initialData.id, payload);
      else await addLegoSet(payload);
      await onSave();
    } catch (error) {
      if (error.response?.status === 409) {
        const duplicateMessage = 'הסט כבר קיים באוסף';
        setErrors((previous) => ({ ...previous, set_number: duplicateMessage }));
        setLookupState('duplicate');
        setLookupMessage(duplicateMessage);
        setNumberRef.current?.focus();
      } else {
        setSaveError('שמירת הסט נכשלה. הפרטים נשמרו בטופס ואפשר לנסות שוב.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (!saving) onClose();
  };

  const lookupTone = lookupState === 'success'
    ? 'success'
    : ['failure', 'unavailable', 'duplicate'].includes(lookupState) ? 'warning' : 'info';
  const formStatuses = STATUS_OPTIONS.filter((option) => option.key !== 'All');

  return (
    <Dialog
      open={show}
      onClose={handleClose}
      title={isEditMode ? 'עריכת סט באוסף' : 'הוספת סט לאוסף'}
      header={(
        <span className="lego-dialog__title-icon" aria-hidden="true">
          <Blocks size={19} />
        </span>
      )}
      size="lg"
      className="lego-dialog"
      bodyClassName="lego-dialog__body"
      footerClassName="lego-dialog__footer"
      initialFocusRef={setNumberRef}
      returnFocusRef={returnFocusRef}
      closeDisabled={saving}
      footer={(
        <>
          <PrimaryButton
            type="submit"
            form="lego-set-form"
            loading={saving}
            loadingText={isEditMode ? 'שומר שינויים…' : 'מוסיף את הסט…'}
          >
            {isEditMode ? 'שמירת שינויים' : 'הוספת הסט'}
          </PrimaryButton>
          <SecondaryButton type="button" disabled={saving} onClick={handleClose}>ביטול</SecondaryButton>
        </>
      )}
    >
      <form id="lego-set-form" className="lego-form" onSubmit={handleSubmit} noValidate>
        {saveError && <Alert variant="error" urgent>{saveError}</Alert>}

        <div className="lego-lookup-row">
          <TextField
            ref={setNumberRef}
            id="lego-set-number"
            className="lego-set-number-field"
            label="מספר סט"
            value={form.set_number}
            onValueChange={(value) => updateField('set_number', value)}
            onBlur={runLookup}
            placeholder="לדוגמה: 75367-1"
            error={errors.set_number}
            technicalLtr
            required
            autoComplete="off"
          />
          <SecondaryButton
            type="button"
            className="lego-lookup-button"
            disabled={saving || lookupState === 'loading' || !form.set_number.trim()}
            loading={lookupState === 'loading'}
            loadingText="מחפש…"
            onClick={runLookup}
          >
            <Search size={16} aria-hidden="true" />
            חיפוש פרטי הסט
          </SecondaryButton>
        </div>

        {lookupState === 'idle' && (
          <div className="lego-lookup-info" role="note">
            <Info size={16} aria-hidden="true" />
            <span>חיפוש לפי מספר סט יכול להשלים שם, נושא ומספר חלקים. אפשר גם למלא הכול ידנית.</span>
          </div>
        )}

        {lookupMessage && (
          <Alert className="lego-lookup-status" variant={lookupTone} announce={lookupState !== 'duplicate'} urgent={lookupState === 'duplicate'}>
            {lookupMessage}
          </Alert>
        )}

        <div className="lego-form-grid lego-form-grid--name">
          <TextField
            id="lego-set-name"
            label="שם הסט"
            value={form.name}
            onValueChange={(value) => updateField('name', value)}
            placeholder="שם הסט"
            error={errors.name}
            required
            dir="auto"
          />
          <TextField
            id="lego-set-theme"
            label="נושא"
            value={form.theme}
            onValueChange={(value) => updateField('theme', value)}
            placeholder="לדוגמה: Star Wars"
            dir="auto"
          />
        </div>

        <div className="lego-form-grid lego-form-grid--three">
          <NumberField
            id="lego-set-pieces"
            label="מספר חלקים"
            value={form.pieces}
            onValueChange={(value) => updateField('pieces', value)}
            min="0"
            step="1"
          />
          <Select
            id="lego-set-brand"
            label="מותג"
            value={form.brand}
            onValueChange={(value) => updateField('brand', value)}
            technicalLtr
          >
            {BRAND_OPTIONS.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
          </Select>
          <Select
            id="lego-set-status"
            label="סטטוס"
            value={form.status}
            onValueChange={(value) => updateField('status', value)}
          >
            {formStatuses.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </Select>
        </div>

        <div className="lego-form-grid lego-form-grid--two">
          <Select
            id="lego-acquisition-type"
            label="אופן קבלה"
            value={form.acquisition_type}
            onValueChange={(value) => updateField('acquisition_type', value)}
            helperText={form.acquisition_type === 'gift'
              ? 'מתנה אישית שאינה תלויה ברכישה אחרת.'
              : form.acquisition_type === 'gwp'
                ? 'סט חינם שהתקבל כחלק מרכישה או מבצע.'
                : undefined}
          >
            {ACQUISITION_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </Select>
          <DateField
            id="lego-purchase-date"
            label="תאריך כניסה לאוסף"
            value={form.purchase_date}
            onValueChange={(value) => updateField('purchase_date', value)}
          />
        </div>

        <div className="lego-form-grid lego-form-grid--prices">
          <NumberField
            id="lego-original-price"
            label="מחיר לפני הנחת פריט"
            value={form.original_price}
            onValueChange={(value) => updateField('original_price', value)}
            min="0"
            step="0.01"
            suffix="₪"
          />
          {form.acquisition_type === 'purchase' ? (
            <>
              <NumberField
                id="lego-receipt-price"
                label="מחיר בקבלה"
                value={form.receipt_price}
                onValueChange={(value) => updateField('receipt_price', value)}
                min="0"
                step="0.01"
                suffix="₪"
                helperText="אחרי הנחת הפריט ולפני הנחה כללית."
              />
              <NumberField
                id="lego-purchase-price"
                label="מחיר ששולם"
                value={form.purchase_price}
                onValueChange={(value) => updateField('purchase_price', value)}
                min="0"
                step="0.01"
                suffix="₪"
              />
            </>
          ) : (
            <NumberField
              id="lego-purchase-price"
              label="מחיר ששולם"
              value={0}
              readOnly
              suffix="₪"
              helperText={form.acquisition_type === 'gwp'
                ? 'GWP מתקבל ללא תשלום ישיר עבור הסט.'
                : 'מתנה אישית נרשמת ללא עלות רכישה.'}
            />
          )}
        </div>
      </form>
    </Dialog>
  );
};

export default AddLegoSetModal;
