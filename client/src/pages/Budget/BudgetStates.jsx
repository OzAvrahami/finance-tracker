import { AlertTriangle, Plus, TrendingDown, X } from 'lucide-react';
import {
  Alert,
  EmptyState,
  GlassCard,
  IconButton,
  NumberField,
  PrimaryButton,
  SecondaryButton,
  Select,
  Skeleton,
  TextField,
} from '../../components/ui';
import { formatBudgetMonth } from './budgetMonth';
import { absoluteMoney } from '../../utils/money';
import BudgetMoneyAmount from './BudgetMoneyAmount';

export const AddBudgetPanel = ({
  open,
  month,
  categories,
  categoryId,
  amount,
  saving,
  error,
  onCategoryChange,
  onAmountChange,
  onSave,
  onClose,
}) => {
  if (!open) return null;

  return (
    <GlassCard className="budget-add-panel" padding="18px">
      <div className="budget-add-panel__heading">
        <div>
          <h2>הוספת קטגוריית הוצאה לתקציב {formatBudgetMonth(month)}</h2>
          <p>אפשר לבחור רק קטגוריית הוצאה שעדיין לא הוגדר עבורה תקציב בחודש הזה.</p>
        </div>
        <IconButton
          type="button"
          size="sm"
          aria-label="סגירת הוספת תקציב"
          disabled={saving}
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </IconButton>
      </div>
      {categories.length === 0 ? (
        <div className="budget-add-panel__unavailable" role="status">
          אין קטגוריות נוספות להוספה
        </div>
      ) : (
        <div className="budget-add-panel__form">
          <Select
            id="budget-new-category"
            label="קטגוריית הוצאה"
            value={categoryId}
            onChange={(event) => onCategoryChange(event.target.value)}
            placeholder="בחירת קטגוריה"
            disabled={saving}
            required
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.icon ? `${category.icon} ` : ''}{category.name}
              </option>
            ))}
          </Select>
          <NumberField
            id="budget-new-amount"
            label="סכום התקציב"
            value={amount}
            onChange={(event) => onAmountChange(event.target.value)}
            disabled={saving}
            required
          />
          <div className="budget-add-panel__actions">
            <SecondaryButton type="button" disabled={saving} onClick={onClose}>ביטול</SecondaryButton>
            <PrimaryButton
              type="button"
              loading={saving}
              loadingText="מוסיף..."
              disabled={!categoryId || amount === ''}
              onClick={onSave}
            >
              <Plus size={16} aria-hidden="true" />
              הוספה
            </PrimaryButton>
          </div>
        </div>
      )}
      {error && <Alert variant="error" urgent>{error}</Alert>}
    </GlassCard>
  );
};

export const ManualFundingPanel = ({
  open,
  amount,
  sourceLabel,
  saving,
  error,
  onAmountChange,
  onSourceLabelChange,
  onSave,
  onClose,
}) => {
  if (!open) return null;

  return (
    <GlassCard className="budget-add-panel" padding="18px">
      <div className="budget-add-panel__heading">
        <div>
          <h2>הוספת כסף זמין לתקצוב</h2>
          <p>רק כסף זמין שאושר ידנית נכנס למסגרת התקציב. הכנסה צפויה אינה מממנת את התקציב אוטומטית.</p>
        </div>
        <IconButton
          type="button"
          size="sm"
          aria-label="סגירת הוספת כסף זמין"
          disabled={saving}
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </IconButton>
      </div>
      <div className="budget-add-panel__form">
        <TextField
          id="budget-funding-source"
          label="מקור הכסף הזמין"
          value={sourceLabel}
          onChange={(event) => onSourceLabelChange(event.target.value)}
          placeholder="לדוגמה: יתרה זמינה בחשבון"
          disabled={saving}
          required
        />
        <NumberField
          id="budget-funding-amount"
          label="סכום זמין"
          value={amount}
          onChange={(event) => onAmountChange(event.target.value)}
          disabled={saving}
          required
        />
        <div className="budget-add-panel__actions">
          <SecondaryButton type="button" disabled={saving} onClick={onClose}>ביטול</SecondaryButton>
          <PrimaryButton
            type="button"
            loading={saving}
            loadingText="מוסיף..."
            disabled={!sourceLabel.trim() || !amount}
            onClick={onSave}
          >
            <Plus size={16} aria-hidden="true" />
            הוספת כסף זמין
          </PrimaryButton>
        </div>
      </div>
      {error && <Alert variant="error" urgent>{error}</Alert>}
    </GlassCard>
  );
};

export const BudgetSkeleton = () => (
  <GlassCard className="budget-list-skeleton" padding="18px" aria-label="טעינת פירוט התקציב">
    <span className="u-sr-only" role="status">טוען את התקציב החודשי</span>
    {Array.from({ length: 6 }, (_, index) => (
      <div className="budget-list-skeleton__row" key={index}>
        <Skeleton width="23%" height="18px" />
        <Skeleton width="13%" height="18px" />
        <Skeleton width="13%" height="18px" />
        <Skeleton width="24%" height="8px" />
      </div>
    ))}
  </GlassCard>
);

export const BudgetEmpty = ({ month, canAdd, onAdd, onCopy }) => (
  <GlassCard className="budget-empty-card" padding="0">
    <EmptyState
      title={`לא הוגדר תקציב ל${formatBudgetMonth(month)}`}
      description="אפשר להוסיף יעדים לקטגוריות הוצאה או להעתיק את יעדי התקציב מחודש אחר."
      primaryAction={canAdd ? (
        <PrimaryButton type="button" onClick={onAdd}>
          <Plus size={16} aria-hidden="true" />
          הוספת קטגוריה
        </PrimaryButton>
      ) : undefined}
      secondaryAction={(
        <SecondaryButton type="button" onClick={onCopy}>העתקת תקציב</SecondaryButton>
      )}
    />
  </GlassCard>
);

const InsightList = ({ rows, emptyText, tone, remaining }) => (
  rows.length === 0 ? (
    <p className="budget-insight-card__empty">{emptyText}</p>
  ) : (
    <ul className="budget-insight-list">
      {rows.map((row) => (
        <li key={row.id}>
          <span>{row.categories?.icon} {row.categories?.name}</span>
          <span className={`budget-insight-list__amount budget-insight-list__amount--${tone}`}>
            <BudgetMoneyAmount value={absoluteMoney(row.diff)} />
            {remaining && <span> נותר</span>}
          </span>
        </li>
      ))}
    </ul>
  )
);

export const BudgetInsights = ({ insights }) => (
  <section className="budget-insights" aria-labelledby="budget-insights-title">
    <h2 id="budget-insights-title">תמונת מצב לפי קטגוריות</h2>
    <div className="budget-insights__grid">
      <GlassCard className="budget-insight-card budget-insight-card--negative" padding="16px">
        <h3><AlertTriangle size={17} aria-hidden="true" /> החריגות הגבוהות</h3>
        <InsightList
          rows={insights.overBudget}
          emptyText="אין קטגוריות בחריגה מהתקציב."
          tone="negative"
        />
      </GlassCard>
      <GlassCard className="budget-insight-card budget-insight-card--neutral" padding="16px">
        <h3><TrendingDown size={17} aria-hidden="true" /> קטגוריות בניצול נמוך</h3>
        <InsightList
          rows={insights.underUtilized}
          emptyText="לא נמצאו קטגוריות עם יתרה זמינה."
          tone="positive"
          remaining
        />
      </GlassCard>
    </div>
  </section>
);
