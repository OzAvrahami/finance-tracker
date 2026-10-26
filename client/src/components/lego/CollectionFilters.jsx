import { X } from 'lucide-react';
import { SecondaryButton, Select, TextField } from '../ui';
import { STATUS_OPTIONS } from '../../utils/legoHelpers';

const CollectionFilters = ({
  filterSetNumber,
  onSetNumberFilterChange,
  filterStatus,
  onFilterChange,
  filterTheme,
  onThemeFilterChange,
  onReset,
  themes,
  filterOwnership,
  onOwnershipChange,
}) => {
  const hasFilters =
    filterOwnership !== 'Active' ||
    filterStatus !== 'All' ||
    filterTheme !== 'All' ||
    filterSetNumber !== '';

  return (
    <section className="lego-filters" aria-label="סינון אוסף לגו">
      <div className="lego-filters__controls">
        <Select
          id="lego-ownership-filter"
          className="lego-filter-field"
          size="compact"
          label="בעלות"
          value={filterOwnership}
          onValueChange={onOwnershipChange}
        >
          <option value="Active">באוסף</option>
          <option value="Sold">נמכרו</option>
          <option value="All">הכול</option>
        </Select>
        <TextField
          id="lego-set-number-filter"
          className="lego-filter-field"
          label="מספר סט"
          type="text"
          dir="ltr"
          value={filterSetNumber}
          onValueChange={onSetNumberFilterChange}
          placeholder="77242"
        >
        </TextField>
        <Select
          id="lego-status-filter"
          className="lego-filter-field"
          size="compact"
          label="סטטוס הרכבה"
          value={filterStatus}
          onValueChange={onFilterChange}
          disabled={filterOwnership === 'Sold'}
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
      <p>הסיכום מתייחס תמיד לסטים שבבעלותך כעת, ללא קשר למסנן. הסכומים אינם הוצאות לאורך זמן, שווי שוק או תמורת מכירה.</p>
    </section>
  );
};

export default CollectionFilters;
