import { CalendarRange, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
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

const SummaryMetric = ({ label, value, note, tone = 'default', loading, unavailable }) => (
  <div className={`budget-summary-metric budget-summary-metric--${tone}`}>
    <span className="budget-summary-metric__label">{label}</span>
    {loading ? (
      <Skeleton width="65%" height="30px" radius="10px" />
    ) : unavailable ? (
      <TechnicalValue className="budget-summary-metric__value">—</TechnicalValue>
    ) : (
      <BudgetMoneyAmount className="budget-summary-metric__value" value={value} />
    )}
    <span className="budget-summary-metric__note">{unavailable ? 'הנתון אינו זמין כרגע' : note}</span>
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
}) => (
  <GlassCard className="budget-overview" padding="20px">
    <div className="budget-toolbar">
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
      <SecondaryButton type="button" className="budget-toolbar__action" onClick={onOpenCopy}>
        <CalendarRange size={16} aria-hidden="true" />
        העתקת התקציב לחודש אחר
      </SecondaryButton>
      <SecondaryButton type="button" className="budget-toolbar__action" onClick={onOpenAdd}>
        <Plus size={16} aria-hidden="true" />
        הוספת קטגוריה
      </SecondaryButton>
    </div>

    <div className="budget-summary-grid" aria-label={`סיכום תקציב ${formatBudgetMonth(selectedMonth)}`}>
      <SummaryMetric
        label="זמין לתקצוב"
        value={summary.available}
        note="כסף זמין שאושר במפורש לחודש"
        loading={loading}
        unavailable={unavailable}
      />
      <SummaryMetric
        label="מוקצה"
        value={summary.allocated}
        note="הסכום הממומן בכל תקציבי הקטגוריות"
        loading={loading}
        unavailable={unavailable}
      />
      <SummaryMetric
        label="טרם הוקצה"
        value={summary.unallocated}
        note="כסף זמין שעדיין לא הוקצה לקטגוריה"
        tone={compareMoney(summary.unallocated) > 0 ? 'positive' : 'neutral'}
        loading={loading}
        unavailable={unavailable}
      />
      <SummaryMetric
        label="הוצאה בפועל"
        value={summary.totalSpent}
        note="כל תנועות ההוצאה בחודש, כולל הוצאות ללא תקציב פעיל"
        tone="actual"
        loading={loading}
        unavailable={unavailable}
      />
    </div>
  </GlassCard>
);

export default BudgetSummary;
