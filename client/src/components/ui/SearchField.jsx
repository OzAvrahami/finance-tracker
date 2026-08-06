import { useRef } from 'react';
import { Search, X } from 'lucide-react';
import IconButton from './IconButton';
import TextField from './TextField';

const SearchField = ({
  value,
  onValueChange,
  onClear,
  clearLabel = 'ניקוי החיפוש',
  loading = false,
  disabled = false,
  readOnly = false,
  onKeyDown,
  ...props
}) => {
  const inputRef = useRef(null);

  const clear = () => {
    if (disabled || readOnly) return;
    onValueChange?.('');
    onClear?.();
    inputRef.current?.focus();
  };

  const handleKeyDown = (event) => {
    onKeyDown?.(event);
    if (event.key === 'Escape' && !event.defaultPrevented && value) {
      event.preventDefault();
      event.stopPropagation();
      clear();
    }
  };

  const clearButton = value && !disabled && !readOnly ? (
    <IconButton type="button" size="touch" aria-label={clearLabel} onClick={clear}>
      <X size={16} aria-hidden="true" />
    </IconButton>
  ) : null;

  return (
    <TextField
      {...props}
      ref={inputRef}
      type="search"
      role="searchbox"
      value={value}
      onValueChange={onValueChange}
      onKeyDown={handleKeyDown}
      leading={<Search size={17} aria-hidden="true" />}
      trailing={clearButton}
      loading={loading}
      disabled={disabled}
      readOnly={readOnly}
    />
  );
};

export default SearchField;
