import { Fragment } from 'react';
import { Check, ChevronDown, Pencil, ShieldCheck, Trash2, X } from 'lucide-react';
import {
  IconButton,
  NumberField,
  ProgressBar,
  TechnicalValue,
} from '../../components/ui';
import { addMoney, compareMoney, subtractMoney } from '../../utils/money';
import BudgetMoneyAmount from './BudgetMoneyAmount';

const isNonZero = (value) => compareMoney(value ?? '0.00') !== 0;
const asOutflow = (value) => subtractMoney('0.00', value ?? '0.00');

const BudgetProgress = ({ row }) => (
  <div className="budget-progress">
    <div className="budget-progress__meta">
      <span>{row.statusLabel}</span>
      <TechnicalValue>{row.percent}%</TechnicalValue>
    </div>
    <ProgressBar
      value={row.percent}
      max={Math.max(100, row.percent)}
      tone={{ warning: 'warn', negative: 'neg' }[row.tone] || 'primary'}
      height={7}
      aria-label={`ניצול תקציב ${row.categoryName}`}
      aria-valuetext={`${row.percent}% — ${row.statusLabel}`}
    />
  </div>
);

const formatMonthLabel = (month) => {
  const match = /^(\d{4})-(\d{2})$/.exec(month || '');
  if (!match) return month;
  return new Intl.DateTimeFormat('he-IL', {
    month: 'long', year: 'numeric', timeZone: 'Asia/Jerusalem',
  }).format(new Date(`${month}-01T12:00:00Z`));
};

const PropagationPreview = ({ preview }) => {
  if (!preview) return null;
  const changed = [
    preview.month,
    ...(preview.future_months_to_change || []).map((item) => item.month),
  ].filter(Boolean).map(formatMonthLabel);
  const skipped = (preview.future_months_skipped || []).map((item) => formatMonthLabel(item.month));
  return (
    <div className="budget-inline-editor__propagation" role="status">
      <strong>אישור החלה</strong>
      <span>{`יעודכנו: ${changed.join(', ')}.`}</span>
      {skipped.length > 0 && (
        <span>{`${skipped.join(', ')} יישארו ללא שינוי בגלל התאמה ידנית.`}</span>
      )}
    </div>
  );
};

const BudgetEditor = ({
  row, view, month, value, scope, allowCombined, pending, error, propagationPreview,
  onChange, onScopeChange, onSave, onRemoveOverride, onCancel,
}) => (
  <div className="budget-inline-editor">
    <dl className="budget-inline-editor__context">
      <div>
        <dt>{`תקציב ${month}`}</dt>
        <dd><BudgetMoneyAmount value={row.effectiveBase} /></dd>
      </div>
      <div>
        <dt>תקציב חודשי קבוע</dt>
        <dd>{row.recurringDefault === null || row.recurringDefault === undefined
          ? 'לא הוגדר'
          : <BudgetMoneyAmount value={row.recurringDefault} />}</dd>
      </div>
    </dl>
    <NumberField
      id={`budget-amount-${view}-${row.id}`}
      label={`תקציב החודש עבור ${row.categoryName}`}
      className="budget-inline-editor__field"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={pending}
      error={error}
    />
    <fieldset className="budget-inline-editor__scope">
      <legend>החלה על</legend>
      <label>
        <input
          type="radio"
          name={`budget-scope-${view}-${row.id}`}
          value="month"
          checked={scope === 'month'}
          disabled={pending}
          onChange={(event) => onScopeChange(event.target.value)}
        />
        רק החודש הזה
      </label>
      {allowCombined && (
        <label>
          <input
            type="radio"
            name={`budget-scope-${view}-${row.id}`}
            value="month_and_future"
            checked={scope === 'month_and_future'}
            disabled={pending}
            onChange={(event) => onScopeChange(event.target.value)}
          />
          החודש הזה וגם להבא
        </label>
      )}
    </fieldset>
    <PropagationPreview preview={propagationPreview} />
    <div className="budget-inline-editor__actions">
      <button
        type="button"
        className="budget-inline-editor__primary"
        disabled={pending || propagationPreview?.can_apply === false}
        onClick={() => onSave(row)}
      >
        <Check size={15} aria-hidden="true" /> {scope === 'month_and_future'
          ? (propagationPreview ? 'אישור ושמירה' : 'סקירת השינוי')
          : 'שמירה'}
      </button>
      {row.monthOverride !== null && row.monthOverride !== undefined && (
        <button type="button" disabled={pending} onClick={() => onRemoveOverride(row)}>
          הסר שינוי לחודש זה
        </button>
      )}
      <IconButton
        type="button"
        size="sm"
        aria-label={`ביטול עריכת תקציב עבור ${row.categoryName}`}
        disabled={pending}
        onClick={onCancel}
      >
        <X size={15} aria-hidden="true" />
      </IconButton>
    </div>
  </div>
);

const BudgetActions = ({ row, disabled, onEdit, onDelete, onResolveDeficit, canResolveDeficit }) => (
  <div className="budget-row-actions">
    {row.isDeficit && canResolveDeficit && (
      <button type="button" className="budget-row-actions__resolve" disabled={disabled} onClick={() => onResolveDeficit(row)}>
        <ShieldCheck size={14} aria-hidden="true" /> פתרון חריגה
      </button>
    )}
    <IconButton
      type="button"
      size="sm"
      aria-label={`עריכת תקציב עבור ${row.categoryName}`}
      disabled={disabled}
      onClick={() => onEdit(row)}
    >
      <Pencil size={15} aria-hidden="true" />
    </IconButton>
    <IconButton
      type="button"
      size="sm"
      className="budget-row-actions__delete"
      aria-label={`הסרת תקציב פעיל עבור ${row.categoryName}`}
      disabled={disabled}
      onClick={() => onDelete(row)}
    >
      <Trash2 size={15} aria-hidden="true" />
    </IconButton>
  </div>
);

const BudgetSignals = ({ row }) => {
  const hasFundedChange = [
    row.incomingReallocationResolution,
    row.outgoingReallocation,
    row.incomingUnbudgetedResolution,
    row.outgoingUnbudgetedResolution,
    row.unusedDispositionAdjustment,
    row.otherAdjustments,
  ].some(isNonZero);
  return (
    <div className="budget-category__signals" aria-label={`מאפייני תקציב ${row.categoryName}`}>
      <span className={`budget-status budget-status--${row.tone}`}>{row.statusLabel}</span>
      {row.monthOverride !== null && row.monthOverride !== undefined && (
        <span className="budget-signal">התאמה לחודש</span>
      )}
      {isNonZero(row.incomingCarryover) && <span className="budget-signal">יתרה נכנסת</span>}
      {isNonZero(row.outgoingCarryover) && <span className="budget-signal">יתרה הועברה</span>}
      {hasFundedChange && <span className="budget-signal">שינוי ממומן</span>}
    </div>
  );
};

const CategoryIdentity = ({ row }) => (
  <div className="budget-category">
    {row.categoryIcon && <span className="budget-category__icon" aria-hidden="true">{row.categoryIcon}</span>}
    <div className="budget-category__body">
      <span className="budget-category__name">{row.categoryName}</span>
      <BudgetSignals row={row} />
    </div>
  </div>
);

const RemainingAmount = ({ row, compact = false }) => (
  <div className={`budget-remaining budget-remaining--${row.isDeficit ? 'negative' : 'positive'}`}>
    {!compact && <span className="budget-remaining__label">{row.isDeficit ? 'חריגה' : 'נותר'}</span>}
    <BudgetMoneyAmount value={row.remainingAbsolute} />
  </div>
);

const BudgetDetailsToggle = ({ row, view, expanded, onToggle }) => (
  <button
    type="button"
    className="budget-details-toggle"
    aria-label={`${expanded ? 'הסתרת' : 'הצגת'} פירוט התקציב עבור ${row.categoryName}`}
    aria-expanded={expanded}
    aria-controls={`budget-composition-${view}-${row.id}`}
    onClick={() => onToggle(row)}
  >
    פירוט התקציב
    <ChevronDown size={14} aria-hidden="true" />
  </button>
);

const MovementLine = ({ label, value }) => (
  <div className="budget-composition__movement">
    <dt>{label}</dt>
    <dd><BudgetMoneyAmount value={value} signed colorize /></dd>
  </div>
);

const BudgetComposition = ({ row, view }) => {
  const movements = [
    { label: 'יתרה שנכנסה מחודש קודם', value: row.incomingCarryover },
    { label: 'יתרה שהועברה לחודש הבא', value: asOutflow(row.outgoingCarryover) },
    { label: 'התקבל מהעברה או ממימון חריגה', value: row.incomingReallocationResolution },
    { label: 'הועבר לקטגוריה אחרת', value: asOutflow(row.outgoingReallocation) },
    { label: 'התקבל מהקצאת הוצאה שהייתה ללא תקציב', value: row.incomingUnbudgetedResolution },
    { label: 'הועבר להקצאת הוצאה שהייתה ללא תקציב', value: asOutflow(row.outgoingUnbudgetedResolution) },
    { label: 'שינוי בעקבות סגירת חודש', value: row.unusedDispositionAdjustment },
    { label: 'שינויים ממומנים אחרים', value: row.otherAdjustments },
  ].filter((item) => isNonZero(item.value));
  const calculatedTotal = movements.reduce(
    (total, movement) => addMoney(total, movement.value),
    row.effectiveBase,
  );
  const reconciled = compareMoney(calculatedTotal, row.planned) === 0;
  const openingChanged = compareMoney(row.starting, row.effectiveBase) !== 0;
  const hasOverride = row.monthOverride !== null && row.monthOverride !== undefined;

  return (
    <section
      id={`budget-composition-${view}-${row.id}`}
      className="budget-composition"
      aria-label={`פירוט התקציב עבור ${row.categoryName}`}
      data-reconciled={reconciled ? 'true' : 'false'}
    >
      <div className="budget-composition__heading">
        <div>
          <h3>פירוט התקציב</h3>
          <p>כך נבנה תקציב החודש מהבסיס ומהשינויים הממומנים שכבר הוחלו.</p>
        </div>
        <span className="budget-composition__final">
          <span>תקציב החודש</span>
          <BudgetMoneyAmount value={row.planned} />
        </span>
      </div>

      <dl className="budget-composition__equation">
        <div className="budget-composition__base">
          <dt>בסיס התקציב לחודש שנבחר</dt>
          <dd><BudgetMoneyAmount value={row.effectiveBase} /></dd>
          {hasOverride && (
            <small>
              התאמה לחודש זה: <BudgetMoneyAmount value={row.monthOverride} />.
              הסכום הזה מחליף את בסיס החודש ואינו תוספת עליו.
            </small>
          )}
        </div>
        {movements.map((movement) => (
          <MovementLine key={movement.label} {...movement} />
        ))}
        <div className="budget-composition__total">
          <dt>תקציב החודש לאחר כל השינויים</dt>
          <dd><BudgetMoneyAmount value={row.planned} /></dd>
        </div>
      </dl>

      {(openingChanged || row.recurringDefault !== null && row.recurringDefault !== undefined) && (
        <div className="budget-composition__context">
          {openingChanged && (
            <span>
              הסכום שנקבע בתחילת החודש היה <BudgetMoneyAmount value={row.starting} />;
              הוא מוצג כהקשר היסטורי בלבד ואינו הקצאה נוספת.
            </span>
          )}
          {row.recurringDefault !== null && row.recurringDefault !== undefined && (
            <span>
              התקציב החודשי הקבוע כיום הוא <BudgetMoneyAmount value={row.recurringDefault} />.
              זו הגדרה לתכנון חוזר, ולא הוכחה למקור המימון בחודש שנבחר.
            </span>
          )}
        </div>
      )}
      {!reconciled && (
        <p className="budget-composition__warning" role="status">
          פירוט הרכיבים אינו תואם כרגע לתקציב החודש. הסכום הסופי נשאר הסכום הקובע.
        </p>
      )}
    </section>
  );
};

const MonthBudget = ({ row, view, expanded, onToggleDetails, showToggle = true }) => (
  <div className="budget-month-funded">
    <BudgetMoneyAmount className="budget-month-funded__value" value={row.planned} />
    {showToggle && (
      <BudgetDetailsToggle row={row} view={view} expanded={expanded} onToggle={onToggleDetails} />
    )}
  </div>
);

const BudgetList = ({
  rows,
  editingId,
  editAmount,
  editScope,
  editPending,
  editError,
  editPropagationPreview,
  expandedBudgetId,
  onToggleDetails,
  onStartEdit,
  onEditAmountChange,
  onEditScopeChange,
  onSaveEdit,
  allowCombinedEdit,
  selectedMonth,
  onRemoveOverride,
  onCancelEdit,
  onRequestDelete,
  onResolveDeficit,
  canResolveDeficit,
}) => (
  <section className="budget-list-region" aria-labelledby="budget-list-title">
    <div className="budget-list-heading">
      <div>
        <h2 id="budget-list-title">תקציבים לפי קטגוריה</h2>
        <p>תקציב החודש כולל יתרות ושינויים ממומנים שכבר הוחלו. הפירוט המלא זמין בכל שורה.</p>
      </div>
    </div>

    <div className="budget-table-wrap">
      <table className="budget-table">
        <caption className="u-sr-only">תקציבים לפי קטגוריית הוצאה</caption>
        <colgroup>
          <col className="budget-col-category" />
          <col className="budget-col-planned" />
          <col className="budget-col-actual" />
          <col className="budget-col-remaining" />
          <col className="budget-col-progress" />
          <col className="budget-col-actions" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">קטגוריה</th>
            <th scope="col">תקציב החודש</th>
            <th scope="col">הוצאה בפועל</th>
            <th scope="col">נותר / חריגה</th>
            <th scope="col">ניצול</th>
            <th scope="col"><span className="u-sr-only">פעולות</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isEditing = editingId === row.id;
            const expanded = expandedBudgetId === row.id;
            return (
              <Fragment key={row.id}>
                <tr className={`budget-table__row budget-table__row--${row.tone}`}>
                  <td><CategoryIdentity row={row} /></td>
                  <td>
                    <MonthBudget
                      row={row}
                      view="desktop"
                      expanded={expanded}
                      onToggleDetails={onToggleDetails}
                      showToggle={!isEditing}
                    />
                  </td>
                  <td><span className="budget-actual-amount"><BudgetMoneyAmount value={row.actual} /></span></td>
                  <td><RemainingAmount row={row} /></td>
                  <td><BudgetProgress row={row} /></td>
                  <td>
                    {!isEditing && (
                      <BudgetActions
                        row={row}
                        disabled={editPending}
                        onEdit={onStartEdit}
                        onDelete={onRequestDelete}
                        onResolveDeficit={onResolveDeficit}
                        canResolveDeficit={canResolveDeficit}
                      />
                    )}
                  </td>
                </tr>
                {isEditing && (
                  <tr className="budget-table__editor-row">
                    <td colSpan="6">
                      <BudgetEditor
                        row={row}
                        view="desktop"
                        month={selectedMonth}
                        value={editAmount}
                        scope={editScope}
                        allowCombined={allowCombinedEdit}
                        pending={editPending}
                        error={editError}
                        propagationPreview={editPropagationPreview}
                        onChange={onEditAmountChange}
                        onScopeChange={onEditScopeChange}
                        onSave={onSaveEdit}
                        onRemoveOverride={onRemoveOverride}
                        onCancel={onCancelEdit}
                      />
                    </td>
                  </tr>
                )}
                {expanded && !isEditing && (
                  <tr className="budget-table__details-row">
                    <td colSpan="6"><BudgetComposition row={row} view="desktop" /></td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>

    <div className="budget-mobile-list" role="list" aria-label="תקציבים לפי קטגוריית הוצאה">
      {rows.map((row) => {
        const isEditing = editingId === row.id;
        const expanded = expandedBudgetId === row.id;
        return (
          <article key={row.id} className={`budget-mobile-card budget-mobile-card--${row.tone}`} role="listitem">
            <header className="budget-mobile-card__header">
              <CategoryIdentity row={row} />
            </header>
            {isEditing ? (
              <BudgetEditor
                row={row}
                view="mobile"
                month={selectedMonth}
                value={editAmount}
                scope={editScope}
                allowCombined={allowCombinedEdit}
                pending={editPending}
                error={editError}
                propagationPreview={editPropagationPreview}
                onChange={onEditAmountChange}
                onScopeChange={onEditScopeChange}
                onSave={onSaveEdit}
                onRemoveOverride={onRemoveOverride}
                onCancel={onCancelEdit}
              />
            ) : (
              <>
                <dl className="budget-mobile-card__amounts">
                  <div>
                    <dt>תקציב החודש</dt>
                    <dd><BudgetMoneyAmount value={row.planned} /></dd>
                  </div>
                  <div>
                    <dt>הוצאה בפועל</dt>
                    <dd className="budget-actual-amount"><BudgetMoneyAmount value={row.actual} /></dd>
                  </div>
                  <div>
                    <dt>{row.isDeficit ? 'חריגה' : 'נותר'}</dt>
                    <dd><RemainingAmount row={row} compact /></dd>
                  </div>
                </dl>
                <BudgetProgress row={row} />
                <div className="budget-mobile-card__footer">
                  <BudgetDetailsToggle row={row} view="mobile" expanded={expanded} onToggle={onToggleDetails} />
                  <BudgetActions
                    row={row}
                    disabled={editPending}
                    onEdit={onStartEdit}
                    onDelete={onRequestDelete}
                    onResolveDeficit={onResolveDeficit}
                    canResolveDeficit={canResolveDeficit}
                  />
                </div>
                {expanded && <BudgetComposition row={row} view="mobile" />}
              </>
            )}
          </article>
        );
      })}
    </div>
  </section>
);

export default BudgetList;
