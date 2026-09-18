import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Plus, Search } from 'lucide-react';
import Field from './ui/Field';
import './CategoryCombobox.css';

const normalize = (value) => String(value ?? '').trim().toLocaleLowerCase();

const categoryDisplayText = (category) => (
  category ? [category.icon, category.name].filter(Boolean).join(' ') : ''
);

const categoryMatchesQuery = (category, query) => (
  normalize(categoryDisplayText(category)).includes(query)
);

const filterCategories = (categoryList, queryValue, selectedDisplay = '') => {
  const query = normalize(queryValue);
  if (!query || (selectedDisplay && query === normalize(selectedDisplay))) return categoryList;
  return categoryList.filter((category) => categoryMatchesQuery(category, query));
};

const selectionSignature = (categoryId, displayText) => (
  `${String(categoryId ?? '')}\u0000${displayText}`
);

const categoryOptionId = (listboxId, categoryId) => (
  `${listboxId}-option-${encodeURIComponent(String(categoryId))}`
);

const CategoryCombobox = ({
  id,
  name = 'category_id',
  label,
  ariaLabel,
  helperText,
  error,
  required = false,
  disabled = false,
  loading = false,
  fullWidth = true,
  size = 'standard',
  placeholder = 'הקלד לחיפוש קטגוריה...',
  categories = [],
  categoryType,
  selectedCategoryId = '',
  onSelect,
  onOpenNewModal,
  className = '',
}) => {
  const generatedId = useId().replaceAll(':', '');
  const inputId = id || `category-combobox-${generatedId}`;
  const listboxId = `${inputId}-listbox`;
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const popupRef = useRef(null);
  const listboxRef = useRef(null);
  const revealActiveRef = useRef(true);

  const availableCategories = useMemo(() => (
    categories.filter((category) => !categoryType || category.type === categoryType)
  ), [categories, categoryType]);

  const selectedCategory = availableCategories.find(
    (category) => String(category.id) === String(selectedCategoryId),
  );
  const selectedDisplay = categoryDisplayText(selectedCategory);
  const currentSelectionSignature = selectionSignature(selectedCategoryId, selectedDisplay);

  const [searchText, setSearchText] = useState('');
  const [interactionSignature, setInteractionSignature] = useState(currentSelectionSignature);
  const [openRequested, setOpenRequested] = useState(false);
  const [activeCategoryId, setActiveCategoryId] = useState(null);

  const interactionMatchesSelection = interactionSignature === currentSelectionSignature;
  const isOpen = openRequested && interactionMatchesSelection && !disabled;
  const inputValue = interactionMatchesSelection
    ? (isOpen || !selectedCategory ? searchText : selectedDisplay)
    : selectedDisplay;

  const filteredCategories = useMemo(() => {
    return filterCategories(availableCategories, inputValue, selectedDisplay);
  }, [availableCategories, inputValue, selectedDisplay]);

  const enabledCategories = filteredCategories.filter((category) => !category.disabled);
  const activeCategory = enabledCategories.find(
    (category) => String(category.id) === String(activeCategoryId),
  ) || enabledCategories[0];
  const activeOptionId = isOpen && activeCategory
    ? categoryOptionId(listboxId, activeCategory.id)
    : undefined;

  const trimmedSearch = searchText.trim();
  const hasExactCategory = availableCategories.some(
    (category) => (
      normalize(category.name) === normalize(trimmedSearch)
      || normalize(categoryDisplayText(category)) === normalize(trimmedSearch)
    ),
  );
  const canCreateTypedCategory = Boolean(trimmedSearch) && !hasExactCategory;

  const closeList = ({ restoreSelection = true } = {}) => {
    setOpenRequested(false);
    setActiveCategoryId(null);
    if (restoreSelection && selectedCategory) setSearchText('');
  };

  const openList = (initialDirection = 'first') => {
    if (disabled) return;
    revealActiveRef.current = true;
    const nextSearch = selectedCategory ? selectedDisplay : inputValue;
    const nextFiltered = filterCategories(availableCategories, nextSearch, selectedDisplay);
    const enabled = nextFiltered.filter((category) => !category.disabled);
    const enabledSelection = enabled.find(
      (category) => String(category.id) === String(selectedCategoryId),
    );

    setSearchText(nextSearch);
    setInteractionSignature(currentSelectionSignature);
    setActiveCategoryId(
      initialDirection === 'last'
        ? enabled.at(-1)?.id ?? null
        : enabledSelection?.id ?? enabled[0]?.id ?? null,
    );
    setOpenRequested(true);
  };

  const selectCategory = (category) => {
    if (!category || category.disabled) return;
    const displayText = categoryDisplayText(category);
    setSearchText('');
    setInteractionSignature(selectionSignature(category.id, displayText));
    setOpenRequested(false);
    setActiveCategoryId(null);
    onSelect?.(category.id);
    inputRef.current?.focus({ preventScroll: true });
  };

  const openCreation = () => {
    const proposedName = canCreateTypedCategory ? trimmedSearch : '';
    closeList({ restoreSelection: false });
    onOpenNewModal?.(proposedName);
  };

  useEffect(() => {
    const handleOutsidePointer = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)
        && !popupRef.current?.contains(event.target)) {
        setOpenRequested(false);
        setActiveCategoryId(null);
      }
    };

    document.addEventListener('pointerdown', handleOutsidePointer);
    return () => document.removeEventListener('pointerdown', handleOutsidePointer);
  }, []);

  // Escape card overflow/backdrop-filter stacking contexts. Anchor to the input,
  // and fit the visible viewport (including a mobile keyboard), above or below.
  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    const placePopup = () => {
      const anchor = inputRef.current?.getBoundingClientRect();
      const popup = popupRef.current;
      if (!anchor || !popup) return;
      const viewport = window.visualViewport;
      const top = (viewport?.offsetTop || 0) + 8;
      const left = (viewport?.offsetLeft || 0) + 8;
      const width = (viewport?.width || window.innerWidth) - 16;
      const bottom = top + (viewport?.height || window.innerHeight) - 16;
      const below = Math.max(0, bottom - anchor.bottom - 4);
      const above = Math.max(0, anchor.top - top - 4);
      const preferredHeight = Math.min(320, (viewport?.height || window.innerHeight) * 0.45);
      const flip = below < preferredHeight && above > below;
      popup.style.maxHeight = `${Math.min(preferredHeight, flip ? above : below)}px`;
      popup.style.width = `${Math.min(anchor.width, width)}px`;
      popup.style.left = `${Math.max(left, Math.min(anchor.left, left + width - Math.min(anchor.width, width)))}px`;
      const popupHeight = popup.getBoundingClientRect().height;
      const desiredTop = flip ? anchor.top - 4 - popupHeight : anchor.bottom + 4;
      popup.style.top = `${Math.max(top, Math.min(desiredTop, bottom - popupHeight))}px`;
      popup.dir = getComputedStyle(inputRef.current).direction;
    };
    const handleScroll = (event) => {
      if (!popupRef.current?.contains(event.target)) placePopup();
    };
    placePopup();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(placePopup);
    observer?.observe(inputRef.current);
    observer?.observe(popupRef.current);
    window.addEventListener('resize', placePopup);
    window.addEventListener('scroll', handleScroll, true);
    window.visualViewport?.addEventListener('resize', placePopup);
    window.visualViewport?.addEventListener('scroll', placePopup);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', placePopup);
      window.removeEventListener('scroll', handleScroll, true);
      window.visualViewport?.removeEventListener('resize', placePopup);
      window.visualViewport?.removeEventListener('scroll', placePopup);
    };
  }, [isOpen]);

  useLayoutEffect(() => {
    const list = listboxRef.current;
    const option = activeOptionId && document.getElementById(activeOptionId);
    if (!isOpen || !list || !option || !revealActiveRef.current) return;
    const bounds = list.getBoundingClientRect();
    const activeBounds = option.getBoundingClientRect();
    // Only scroll the listbox; scrollIntoView can also scroll the form/page.
    if (activeBounds.top < bounds.top) list.scrollTop -= bounds.top - activeBounds.top;
    else if (activeBounds.bottom > bounds.bottom) list.scrollTop += activeBounds.bottom - bounds.bottom;
  }, [isOpen, activeOptionId, inputValue]);

  const handleInputChange = (event) => {
    revealActiveRef.current = true;
    const nextSearch = event.target.value;
    const nextFiltered = filterCategories(availableCategories, nextSearch, selectedDisplay);
    const firstEnabled = nextFiltered.find((category) => !category.disabled);

    setSearchText(nextSearch);
    setInteractionSignature(
      nextSearch ? currentSelectionSignature : selectionSignature('', ''),
    );
    setActiveCategoryId(firstEnabled?.id ?? null);
    setOpenRequested(true);

    if (!nextSearch) onSelect?.('');
  };

  const moveActive = (direction) => {
    if (!enabledCategories.length) return;
    const currentIndex = enabledCategories.findIndex(
      (category) => String(category.id) === String(activeCategory?.id),
    );
    const startIndex = currentIndex < 0 ? 0 : currentIndex;
    const nextIndex = (startIndex + direction + enabledCategories.length) % enabledCategories.length;
    setActiveCategoryId(enabledCategories[nextIndex].id);
  };

  const handleKeyDown = (event) => {
    if (disabled) return;
    revealActiveRef.current = true;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) openList('first');
      else moveActive(1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) openList('last');
      else moveActive(-1);
      return;
    }

    if (!isOpen) return;

    if (event.key === 'Home') {
      event.preventDefault();
      setActiveCategoryId(enabledCategories[0]?.id ?? null);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveCategoryId(enabledCategories.at(-1)?.id ?? null);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeCategory) selectCategory(activeCategory);
      else if (canCreateTypedCategory && onOpenNewModal) openCreation();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeList();
    }
  };

  const handleBlur = (event) => {
    if (!rootRef.current?.contains(event.relatedTarget)
      && !popupRef.current?.contains(event.relatedTarget)) closeList();
  };

  const createLabel = canCreateTypedCategory
    ? `יצירת קטגוריה ״${trimmedSearch}״`
    : 'יצירת קטגוריה חדשה';

  return (
    <div
      ref={rootRef}
      className={`category-combobox ${className}`.trim()}
      onBlur={handleBlur}
    >
      <Field
        id={inputId}
        label={label}
        helperText={helperText}
        error={error}
        required={required}
        disabled={disabled}
        loading={loading}
        fullWidth={fullWidth}
        size={size}
        className="category-combobox__field"
        controlClassName={`category-combobox__control${isOpen ? ' is-open' : ''}`}
        leading={<Search size={17} aria-hidden="true" />}
        trailing={<ChevronDown size={17} aria-hidden="true" />}
      >
        {({ controlId, ariaProps }) => (
          <input
            {...ariaProps}
            ref={inputRef}
            id={controlId}
            className="ui-field-input category-combobox__input"
            type="text"
            role="combobox"
            aria-label={label ? undefined : ariaLabel || 'קטגוריה'}
            aria-autocomplete="list"
            aria-expanded={isOpen}
            aria-controls={listboxId}
            aria-activedescendant={activeOptionId}
            autoComplete="off"
            placeholder={placeholder}
            value={inputValue}
            disabled={disabled}
            required={required}
            onChange={handleInputChange}
            onFocus={() => { if (!isOpen) openList('first'); }}
            onClick={() => { if (!isOpen) openList('first'); }}
            onKeyDown={handleKeyDown}
          />
        )}
      </Field>

      <input type="hidden" name={name} value={selectedCategoryId ?? ''} />

      {isOpen && createPortal(
        <div ref={popupRef} className="category-combobox__popup">
          <div ref={listboxRef} id={listboxId} className="category-combobox__listbox" role="listbox" aria-label={label || ariaLabel || 'קטגוריה'}>
            {loading ? (
              <div className="category-combobox__empty" role="status">טוען קטגוריות...</div>
            ) : filteredCategories.length ? (
              filteredCategories.map((category) => {
                const selected = String(category.id) === String(selectedCategoryId);
                const active = String(category.id) === String(activeCategory?.id);
                return (
                  <button
                    key={category.id}
                    id={categoryOptionId(listboxId, category.id)}
                    className={[
                      'category-combobox__option',
                      active ? 'is-active' : '',
                      selected ? 'is-selected' : '',
                    ].filter(Boolean).join(' ')}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-disabled={category.disabled || undefined}
                    disabled={category.disabled}
                    tabIndex={-1}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectCategory(category)}
                    onPointerMove={(event) => {
                      if (event.pointerType === 'mouse' && !category.disabled) {
                        revealActiveRef.current = false;
                        setActiveCategoryId(category.id);
                      }
                    }}
                  >
                    {category.icon && (
                      <span className="category-combobox__icon" aria-hidden="true">{category.icon}</span>
                    )}
                    <span className="category-combobox__name">{category.name}</span>
                    {selected && <Check size={16} aria-hidden="true" />}
                  </button>
                );
              })
            ) : (
              <div className="category-combobox__empty" role="status">לא נמצאו תוצאות</div>
            )}
          </div>

          {onOpenNewModal && !hasExactCategory && (
            <button
              className="category-combobox__create"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={openCreation}
            >
              <Plus size={16} aria-hidden="true" />
              <span>{createLabel}</span>
            </button>
          )}
        </div>, document.body,
      )}
    </div>
  );
};

export default CategoryCombobox;
