import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import {
  addManualBudgetFunding, adjustFundedBudget, copyBudget, establishFundedBudget,
  getCategories, getFundedBudgetMonth, removeFundedBudget,
} from '../../services/api';
import Budget from './Budget';

vi.mock('../../services/api', () => ({
  addManualBudgetFunding: vi.fn(), adjustFundedBudget: vi.fn(), copyBudget: vi.fn(),
  establishFundedBudget: vi.fn(), getCategories: vi.fn(), getFundedBudgetMonth: vi.fn(),
  removeFundedBudget: vi.fn(),
}));

const categories = [
  { id: 1, name: 'מזון', icon: '🍎', type: 'expense' },
  { id: 2, name: 'תחבורה', icon: '🚌', type: 'expense' },
  { id: 3, name: 'משכורת', icon: '💼', type: 'income' },
];

const categoryState = (overrides = {}) => ({
  budget_id: 11, category_id: 1, categories: categories[0], lifecycle_state: 'active',
  is_active_budget: true, is_active_zero: false, is_unbudgeted: false,
  starting_amount: '1000.00', starting_kind: 'manual', adjustment_total: '200.00',
  final_funded: '1200.00', amount: '1200.00', actual_spent: '750.00',
  remaining: '450.00', deficit: '0.00', ...overrides,
});

const fundedState = (overrides = {}) => ({
  month: new Date().toISOString().slice(0, 7), currency: 'ILS',
  funding: {
    available: '1500.00', starting_total: '1000.00', total_allocated: '1200.00',
    active_allocated: '1200.00', inactive_retained_funding: '0.00', unallocated: '300.00',
  },
  actuals: { total: '825.00', budgeted: '750.00', unbudgeted: '75.00' },
  categories: [
    categoryState(),
    { budget_id: null, category_id: 2, categories: categories[1], lifecycle_state: 'no_budget', actual_spent: '75.00', is_unbudgeted: true },
  ],
  history: [], ...overrides,
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
  <PageHeaderContext.Provider value={{ setPageHeader }}><Budget /></PageHeaderContext.Provider>
);
const settle = async () => {
  renderPage();
  return screen.findByRole('table', { name: 'תקציבים לפי קטגוריית הוצאה' });
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'request-key') });
  getCategories.mockResolvedValue({ data: categories });
  getFundedBudgetMonth.mockResolvedValue({ data: fundedState() });
  addManualBudgetFunding.mockResolvedValue({ data: {} });
  establishFundedBudget.mockResolvedValue({ data: {} });
  adjustFundedBudget.mockResolvedValue({ data: {} });
  copyBudget.mockResolvedValue({ data: {} });
  removeFundedBudget.mockResolvedValue({ data: {} });
});

describe('canonical funded monthly read', () => {
  it('loads canonical funded totals separately from all actual spending', async () => {
    await settle();
    const month = new Date().toISOString().slice(0, 7);
    expect(getFundedBudgetMonth).toHaveBeenCalledWith(month);
    expect(setPageHeader).toHaveBeenCalledWith({ title: 'תקציב חודשי', subtitle: 'תקציב חודשי ממומן לפי קטגוריה' });
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    const summary = screen.getByLabelText(/סיכום תקציב/);
    expect(within(summary).getByText('₪1,500')).toBeInTheDocument();
    expect(within(summary).getByText('₪1,200')).toBeInTheDocument();
    expect(within(summary).getByText('₪300')).toBeInTheDocument();
    expect(within(summary).getByText('₪825')).toBeInTheDocument();
    expect(screen.getByText(/^הוצאות ללא תקציב פעיל/)).toBeInTheDocument();
    expect(screen.getAllByText('₪75').length).toBeGreaterThan(0);
  });

  it('renders final funded, actual, remaining, and the responsive duplicate', async () => {
    const table = await settle();
    expect(within(table).getByText('ממומן סופי')).toBeInTheDocument();
    expect(within(table).getByText('₪1,200')).toBeInTheDocument();
    expect(within(table).getByText('₪750')).toBeInTheDocument();
    expect(within(table).getByText('₪450')).toBeInTheDocument();
    const mobile = screen.getByRole('list', { name: 'תקציבים לפי קטגוריית הוצאה' });
    expect(within(mobile).getByText('מזון')).toBeInTheDocument();
    expect(within(mobile).getByText('ממומן סופי')).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'עריכת תקציב עבור מזון' })).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'הסרת תקציב פעיל עבור מזון' })).toBeInTheDocument();
    expect(within(mobile).getByRole('button', { name: 'עריכת תקציב עבור מזון' })).toBeInTheDocument();
    expect(within(mobile).getByRole('button', { name: 'הסרת תקציב פעיל עבור מזון' })).toBeInTheDocument();
  });

  it('shows deficit without consuming the unallocated balance', async () => {
    getFundedBudgetMonth.mockResolvedValue({ data: fundedState({
      actuals: { total: '1400.00', budgeted: '1400.00', unbudgeted: '0.00' },
      categories: [categoryState({ actual_spent: '1400.00', remaining: '-200.00', deficit: '200.00' })],
    }) });
    await settle();
    expect(screen.getAllByText('גירעון').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₪200').length).toBeGreaterThan(0);
    expect(within(screen.getByLabelText(/סיכום תקציב/)).getByText('₪300')).toBeInTheDocument();
  });

  it('preserves active zero as a real row', async () => {
    getFundedBudgetMonth.mockResolvedValue({ data: fundedState({
      funding: { ...fundedState().funding, total_allocated: '0.00', active_allocated: '0.00' },
      actuals: { total: '0.00', budgeted: '0.00', unbudgeted: '0.00' },
      categories: [categoryState({ starting_amount: '0.00', adjustment_total: '0.00', final_funded: '0.00', actual_spent: '0.00', remaining: '0.00', is_active_zero: true })],
    }) });
    await settle();
    expect(screen.getAllByText('תקציב אפס פעיל').length).toBeGreaterThan(0);
  });

  it('ignores a stale month response', async () => {
    const first = deferred();
    const second = deferred();
    getFundedBudgetMonth.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderPage();
    fireEvent.change(screen.getByLabelText('חודש התקציב'), { target: { value: '2026-07' } });
    second.resolve({ data: fundedState({ month: '2026-07', categories: [categoryState({ categories: categories[1] })] }) });
    expect((await screen.findAllByText('תחבורה')).length).toBeGreaterThan(0);
    first.resolve({ data: fundedState() });
    await waitFor(() => expect(screen.queryByText('מזון')).not.toBeInTheDocument());
  });

  it('shows the initial skeleton, a retryable load error, and recovers on retry', async () => {
    const first = deferred();
    getFundedBudgetMonth.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ data: fundedState() });
    renderPage();
    expect(screen.getByLabelText('טעינת פירוט התקציב')).toBeInTheDocument();
    first.reject(new Error('network'));
    expect(await screen.findByRole('heading', { name: 'לא ניתן לטעון את התקציב' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));
    expect(await screen.findByRole('table', { name: 'תקציבים לפי קטגוריית הוצאה' })).toBeInTheDocument();
    expect(getFundedBudgetMonth).toHaveBeenCalledTimes(2);
  });

  it('preserves zero, near-limit, fully-used, and over-budget semantics', async () => {
    getFundedBudgetMonth.mockResolvedValue({ data: fundedState({
      categories: [
        categoryState({ budget_id: 1, final_funded: '100.00', actual_spent: '0.00', remaining: '100.00' }),
        categoryState({ budget_id: 2, final_funded: '100.00', actual_spent: '70.00', remaining: '30.00' }),
        categoryState({ budget_id: 3, final_funded: '100.00', actual_spent: '100.00', remaining: '0.00' }),
        categoryState({ budget_id: 4, final_funded: '100.00', actual_spent: '150.00', remaining: '-50.00', deficit: '50.00' }),
      ],
    }) });
    await settle();
    expect(screen.getAllByText('ללא הוצאה').length).toBeGreaterThan(0);
    expect(screen.getAllByText('קרוב למגבלה').length).toBeGreaterThan(0);
    expect(screen.getAllByText('נוצל במלואו').length).toBeGreaterThan(0);
    expect(screen.getAllByText('גירעון').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('progressbar').some((progress) => progress.getAttribute('aria-valuetext') === '150% — גירעון')).toBe(true);
  });

  it('renders and resubmits exact canonical decimals without Number round-tripping', async () => {
    getFundedBudgetMonth.mockResolvedValue({ data: fundedState({
      funding: {
        available: '9007199254740993.31', starting_total: '9007199254740993.31',
        total_allocated: '9007199254740993.31', active_allocated: '9007199254740993.31',
        inactive_retained_funding: '0.00', unallocated: '0.00',
      },
      actuals: { total: '0.30', budgeted: '0.30', unbudgeted: '0.00' },
      categories: [
        categoryState({
          final_funded: '9007199254740993.01', amount: '9007199254740993.01',
          actual_spent: '0.30', remaining: '9007199254740992.71', deficit: '0.00',
        }),
        categoryState({
          budget_id: 12, category_id: 2, categories: categories[1],
          starting_amount: '0.30', adjustment_total: '0.00', final_funded: '0.30',
          amount: '0.30', actual_spent: '0.00', remaining: '0.30', deficit: '0.00',
        }),
      ],
    }) });
    await settle();
    expect(screen.getAllByText('₪9,007,199,254,740,993.01').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₪0.3').length).toBeGreaterThan(0);
    await userEvent.click(screen.getAllByRole('button', { name: 'עריכת תקציב עבור מזון' })[0]);
    const input = screen.getByLabelText('תקציב עבור מזון', { selector: '#budget-amount-desktop-11' });
    expect(input.value).toBe('9007199254740993.01');
    await userEvent.click(screen.getAllByRole('button', { name: 'שמירת תקציב עבור מזון' })[0]);
    expect(adjustFundedBudget).toHaveBeenCalledWith(11, {
      target_amount: '9007199254740993.01', request_key: 'request-key',
    });
  });
});

describe('funded budget commands', () => {
  it('adds confirmed manual funds with a source label and idempotency key', async () => {
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'הוספת כסף זמין' }));
    await waitFor(() => expect(document.getElementById('budget-funding-source')).toBeInTheDocument());
    await userEvent.type(document.getElementById('budget-funding-source'), 'יתרה מאושרת בחשבון');
    await userEvent.type(document.getElementById('budget-funding-amount'), '500');
    await userEvent.click(screen.getAllByRole('button', { name: 'הוספת כסף זמין' })[1]);
    expect(addManualBudgetFunding).toHaveBeenCalledWith({ month: new Date().toISOString().slice(0, 7), amount: '500', source_label: 'יתרה מאושרת בחשבון', request_key: 'request-key' });
    await waitFor(() => expect(getFundedBudgetMonth).toHaveBeenCalledTimes(2));
  });

  it('establishes a first snapshot, including an explicit zero', async () => {
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'הוספת קטגוריה' }));
    const select = await screen.findByLabelText(/^קטגוריית הוצאה/);
    expect(within(select).queryByRole('option', { name: /מזון/ })).not.toBeInTheDocument();
    expect(within(select).getByRole('option', { name: /תחבורה/ })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: /משכורת/ })).not.toBeInTheDocument();
    await userEvent.selectOptions(select, '2');
    await userEvent.type(screen.getByLabelText(/^סכום התקציב/), '0');
    await userEvent.click(screen.getByRole('button', { name: 'הוספה' }));
    expect(establishFundedBudget).toHaveBeenCalledWith({ month: new Date().toISOString().slice(0, 7), category_id: 2, starting_amount: '0', starting_kind: 'manual', request_key: 'request-key' });
  });

  it('surfaces insufficient funding and preserves the entered allocation', async () => {
    establishFundedBudget.mockRejectedValueOnce({ response: { data: { error: 'Insufficient unallocated funds' } } });
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'הוספת קטגוריה' }));
    await userEvent.selectOptions(await screen.findByLabelText(/^קטגוריית הוצאה/), '2');
    await userEvent.type(screen.getByLabelText(/^סכום התקציב/), '640');
    await userEvent.click(screen.getByRole('button', { name: 'הוספה' }));
    expect(await screen.findByText(/אין מספיק כסף שטרם הוקצה/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^סכום התקציב/)).toHaveValue(640);
  });

  it('adjusts final funding through the bounded command', async () => {
    await settle();
    await userEvent.click(screen.getAllByRole('button', { name: 'עריכת תקציב עבור מזון' })[0]);
    const input = screen.getByLabelText('תקציב עבור מזון', { selector: '#budget-amount-desktop-11' });
    await userEvent.clear(input);
    await userEvent.type(input, '1300');
    await userEvent.click(screen.getAllByRole('button', { name: 'שמירת תקציב עבור מזון' })[0]);
    expect(adjustFundedBudget).toHaveBeenCalledWith(11, { target_amount: '1300', request_key: 'request-key' });
    await waitFor(() => expect(getFundedBudgetMonth).toHaveBeenCalledTimes(2));
  });

  it('shows the no-eligible-expense-categories state', async () => {
    getCategories.mockResolvedValue({ data: [categories[0], categories[2]] });
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'הוספת קטגוריה' }));
    expect(screen.getByText('אין קטגוריות נוספות להוספה')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^קטגוריית הוצאה/)).not.toBeInTheDocument();
  });

  it('cancels an edit without sending a mutation', async () => {
    await settle();
    await userEvent.click(screen.getAllByRole('button', { name: 'עריכת תקציב עבור מזון' })[0]);
    const input = screen.getByLabelText('תקציב עבור מזון', { selector: '#budget-amount-desktop-11' });
    await userEvent.clear(input);
    await userEvent.type(input, '825');
    await userEvent.click(screen.getAllByRole('button', { name: 'ביטול עריכת תקציב עבור מזון' })[0]);
    expect(screen.queryByLabelText('תקציב עבור מזון')).not.toBeInTheDocument();
    expect(adjustFundedBudget).not.toHaveBeenCalled();
  });

  it('retains the exact entered value when an edit fails', async () => {
    adjustFundedBudget.mockRejectedValueOnce(new Error('save failed'));
    await settle();
    await userEvent.click(screen.getAllByRole('button', { name: 'עריכת תקציב עבור מזון' })[0]);
    const input = screen.getByLabelText('תקציב עבור מזון', { selector: '#budget-amount-desktop-11' });
    await userEvent.clear(input);
    await userEvent.type(input, '825.37');
    await userEvent.click(screen.getAllByRole('button', { name: 'שמירת תקציב עבור מזון' })[0]);
    expect((await screen.findAllByText(/שמירת התקציב נכשלה/)).length).toBeGreaterThan(0);
    expect(input.value).toBe('825.37');
    expect(getFundedBudgetMonth).toHaveBeenCalledTimes(1);
  });

  it('maps removal to the provenance-preserving command', async () => {
    await settle();
    await userEvent.click(screen.getAllByRole('button', { name: 'הסרת תקציב פעיל עבור מזון' })[0]);
    expect(screen.getByRole('heading', { name: 'הסרת תקציב הקטגוריה' })).toBeInTheDocument();
    expect(screen.getByText(/היסטוריית התקציב וההוצאות נשמרות/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'הסרת התקציב' }));
    expect(removeFundedBudget).toHaveBeenCalledWith(11, { request_key: 'request-key' });
    await waitFor(() => expect(getFundedBudgetMonth).toHaveBeenCalledTimes(2));
  });

  it('cancels removal without mutation and retains the dialog and row after failure', async () => {
    await settle();
    await userEvent.click(screen.getAllByRole('button', { name: 'הסרת תקציב פעיל עבור מזון' })[0]);
    await userEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(removeFundedBudget).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'הסרת תקציב הקטגוריה' })).not.toBeInTheDocument();

    removeFundedBudget.mockRejectedValueOnce(new Error('remove failed'));
    await userEvent.click(screen.getAllByRole('button', { name: 'הסרת תקציב פעיל עבור מזון' })[0]);
    await userEvent.click(screen.getByRole('button', { name: 'הסרת התקציב' }));
    expect(await screen.findByText(/הסרת התקציב נכשלה/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'הסרת תקציב הקטגוריה' })).toBeInTheDocument();
    expect(screen.getAllByText('מזון').length).toBeGreaterThan(0);
    expect(getFundedBudgetMonth).toHaveBeenCalledTimes(1);
  });

  it('copies atomically and reports destination funding failures', async () => {
    copyBudget.mockRejectedValueOnce({ response: { data: { error: 'Insufficient unallocated funds in destination month' } } });
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'העתקת התקציב לחודש אחר' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^חודש יעד/), { target: { value: '2026-09' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'העתקת התקציב' }));
    expect(copyBudget).toHaveBeenCalledWith({ fromMonth: new Date().toISOString().slice(0, 7), toMonth: '2026-09', request_key: 'request-key' });
    expect(await screen.findByText(/Insufficient unallocated funds/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^חודש יעד/)).toHaveValue('2026-09');
  });

  it('closes a successful copy flow and refreshes canonical funded state', async () => {
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'העתקת התקציב לחודש אחר' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/יעדי הקטגוריות.*יועתקו לחודש/)).toBeInTheDocument();
    expect(within(dialog).getByText(/כסף זמין שכבר אושר בחודש היעד/)).toBeInTheDocument();
    expect(within(dialog).getByText(/תנועות והוצאות בפועל אינן מועתקות/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^חודש יעד/), { target: { value: '2026-09' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'העתקת התקציב' }));

    expect(copyBudget).toHaveBeenCalledWith({
      fromMonth: new Date().toISOString().slice(0, 7),
      toMonth: '2026-09',
      request_key: 'request-key',
    });
    await waitFor(() => expect(getFundedBudgetMonth).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders an empty funded month distinctly from a zero active budget', async () => {
    getFundedBudgetMonth.mockResolvedValue({ data: fundedState({
      funding: {
        available: '0.00', starting_total: '0.00', total_allocated: '0.00',
        active_allocated: '0.00', inactive_retained_funding: '0.00', unallocated: '0.00',
      },
      actuals: { total: '0.00', budgeted: '0.00', unbudgeted: '0.00' },
      categories: [],
    }) });
    renderPage();
    expect(await screen.findByRole('heading', { name: /לא הוגדר תקציב/ })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'תקציבים לפי קטגוריית הוצאה' })).not.toBeInTheDocument();
  });
});
