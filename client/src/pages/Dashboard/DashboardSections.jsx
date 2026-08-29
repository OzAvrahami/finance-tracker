import {
  ArrowLeft,
  CalendarRange,
  Inbox,
  Landmark,
  ListChecks,
  PieChart,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { createElement } from 'react';
import { Link } from 'react-router-dom';
import {
  EmptyState,
  ErrorState,
  GlassCard,
  MoneyAmount,
  ProgressBar,
  Skeleton,
  TechnicalValue,
} from '../../components/ui';
import { absoluteMoney, compareMoney, formatDecimalMoney } from '../../utils/money';
import { isOverdue, PRIORITY_LABELS } from '../../utils/taskHelpers';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const HEBREW_MONTHS_FULL = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

const TASK_STATUS_LABELS = {
  open: 'פתוח',
  in_progress: 'בתהליך',
  waiting: 'בהמתנה',
  done: 'הושלם',
  cancelled: 'בוטל',
};

const formatMonthValue = (date) => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
);

const formatMonthLabel = (date) => (
  `${HEBREW_MONTHS_FULL[date.getMonth()]} ${date.getFullYear()}`
);

const formatDate = (dateValue) => {
  if (!dateValue) return '';
  const [year, month, day] = String(dateValue).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return String(dateValue);
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(year, month - 1, day));
};

const currentMonthLabel = (monthKey) => {
  const [year, month] = monthKey.split('-').map(Number);
  return formatMonthLabel(new Date(year, month - 1, 1));
};

const DashboardPanel = ({
  title,
  subtitle,
  period,
  action,
  icon: Icon,
  children,
  className = '',
}) => (
  <section className={`dashboard-panel ${className}`.trim()} aria-labelledby={`${title.replaceAll(' ', '-')}-title`}>
    <GlassCard padding="0" className="dashboard-panel__card">
      <header className="dashboard-panel__header">
        <div className="dashboard-panel__heading">
          {Icon && <span className="dashboard-panel__icon" aria-hidden="true"><Icon size={18} /></span>}
          <div>
            <h2 id={`${title.replaceAll(' ', '-')}-title`}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
        </div>
        <div className="dashboard-panel__meta">
          {period && <span className="dashboard-period">{period}</span>}
          {action && (
            <Link className="dashboard-panel__link" to={action.to}>
              {action.label}
              <ArrowLeft size={15} aria-hidden="true" />
            </Link>
          )}
        </div>
      </header>
      <div className="dashboard-panel__body">{children}</div>
    </GlassCard>
  </section>
);

const SectionSkeleton = ({ rows = 3, height = 52 }) => (
  <div className="dashboard-section-skeleton" role="status" aria-label="טוען נתונים">
    {Array.from({ length: rows }, (_, index) => (
      <Skeleton key={index} height={height} borderRadius="var(--ft-radius-lg)" />
    ))}
  </div>
);

const SectionError = ({ title, onRetry }) => (
  <ErrorState
    level="inline"
    title={title}
    description="לא ניתן היה לטעון את הנתונים באזור הזה. שאר לוח הבקרה ממשיך לפעול."
    onRetry={onRetry}
  />
);

const DashboardKpi = ({ label, value, note, tone, icon, signed = false }) => {
  const displayValue = tone === 'expense' && Number(value) > 0 ? -Number(value) : value;
  const resolvedTone = tone === 'balance'
    ? (Number(value) > 0 ? 'positive' : Number(value) < 0 ? 'negative' : 'neutral')
    : tone;

  return (
    <article className={`dashboard-kpi dashboard-kpi--${resolvedTone}`} data-testid="dashboard-kpi">
      <div className="dashboard-kpi__label">
        <span className="dashboard-kpi__icon" aria-hidden="true">{createElement(icon, { size: 18 })}</span>
        <h3>{label}</h3>
      </div>
      <MoneyAmount
        className="dashboard-kpi__value"
        value={displayValue}
        signed={signed || tone === 'balance'}
      />
      <p>{note}</p>
    </article>
  );
};

export const MonthlySummary = ({ resource, selectedMonth, monthOptions, onMonthChange }) => (
  <section className="dashboard-monthly" aria-labelledby="dashboard-monthly-title">
    <GlassCard padding="0" className="dashboard-monthly__card">
      <div className="dashboard-monthly__header">
        <div>
          <h2 id="dashboard-monthly-title">החודש הנבחר</h2>
          <p>שלושת המדדים האלה — ורק הם — מתייחסים לחודש שנבחר כאן.</p>
        </div>
        <label className="dashboard-month-select">
          <span className="dashboard-visually-hidden">חודש לדשבורד</span>
          <CalendarRange size={17} aria-hidden="true" />
          <select
            aria-label="חודש לדשבורד"
            value={formatMonthValue(selectedMonth)}
            onChange={(event) => {
              const [year, month] = event.target.value.split('-').map(Number);
              onMonthChange(new Date(year, month - 1, 1));
            }}
          >
            {monthOptions.map((date) => {
              const value = formatMonthValue(date);
              return <option key={value} value={value}>{formatMonthLabel(date)}</option>;
            })}
          </select>
        </label>
      </div>

      {resource.status === 'loading' && (
        <div className="dashboard-kpi-grid" aria-label="טוען את מדדי החודש">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} height={136} borderRadius="var(--ft-radius-lg)" />
          ))}
        </div>
      )}
      {resource.status === 'error' && (
        <SectionError title="מדדי החודש לא נטענו" onRetry={resource.reload} />
      )}
      {resource.status === 'success' && (
        <div className="dashboard-kpi-grid">
          <DashboardKpi
            label="הכנסות"
            value={resource.data.income}
            note="סך ההכנסות שנרשמו בחודש"
            tone="income"
            icon={TrendingUp}
            signed
          />
          <DashboardKpi
            label="הוצאות"
            value={resource.data.expenses}
            note="סך ההוצאות שנרשמו בחודש"
            tone="expense"
            icon={TrendingDown}
          />
          <DashboardKpi
            label="מאזן החודש"
            value={resource.data.balance}
            note="הכנסות פחות הוצאות בחודש הנבחר"
            tone="balance"
            icon={Wallet}
          />
        </div>
      )}
    </GlassCard>
  </section>
);

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const monthKey = payload[0]?.payload?.month;

  return (
    <div className="dashboard-chart-tooltip" role="status">
      <span className="dashboard-chart-tooltip__month">
        {label}{monthKey && <> · <TechnicalValue>{monthKey}</TechnicalValue></>}
      </span>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="dashboard-chart-tooltip__row">
          <span>{entry.name}</span>
          <MoneyAmount value={entry.value} />
        </div>
      ))}
    </div>
  );
};

export const DashboardChart = ({ resource }) => {
  const hasValues = resource.data.some((row) => row.income !== 0 || row.expenses !== 0);
  const chartSummaryId = 'dashboard-chart-summary';

  return (
    <DashboardPanel
      title="הכנסות והוצאות"
      subtitle="ששת החודשים האחרונים"
      period="תקופה נפרדת · לא לפי החודש הנבחר"
      icon={TrendingUp}
      className="dashboard-panel--chart"
    >
      {resource.status === 'loading' && (
        <div role="status" aria-label="טוען את תרשים ההכנסות וההוצאות">
          <Skeleton height={270} borderRadius="var(--ft-radius-lg)" />
        </div>
      )}
      {resource.status === 'error' && (
        <SectionError title="מגמת ההכנסות וההוצאות לא נטענה" onRetry={resource.reload} />
      )}
      {resource.status === 'success' && !hasValues && (
        <EmptyState
          size="compact"
          icon={TrendingUp}
          title="אין נתוני מגמה"
          description="אין נתונים להצגה בששת החודשים האחרונים."
        />
      )}
      {resource.status === 'success' && hasValues && (
        <>
          <div className="dashboard-chart-legend" aria-label="מקרא התרשים">
            <span><i className="dashboard-chart-legend__income" />הכנסות</span>
            <span><i className="dashboard-chart-legend__expenses" />הוצאות</span>
          </div>
          <p id={chartSummaryId} className="dashboard-visually-hidden">
            תרשים עמודות של הכנסות והוצאות בפועל בששת החודשים האחרונים. פירוט הערכים מופיע לאחר התרשים.
          </p>
          <div
            className="dashboard-chart"
            role="img"
            aria-label="הכנסות והוצאות בששת החודשים האחרונים"
            aria-describedby={chartSummaryId}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={resource.data} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--ft-border)" vertical={false} />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--ft-text-faint)', fontSize: 12 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--ft-text-faint)', fontSize: 12 }}
                  tickFormatter={(value) => `₪${Math.round(value / 1000)}k`}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--ft-glass-hover)' }} />
                <Bar dataKey="income" name="הכנסות" fill="var(--ft-positive)" radius={[5, 5, 0, 0]} maxBarSize={22} />
                <Bar dataKey="expenses" name="הוצאות" fill="var(--ft-primary-hover)" radius={[5, 5, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="dashboard-visually-hidden">
            {resource.data.map((row) => (
              <li key={row.month}>
                {row.name} ({row.month}): הכנסות {row.income}, הוצאות {row.expenses}
              </li>
            ))}
          </ul>
        </>
      )}
    </DashboardPanel>
  );
};

export const DashboardTasks = ({ resource, openCount, overdueCount }) => (
  <DashboardPanel
    title="מטלות"
    subtitle="עד שלוש מטלות רלוונטיות"
    period="נכון להיום"
    action={{ to: '/tasks', label: 'לכל המטלות' }}
    icon={ListChecks}
  >
    {resource.status === 'loading' && <SectionSkeleton rows={2} />}
    {resource.status === 'error' && <SectionError title="המטלות לא נטענו" onRetry={resource.reload} />}
    {resource.status === 'success' && (
      <>
        <div className="dashboard-task-counts" aria-label="סיכום מטלות נוכחי">
          <div><TechnicalValue>{openCount}</TechnicalValue><span>פתוחות</span></div>
          <div className="dashboard-task-counts__overdue"><TechnicalValue>{overdueCount}</TechnicalValue><span>באיחור</span></div>
        </div>
        {resource.data.length === 0 ? (
          <EmptyState
            size="compact"
            icon={ListChecks}
            title="אין מטלות פתוחות"
            description="אין כרגע מטלות פתוחות או באיחור."
          />
        ) : (
          <ul className="dashboard-task-list">
            {resource.data.map((task) => {
              const overdue = isOverdue(task);
              return (
                <li key={task.id} className={overdue ? 'is-overdue' : ''}>
                  <div className="dashboard-task-list__badges">
                    <span className={`dashboard-status-badge ${overdue ? 'is-overdue' : ''}`}>
                      {overdue ? 'באיחור' : (TASK_STATUS_LABELS[task.status] || task.status || 'פתוח')}
                    </span>
                    <span className={`dashboard-priority-badge dashboard-priority-badge--${task.priority || 'medium'}`}>
                      עדיפות {PRIORITY_LABELS[task.priority] || task.priority || 'בינונית'}
                    </span>
                  </div>
                  <strong>{task.title}</strong>
                  {task.due_date && (
                    <span className="dashboard-task-list__date">
                      יעד <TechnicalValue>{formatDate(task.due_date)}</TechnicalValue>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </>
    )}
  </DashboardPanel>
);

export const DashboardLoans = ({ resource }) => {
  const totalDebt = resource.data.reduce(
    (total, loan) => total + (Number(loan.current_balance) || 0),
    0,
  );

  return (
    <DashboardPanel
      title="הלוואות"
      subtitle="עד שלוש הלוואות נוכחיות"
      period="נכון להיום"
      action={{ to: '/loans', label: 'לכל ההלוואות' }}
      icon={Landmark}
    >
      {resource.status !== 'error' && (
        <div className="dashboard-loan-total">
          <span className="dashboard-loan-total__icon" aria-hidden="true"><Landmark size={19} /></span>
          <div>
            <span>סך החוב הנוכחי</span>
            {resource.status === 'loading'
              ? <Skeleton width={150} height={28} />
              : <MoneyAmount value={totalDebt} />}
          </div>
        </div>
      )}
      {resource.status === 'loading' && <SectionSkeleton height={72} />}
      {resource.status === 'error' && <SectionError title="ההלוואות לא נטענו" onRetry={resource.reload} />}
      {resource.status === 'success' && resource.data.length === 0 && (
        <EmptyState
          size="compact"
          icon={Landmark}
          title="אין הלוואות פעילות"
          description="לא נמצאו הלוואות להצגה נכון להיום."
        />
      )}
      {resource.status === 'success' && resource.data.length > 0 && (
        <ul className="dashboard-loan-list">
          {resource.data.slice(0, 3).map((loan) => {
            const original = Number(loan.original_amount) || 0;
            const current = Number(loan.current_balance) || 0;
            const repaidPercent = original > 0
              ? Math.max(0, Math.round(((original - current) / original) * 100))
              : 0;

            return (
              <li key={loan.id}>
                <div className="dashboard-loan-list__top">
                  <div>
                    <strong>{loan.name}</strong>
                    {loan.lender_name && <span>{loan.lender_name}</span>}
                  </div>
                  <MoneyAmount value={current} />
                </div>
                <div className="dashboard-loan-list__payment">
                  <span>החזר חודשי</span>
                  <MoneyAmount value={Number(loan.monthly_payment) || 0} />
                </div>
                <ProgressBar
                  value={repaidPercent}
                  label={`החזר קרן עבור ${loan.name}`}
                  aria-valuetext={`${repaidPercent}% מהקרן נפרעו`}
                />
                <span className="dashboard-progress-note"><TechnicalValue>{repaidPercent}%</TechnicalValue> מהקרן נפרעו</span>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardPanel>
  );
};

export const DashboardBudgets = ({ resource, currentMonthKey }) => (
  <DashboardPanel
    title="ניצול תקציב"
    subtitle="עד ארבע קטגוריות תקציב"
    period={`החודש הנוכחי · ${currentMonthLabel(currentMonthKey)}`}
    action={{ to: '/budget', label: 'לתקציב החודשי' }}
    icon={PieChart}
  >
    {resource.status === 'loading' && <SectionSkeleton rows={4} height={48} />}
    {resource.status === 'error' && <SectionError title="התקציב הנוכחי לא נטען" onRetry={resource.reload} />}
    {resource.status === 'success' && resource.data.length === 0 && (
      <EmptyState
        size="compact"
        icon={PieChart}
        title="לא הוגדר תקציב לחודש זה"
        description="אפשר להגדיר תקציב לפי קטגוריות בעמוד התקציב החודשי."
      />
    )}
    {resource.status === 'success' && resource.data.length > 0 && (
      <ul className="dashboard-budget-list">
        {resource.data.slice(0, 4).map((budget) => {
          const isOver = compareMoney(budget.remaining) < 0;
          const isNear = !isOver && budget.utilization >= 85;
          const tone = isOver ? 'neg' : isNear ? 'warn' : 'pos';
          const stateLabel = isOver ? 'חריגה' : isNear ? 'קרוב למגבלה' : 'בתוך התקציב';
          const roundedUtilization = Math.round(budget.utilization);
          const exactRemaining = formatDecimalMoney(absoluteMoney(budget.remaining), {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          });

          return (
            <li key={budget.id} className={`dashboard-budget-list--${tone}`}>
              <div className="dashboard-budget-list__heading">
                <strong>{budget.icon && <span aria-hidden="true">{budget.icon}</span>} {budget.name}</strong>
                <span className="dashboard-budget-state">
                  {stateLabel} · <TechnicalValue>{roundedUtilization}%</TechnicalValue>
                </span>
              </div>
              <ProgressBar
                value={budget.utilization}
                tone={tone}
                label={`ניצול התקציב עבור ${budget.name}`}
                aria-valuetext={`${roundedUtilization}% ניצול, ${stateLabel}`}
              />
              <div className="dashboard-budget-list__amounts">
                <span>תוכנן <MoneyAmount value={budget.planned} /></span>
                <span>בוצע <MoneyAmount value={budget.spent} /></span>
                <span className="dashboard-budget-list__remaining">
                  {isOver ? 'חריגה' : 'נותרו'} <MoneyAmount value={absoluteMoney(budget.remaining)} />
                </span>
                <span className="dashboard-visually-hidden">
                  {isOver ? 'חריגה של' : 'נותרו'} ₪{exactRemaining}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    )}
  </DashboardPanel>
);

export const DashboardTransactions = ({ resource }) => (
  <DashboardPanel
    title="התנועות האחרונות"
    subtitle="חמש הרשומות האחרונות בכלל ההיסטוריה"
    period="ללא תלות בחודש הנבחר"
    action={{ to: '/transactions', label: 'לכל התנועות' }}
    icon={Inbox}
    className="dashboard-panel--transactions"
  >
    {resource.status === 'loading' && <SectionSkeleton rows={5} height={54} />}
    {resource.status === 'error' && <SectionError title="התנועות האחרונות לא נטענו" onRetry={resource.reload} />}
    {resource.status === 'success' && resource.data.length === 0 && (
      <EmptyState
        size="compact"
        icon={Inbox}
        title="עוד לא נרשמו תנועות"
        description="התנועות האחרונות יופיעו כאן לאחר ההזנה הראשונה."
      />
    )}
    {resource.status === 'success' && resource.data.length > 0 && (
      <ul className="dashboard-transaction-list">
        {resource.data.slice(0, 5).map((transaction) => {
          const isIncome = transaction.movement_type === 'income';
          const categoryName = transaction.categories?.name || 'ללא קטגוריה';
          const paymentSource = transaction.payment_sources?.name;
          const amount = Number(transaction.total_amount) || 0;

          return (
            <li key={transaction.id}>
              <div className="dashboard-transaction-list__category">
                {transaction.categories?.icon && <span aria-hidden="true">{transaction.categories.icon}</span>}
                {categoryName}
              </div>
              <div className="dashboard-transaction-list__description">
                <strong>{transaction.description}</strong>
                <span>
                  <TechnicalValue>{formatDate(transaction.transaction_date)}</TechnicalValue>
                  {paymentSource && <> · {paymentSource}</>}
                </span>
              </div>
              <MoneyAmount
                className={`dashboard-transaction-list__amount ${isIncome ? 'is-income' : 'is-expense'}`}
                value={isIncome ? Math.abs(amount) : -Math.abs(amount)}
                signed={isIncome}
              />
            </li>
          );
        })}
      </ul>
    )}
  </DashboardPanel>
);

export const DashboardSkeleton = () => (
  <div className="dashboard-page dashboard-page--loading" role="status" aria-live="polite">
    <span className="dashboard-visually-hidden">טוען את לוח הבקרה</span>
    <Skeleton height={250} borderRadius="var(--ft-radius-xl)" />
    <div className="dashboard-grid dashboard-grid--trend-tasks">
      <Skeleton height={380} borderRadius="var(--ft-radius-xl)" />
      <Skeleton height={380} borderRadius="var(--ft-radius-xl)" />
    </div>
    <div className="dashboard-grid dashboard-grid--budget-loans">
      <Skeleton height={360} borderRadius="var(--ft-radius-xl)" />
      <Skeleton height={360} borderRadius="var(--ft-radius-xl)" />
    </div>
    <Skeleton height={320} borderRadius="var(--ft-radius-xl)" />
  </div>
);

export const DashboardPageError = ({ onRetry }) => (
  <div className="dashboard-page">
    <ErrorState
      level="page"
      title="טעינת לוח הבקרה נכשלה"
      description="לא התקבלו נתונים להצגת לוח הבקרה. שאר האזורים באפליקציה ממשיכים לעבוד."
      onRetry={onRetry}
      urgent
    />
  </div>
);
