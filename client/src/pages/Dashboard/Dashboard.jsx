import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getAllLoans,
  getBudgetsByMonth,
  getDashboardMonthlySeries,
  getDashboardSummary,
  getTasks,
  getTransactions,
} from '../../services/api';
import { getMonthRange } from '../../utils/dateRange';
import { formatMonthKeyShort } from '../../utils/dashboardHelpers';
import { approximateMoneyRatio, subtractMoney } from '../../utils/money';
import { isOverdue } from '../../utils/taskHelpers';
import {
  DashboardBudgets,
  DashboardChart,
  DashboardLoans,
  DashboardPageError,
  DashboardSkeleton,
  DashboardTasks,
  DashboardTransactions,
  MonthlySummary,
} from './DashboardSections';
import './Dashboard.css';

const RECENT_TRANSACTIONS_LIMIT = 5;
const TREND_MONTHS = 6;
const EMPTY_STATS = { income: 0, expenses: 0, balance: 0, count: 0 };
const PRIORITY_WEIGHT = { urgent: 0, high: 1, medium: 2, low: 3 };

const createResourceState = (data) => ({ status: 'loading', data, error: null });

/**
 * Keeps each independent Dashboard request isolated, retryable, and protected
 * from stale responses without moving any API or aggregation rules into JSX.
 */
const useDashboardResource = (loader, initialData) => {
  const [resource, setResource] = useState(() => createResourceState(initialData));
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    const activeRequest = requestId.current + 1;
    requestId.current = activeRequest;
    setResource((current) => ({ ...current, status: 'loading', error: null }));

    try {
      const data = await loader();
      if (requestId.current === activeRequest) {
        setResource({ status: 'success', data, error: null });
      }
      return data;
    } catch (error) {
      if (requestId.current === activeRequest) {
        setResource((current) => ({ ...current, status: 'error', error }));
      }
      throw error;
    }
  }, [loader]);

  useEffect(() => {
    reload().catch(() => undefined);
    return () => {
      requestId.current += 1;
    };
  }, [reload]);

  return { ...resource, reload };
};

const Dashboard = () => {
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const date = new Date();
    date.setDate(1);
    return date;
  });

  const monthOptions = useMemo(() => {
    const now = new Date();
    return Array.from(
      { length: 12 },
      (_, index) => new Date(now.getFullYear(), now.getMonth() - index, 1),
    );
  }, []);

  const currentMonthKey = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const selectedRange = useMemo(() => getMonthRange(selectedMonth), [selectedMonth]);

  const loadSummary = useCallback(async () => {
    const response = await getDashboardSummary(selectedRange.start, selectedRange.end);
    return response.data;
  }, [selectedRange.end, selectedRange.start]);

  const loadSeries = useCallback(async () => {
    const response = await getDashboardMonthlySeries(TREND_MONTHS);
    return response.data;
  }, []);

  const loadTasks = useCallback(async () => {
    const response = await getTasks();
    return response.data;
  }, []);

  const loadLoans = useCallback(async () => {
    const response = await getAllLoans();
    return response.data;
  }, []);

  const loadBudgets = useCallback(async () => {
    const response = await getBudgetsByMonth(currentMonthKey);
    return response.data;
  }, [currentMonthKey]);

  const loadTransactions = useCallback(async () => {
    const response = await getTransactions({ limit: RECENT_TRANSACTIONS_LIMIT });
    return response.data.data;
  }, []);

  const summary = useDashboardResource(loadSummary, EMPTY_STATS);
  const series = useDashboardResource(loadSeries, []);
  const tasks = useDashboardResource(loadTasks, []);
  const loans = useDashboardResource(loadLoans, []);
  const budgets = useDashboardResource(loadBudgets, []);
  const transactions = useDashboardResource(loadTransactions, []);

  const chartData = useMemo(
    () => series.data.map((row) => ({
      month: row.month,
      name: formatMonthKeyShort(row.month),
      income: Number(row.income) || 0,
      expenses: Number(row.expenses) || 0,
    })),
    [series.data],
  );

  const budgetProgress = useMemo(() => budgets.data
    .map((budgetItem) => {
      const spent = budgetItem.actual_spent ?? '0.00';
      const planned = budgetItem.amount ?? '0.00';
      const utilization = approximateMoneyRatio(spent, planned);

      return {
        id: budgetItem.id,
        name: budgetItem.categories?.name || 'כללי',
        icon: budgetItem.categories?.icon || '',
        spent,
        planned,
        utilization,
        remaining: subtractMoney(planned, spent),
      };
    })
    .sort((first, second) => second.utilization - first.utilization), [budgets.data]);

  const openTasks = useMemo(
    () => tasks.data.filter((task) => task.status !== 'done' && task.status !== 'cancelled'),
    [tasks.data],
  );
  const overdueTaskCount = useMemo(() => tasks.data.filter(isOverdue).length, [tasks.data]);
  const topTasks = useMemo(() => [...openTasks]
    .sort((first, second) => {
      const firstOverdue = isOverdue(first) ? 0 : 1;
      const secondOverdue = isOverdue(second) ? 0 : 1;
      if (firstOverdue !== secondOverdue) return firstOverdue - secondOverdue;
      return (PRIORITY_WEIGHT[first.priority] ?? 2) - (PRIORITY_WEIGHT[second.priority] ?? 2);
    })
    .slice(0, 3), [openTasks]);

  const resources = [summary, series, tasks, loans, budgets, transactions];
  const isInitialLoading = resources.every((resource) => resource.status === 'loading');
  const isPageFailure = resources.every((resource) => resource.status === 'error');
  const retryAll = () => Promise.allSettled(resources.map((resource) => resource.reload()));

  if (isInitialLoading) {
    return <DashboardSkeleton />;
  }

  if (isPageFailure) {
    return <DashboardPageError onRetry={retryAll} />;
  }

  return (
    <div className="dashboard-page" dir="rtl">
      <MonthlySummary
        resource={summary}
        selectedMonth={selectedMonth}
        monthOptions={monthOptions}
        onMonthChange={setSelectedMonth}
      />

      <div className="dashboard-grid dashboard-grid--trend-tasks">
        <DashboardChart resource={{ ...series, data: chartData }} />
        <DashboardTasks
          resource={{ ...tasks, data: topTasks }}
          openCount={openTasks.length}
          overdueCount={overdueTaskCount}
        />
      </div>

      <div className="dashboard-grid dashboard-grid--budget-loans">
        <DashboardBudgets
          resource={{ ...budgets, data: budgetProgress }}
          currentMonthKey={currentMonthKey}
        />
        <DashboardLoans resource={loans} />
      </div>

      <DashboardTransactions resource={transactions} />
    </div>
  );
};

export default Dashboard;
