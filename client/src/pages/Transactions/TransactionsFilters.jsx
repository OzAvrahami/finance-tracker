import { useRef, useState } from 'react';
import { Filter, RefreshCw, SlidersHorizontal, Tags, X } from 'lucide-react';
import {
  BottomSheet,
  DateField,
  PrimaryButton,
  SearchField,
  SecondaryButton,
  Select,
  TechnicalValue,
} from '../../components/ui';

const DATE_PRESETS = [
  { key: 'thisMonth', label: 'החודש הנוכחי' },
  { key: 'lastMonth', label: 'החודש הקודם' },
  { key: 'clear', label: 'כל ההיסטוריה' },
];

const FilterFields = ({
  idPrefix,
  categories,
  paymentSources,
  searchText,
  selectedCategory,
  selectedPaymentSource,
  dateRange,
  activeDatePreset,
  showUncategorizedOnly,
  searchPending,
  onSearchChange,
  onCategoryChange,
  onPaymentSourceChange,
  onDateRangeChange,
  onPresetDate,
  onToggleUncategorized,
  resetControl,
}) => (
  <>
    <fieldset className="transactions-presets">
      <legend>תקופה מהירה</legend>
      <div className="transactions-presets__control">
        {DATE_PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            aria-pressed={activeDatePreset === preset.key}
            onClick={() => onPresetDate(preset.key)}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </fieldset>

    <SearchField
      id={`${idPrefix}-search`}
      className="transactions-filter-field transactions-filter-field--search"
      label="חיפוש תנועות"
      placeholder="חיפוש לפי תיאור, סכום, קטגוריה או אמצעי תשלום"
      value={searchText}
      onValueChange={onSearchChange}
      clearLabel="ניקוי חיפוש התנועות"
      loading={searchPending}
      size="compact"
    />

    <div className="transactions-filter-grid">
      <DateField
        id={`${idPrefix}-from`}
        label="מתאריך"
        value={dateRange.start}
        onValueChange={(start) => onDateRangeChange({ ...dateRange, start })}
        size="compact"
      />
      <DateField
        id={`${idPrefix}-to`}
        label="עד תאריך"
        value={dateRange.end}
        onValueChange={(end) => onDateRangeChange({ ...dateRange, end })}
        size="compact"
      />
      <Select
        id={`${idPrefix}-category`}
        label="קטגוריה"
        value={selectedCategory}
        onValueChange={onCategoryChange}
        size="compact"
      >
        <option value="all">כל הקטגוריות</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.icon ? `${category.icon} ` : ''}{category.name}
          </option>
        ))}
      </Select>
      <Select
        id={`${idPrefix}-payment-source`}
        label="אמצעי תשלום"
        value={selectedPaymentSource}
        onValueChange={onPaymentSourceChange}
        size="compact"
      >
        <option value="all">כל אמצעי התשלום</option>
        {paymentSources.map((source) => (
          <option key={source.id} value={source.id}>{source.name}</option>
        ))}
      </Select>
    </div>

    <button
      type="button"
      className={`transactions-uncategorized-toggle${showUncategorizedOnly ? ' is-active' : ''}`}
      role="switch"
      aria-checked={showUncategorizedOnly}
      onClick={onToggleUncategorized}
    >
      <span className="transactions-uncategorized-toggle__track" aria-hidden="true">
        <span />
      </span>
      רק תנועות ללא קטגוריה
    </button>

    {resetControl}
  </>
);

export const ActiveFilterChips = ({ filters, onReset, periodContext }) => {
  if (filters.length === 0 && !periodContext) return null;

  return (
    <div className="transactions-active-filters" aria-label="מסננים פעילים">
      <span className="transactions-active-filters__label">
        <Filter size={14} aria-hidden="true" />
        מסננים פעילים
      </span>
      <ul>
        {periodContext && (
          <li className="transactions-period-context">
            <span>{periodContext}</span>
          </li>
        )}
        {filters.map((filter) => (
          <li key={filter.key}>
            <span>{filter.label}</span>
            <button type="button" onClick={filter.onRemove} aria-label={`הסרת המסנן ${filter.accessibleName}`}>
              <X size={14} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {filters.length > 0 && (
        <button type="button" className="transactions-reset-link" onClick={onReset}>איפוס הכול</button>
      )}
    </div>
  );
};

const ResetButton = ({ onReset, disabled = false }) => (
  <SecondaryButton type="button" size="sm" onClick={onReset} disabled={disabled}>
    <RefreshCw size={15} aria-hidden="true" />
    איפוס
  </SecondaryButton>
);

export const TransactionsFilters = ({
  activeFilters,
  onReset,
  periodContext,
  resetAvailable,
  ...filterProps
}) => {
  const [sheetOpen, setSheetOpen] = useState(false);
  const triggerRef = useRef(null);
  const hasActiveFilters = activeFilters.length > 0;
  const canReset = resetAvailable ?? hasActiveFilters;

  return (
    <section className="transactions-filter-section" aria-labelledby="transactions-filters-heading">
      <h2 id="transactions-filters-heading" className="transactions-visually-hidden">סינון תנועות</h2>

      <form className="transactions-filters transactions-filters--desktop" onSubmit={(event) => event.preventDefault()}>
        <FilterFields
          idPrefix="transactions-desktop"
          resetControl={<ResetButton onReset={onReset} disabled={!canReset} />}
          {...filterProps}
        />
      </form>

      <div className="transactions-mobile-filter-bar">
        <button
          ref={triggerRef}
          type="button"
          className={`transactions-mobile-filter-trigger${hasActiveFilters ? ' is-active' : ''}`}
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
        >
          <SlidersHorizontal size={18} aria-hidden="true" />
          מסננים
          {hasActiveFilters && (
            <TechnicalValue className="transactions-mobile-filter-count" aria-label={`${activeFilters.length} מסננים פעילים`}>
              {activeFilters.length}
            </TechnicalValue>
          )}
        </button>
        <span><Tags size={16} aria-hidden="true" />{hasActiveFilters ? `${activeFilters.length} מסננים פעילים` : 'ברירת המחדל: החודש הנוכחי'}</span>
      </div>

      <ActiveFilterChips filters={activeFilters} onReset={onReset} periodContext={periodContext} />

      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="סינון תנועות"
        description="השינויים חלים מיד על הרשימה המלאה."
        returnFocusRef={triggerRef}
        bodyClassName="transactions-filter-sheet__body"
        panelClassName="transactions-filter-sheet"
        stickyFooter
        footer={(
          <div className="transactions-filter-sheet__footer">
            <PrimaryButton type="button" fullWidth onClick={() => setSheetOpen(false)}>סיום</PrimaryButton>
            <ResetButton onReset={onReset} disabled={!canReset} />
          </div>
        )}
      >
        <form className="transactions-filters transactions-filters--sheet" onSubmit={(event) => event.preventDefault()}>
          <FilterFields idPrefix="transactions-mobile" {...filterProps} />
        </form>
      </BottomSheet>
    </section>
  );
};

export default TransactionsFilters;
