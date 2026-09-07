import { useEffect, useRef, useState } from 'react';
import { Alert, DateField, Dialog, PrimaryButton, SecondaryButton, Select, TextField } from '../../components/ui';
import { shoppingListFieldErrors } from './shoppingListFields';

const EMPTY_TYPES = [];
const ShoppingListDialog = ({ open, initialList, listTypes = EMPTY_TYPES, onClose, onSave, returnFocusRef }) => {
  const titleRef = useRef(null);
  const [form, setForm] = useState({ title: '', list_type_id: '', store: '', link: '', target_date: '' });
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const editing = Boolean(initialList);

  useEffect(() => {
    if (!open) return;
    setForm({
      title: initialList?.title || '',
      list_type_id: String(initialList?.list_type_id || listTypes[0]?.id || ''),
      store: initialList?.store || '', link: initialList?.link || '', target_date: initialList?.target_date || '',
    });
    setTouched(false);
    setPending(false);
    setError('');
  }, [open, initialList, listTypes]);

  const update = (field) => (value) => setForm((current) => ({ ...current, [field]: value }));
  const errors = shoppingListFieldErrors(form);
  const close = (reason) => { if (!pending) onClose(reason); };
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (pending) return;
    setTouched(true);
    setError('');
    if (!form.title.trim() || (!editing && !form.list_type_id) || Object.values(errors).some(Boolean)) return;
    const payload = { title: form.title.trim() };
    if (!editing) payload.list_type_id = form.list_type_id;
    for (const field of ['store', 'link', 'target_date']) {
      const value = form[field].trim() || null;
      if (editing || value !== null) payload[field] = value;
    }
    setPending(true);
    try {
      await onSave(payload);
    } catch (failure) {
      setError(failure.response?.data?.error || (editing
        ? 'שמירת הרשימה נכשלה. הפרטים נשמרו וניתן לנסות שוב.'
        : 'יצירת הרשימה נכשלה. הפרטים נשמרו וניתן לנסות שוב.'));
    } finally { setPending(false); }
  };

  return (
    <Dialog open={open} onClose={close} title={editing ? 'עריכת פרטי הרשימה' : 'רשימת קניות חדשה'}
      description={editing ? 'חנות, קישור ותאריך יעד הם פרטים לבחירה. אפשר גם לנקות ערכים שנשמרו.' : 'הרשימה תיפתח כטיוטה. אפשר להוסיף לה פריטים ולהפעיל אותה בהמשך.'}
      size="sm" className="shopping-dialog shopping-create-dialog" initialFocusRef={titleRef}
      returnFocusRef={returnFocusRef} closeDisabled={pending}
      footer={<>
        <SecondaryButton type="button" disabled={pending} onClick={() => close('cancelled')}>ביטול</SecondaryButton>
        <PrimaryButton type="submit" form="shopping-list-form" loading={pending} loadingText={editing ? 'שומר…' : 'יוצר רשימה…'}>
          {editing ? 'שמירת הפרטים' : 'יצירת הרשימה'}
        </PrimaryButton>
      </>}
    >
      <form id="shopping-list-form" className="shopping-dialog-form" onSubmit={handleSubmit} noValidate>
        {error && <Alert variant="error" urgent>{error}</Alert>}
        <TextField ref={titleRef} id="shopping-list-title" label="שם הרשימה" required placeholder="למשל: קניות שבועיות"
          value={form.title} onValueChange={update('title')} disabled={pending}
          error={touched && !form.title.trim() ? 'יש להזין שם לרשימה' : undefined} />
        {!editing && <Select id="shopping-list-type" label="סוג רשימה" required
          helperText="סוג הרשימה קובע אילו קטגוריות קטלוג יהיו זמינות לפריטים שלה."
          value={form.list_type_id} onValueChange={update('list_type_id')} disabled={pending}
          error={touched && !form.list_type_id ? 'יש לבחור סוג רשימה' : undefined}>
          <option value="">בחירת סוג רשימה</option>
          {listTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
        </Select>}
        <TextField id="shopping-list-store" label="חנות (רשות)" value={form.store} onValueChange={update('store')} disabled={pending} />
        <TextField id="shopping-list-link" label="קישור (רשות)" type="url" technicalLtr placeholder="https://"
          value={form.link} onValueChange={update('link')} disabled={pending} error={touched ? errors.link : undefined} />
        <DateField id="shopping-list-target-date" label="תאריך יעד (רשות)" value={form.target_date}
          onValueChange={update('target_date')} disabled={pending} error={touched ? errors.target_date : undefined} />
      </form>
    </Dialog>
  );
};

export default ShoppingListDialog;
