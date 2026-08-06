import { useRef, useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import Dialog from './Dialog';
import Alert from './Alert';
import { PrimaryButton, SecondaryButton } from './Button';

const ConfirmDialogContent = ({
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'אישור',
  cancelLabel = 'ביטול',
  variant = 'warning',
  loading = false,
  disabled = false,
  error,
  errorMessage = 'הפעולה נכשלה. אפשר לנסות שוב.',
  closeOnConfirm = true,
  dismissOnBackdrop = true,
  dismissOnEscape = true,
  returnFocusRef,
}) => {
  const cancelRef = useRef(null);
  const [pending, setPending] = useState(false);
  const [internalError, setInternalError] = useState(null);
  const isPending = loading || pending;
  const isDestructive = variant === 'destructive';
  const Icon = isDestructive ? Trash2 : AlertTriangle;

  const handleConfirm = async () => {
    if (isPending || disabled) return;

    setPending(true);
    setInternalError(null);
    try {
      const result = await onConfirm?.();
      if (closeOnConfirm && result !== false) onClose?.('confirmed');
    } catch {
      setInternalError(errorMessage);
    } finally {
      setPending(false);
    }
  };

  const handleClose = (reason) => {
    if (!isPending) {
      setInternalError(null);
      onClose?.(reason);
    }
  };

  return (
    <Dialog
      open
      onClose={handleClose}
      title={title}
      size="sm"
      className={`ui-confirm-dialog ui-confirm-dialog--${variant}`}
      initialFocusRef={cancelRef}
      returnFocusRef={returnFocusRef}
      closeDisabled={isPending}
      dismissOnBackdrop={dismissOnBackdrop}
      dismissOnEscape={dismissOnEscape}
      footer={(
        <>
          <SecondaryButton ref={cancelRef} type="button" disabled={isPending} onClick={() => handleClose('cancelled')}>
            {cancelLabel}
          </SecondaryButton>
          <PrimaryButton
            type="button"
            className={isDestructive ? 'ui-btn-destructive' : 'ui-btn-warning'}
            loading={isPending}
            loadingText={confirmLabel}
            disabled={disabled}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </PrimaryButton>
        </>
      )}
    >
      <div className="ui-confirm-message">
        <span className="ui-confirm-icon" aria-hidden="true"><Icon size={22} /></span>
        <div>{message}</div>
      </div>
      {(error || internalError) && (
        <Alert variant="error" urgent>{error || internalError}</Alert>
      )}
    </Dialog>
  );
};

const ConfirmDialog = (props) => (
  props.open ? <ConfirmDialogContent {...props} /> : null
);

export default ConfirmDialog;
