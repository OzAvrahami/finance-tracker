import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import Transactions from './Transactions';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import { getTransactions, getCategories, getPaymentSources, deleteTransaction } from '../../services/api';

vi.mock('../../services/api', () => ({
  getTransactions: vi.fn(),
  getCategories: vi.fn(),
  getPaymentSources: vi.fn(),
  deleteTransaction: vi.fn(),
}));

/** Builds a transaction row in the shape the API returns. */
function row(id, date, overrides = {}) {
  return {
    id,
    transaction_date: date,
    description: `תנועה ${id}`,
    movement_type: 'expense',
    total_amount: 100,
    category_id: 1,
    payment_source_id: 10,
    notes: null,
    categories: { name: 'מזון', icon: '🍎' },
    payment_sources: { id: 10, name: 'ויזה' },
    ...overrides,
  };
}

function page(
  rows,
  {
    hasMore = false,
    nextCursor = null,
    totals,
    sortBy = 'transaction_date',
    sortDirection = 'desc',
  } = {}
) {
  return {
    data: {
      data: rows,
      // nextCursor is an opaque server-issued string. The component must echo
      // it back untouched; it must never build one from row fields.
      pagination: { limit: 100, hasMore, sortBy, sortDirection, nextCursor },
      ...(totals ? { totals } : {}),
    },
  };
}

/** A stand-in for a server-issued opaque cursor. */
const CURSOR = (n = 1) => `opaque-cursor-token-${n}`;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const setPageHeader = vi.fn();

function renderPage(initialEntries = ['/transactions']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <PageHeaderContext.Provider value={{ setPageHeader }}>
        <Transactions />
      </PageHeaderContext.Provider>
    </MemoryRouter>
  );
}

/** The params of the Nth call to getTransactions. */
const callArgs = (n) => getTransactions.mock.calls[n][0];

/**
 * Renders and waits for the first page to finish loading.
 *
 * getTransactions is invoked synchronously by the effect, so asserting on the
 * call count alone would pass while the component is still showing its initial
 * loading state and the filter bar has not rendered yet.
 */
async function renderAndSettle() {
  const result = renderPage();
  await waitFor(() => expect(getTransactions).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByRole('status', { name: 'טוען תנועות' })).not.toBeInTheDocument());
  return result;
}

const transactionsTable = () => screen.getByRole('table', { name: 'תנועות שנטענו מתוך התוצאות המסוננות' });
const tableText = (text) => within(transactionsTable()).getByText(text);
const findTableText = async (text) => within(await screen.findByRole('table')).findByText(text);
const summary = () => screen.getByRole('region', { name: 'סיכום מלא של התוצאות המסוננות' });

function bodyRowIds() {
  const rows = screen.getAllByRole('row');
  // Skip the header row; each data row starts with a date cell.
  return rows.slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent);
}

beforeEach(() => {
  vi.resetAllMocks();
  getCategories.mockResolvedValue({ data: [{ id: 1, name: 'מזון', icon: '🍎' }] });
  getPaymentSources.mockResolvedValue({ data: [{ id: 10, name: 'ויזה' }] });
  getTransactions.mockResolvedValue(
    page([row(1, '2026-08-02')], { totals: { count: 1, income: 0, expense: 100 } })
  );
});

describe('initial load', () => {
  it('requests one bounded page, not the whole history', async () => {
    getTransactions.mockResolvedValue(page([row(1, '2026-08-02')], { totals: { count: 1, income: 0, expense: 100 } }));
    renderPage();

    await waitFor(() => expect(getTransactions).toHaveBeenCalled());
    const params = callArgs(0);
    expect(params.limit).toBe(100);
    expect(params.cursor).toBeUndefined();
  });

  it('defaults the date filter to the current month', async () => {
    renderPage();
    await waitFor(() => expect(getTransactions).toHaveBeenCalled());

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const expectedFrom = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;

    const params = callArgs(0);
    expect(params.from).toBe(expectedFrom);
    expect(params.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('uses the approved subtitle and shows the default period as non-removable context', async () => {
    await renderAndSettle();

    expect(setPageHeader).toHaveBeenCalledWith({
      title: 'תנועות',
      subtitle: 'ספר החשבונות המלא — סינון, מיון וטעינה מתגלגלת',
    });
    const filterContext = screen.getByLabelText('מסננים פעילים');
    expect(within(filterContext).getByText(/^תקופה:/)).toBeInTheDocument();
    expect(within(filterContext).queryByRole('button', { name: /הסרת המסנן.*תקופה/ }))
      .not.toBeInTheDocument();
  });

  it('asks for totals so the summary bar covers the whole filtered set', async () => {
    renderPage();
    await waitFor(() => expect(getTransactions).toHaveBeenCalled());
    expect(callArgs(0).includeTotals).toBe(true);
  });

  it('renders server-provided totals rather than summing the loaded page', async () => {
    // 2 rows loaded, but the filter matches 900 transactions. The summary must
    // report the server's totals, not the page's.
    getTransactions.mockResolvedValue(
      page([row(1, '2026-08-02'), row(2, '2026-08-01')], {
        hasMore: true,
        nextCursor: CURSOR(2),
        totals: { count: 900, income: 5000, expense: 1234 },
      })
    );
    renderPage();

    const totalsRegion = await screen.findByRole('region', { name: 'סיכום מלא של התוצאות המסוננות' });
    expect(within(totalsRegion).getByText('900')).toBeInTheDocument();
    expect(within(summary()).getByText('₪5,000')).toBeInTheDocument();
    expect(within(summary()).getByText('₪1,234')).toBeInTheDocument();
  });

  it('shows the empty state when nothing matches', async () => {
    getTransactions.mockResolvedValue(page([], { totals: { count: 0, income: 0, expense: 0 } }));
    renderPage();
    expect(await screen.findByText('אין תנועות שמתאימות למסננים')).toBeInTheDocument();
  });

  it('shows an error state when the first page fails', async () => {
    getTransactions.mockRejectedValue(new Error('network down'));
    renderPage();
    expect(await screen.findByText('טעינת התנועות נכשלה')).toBeInTheDocument();
  });
});

describe('pagination', () => {
  it('appends the next page and passes the cursor', async () => {
    const user = userEvent.setup();
    getTransactions
      .mockResolvedValueOnce(
        page([row(1, '2026-08-02'), row(2, '2026-08-01')], {
          hasMore: true,
          nextCursor: CURSOR(2),
          totals: { count: 4, income: 0, expense: 400 },
        })
      )
      .mockResolvedValueOnce(page([row(3, '2026-07-30'), row(4, '2026-07-29')]));

    renderPage();
    const button = await screen.findByRole('button', { name: 'טען תנועות נוספות' });
    await user.click(button);

    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));
    expect(callArgs(1).cursor).toBe(CURSOR(2));

    await waitFor(() => expect(bodyRowIds()).toHaveLength(4));
  });

  it('reaches transactions older than April 2026 by walking the cursor', async () => {
    const user = userEvent.setup();
    getTransactions
      .mockResolvedValueOnce(
        page([row(1, '2026-08-02')], {
          hasMore: true,
          nextCursor: CURSOR(1),
          totals: { count: 3, income: 0, expense: 300 },
        })
      )
      .mockResolvedValueOnce(
        page([row(2, '2026-04-09')], {
          hasMore: true,
          nextCursor: CURSOR(2),
        })
      )
      // The row the old 1000-row truncation made unreachable.
      .mockResolvedValueOnce(page([row(3, '2023-11-27')]));

    renderPage();

    await user.click(await screen.findByRole('button', { name: 'טען תנועות נוספות' }));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));

    await user.click(await screen.findByRole('button', { name: 'טען תנועות נוספות' }));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(3));

    expect(callArgs(2).cursor).toBe(CURSOR(2));
    expect(await findTableText('27.11.2023')).toBeInTheDocument();
  });

  it('never renders a duplicate transaction id', async () => {
    const user = userEvent.setup();
    getTransactions
      .mockResolvedValueOnce(
        page([row(1, '2026-08-02'), row(2, '2026-08-01')], {
          hasMore: true,
          nextCursor: CURSOR(2),
          totals: { count: 3, income: 0, expense: 300 },
        })
      )
      // A misbehaving page that repeats a row already loaded.
      .mockResolvedValueOnce(page([row(2, '2026-08-01'), row(3, '2026-07-30')]));

    renderPage();
    await user.click(await screen.findByRole('button', { name: 'טען תנועות נוספות' }));

    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(bodyRowIds()).toHaveLength(3));
  });

  it('hides the control and reports the end of history when hasMore is false', async () => {
    getTransactions.mockResolvedValue(
      page([row(1, '2026-08-02')], { hasMore: false, totals: { count: 1, income: 0, expense: 100 } })
    );
    renderPage();

    expect(await screen.findByText('הגעת לסוף ההיסטוריה')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'טען תנועות נוספות' })).not.toBeInTheDocument();
  });

  it('surfaces a next-page error while keeping the rows already loaded', async () => {
    const user = userEvent.setup();
    getTransactions
      .mockResolvedValueOnce(
        page([row(1, '2026-08-02')], {
          hasMore: true,
          nextCursor: CURSOR(1),
          totals: { count: 2, income: 0, expense: 200 },
        })
      )
      .mockRejectedValueOnce(new Error('boom'));

    renderPage();
    await user.click(await screen.findByRole('button', { name: 'טען תנועות נוספות' }));

    expect(await screen.findByText('טעינת המשך הרשימה נכשלה')).toBeInTheDocument();
    // The already-loaded page must survive a failed "load more".
    expect(bodyRowIds()).toHaveLength(1);
    expect(await screen.findByRole('button', { name: 'נסה שוב' })).toBeInTheDocument();
  });
});

describe('filter changes', () => {
  it('clears loaded rows and the cursor, then requests a fresh first page', async () => {
    const user = userEvent.setup();
    getTransactions.mockResolvedValue(
      page([row(1, '2026-08-02')], {
        hasMore: true,
        nextCursor: CURSOR(1),
        totals: { count: 1, income: 0, expense: 100 },
      })
    );

    renderPage();
    await findTableText('2.8.2026');

    await user.click(screen.getByRole('switch', { name: 'רק תנועות ללא קטגוריה' }));

    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));
    const params = callArgs(1);
    expect(params.uncategorizedOnly).toBe(true);
    // A fresh filter must start from the top, never from the previous cursor.
    expect(params.cursor).toBeUndefined();
    expect(params.includeTotals).toBe(true);
  });

  it('sends no date bounds after the "all" preset, so full history is reachable', async () => {
    const user = userEvent.setup();
    await renderAndSettle();

    await user.click(screen.getByRole('button', { name: 'כל ההיסטוריה' }));

    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));
    const params = callArgs(1);
    expect(params.from).toBeUndefined();
    expect(params.to).toBeUndefined();
  });

  it('does not show results belonging to a previous filter', async () => {
    const user = userEvent.setup();
    let resolveSecond;
    getTransactions
      .mockResolvedValueOnce(
        page([row(1, '2026-08-02')], { totals: { count: 1, income: 0, expense: 100 } })
      )
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    renderPage();
    await findTableText('2.8.2026');

    await user.click(screen.getByRole('switch', { name: 'רק תנועות ללא קטגוריה' }));

    // While the new filter is in flight the old row must already be gone.
    await waitFor(() => expect(screen.queryByRole('table')).not.toBeInTheDocument());
    expect(screen.getByRole('status', { name: 'טוען תנועות' })).toBeInTheDocument();

    await act(async () => {
      resolveSecond(page([row(9, '2026-07-01')], { totals: { count: 1, income: 0, expense: 100 } }));
    });
    expect(await findTableText('1.7.2026')).toBeInTheDocument();
  });
});

describe('column sorting', () => {
  const header = (name) => screen.getByRole('columnheader', { name: new RegExp(name) });
  const sortButton = (name) => within(header(name)).getByRole('button');

  it('defaults to newest first, matching the previous behaviour', async () => {
    await renderAndSettle();
    const params = callArgs(0);
    expect(params.sortBy).toBe('transaction_date');
    expect(params.sortDirection).toBe('desc');
    expect(header('תאריך')).toHaveAttribute('aria-sort', 'descending');
  });

  it('exposes exactly the three columns that were sortable before', async () => {
    await renderAndSettle();
    for (const name of ['תאריך', 'תיאור', 'סכום']) {
      expect(header(name)).toHaveAttribute('aria-sort');
    }
    // These never had sorting and must not gain it.
    for (const name of ['קטגוריה', 'אמצעי תשלום', 'הערות', 'פעולות']) {
      expect(header(name)).not.toHaveAttribute('aria-sort');
    }
  });

  it('asks the server to sort; it never reorders the loaded rows itself', async () => {
    const user = userEvent.setup();
    await renderAndSettle();

    await user.click(sortButton('סכום'));

    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));
    expect(callArgs(1).sortBy).toBe('total_amount');
    expect(callArgs(1).sortDirection).toBe('asc');
  });

  it('preserves the original toggle rule', async () => {
    const user = userEvent.setup();
    await renderAndSettle();

    // A newly chosen column starts ascending...
    await user.click(sortButton('תיאור'));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));
    expect(callArgs(1)).toMatchObject({ sortBy: 'description', sortDirection: 'asc' });

    // ...clicking the active ascending column flips it to descending...
    await user.click(sortButton('תיאור'));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(3));
    expect(callArgs(2)).toMatchObject({ sortBy: 'description', sortDirection: 'desc' });

    // ...and clicking it again returns to ascending. There is no third state.
    await user.click(sortButton('תיאור'));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(4));
    expect(callArgs(3)).toMatchObject({ sortBy: 'description', sortDirection: 'asc' });

    // Switching to a different column starts ascending again, even though the
    // previous column was descending.
    await user.click(sortButton('סכום'));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(5));
    expect(callArgs(4)).toMatchObject({ sortBy: 'total_amount', sortDirection: 'asc' });
  });

  it('marks the active column and direction', async () => {
    const user = userEvent.setup();
    await renderAndSettle();

    await user.click(sortButton('סכום'));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));

    expect(header('סכום')).toHaveAttribute('aria-sort', 'ascending');
    expect(header('תאריך')).toHaveAttribute('aria-sort', 'none');

    await user.click(sortButton('סכום'));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(3));
    expect(header('סכום')).toHaveAttribute('aria-sort', 'descending');
  });

  it('resets the loaded pages and the cursor when the sort changes', async () => {
    const user = userEvent.setup();
    getTransactions
      .mockResolvedValueOnce(
        page([row(1, '2026-08-02'), row(2, '2026-08-01')], {
          hasMore: true,
          nextCursor: CURSOR(2),
          totals: { count: 9, income: 0, expense: 900 },
        })
      )
      .mockResolvedValueOnce(page([row(3, '2026-07-30'), row(4, '2026-07-29')]))
      .mockResolvedValue(
        page([row(5, '2026-06-01')], {
          totals: { count: 9, income: 0, expense: 900 },
          sortBy: 'total_amount',
          sortDirection: 'asc',
        })
      );

    renderPage();
    await user.click(await screen.findByRole('button', { name: 'טען תנועות נוספות' }));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(bodyRowIds()).toHaveLength(4));

    await user.click(sortButton('סכום'));

    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(3));
    const params = callArgs(2);
    // A cursor is only valid for the sort that issued it; carrying it over
    // would seek on a key the new ordering does not use. The server rejects it
    // outright, and the client must not send it in the first place.
    expect(params.cursor).toBeUndefined();
    expect(params.includeTotals).toBe(true);
    // The previously appended pages are gone, not re-sorted in place.
    await waitFor(() => expect(bodyRowIds()).toHaveLength(1));
  });

  it('carries the active sort into the next page request', async () => {
    const user = userEvent.setup();
    getTransactions.mockResolvedValue(
      page([row(1, '2026-08-02')], {
        hasMore: true,
        nextCursor: CURSOR(7),
        totals: { count: 9, income: 0, expense: 900 },
        sortBy: 'total_amount',
        sortDirection: 'asc',
      })
    );

    await renderAndSettle();
    await user.click(sortButton('סכום'));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));

    await user.click(await screen.findByRole('button', { name: 'טען תנועות נוספות' }));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(3));

    const params = callArgs(2);
    expect(params.cursor).toBe(CURSOR(7));
    expect(params.sortBy).toBe('total_amount');
    expect(params.sortDirection).toBe('asc');
    // Totals do not change with the sort, so they are not re-requested.
    expect(params.includeTotals).toBeUndefined();
  });

  it('keeps filters applied when the sort changes', async () => {
    const user = userEvent.setup();
    await renderAndSettle();

    await user.click(screen.getByRole('switch', { name: 'רק תנועות ללא קטגוריה' }));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));

    await user.click(sortButton('תיאור'));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(3));

    const params = callArgs(2);
    expect(params.uncategorizedOnly).toBe(true);
    expect(params.sortBy).toBe('description');
  });

  it('ignores a slow response for a sort the user has already changed', async () => {
    const user = userEvent.setup();
    let resolveStale;

    getTransactions
      .mockResolvedValueOnce(
        page([row(1, '2026-08-02')], { totals: { count: 1, income: 0, expense: 100 } })
      )
      .mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }))
      .mockResolvedValueOnce(
        page([row(42, '2026-07-01')], { totals: { count: 1, income: 0, expense: 100 } })
      );

    await renderAndSettle();

    await user.click(sortButton('סכום'));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));

    await user.selectOptions(screen.getByRole('combobox', { name: 'מיון הרשימה' }), 'description:asc');
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(3));

    expect(await findTableText('1.7.2026')).toBeInTheDocument();

    await act(async () => {
      resolveStale(
        page([row(999, '2020-01-01')], { totals: { count: 1, income: 0, expense: 999 } })
      );
    });

    expect(within(transactionsTable()).queryByText('1.1.2020')).not.toBeInTheDocument();
    expect(tableText('1.7.2026')).toBeInTheDocument();
  });
});

describe('stale response protection', () => {
  it('ignores a slow response for a filter the user has already changed', async () => {
    const user = userEvent.setup();
    let resolveStale;

    getTransactions
      .mockResolvedValueOnce(page([], { totals: { count: 0, income: 0, expense: 0 } }))
      // Second call (first filter change) never settles until we say so.
      .mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }))
      .mockResolvedValueOnce(
        page([row(42, '2026-07-01')], { totals: { count: 1, income: 0, expense: 100 } })
      );

    await renderAndSettle();

    await user.click(screen.getByRole('switch', { name: 'רק תנועות ללא קטגוריה' }));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole('switch', { name: 'רק תנועות ללא קטגוריה' }));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(3));

    expect(await findTableText('1.7.2026')).toBeInTheDocument();

    // The stale first request lands last, carrying data for a filter that is no
    // longer active. It must not overwrite the newer result.
    await act(async () => {
      resolveStale(
        page([row(999, '2020-01-01')], { totals: { count: 1, income: 0, expense: 999 } })
      );
    });

    expect(within(transactionsTable()).queryByText('1.1.2020')).not.toBeInTheDocument();
    expect(tableText('1.7.2026')).toBeInTheDocument();
  });
});

describe('search debounce', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('issues one request for a burst of keystrokes', async () => {
    // Deliberately on real timers: userEvent's internal keystroke scheduling
    // deadlocks against a frozen clock, and the 300ms debounce is short enough
    // to wait out honestly.
    const user = userEvent.setup();
    await renderAndSettle();

    const input = screen.getByRole('searchbox', { name: 'חיפוש תנועות' });
    await user.type(input, 'קפה');

    // Three keystrokes must not produce three requests.
    expect(getTransactions).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(callArgs(1).search).toBe('קפה');

    // And the burst collapsed into exactly one extra request, not one per key.
    expect(getTransactions).toHaveBeenCalledTimes(2);
  });

  it('applies dropdown and preset changes immediately', async () => {
    const user = userEvent.setup();
    await renderAndSettle();

    await user.click(screen.getByRole('button', { name: 'החודש הקודם' }));

    // No debounce on a discrete choice.
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));
  });
});

describe('delete', () => {
  it('removes the row and keeps the totals consistent', async () => {
    const user = userEvent.setup();
    deleteTransaction.mockResolvedValue({});

    getTransactions.mockResolvedValue(
      page([row(1, '2026-08-02', { total_amount: 250 }), row(2, '2026-08-01')], {
        totals: { count: 2, income: 0, expense: 350 },
      })
    );

    renderPage();
    const firstDate = await findTableText('2.8.2026');

    await user.click(within(firstDate.closest('tr')).getByRole('button', { name: /מחיקת התנועה/ }));
    const dialog = screen.getByRole('dialog', { name: 'מחיקת תנועה' });
    await user.click(within(dialog).getByRole('button', { name: 'מחיקת התנועה' }));

    await waitFor(() => expect(deleteTransaction).toHaveBeenCalledWith(1));
    await waitFor(() => expect(within(transactionsTable()).queryByText('2.8.2026')).not.toBeInTheDocument());

    // 350 - 250 = 100, and the count drops by one.
    expect(within(summary()).getByText('₪100')).toBeInTheDocument();
    expect(within(summary()).getByText('1')).toBeInTheDocument();
  });
});

describe('Finance v3 filter experience', () => {
  it('preserves all approved date presets and their inclusive request bounds', async () => {
    const user = userEvent.setup();
    await renderAndSettle();

    await user.click(screen.getByRole('button', { name: 'כל ההיסטוריה' }));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));
    expect(callArgs(1)).toMatchObject({ from: undefined, to: undefined });

    await user.click(screen.getByRole('button', { name: 'החודש הקודם' }));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(3));
    const previousMonth = new Date();
    previousMonth.setMonth(previousMonth.getMonth() - 1, 1);
    const expectedPreviousMonth = {
      from: `${previousMonth.getFullYear()}-${String(previousMonth.getMonth() + 1).padStart(2, '0')}-01`,
      to: `${previousMonth.getFullYear()}-${String(previousMonth.getMonth() + 1).padStart(2, '0')}-${String(new Date(previousMonth.getFullYear(), previousMonth.getMonth() + 1, 0).getDate()).padStart(2, '0')}`,
    };
    expect(callArgs(2)).toMatchObject(expectedPreviousMonth);

    await user.click(screen.getByRole('button', { name: 'החודש הנוכחי' }));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(4));
    expect(callArgs(3).from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(callArgs(3).to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('applies custom inclusive dates, category, and payment source without changing API parameters', async () => {
    await renderAndSettle();

    fireEvent.change(screen.getByLabelText('מתאריך'), { target: { value: '2026-07-03' } });
    fireEvent.change(screen.getByLabelText('עד תאריך'), { target: { value: '2026-07-19' } });
    fireEvent.change(screen.getByLabelText('קטגוריה'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('אמצעי תשלום'), { target: { value: '10' } });

    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(5));
    expect(callArgs(4)).toMatchObject({
      from: '2026-07-03',
      to: '2026-07-19',
      categoryId: '1',
      paymentSourceId: '10',
    });
    expect(screen.getByLabelText('מסננים פעילים')).toHaveTextContent('טווח:');
  });

  it('removes one active-filter chip without changing the others', async () => {
    const user = userEvent.setup();
    await renderAndSettle();

    await user.selectOptions(screen.getByLabelText('קטגוריה'), '1');
    await user.selectOptions(screen.getByLabelText('אמצעי תשלום'), '10');
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(3));

    await user.click(screen.getByRole('button', { name: 'הסרת המסנן קטגוריה מזון' }));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(4));
    expect(callArgs(3)).toMatchObject({ categoryId: 'all', paymentSourceId: '10' });
    expect(screen.getByLabelText('מסננים פעילים')).toHaveTextContent('אמצעי תשלום: ויזה');
  });

  it('reset restores current month, clears all filters, and restores the default sort', async () => {
    const user = userEvent.setup();
    await renderAndSettle();

    await user.click(within(screen.getByRole('columnheader', { name: /סכום/ })).getByRole('button'));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));
    await user.selectOptions(screen.getByLabelText('קטגוריה'), '1');
    await user.selectOptions(screen.getByLabelText('אמצעי תשלום'), '10');
    await user.click(screen.getByRole('switch', { name: 'רק תנועות ללא קטגוריה' }));
    await user.click(screen.getByRole('button', { name: 'כל ההיסטוריה' }));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(6));

    await user.click(screen.getAllByRole('button', { name: 'איפוס' })[0]);
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(7));
    const resetParams = callArgs(6);
    expect(resetParams).toMatchObject({
      categoryId: 'all',
      paymentSourceId: 'all',
      uncategorizedOnly: false,
      search: '',
      sortBy: 'transaction_date',
      sortDirection: 'desc',
    });
    expect(resetParams.from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(screen.getByRole('switch', { name: 'רק תנועות ללא קטגוריה' })).toHaveAttribute('aria-checked', 'false');
    const resetContext = screen.getByLabelText('מסננים פעילים');
    expect(within(resetContext).getByText(/^תקופה:/)).toBeInTheDocument();
    expect(within(resetContext).queryByRole('button', { name: /הסרת המסנן/ })).not.toBeInTheDocument();
  });

  it('opens the mobile BottomSheet with the real immediate filters and active count', async () => {
    const user = userEvent.setup();
    await renderAndSettle();

    const trigger = screen.getByRole('button', { name: 'מסננים' });
    await user.click(trigger);
    const sheet = screen.getByRole('dialog', { name: 'סינון תנועות' });
    expect(within(sheet).getByLabelText('מתאריך')).toBeInTheDocument();
    expect(within(sheet).getByLabelText('עד תאריך')).toBeInTheDocument();
    expect(within(sheet).getByLabelText('קטגוריה')).toBeInTheDocument();
    expect(within(sheet).getByLabelText('אמצעי תשלום')).toBeInTheDocument();
    expect(within(sheet).getByRole('searchbox', { name: 'חיפוש תנועות' })).toBeInTheDocument();

    await user.click(within(sheet).getByRole('button', { name: 'החודש הקודם' }));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('1 מסננים פעילים')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'סיום' }));
    expect(screen.queryByRole('dialog', { name: 'סינון תנועות' })).not.toBeInTheDocument();
  });

  it('does not expose unapproved filters or actions', async () => {
    await renderAndSettle();
    expect(screen.queryByRole('button', { name: /השנה/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ייצוא|פעולה קבוצתית/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });
});

describe('Finance v3 states and progressive loading', () => {
  it('retries an initial failure without showing false totals', async () => {
    const user = userEvent.setup();
    getTransactions
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page([row(9, '2026-08-04')], { totals: { count: 1, income: 0, expense: 100 } }));

    renderPage();
    expect(await screen.findByText('טעינת התנועות נכשלה')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'סיכום מלא של התוצאות המסוננות' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'נסה שוב' }));
    expect(await findTableText('4.8.2026')).toBeInTheDocument();
    expect(getTransactions).toHaveBeenCalledTimes(2);
  });

  it('distinguishes a truly empty all-history dataset from a filtered empty state', async () => {
    const user = userEvent.setup();
    getTransactions.mockResolvedValue(page([], { totals: { count: 0, income: 0, expense: 0 } }));
    renderPage();
    expect(await screen.findByText('אין תנועות שמתאימות למסננים')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'כל ההיסטוריה' }));
    expect(await screen.findByText('אין תנועות במערכת')).toBeInTheDocument();
  });

  it('keeps rows visible while loading more and retries the same continuation after failure', async () => {
    const user = userEvent.setup();
    const append = deferred();
    getTransactions
      .mockResolvedValueOnce(page([row(1, '2026-08-02')], {
        hasMore: true,
        nextCursor: CURSOR(1),
        totals: { count: 2, income: 0, expense: 200 },
      }))
      .mockImplementationOnce(() => append.promise)
      .mockResolvedValueOnce(page([row(2, '2026-08-01')]));

    renderPage();
    await user.click(await screen.findByRole('button', { name: 'טען תנועות נוספות' }));
    expect(tableText('2.8.2026')).toBeInTheDocument();
    expect(screen.getByText('טוען תנועות נוספות…')).toBeInTheDocument();

    await act(async () => append.reject(new Error('append failed')));
    expect(await screen.findByText('טעינת המשך הרשימה נכשלה')).toBeInTheDocument();
    expect(tableText('2.8.2026')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'נסה שוב' }));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(3));
    expect(callArgs(2).cursor).toBe(CURSOR(1));
    expect(await findTableText('1.8.2026')).toBeInTheDocument();
  });
});

describe('Finance v3 responsive parity and sorting', () => {
  it('renders the same fields and actions in the desktop table and mobile card list', async () => {
    getTransactions.mockResolvedValue(page([
      row(7, '2026-08-03', {
        description: 'Coffee & קפה ארוך',
        total_amount: '42.50',
        notes: 'הערה מפורטת mixed note',
      }),
    ], { totals: { count: 1, income: 0, expense: 42.5 } }));

    renderPage();
    const table = await screen.findByRole('table');
    const card = screen.getByRole('article', { name: 'תנועה: Coffee & קפה ארוך' });
    for (const text of ['Coffee & קפה ארוך', 'מזון', 'ויזה', 'הערה מפורטת mixed note', '3.8.2026']) {
      expect(within(table).getByText(text)).toBeInTheDocument();
      expect(within(card).getByText(text, { exact: false })).toBeInTheDocument();
    }
    expect(within(table).getByRole('link', { name: /עריכת התנועה/ })).toHaveAttribute('href', '/edit-transaction/7');
    expect(within(card).getByRole('link', { name: /עריכת התנועה/ })).toHaveAttribute('href', '/edit-transaction/7');
    expect(within(table).getByRole('button', { name: /מחיקת התנועה/ })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /מחיקת התנועה/ })).toBeInTheDocument();
  });

  it('locks all desktop headers and values to the same seven-column table model', async () => {
    renderPage();
    const table = await screen.findByRole('table');
    expect(table.querySelectorAll('colgroup col')).toHaveLength(7);
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'תאריך', 'קטגוריה', 'תיאור', 'אמצעי תשלום', 'סכום', 'הערות', 'פעולות',
    ]);

    const cells = within(table).getAllByRole('row')[1].querySelectorAll('td');
    expect(cells).toHaveLength(7);
    expect(cells[0]).toHaveClass('transactions-table__date');
    expect(cells[1]).toHaveClass('transactions-table__category');
    expect(cells[2]).toHaveClass('transactions-table__description');
    expect(cells[3]).toHaveClass('transactions-table__source');
    expect(cells[4]).toHaveClass('transactions-table__amount');
    expect(cells[4]).toHaveAttribute('dir', 'ltr');
    expect(cells[5]).toHaveClass('transactions-table__notes');
    expect(cells[6]).toHaveClass('transactions-table__actions-cell');
  });

  it('uses category_id null—not a missing joined label—for uncategorized treatment', async () => {
    getTransactions.mockResolvedValue(page([
      row(1, '2026-08-02', { category_id: null, categories: { name: 'should not win', icon: 'X' } }),
      row(2, '2026-08-01', { category_id: 2, categories: null }),
    ], { totals: { count: 2, income: 0, expense: 200 } }));
    renderPage();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('ללא קטגוריה')).toBeInTheDocument();
    expect(within(table).getByText('קטגוריה לא זמינה')).toBeInTheDocument();
    expect(within(table).getAllByRole('row')[1]).toHaveClass('is-uncategorized');
    expect(within(table).getAllByRole('row')[2]).not.toHaveClass('is-uncategorized');
  });

  it('mobile sorting updates the same server sort state and restarts the cursor', async () => {
    const user = userEvent.setup();
    await renderAndSettle();
    await user.selectOptions(screen.getByRole('combobox', { name: 'מיון הרשימה' }), 'total_amount:desc');
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));
    expect(callArgs(1)).toMatchObject({ sortBy: 'total_amount', sortDirection: 'desc' });
    expect(callArgs(1).cursor).toBeUndefined();
    expect(callArgs(1).includeTotals).toBe(true);
  });

  it('supports date ascending and descending through the server-owned sort', async () => {
    const user = userEvent.setup();
    await renderAndSettle();
    const dateHeader = screen.getByRole('columnheader', { name: /תאריך/ });
    await user.click(within(dateHeader).getByRole('button'));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));
    expect(callArgs(1)).toMatchObject({ sortBy: 'transaction_date', sortDirection: 'asc' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'מיון הרשימה' }), 'transaction_date:desc');
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(3));
    expect(callArgs(2)).toMatchObject({ sortBy: 'transaction_date', sortDirection: 'desc' });
  });
});

describe('Finance v3 delete confirmation', () => {
  const openDeleteDialog = async (user) => {
    const date = await findTableText('2.8.2026');
    await user.click(within(date.closest('tr')).getByRole('button', { name: /מחיקת התנועה/ }));
    return screen.getByRole('dialog', { name: 'מחיקת תנועה' });
  };

  it('cancels without calling the delete API', async () => {
    const user = userEvent.setup();
    renderPage();
    const dialog = await openDeleteDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'ביטול' }));
    expect(deleteTransaction).not.toHaveBeenCalled();
    expect(tableText('2.8.2026')).toBeInTheDocument();
  });

  it('leaves the row and totals unchanged and shows feedback when deletion fails', async () => {
    const user = userEvent.setup();
    deleteTransaction.mockRejectedValue(new Error('denied'));
    renderPage();
    const dialog = await openDeleteDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'מחיקת התנועה' }));

    expect(await within(dialog).findByText('מחיקת התנועה נכשלה. הרשומה והסיכומים לא השתנו.')).toBeInTheDocument();
    expect(tableText('2.8.2026')).toBeInTheDocument();
    expect(within(summary()).getByText('1')).toBeInTheDocument();
    expect(within(summary()).getByText('₪100')).toBeInTheDocument();
  });

  it('prevents duplicate confirmation while deletion is pending', async () => {
    const user = userEvent.setup();
    const deletion = deferred();
    deleteTransaction.mockImplementation(() => deletion.promise);
    renderPage();
    const dialog = await openDeleteDialog(user);
    const confirm = within(dialog).getByRole('button', { name: 'מחיקת התנועה' });
    await user.click(confirm);
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(deleteTransaction).toHaveBeenCalledTimes(1);
    await act(async () => deletion.resolve({}));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'מחיקת תנועה' })).not.toBeInTheDocument());
  });
});

describe('Budget deep-link filters', () => {
  it('hydrates the canonical month and category filters from the URL', async () => {
    getTransactions.mockResolvedValue(page([]));
    getCategories.mockResolvedValue({ data: [{ id: 7, name: 'מנוי', type: 'expense' }] });
    getPaymentSources.mockResolvedValue({ data: [] });
    renderPage(['/transactions?month=2026-08&categoryId=7']);
    await waitFor(() => expect(getTransactions).toHaveBeenCalled());
    expect(callArgs(0)).toEqual(expect.objectContaining({
      from: '2026-08-01', to: '2026-08-31', categoryId: '7', uncategorizedOnly: false,
    }));
  });

  it('hydrates the existing uncategorized-only filter without creating a budget', async () => {
    getTransactions.mockResolvedValue(page([]));
    getCategories.mockResolvedValue({ data: [] });
    getPaymentSources.mockResolvedValue({ data: [] });
    renderPage(['/transactions?month=2026-08&uncategorized=1']);
    await waitFor(() => expect(getTransactions).toHaveBeenCalled());
    expect(callArgs(0)).toEqual(expect.objectContaining({
      from: '2026-08-01', to: '2026-08-31', categoryId: 'all', uncategorizedOnly: true,
    }));
  });
});
