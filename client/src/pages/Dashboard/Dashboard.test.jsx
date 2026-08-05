import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
    expect(await screen.findByText('סקירה כללית')).toBeInTheDocument();
  });
});
