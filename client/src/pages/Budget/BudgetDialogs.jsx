import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import {
  Alert,
  ConfirmDialog,
  Dialog,
  PrimaryButton,
  SecondaryButton,
  TextField,
} from '../../components/ui';
import { formatBudgetMonth } from './budgetMonth';

export const CopyBudgetDialog = ({ open, sourceMonth, onClose, onCopy }) => {
  const [targetMonth, setTargetMonth] = useState('');
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setTargetMonth('');
      setError('');
    }
  }, [open]);

  const handleCopy = async () => {
    if (!targetMonth || copying) return;
    setCopying(true);
    setError('');
    try {
      await onCopy(targetMonth);
      onClose('copied');
    } catch {
      setError('העתקת התקציב נכשלה. התקציב בחודש המקור לא השתנה.');
    } finally {
      setCopying(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="העתקת התקציב לחודש אחר"
      description={`יעדי הקטגוריות של ${formatBudgetMonth(sourceMonth)} יועתקו לחודש שייבחר.`}
      size="sm"
      className="budget-copy-dialog"
      closeDisabled={copying}
      footer={(
        <>
          <SecondaryButton type="button" disabled={copying} onClick={() => onClose('cancelled')}>
            ביטול
          </SecondaryButton>
          <PrimaryButton
            type="button"
            loading={copying}
            loadingText="מעתיק..."
            disabled={!targetMonth}
            onClick={handleCopy}
          >
            <Copy size={16} aria-hidden="true" />
            העתקת התקציב
          </PrimaryButton>
        </>
      )}
    >
      <div className="budget-copy-dialog__source">
        <span>חודש מקור</span>
        <strong>{formatBudgetMonth(sourceMonth)}</strong>
      </div>
      <TextField
        id="budget-copy-target"
        type="month"
        label="חודש יעד"
        value={targetMonth}
        onChange={(event) => setTargetMonth(event.target.value)}
        technicalLtr
        required
        disabled={copying}
      />
      <p className="budget-copy-dialog__note">ההעתקה כוללת יעדי תקציב בלבד. תנועות והוצאות בפועל אינן מועתקות.</p>
      {error && <Alert variant="error" urgent>{error}</Alert>}
    </Dialog>
  );
};

export const DeleteBudgetDialog = ({ budget, onClose, onConfirm }) => (
  <ConfirmDialog
    open={Boolean(budget)}
    onClose={onClose}
    onConfirm={() => onConfirm(budget)}
    title="מחיקת תקציב הקטגוריה"
    message={(
      <>
        למחוק את יעד התקציב עבור <strong>{budget?.categoryName}</strong>? התנועות עצמן לא נמחקות — רק יעד התקציב לחודש הזה.
      </>
    )}
    confirmLabel="מחיקת התקציב"
    cancelLabel="ביטול"
    variant="destructive"
    errorMessage="מחיקת התקציב נכשלה. היעד נשאר ברשימה ואפשר לנסות שוב."
  />
);
