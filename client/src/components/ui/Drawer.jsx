import { useId } from 'react';
import { X } from 'lucide-react';
import IconButton from './IconButton';
import Overlay from './Overlay';

const Drawer = ({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  side = 'start',
  size = 'md',
  closeLabel = 'סגירה',
  dismissOnBackdrop = true,
  dismissOnEscape = true,
  initialFocusRef,
  returnFocusRef,
  className = '',
}) => {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <Overlay
      open={open}
      onClose={onClose}
      className="ui-overlay-layer--drawer"
      panelClassName={`ui-drawer ui-drawer--${side} ui-drawer--${size} ${className}`}
      labelledBy={titleId}
      describedBy={description ? descriptionId : undefined}
      initialFocusRef={initialFocusRef}
      returnFocusRef={returnFocusRef}
      dismissOnBackdrop={dismissOnBackdrop}
      dismissOnEscape={dismissOnEscape}
      backdropLabel={closeLabel}
    >
      <div className="ui-drawer-header">
        <div className="ui-dialog-heading">
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
        <IconButton type="button" size="touch" aria-label={closeLabel} onClick={() => onClose?.('close-button')}>
          <X size={19} aria-hidden="true" />
        </IconButton>
      </div>
      <div className="ui-drawer-body">{children}</div>
      {footer && <div className="ui-drawer-footer">{footer}</div>}
    </Overlay>
  );
};

export default Drawer;

