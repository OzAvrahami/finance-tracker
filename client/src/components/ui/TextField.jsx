import { forwardRef } from 'react';
import Field from './Field';

const TextField = forwardRef(({
  id,
  label,
  helperText,
  error,
  successMessage,
  prefix,
  suffix,
  leading,
  trailing,
  fullWidth = true,
  size = 'standard',
  className = '',
  inputClassName = '',
  technicalLtr = false,
  loading = false,
  disabled = false,
  readOnly = false,
  required = false,
  onValueChange,
  onChange,
  dir,
  ...inputProps
}, ref) => {
  const handleChange = (event) => {
    onChange?.(event);
    onValueChange?.(event.target.value);
  };

  return (
    <Field
      id={id}
      label={label}
      helperText={helperText}
      error={error}
      successMessage={successMessage}
      prefix={prefix}
      suffix={suffix}
      leading={leading}
      trailing={trailing}
      fullWidth={fullWidth}
      size={size}
      className={className}
      loading={loading}
      disabled={disabled}
      readOnly={readOnly}
      required={required}
      describedBy={inputProps['aria-describedby']}
    >
      {({ controlId, ariaProps }) => (
        <input
          {...inputProps}
          {...ariaProps}
          ref={ref}
          id={controlId}
          className={`ui-field-input${technicalLtr ? ' u-technical-ltr' : ''} ${inputClassName}`.trim()}
          dir={technicalLtr ? 'ltr' : dir}
          disabled={disabled}
          readOnly={readOnly}
          required={required}
          onChange={handleChange}
        />
      )}
    </Field>
  );
});

TextField.displayName = 'TextField';

export default TextField;

