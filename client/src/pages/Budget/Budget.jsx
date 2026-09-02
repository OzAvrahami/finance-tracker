import { useContext, useEffect, useMemo, useState } from 'react';
import { Alert, ErrorState } from '../../components/ui';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import {
  absoluteMoney,
  approximateMoneyRatio,
  compareMoney,
  subtractMoney,
} from '../../utils/money';
import {
  addManualBudgetFunding,
  applyBudgetCarryover,
  adjustFundedBudget,
  copyBudget,
  establishFundedBudget,
  getCategories,
  getFundedBudgetMonth,
  initializeRecurringBudgets,
  removeFundedBudget,
} from '../../services/api';
import BudgetSummary from './BudgetSummary';
import BudgetList from './BudgetList';
import BudgetMoneyAmount from './BudgetMoneyAmount';
import { CopyBudgetDialog, DeleteBudgetDialog } from './BudgetDialogs';
import {
  AddBudgetPanel,
  BudgetEmpty,
  BudgetInsights,
  BudgetSkeleton,
  ManualFundingPanel,
  RecurringBudgetPanel,
  CarryoverPanel,
} from './BudgetStates';
import './Budget.css';

const currentCalendarMonth = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return `${year}-${month}`;
};

const emptyState = (month) => ({
  month,
  currency: 'ILS',
  funding: {
    available: '0.00',
    starting_total: '0.00',
    total_allocated: '0.00',
    active_allocated: '0.00',
    inactive_retained_funding: '0.00',
    unallocated: '0.00',
  },
  actuals: { total: '0.00', budgeted: '0.00', unbudgeted: '0.00' },
  categories: [],
  history: [],
  recurring: {
    eligible: false, initialized: false, pending_categories: [], pending_count: 0,
    required: '0.00', unallocated: '0.00', shortfall: '0.00', can_apply: false,
  },
  carryover: {
    eligible: false, reason: 'CURRENT_MONTH_ONLY', source_month: null, destination_month: month,
    fingerprint: '', ready_categories: [], ready_count: 0, total_incoming: '0.00',
    already_applied_categories: [], blocked_categories: [], can_apply: false,
  },
});

const requestKey = () => globalThis.crypto.randomUUID();

const domainMessage = (error, fallback) => {
  const message = error?.response?.data?.error;
  if (!message) return fallback;
  if (/insufficient unallocated/i.test(message)) {
    return 'אין מספיק כסף שטרם הוקצה בחודש היעד. יש להוסיף כסף זמין לפני ההקצאה.';
  }
  if (/already exists/i.test(message)) {
    return 'כבר קיימת היסטוריית תקציב לקטגוריה בחודש זה.';
  }
  if (/inactive/i.test(message)) {
    return 'התקציב אינו פעיל. יש להפעיל אותו מחדש לפני שינוי הסכום.';
  }
  return message;
};

const enrichBudget = (budget) => {
  const planned = budget.final_funded ?? '0.00';
  const actual = budget.actual_spent ?? '0.00';
  const remaining = budget.remaining ?? subtractMoney(planned, actual);
  const plannedComparison = compareMoney(planned);
  const remainingComparison = compareMoney(remaining);
  const percent = plannedComparison > 0 ? Math.round(approximateMoneyRatio(actual, planned)) : 0;

  let tone = 'default';
  let statusLabel = 'תקין';
  if (remainingComparison < 0) {
    tone = 'negative';
    statusLabel = 'גירעון';
  } else if (plannedComparison > 0 && percent === 100) {
    tone = 'warning';
    statusLabel = 'נוצל במלואו';
  } else if (percent >= 70) {
    tone = 'warning';
    statusLabel = 'קרוב למגבלה';
  } else if (percent === 0) {
    tone = 'neutral';
    statusLabel = plannedComparison === 0 ? 'תקציב אפס פעיל' : 'ללא הוצאה';
  }

  return {
    ...budget,
    id: budget.budget_id,
    amount: planned,
    planned,
    starting: budget.starting_amount ?? '0.00',
    adjustments: budget.adjustment_total ?? '0.00',
    incomingCarryover: budget.incoming_carryover ?? '0.00',
    outgoingCarryover: budget.outgoing_carryover ?? '0.00',
    actual,
    remaining,
    remainingAbsolute: absoluteMoney(remaining),
    isDeficit: remainingComparison < 0,
    percent,
    tone,
    statusLabel,
    categoryName: budget.categories?.name || 'קטגוריה ללא שם',
    categoryIcon: budget.categories?.icon || '',
  };
};

const Budget = () => {
  const [selectedMonth, setSelectedMonth] = useState(currentCalendarMonth);
  const [requestVersion, setRequestVersion] = useState(0);
  const [query, setQuery] = useState({ month: null, version: -1, state: emptyState(currentCalendarMonth()), error: null });
  const [categories, setCategories] = useState([]);
  const [categoriesError, setCategoriesError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editAmount, setEditAmount] = useState('');
  const [editPending, setEditPending] = useState(false);
  const [editError, setEditError] = useState('');
  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [showFundingPanel, setShowFundingPanel] = useState(false);
  const [newCategoryId, setNewCategoryId] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [addPending, setAddPending] = useState(false);
  const [addError, setAddError] = useState('');
  const [fundingAmount, setFundingAmount] = useState('');
  const [fundingSource, setFundingSource] = useState('');
  const [fundingPending, setFundingPending] = useState(false);
  const [fundingError, setFundingError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [recurringPending, setRecurringPending] = useState(false);
  const [recurringError, setRecurringError] = useState('');
  const [carryoverPending, setCarryoverPending] = useState(false);
  const [carryoverError, setCarryoverError] = useState('');
  const { setPageHeader } = useContext(PageHeaderContext);

  const loading = query.month !== selectedMonth || query.version !== requestVersion;
  const state = query.month === selectedMonth ? query.state : emptyState(selectedMonth);
  const pageError = !loading && query.error;
  const activeBudgets = useMemo(
    () => state.categories.filter((category) => category.budget_id && category.lifecycle_state === 'active'),
    [state.categories]
  );

  useEffect(() => {
    setPageHeader({ title: 'תקציב חודשי', subtitle: 'תקציב חודשי ממומן לפי קטגוריה' });
  }, [setPageHeader]);

  useEffect(() => {
    let active = true;
    getCategories()
      .then((response) => {
        if (!active) return;
        setCategories(response.data);
        setCategoriesError('');
      })
      .catch(() => {
        if (!active) return;
        setCategoriesError('לא ניתן היה לטעון את קטגוריות ההוצאה. אפשר לנסות שוב ברענון העמוד.');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const month = selectedMonth;
    const version = requestVersion;

    getFundedBudgetMonth(month)
      .then((response) => {
        if (!active) return;
        setQuery({ month, version, state: response.data, error: null });
      })
      .catch(() => {
        if (!active) return;
        setQuery((current) => ({
          month,
          version,
          state: current.month === month ? current.state : emptyState(month),
          error: 'לא ניתן היה לטעון את התקציב החודשי.',
        }));
      });

    return () => { active = false; };
  }, [selectedMonth, requestVersion]);

  const rows = useMemo(() => activeBudgets.map(enrichBudget), [activeBudgets]);
  const summary = useMemo(() => ({
    available: state.funding.available,
    allocated: state.funding.total_allocated,
    unallocated: state.funding.unallocated,
    totalSpent: state.actuals.total,
  }), [state]);

  const insights = useMemo(() => {
    const withDiff = activeBudgets.map((budget) => ({
      ...budget,
      id: budget.budget_id,
      amount: budget.final_funded,
      diff: subtractMoney(budget.final_funded, budget.actual_spent),
    }));
    const overBudget = withDiff
      .filter((budget) => compareMoney(budget.diff) < 0)
      .sort((a, b) => compareMoney(a.diff, b.diff))
      .slice(0, 3);
    const underUtilized = withDiff
      .filter((budget) => compareMoney(budget.diff) > 0 && compareMoney(budget.final_funded) > 0)
      .sort((a, b) => compareMoney(b.diff, a.diff))
      .slice(0, 3);
    return { overBudget, underUtilized };
  }, [activeBudgets]);

  const availableCategories = useMemo(() => {
    const snapshotCategoryIds = new Set(
      state.categories.filter((category) => category.budget_id).map((category) => category.category_id)
    );
    return categories.filter((category) => category.type === 'expense' && !snapshotCategoryIds.has(category.id));
  }, [categories, state.categories]);

  const refreshBudgets = () => setRequestVersion((version) => version + 1);

  const closeAddPanel = () => {
    if (addPending) return;
    setShowAddPanel(false);
    setNewCategoryId('');
    setNewAmount('');
    setAddError('');
  };

  const closeFundingPanel = () => {
    if (fundingPending) return;
    setShowFundingPanel(false);
    setFundingAmount('');
    setFundingSource('');
    setFundingError('');
  };

  const changeMonth = (month) => {
    if (!month || month === selectedMonth) return;
    closeAddPanel();
    closeFundingPanel();
    setEditingId(null);
    setEditAmount('');
    setEditError('');
    setRecurringError('');
    setCarryoverError('');
    setSelectedMonth(month);
  };

  const handleFunding = async () => {
    if (!fundingSource.trim() || !fundingAmount || fundingPending) return;
    setFundingPending(true);
    setFundingError('');
    try {
      await addManualBudgetFunding({
        month: selectedMonth,
        amount: fundingAmount,
        source_label: fundingSource.trim(),
        request_key: requestKey(),
      });
      setShowFundingPanel(false);
      setFundingAmount('');
      setFundingSource('');
      refreshBudgets();
    } catch (error) {
      setFundingError(domainMessage(error, 'הוספת הכסף הזמין נכשלה. הפרטים נשמרו ואפשר לנסות שוב.'));
    } finally {
      setFundingPending(false);
    }
  };

  const handleAdd = async () => {
    if (!newCategoryId || newAmount === '' || addPending) return;
    setAddPending(true);
    setAddError('');
    try {
      await establishFundedBudget({
        month: selectedMonth,
        category_id: Number(newCategoryId),
        starting_amount: newAmount,
        starting_kind: 'manual',
        request_key: requestKey(),
      });
      setShowAddPanel(false);
      setNewCategoryId('');
      setNewAmount('');
      refreshBudgets();
    } catch (error) {
      setAddError(domainMessage(error, 'הוספת התקציב נכשלה. הבחירה והסכום נשמרו ואפשר לנסות שוב.'));
    } finally {
      setAddPending(false);
    }
  };

  const startEdit = (row) => {
    setEditingId(row.id);
    setEditAmount(row.planned);
    setEditError('');
  };

  const cancelEdit = () => {
    if (editPending) return;
    setEditingId(null);
    setEditAmount('');
    setEditError('');
  };

  const handleEdit = async (row) => {
    if (editPending || editAmount === '') return;
    setEditPending(true);
    setEditError('');
    try {
      await adjustFundedBudget(row.id, {
        target_amount: editAmount,
        request_key: requestKey(),
      });
      setEditingId(null);
      setEditAmount('');
      refreshBudgets();
    } catch (error) {
      setEditError(domainMessage(error, 'שמירת התקציב נכשלה. הסכום שהוזן נשמר ואפשר לנסות שוב.'));
    } finally {
      setEditPending(false);
    }
  };

  const handleDelete = async (row) => {
    await removeFundedBudget(row.id, { request_key: requestKey() });
    refreshBudgets();
  };

  const handleCopy = async (targetMonth) => {
    await copyBudget({ fromMonth: selectedMonth, toMonth: targetMonth, request_key: requestKey() });
    refreshBudgets();
  };

  const handleRecurringInitialization = async () => {
    if (recurringPending) return;
    setRecurringPending(true);
    setRecurringError('');
    try {
      await initializeRecurringBudgets({
        month: selectedMonth,
        request_key: requestKey(),
      });
      refreshBudgets();
    } catch (error) {
      setRecurringError(domainMessage(error, 'החלת התקציבים החוזרים נכשלה. לא בוצעה הקצאה חלקית.'));
    } finally {
      setRecurringPending(false);
    }
  };

  const handleCarryover = async () => {
    if (carryoverPending || !state.carryover?.fingerprint) return;
    setCarryoverPending(true);
    setCarryoverError('');
    try {
      await applyBudgetCarryover({
        destination_month: selectedMonth,
        request_key: requestKey(),
        preview_fingerprint: state.carryover.fingerprint,
      });
      refreshBudgets();
    } catch (error) {
      const code = error?.response?.data?.code;
      const fallback = code === 'CARRYOVER_PREVIEW_STALE' || code === '40001'
        ? 'תצוגת העברת היתרות השתנתה. רעננו את החודש ונסו שוב.'
        : 'העברת היתרות נכשלה. לא בוצעה העברה חלקית.';
      setCarryoverError(domainMessage(error, fallback));
    } finally {
      setCarryoverPending(false);
    }
  };

  return (
    <div className="budget-page" dir="rtl">
      <BudgetSummary
        selectedMonth={selectedMonth}
        onMonthChange={changeMonth}
        summary={summary}
        loading={loading}
        unavailable={Boolean(pageError && activeBudgets.length === 0)}
        onOpenFunding={() => setShowFundingPanel(true)}
        onOpenCopy={() => setShowCopyDialog(true)}
        onOpenAdd={() => setShowAddPanel(true)}
      />

      <ManualFundingPanel
        open={showFundingPanel}
        amount={fundingAmount}
        sourceLabel={fundingSource}
        saving={fundingPending}
        error={fundingError}
        onAmountChange={setFundingAmount}
        onSourceLabelChange={setFundingSource}
        onSave={handleFunding}
        onClose={closeFundingPanel}
      />

      <AddBudgetPanel
        open={showAddPanel}
        month={selectedMonth}
        categories={availableCategories}
        categoryId={newCategoryId}
        amount={newAmount}
        saving={addPending}
        error={addError || categoriesError}
        onCategoryChange={setNewCategoryId}
        onAmountChange={setNewAmount}
        onSave={handleAdd}
        onClose={closeAddPanel}
      />

      {!loading && !pageError && state.recurring?.pending_count > 0 && (
        <RecurringBudgetPanel
          recurring={state.recurring}
          applying={recurringPending}
          error={recurringError}
          onApply={handleRecurringInitialization}
          onOpenFunding={() => setShowFundingPanel(true)}
        />
      )}

      {!loading && !pageError && state.carryover?.eligible && (
        state.carryover.ready_categories?.length > 0
        || state.carryover.blocked_categories?.length > 0
        || state.carryover.already_applied_categories?.length > 0
      ) && (
        <CarryoverPanel
          carryover={state.carryover}
          applying={carryoverPending}
          error={carryoverError}
          onApply={handleCarryover}
        />
      )}

      {!loading && compareMoney(state.actuals.unbudgeted) > 0 && (
        <Alert variant="warning" className="budget-refresh-error">
          הוצאות ללא תקציב פעיל בחודש זה:{' '}
          <BudgetMoneyAmount value={state.actuals.unbudgeted} />.
        </Alert>
      )}

      {pageError && activeBudgets.length > 0 && (
        <Alert variant="error" className="budget-refresh-error">
          {pageError} הנתונים האחרונים נשארו מוצגים.
          <button type="button" onClick={refreshBudgets}>ניסיון נוסף</button>
        </Alert>
      )}

      {loading ? (
        <BudgetSkeleton />
      ) : pageError && activeBudgets.length === 0 ? (
        <ErrorState
          title="לא ניתן לטעון את התקציב"
          description="אירעה שגיאה בטעינת התקציב הממומן וההוצאות בפועל לחודש שנבחר."
          onRetry={refreshBudgets}
        />
      ) : activeBudgets.length === 0 ? (
        <BudgetEmpty
          month={selectedMonth}
          canAdd={availableCategories.length > 0}
          onAdd={() => setShowAddPanel(true)}
          onCopy={() => setShowCopyDialog(true)}
        />
      ) : (
        <>
          <BudgetList
            rows={rows}
            editingId={editingId}
            editAmount={editAmount}
            editPending={editPending}
            editError={editError}
            onStartEdit={startEdit}
            onEditAmountChange={setEditAmount}
            onSaveEdit={handleEdit}
            onCancelEdit={cancelEdit}
            onRequestDelete={setDeleteTarget}
          />
          <BudgetInsights insights={insights} />
        </>
      )}

      <CopyBudgetDialog
        open={showCopyDialog}
        sourceMonth={selectedMonth}
        onClose={() => setShowCopyDialog(false)}
        onCopy={handleCopy}
      />
      <DeleteBudgetDialog
        budget={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
};

export default Budget;
