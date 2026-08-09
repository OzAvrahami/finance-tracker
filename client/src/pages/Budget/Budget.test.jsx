import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import {
  copyBudget,
  deleteBudget,
  getBudgetsByMonth,
  getCategories,
  upsertBudget,
} from '../../services/api';
import Budget from './Budget';

vi.mock('../../services/api', () => ({
  copyBudget: vi.fn(),
  deleteBudget: vi.fn(),
  getBudgetsByMonth: vi.fn(),
  getCategories: vi.fn(),
  upsertBudget: vi.fn(),
}));

const categories = [
  { id: 1, name: 'מזון', icon: '🍎', type: 'expense' },
  { id: 2, name: 'תחבורה', icon: '🚌', type: 'expense' },
  { id: 3, name: 'משכורת', icon: '💼', type: 'income' },
];

const budgetRow = (overrides = {}) => ({
  id: 11,
  category_id: 1,
  month: '2026-08',
  amount: 1000,
  actual_spent: 750,
  categories: categories[0],
  ...overrides,
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const setPageHeader = vi.fn();

const renderPage = () => render(
  <PageHeaderContext.Provider value={{ setPageHeader }}>
    <Budget />
  </PageHeaderContext.Provider>
);

const settle = async () => {
  renderPage();
  return screen.findByRole('table', { name: 'תקציבים לפי קטגוריית הוצאה' });
};

beforeEach(() => {
  vi.resetAllMocks();
  getCategories.mockResolvedValue({ data: categories });
  getBudgetsByMonth.mockResolvedValue({ data: [budgetRow()] });
  upsertBudget.mockResolvedValue({ data: {} });
  copyBudget.mockResolvedValue({ data: {} });
  deleteBudget.mockResolvedValue({ data: {} });
});

describe('monthly budget loading and month behavior', () => {
  it('uses the shell header and loads the selected calendar month', async () => {
    await settle();

    const expectedMonth = new Date().toISOString().slice(0, 7);
    expect(setPageHeader).toHaveBeenCalledWith({
      title: 'תקציב חודשי',
      subtitle: 'מעקב תקציב חודשי לפי קטגוריה',
    });
    expect(getBudgetsByMonth).toHaveBeenCalledWith(expectedMonth);
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('replaces the month data and ignores a stale response', async () => {
    const august = deferred();
    const july = deferred();
    getBudgetsByMonth
      .mockReturnValueOnce(august.promise)
      .mockReturnValueOnce(july.promise);
    renderPage();

    const picker = screen.getByLabelText('חודש התקציב');
    fireEvent.change(picker, { target: { value: '2026-07' } });
    await waitFor(() => expect(getBudgetsByMonth).toHaveBeenLastCalledWith('2026-07'));

    july.resolve({ data: [budgetRow({ id: 22, category_id: 2, categories: categories[1] })] });
    expect((await screen.findAllByText('תחבורה')).length).toBeGreaterThan(0);
    august.resolve({ data: [budgetRow()] });

    await waitFor(() => expect(screen.queryByText('מזון')).not.toBeInTheDocument());
    expect(screen.getAllByText('תחבורה').length).toBeGreaterThan(0);
  });

  it('shows a skeleton before data and a retryable page error after failure', async () => {
    const request = deferred();
    getBudgetsByMonth.mockReturnValueOnce(request.promise).mockResolvedValueOnce({ data: [budgetRow()] });
    renderPage();

    expect(screen.getByLabelText('טעינת פירוט התקציב')).toBeInTheDocument();
    request.reject(new Error('network'));

    expect(await screen.findByRole('heading', { name: 'לא ניתן לטעון את התקציב' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});

describe('budget values and responsive representations', () => {
  it('renders API actuals, summary totals, remaining value, and the same row in table and mobile list', async () => {
    getBudgetsByMonth.mockResolvedValue({
      data: [
        budgetRow(),
        budgetRow({ id: 12, category_id: 2, amount: 500, actual_spent: 0, categories: categories[1] }),
      ],
    });
    const table = await settle();
    const summary = screen.getByLabelText(/סיכום תקציב/);

    expect(within(summary).getByText('₪1,500')).toBeInTheDocument();
    expect(within(summary).getAllByText('₪750')).toHaveLength(2);
    expect(within(table).getByText('מזון')).toBeInTheDocument();
    expect(within(table).getAllByText('₪750').length).toBeGreaterThan(0);

    const mobileList = screen.getByRole('list', { name: 'תקציבים לפי קטגוריית הוצאה' });
    expect(within(mobileList).getByText('מזון')).toBeInTheDocument();
    expect(within(mobileList).getByText('תחבורה')).toBeInTheDocument();
    expect(within(table).getAllByRole('button', { name: /עריכת תקציב עבור/ })).toHaveLength(2);
    expect(within(mobileList).getAllByRole('button', { name: /מחיקת תקציב עבור/ })).toHaveLength(2);
  });

  it('preserves zero, near-limit, full, and over-budget utilization semantics', async () => {
    getBudgetsByMonth.mockResolvedValue({
      data: [
        budgetRow({ id: 1, amount: 100, actual_spent: 0 }),
        budgetRow({ id: 2, amount: 100, actual_spent: 70 }),
        budgetRow({ id: 3, amount: 100, actual_spent: 100 }),
        budgetRow({ id: 4, amount: 100, actual_spent: 150 }),
      ],
    });
    await settle();

    expect(screen.getAllByText('ללא הוצאה').length).toBeGreaterThan(0);
    expect(screen.getAllByText('קרוב למגבלה').length).toBeGreaterThan(0);
    expect(screen.getAllByText('נוצל במלואו').length).toBeGreaterThan(0);
    expect(screen.getAllByText('חריגה').length).toBeGreaterThan(0);
    const overrunProgress = screen.getAllByRole('progressbar').find((progress) => progress.getAttribute('aria-valuenow') === '150');
    expect(overrunProgress).toHaveAttribute('aria-valuetext', '150% — חריגה');
  });

  it('formats floating-point artifacts only at the money presentation boundary', async () => {
    getBudgetsByMonth.mockResolvedValue({
      data: [
        budgetRow({ id: 1, amount: 44723.07000000001, actual_spent: 44471.02000000001 }),
        budgetRow({ id: 2, amount: 100, actual_spent: 234.51999999999998 }),
        budgetRow({ id: 3, amount: 100, actual_spent: 90.61000000000001 }),
      ],
    });
    await settle();

    expect(screen.getAllByText('₪44,723.07').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₪252.05').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₪134.52').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₪9.39').length).toBeGreaterThan(0);
    expect(document.body).not.toHaveTextContent('₪44,723.07000000001');
    expect(document.body).not.toHaveTextContent('₪252.04999999999563');
    expect(document.body).not.toHaveTextContent('₪134.51999999999998');
    expect(document.body).not.toHaveTextContent('₪9.389999999999986');
  });
});

describe('budget mutations', () => {
  it('offers only eligible expense categories and sends the existing add payload', async () => {
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'הוספת קטגוריה' }));

    const categorySelect = await screen.findByLabelText(/^קטגוריית הוצאה/);
    expect(within(categorySelect).queryByRole('option', { name: /מזון/ })).not.toBeInTheDocument();
    expect(within(categorySelect).getByRole('option', { name: /תחבורה/ })).toBeInTheDocument();
    expect(within(categorySelect).queryByRole('option', { name: /משכורת/ })).not.toBeInTheDocument();

    await userEvent.selectOptions(categorySelect, '2');
    await userEvent.type(screen.getByLabelText(/^סכום התקציב/), '640');
    await userEvent.click(screen.getByRole('button', { name: 'הוספה' }));

    expect(upsertBudget).toHaveBeenCalledWith({
      category_id: 2,
      month: new Date().toISOString().slice(0, 7),
      amount: 640,
    });
    await waitFor(() => expect(getBudgetsByMonth).toHaveBeenCalledTimes(2));
  });

  it('shows the no-eligible-categories state instead of an unusable selector', async () => {
    getCategories.mockResolvedValue({ data: [categories[0], categories[2]] });
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'הוספת קטגוריה' }));

    expect(screen.getByText('אין קטגוריות נוספות להוספה')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^קטגוריית הוצאה/)).not.toBeInTheDocument();
  });

  it('edits with the existing upsert payload, cancels safely, and preserves a failed value', async () => {
    await settle();
    const editButtons = screen.getAllByRole('button', { name: 'עריכת תקציב עבור מזון' });
    await userEvent.click(editButtons[0]);
    const desktopInput = screen.getByLabelText('תקציב עבור מזון', { selector: '#budget-amount-desktop-11' });
    await userEvent.clear(desktopInput);
    await userEvent.type(desktopInput, '825');
    await userEvent.click(screen.getAllByRole('button', { name: 'ביטול עריכת תקציב עבור מזון' })[0]);
    expect(screen.queryByLabelText('תקציב עבור מזון')).not.toBeInTheDocument();

    upsertBudget.mockRejectedValueOnce(new Error('save failed'));
    await userEvent.click(screen.getAllByRole('button', { name: 'עריכת תקציב עבור מזון' })[0]);
    const retriedInput = screen.getByLabelText('תקציב עבור מזון', { selector: '#budget-amount-desktop-11' });
    await userEvent.clear(retriedInput);
    await userEvent.type(retriedInput, '825');
    await userEvent.click(screen.getAllByRole('button', { name: 'שמירת תקציב עבור מזון' })[0]);

    expect(upsertBudget).toHaveBeenCalledWith({
      category_id: 1,
      month: new Date().toISOString().slice(0, 7),
      amount: 825,
    });
    expect((await screen.findAllByText(/שמירת התקציב נכשלה/)).length).toBeGreaterThan(0);
    expect(retriedInput).toHaveValue(825);
  });

  it('refreshes after a successful edit without changing the upsert contract', async () => {
    await settle();
    await userEvent.click(screen.getAllByRole('button', { name: 'עריכת תקציב עבור מזון' })[0]);
    const input = screen.getByLabelText('תקציב עבור מזון', { selector: '#budget-amount-desktop-11' });
    await userEvent.clear(input);
    await userEvent.type(input, '900');
    await userEvent.click(screen.getAllByRole('button', { name: 'שמירת תקציב עבור מזון' })[0]);

    expect(upsertBudget).toHaveBeenCalledWith({
      category_id: 1,
      month: new Date().toISOString().slice(0, 7),
      amount: 900,
    });
    await waitFor(() => expect(getBudgetsByMonth).toHaveBeenCalledTimes(2));
  });

  it('confirms deletion, retains the row on failure, and refreshes after success', async () => {
    await settle();
    await userEvent.click(screen.getAllByRole('button', { name: 'מחיקת תקציב עבור מזון' })[0]);
    expect(screen.getByRole('heading', { name: 'מחיקת תקציב הקטגוריה' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(deleteBudget).not.toHaveBeenCalled();

    deleteBudget.mockRejectedValueOnce(new Error('delete failed'));
    await userEvent.click(screen.getAllByRole('button', { name: 'מחיקת תקציב עבור מזון' })[0]);
    await userEvent.click(screen.getByRole('button', { name: 'מחיקת התקציב' }));
    expect(await screen.findByText(/מחיקת התקציב נכשלה/)).toBeInTheDocument();
    expect(screen.getAllByText('מזון').length).toBeGreaterThan(0);

    deleteBudget.mockResolvedValueOnce({ data: {} });
    await userEvent.click(screen.getByRole('button', { name: 'מחיקת התקציב' }));
    await waitFor(() => expect(getBudgetsByMonth).toHaveBeenCalledTimes(2));
  });

  it('copies only budget targets using the existing source and target payload', async () => {
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'העתקת התקציב לחודש אחר' }));
    expect(screen.getByText(/תנועות והוצאות בפועל אינן מועתקות/)).toBeInTheDocument();
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^חודש יעד/), { target: { value: '2026-09' } });
    await userEvent.click(screen.getByRole('button', { name: 'העתקת התקציב' }));

    expect(copyBudget).toHaveBeenCalledWith({
      fromMonth: new Date().toISOString().slice(0, 7),
      toMonth: '2026-09',
    });
    await waitFor(() => expect(getBudgetsByMonth).toHaveBeenCalledTimes(2));
  });

  it('keeps the copy dialog and target month available after a failed copy', async () => {
    copyBudget.mockRejectedValueOnce(new Error('copy failed'));
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'העתקת התקציב לחודש אחר' }));
    const targetInput = within(await screen.findByRole('dialog')).getByLabelText(/^חודש יעד/);
    fireEvent.change(targetInput, { target: { value: '2026-10' } });
    await userEvent.click(screen.getByRole('button', { name: 'העתקת התקציב' }));

    expect(await screen.findByText(/העתקת התקציב נכשלה/)).toBeInTheDocument();
    expect(targetInput).toHaveValue('2026-10');
  });
});

describe('empty and mutation error states', () => {
  it('distinguishes a month with no configured budgets from zero spending', async () => {
    getBudgetsByMonth.mockResolvedValueOnce({ data: [] });
    const emptyRender = renderPage();
    expect(await screen.findByRole('heading', { name: /לא הוגדר תקציב/ })).toBeInTheDocument();
    emptyRender.unmount();

    getBudgetsByMonth.mockResolvedValue({ data: [budgetRow({ actual_spent: 0 })] });
    renderPage();
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /לא הוגדר תקציב/ })).not.toBeInTheDocument();
  });

  it('keeps add input after a mutation failure', async () => {
    upsertBudget.mockRejectedValueOnce(new Error('failed'));
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'הוספת קטגוריה' }));
    await userEvent.selectOptions(await screen.findByLabelText(/^קטגוריית הוצאה/), '2');
    await userEvent.type(screen.getByLabelText(/^סכום התקציב/), '333');
    await userEvent.click(screen.getByRole('button', { name: 'הוספה' }));

    expect(await screen.findByText(/הוספת התקציב נכשלה/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^סכום התקציב/)).toHaveValue(333);
  });
});
