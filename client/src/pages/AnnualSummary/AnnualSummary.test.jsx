import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import { getAnnualBudgetSummary, getMonthlyCategoryBreakdown } from '../../services/api';
import AnnualSummary from './AnnualSummary';

vi.mock('../../services/api', () => ({
  getAnnualBudgetSummary: vi.fn(),
  getMonthlyCategoryBreakdown: vi.fn(),
}));

vi.mock('recharts', () => ({
  BarChart: ({ children, data, barCategoryGap, barGap }) => (
    <svg
      data-testid="annual-chart"
      data-months={data.length}
      data-category-gap={barCategoryGap}
      data-bar-gap={barGap}
    >
      {children}
    </svg>
  ),
  Bar: ({ children, dataKey, barSize, radius }) => (
    <g data-testid={`annual-bar-${dataKey}`} data-bar-size={barSize} data-radius={radius.join(',')}>
      {children}
    </g>
  ),
  Cell: () => null,
  CartesianGrid: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const currentYear = new Date().getFullYear();
const monthLabels = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const months = monthLabels.map((_, index) => `${currentYear}-${String(index + 1).padStart(2, '0')}`);

const annualData = (overrides = {}) => ({
  year: currentYear,
  summary: {
    yearly_planned: 20400,
    yearly_actual: 17700,
    remaining: 2700,
    budgeted_expenses: 17200,
    non_budgeted_expenses: 500,
    monthly_average: 2212.5,
    projected_year_end: 26550,
    months_with_data: 8,
    months_with_budget: 8,
    allowance_per_remaining_month: 675,
    ...overrides.summary,
  },
  monthly: monthLabels.map((label, index) => ({
    month: months[index],
    label,
    planned: index < 8 ? 2550 : 0,
    actual: index < 8 ? 2000 + (index * 50) : 0,
  })),
  categories: [
    { category_id: 1, name: 'מזון', icon: '🍎', planned: 12000, actual: 9000, diff: 3000, pct_used: 75 },
    { category_id: 2, name: 'תחבורה', icon: '🚌', planned: 6000, actual: 7200, diff: -1200, pct_used: 120 },
    { category_id: 3, name: 'ביטוחים', icon: '🛡️', planned: 2400, actual: 0, diff: 2400, pct_used: 0 },
  ],
  non_budgeted: {
    total: 500,
    by_category: [
      { category_id: 9, name: 'מסעדות', icon: '🍽️', total: 300 },
      { category_id: null, name: 'ללא קטגוריה', icon: null, total: 200 },
    ],
  },
  ...overrides,
});

const matrixCell = (planned, actual) => ({
  planned,
  actual,
  diff: planned === null ? -actual : planned - actual,
});

const breakdownData = () => ({
  year: currentYear,
  months,
  monthLabels,
  rows: [
    {
      category_id: 1,
      name: 'מזון',
      icon: '🍎',
      is_budgeted_any_month: true,
      months: Object.fromEntries(months.map((month, index) => [month, matrixCell(1000, index < 8 ? 800 : 0)])),
      yearly: matrixCell(12000, 6400),
    },
    {
      category_id: null,
      name: 'ללא קטגוריה',
      icon: null,
      is_budgeted_any_month: false,
      months: Object.fromEntries(months.map((month, index) => [month, matrixCell(null, index === 6 ? 125 : 0)])),
      yearly: matrixCell(null, 125),
    },
  ],
  totals: {
    months: Object.fromEntries(months.map((month, index) => [month, matrixCell(1000, index < 8 ? 800 : 0)])),
    yearly: matrixCell(12000, 6525),
  },
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
    <AnnualSummary />
  </PageHeaderContext.Provider>,
);

const settle = async () => {
  renderPage();
  return screen.findByRole('heading', { name: 'מתוכנן מול בפועל' });
};

beforeEach(() => {
  vi.clearAllMocks();
  getAnnualBudgetSummary.mockResolvedValue({ data: annualData() });
  getMonthlyCategoryBreakdown.mockResolvedValue({ data: breakdownData() });
});

describe('annual year loading and page states', () => {
  it('uses the shell title and requests the existing default calendar year', async () => {
    await settle();
    expect(setPageHeader).toHaveBeenCalledWith({
      title: 'סיכום שנתי',
      subtitle: 'ניתוח תקציב מול הוצאות לאורך השנה',
    });
    expect(getAnnualBudgetSummary).toHaveBeenCalledWith(currentYear);
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('loads a selected supported year and ignores the previous stale response', async () => {
    const firstRequest = deferred();
    const secondRequest = deferred();
    getAnnualBudgetSummary.mockReturnValueOnce(firstRequest.promise).mockReturnValueOnce(secondRequest.promise);
    renderPage();

    fireEvent.change(screen.getByLabelText('שנה'), { target: { value: String(currentYear - 1) } });
    await waitFor(() => expect(getAnnualBudgetSummary).toHaveBeenLastCalledWith(currentYear - 1));
    secondRequest.resolve({ data: annualData({ year: currentYear - 1, summary: { yearly_planned: 3333 } }) });
    expect(await screen.findAllByText('₪3,333')).not.toHaveLength(0);
    firstRequest.resolve({ data: annualData({ summary: { yearly_planned: 9999 } }) });

    await waitFor(() => expect(screen.queryByText('₪9,999')).not.toBeInTheDocument());
  });

  it('shows a skeleton, a retryable initial error, and a truthful empty year', async () => {
    const request = deferred();
    getAnnualBudgetSummary.mockReturnValueOnce(request.promise).mockResolvedValueOnce({ data: annualData() });
    const page = renderPage();
    expect(screen.getByRole('status', { name: 'טעינת הסיכום השנתי' })).toBeInTheDocument();
    request.reject(new Error('network'));
    expect(await screen.findByRole('heading', { name: 'טעינת הסיכום השנתי נכשלה' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));
    expect(await screen.findByRole('heading', { name: 'מתוכנן מול בפועל' })).toBeInTheDocument();
    page.unmount();

    getAnnualBudgetSummary.mockResolvedValue({ data: annualData({ summary: { yearly_planned: 0, yearly_actual: 0 } }) });
    renderPage();
    expect(await screen.findByRole('heading', { name: `אין נתונים לשנת ${currentYear}` })).toBeInTheDocument();
    expect(screen.queryByText('תקציב שנתי מתוכנן')).not.toBeInTheDocument();
  });
});

describe('annual metrics, forecast, chart, and classifications', () => {
  it('renders the six real annual metrics from the response', async () => {
    await settle();
    expect(screen.getByText('תקציב שנתי מתוכנן')).toBeInTheDocument();
    expect(screen.getByText('הוצאה שנתית בפועל')).toBeInTheDocument();
    expect(screen.getByText('נותר מהתקציב')).toBeInTheDocument();
    expect(screen.getByText('ממוצע הוצאה חודשי')).toBeInTheDocument();
    expect(screen.getByText('הוצאה בקטגוריות מתוקצבות')).toBeInTheDocument();
    expect(screen.getByText('הוצאה לא מתוקצבת')).toBeInTheDocument();
    expect(screen.getAllByText('₪20,400').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₪17,700').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₪2,700').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₪2,212.5').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₪17,200').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₪500').length).toBeGreaterThan(0);
  });

  it('uses explicit overrun semantics without changing the response value', async () => {
    getAnnualBudgetSummary.mockResolvedValue({ data: annualData({ summary: { remaining: -1250 } }) });
    await settle();
    expect(screen.getByText('חריגה מהתקציב')).toBeInTheDocument();
    expect(screen.getAllByText('₪1,250').length).toBeGreaterThan(0);
  });

  it('preserves sparse coverage, forecast, allowance, and existing insights', async () => {
    await settle();
    expect(screen.getByText(/כיסוי תקציב דליל/)).toBeInTheDocument();
    expect(screen.getByText('תחזית הוצאה לסוף השנה')).toBeInTheDocument();
    expect(screen.getAllByText('₪26,550').length).toBeGreaterThan(0);
    expect(screen.getByText('תקרה חודשית לחודשים שנותרו')).toBeInTheDocument();
    expect(screen.getAllByText('₪675').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/אוגוסט/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/תחבורה/).length).toBeGreaterThan(0);
  });

  it('shows the no-remaining-months edge case without an invalid amount', async () => {
    getAnnualBudgetSummary.mockResolvedValue({ data: annualData({ summary: { allowance_per_remaining_month: null } }) });
    await settle();
    const allowance = screen.getByText('תקרה חודשית לחודשים שנותרו').closest('.annual-forecast-item');
    expect(allowance).toHaveTextContent('—');
    expect(allowance).toHaveTextContent('לא נותרו חודשים');
    expect(allowance).not.toHaveTextContent('NaN');
    expect(allowance).not.toHaveTextContent('Infinity');
  });

  it('renders a twelve-month planned-versus-actual chart with a textual summary', async () => {
    await settle();
    const chart = screen.getByTestId('annual-chart');
    expect(chart).toHaveAttribute('data-months', '12');
    expect(chart).toHaveAttribute('data-category-gap', '42%');
    expect(chart).toHaveAttribute('data-bar-gap', '3');
    expect(screen.getByTestId('annual-bar-planned')).toHaveAttribute('data-bar-size', '11');
    expect(screen.getByTestId('annual-bar-actual')).toHaveAttribute('data-radius', '5,5,0,0');
    const legend = screen.getByRole('list', { name: 'מקרא התרשים' });
    expect(within(legend).getAllByRole('listitem')).toHaveLength(2);
    expect(within(legend).getAllByRole('listitem')[0]).toHaveTextContent('מתוכנן');
    expect(within(legend).getAllByRole('listitem')[1]).toHaveTextContent('בפועל');
    const summary = screen.getByRole('list', { name: 'סיכום טקסטואלי של נתוני התרשים' });
    expect(within(summary).getAllByRole('listitem')).toHaveLength(12);
    expect(within(summary).getByText(/ינואר: מתוכנן/)).toBeInTheDocument();
  });

  it('keeps named non-budgeted and uncategorized expenses distinct', async () => {
    await settle();
    expect(screen.getByText('מסעדות')).toBeInTheDocument();
    expect(screen.getAllByText('הוצאות ללא קטגוריה').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₪300').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₪200').length).toBeGreaterThan(0);
  });

  it('shows a neutral state when there is no non-budgeted spending', async () => {
    getAnnualBudgetSummary.mockResolvedValue({
      data: annualData({
        summary: { non_budgeted_expenses: 0 },
        non_budgeted: { total: 0, by_category: [] },
      }),
    });
    await settle();
    expect(screen.getByText('אין הוצאות לא מתוקצבות בשנה שנבחרה.')).toBeInTheDocument();
  });

  it('shows the real annual category fields in both desktop and mobile renderings', async () => {
    await settle();
    const table = screen.getByRole('table', { name: 'תקציב והוצאה שנתיים לפי קטגוריה' });
    expect(within(table).getByText('מזון')).toBeInTheDocument();
    expect(within(table).getByText('₪12,000')).toBeInTheDocument();
    expect(within(table).getByText('₪9,000')).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar', { name: 'ניצול התקציב של תחבורה' })[0]).toHaveAttribute('aria-valuenow', '120');
    expect(screen.getAllByRole('progressbar', { name: 'ניצול התקציב של ביטוחים' })[0]).toHaveAttribute('aria-valuetext', '0% — ללא הוצאה');
    const mobile = screen.getByRole('list', { name: 'קטגוריות שנתיות' });
    expect(within(mobile).getByText('תחבורה')).toBeInTheDocument();
    expect(within(mobile).getAllByText('₪7,200').length).toBeGreaterThan(0);
  });

  it('keeps every real category accessible inside the bounded analysis regions', async () => {
    const categories = Array.from({ length: 24 }, (_, index) => ({
      category_id: index + 1,
      name: `Budget category ${String(index + 1).padStart(2, '0')}`,
      icon: '•',
      planned: 1000,
      actual: 500,
      diff: 500,
      pct_used: 50,
    }));
    const nonBudgetedRows = Array.from({ length: 18 }, (_, index) => ({
      category_id: index + 101,
      name: `Unbudgeted category ${String(index + 1).padStart(2, '0')}`,
      icon: '•',
      total: index + 1,
    }));
    nonBudgetedRows.push({ category_id: null, name: 'Uncategorized expenses', icon: null, total: 25 });
    getAnnualBudgetSummary.mockResolvedValue({
      data: annualData({
        categories,
        non_budgeted: { total: 196, by_category: nonBudgetedRows },
      }),
    });

    const page = renderPage();
    await screen.findByRole('heading', { name: 'מתוכנן מול בפועל' });

    const categoryRegion = page.container.querySelector('.annual-category-table-wrap');
    expect(categoryRegion).toHaveAttribute('role', 'region');
    expect(categoryRegion).toHaveAttribute('tabindex', '0');
    expect(within(categoryRegion).getAllByRole('row')).toHaveLength(categories.length + 1);
    categories.forEach((category) => expect(within(categoryRegion).getByText(category.name)).toBeInTheDocument());

    const nonBudgetedRegion = page.container.querySelector('.annual-nonbudgeted-list');
    expect(nonBudgetedRegion).toHaveAttribute('role', 'region');
    expect(nonBudgetedRegion).toHaveAttribute('tabindex', '0');
    nonBudgetedRows
      .filter((category) => category.category_id !== null)
      .forEach((category) => expect(within(nonBudgetedRegion).getByText(category.name)).toBeInTheDocument());
    expect(nonBudgetedRegion.querySelectorAll('.annual-nonbudgeted-row')).toHaveLength(nonBudgetedRows.length);
    expect(nonBudgetedRegion.querySelector('.annual-nonbudgeted-row--uncategorized')).toBeInTheDocument();
  });

  it('formats floating-point artifacts only at presentation boundaries', async () => {
    getAnnualBudgetSummary.mockResolvedValue({
      data: annualData({
        summary: {
          yearly_planned: 44723.07000000001,
          yearly_actual: 44471.02000000001,
          remaining: 252.04999999999563,
          budgeted_expenses: 44336.50000000001,
          non_budgeted_expenses: 134.51999999999998,
          monthly_average: 5558.877500000001,
        },
      }),
    });
    await settle();
    expect(screen.getAllByText('₪44,723.07').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₪252.05').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₪134.52').length).toBeGreaterThan(0);
    expect(document.body).not.toHaveTextContent('44723.07000000001');
    expect(document.body).not.toHaveTextContent('252.04999999999563');
    expect(document.body).not.toHaveTextContent('134.51999999999998');
  });

  it('does not introduce unsupported annual product concepts', async () => {
    await settle();
    expect(screen.queryByText(/הכנסה שנתית/)).not.toBeInTheDocument();
    expect(screen.queryByText(/שיעור חיסכון/)).not.toBeInTheDocument();
    expect(screen.queryByText(/יתרת חשבון/)).not.toBeInTheDocument();
    expect(screen.queryByText(/יעד פיננסי/)).not.toBeInTheDocument();
    expect(screen.queryByText(/השקע/)).not.toBeInTheDocument();
  });
});

describe('lazy monthly matrix and range behavior', () => {
  it('keeps the matrix closed and makes no breakdown request until opened', async () => {
    await settle();
    expect(getMonthlyCategoryBreakdown).not.toHaveBeenCalled();
    expect(screen.getByText('פתח את הפירוט כדי לטעון את המטריצה החודשית.')).toBeInTheDocument();
  });

  it('loads the matrix lazily and preserves planned, actual, difference, and unplanned states', async () => {
    const request = deferred();
    getMonthlyCategoryBreakdown.mockReturnValue(request.promise);
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'הצגת פירוט חודשי' }));
    expect(getMonthlyCategoryBreakdown).toHaveBeenCalledWith(currentYear);
    expect(screen.getByRole('status', { name: 'טעינת הפירוט החודשי' })).toBeInTheDocument();
    request.resolve({ data: breakdownData() });

    const matrix = await screen.findByRole('table', { name: 'תקציב, הוצאה והפרש לפי קטגוריה וחודש' });
    expect(within(matrix).getByText('מזון')).toBeInTheDocument();
    expect(within(matrix).getAllByText('מתוכנן').length).toBeGreaterThan(0);
    expect(within(matrix).getAllByText('לא תוקצב').length).toBeGreaterThan(0);
    expect(within(matrix).getAllByText('הוצאה לא מתוכננת').length).toBeGreaterThan(0);
  });

  it('keeps the annual page visible when breakdown loading fails and retries locally', async () => {
    getMonthlyCategoryBreakdown.mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce({ data: breakdownData() });
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'הצגת פירוט חודשי' }));
    expect(await screen.findByText(/הפירוט החודשי לא נטען/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'מתוכנן מול בפועל' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));
    expect(await screen.findByRole('table', { name: 'תקציב, הוצאה והפרש לפי קטגוריה וחודש' })).toBeInTheDocument();
    expect(getAnnualBudgetSummary).toHaveBeenCalledTimes(1);
  });

  it('changes between 3, 6, and full-year ranges without another API request', async () => {
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'הצגת פירוט חודשי' }));
    const matrix = await screen.findByRole('table', { name: 'תקציב, הוצאה והפרש לפי קטגוריה וחודש' });
    expect(within(matrix).queryByRole('columnheader', { name: 'דצמבר' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: '6 חודשים' }));
    expect(within(matrix).queryByRole('columnheader', { name: 'ינואר' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'שנה מלאה' }));
    expect(within(matrix).getByRole('columnheader', { name: 'דצמבר' })).toBeInTheDocument();
    expect(getMonthlyCategoryBreakdown).toHaveBeenCalledTimes(1);
  });

  it('shows a local matrix empty state without hiding the annual summary', async () => {
    const emptyBreakdown = breakdownData();
    emptyBreakdown.rows = [];
    emptyBreakdown.totals.months = Object.fromEntries(months.map((month) => [month, matrixCell(0, 0)]));
    emptyBreakdown.totals.yearly = matrixCell(0, 0);
    getMonthlyCategoryBreakdown.mockResolvedValue({ data: emptyBreakdown });
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'הצגת פירוט חודשי' }));
    expect(await screen.findByText('אין נתונים לתקופה זו.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'מתוכנן מול בפועל' })).toBeInTheDocument();
  });
});
