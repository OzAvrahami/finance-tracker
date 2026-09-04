import { Check, Pencil, ShieldCheck, Trash2, X } from 'lucide-react';
import {
  IconButton,
  NumberField,
  ProgressBar,
  TechnicalValue,
} from '../../components/ui';
import BudgetMoneyAmount from './BudgetMoneyAmount';

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

const BudgetEditor = ({
  row, view, value, pending, error, onChange, onSave, onSaveRecurring, onRemoveOverride, onCancel,
}) => (
  <div className="budget-inline-editor">
    <NumberField
      id={`budget-amount-${view}-${row.id}`}
      label={`בסיס התקציב עבור ${row.categoryName}`}
      className="budget-inline-editor__field"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={pending}
      error={error}
    />
    <div className="budget-inline-editor__actions">
      <button
        type="button"
        className="budget-inline-editor__primary"
        disabled={pending}
        onClick={() => onSave(row)}
      >
        <Check size={15} aria-hidden="true" /> שינוי לחודש זה בלבד
      </button>
      <button type="button" disabled={pending} onClick={() => onSaveRecurring(row)}>
        עדכון התקציב החודשי הקבוע
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

const CategoryIdentity = ({ row }) => (
  <div className="budget-category">
    {row.categoryIcon && <span className="budget-category__icon" aria-hidden="true">{row.categoryIcon}</span>}
    <span className="budget-category__name">{row.categoryName}</span>
    <span className={`budget-status budget-status--${row.tone}`}>{row.statusLabel}</span>
  </div>
);

const RemainingAmount = ({ row }) => (
  <div className={`budget-remaining budget-remaining--${row.isDeficit ? 'negative' : 'positive'}`}>
    <span className="budget-remaining__label">{row.isDeficit ? 'חריגה' : 'נותר'}</span>
    <BudgetMoneyAmount value={row.remainingAbsolute} />
  </div>
);

const FundedComposition = ({ row }) => {
  return (
    <div className="budget-funded-composition">
      <strong><BudgetMoneyAmount value={row.planned} /></strong>
      <span>בסיס מקורי <BudgetMoneyAmount value={row.fallbackBase} /></span>
      {row.monthOverride !== null && row.monthOverride !== undefined && (
        <span>שינוי לחודש זה <BudgetMoneyAmount value={row.monthOverride} /></span>
      )}
      <span>בסיס אפקטיבי <BudgetMoneyAmount value={row.effectiveBase} /></span>
      {row.incomingCarryover !== '0.00' && (
        <span>יתרה מחודש קודם +<BudgetMoneyAmount value={row.incomingCarryover} /></span>
      )}
      {row.otherAdjustments !== '0.00' && (
        <span>התאמות אחרות <BudgetMoneyAmount value={row.otherAdjustments} /></span>
      )}
      {row.incomingReallocationResolution !== '0.00' && (
        <span>הקצאה מחדש / פתרון חריגה +<BudgetMoneyAmount value={row.incomingReallocationResolution} /></span>
      )}
      {row.outgoingReallocation !== '0.00' && (
        <span>הועבר ליעד אחר −<BudgetMoneyAmount value={row.outgoingReallocation} /></span>
      )}
      {row.incomingUnbudgetedResolution !== '0.00' && (
        <span>הקצאה מאוחרת להוצאה ללא תקציב +<BudgetMoneyAmount value={row.incomingUnbudgetedResolution} /></span>
      )}
      {row.outgoingUnbudgetedResolution !== '0.00' && (
        <span>מימון הקצאה מאוחרת −<BudgetMoneyAmount value={row.outgoingUnbudgetedResolution} /></span>
      )}
    </div>
  );
};

const BudgetList = ({
  rows,
  editingId,
  editAmount,
  editPending,
  editError,
  onStartEdit,
  onEditAmountChange,
  onSaveEdit,
  onSaveRecurring,
  onRemoveOverride,
  onCancelEdit,
  onRequestDelete,
  onResolveDeficit,
  canResolveDeficit,
}) => (
  <section className="budget-list-region" aria-labelledby="budget-list-title">
    <h2 id="budget-list-title" className="u-sr-only">פירוט התקציב</h2>

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
            <th scope="col">ממומן סופי</th>
            <th scope="col">בפועל</th>
            <th scope="col">נותר / חריגה</th>
            <th scope="col">ניצול</th>
            <th scope="col"><span className="u-sr-only">פעולות</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isEditing = editingId === row.id;
            return (
              <tr key={row.id} className={`budget-table__row budget-table__row--${row.tone}`}>
                <td><CategoryIdentity row={row} /></td>
                <td>
                  {isEditing ? (
                    <BudgetEditor
                      row={row}
                      view="desktop"
                      value={editAmount}
                      pending={editPending}
                      error={editError}
                      onChange={onEditAmountChange}
                      onSave={onSaveEdit}
                      onSaveRecurring={onSaveRecurring}
                      onRemoveOverride={onRemoveOverride}
                      onCancel={onCancelEdit}
                    />
                  ) : (
                    <FundedComposition row={row} />
                  )}
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
            );
          })}
        </tbody>
      </table>
    </div>

    <div className="budget-mobile-list" role="list" aria-label="תקציבים לפי קטגוריית הוצאה">
      {rows.map((row) => {
        const isEditing = editingId === row.id;
        return (
          <article key={row.id} className={`budget-mobile-card budget-mobile-card--${row.tone}`} role="listitem">
            <header className="budget-mobile-card__header">
              <CategoryIdentity row={row} />
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
            </header>
            {isEditing ? (
              <BudgetEditor
                row={row}
                view="mobile"
                value={editAmount}
                pending={editPending}
                error={editError}
                onChange={onEditAmountChange}
                onSave={onSaveEdit}
                onSaveRecurring={onSaveRecurring}
                onRemoveOverride={onRemoveOverride}
                onCancel={onCancelEdit}
              />
            ) : (
              <dl className="budget-mobile-card__amounts">
                <div><dt>זמין</dt><dd><FundedComposition row={row} /></dd></div>
                <div><dt>בפועל</dt><dd className="budget-actual-amount"><BudgetMoneyAmount value={row.actual} /></dd></div>
                <div><dt>{row.isDeficit ? 'חריגה' : 'נותר'}</dt><dd><RemainingAmount row={row} /></dd></div>
              </dl>
            )}
            <BudgetProgress row={row} />
          </article>
        );
      })}
    </div>
  </section>
);

export default BudgetList;
