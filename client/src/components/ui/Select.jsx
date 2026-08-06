import { forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';
import Field from './Field';

const Select = forwardRef(({
  id,
  label,
  helperText,
  error,
  successMessage,
  placeholder,
  children,
  leading,
  fullWidth = true,
  size = 'standard',
  className = '',
  selectClassName = '',
  technicalLtr = false,
  loading = false,
  disabled = false,
  required = false,
  onValueChange,
  onChange,
  dir,
  ...selectProps
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
      leading={leading}
      trailing={<ChevronDown size={17} aria-hidden="true" />}
      fullWidth={fullWidth}
      size={size}
      className={className}
      loading={loading}
      disabled={disabled || loading}
      required={required}
      describedBy={selectProps['aria-describedby']}
    >
      {({ controlId, ariaProps }) => (
        <select
          {...selectProps}
          {...ariaProps}
          ref={ref}
          id={controlId}
          className={`ui-field-select${technicalLtr ? ' u-technical-ltr' : ''} ${selectClassName}`.trim()}
          dir={technicalLtr ? 'ltr' : dir}
          disabled={disabled || loading}
          required={required}
          onChange={handleChange}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {children}
        </select>
      )}
    </Field>
  );
});

Select.displayName = 'Select';

export default Select;
