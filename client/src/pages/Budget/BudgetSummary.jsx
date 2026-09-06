import { ArrowLeftRight, CalendarRange, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import {
  GlassCard,
  IconButton,
  SecondaryButton,
  Skeleton,
  TechnicalValue,
} from '../../components/ui';
import { formatBudgetMonth, shiftBudgetMonth } from './budgetMonth';
import { compareMoney } from '../../utils/money';
import BudgetMoneyAmount from './BudgetMoneyAmount';

const UnavailableValue = () => (
  <TechnicalValue className="budget-summary-metric__value">—</TechnicalValue>
);

const SummaryMetric = ({ label, value, note, tone = 'default', loading, unavailable }) => (
  <div className={`budget-summary-metric budget-summary-metric--${tone}`}>
    <span className="budget-summary-metric__label">{label}</span>
    {loading ? (
      <Skeleton width="65%" height="30px" radius="10px" />
    ) : unavailable ? (
      <UnavailableValue />
    ) : (
      <BudgetMoneyAmount className="budget-summary-metric__value" value={value} />
    )}
    <span className="budget-summary-metric__note">
      {unavailable ? 'הנתון אינו זמין כרגע' : note}
    </span>
  </div>
);

const SecondaryMetric = ({ label, value, note, tone = 'default', loading, unavailable }) => (
  <div className={`budget-summary-secondary__item budget-summary-secondary__item--${tone}`}>
    <div>
      <span className="budget-summary-secondary__label">{label}</span>
      <span className="budget-summary-secondary__note">{unavailable ? 'הנתון אינו זמין כרגע' : note}</span>
    </div>
    {loading ? (
      <Skeleton width="76px" height="22px" radius="8px" />
    ) : unavailable ? (
      <TechnicalValue className="budget-summary-secondary__value">—</TechnicalValue>
    ) : (
      <BudgetMoneyAmount className="budget-summary-secondary__value" value={value} />
    )}
  </div>
);

const BudgetSummary = ({
  selectedMonth,
  onMonthChange,
  summary,
  loading,
  unavailable,
  onOpenCopy,
  onOpenAdd,
  onOpenFunding,
  onOpenReallocation,
  canReallocate,
  attention,
}) => (
  <>
    <GlassCard className="budget-toolbar-card" padding="16px">
      <div className="budget-toolbar" aria-label="כלי תקציב חודשי">
        <div className="budget-month-control" aria-label="בחירת חודש תקציב">
          <IconButton
            type="button"
            className="budget-month-control__arrow"
            aria-label="חודש קודם"
            onClick={() => onMonthChange(shiftBudgetMonth(selectedMonth, -1))}
          >
            <ChevronRight size={17} aria-hidden="true" />
          </IconButton>
          <label className="budget-month-control__picker">
            <span>{formatBudgetMonth(selectedMonth)}</span>
            <input
              type="month"
              value={selectedMonth}
              aria-label="חודש התקציב"
              onChange={(event) => onMonthChange(event.target.value)}
            />
          </label>
          <IconButton
            type="button"
            className="budget-month-control__arrow"
            aria-label="חודש הבא"
            onClick={() => onMonthChange(shiftBudgetMonth(selectedMonth, 1))}
          >
            <ChevronLeft size={17} aria-hidden="true" />
          </IconButton>
        </div>

        <span className="budget-toolbar__spacer" />

        <SecondaryButton type="button" className="budget-toolbar__action" onClick={() => onOpenFunding()}>
          <Plus size={16} aria-hidden="true" />
          הוספת כסף זמין
        </SecondaryButton>
        {canReallocate && (
          <SecondaryButton type="button" className="budget-toolbar__action" onClick={onOpenReallocation}>
            <ArrowLeftRight size={16} aria-hidden="true" />
            העברת תקציב
          </SecondaryButton>
        )}
        <SecondaryButton type="button" className="budget-toolbar__action" onClick={onOpenCopy}>
          <CalendarRange size={16} aria-hidden="true" />
          העתקת התקציב לחודש אחר
        </SecondaryButton>
        <SecondaryButton type="button" className="budget-toolbar__action" onClick={onOpenAdd}>
          <Plus size={16} aria-hidden="true" />
          הוספת קטגוריה
        </SecondaryButton>
      </div>
    </GlassCard>

    <GlassCard className="budget-overview" padding="20px">
      <div className="budget-summary-grid" aria-label={`סיכום תקציב ${formatBudgetMonth(selectedMonth)}`}>
        <SummaryMetric
          label="זמין לתקצוב"
          value={summary.available}
          note="כל המימון שאושר לחודש — גם המוקצה וגם הכסף שטרם הוקצה"
          loading={loading}
          unavailable={unavailable}
        />
        <SummaryMetric
          label="הוקצה לקטגוריות"
          value={summary.allocated}
          note="כל המימון שנמצא בתקציבי קטגוריות, כולל מימון שנשמר בתקציב לא פעיל"
          loading={loading}
          unavailable={unavailable}
        />
        <SummaryMetric
          label="טרם הוקצה"
          value={summary.unallocated}
          note="החלק מהמימון החודשי שעדיין אפשר להקצות לקטגוריות"
          tone={compareMoney(summary.unallocated) > 0 ? 'positive' : 'neutral'}
          loading={loading}
          unavailable={unavailable}
        />
        <SummaryMetric
          label="הוצאה בפועל"
          value={summary.totalSpent}
          note="כל הוצאות החודש, כולל הוצאות שעדיין נמצאות מחוץ לתקציב"
          tone="actual"
          loading={loading}
          unavailable={unavailable}
        />
      </div>

      <div className="budget-summary-secondary" aria-label="מידע משלים לתקציב">
        <SecondaryMetric
          label="יתרות בתקציבים פעילים"
          value={summary.remainingBalances}
          note="סכום היתרות החיוביות; חריגות מוצגות בנפרד ואינן מתקזזות כאן"
          tone="positive"
          loading={loading}
          unavailable={unavailable}
        />
        <SecondaryMetric
          label="חריגות לא פתורות"
          value={summary.unresolvedDeficits}
          note="סכום החריגות בקטגוריות פעילות; כסף פנוי אינו מסתיר אותן"
          tone={compareMoney(summary.unresolvedDeficits) > 0 ? 'negative' : 'neutral'}
          loading={loading}
          unavailable={unavailable}
        />
        <SecondaryMetric
          label="חיסכון נוכחי"
          value={summary.savings}
          note="יתרת החיסכון הנוכחית בכלל היישום; חיסכון אינו הוצאה"
          loading={loading}
          unavailable={unavailable}
        />
        {compareMoney(summary.inactiveRetainedFunding) !== 0 && (
          <SecondaryMetric
            label="מימון בתקציבים לא פעילים"
            value={summary.inactiveRetainedFunding}
            note="נכלל בסכום שהוקצה לצורך התאמה מלאה למימון החודש"
            loading={loading}
            unavailable={unavailable}
          />
        )}
      </div>
    </GlassCard>

    {attention}
  </>
);

export default BudgetSummary;
