import { useId } from 'react';
import './forms.css';

const joinIds = (...ids) => ids.filter(Boolean).join(' ') || undefined;

const Field = ({
  id,
  label,
  required = false,
  helperText,
  error,
  successMessage,
  disabled = false,
  readOnly = false,
  loading = false,
  prefix,
  suffix,
  leading,
  trailing,
  fullWidth = true,
  size = 'standard',
  className = '',
  controlClassName = '',
  unstyledControl = false,
  describedBy,
  meta,
  children,
}) => {
  const generatedId = useId().replaceAll(':', '');
  const controlId = id || `field-${generatedId}`;
  const helperId = helperText ? `${controlId}-help` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const successId = successMessage && !error ? `${controlId}-success` : undefined;
  const metaId = meta ? `${controlId}-meta` : undefined;
  const descriptionIds = joinIds(describedBy, helperId, errorId, successId, metaId);

  const ariaProps = {
    'aria-describedby': descriptionIds,
    'aria-invalid': error ? 'true' : undefined,
    'aria-required': required || undefined,
    'aria-busy': loading || undefined,
  };

  return (
    <div
      className={[
        'ui-field',
        `ui-field--${size}`,
        fullWidth ? 'ui-field--full' : '',
        disabled ? 'is-disabled' : '',
        readOnly ? 'is-readonly' : '',
        error ? 'is-error' : '',
        successMessage && !error ? 'is-success' : '',
        loading ? 'is-loading' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      {label && (
        <label className="ui-field-label" htmlFor={controlId}>
          {label}
          {required && <span className="ui-field-required" aria-hidden="true">*</span>}
        </label>
      )}

      <div
        className={[
          'ui-field-control',
          unstyledControl ? 'ui-field-control--unstyled' : '',
          controlClassName,
        ].filter(Boolean).join(' ')}
        data-disabled={disabled || undefined}
        data-readonly={readOnly || undefined}
      >
        {leading && <span className="ui-field-leading">{leading}</span>}
        {prefix && <span className="ui-field-prefix">{prefix}</span>}
        <span className="ui-field-input-slot">
          {children({ controlId, ariaProps })}
        </span>
        {suffix && <span className="ui-field-suffix">{suffix}</span>}
        {trailing && <span className="ui-field-trailing">{trailing}</span>}
        {loading && <span className="ui-field-spinner" aria-hidden="true" />}
      </div>

      {(helperText || error || successMessage || meta) && (
        <div className="ui-field-messages">
          {helperText && <div id={helperId} className="ui-field-helper">{helperText}</div>}
          {error && <div id={errorId} className="ui-field-error" role="alert">{error}</div>}
          {successMessage && !error && (
            <div id={successId} className="ui-field-success" role="status">{successMessage}</div>
          )}
          {meta && <div id={metaId} className="ui-field-meta">{meta}</div>}
        </div>
      )}
    </div>
  );
};

export default Field;
