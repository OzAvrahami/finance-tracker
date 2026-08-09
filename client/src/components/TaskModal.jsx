import { useEffect, useRef, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { createTask, getAllLoans, getTransactions, updateTask } from '../services/api';
import {
  Alert,
  DateField,
  Dialog,
  PrimaryButton,
  SecondaryButton,
  Select,
  TextArea,
  TextField,
} from './ui';
import styles from '../pages/Tasks/Tasks.module.css';

const STATUS_OPTIONS = [
  { value: 'open', label: 'פתוח' },
  { value: 'in_progress', label: 'בתהליך' },
  { value: 'waiting', label: 'המתנה' },
  { value: 'done', label: 'הושלם' },
  { value: 'cancelled', label: 'בוטל' },
];

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'נמוך' },
  { value: 'medium', label: 'בינוני' },
  { value: 'high', label: 'גבוה' },
  { value: 'urgent', label: 'דחוף' },
];

const CATEGORY_OPTIONS = [
  { value: 'finance', label: 'פיננסי' },
  { value: 'personal', label: 'אישי' },
  { value: 'work', label: 'עבודה' },
  { value: 'system', label: 'מערכת' },
  { value: 'other', label: 'אחר' },
];

const LINKABLE_TRANSACTIONS_LIMIT = 50;

const DEFAULT_FORM = {
  title: '',
  notes: '',
  status: 'open',
  priority: 'medium',
  category: 'personal',
  due_date: '',
  transaction_id: '',
  loan_id: '',
};

const formatMoneyForOption = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '₪0';
  return `₪${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
};

const TaskModal = ({ show, task, onClose, onSave, returnFocusRef }) => {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [loans, setLoans] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const titleRef = useRef(null);

  useEffect(() => {
    if (!show) return undefined;
    let active = true;
    setLoadingEntities(true);

    Promise.all([
      getAllLoans().catch(() => ({ data: [] })),
      getTransactions({ limit: LINKABLE_TRANSACTIONS_LIMIT })
        .catch(() => ({ data: { data: [] } })),
    ]).then(([loansResponse, transactionsResponse]) => {
      if (!active) return;
      setLoans(loansResponse.data || []);
      setTransactions(transactionsResponse.data?.data || []);
    }).finally(() => {
      if (active) setLoadingEntities(false);
    });

    return () => {
      active = false;
    };
  }, [show]);

  useEffect(() => {
    if (!show) return;
    setForm(task ? {
      title: task.title || '',
      notes: task.notes || '',
      status: task.status || 'open',
      priority: task.priority || 'medium',
      category: task.category || 'personal',
      due_date: task.due_date || '',
      transaction_id: task.transaction_id ?? '',
      loan_id: task.loan_id ?? '',
    } : DEFAULT_FORM);
    setSaveError('');
    setSubmitted(false);
  }, [show, task]);

  const updateField = (name, value) => {
    setForm((current) => ({ ...current, [name]: value }));
    setSaveError('');
  };

  const handleClose = () => {
    if (!saving) onClose();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;

    setSubmitted(true);
    if (!form.title.trim()) {
      titleRef.current?.focus();
      return;
    }

    const payload = {
      ...form,
      title: form.title.trim(),
      due_date: form.due_date || null,
      transaction_id: form.transaction_id ? Number(form.transaction_id) : null,
      loan_id: form.loan_id ? Number(form.loan_id) : null,
    };

    setSaving(true);
    setSaveError('');
    try {
      if (task) await updateTask(task.id, payload);
      else await createTask(payload);
      await onSave();
    } catch {
      setSaveError('שמירת המטלה נכשלה. הפרטים נשמרו בטופס וניתן לנסות שוב.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={show}
      onClose={handleClose}
      title={task ? 'עריכת מטלה' : 'מטלה חדשה'}
      size="lg"
      className={styles.taskDialog}
      bodyClassName={styles.taskDialogBody}
      footerClassName={styles.taskDialogFooter}
      initialFocusRef={titleRef}
      returnFocusRef={returnFocusRef}
      closeDisabled={saving}
      dismissOnBackdrop={!saving}
      dismissOnEscape={!saving}
      header={(
        <span className={styles.taskDialogIcon} aria-hidden="true">
          <ListChecks size={19} />
        </span>
      )}
      footer={(
        <>
          <PrimaryButton
            type="submit"
            form="task-editor-form"
            loading={saving}
            loadingText="שומר…"
          >
            {task ? 'שמירת שינויים' : 'יצירת מטלה'}
          </PrimaryButton>
          <SecondaryButton type="button" disabled={saving} onClick={handleClose}>ביטול</SecondaryButton>
        </>
      )}
    >
      <form id="task-editor-form" className={styles.taskForm} noValidate onSubmit={handleSubmit}>
        {saveError && <Alert variant="error" urgent>{saveError}</Alert>}

        <TextField
          ref={titleRef}
          label="כותרת"
          name="title"
          required
          value={form.title}
          onValueChange={(value) => updateField('title', value)}
          placeholder="למשל: לבדוק חיוב כפול בכאל"
          error={submitted && !form.title.trim() ? 'יש להזין כותרת למטלה' : undefined}
        />

        <TextArea
          label="הערות"
          name="notes"
          rows={3}
          value={form.notes}
          onValueChange={(value) => updateField('notes', value)}
          placeholder="פרטים נוספים, מספר פנייה, מה צריך לבדוק"
        />

        <div className={styles.taskFormThreeColumns}>
          <Select
            label="סטטוס"
            name="status"
            value={form.status}
            onValueChange={(value) => updateField('status', value)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
          <Select
            label="עדיפות"
            name="priority"
            value={form.priority}
            onValueChange={(value) => updateField('priority', value)}
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
          <Select
            label="קטגוריית מטלה"
            name="category"
            value={form.category}
            onValueChange={(value) => updateField('category', value)}
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </div>

        <DateField
          className={styles.taskDueField}
          label="תאריך יעד"
          name="due_date"
          value={form.due_date}
          onValueChange={(value) => updateField('due_date', value)}
        />

        <fieldset className={styles.taskLinksSection}>
          <legend>קישורים אופציונליים</legend>
          <Select
            label="תנועה מקושרת"
            name="transaction_id"
            value={form.transaction_id}
            loading={loadingEntities}
            onValueChange={(value) => updateField('transaction_id', value)}
            helperText="הרשימה כוללת את 50 התנועות האחרונות בלבד."
          >
            <option value="">ללא קישור</option>
            {transactions.map((transaction) => (
              <option key={transaction.id} value={transaction.id}>
                {transaction.description} · {formatMoneyForOption(transaction.total_amount)} · {transaction.transaction_date}
              </option>
            ))}
          </Select>

          <Select
            label="הלוואה מקושרת"
            name="loan_id"
            value={form.loan_id}
            loading={loadingEntities}
            onValueChange={(value) => updateField('loan_id', value)}
          >
            <option value="">ללא קישור</option>
            {loans.map((loan) => (
              <option key={loan.id} value={loan.id}>
                {loan.name} · {formatMoneyForOption(loan.current_balance)} יתרה
              </option>
            ))}
          </Select>
        </fieldset>
      </form>
    </Dialog>
  );
};

export default TaskModal;
