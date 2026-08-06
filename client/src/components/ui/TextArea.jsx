import { forwardRef, useState } from 'react';
import Field from './Field';

const TextArea = forwardRef(({
  id,
  label,
  helperText,
  error,
  successMessage,
  fullWidth = true,
  size = 'standard',
  className = '',
  inputClassName = '',
  disabled = false,
  readOnly = false,
  required = false,
  rows = 4,
  resize = 'vertical',
  showCharacterCount = false,
  maxLength,
  value,
  defaultValue,
  onValueChange,
  onChange,
  dir = 'auto',
  style,
  ...textAreaProps
}, ref) => {
  const [uncontrolledLength, setUncontrolledLength] = useState(() => String(defaultValue ?? '').length);
  const characterCount = value === undefined ? uncontrolledLength : String(value ?? '').length;

  const handleChange = (event) => {
    if (value === undefined) setUncontrolledLength(event.target.value.length);
    onChange?.(event);
    onValueChange?.(event.target.value);
  };

  const count = showCharacterCount
    ? <span className="ui-field-count">{characterCount}{maxLength ? ` / ${maxLength}` : ''}</span>
    : null;

  return (
    <Field
      id={id}
      label={label}
      helperText={helperText}
      error={error}
      successMessage={successMessage}
      fullWidth={fullWidth}
      size={size}
      className={className}
      controlClassName="ui-field-control--multiline"
      disabled={disabled}
      readOnly={readOnly}
      required={required}
      describedBy={textAreaProps['aria-describedby']}
      meta={count}
    >
      {({ controlId, ariaProps }) => (
        <textarea
          {...textAreaProps}
          {...ariaProps}
          ref={ref}
          id={controlId}
          className={`ui-field-textarea u-user-content ${inputClassName}`.trim()}
          dir={dir}
          disabled={disabled}
          readOnly={readOnly}
          required={required}
          rows={rows}
          maxLength={maxLength}
          value={value}
          defaultValue={defaultValue}
          style={{ ...style, resize }}
          onChange={handleChange}
        />
      )}
    </Field>
  );
});

TextArea.displayName = 'TextArea';

export default TextArea;
