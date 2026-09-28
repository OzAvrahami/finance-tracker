import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Budget from "../Budget/Budget";
import Transactions from './Transactions';
import AddTransaction from '../AddTransaction/AddTransaction';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import * as api from '../../services/api';

vi.mock('../../services/api', async importOriginal => {
  const api = await importOriginal();
  return Object.fromEntries(Object.keys(api).map(name => [name, vi.fn()]));
});

let transaction;
let budgetRows;
const header = { setPageHeader: () => {} };
const Location = () => <output data-testid="location">{useLocation().pathname}{useLocation().search}</output>;
const History = () => { const navigate = useNavigate(); return <><button onClick={() => navigate(-1)}>Browser Back</button><button onClick={() => navigate(1)}>Browser Forward</button></>; };
const renderRoutes = (entry = '/transactions') => render(
  <MemoryRouter initialEntries={[entry]}>
    <PageHeaderContext.Provider value={header}>
      <Location /><History /><Link to="/transactions">Normal transactions</Link>
      <Link to="/transactions?month=2026-07&uncategorized=1">קישור לתקופה אחרת</Link>
      <Routes><Route path="/budget" element={<Budget />} />
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
  budgetRows = [{ category_id: 1, categories: { name: 'מזון' }, actual_spent: '100.00', is_unbudgeted: true, lifecycle_state: 'no_budget' }];
  api.getFundedBudgetMonth.mockImplementation(async month => ({ data: {
    month, currency: 'ILS', funding: { available: '0.00', starting_total: '0.00', total_allocated: '0.00', active_allocated: '0.00', inactive_retained_funding: '0.00', unallocated: '0.00' },
    actuals: { total: '100.00', budgeted: '0.00', unbudgeted: '100.00' },
    categories: budgetRows, history: [], funding_action_history: [], savings: { balance: '0.00' },
  } }));
  api.getBudgetMonthClosePreview.mockResolvedValue({ data: null });
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

const origin = 'origin=budget&budgetMonth=2026-08&budgetSection=unbudgeted&budgetCategory=1';
const returnLink = () => screen.getByRole('link', { name: 'חזרה לתקציב' });

describe('Budget context on the real Budget / Transactions / editor routes', () => {
  it.each(['Save', 'Cancel', 'Back'].flatMap(action => [false, true].map(uncategorized => [action, uncategorized])))(
  '%s retains historical Budget origin and modified list criteria (uncategorized=%s)', async (action, uncategorized) => {
    if (uncategorized) { budgetRows[0].category_id = null; budgetRows[0].categories = null; }
    api.getSavingsAccounts.mockResolvedValue({ data: [{ account_id: '9007199254740993', name: 'חיסכון' }] });
    const user = userEvent.setup();
    renderRoutes('/budget');
    fireEvent.change(screen.getByLabelText('חודש התקציב'), { target: { value: '2026-08' } });
    await user.click(await screen.findByRole('button', { name: 'בדוק / תקן תנועות' }));
    await waitFor(() => expect(request()).toMatchObject({ from: '2026-08-01', to: '2026-08-31', categoryId: uncategorized ? 'all' : '1', uncategorizedOnly: uncategorized }));
    expect(screen.getByRole('navigation', { name: 'הקשר התקציב' })).toHaveTextContent('אוגוסט 2026');
    fireEvent.change(screen.getByLabelText('מתאריך'), { target: { value: '2026-07-04' } });
    await user.selectOptions(screen.getByLabelText('אמצעי תשלום'), '10');
    await user.selectOptions(screen.getByLabelText('חשבון חיסכון'), '9007199254740993');
    await waitFor(() => expect(editLink()).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('חיפוש תנועות'), { target: { value: 'סופר' } });
    const captured = new URL(editLink().href).searchParams.get('returnTo');
    expect(captured).toContain('search=');
    await user.click(editLink());
    await screen.findByRole('button', { name: 'עדכן תנועה' });
    expect(returnLink()).toHaveAttribute('href', `/budget?month=2026-08&section=unbudgeted&category=${uncategorized ? 'uncategorized' : '1'}`);
    if (action === 'Save') fireEvent.change(screen.getByRole('textbox', { name: 'תיאור', exact: true }), { target: { value: 'סופר מתוקן' } });
    await user.click(action === 'Save' ? screen.getByRole('button', { name: 'עדכן תנועה' })
      : screen.getByRole('link', { name: action === 'Cancel' ? 'ביטול' : 'חזרה לתנועות' }));
    await screen.findByLabelText('מתאריך');
    await waitFor(() => expect(request()).toMatchObject({ from: '2026-07-04', to: '2026-08-31', search: 'סופר', paymentSourceId: '10', savingsAccountId: '9007199254740993' }));
    expect(request().cursor).toBeUndefined();
    expect(within(await screen.findByRole('table')).getByText(action === 'Save' ? 'סופר מתוקן' : 'סופר אוגוסט')).toBeInTheDocument();
    expect(api.updateTransaction).toHaveBeenCalledTimes(action === 'Save' ? 1 : 0);
    await user.click(returnLink());
    expect(screen.getByLabelText('חודש התקציב')).toHaveValue('2026-08');
    await waitFor(() => expect(document.activeElement.id).toBe(`budget-unbudgeted-${uncategorized ? 'uncategorized' : '1'}`));
    expect(api.getFundedBudgetMonth.mock.calls.at(-1)[0]).toBe('2026-08');
  });

  it.each(['transactions', 'editor'])('refresh/direct entry reconstructs %s origin without history state', async surface => {
    const user = userEvent.setup();
    const first = renderRoutes(`/transactions?month=2026-08&${origin}`);
    await waitFor(() => expect(editLink()).toBeInTheDocument());
    const href = surface === 'editor' ? editLink().getAttribute('href') : screen.getByTestId('location').textContent;
    first.unmount();renderRoutes(href);
    await screen.findByRole('navigation', { name: 'הקשר התקציב' });
    await user.click(returnLink());
    await waitFor(() => expect(document.activeElement.id).toBe('budget-unbudgeted-1'));
    expect(screen.getByLabelText('חודש התקציב')).toHaveValue('2026-08');
  });

  it('normal same-route entry clears origin, while Back/Forward restores the actual URL state', async () => {
    const user = userEvent.setup();renderRoutes(`/transactions?month=2026-08&${origin}`);
    await screen.findByLabelText('מתאריך');
    await user.click(screen.getByRole('link', { name: 'Normal transactions' }));
    expect(screen.queryByRole('navigation', { name: 'הקשר התקציב' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('מתאריך')).toHaveValue('2026-09-01');
    await user.click(screen.getByText('Browser Back'));expect(returnLink()).toBeInTheDocument();
    await user.click(screen.getByText('Browser Forward'));expect(screen.queryByText('חזרה לתקציב')).not.toBeInTheDocument();
  });

  it('Budget month follows browser history and a fresh URL load', async () => {
    const user = userEvent.setup();const first = renderRoutes('/budget?month=2026-08');
    await user.click(screen.getByRole('button', { name: 'חודש קודם' }));
    expect(screen.getByLabelText('חודש התקציב')).toHaveValue('2026-07');
    await user.click(screen.getByText('Browser Back'));expect(screen.getByLabelText('חודש התקציב')).toHaveValue('2026-08');
    await user.click(screen.getByText('Browser Forward'));expect(screen.getByLabelText('חודש התקציב')).toHaveValue('2026-07');
    first.unmount();renderRoutes('/budget?month=2026-07');expect(screen.getByLabelText('חודש התקציב')).toHaveValue('2026-07');
  });

  it.each(['resolved', 'missing category'])('returns safely when the origin is %s after correction', async mode => {
    const user = userEvent.setup();renderRoutes(`/transactions?month=2026-08&${origin}`);
    if (mode === 'resolved') budgetRows = [];
    else budgetRows[0].category_id = 2;
    await user.click(returnLink());
    await waitFor(() => expect(document.activeElement.id).toBe(mode === 'resolved' ? 'budget-page' : 'budget-unbudgeted'));
    expect(screen.getByLabelText('חודש התקציב')).toHaveValue('2026-08');
  });

  it.each(['', '&origin=budget&budgetMonth=2026-13&budgetSection=unbudgeted&budgetCategory=1',
    `&${origin}&origin=evil`, `&${origin.replace('unbudgeted', 'admin')}`])(
  'ordinary filters survive absent/invalid origin through edit return: %s', async suffix => {
    const user = userEvent.setup();renderRoutes(`/transactions?month=2026-08&categoryId=1${suffix}`);
    await waitFor(() => expect(editLink()).toBeInTheDocument());
    expect(screen.queryByText('חזרה לתקציב')).not.toBeInTheDocument();
    await user.click(editLink());await screen.findByRole('button', { name: 'עדכן תנועה' });
    await user.click(screen.getByRole('link', { name: 'ביטול' }));
    await waitFor(() => expect(request()).toMatchObject({ from: '2026-08-01', categoryId: '1' }));
    expect(screen.queryByText('חזרה לתקציב')).not.toBeInTheDocument();
  });

  it('supports keyboard link activation and focuses the restored Budget row', async () => {
    const user = userEvent.setup();renderRoutes(`/transactions?month=2026-08&${origin}`);
    expect(screen.getByRole('navigation', { name: 'הקשר התקציב' })).toHaveAttribute('dir', 'rtl');
    returnLink().focus();await user.keyboard('{Enter}');
    await waitFor(() => expect(document.activeElement.id).toBe('budget-unbudgeted-1'));
  });

  it.each(['2026-13', '2026-00', '2026-08&month=2026-07'])('invalid/duplicate Budget month uses the normal current-month default: %s', month => {
    renderRoutes(`/budget?month=${month}&section=unbudgeted&category=1`);
    expect(screen.getByLabelText('חודש התקציב')).toHaveValue('2026-09');
  });
});

