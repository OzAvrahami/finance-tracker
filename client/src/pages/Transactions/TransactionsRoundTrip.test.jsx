import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import Transactions from './Transactions';
import AddTransaction from '../AddTransaction/AddTransaction';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import * as api from '../../services/api';

vi.mock('../../services/api', () => Object.fromEntries([
  'getTransactions', 'getCategories', 'getPaymentSources', 'getSavingsAccounts', 'deleteTransaction',
  'getTransactionById', 'getTags', 'getLegoThemes', 'getAllLoans', 'updateTransaction',
  'createTransaction', 'createCategory', 'getLegoSetDetails',
].map(name => [name, vi.fn()])));

let transaction;
const header = { setPageHeader: () => {} };
const Location = () => <output data-testid="location">{useLocation().pathname}{useLocation().search}</output>;
const renderRoutes = (entry = '/transactions') => render(
  <MemoryRouter initialEntries={[entry]}>
    <PageHeaderContext.Provider value={header}>
      <Location />
      <Link to="/transactions?month=2026-07&uncategorized=1">קישור לתקופה אחרת</Link>
      <Routes>
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/edit-transaction/:id" element={<AddTransaction />} />
        <Route path="/add" element={<AddTransaction />} />
      </Routes>
    </PageHeaderContext.Provider>
  </MemoryRouter>,
);
const request = () => api.getTransactions.mock.calls.at(-1)[0];
const editLink = () => screen.getAllByRole('link', { name: /עריכת התנועה/ })[0];

beforeEach(() => {
  vi.resetAllMocks();
  const RealDate = Date;
  vi.stubGlobal('Date', class extends RealDate {
    constructor(...args) { super(...(args.length ? args : ['2026-09-18T12:00:00+03:00'])); }
    static now() { return new RealDate('2026-09-18T12:00:00+03:00').getTime(); }
  });
  vi.stubGlobal('alert', vi.fn());
  transaction = { id: 42, description: 'סופר אוגוסט', transaction_date: '2026-08-12', charge_date: '2026-08-12',
    movement_type: 'expense', total_amount: '100.00', category_id: 1, payment_source_id: 10,
    categories: { name: 'מזון' }, payment_sources: { name: 'ויזה' }, transaction_items: [], currency: 'ILS' };
  api.getCategories.mockResolvedValue({ data: [{ id: 1, name: 'מזון', keywords: [] }] });
  api.getPaymentSources.mockResolvedValue({ data: [{ id: 10, name: 'ויזה', method: 'credit_card' }] });
  for (const name of ['getSavingsAccounts', 'getTags', 'getLegoThemes', 'getAllLoans']) api[name].mockResolvedValue({ data: [] });
  api.getTransactionById.mockImplementation(async () => ({ data: { ...transaction } }));
  api.updateTransaction.mockImplementation(async (_id, payload) => { transaction = { ...transaction, ...payload.transaction }; return { data: transaction }; });
  api.getTransactions.mockImplementation(async criteria => {
    const rows = (!criteria.from || transaction.transaction_date >= criteria.from)
      && (!criteria.to || transaction.transaction_date <= criteria.to)
      && (!criteria.search || transaction.description.includes(criteria.search))
      ? [{ ...transaction }] : [];
    return { data: { data: rows, totals: { count: rows.length, income: 0, expense: rows.length * 100 }, pagination: { hasMore: false, nextCursor: null } } };
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('real Transactions / editor route round trip', () => {
  it.each(['7', '9007199254740993'])('preserves released bigint Savings account %s through UI selection and edit return', async accountId => {
    api.getSavingsAccounts.mockResolvedValue({ data: [{ account_id: accountId, name: 'חיסכון לבדיקה' }] });
    const user = userEvent.setup();
    renderRoutes('/transactions?month=2026-08');
    await screen.findByRole('option', { name: 'חיסכון לבדיקה' });
    await user.selectOptions(screen.getByLabelText('חשבון חיסכון'), accountId);
    await waitFor(() => expect(request().savingsAccountId).toBe(accountId));
    await user.selectOptions(screen.getByLabelText('סוג תזרים'), 'deposit');
    await waitFor(() => expect(editLink()).toBeInTheDocument());
    await user.click(editLink());
    await screen.findByRole('button', { name: 'עדכן תנועה' });
    await user.click(screen.getByRole('link', { name: 'ביטול' }));
    await waitFor(() => expect(screen.getByLabelText('חשבון חיסכון')).toHaveValue(accountId));
    expect(screen.getByLabelText('סוג תזרים')).toHaveValue('deposit');
    expect(request()).toMatchObject({ from: '2026-08-01', savingsAccountId: accountId, savingsFlow: 'deposit' });
  });

  it.each(['Save', 'Cancel', 'Back'])('preserves UI-selected August criteria and pending search through %s in September', async action => {
    const user = userEvent.setup();
    renderRoutes();
    await waitFor(() => expect(request().from).toBe('2026-09-01'));
    await user.click(screen.getByRole('button', { name: 'החודש הקודם', exact: true }));
    await waitFor(() => expect(editLink()).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('קטגוריה'), '1');
    await user.selectOptions(screen.getByLabelText('אמצעי תשלום'), '10');
    await user.click(screen.getByRole('button', { name: /סכום/ }));
    await waitFor(() => expect(request().sortBy).toBe('total_amount'));
    await waitFor(() => expect(editLink()).toBeInTheDocument());
    // Edit before the 300ms search debounce: capture what is visibly typed.
    fireEvent.change(screen.getByLabelText('חיפוש תנועות'), { target: { value: 'סופר' } });
    expect(request().search).toBe('');
    fireEvent.click(editLink());
    await screen.findByRole('button', { name: 'עדכן תנועה' });
    const callsBeforeReturn = api.getTransactions.mock.calls.length;
    if (action === 'Save') {
      fireEvent.change(screen.getByRole('textbox', { name: 'תיאור', exact: true }), { target: { value: 'סופר מעודכן' } });
      await user.click(screen.getByRole('button', { name: 'עדכן תנועה' }));
    } else await user.click(screen.getByRole('link', { name: action === 'Cancel' ? 'ביטול' : 'חזרה לתנועות' }));
    await waitFor(() => expect(api.getTransactions.mock.calls.length).toBeGreaterThan(callsBeforeReturn));
    expect(request()).toMatchObject({ from: '2026-08-01', to: '2026-08-31', categoryId: '1', paymentSourceId: '10', search: 'סופר', sortBy: 'total_amount', sortDirection: 'asc', includeTotals: true });
    expect(request().cursor).toBeUndefined();
    expect(screen.getByLabelText('מתאריך')).toHaveValue('2026-08-01');
    expect(screen.getByLabelText('חיפוש תנועות')).toHaveValue('סופר');
    const table = await screen.findByRole('table');
    expect(within(table).getByText(action === 'Save' ? 'סופר מעודכן' : 'סופר אוגוסט')).toBeInTheDocument();
    expect(api.updateTransaction).toHaveBeenCalledTimes(action === 'Save' ? 1 : 0);
  });

  it('reloads matching results from scratch when the saved row moves out of the restored month', async () => {
    const user = userEvent.setup();
    renderRoutes('/transactions?month=2026-08');
    await waitFor(() => expect(editLink()).toBeInTheDocument());
    await user.click(editLink());
    await screen.findByRole('button', { name: 'עדכן תנועה' });
    fireEvent.change(screen.getByLabelText(/^תאריך התנועה/), { target: { value: '2026-09-12' } });
    await user.click(screen.getByRole('button', { name: 'עדכן תנועה' }));
    await waitFor(() => expect(screen.getByLabelText('מתאריך')).toHaveValue('2026-08-01'));
    await waitFor(() => expect(screen.queryByRole('table')).not.toBeInTheDocument());
    expect(request().cursor).toBeUndefined();
    expect(api.updateTransaction).toHaveBeenCalled();
  });

  it('discards accumulated pages and the old keyset cursor on return from editing', async () => {
    const firstRow = { ...transaction, id: 41, description: 'ראשונה' };
    api.getTransactions.mockImplementation(async criteria => ({ data: {
      data: [{ ...(criteria.cursor ? transaction : firstRow) }],
      totals: { count: 2, income: 0, expense: 200 },
      pagination: { hasMore: !criteria.cursor, nextCursor: criteria.cursor ? null : 'old-cursor' },
    } }));
    const user = userEvent.setup();
    renderRoutes('/transactions?month=2026-08');
    await user.click(await screen.findByRole('button', { name: 'טען תנועות נוספות' }));
    await waitFor(() => expect(request().cursor).toBe('old-cursor'));
    await user.click((await screen.findAllByRole('link', { name: /עריכת התנועה.*סופר אוגוסט/ }))[0]);
    await screen.findByRole('button', { name: 'עדכן תנועה' });
    firstRow.description = 'ראשונה רעננה';
    await user.click(screen.getByRole('button', { name: 'עדכן תנועה' }));
    const table = await screen.findByRole('table');
    expect(within(table).getByText('ראשונה רעננה')).toBeInTheDocument();
    expect(within(table).queryByText('סופר אוגוסט')).not.toBeInTheDocument();
    expect(request()).toMatchObject({ from: '2026-08-01', to: '2026-08-31', includeTotals: true });
    expect(request().cursor).toBeUndefined();
    expect(screen.getByRole('button', { name: 'טען תנועות נוספות' })).toBeInTheDocument();
  });

  it.each([
    'from=&to=&categoryId=1&uncategorized=1&paymentSourceId=10&sortBy=description&sortDirection=desc',
    'from=2026-07-04&to=2026-08-19&search=%D7%A1%D7%95%D7%A4%D7%A8',
    'from=&to=2026-08-31',
  ])('preserves concrete/custom/unbounded criteria after opening an editor URL in a fresh route: %s', async query => {
    const user = userEvent.setup();
    const origin = '/transactions?' + query;
    const first = renderRoutes(origin);
    await waitFor(() => expect(editLink()).toBeInTheDocument());
    const href = editLink().getAttribute('href');
    const expected = { ...request() };
    first.unmount(); // Refresh/new tab has no navigation state or list instance.
    renderRoutes(href);
    await screen.findByRole('button', { name: 'עדכן תנועה' });
    await user.click(screen.getByRole('link', { name: 'ביטול' }));
    await screen.findByLabelText('מתאריך');
    expect(request()).toEqual(expected);
  });

  it.each(['', '?returnTo=https%3A%2F%2Fevil.example', '?returnTo=%2Fbudget', '?returnTo=%2Ftransactions%3FsortBy%3Devil', '?returnTo=%2Ftransactions%3Ffrom%3D2026-02-30', '?returnTo=%2Ftransactions%3FcategoryId%3D-1', '?returnTo=%2Ftransactions%3FsavingsAccountId%3D9223372036854775808', '?returnTo=%2Ftransactions%3FsavingsAccountId%3D00000000-0000-4000-8000-000000000007'])('safely returns direct or invalid editor context to normal Transactions: %s', async suffix => {
    renderRoutes('/edit-transaction/42' + suffix);
    await screen.findByRole('button', { name: 'עדכן תנועה' });
    fireEvent.click(screen.getByRole('link', { name: 'ביטול' }));
    await screen.findByLabelText('מתאריך');
    expect(request().from).toBe('2026-09-01');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/transactions$/);
  });

  it('synchronizes a changed entry URL while Transactions stays mounted', async () => {
    renderRoutes('/transactions?month=2026-08');
    await screen.findByLabelText('מתאריך');
    fireEvent.click(screen.getByRole('link', { name: 'קישור לתקופה אחרת' }));
    await waitFor(() => expect(request()).toMatchObject({ from: '2026-07-01', to: '2026-07-31', uncategorizedOnly: true }));
    expect(screen.getByLabelText('מתאריך')).toHaveValue('2026-07-01');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });
});
