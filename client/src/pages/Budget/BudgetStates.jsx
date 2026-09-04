import { AlertTriangle, ArrowLeftRight, CalendarCheck, Plus, TrendingDown, X } from 'lucide-react';
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
import { absoluteMoney, compareMoney } from '../../utils/money';
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

export const RecurringBudgetPanel = ({ recurring, applying, error, onApply, onOpenFunding }) => {
  const hasShortfall = compareMoney(recurring.shortfall) > 0;
  return (
    <GlassCard className="budget-recurring-panel" padding="18px">
      <div className="budget-recurring-panel__heading">
        <div>
          <h2><CalendarCheck size={19} aria-hidden="true" /> תקציבים חוזרים ממתינים</h2>
          <p>ההגדרות מוצגות לעיון בלבד. רק הפעולה המפורשת למטה תיצור תקציבי פתיחה ממומנים.</p>
        </div>
        <div className="budget-recurring-panel__totals" aria-label="סיכום תקציבים חוזרים">
          <span>נדרש <strong><BudgetMoneyAmount value={recurring.required} /></strong></span>
          <span>לא מוקצה <strong><BudgetMoneyAmount value={recurring.unallocated} /></strong></span>
          {hasShortfall && <span className="is-shortfall">חסר <strong><BudgetMoneyAmount value={recurring.shortfall} /></strong></span>}
        </div>
      </div>
      <ul className="budget-recurring-panel__list" aria-label="ברירות מחדל חוזרות ממתינות">
        {recurring.pending_categories.map((item) => (
          <li key={item.category_id}>
            <span>{item.category?.icon} {item.category?.name}</span>
            <BudgetMoneyAmount value={item.amount} />
          </li>
        ))}
      </ul>
      {hasShortfall ? (
        <div className="budget-recurring-panel__actions">
          <Alert variant="warning">
            נדרש להוסיף כסף זמין לחודש לפני שניתן להחיל את כל התקציבים החוזרים.
          </Alert>
          <PrimaryButton type="button" onClick={onOpenFunding}>הוספת כסף זמין</PrimaryButton>
        </div>
      ) : (
        <div className="budget-recurring-panel__actions">
          <PrimaryButton
            type="button"
            loading={applying}
            loadingText="מחיל..."
            onClick={onApply}
          >
            החלת תקציבים חוזרים
          </PrimaryButton>
        </div>
      )}
      {error && <Alert variant="error" urgent>{error}</Alert>}
    </GlassCard>
  );
};

const carryoverReason = {
  CATEGORY_INACTIVE: 'הקטגוריה אינה פעילה',
  SOURCE_BUDGET_MISSING: 'אין תקציב פעיל בחודש הקודם',
  SOURCE_BUDGET_INACTIVE: 'תקציב החודש הקודם אינו פעיל',
  NO_ELIGIBLE_BALANCE: 'לא נותרה יתרה חיובית כשירה',
  DESTINATION_BUDGET_INACTIVE: 'התקציב בחודש הנוכחי אינו פעיל',
  RECURRING_INITIALIZATION_REQUIRED: 'יש להחיל תחילה את התקציב החוזר',
  UNBUDGETED_ACTUAL_EXISTS: 'קיימת הוצאה ללא תקציב בחודש הנוכחי',
  DESTINATION_DEFICIT: 'קיים גירעון פעיל הדורש טיפול נפרד',
};

export const DestinationCarryoverNotice = ({ carryover, onReviewSource }) => {
  const readyCount = carryover.ready_count ?? carryover.ready_categories?.length ?? 0;
  const blockedCount = carryover.blocked_categories?.length || 0;
  const sourceMonth = formatBudgetMonth(carryover.source_month);

  return (
    <GlassCard className="budget-carryover-panel budget-destination-carryover" padding="18px">
      <div className="budget-recurring-panel__heading">
        <div>
          <h2><ArrowLeftRight size={19} aria-hidden="true" /> יש יתרות מ{sourceMonth} שממתינות לטיפול</h2>
          <p>
            זהו מידע בלבד. סקירת היתרות והפעולה הכספית מתבצעות מחודש המקור במסגרת סגירת החודש.
          </p>
        </div>
        <div className="budget-recurring-panel__totals" aria-label="סיכום יתרות שממתינות לטיפול">
          <span>מוכן להעברה <strong><BudgetMoneyAmount value={carryover.total_incoming} /></strong></span>
          <span>קטגוריות מוכנות <strong>{readyCount}</strong></span>
          {blockedCount > 0 && <span>קטגוריות חסומות <strong>{blockedCount}</strong></span>}
        </div>
      </div>
      <div className="budget-recurring-panel__actions">
        <SecondaryButton type="button" onClick={() => onReviewSource(carryover.source_month)}>
          סקירה וסגירת {sourceMonth}
        </SecondaryButton>
      </div>
    </GlassCard>
  );
};

export const CarryoverPanel = ({ carryover, applying, error, onApply }) => (
  <GlassCard className="budget-carryover-panel" padding="18px">
    <div className="budget-recurring-panel__heading">
      <div>
        <h2><ArrowLeftRight size={19} aria-hidden="true" /> יתרות מהחודש הקודם</h2>
        <p>
          יתרה כשירה עוברת רק לאחר אישור מפורש. ההעברה מקטינה את המימון בחודש המקור
          ומגדילה אותו באותו סכום בחודש הנוכחי, בלי ליצור כסף חדש.
        </p>
      </div>
      <div className="budget-recurring-panel__totals" aria-label="סיכום יתרות להעברה">
        <span>מוכן להעברה <strong><BudgetMoneyAmount value={carryover.total_incoming} /></strong></span>
      </div>
    </div>

    {carryover.ready_categories?.length > 0 && (
      <ul className="budget-recurring-panel__list" aria-label="יתרות מוכנות להעברה">
        {carryover.ready_categories.map((item) => (
          <li key={item.category_id}>
            <span>{item.category?.icon} {item.category?.name}</span>
            <BudgetMoneyAmount value={item.amount} />
          </li>
        ))}
      </ul>
    )}

    {carryover.blocked_categories?.length > 0 && (
      <details className="budget-carryover-panel__blocked">
        <summary>{carryover.blocked_categories.length} קטגוריות אינן מוכנות להעברה</summary>
        <ul>
          {carryover.blocked_categories.map((item) => (
            <li key={item.category_id}>
              <span>{item.category?.icon} {item.category?.name}</span>
              <span>{carryoverReason[item.reason] || item.reason}</span>
            </li>
          ))}
        </ul>
      </details>
    )}

    {carryover.already_applied_categories?.length > 0 && (
      <p className="budget-carryover-panel__applied">
        היתרות כבר הועברו עבור {carryover.already_applied_categories.length} קטגוריות בחודש זה.
      </p>
    )}

    {carryover.ready_categories?.length > 0 && (
      <div className="budget-recurring-panel__actions">
        <PrimaryButton
          type="button"
          loading={applying}
          loadingText="מעביר..."
          onClick={onApply}
        >
          העבר יתרות מהחודש הקודם
        </PrimaryButton>
      </div>
    )}
    {error && <Alert variant="error" urgent>{error}</Alert>}
  </GlassCard>
);

export const UnbudgetedExpensesPanel = ({
  categories, total, canAllocate, onAllocate, onReviewTransactions,
}) => (
  <GlassCard className="budget-unbudgeted-panel" padding="18px">
    <div className="budget-unbudgeted-panel__heading">
      <div>
        <h2><AlertTriangle size={19} aria-hidden="true" /> הוצאות מחוץ לתקציב</h2>
        <p>ההוצאות הבאות אינן משויכות לתקציב קטגוריה פעיל. יש להקצות להן תקציב או לבדוק את התנועות.</p>
      </div>
      <div className="budget-unbudgeted-panel__total" aria-label="סך הוצאות מחוץ לתקציב">
        <span>סך הכול</span>
        <strong><BudgetMoneyAmount value={total} /></strong>
      </div>
    </div>
    <ul className="budget-unbudgeted-panel__list" aria-label="פירוט הוצאות מחוץ לתקציב">
      {categories.map((item) => (
        <li key={item.category_id ?? 'uncategorized'}>
          <span>{item.categories?.icon} {item.categories?.name || 'ללא קטגוריה'}</span>
          <BudgetMoneyAmount value={item.actual_spent} />
          <div className="budget-unbudgeted-panel__actions">
            {item.category_id && (
              <PrimaryButton
                type="button"
                size="sm"
                disabled={!canAllocate || item.categories?.is_active === false || item.categories?.type !== 'expense'}
                onClick={() => onAllocate(item)}
              >
                הקצה תקציב לחודש זה
              </PrimaryButton>
            )}
            <SecondaryButton type="button" size="sm" onClick={() => onReviewTransactions(item)}>
              בדוק / תקן תנועות
            </SecondaryButton>
          </div>
        </li>
      ))}
    </ul>
  </GlassCard>
);

const dispositionPolicyLabel = {
  carry_forward: 'העבר לקטגוריה בחודש הבא',
  savings: 'העבר לחיסכון',
  return_to_unallocated: 'החזר לכסף פנוי בחודש הבא',
};

export const MonthClosePanel = ({ preview, history = [], loading, applying, error, onApply }) => {
  const deficitCount = preview.deficit_blockers?.length || 0;
  const unbudgetedCount = preview.unbudgeted_expense_blockers?.length || 0;
  const blocked = (preview.categories || []).filter((item) => item.status === 'blocked');
  const ready = (preview.categories || []).filter((item) => item.status === 'ready');
  const applied = history.filter((item) => item.event_kind === 'apply');

  return (
    <GlassCard className="budget-carryover-panel budget-month-close-panel" padding="18px">
      <div className="budget-recurring-panel__heading">
        <div>
          <h2><CalendarCheck size={19} aria-hidden="true" /> סקירה וסגירת חודש</h2>
          <p>
            הסגירה מתבצעת רק לאחר אישור מפורש. יתרות מועברות לחודש הנוכחי או לחיסכון,
            בלי לשנות הוצאות, תקציבי פתיחה או היסטוריה קיימת.
          </p>
        </div>
        <div className="budget-recurring-panel__totals" aria-label="סיכום סגירת חודש">
          <span>העברה לקטגוריות <strong><BudgetMoneyAmount value={preview.carry_forward_total} /></strong></span>
          <span>החזרה לכסף פנוי <strong><BudgetMoneyAmount value={preview.return_to_unallocated_total} /></strong></span>
          <span>לחיסכון <strong><BudgetMoneyAmount value={preview.savings_total} /></strong></span>
        </div>
      </div>

      {(deficitCount > 0 || unbudgetedCount > 0) && (
        <Alert variant="warning" urgent>
          לא ניתן לסגור את החודש: {deficitCount > 0 && `${deficitCount} קטגוריות בגירעון`}
          {deficitCount > 0 && unbudgetedCount > 0 ? ' ו-' : ''}
          {unbudgetedCount > 0 && `${unbudgetedCount} הוצאות ללא תקציב`}.
        </Alert>
      )}

      {applied.length > 0 && (
        <p className="budget-carryover-panel__applied">
          סגירת החודש בוצעה ונשמרה בהיסטוריה עבור {applied.length} קטגוריות.
        </p>
      )}

      {ready.length > 0 && (
        <ul className="budget-recurring-panel__list" aria-label="יתרות לסגירת החודש">
          {ready.map((item) => (
            <li key={item.category_id}>
              <span>{item.category?.icon} {item.category?.name} · {dispositionPolicyLabel[item.policy]}</span>
              <BudgetMoneyAmount value={item.eligible_unused} />
            </li>
          ))}
        </ul>
      )}

      {blocked.length > 0 && (
        <details className="budget-carryover-panel__blocked">
          <summary>{blocked.length} יתרות דורשות הגדרה או הכנת חודש היעד</summary>
          <ul>
            {blocked.map((item) => (
              <li key={item.category_id}>
                <span>{item.category?.icon} {item.category?.name}</span>
                <span>{item.blocked_reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="budget-carryover-panel__applied">
        כסף פנוי בחודש {preview.destination_month}: <BudgetMoneyAmount value={preview.destination_unallocated_before} />
        {' → '}<BudgetMoneyAmount value={preview.destination_unallocated_after} /> ·
        חיסכון: <BudgetMoneyAmount value={preview.savings_balance_after} />
      </p>

      {preview.can_apply && (
        <div className="budget-recurring-panel__actions">
          <PrimaryButton type="button" loading={applying || loading} loadingText="סוגר..." onClick={onApply}>
            אישור וסגירת החודש
          </PrimaryButton>
        </div>
      )}
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
