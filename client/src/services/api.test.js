import { describe, it, expect, vi, beforeEach } from 'vitest';

// The api module builds an axios instance and attaches a Supabase auth
// interceptor at import time. Both are stubbed so these tests exercise only the
// query-string construction.
const getMock = vi.fn(() => Promise.resolve({ data: {} }));

vi.mock('../config/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      signOut: () => Promise.resolve(),
    },
  },
}));

vi.mock('axios', () => ({
  default: {
    create: () => ({
      get: getMock,
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    }),
  },
}));

const { getTransactions, getDashboardSummary } = await import('./api');

/** Returns the parsed query params of the most recent GET. */
function lastQuery() {
  const url = getMock.mock.calls.at(-1)[0];
  const [, qs = ''] = url.split('?');
  return Object.fromEntries(new URLSearchParams(qs));
}

describe('getTransactions query building', () => {
  beforeEach(() => {
    getMock.mockClear();
  });

  it('omits every filter when none is supplied', () => {
    getTransactions();
    expect(getMock).toHaveBeenCalledWith('/transactions');
  });

  it('sends the active date range verbatim', () => {
    getTransactions({ from: '2026-08-01', to: '2026-08-31' });
    expect(lastQuery()).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('does not convert date-only values through a timezone', () => {
    // Passing these through Date.toISOString() would shift them by the UTC
    // offset and silently move a transaction into the neighbouring day.
    getTransactions({ from: '2026-01-01', to: '2026-12-31' });
    const query = lastQuery();
    expect(query.from).toBe('2026-01-01');
    expect(query.to).toBe('2026-12-31');
    expect(query.from).not.toContain('T');
  });

  it("treats the UI's 'all' sentinel as no filter", () => {
    getTransactions({ categoryId: 'all', paymentSourceId: 'all' });
    expect(getMock).toHaveBeenCalledWith('/transactions');
  });

  it('sends concrete category and payment source ids', () => {
    getTransactions({ categoryId: 3, paymentSourceId: 10 });
    expect(lastQuery()).toEqual({ categoryId: '3', paymentSourceId: '10' });
  });

  it('omits uncategorizedOnly when false and sends it when true', () => {
    getTransactions({ uncategorizedOnly: false });
    expect(getMock).toHaveBeenCalledWith('/transactions');

    getTransactions({ uncategorizedOnly: true });
    expect(lastQuery()).toEqual({ uncategorizedOnly: 'true' });
  });

  it('trims search and omits a whitespace-only term', () => {
    getTransactions({ search: '  קפה  ' });
    expect(lastQuery()).toEqual({ search: 'קפה' });

    getTransactions({ search: '   ' });
    expect(getMock).toHaveBeenCalledWith('/transactions');
  });

  it('escapes characters that would otherwise break the query string', () => {
    getTransactions({ search: 'a&b=c?d #e' });
    // Round-tripping through URLSearchParams proves nothing was injected.
    expect(lastQuery().search).toBe('a&b=c?d #e');
  });

  it('passes the opaque cursor through verbatim', () => {
    // The cursor is issued by the server and echoed back unchanged. The client
    // must not parse it or rebuild it from parts: it carries a NUMERIC amount
    // as a decimal string, which a round-trip through JS could not preserve.
    const cursor = 'eyJ2IjoxLCJzIjoidG90YWxfYW1vdW50IiwiZCI6ImRlc2MifQ';
    getTransactions({ cursor });
    expect(lastQuery()).toEqual({ cursor });
  });

  it('url-escapes a cursor without altering its value', () => {
    const cursor = 'abc-_ZXlKMklqb3hMQ0p6SWpvaQ';
    getTransactions({ cursor });
    expect(lastQuery().cursor).toBe(cursor);
  });

  it('omits an absent cursor', () => {
    getTransactions({ cursor: null });
    expect(getMock).toHaveBeenCalledWith('/transactions');

    getTransactions({ cursor: '' });
    expect(getMock).toHaveBeenCalledWith('/transactions');
  });

  it('omits the sort when it is the server default', () => {
    getTransactions({ sortBy: 'transaction_date', sortDirection: 'desc' });
    expect(getMock).toHaveBeenCalledWith('/transactions');
  });

  it('sends a non-default sort field and direction', () => {
    getTransactions({ sortBy: 'total_amount', sortDirection: 'asc' });
    expect(lastQuery()).toEqual({ sortBy: 'total_amount', sortDirection: 'asc' });

    getTransactions({ sortBy: 'description', sortDirection: 'desc' });
    expect(lastQuery()).toEqual({ sortBy: 'description' });

    getTransactions({ sortBy: 'transaction_date', sortDirection: 'asc' });
    expect(lastQuery()).toEqual({ sortDirection: 'asc' });
  });

  it('sends limit and includeTotals', () => {
    getTransactions({ limit: 100, includeTotals: true });
    expect(lastQuery()).toEqual({ limit: '100', includeTotals: 'true' });
  });

  it('combines every filter into a single well-formed query', () => {
    getTransactions({
      from: '2026-01-01',
      to: '2026-06-30',
      categoryId: 3,
      paymentSourceId: 10,
      uncategorizedOnly: true,
      search: 'לגו',
      limit: 100,
      sortBy: 'description',
      sortDirection: 'asc',
      cursor: 'eyJ2IjoxfQ',
      includeTotals: true,
    });

    expect(lastQuery()).toEqual({
      from: '2026-01-01',
      to: '2026-06-30',
      categoryId: '3',
      paymentSourceId: '10',
      uncategorizedOnly: 'true',
      search: 'לגו',
      limit: '100',
      sortBy: 'description',
      sortDirection: 'asc',
      cursor: 'eyJ2IjoxfQ',
      includeTotals: 'true',
    });
  });
});

describe('getDashboardSummary', () => {
  beforeEach(() => {
    getMock.mockClear();
  });

  it('requests the aggregate endpoint with an explicit range', () => {
    getDashboardSummary('2026-08-01', '2026-08-31');
    expect(getMock).toHaveBeenCalledWith('/dashboard/summary', {
      params: { from: '2026-08-01', to: '2026-08-31' },
    });
  });
});
