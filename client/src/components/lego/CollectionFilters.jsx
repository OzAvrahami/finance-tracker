import { X } from 'lucide-react';
import { SecondaryButton, Select } from '../ui';
import { STATUS_OPTIONS } from '../../utils/legoHelpers';

const CollectionFilters = ({
  filterStatus,
  onFilterChange,
  filterTheme,
  onThemeFilterChange,
  onReset,
  themes,
}) => {
  const hasFilters = filterStatus !== 'All' || filterTheme !== 'All';

  return (
    <section className="lego-filters" aria-label="סינון אוסף לגו">
      <div className="lego-filters__controls">
        <Select
          id="lego-status-filter"
          className="lego-filter-field"
          size="compact"
          label="סטטוס הרכבה"
          value={filterStatus}
          onValueChange={onFilterChange}
        >
          {STATUS_OPTIONS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
        </Select>

        <Select
          id="lego-theme-filter"
          className="lego-filter-field lego-filter-field--theme"
          size="compact"
          label="נושא"
          value={filterTheme}
          onValueChange={onThemeFilterChange}
        >
          <option value="All">כל הנושאים</option>
          {themes.map((theme) => <option key={theme} value={theme}>{theme}</option>)}
        </Select>

        {hasFilters && (
          <SecondaryButton type="button" className="lego-filter-reset" onClick={onReset}>
            <X size={15} aria-hidden="true" />
            ניקוי מסננים
          </SecondaryButton>
        )}
      </div>
      <p>השווי המוצג מבוסס על הנתונים שהוזנו לאוסף ואינו מחיר מכירה בפועל.</p>
    </section>
  );
};

export default CollectionFilters;
