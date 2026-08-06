import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import Dashboard from './Dashboard';
import {
  getTransactions,
  getAllLoans,
  getBudgetsByMonth,
  getTasks,
  getDashboardSummary,
  getDashboardMonthlySeries,
} from '../../services/api';

vi.mock('../../services/api', () => ({
  getTransactions: vi.fn(),
  getAllLoans: vi.fn(),
  getBudgetsByMonth: vi.fn(),
  getTasks: vi.fn(),
  getDashboardSummary: vi.fn(),
  getDashboardMonthlySeries: vi.fn(),
}));

const renderDashboard = () =>
  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  getTransactions.mockResolvedValue({
    data: { data: [], pagination: { limit: 5, hasMore: true, nextCursor: null } },
  });
  getAllLoans.mockResolvedValue({ data: [] });
  getBudgetsByMonth.mockResolvedValue({ data: [] });
  getTasks.mockResolvedValue({ data: [] });
  getDashboardSummary.mockResolvedValue({
    data: { income: 12000, expenses: 4500, balance: 7500, count: 87 },
  });
  getDashboardMonthlySeries.mockResolvedValue({
    data: [
      { month: '2026-03', income: 100, expenses: 50 },
      { month: '2026-04', income: 200, expenses: 75 },
    ],
  });
});

describe('data sourcing', () => {
  it('gets totals from the aggregate endpoint, not from a transaction list', async () => {
    renderDashboard();
    await waitFor(() => expect(getDashboardSummary).toHaveBeenCalled());

    const [from, to] = getDashboardSummary.mock.calls[0];
    expect(from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('requests only the handful of rows the recent-activity table shows', async () => {
    renderDashboard();
    await waitFor(() => expect(getTransactions).toHaveBeenCalled());

    // The regression guard: this must never become an unbounded request again.
    const params = getTransactions.mock.calls[0][0];
    expect(params).toEqual({ limit: 5 });
  });

  it('gets the trend series from the aggregate endpoint', async () => {
    renderDashboard();
    await waitFor(() => expect(getDashboardMonthlySeries).toHaveBeenCalledWith(6));
  });

  it('renders the KPI values returned by the aggregate endpoint', async () => {
    renderDashboard();
    // 12,000 income and 4,500 expenses come from the server, not from summing rows.
    expect(await screen.findByText(/12,000/)).toBeInTheDocument();
    expect(screen.getByText(/4,500/)).toBeInTheDocument();
  });
});

describe('month selection', () => {
  it('refetches the summary for the newly selected month', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await waitFor(() => expect(getDashboardSummary).toHaveBeenCalledTimes(1));

    const monthSelect = screen.getByRole('combobox');
    const options = screen.getAllByRole('option');
    // Options are the last 12 months, newest first; pick the previous month.
    await user.selectOptions(monthSelect, options[1].value);

    await waitFor(() => expect(getDashboardSummary).toHaveBeenCalledTimes(2));

    const [firstFrom] = getDashboardSummary.mock.calls[0];
    const [secondFrom] = getDashboardSummary.mock.calls[1];
    expect(secondFrom).not.toBe(firstFrom);
    expect(secondFrom < firstFrom).toBe(true);
  });

  it('requests budgets once, for the current calendar month', async () => {
    renderDashboard();
    await waitFor(() => expect(getBudgetsByMonth).toHaveBeenCalledTimes(1));

    const expectedMonth = new Date().toISOString().slice(0, 7);
    expect(getBudgetsByMonth).toHaveBeenCalledWith(expectedMonth);
  });

  it('does not refetch budgets when the selected month changes', async () => {
    // Budgets deliberately do NOT follow the month picker. Making them do so is
    // a reasonable change, but it is a separate task and was removed from the
    // pagination work; this test pins the current behaviour so the two do not
    // get silently recombined.
    const user = userEvent.setup();
    renderDashboard();
    await waitFor(() => expect(getBudgetsByMonth).toHaveBeenCalledTimes(1));

    const options = screen.getAllByRole('option');
    await user.selectOptions(screen.getByRole('combobox'), options[1].value);

    await waitFor(() => expect(getDashboardSummary).toHaveBeenCalledTimes(2));
    expect(getBudgetsByMonth).toHaveBeenCalledTimes(1);
  });
});

describe('budget progress', () => {
  it('uses the server-computed actual_spent instead of recomputing it', async () => {
    getBudgetsByMonth.mockResolvedValue({
      data: [
        {
          id: 1,
          category_id: 3,
          amount: 1000,
          actual_spent: 750,
          categories: { name: 'מזון', icon: '🍎' },
        },
      ],
    });

    renderDashboard();

    // The label renders as "{icon} {name}" in a single span.
    expect(await screen.findByText(/מזון/)).toBeInTheDocument();
    expect(screen.getByText(/750/)).toBeInTheDocument();
    expect(screen.getByText(/נותרו ₪250/)).toBeInTheDocument();
  });

  it('renders the empty state when no budget is defined', async () => {
    renderDashboard();
    expect(await screen.findByText('לא הוגדר תקציב לחודש זה')).toBeInTheDocument();
  });
});

describe('resilience', () => {
  it('still renders when the aggregate endpoint fails', async () => {
    getDashboardSummary.mockRejectedValue(new Error('aggregate down'));
    renderDashboard();

    // The page must come up rather than blocking on a failed total.
    expect(await screen.findByRole('combobox', { name: 'חודש לדשבורד' })).toBeInTheDocument();
  });
});

describe('Finance v3 product truth', () => {
  it('renders exactly the three supported selected-month metrics', async () => {
    renderDashboard();

    const kpis = await screen.findAllByTestId('dashboard-kpi');
    expect(kpis).toHaveLength(3);
    expect(within(kpis[0]).getByRole('heading', { name: 'הכנסות' })).toBeInTheDocument();
    expect(within(kpis[1]).getByRole('heading', { name: 'הוצאות' })).toBeInTheDocument();
    expect(within(kpis[2]).getByRole('heading', { name: 'מאזן החודש' })).toBeInTheDocument();
    expect(within(kpis[0]).getByText('+₪12,000')).toHaveAttribute('dir', 'ltr');
    expect(within(kpis[1]).getByText('−₪4,500')).toHaveAttribute('dir', 'ltr');
    expect(within(kpis[2]).getByText('+₪7,500')).toHaveAttribute('dir', 'ltr');
  });

  it('does not render unsupported or duplicate financial metrics', async () => {
    renderDashboard();
    await screen.findAllByTestId('dashboard-kpi');

    expect(screen.queryByText('יתרה נוכחית')).not.toBeInTheDocument();
    expect(screen.queryByText('נטו לחיסכון')).not.toBeInTheDocument();
    expect(screen.queryByText(/שיעור חיסכון|יעד חיסכון|כל החשבונות/)).not.toBeInTheDocument();
  });

  it('uses the actual balance sign for negative and zero months', async () => {
    getDashboardSummary.mockResolvedValueOnce({
      data: { income: 500, expenses: 800, balance: -300, count: 2 },
    });
    const firstRender = renderDashboard();
    expect(await screen.findByText('−₪300')).toHaveAttribute('dir', 'ltr');

    firstRender.unmount();
    getDashboardSummary.mockResolvedValueOnce({
      data: { income: 0, expenses: 0, balance: 0, count: 0 },
    });
    renderDashboard();
    const balanceCard = (await screen.findAllByTestId('dashboard-kpi'))[2];
    expect(within(balanceCard).getByText('₪0')).toHaveAttribute('dir', 'ltr');
  });

  it('does not recreate the shell-owned page heading or add action', async () => {
    renderDashboard();
    await screen.findByRole('heading', { name: 'החודש הנבחר' });

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /תנועה חדשה/ })).not.toBeInTheDocument();
  });
});

describe('mixed Dashboard periods', () => {
  it('labels selected-month and independent widgets explicitly', async () => {
    renderDashboard();

    expect(await screen.findByText(/שלושת המדדים האלה/)).toBeInTheDocument();
    expect(screen.getByText('תקופה נפרדת · לא לפי החודש הנבחר')).toBeInTheDocument();
    expect(screen.getAllByText('נכון להיום')).toHaveLength(2);
    expect(screen.getByText(/החודש הנוכחי ·/)).toBeInTheDocument();
    expect(screen.getByText('ללא תלות בחודש הנבחר')).toBeInTheDocument();
  });

  it('keeps every independent request unchanged when the KPI month changes', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await waitFor(() => expect(getDashboardSummary).toHaveBeenCalledTimes(1));

    const options = screen.getAllByRole('option');
    await user.selectOptions(screen.getByRole('combobox'), options[1].value);
    await waitFor(() => expect(getDashboardSummary).toHaveBeenCalledTimes(2));

    expect(getDashboardMonthlySeries).toHaveBeenCalledTimes(1);
    expect(getBudgetsByMonth).toHaveBeenCalledTimes(1);
    expect(getTransactions).toHaveBeenCalledTimes(1);
    expect(getAllLoans).toHaveBeenCalledTimes(1);
    expect(getTasks).toHaveBeenCalledTimes(1);
  });
});

describe('Dashboard data states', () => {
  it('starts with a composed loading state', () => {
    getTransactions.mockReturnValue(new Promise(() => {}));
    getAllLoans.mockReturnValue(new Promise(() => {}));
    getBudgetsByMonth.mockReturnValue(new Promise(() => {}));
    getTasks.mockReturnValue(new Promise(() => {}));
    getDashboardSummary.mockReturnValue(new Promise(() => {}));
    getDashboardMonthlySeries.mockReturnValue(new Promise(() => {}));

    renderDashboard();
    expect(screen.getByRole('status')).toHaveTextContent('טוען את לוח הבקרה');
    expect(document.querySelectorAll('.ui-skeleton').length).toBeGreaterThan(3);
  });

  it('renders meaningful empty states for every empty widget', async () => {
    getDashboardMonthlySeries.mockResolvedValue({ data: [] });
    renderDashboard();

    expect(await screen.findByText('אין נתוני מגמה')).toBeInTheDocument();
    expect(screen.getByText('אין מטלות פתוחות')).toBeInTheDocument();
    expect(screen.getByText('אין הלוואות פעילות')).toBeInTheDocument();
    expect(screen.getByText('לא הוגדר תקציב לחודש זה')).toBeInTheDocument();
    expect(screen.getByText('עוד לא נרשמו תנועות')).toBeInTheDocument();
  });

  it('keeps successful sections visible when a secondary request fails', async () => {
    getTasks.mockRejectedValue(new Error('tasks unavailable'));
    renderDashboard();

    expect(await screen.findByText('המטלות לא נטענו')).toBeInTheDocument();
    expect(screen.getByText('+₪12,000')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'הכנסות והוצאות' })).toBeInTheDocument();
    expect(screen.queryByText('אין מטלות פתוחות')).not.toBeInTheDocument();
  });

  it('retries only the failed secondary section', async () => {
    const user = userEvent.setup();
    getTasks
      .mockRejectedValueOnce(new Error('tasks unavailable'))
      .mockResolvedValueOnce({
        data: [{ id: 7, title: 'בדיקת חיוב', status: 'open', priority: 'high' }],
      });
    renderDashboard();

    await user.click(await screen.findByRole('button', { name: 'ניסיון נוסף' }));
    expect(await screen.findByText('בדיקת חיוב')).toBeInTheDocument();
    expect(getTasks).toHaveBeenCalledTimes(2);
    expect(getTransactions).toHaveBeenCalledTimes(1);
  });

  it('uses a page-level error only when every Dashboard request fails', async () => {
    const failure = new Error('dashboard unavailable');
    getTransactions.mockRejectedValue(failure);
    getAllLoans.mockRejectedValue(failure);
    getBudgetsByMonth.mockRejectedValue(failure);
    getTasks.mockRejectedValue(failure);
    getDashboardSummary.mockRejectedValue(failure);
    getDashboardMonthlySeries.mockRejectedValue(failure);

    renderDashboard();
    expect(await screen.findByText('טעינת לוח הבקרה נכשלה')).toBeInTheDocument();
  });
});

describe('Dashboard widget semantics', () => {
  it('renders actual task status, priority, date, and current counts', async () => {
    getTasks.mockResolvedValue({
      data: [{
        id: 1,
        title: 'תשלום ארנונה',
        status: 'in_progress',
        priority: 'urgent',
        due_date: '2099-08-10',
      }],
    });
    renderDashboard();

    expect(await screen.findByText('תשלום ארנונה')).toBeInTheDocument();
    expect(screen.getByText('בתהליך')).toBeInTheDocument();
    expect(screen.getByText('עדיפות דחוף')).toBeInTheDocument();
    expect(screen.getByText('10.08.2099')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByLabelText('סיכום מטלות נוכחי')).toHaveTextContent('1פתוחות0באיחור');
  });

  it('provides accessible loan and over-budget progress values', async () => {
    getAllLoans.mockResolvedValue({
      data: [{
        id: 1,
        name: 'הלוואת רכב',
        original_amount: 100000,
        current_balance: 60000,
        monthly_payment: 1800,
      }],
    });
    getBudgetsByMonth.mockResolvedValue({
      data: [{
        id: 2,
        amount: 1000,
        actual_spent: 1250,
        categories: { name: 'פנאי', icon: '🎟️' },
      }],
    });
    renderDashboard();

    const loanProgress = await screen.findByRole('progressbar', { name: 'החזר קרן עבור הלוואת רכב' });
    expect(loanProgress).toHaveAttribute('aria-valuenow', '40');
    expect(loanProgress).toHaveAttribute('aria-valuetext', '40% מהקרן נפרעו');

    const budgetProgressBar = screen.getByRole('progressbar', { name: 'ניצול התקציב עבור פנאי' });
    expect(budgetProgressBar).toHaveAttribute('aria-valuenow', '125');
    expect(budgetProgressBar).toHaveAttribute('aria-valuetext', '125% ניצול, חריגה');
    expect(screen.getByText(/חריגה של ₪250/)).toBeInTheDocument();
  });

  it('renders at most five latest transactions with bidi-safe values and a meaningful link', async () => {
    getTransactions.mockResolvedValue({
      data: {
        data: Array.from({ length: 6 }, (_, index) => ({
          id: index + 1,
          description: `תנועה ${index + 1}`,
          transaction_date: `2026-08-0${index + 1}`,
          total_amount: index + 10,
          movement_type: index === 0 ? 'income' : 'expense',
          categories: { name: 'כללי' },
          payment_sources: { name: 'ויזה 4821' },
        })),
      },
    });
    renderDashboard();

    const section = (await screen.findByRole('heading', { name: 'התנועות האחרונות' })).closest('section');
    expect(within(section).getAllByRole('listitem')).toHaveLength(5);
    expect(within(section).getByText('+₪10')).toHaveAttribute('dir', 'ltr');
    expect(within(section).getAllByText(/2026/)[0]).toHaveAttribute('dir', 'ltr');
    expect(within(section).getByRole('link', { name: 'לכל התנועות' })).toHaveAttribute('href', '/transactions');
  });

  it('provides textual chart context alongside the real series', async () => {
    renderDashboard();

    expect(await screen.findByRole('img', { name: 'הכנסות והוצאות בששת החודשים האחרונים' })).toBeInTheDocument();
    expect(screen.getByText(/תרשים עמודות של הכנסות והוצאות בפועל/)).toBeInTheDocument();
    expect(screen.getByText(/מרץ \(2026-03\): הכנסות 100, הוצאות 50/)).toBeInTheDocument();
  });
});
