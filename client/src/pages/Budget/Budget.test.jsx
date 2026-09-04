import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import {
  addManualBudgetFunding, applyBudgetMonthClose, applyBudgetReallocation, applyDeficitResolution, copyBudget,
  applyUnbudgetedResolution,
  getBudgetReallocationPreview, getDeficitResolutionPreview,
  getUnbudgetedResolutionPreview,
  getBudgetMonthClosePreview, getCategories, getFundedBudgetMonth, initializeRecurringBudgets, removeBudgetMonthOverride,
  removeFundedBudget, setBudgetMonthOverride, setSettingsCategoryRecurringBudget,
} from '../../services/api';
import Budget from './Budget';

const budgetStyles = readFileSync('src/pages/Budget/Budget.css', 'utf8');

vi.mock('../../services/api', () => ({
  addManualBudgetFunding: vi.fn(), applyBudgetMonthClose: vi.fn(),
  applyBudgetReallocation: vi.fn(), applyDeficitResolution: vi.fn(), copyBudget: vi.fn(),
  applyUnbudgetedResolution: vi.fn(),
  getBudgetReallocationPreview: vi.fn(), getDeficitResolutionPreview: vi.fn(),
  getUnbudgetedResolutionPreview: vi.fn(),
  getBudgetMonthClosePreview: vi.fn(), getCategories: vi.fn(), getFundedBudgetMonth: vi.fn(),
  initializeRecurringBudgets: vi.fn(),
  removeBudgetMonthOverride: vi.fn(),
  removeFundedBudget: vi.fn(),
  setBudgetMonthOverride: vi.fn(),
  setSettingsCategoryRecurringBudget: vi.fn(),
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
  fallback_base: '1000.00', fallback_source: 'manual', recurring_default: '900.00',
  month_override: null, override_adjustment_total: '0.00', effective_base: '1000.00',
  incoming_carryover: '0.00', outgoing_carryover: '0.00', other_adjustments: '200.00',
  incoming_reallocation_resolution: '0.00', outgoing_reallocation: '0.00',
  funding_action_adjustment_total: '0.00',
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
  history: [], funding_action_history: [], action_lifecycle: 'current',
  savings: { balance: '0.00' }, ...overrides,
});

const previousMonth = (month) => {
  const [year, monthNumber] = month.split('-').map(Number);
  return monthNumber === 1
    ? `${year - 1}-12`
    : `${year}-${String(monthNumber - 1).padStart(2, '0')}`;
};

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
  <MemoryRouter><PageHeaderContext.Provider value={{ setPageHeader }}><Budget /></PageHeaderContext.Provider></MemoryRouter>
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
  setBudgetMonthOverride.mockResolvedValue({ data: {} });
  removeBudgetMonthOverride.mockResolvedValue({ data: {} });
  setSettingsCategoryRecurringBudget.mockResolvedValue({ data: {} });
  copyBudget.mockResolvedValue({ data: {} });
  removeFundedBudget.mockResolvedValue({ data: {} });
  initializeRecurringBudgets.mockResolvedValue({ data: {} });
  applyBudgetMonthClose.mockResolvedValue({ data: {} });
  applyBudgetReallocation.mockResolvedValue({ data: {} });
  applyDeficitResolution.mockResolvedValue({ data: {} });
  applyUnbudgetedResolution.mockResolvedValue({ data: {} });
  getBudgetReallocationPreview.mockResolvedValue({ data: {
    can_apply: true, fingerprint: '1234567890abcdef1234567890abcdef',
    source_capacity: '450.00', destination_before: '0.00', destination_after: '100.00',
    unallocated_after: '300.00',
  } });
  getDeficitResolutionPreview.mockResolvedValue({ data: {
    can_apply: true, fingerprint: 'abcdefabcdefabcdefabcdefabcdefab',
    requested_resolution: '350.00', resulting_funded: '1350.00', remaining_deficit: '150.00',
  } });
  getUnbudgetedResolutionPreview.mockResolvedValue({ data: {
    can_apply: true, fingerprint: 'abcdefabcdefabcdefabcdefabcdefab',
    resolution_mode: 'created', resulting_funded: '75.00', remaining_deficit: '0.00',
  } });
  getBudgetMonthClosePreview.mockResolvedValue({ data: null });
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
    expect(within(summary).getByText('נותר בתקציבים')).toBeInTheDocument();
    expect(within(summary).getByText('₪450')).toBeInTheDocument();
    expect(within(summary).getByText('טרם הוקצה')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'הוצאות מחוץ לתקציב' })).toBeInTheDocument();
    expect(screen.getByText(/תחבורה/)).toBeInTheDocument();
    expect(within(screen.getByLabelText('סך הוצאות מחוץ לתקציב')).getByText('₪75')).toBeInTheDocument();
  });

  it('renders every active funded row in both desktop and mobile views', async () => {
    getFundedBudgetMonth.mockResolvedValue({ data: fundedState({
      funding: { ...fundedState().funding, total_allocated: '1700.00', active_allocated: '1700.00' },
      categories: [
        categoryState(),
        categoryState({
          budget_id: 12, category_id: 2, categories: categories[1],
          starting_amount: '500.00', fallback_base: '500.00', effective_base: '500.00',
          adjustment_total: '0.00', other_adjustments: '0.00', final_funded: '500.00',
          amount: '500.00', actual_spent: '0.00', remaining: '500.00',
        }),
      ],
    }) });

    const table = await settle();
    const mobile = screen.getByRole('list', { name: 'תקציבים לפי קטגוריית הוצאה' });
    expect(within(table).getByText('מזון')).toBeInTheDocument();
    expect(within(table).getByText('תחבורה')).toBeInTheDocument();
    expect(within(mobile).getByText('מזון')).toBeInTheDocument();
    expect(within(mobile).getByText('תחבורה')).toBeInTheDocument();
  });

  it('renders all unbudgeted expenses as one responsive financial list with bounded actions', async () => {
    const unbudgeted = [
      [3, 'Electronics', '🔌', '17.90', '₪17.9'],
      [10, 'לא ידוע', '❓', '2607.70', '₪2,607.7'],
      [11, 'תחבורה ציבורית', '🚌', '264.00', '₪264'],
      [14, 'בילוי ופנאי', '🎭', '536.00', '₪536'],
      [15, 'סופר פארם', '🧴', '466.86', '₪466.86'],
      [16, 'מנוי', '🧾', '1602.72', '₪1,602.72'],
      [20, 'צעצועים ומשחקים', '🧸', '1160.86', '₪1,160.86'],
      [31, 'קניות באינטרנט', '🛒', '492.87', '₪492.87'],
      [32, 'פיננסי / עמלות / ריביות', '🏦', '68.00', '₪68'],
      [37, 'כבישי אגרה', '🛣️', '17.49', '₪17.49'],
      [40, 'אינטרנט', '🌐', '439.92', '₪439.92'],
      [47, 'רפואה פרטית', '🩺', '2980.00', '₪2,980'],
    ];
    getFundedBudgetMonth.mockResolvedValue({ data: fundedState({
      actuals: { total: '11404.32', budgeted: '750.00', unbudgeted: '10654.32' },
      categories: [
        categoryState(),
        ...unbudgeted.map(([categoryId, name, icon, actualSpent]) => ({
          budget_id: null,
          category_id: categoryId,
          categories: { name, icon, type: 'expense', is_active: true },
          lifecycle_state: 'no_budget',
          actual_spent: actualSpent,
          is_unbudgeted: true,
        })),
      ],
    }) });

    await settle();
    const details = screen.getByRole('table', { name: 'פירוט הוצאות מחוץ לתקציב' });
    expect(details).toHaveAttribute('data-responsive-layout', 'table-to-stacked-rows');
    expect(within(details).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'קטגוריה', 'סכום בפועל', 'מצב', 'פעולות',
    ]);
    expect(within(details).getAllByRole('row')).toHaveLength(13);
    unbudgeted.forEach(([, name, , , displayedAmount]) => {
      const row = within(details).getByRole('row', { name: `${name}, ללא תקציב` });
      expect(within(row).getByText(name)).toBeInTheDocument();
      expect(row).toHaveTextContent(displayedAmount);
      expect(within(row).getByText('ללא תקציב')).toBeInTheDocument();
      expect(row.querySelector('.budget-unbudgeted-panel__category')).toBeInTheDocument();
      expect(row.querySelector('.budget-unbudgeted-panel__amount')).toBeInTheDocument();
      expect(row.querySelector('.budget-unbudgeted-panel__actions')).toBeInTheDocument();
      expect(within(row).getByText('סכום בפועל')).toHaveClass('budget-unbudgeted-panel__mobile-label');
    });
    expect(within(details).getAllByRole('button', { name: 'הקצה תקציב' })).toHaveLength(12);
    expect(within(details).getAllByRole('button', { name: 'בדוק / תקן תנועות' })).toHaveLength(12);
    expect(within(screen.getByLabelText('סך הוצאות מחוץ לתקציב')).getByText('₪10,654.32')).toBeInTheDocument();
    expect(getUnbudgetedResolutionPreview).not.toHaveBeenCalled();
    expect(applyUnbudgetedResolution).not.toHaveBeenCalled();
  });

  it('stacks unbudgeted rows on mobile without a forced horizontal table', () => {
    expect(budgetStyles).toMatch(/@media \(max-width: 820px\)[\s\S]*\.budget-unbudgeted-panel__row[\s\S]*grid-template-areas:/);
    expect(budgetStyles).toMatch(/\.budget-unbudgeted-panel__actions > \*[\s\S]*width: 100% !important/);
    expect(budgetStyles).not.toMatch(/\.budget-unbudgeted-panel__table\s*\{[^}]*overflow-x\s*:/);
  });

  it('shows pending carryover read-only and navigates to the source month close workflow', async () => {
    const destinationMonth = fundedState().month;
    const sourceMonth = previousMonth(destinationMonth);
    getFundedBudgetMonth.mockResolvedValue({ data: fundedState({
      carryover: {
        eligible: true,
        source_month: sourceMonth,
        destination_month: destinationMonth,
        total_incoming: '11100.09',
        ready_count: 4,
        ready_categories: [
          { category_id: 1, category: categories[0], amount: '264.09' },
          { category_id: 2, category: categories[1], amount: '10836.00' },
        ],
        blocked_categories: [{ category_id: 23, reason: 'SOURCE_BUDGET_MISSING' }],
        already_applied_categories: [],
      },
    }) });
    getBudgetMonthClosePreview.mockResolvedValue({ data: {
      source_month: sourceMonth, destination_month: destinationMonth,
      fingerprint: '0123456789abcdef0123456789abcdef', categories: [],
      carry_forward_total: '0.00', return_to_unallocated_total: '0.00', savings_total: '0.00',
      destination_unallocated_before: '0.00', destination_unallocated_after: '0.00',
      savings_balance_after: '0.00', deficit_blockers: [], unbudgeted_expense_blockers: [],
      can_apply: false,
    } });

    await settle();
    expect(screen.getByText(/יש יתרות מ.*שממתינות לטיפול/)).toBeInTheDocument();
    const carryoverSummary = screen.getByLabelText('סיכום יתרות שממתינות לטיפול');
    expect(within(carryoverSummary).getByText('₪11,100.09')).toBeInTheDocument();
    expect(within(carryoverSummary).getByText('4')).toBeInTheDocument();
    expect(within(carryoverSummary).getByText('1')).toBeInTheDocument();
    expect(applyBudgetMonthClose).not.toHaveBeenCalled();
    expect(getBudgetMonthClosePreview).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /סקירה וסגירת/ }));
    await waitFor(() => expect(getBudgetMonthClosePreview).toHaveBeenCalledWith(sourceMonth));
    expect(screen.getByLabelText('חודש התקציב')).toHaveValue(sourceMonth);
    expect(await screen.findByText('סקירה וסגירת חודש')).toBeInTheDocument();
    expect(applyBudgetMonthClose).not.toHaveBeenCalled();
  });

  it('renders final funded, actual, remaining, and the responsive duplicate', async () => {
    const table = await settle();
    expect(within(table).getByText('ממומן סופי')).toBeInTheDocument();
    expect(within(table).getByText('₪1,200')).toBeInTheDocument();
    expect(within(table).getByText('₪750')).toBeInTheDocument();
    expect(within(table).getByText('₪450')).toBeInTheDocument();
    const mobile = screen.getByRole('list', { name: 'תקציבים לפי קטגוריית הוצאה' });
    expect(within(mobile).getByText('מזון')).toBeInTheDocument();
    expect(within(mobile).getByText('זמין')).toBeInTheDocument();
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
          fallback_base: '9007199254740993.01', effective_base: '9007199254740993.01',
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
    const input = document.getElementById('budget-amount-desktop-11');
    expect(input.value).toBe('9007199254740993.01');
    await userEvent.click(screen.getAllByRole('button', { name: /שינוי לחודש זה בלבד/ })[0]);
    expect(setBudgetMonthOverride).toHaveBeenCalledWith(new Date().toISOString().slice(0, 7), 1, {
      amount: '9007199254740993.01', request_key: 'request-key',
    });
  });
});

describe('funded budget commands', () => {
  it('previews recurring defaults without mutation and applies them only after explicit confirmation', async () => {
    getFundedBudgetMonth.mockResolvedValue({ data: fundedState({
      recurring: {
        eligible: true, initialized: false, pending_count: 2,
        pending_categories: [
          { category_id: 1, category: categories[0], amount: '100.00' },
          { category_id: 2, category: categories[1], amount: '0.00' },
        ],
        required: '100.00', unallocated: '300.00', shortfall: '0.00', can_apply: true,
      },
    }) });
    await settle();
    expect(initializeRecurringBudgets).not.toHaveBeenCalled();
    expect(screen.getByText('תקציבים חוזרים ממתינים')).toBeInTheDocument();
    expect(screen.getByLabelText('סיכום תקציבים חוזרים')).toHaveTextContent('₪100');
    await userEvent.click(screen.getByRole('button', { name: 'החלת תקציבים חוזרים' }));
    expect(initializeRecurringBudgets).toHaveBeenCalledWith({
      month: new Date().toISOString().slice(0, 7), request_key: 'request-key',
    });
    await waitFor(() => expect(getFundedBudgetMonth).toHaveBeenCalledTimes(2));
  });

  it('shows the exact recurring shortfall and routes to manual funding without initializing', async () => {
    getFundedBudgetMonth.mockResolvedValue({ data: fundedState({
      recurring: {
        eligible: true, initialized: false, pending_count: 1,
        pending_categories: [{ category_id: 2, category: categories[1], amount: '500.00' }],
        required: '500.00', unallocated: '300.00', shortfall: '200.00', can_apply: false,
      },
    }) });
    await settle();
    expect(screen.getByText('חסר').parentElement).toHaveTextContent('₪200');
    expect(screen.queryByRole('button', { name: 'החלת תקציבים חוזרים' })).not.toBeInTheDocument();
    const fundingButtons = screen.getAllByRole('button', { name: 'הוספת כסף זמין' });
    await userEvent.click(fundingButtons[fundingButtons.length - 1]);
    expect(document.getElementById('budget-funding-source')).toBeInTheDocument();
    expect(initializeRecurringBudgets).not.toHaveBeenCalled();
  });

  it('previews a mixed month close without mutation and applies only after confirmation', async () => {
    const preview = {
      source_month: '2026-08', destination_month: '2026-09',
      fingerprint: '0123456789abcdef0123456789abcdef',
      categories: [{
        category_id: 1, category: categories[0], policy: 'savings',
        eligible_unused: '400.00', status: 'ready', blocked_reason: null,
      }],
      carry_forward_total: '0.00', return_to_unallocated_total: '0.00', savings_total: '400.00',
      destination_unallocated_before: '300.00', destination_unallocated_after: '300.00',
      savings_balance_after: '400.00', deficit_blockers: [], unbudgeted_expense_blockers: [],
      can_apply: true,
    };
    getBudgetMonthClosePreview.mockResolvedValue({ data: preview });
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'חודש קודם' }));
    expect(await screen.findByText('סקירה וסגירת חודש')).toBeInTheDocument();
    expect(applyBudgetMonthClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('סיכום סגירת חודש')).toHaveTextContent('₪400');
    await userEvent.click(screen.getByRole('button', { name: 'אישור וסגירת החודש' }));
    expect(applyBudgetMonthClose).toHaveBeenCalledWith({
      source_month: expect.stringMatching(/^\d{4}-\d{2}$/),
      request_key: 'request-key', preview_fingerprint: preview.fingerprint,
    });
  });

  it('retains the close review when PostgreSQL reports a stale preview', async () => {
    getBudgetMonthClosePreview.mockResolvedValue({ data: {
      source_month: '2026-08', destination_month: '2026-09',
      fingerprint: '0123456789abcdef0123456789abcdef',
      categories: [{ category_id: 1, category: categories[0], policy: 'carry_forward', eligible_unused: '400.00', status: 'ready' }],
      carry_forward_total: '400.00', return_to_unallocated_total: '0.00', savings_total: '0.00',
      destination_unallocated_before: '0.00', destination_unallocated_after: '0.00', savings_balance_after: '0.00',
      deficit_blockers: [], unbudgeted_expense_blockers: [], can_apply: true,
    } });
    applyBudgetMonthClose.mockRejectedValue({
      response: { data: { code: 'MONTH_DISPOSITION_PREVIEW_STALE' } },
    });
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'חודש קודם' }));
    await userEvent.click(await screen.findByRole('button', { name: 'אישור וסגירת החודש' }));
    expect(await screen.findByText('סקירת סגירת החודש השתנתה. רעננו ובדקו שוב לפני האישור.')).toBeInTheDocument();
    expect(screen.getByText('סקירה וסגירת חודש')).toBeInTheDocument();
  });

  it('shows carryover composition separately from the immutable base', async () => {
    getFundedBudgetMonth.mockResolvedValue({ data: fundedState({
      categories: [categoryState({
        starting_amount: '1000.00',
        adjustment_total: '400.00',
        incoming_carryover: '400.00',
        final_funded: '1400.00',
        actual_spent: '600.00',
        remaining: '800.00',
      })],
    }) });
    await settle();
    expect(screen.getAllByText(/בסיס/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/יתרה מחודש קודם/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('₪1,400').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₪400').length).toBeGreaterThan(0);
  });

  it('shows close blockers and never calls apply while deficits remain', async () => {
    getBudgetMonthClosePreview.mockResolvedValue({ data: {
      source_month: '2026-08', destination_month: '2026-09',
      fingerprint: '0123456789abcdef0123456789abcdef', categories: [],
      carry_forward_total: '0.00', return_to_unallocated_total: '0.00', savings_total: '0.00',
      destination_unallocated_before: '0.00', destination_unallocated_after: '0.00', savings_balance_after: '0.00',
      deficit_blockers: [{ category_id: 1 }], unbudgeted_expense_blockers: [{ category_id: 2 }],
      can_apply: false,
    } });
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'חודש קודם' }));
    expect(await screen.findByText(/לא ניתן לסגור את החודש/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'אישור וסגירת החודש' })).not.toBeInTheDocument();
    expect(applyBudgetMonthClose).not.toHaveBeenCalled();
  });

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

  it('stores an uninitialized month-only base, including an explicit zero', async () => {
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'הוספת קטגוריה' }));
    const select = await screen.findByLabelText(/^קטגוריית הוצאה/);
    expect(within(select).queryByRole('option', { name: /מזון/ })).not.toBeInTheDocument();
    expect(within(select).getByRole('option', { name: /תחבורה/ })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: /משכורת/ })).not.toBeInTheDocument();
    await userEvent.selectOptions(select, '2');
    await userEvent.type(screen.getByLabelText(/^סכום התקציב/), '0');
    await userEvent.click(screen.getByRole('button', { name: 'הוספה' }));
    expect(setBudgetMonthOverride).toHaveBeenCalledWith(
      new Date().toISOString().slice(0, 7), 2, { amount: '0', request_key: 'request-key' },
    );
  });

  it('surfaces insufficient funding and preserves the entered allocation', async () => {
    setBudgetMonthOverride.mockRejectedValueOnce({ response: { data: { error: 'Insufficient unallocated funds' } } });
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'הוספת קטגוריה' }));
    await userEvent.selectOptions(await screen.findByLabelText(/^קטגוריית הוצאה/), '2');
    await userEvent.type(screen.getByLabelText(/^סכום התקציב/), '640');
    await userEvent.click(screen.getByRole('button', { name: 'הוספה' }));
    expect(await screen.findByText(/אין מספיק כסף שטרם הוקצה/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^סכום התקציב/)).toHaveValue(640);
  });

  it('changes only the selected month base through the bounded override command', async () => {
    await settle();
    await userEvent.click(screen.getAllByRole('button', { name: 'עריכת תקציב עבור מזון' })[0]);
    const input = document.getElementById('budget-amount-desktop-11');
    await userEvent.clear(input);
    await userEvent.type(input, '1300');
    await userEvent.click(screen.getAllByRole('button', { name: /שינוי לחודש זה בלבד/ })[0]);
    expect(setBudgetMonthOverride).toHaveBeenCalledWith(new Date().toISOString().slice(0, 7), 1, {
      amount: '1300', request_key: 'request-key',
    });
    await waitFor(() => expect(getFundedBudgetMonth).toHaveBeenCalledTimes(2));
  });

  it('keeps recurring-default updates explicit and removes an existing month override separately', async () => {
    getFundedBudgetMonth.mockResolvedValue({ data: fundedState({
      categories: [categoryState({
        month_override: '1500.00', effective_base: '1500.00',
        incoming_carryover: '400.00', other_adjustments: '100.00', final_funded: '2000.00',
      })],
    }) });
    await settle();
    expect(screen.getAllByText(/בסיס מקורי/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/בסיס אפקטיבי/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/יתרה מחודש קודם/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/התאמות אחרות/).length).toBeGreaterThan(0);

    await userEvent.click(screen.getAllByRole('button', { name: 'עריכת תקציב עבור מזון' })[0]);
    const input = document.getElementById('budget-amount-desktop-11');
    await userEvent.clear(input);
    await userEvent.type(input, '1600');
    await userEvent.click(screen.getAllByRole('button', { name: 'עדכון התקציב החודשי הקבוע' })[0]);
    expect(setSettingsCategoryRecurringBudget).toHaveBeenCalledWith(1, { amount: '1600' });
    expect(setBudgetMonthOverride).not.toHaveBeenCalled();

    await waitFor(() => expect(getFundedBudgetMonth).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getAllByRole('button', { name: 'עריכת תקציב עבור מזון' })[0]);
    await userEvent.click(screen.getAllByRole('button', { name: 'הסר שינוי לחודש זה' })[0]);
    expect(removeBudgetMonthOverride).toHaveBeenCalledWith(
      new Date().toISOString().slice(0, 7), 1, { request_key: 'request-key' },
    );
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
    const input = document.getElementById('budget-amount-desktop-11');
    await userEvent.clear(input);
    await userEvent.type(input, '825');
    await userEvent.click(screen.getAllByRole('button', { name: 'ביטול עריכת תקציב עבור מזון' })[0]);
    expect(document.getElementById('budget-amount-desktop-11')).not.toBeInTheDocument();
    expect(setBudgetMonthOverride).not.toHaveBeenCalled();
  });

  it('retains the exact entered value when an edit fails', async () => {
    setBudgetMonthOverride.mockRejectedValueOnce(new Error('save failed'));
    await settle();
    await userEvent.click(screen.getAllByRole('button', { name: 'עריכת תקציב עבור מזון' })[0]);
    const input = document.getElementById('budget-amount-desktop-11');
    await userEvent.clear(input);
    await userEvent.type(input, '825.37');
    await userEvent.click(screen.getAllByRole('button', { name: /שינוי לחודש זה בלבד/ })[0]);
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

  it('previews and applies a current-month category reallocation without mutating on open', async () => {
    getFundedBudgetMonth.mockResolvedValue({ data: fundedState({
      categories: [
        categoryState({ sourceCapacity: '450.00' }),
        categoryState({
          budget_id: 12, category_id: 2, categories: categories[1],
          starting_amount: '500.00', fallback_base: '500.00', effective_base: '500.00',
          adjustment_total: '0.00', other_adjustments: '0.00', final_funded: '500.00',
          actual_spent: '0.00', remaining: '500.00', sourceCapacity: '500.00',
        }),
      ],
    }) });
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'העברת תקציב' }));
    expect(getBudgetReallocationPreview).not.toHaveBeenCalled();
    fireEvent.change(document.getElementById('budget-reallocation-source'), { target: { value: 'category:1' } });
    fireEvent.change(document.getElementById('budget-reallocation-destination'), { target: { value: 'category:2' } });
    fireEvent.change(document.getElementById('budget-reallocation-amount'), { target: { value: '100.00' } });
    await userEvent.click(screen.getByRole('button', { name: 'סקירת ההעברה' }));
    expect(getBudgetReallocationPreview).toHaveBeenCalledWith(fundedState().month, {
      source_kind: 'category', source_category_id: 1,
      destination_kind: 'category', destination_category_id: 2, amount: '100.00',
    });
    expect(applyBudgetReallocation).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'העברת התקציב' }));
    expect(applyBudgetReallocation).toHaveBeenCalledWith(fundedState().month, {
      source_kind: 'category', source_category_id: 1,
      destination_kind: 'category', destination_category_id: 2, amount: '100.00',
      request_key: 'request-key', preview_fingerprint: '1234567890abcdef1234567890abcdef',
    });
  });

  it('submits an exact multi-source partial deficit resolution and retains choices on stale preview', async () => {
    getFundedBudgetMonth.mockResolvedValue({ data: fundedState({
      savings: { balance: '500.00' },
      categories: [
        categoryState({
          budget_id: 11, category_id: 1, final_funded: '1000.00', actual_spent: '1500.00',
          remaining: '-500.00', deficit: '500.00', sourceCapacity: '0.00',
        }),
        categoryState({
          budget_id: 12, category_id: 2, categories: categories[1],
          starting_amount: '500.00', fallback_base: '500.00', effective_base: '500.00',
          adjustment_total: '0.00', other_adjustments: '0.00', final_funded: '500.00',
          actual_spent: '100.00', remaining: '400.00', sourceCapacity: '400.00',
        }),
      ],
    }) });
    applyDeficitResolution.mockRejectedValue({
      response: { data: { error: 'DEFICIT_RESOLUTION_PREVIEW_STALE: refresh' } },
    });
    await settle();
    const resolveButtons = screen.getAllByRole('button', { name: 'פתרון חריגה' });
    expect(resolveButtons).toHaveLength(2);
    await userEvent.click(resolveButtons[0]);
    fireEvent.change(document.getElementById('deficit-source-unallocated'), { target: { value: '100.00' } });
    fireEvent.change(document.getElementById('deficit-source-savings'), { target: { value: '100.00' } });
    fireEvent.change(document.getElementById('deficit-source-12'), { target: { value: '150.00' } });
    await userEvent.click(screen.getByRole('button', { name: 'סקירת המימון' }));
    const legs = [
      { source_kind: 'unallocated', amount: '100.00' },
      { source_kind: 'savings', amount: '100.00' },
      { source_kind: 'category', category_id: 2, amount: '150.00' },
    ];
    expect(getDeficitResolutionPreview).toHaveBeenCalledWith(fundedState().month, 1, { legs });
    expect(screen.getByLabelText('סקירת פתרון חריגה')).toHaveTextContent('150');
    await userEvent.click(screen.getByRole('button', { name: 'פתרון החריגה' }));
    expect(applyDeficitResolution).toHaveBeenCalledWith(fundedState().month, 1, {
      legs, request_key: 'request-key', preview_fingerprint: 'abcdefabcdefabcdefabcdefabcdefab',
    });
    expect(await screen.findByText('DEFICIT_RESOLUTION_PREVIEW_STALE: refresh')).toBeInTheDocument();
    expect(document.getElementById('deficit-source-unallocated')).toHaveValue(100);
    expect(document.getElementById('deficit-source-savings')).toHaveValue(100);
    expect(document.getElementById('deficit-source-12')).toHaveValue(150);
  });

  it('limits Move budget to current month while keeping deficit resolution in the completed unclosed month', async () => {
    const current = fundedState().month;
    getFundedBudgetMonth.mockImplementation((month) => Promise.resolve({ data: fundedState({
      month,
      action_lifecycle: month === current ? 'current' : 'immediately_completed_unclosed',
      categories: [categoryState({
        final_funded: '1000.00', actual_spent: '1200.00', remaining: '-200.00', deficit: '200.00',
      })],
    }) }));
    await settle();
    expect(screen.getByRole('button', { name: 'העברת תקציב' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'חודש קודם' }));
    await waitFor(() => expect(getFundedBudgetMonth).toHaveBeenLastCalledWith(previousMonth(current)));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'העברת תקציב' })).not.toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: 'פתרון חריגה' })).toHaveLength(2);
  });

  it('keeps reallocation and resolution provenance separate from base, carryover, and residual adjustments', async () => {
    getFundedBudgetMonth.mockResolvedValue({ data: fundedState({
      categories: [categoryState({
        incoming_carryover: '400.00', other_adjustments: '100.00',
        incoming_reallocation_resolution: '200.00', outgoing_reallocation: '50.00',
        funding_action_adjustment_total: '150.00', final_funded: '1650.00', remaining: '900.00',
      })],
    }) });
    await settle();
    expect(screen.getAllByText(/יתרה מחודש קודם/)).toHaveLength(2);
    expect(screen.getAllByText(/הקצאה מחדש \/ פתרון חריגה/)).toHaveLength(2);
    expect(screen.getAllByText(/הועבר ליעד אחר/)).toHaveLength(2);
    expect(screen.getAllByText(/התאמות אחרות/)).toHaveLength(2);
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

  it('previews and applies an explicit allocation from an unbudgeted row', async () => {
    await settle();
    expect(screen.getByRole('button', { name: 'בדוק / תקן תנועות' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'הקצה תקציב' }));
    const dialog = screen.getByRole('dialog', { name: /יצירת תקציב חודשי/ });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText('סכום להקצאה')).toHaveValue(75);
    await userEvent.type(screen.getByLabelText(/כסף פנוי/), '75');
    await userEvent.click(screen.getByRole('button', { name: 'סקירת ההקצאה' }));
    await waitFor(() => expect(getUnbudgetedResolutionPreview).toHaveBeenCalledWith(
      new Date().toISOString().slice(0, 7), 2,
      { requested_amount: '75.00', legs: [{ source_kind: 'unallocated', amount: '75' }] }
    ));
    await userEvent.click(within(dialog).getByRole('button', { name: 'הקצה תקציב לחודש זה' }));
    await waitFor(() => expect(applyUnbudgetedResolution).toHaveBeenCalledWith(
      new Date().toISOString().slice(0, 7), 2,
      expect.objectContaining({
        requested_amount: '75.00', legs: [{ source_kind: 'unallocated', amount: '75' }],
        request_key: 'request-key', preview_fingerprint: 'abcdefabcdefabcdefabcdefabcdefab',
      })
    ));
  });

  it('labels inactive resolution as reactivation and retains inputs after stale failure', async () => {
    getFundedBudgetMonth.mockResolvedValue({ data: fundedState({
      categories: [categoryState(), {
        budget_id: 22, category_id: 2, categories: categories[1], lifecycle_state: 'inactive',
        final_funded: '100.00', actual_spent: '175.00', is_unbudgeted: true,
      }],
      actuals: { total: '925.00', budgeted: '750.00', unbudgeted: '175.00' },
    }) });
    applyUnbudgetedResolution.mockRejectedValue({ response: { data: {
      error: 'UNBUDGETED_RESOLUTION_PREVIEW_STALE: refresh',
    } } });
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'הקצה תקציב' }));
    const dialog = screen.getByRole('dialog', { name: /הפעלת תקציב מחדש/ });
    expect(dialog).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('סכום להקצאה'));
    await userEvent.type(screen.getByLabelText('סכום להקצאה'), '75');
    await userEvent.type(screen.getByLabelText(/כסף פנוי/), '75');
    await userEvent.click(screen.getByRole('button', { name: 'סקירת ההקצאה' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'הקצה תקציב לחודש זה' }));
    expect(await screen.findByText(/UNBUDGETED_RESOLUTION_PREVIEW_STALE/)).toBeInTheDocument();
    expect(screen.getByLabelText('סכום להקצאה')).toHaveValue(75);
    expect(screen.getByLabelText(/כסף פנוי/)).toHaveValue(75);
  });
});
