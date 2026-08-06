import './selection.css';

const SegmentedControl = ({
  value,
  onValueChange,
  options,
  label,
  labelledBy,
  size = 'standard',
  fullWidth = false,
  disabled = false,
  direction = 'rtl',
  className = '',
}) => {
  const handleKeyDown = (event) => {
    const enabledOptions = [...event.currentTarget.querySelectorAll('[role="radio"]:not(:disabled)')];
    const currentIndex = enabledOptions.indexOf(document.activeElement);
    if (currentIndex < 0 || !enabledOptions.length) return;

    let nextIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = enabledOptions.length - 1;
    else if (event.key === 'ArrowRight') nextIndex = currentIndex + (direction === 'rtl' ? -1 : 1);
    else if (event.key === 'ArrowLeft') nextIndex = currentIndex + (direction === 'rtl' ? 1 : -1);
    else return;

    event.preventDefault();
    const wrappedIndex = (nextIndex + enabledOptions.length) % enabledOptions.length;
    enabledOptions[wrappedIndex].focus();
    enabledOptions[wrappedIndex].click();
  };

  return (
    <div
      className={[
        'ui-segmented',
        `ui-segmented--${size}`,
        fullWidth ? 'ui-segmented--full' : '',
        className,
      ].filter(Boolean).join(' ')}
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-disabled={disabled || undefined}
      dir={direction}
      onKeyDown={handleKeyDown}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const Icon = option.icon;
        const optionDisabled = disabled || option.disabled;
        return (
          <button
            key={String(option.value)}
            type="button"
            className={`ui-segmented-option${selected ? ' is-selected' : ''}`}
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={optionDisabled}
            onClick={() => onValueChange?.(option.value)}
          >
            {Icon && <Icon size={16} aria-hidden="true" />}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default SegmentedControl;

