import { AlertCircle, AlertTriangle, CircleCheck, Info, X } from 'lucide-react';
import IconButton from './IconButton';
import './feedback.css';

const icons = {
  info: Info,
  success: CircleCheck,
  warning: AlertTriangle,
  error: AlertCircle,
};

const Alert = ({
  variant = 'info',
  title,
  children,
  message,
  action,
  onDismiss,
  dismissLabel = 'סגירת הודעה',
  urgent = false,
  announce = false,
  className = '',
  ...props
}) => {
  const Icon = icons[variant] || Info;
  const role = urgent ? 'alert' : (announce ? 'status' : undefined);

  return (
    <div
      {...props}
      className={`ui-alert ui-alert--${variant} ${className}`.trim()}
      role={role}
      aria-live={urgent ? 'assertive' : (announce ? 'polite' : undefined)}
    >
      <Icon className="ui-alert-icon" size={20} aria-hidden="true" />
      <div className="ui-alert-content">
        {title && <div className="ui-alert-title">{title}</div>}
        {(children || message) && <div className="ui-alert-message">{children || message}</div>}
      </div>
      {action && <div className="ui-alert-action">{action}</div>}
      {onDismiss && (
        <IconButton
          className="ui-alert-dismiss"
          type="button"
          size="touch"
          aria-label={dismissLabel}
          onClick={onDismiss}
        >
          <X size={17} aria-hidden="true" />
        </IconButton>
      )}
    </div>
  );
};

export default Alert;
