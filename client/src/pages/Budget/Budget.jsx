import { useContext, useEffect, useMemo, useState } from 'react';
import { Alert, ErrorState } from '../../components/ui';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import {
  copyBudget,
  deleteBudget,
  getBudgetsByMonth,
  getCategories,
  upsertBudget,
} from '../../services/api';
import BudgetSummary from './BudgetSummary';
import BudgetList from './BudgetList';
import { CopyBudgetDialog, DeleteBudgetDialog } from './BudgetDialogs';
import {
  AddBudgetPanel,
  BudgetEmpty,
  BudgetInsights,
  BudgetSkeleton,
} from './BudgetStates';
import './Budget.css';

const currentCalendarMonth = () => new Date().toISOString().slice(0, 7);

const enrichBudget = (budget) => {
  const planned = Number(budget.amount);
  const actual = Number(budget.actual_spent);
  const remaining = planned - actual;
  const percent = planned > 0 ? Math.round((actual / planned) * 100) : 0;

  let tone = 'default';
  let statusLabel = 'תקין';
  if (percent > 100) {
    tone = 'negative';
    statusLabel = 'חריגה';
  } else if (percent === 100) {
    tone = 'warning';
    statusLabel = 'נוצל במלואו';
  } else if (percent >= 70) {
    tone = 'warning';
    statusLabel = 'קרוב למגבלה';
  } else if (percent === 0) {
    tone = 'neutral';
    statusLabel = planned === 0 ? 'תקציב אפס' : 'ללא הוצאה';
  }

  return {
    ...budget,
    planned,
    actual,
    remaining,
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
  const [query, setQuery] = useState({ month: null, version: -1, budgets: [], error: null });
  const [categories, setCategories] = useState([]);
  const [categoriesError, setCategoriesError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editAmount, setEditAmount] = useState('');
  const [editPending, setEditPending] = useState(false);
  const [editError, setEditError] = useState('');
  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [newCategoryId, setNewCategoryId] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [addPending, setAddPending] = useState(false);
  const [addError, setAddError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const { setPageHeader } = useContext(PageHeaderContext);

  const loading = query.month !== selectedMonth || query.version !== requestVersion;
  const budgets = useMemo(
    () => (query.month === selectedMonth ? query.budgets : []),
    [query.budgets, query.month, selectedMonth]
  );
  const pageError = !loading && query.error;

  useEffect(() => {
    setPageHeader({
      title: 'תקציב חודשי',
      subtitle: 'מעקב תקציב חודשי לפי קטגוריה',
    });
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

    getBudgetsByMonth(month)
      .then((response) => {
        if (!active) return;
        setQuery({ month, version, budgets: response.data, error: null });
      })
      .catch(() => {
        if (!active) return;
        setQuery((current) => ({
          month,
          version,
          budgets: current.month === month ? current.budgets : [],
          error: 'לא ניתן היה לטעון את התקציב החודשי.',
        }));
      });

    return () => { active = false; };
  }, [selectedMonth, requestVersion]);

  const rows = useMemo(() => budgets.map(enrichBudget), [budgets]);

  const summary = useMemo(() => {
    const totalBudget = budgets.reduce((sum, budget) => sum + Number(budget.amount), 0);
    const totalSpent = budgets.reduce((sum, budget) => sum + Number(budget.actual_spent), 0);
    return { totalBudget, totalSpent, remaining: totalBudget - totalSpent };
  }, [budgets]);

  const insights = useMemo(() => {
    const withDiff = budgets.map((budget) => ({
      ...budget,
      diff: Number(budget.amount) - Number(budget.actual_spent),
    }));
    const overBudget = withDiff
      .filter((budget) => budget.diff < 0)
      .sort((first, second) => first.diff - second.diff)
      .slice(0, 3);
    const underUtilized = withDiff
      .filter((budget) => budget.diff > 0 && Number(budget.amount) > 0)
      .sort((first, second) => second.diff - first.diff)
      .slice(0, 3);
    return { overBudget, underUtilized };
  }, [budgets]);

  const availableCategories = useMemo(() => {
    const budgetedIds = new Set(budgets.map((budget) => budget.category_id));
    return categories.filter((category) => category.type === 'expense' && !budgetedIds.has(category.id));
  }, [budgets, categories]);

  const refreshBudgets = () => setRequestVersion((version) => version + 1);

  const closeAddPanel = () => {
    if (addPending) return;
    setShowAddPanel(false);
    setNewCategoryId('');
    setNewAmount('');
    setAddError('');
  };

  const changeMonth = (month) => {
    if (!month || month === selectedMonth) return;
    closeAddPanel();
    setEditingId(null);
    setEditAmount('');
    setEditError('');
    setSelectedMonth(month);
  };

  const handleAdd = async () => {
    if (!newCategoryId || !newAmount || addPending) return;
    setAddPending(true);
    setAddError('');
    try {
      await upsertBudget({
        category_id: Number(newCategoryId),
        month: selectedMonth,
        amount: Number(newAmount),
      });
      setNewCategoryId('');
      setNewAmount('');
      setShowAddPanel(false);
      refreshBudgets();
    } catch {
      setAddError('הוספת התקציב נכשלה. הבחירה והסכום נשמרו ואפשר לנסות שוב.');
    } finally {
      setAddPending(false);
    }
  };

  const startEdit = (row) => {
    setEditingId(row.id);
    setEditAmount(String(row.planned));
    setEditError('');
  };

  const cancelEdit = () => {
    if (editPending) return;
    setEditingId(null);
    setEditAmount('');
    setEditError('');
  };

  const handleEdit = async (row) => {
    if (editPending) return;
    setEditPending(true);
    setEditError('');
    try {
      await upsertBudget({
        category_id: row.category_id,
        month: selectedMonth,
        amount: Number(editAmount),
      });
      setEditingId(null);
      setEditAmount('');
      refreshBudgets();
    } catch {
      setEditError('שמירת התקציב נכשלה. הסכום שהוזן נשמר ואפשר לנסות שוב.');
    } finally {
      setEditPending(false);
    }
  };

  const handleDelete = async (row) => {
    await deleteBudget(row.id);
    refreshBudgets();
  };

  const handleCopy = async (targetMonth) => {
    await copyBudget({ fromMonth: selectedMonth, toMonth: targetMonth });
    refreshBudgets();
  };

  return (
    <div className="budget-page" dir="rtl">
      <BudgetSummary
        selectedMonth={selectedMonth}
        onMonthChange={changeMonth}
        summary={summary}
        loading={loading}
        unavailable={Boolean(pageError && budgets.length === 0)}
        onOpenCopy={() => setShowCopyDialog(true)}
        onOpenAdd={() => setShowAddPanel(true)}
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

      {pageError && budgets.length > 0 && (
        <Alert variant="error" className="budget-refresh-error">
          {pageError} הנתונים האחרונים נשארו מוצגים.
          <button type="button" onClick={refreshBudgets}>ניסיון נוסף</button>
        </Alert>
      )}

      {loading ? (
        <BudgetSkeleton />
      ) : pageError && budgets.length === 0 ? (
        <ErrorState
          title="לא ניתן לטעון את התקציב"
          description="אירעה שגיאה בטעינת יעדי התקציב וההוצאות בפועל לחודש שנבחר."
          onRetry={refreshBudgets}
        />
      ) : budgets.length === 0 ? (
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
