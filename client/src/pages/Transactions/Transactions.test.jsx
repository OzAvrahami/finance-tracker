import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
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

const setPageHeader = vi.fn();

function renderPage() {
  return render(
    <MemoryRouter>
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
  await screen.findByRole('button', { name: 'הכל' });
  return result;
}

function bodyRowIds() {
  const rows = screen.getAllByRole('row');
  // Skip the header row; each data row starts with a date cell.
  return rows.slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent);
}

beforeEach(() => {
  vi.clearAllMocks();
  getCategories.mockResolvedValue({ data: [{ id: 1, name: 'מזון', icon: '🍎' }] });
  getPaymentSources.mockResolvedValue({ data: [{ id: 10, name: 'ויזה' }] });
  getTransactions.mockResolvedValue(page([]));
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

    expect(await screen.findByText('900')).toBeInTheDocument();
    expect(screen.getByText('₪5,000')).toBeInTheDocument();
    expect(screen.getByText('₪1,234')).toBeInTheDocument();
  });

  it('shows the empty state when nothing matches', async () => {
    getTransactions.mockResolvedValue(page([], { totals: { count: 0, income: 0, expense: 0 } }));
    renderPage();
    expect(await screen.findByText(/לא נמצאו תנועות/)).toBeInTheDocument();
  });

  it('shows an error state when the first page fails', async () => {
    getTransactions.mockRejectedValue(new Error('network down'));
    renderPage();
    expect(await screen.findByText('שגיאה בטעינת התנועות')).toBeInTheDocument();
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
    expect(await screen.findByText('27.11.2023')).toBeInTheDocument();
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

    expect(await screen.findByText('הוצגו כל התנועות')).toBeInTheDocument();
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

    expect(await screen.findByText('שגיאה בטעינת תנועות נוספות')).toBeInTheDocument();
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
    await screen.findByText('2.8.2026');

    await user.click(screen.getByRole('button', { name: 'ללא קטגוריה' }));

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

    await user.click(screen.getByRole('button', { name: 'הכל' }));

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
    await screen.findByText('2.8.2026');

    await user.click(screen.getByRole('button', { name: 'ללא קטגוריה' }));

    // While the new filter is in flight the old row must already be gone.
    await waitFor(() => expect(screen.queryByText('2.8.2026')).not.toBeInTheDocument());
    expect(screen.getByText('טוען תנועות...')).toBeInTheDocument();

    await act(async () => {
      resolveSecond(page([row(9, '2026-07-01')], { totals: { count: 1, income: 0, expense: 100 } }));
    });
    expect(await screen.findByText('1.7.2026')).toBeInTheDocument();
  });
});

describe('column sorting', () => {
  const header = (name) => screen.getByRole('columnheader', { name: new RegExp(name) });

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

    await user.click(header('סכום'));

    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));
    expect(callArgs(1).sortBy).toBe('total_amount');
    expect(callArgs(1).sortDirection).toBe('asc');
  });

  it('preserves the original toggle rule', async () => {
    const user = userEvent.setup();
    await renderAndSettle();

    // A newly chosen column starts ascending...
    await user.click(header('תיאור'));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));
    expect(callArgs(1)).toMatchObject({ sortBy: 'description', sortDirection: 'asc' });

    // ...clicking the active ascending column flips it to descending...
    await user.click(header('תיאור'));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(3));
    expect(callArgs(2)).toMatchObject({ sortBy: 'description', sortDirection: 'desc' });

    // ...and clicking it again returns to ascending. There is no third state.
    await user.click(header('תיאור'));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(4));
    expect(callArgs(3)).toMatchObject({ sortBy: 'description', sortDirection: 'asc' });

    // Switching to a different column starts ascending again, even though the
    // previous column was descending.
    await user.click(header('סכום'));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(5));
    expect(callArgs(4)).toMatchObject({ sortBy: 'total_amount', sortDirection: 'asc' });
  });

  it('marks the active column and direction', async () => {
    const user = userEvent.setup();
    await renderAndSettle();

    await user.click(header('סכום'));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));

    expect(header('סכום')).toHaveAttribute('aria-sort', 'ascending');
    expect(header('תאריך')).toHaveAttribute('aria-sort', 'none');

    await user.click(header('סכום'));
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

    await user.click(header('סכום'));

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
    await user.click(header('סכום'));
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

    await user.click(screen.getByRole('button', { name: 'ללא קטגוריה' }));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));

    await user.click(header('תיאור'));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(3));

    const params = callArgs(2);
    expect(params.uncategorizedOnly).toBe(true);
    expect(params.sortBy).toBe('description');
  });

  it('ignores a slow response for a sort the user has already changed', async () => {
    const user = userEvent.setup();
    let resolveStale;

    getTransactions
      .mockResolvedValueOnce(page([], { totals: { count: 0, income: 0, expense: 0 } }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }))
      .mockResolvedValueOnce(
        page([row(42, '2026-07-01')], { totals: { count: 1, income: 0, expense: 100 } })
      );

    await renderAndSettle();

    await user.click(header('סכום'));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));

    await user.click(header('תיאור'));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(3));

    expect(await screen.findByText('1.7.2026')).toBeInTheDocument();

    await act(async () => {
      resolveStale(
        page([row(999, '2020-01-01')], { totals: { count: 1, income: 0, expense: 999 } })
      );
    });

    expect(screen.queryByText('1.1.2020')).not.toBeInTheDocument();
    expect(screen.getByText('1.7.2026')).toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: 'ללא קטגוריה' }));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole('button', { name: 'ללא קטגוריה' }));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(3));

    expect(await screen.findByText('1.7.2026')).toBeInTheDocument();

    // The stale first request lands last, carrying data for a filter that is no
    // longer active. It must not overwrite the newer result.
    await act(async () => {
      resolveStale(
        page([row(999, '2020-01-01')], { totals: { count: 1, income: 0, expense: 999 } })
      );
    });

    expect(screen.queryByText('1.1.2020')).not.toBeInTheDocument();
    expect(screen.getByText('1.7.2026')).toBeInTheDocument();
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

    const input = screen.getByPlaceholderText('חיפוש לפי תיאור או סכום...');
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

    await user.click(screen.getByRole('button', { name: 'חודש שעבר' }));

    // No debounce on a discrete choice.
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));
  });
});

describe('delete', () => {
  it('removes the row and keeps the totals consistent', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteTransaction.mockResolvedValue({});

    getTransactions.mockResolvedValue(
      page([row(1, '2026-08-02', { total_amount: 250 }), row(2, '2026-08-01')], {
        totals: { count: 2, income: 0, expense: 350 },
      })
    );

    renderPage();
    await screen.findByText('2.8.2026');

    await user.click(screen.getAllByTitle('מחק')[0]);

    await waitFor(() => expect(deleteTransaction).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.queryByText('2.8.2026')).not.toBeInTheDocument());

    // 350 - 250 = 100, and the count drops by one.
    expect(screen.getByText('₪100')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
