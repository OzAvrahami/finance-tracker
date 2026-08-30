import { useCallback, useEffect, useMemo, useState } from 'react';
import { PiggyBank, Pencil } from 'lucide-react';
import {
  Alert,
  Dialog,
  MoneyAmount,
  PrimaryButton,
  SecondaryButton,
  TextField,
} from '../../components/ui';
import {
  getSettingsCategories,
  setSettingsCategoryRecurringBudget,
} from '../../services/api';
import {
  SettingsEmpty,
  SettingsLoadError,
  SettingsSkeleton,
  SettingsStatusBadge,
} from './SettingsComponents';

const BudgetSettingsTab = () => {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [recurringTarget, setRecurringTarget] = useState(null);
  const [recurringAmount, setRecurringAmount] = useState('');
  const [recurringSaving, setRecurringSaving] = useState(false);
  const [recurringError, setRecurringError] = useState('');

  const loadCategories = useCallback(async () => {
    setLoadError(false);
    try {
      const response = await getSettingsCategories();
      setCategories(Array.isArray(response.data) ? response.data : []);
      return true;
    } catch {
      setLoadError(true);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const expenseCategories = useMemo(
    () => categories.filter((category) => category.type === 'expense'),
    [categories],
  );

  const configuredCount = useMemo(
    () => expenseCategories.filter((category) => category.recurring_budget_amount != null).length,
    [expenseCategories],
  );

  const openRecurring = (category) => {
    setRecurringTarget(category);
    setRecurringAmount(category.recurring_budget_amount ?? '');
    setRecurringError('');
  };

  const closeRecurring = () => {
    if (recurringSaving) return;
    setRecurringTarget(null);
    setRecurringAmount('');
    setRecurringError('');
  };

  const saveRecurring = async (amount) => {
    if (!recurringTarget || recurringSaving) return;
    setRecurringSaving(true);
    setRecurringError('');
    try {
      await setSettingsCategoryRecurringBudget(recurringTarget.id, { amount });
      setRecurringTarget(null);
      setRecurringAmount('');
      await loadCategories();
    } catch (error) {
      setRecurringError(error.response?.data?.error || 'שמירת התקציב החוזר נכשלה. הסכום נשמר וניתן לנסות שוב.');
    } finally {
      setRecurringSaving(false);
    }
  };

  if (loading) return <SettingsSkeleton label="טעינת הגדרות תקציב" />;

  if (loadError) {
    return <SettingsLoadError title="טעינת הגדרות התקציב נכשלה" onRetry={loadCategories} />;
  }

  return (
    <section className="settings-section" aria-label="הגדרות תקציב">
      <div className="settings-budget-header">
        <div>
          <h2>תקציב חודשי חוזר</h2>
          <p>
            הגדירו את סכום הפתיחה החודשי לכל קטגוריית הוצאה. ההגדרות יוצגו בעמוד התקציב
            ויוחלו רק בפעולה מפורשת.
          </p>
        </div>
        <span className="settings-toolbar__count">
          {configuredCount} מתוך {expenseCategories.length} מוגדרות
        </span>
      </div>

      {expenseCategories.length === 0 ? (
        <SettingsEmpty
          icon={PiggyBank}
          title="אין קטגוריות הוצאה להגדרה"
          description="אפשר ליצור קטגוריית הוצאה בלשונית הקטגוריות ולאחר מכן להגדיר לה תקציב חודשי חוזר."
        />
      ) : (
        <div className="settings-budget-records" aria-label="תקציבים חודשיים חוזרים">
          {expenseCategories.map((category) => {
            const configured = category.recurring_budget_amount != null;
            return (
              <article
                key={category.id}
                className={`settings-budget-record${category.is_active ? '' : ' is-inactive'}`}
                aria-label={`${category.name} — תקציב חודשי חוזר`}
              >
                <span className="settings-record__icon" aria-hidden="true">
                  {category.icon || '🏷️'}
                </span>
                <div className="settings-budget-record__identity">
                  <h3>{category.name}</h3>
                  <SettingsStatusBadge active={category.is_active} feminine />
                </div>
                <div className="settings-budget-record__configuration">
                  <span className="settings-budget-record__label">סכום חודשי חוזר</span>
                  {configured ? (
                    <strong className="settings-budget-record__value">
                      <MoneyAmount
                        value={category.recurring_budget_amount}
                        minimumFractionDigits={0}
                        maximumFractionDigits={2}
                      />
                      <span> לחודש</span>
                    </strong>
                  ) : (
                    <span className="settings-budget-record__unset">לא הוגדר</span>
                  )}
                </div>
                <SecondaryButton
                  type="button"
                  size="sm"
                  className="settings-budget-record__action"
                  aria-label={`${configured ? 'עריכת' : 'הגדרת'} תקציב חוזר עבור ${category.name}`}
                  onClick={() => openRecurring(category)}
                >
                  <Pencil size={14} aria-hidden="true" />
                  {configured ? 'עריכה' : 'הגדרה'}
                </SecondaryButton>
              </article>
            );
          })}
        </div>
      )}

      <div className="settings-note">
        שינוי או השבתה משפיעים רק על חודשים שטרם אותחלו. תקציבי פתיחה שכבר נוצרו נשארים ללא שינוי.
      </div>

      <Dialog
        open={Boolean(recurringTarget)}
        onClose={closeRecurring}
        title={recurringTarget ? `תקציב חוזר — ${recurringTarget.name}` : 'תקציב חוזר'}
        size="sm"
        className="settings-dialog"
        closeDisabled={recurringSaving}
        footer={(
          <>
            <PrimaryButton
              type="button"
              loading={recurringSaving}
              loadingText="שומר..."
              disabled={recurringAmount === ''}
              onClick={() => saveRecurring(recurringAmount)}
            >
              שמירת תקציב חוזר
            </PrimaryButton>
            {recurringTarget?.recurring_budget_amount != null && (
              <SecondaryButton
                type="button"
                disabled={recurringSaving}
                onClick={() => saveRecurring(null)}
              >
                השבתת תקציב חוזר
              </SecondaryButton>
            )}
            <SecondaryButton type="button" disabled={recurringSaving} onClick={closeRecurring}>
              ביטול
            </SecondaryButton>
          </>
        )}
      >
        <div className="settings-dialog__form">
          <p>הסכום מוצע לחודש חדש בלבד ומוחל רק בפעולה מפורשת מעמוד התקציב. חודשים היסטוריים לא משתנים.</p>
          <TextField
            id="category-recurring-budget-amount"
            label="סכום חודשי חוזר"
            type="text"
            inputMode="decimal"
            technicalLtr
            pattern="(?:0|[1-9]\d*)(?:\.\d{1,2})?"
            value={recurringAmount}
            onValueChange={setRecurringAmount}
            disabled={recurringSaving}
            required
            helperText="אפס הוא תקציב חוזר מפורש; השבתה מסירה את ברירת המחדל בלבד."
          />
          {recurringError && <Alert variant="error" urgent>{recurringError}</Alert>}
        </div>
      </Dialog>
    </section>
  );
};

export default BudgetSettingsTab;
