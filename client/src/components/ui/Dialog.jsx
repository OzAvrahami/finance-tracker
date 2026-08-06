import { useId } from 'react';
import { X } from 'lucide-react';
import IconButton from './IconButton';
import Overlay from './Overlay';

const Dialog = ({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  header,
  size = 'md',
  className = '',
  bodyClassName = '',
  footerClassName = '',
  showClose = true,
  closeLabel = 'סגירה',
  backdropLabel = 'סגירת חלון',
  closeDisabled = false,
  dismissOnBackdrop = true,
  dismissOnEscape = true,
  initialFocusRef,
  returnFocusRef,
  fullWidthMobile = true,
}) => {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <Overlay
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      describedBy={description ? descriptionId : undefined}
      initialFocusRef={initialFocusRef}
      returnFocusRef={returnFocusRef}
      dismissOnBackdrop={dismissOnBackdrop && !closeDisabled}
      dismissOnEscape={dismissOnEscape && !closeDisabled}
      panelClassName={`ui-dialog ui-dialog--${size}${fullWidthMobile ? ' ui-dialog--mobile-full' : ''} ${className}`}
      backdropLabel={backdropLabel}
    >
      <div className="ui-dialog-header">
        <div className="ui-dialog-heading">
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
        {header}
        {showClose && (
          <IconButton
            className="ui-dialog-close"
            type="button"
            size="touch"
            aria-label={closeLabel}
            disabled={closeDisabled}
            onClick={() => onClose?.('close-button')}
          >
            <X size={19} aria-hidden="true" />
          </IconButton>
        )}
      </div>
      <div className={`ui-dialog-body ${bodyClassName}`.trim()}>{children}</div>
      {footer && <div className={`ui-dialog-footer ${footerClassName}`.trim()}>{footer}</div>}
    </Overlay>
  );
};

export default Dialog;
