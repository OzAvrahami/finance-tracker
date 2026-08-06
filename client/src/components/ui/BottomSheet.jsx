import { useId } from 'react';
import { X } from 'lucide-react';
import IconButton from './IconButton';
import Overlay from './Overlay';

const BottomSheet = ({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  stickyFooter = false,
  showHandle = true,
  showClose = true,
  closeLabel = 'סגירה',
  backdropLabel = 'סגירת גיליון',
  dismissOnBackdrop = true,
  dismissOnEscape = true,
  initialFocusRef,
  returnFocusRef,
  className = '',
  panelClassName = '',
  handleClassName = '',
  headerClassName = '',
  bodyClassName = '',
}) => {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <Overlay
      open={open}
      onClose={onClose}
      className={`ui-overlay-layer--sheet ${className}`}
      panelClassName={`ui-bottom-sheet ${panelClassName}`}
      labelledBy={titleId}
      describedBy={description ? descriptionId : undefined}
      initialFocusRef={initialFocusRef}
      returnFocusRef={returnFocusRef}
      dismissOnBackdrop={dismissOnBackdrop}
      dismissOnEscape={dismissOnEscape}
      backdropLabel={backdropLabel}
    >
      {showHandle && <div className={`ui-bottom-sheet-handle ${handleClassName}`.trim()} aria-hidden="true" />}
      <div className={`ui-bottom-sheet-header ${headerClassName}`.trim()}>
        <div className="ui-dialog-heading">
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
        {showClose && (
          <IconButton type="button" size="touch" aria-label={closeLabel} onClick={() => onClose?.('close-button')}>
            <X size={19} aria-hidden="true" />
          </IconButton>
        )}
      </div>
      <div className={`ui-bottom-sheet-body ${bodyClassName}`.trim()}>{children}</div>
      {footer && (
        <div className={`ui-bottom-sheet-footer${stickyFooter ? ' is-sticky' : ''}`}>{footer}</div>
      )}
    </Overlay>
  );
};

export default BottomSheet;
