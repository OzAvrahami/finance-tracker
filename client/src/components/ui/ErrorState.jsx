import { useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { PrimaryButton } from './Button';
import TechnicalValue from './TechnicalValue';
import './feedback.css';

const ErrorState = ({
  level = 'section',
  title,
  description,
  onRetry,
  retryLabel = 'ניסיון נוסף',
  retrying = false,
  secondaryAction,
  technicalDetails,
  urgent = false,
  className = '',
  ...props
}) => {
  const [internalRetrying, setInternalRetrying] = useState(false);
  const isRetrying = retrying || internalRetrying;

  const handleRetry = async () => {
    if (!onRetry || isRetrying) return;
    setInternalRetrying(true);
    try {
      await onRetry();
    } catch {
      return;
    } finally {
      setInternalRetrying(false);
    }
  };

  return (
    <section
      {...props}
      className={`ui-error-state ui-error-state--${level} ${className}`.trim()}
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
      aria-busy={isRetrying || undefined}
    >
      <span className="ui-state-icon" aria-hidden="true"><AlertCircle size={level === 'inline' ? 19 : 26} /></span>
      <div className="ui-state-copy">
        <h3>{title}</h3>
        {description && <p>{description}</p>}
        {technicalDetails && (
          <details className="ui-error-details">
            <summary>פרטים טכניים</summary>
            <pre><TechnicalValue>{technicalDetails}</TechnicalValue></pre>
          </details>
        )}
      </div>
      {(onRetry || secondaryAction) && (
        <div className="ui-state-actions">
          {onRetry && (
            <PrimaryButton
              type="button"
              loading={isRetrying}
              loadingText={retryLabel}
              onClick={handleRetry}
            >
              <RefreshCw size={16} aria-hidden="true" />
              {retryLabel}
            </PrimaryButton>
          )}
          {secondaryAction}
        </div>
      )}
    </section>
  );
};

export default ErrorState;
