import { useMemo, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import { createLoan, getAllLoans, getLoanDetails, getPaymentSources } from '../../services/api';
import LoanSimulator from '../../components/LoanSimulator';
import Loans from './Loans';

vi.mock('../../services/api', () => ({
  createLoan: vi.fn(),
  getAllLoans: vi.fn(),
  getLoanDetails: vi.fn(),
  getPaymentSources: vi.fn(),
}));

const loan = (overrides = {}) => ({
  id: 1,
  name: 'הלוואת רכב',
  lender_name: 'מימון ישיר',
  loan_type: 'bank_loan',
  amortization_type: 'spitzer',
  interest_type: 'fixed',
  indexation_type: 'none',
  base_index: null,
  original_amount: 120000,
  current_balance: 74300,
  monthly_payment: 1850,
  interest_rate: 7.4,
  prime_margin: 0,
  total_installments: 60,
  remaining_installments: 41,
  start_date: '2023-03-15',
  end_date: '2029-08-15',
  ...overrides,
});

const closedPayments = () => [
  ...Array.from({ length: 25 }, (_, index) => ({
    id: index + 1,
    loan_id: 9,
    transaction_id: 1001 + index,
    installment_number: index + 1,
    payment_date: index === 24 ? '2026-06-02' : `2025-${String((index % 12) + 1).padStart(2, '0')}-02`,
    payment_amount: index === 24 ? '1693.50' : '0.00',
    principal_amount: index === 24 ? '1693.50' : '0.00',
    interest_amount: '0.00',
    other_amount: '0.00',
    balance_adjustment_amount: index === 24 ? '7.84' : '0.00',
    payment_kind: 'installment',
    source_kind: 'reconstructed',
  })),
  {
    id: 26,
    loan_id: 9,
    transaction_id: 1026,
    installment_number: null,
    payment_date: '2026-06-03',
    payment_amount: '4314.60',
    principal_amount: '4298.66',
    interest_amount: '1.12',
    other_amount: '14.82',
    balance_adjustment_amount: '0.00',
    payment_kind: 'early_payoff',
    source_kind: 'reconstructed',
  },
];

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const HeaderHarness = ({ children }) => {
  const [header, setHeader] = useState(null);
  const contextValue = useMemo(() => ({ setPageHeader: setHeader }), []);

  return (
    <PageHeaderContext.Provider value={contextValue}>
      {header?.primaryAction && (
        <button type="button" onClick={header.primaryAction.onClick}>
          {header.primaryAction.label}
        </button>
      )}
      {children}
    </PageHeaderContext.Provider>
  );
};

const renderPage = () => render(<Loans />, { wrapper: HeaderHarness });

beforeEach(() => {
  vi.resetAllMocks();
  getAllLoans.mockResolvedValue({ data: [loan()] });
  getLoanDetails.mockResolvedValue({
    data: {
      loan: loan({
        payment_source: { id: 1, name: 'כרטיס בדיקה', last4: '1234' },
        calculation_mode: 'loan_payments',
        auto_payment_enabled: true,
        next_payment_date: '2026-09-15',
      }),
      loan_payments: [],
      related_transactions: [],
    },
  });
  createLoan.mockResolvedValue({ data: {} });
  getPaymentSources.mockResolvedValue({
    data: [
      { id: 5, name: 'Cal - 5746' },
      { id: 8, name: 'חשבון בדיקה' },
    ],
  });
});

describe('loans loading, summary, and cards', () => {
  it('adds a compact CPI marker to an indexed loan card without changing interest semantics', async () => {
    getAllLoans.mockResolvedValue({
      data: [loan({ indexation_type: 'cpi', interest_type: 'fixed', interest_rate: 3 })],
    });
    renderPage();

    const card = await screen.findByRole('button', { name: 'הלוואה: הלוואת רכב' });
    expect(card).toHaveTextContent(/ריבית קבועה.*צמוד מדד/);
  });

  it('uses the shell heading, fetches loans, and renders the four real summary metrics', async () => {
    renderPage();

    expect(screen.getByLabelText('טעינת הלוואות')).toBeInTheDocument();
    const summary = await screen.findByRole('region', { name: 'סיכום תיק ההלוואות' });

    expect(getAllLoans).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'הוספת הלוואה' })).toBeInTheDocument();
    expect(within(summary).getByText('סך החוב הנוכחי')).toBeInTheDocument();
    expect(within(summary).getByText('סך ההחזרים החודשיים')).toBeInTheDocument();
    expect(within(summary).getByText('ההלוואה בריבית הגבוהה ביותר')).toBeInTheDocument();
    expect(within(summary).getByText('מספר ההלוואות הפעילות')).toBeInTheDocument();
    expect(within(summary).getByText('₪74,300')).toBeInTheDocument();
    expect(within(summary).getByText('₪1,850')).toBeInTheDocument();
    expect(within(summary).getByText('הלוואת רכב')).toBeInTheDocument();
    expect(within(summary).getByText('1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /הצג עוד/ })).not.toBeInTheDocument();
  });

  it('shows the real card data and accessible principal progress without unsupported actions', async () => {
    renderPage();

    const card = await screen.findByRole('button', { name: 'הלוואה: הלוואת רכב' });
    expect(within(card).getByText('מימון ישיר', { exact: false })).toBeInTheDocument();
    expect(within(card).getByText('₪74,300')).toBeInTheDocument();
    expect(within(card).getByText('₪1,850')).toBeInTheDocument();
    expect(within(card).getByText('41')).toBeInTheDocument();
    expect(within(card).getByText('2023-03-15')).toBeInTheDocument();
    expect(within(card).getByText('2029-08-15')).toBeInTheDocument();
    expect(within(card).getByText('שפיצר')).toBeInTheDocument();
    expect(within(card).getByText('ריבית קבועה', { exact: false })).toBeInTheDocument();

    const progress = within(card).getByRole('progressbar');
    expect(progress).toHaveAttribute('aria-valuenow', expect.stringMatching(/^38\.08/));
    expect(progress).toHaveAttribute('aria-valuetext', '38% מהקרן נפרעה');
    expect(screen.queryByRole('button', { name: /עריכת הלוואה|מחיקת הלוואה|רישום החזר|שינוי סטטוס/ })).not.toBeInTheDocument();
  });

  it('shows six loans by default, reveals every remaining loan, and collapses without another request', async () => {
    getAllLoans.mockResolvedValue({
      data: Array.from({ length: 8 }, (_, index) => loan({
        id: index + 1,
        name: `הלוואה ${index + 1}`,
      })),
    });
    renderPage();

    const portfolio = await screen.findByRole('region', { name: 'הלוואות פעילות' });
    expect(within(portfolio).getAllByRole('button', { name: /הלוואה:/ })).toHaveLength(6);
    expect(within(portfolio).queryByRole('button', { name: 'הלוואה: הלוואה 7' })).not.toBeInTheDocument();

    const showMore = screen.getByRole('button', { name: 'הצג עוד 2 הלוואות' });
    expect(showMore).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(showMore);

    expect(within(portfolio).getAllByRole('button', { name: /הלוואה:/ })).toHaveLength(8);
    expect(within(portfolio).getByRole('button', { name: 'הלוואה: הלוואה 8' })).toBeInTheDocument();
    const showLess = screen.getByRole('button', { name: 'הצג פחות' });
    expect(showLess).toHaveAttribute('aria-expanded', 'true');
    expect(getAllLoans).toHaveBeenCalledTimes(1);

    await userEvent.click(showLess);
    expect(within(portfolio).getAllByRole('button', { name: /הלוואה:/ })).toHaveLength(6);
    expect(within(portfolio).queryByRole('button', { name: 'הלוואה: הלוואה 8' })).not.toBeInTheDocument();
    expect(getAllLoans).toHaveBeenCalledTimes(1);
  });

  it('uses singular Hebrew wording when exactly one loan remains', async () => {
    getAllLoans.mockResolvedValue({
      data: Array.from({ length: 7 }, (_, index) => loan({
        id: index + 1,
        name: `הלוואה ${index + 1}`,
      })),
    });
    renderPage();

    expect(await screen.findByRole('button', { name: 'הצג עוד 1 הלוואה' })).toBeInTheDocument();
  });

  it('formats money at the presentation boundary without leaking floating-point artifacts', async () => {
    getAllLoans.mockResolvedValue({
      data: [loan({ current_balance: 44723.07000000001, monthly_payment: 252.04999999999995 })],
    });
    renderPage();

    expect((await screen.findAllByText('₪44,723.07')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('₪252.05').length).toBeGreaterThan(0);
    expect(document.body).not.toHaveTextContent('44723.07000000001');
    expect(document.body).not.toHaveTextContent('252.04999999999995');
  });

  it('renders a retryable load error and a true empty state', async () => {
    getAllLoans.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ data: [] });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'טעינת ההלוואות נכשלה' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'נסה שוב' }));

    expect(await screen.findByRole('heading', { name: 'לא נרשמו הלוואות' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'הוספת הלוואה' })).toHaveLength(2);
  });

  it('excludes paid loans from active KPIs and groups them in a collapsed closed section', async () => {
    const closed = loan({
      id: 9,
      name: 'כאל - אקספרס 6,000',
      original_amount: 6000,
      current_balance: 0,
      monthly_payment: 110.78,
      interest_rate: 99,
      status: 'paid',
      total_installments: 72,
      remaining_installments: 0,
      start_date: '2024-05-01',
      closed_date: '2026-06-03',
      calculation_mode: 'loan_payments',
      regular_payment_count: 25,
      has_early_payoff: true,
    });
    getAllLoans.mockResolvedValue({ data: [loan(), closed] });
    renderPage();

    const summary = await screen.findByRole('region', { name: 'סיכום תיק ההלוואות' });
    expect(within(summary).getByText('₪1,850')).toBeInTheDocument();
    expect(within(summary).getByText('1')).toBeInTheDocument();
    expect(within(summary).getByText('הלוואת רכב')).toBeInTheDocument();
    expect(within(summary).queryByText('₪1,960.78')).not.toBeInTheDocument();
    expect(within(summary).queryByText('כאל - אקספרס 6,000')).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: /הצג 1 הלוואה סגורה/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'הלוואה: כאל - אקספרס 6,000' })).not.toBeInTheDocument();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const closedCard = screen.getByRole('button', { name: 'הלוואה: כאל - אקספרס 6,000' });
    expect(within(closedCard).getByText('נפרעה מוקדם')).toBeInTheDocument();
    expect(within(closedCard).getByText('03/06/2026')).toBeInTheDocument();
    expect(within(closedCard).getByLabelText('25 מתוך 72')).toHaveAttribute('dir', 'ltr');
    expect(within(closedCard).getByText('פירעון מוקדם')).toBeInTheDocument();
    expect(within(closedCard).queryByText('תשלומים שנותרו')).not.toBeInTheDocument();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'הלוואה: כאל - אקספרס 6,000' })).not.toBeInTheDocument();
  });

  it('opens a centered, mobile-capable details modal without navigation and supports every dismissal path', async () => {
    renderPage();
    const card = await screen.findByRole('button', { name: 'הלוואה: הלוואת רכב' });
    const pathBefore = window.location.pathname;

    await userEvent.click(card);
    const modal = await screen.findByRole('dialog', { name: 'הלוואת רכב' });
    expect(getLoanDetails).toHaveBeenCalledWith(1);
    expect(window.location.pathname).toBe(pathBefore);
    expect(modal).toHaveClass('loan-details-modal', 'ui-dialog--mobile-full');
    expect(modal).not.toHaveClass('ui-drawer');
    expect(document.querySelector('.loan-details-drawer')).not.toBeInTheDocument();
    expect(within(modal).getByText('פעילה')).toBeInTheDocument();
    expect(within(modal).getAllByText('₪120,000').length).toBeGreaterThan(0);
    expect(within(modal).getAllByText('₪74,300').length).toBeGreaterThan(0);
    expect(within(modal).getAllByText('₪1,850').length).toBeGreaterThan(0);
    expect(within(modal).getAllByText('15/09/2026').length).toBeGreaterThan(0);
    expect(within(modal).getAllByText('תשלום אוטומטי').length).toBeGreaterThan(0);
    expect(within(modal).getByLabelText('0 מתוך 60')).toHaveAttribute('dir', 'ltr');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'הלוואת רכב' })).not.toBeInTheDocument());
    expect(card).toHaveFocus();

    await userEvent.click(card);
    const reopened = await screen.findByRole('dialog', { name: 'הלוואת רכב' });
    await userEvent.click(within(reopened).getByRole('button', { name: 'סגירת פרטי ההלוואה' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'הלוואת רכב' })).not.toBeInTheDocument());

    await userEvent.click(card);
    await screen.findByRole('dialog', { name: 'הלוואת רכב' });
    await userEvent.click(screen.getByRole('button', { name: 'סגירת חלון' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'הלוואת רכב' })).not.toBeInTheDocument());
    expect(card).toHaveFocus();
  });

  it('uses normal paid terminology when the list summary has no early payoff', async () => {
    getAllLoans.mockResolvedValue({
      data: [loan({
        id: 10,
        name: 'הלוואה שהושלמה',
        status: 'paid',
        current_balance: 0,
        calculation_mode: 'loan_payments',
        regular_payment_count: 60,
        has_early_payoff: false,
        closed_date: '2026-07-01',
      })],
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /הצג 1 הלוואה סגורה/ }));
    const card = screen.getByRole('button', { name: 'הלוואה: הלוואה שהושלמה' });
    expect(within(card).getByText('נפרעה')).toBeInTheDocument();
    expect(within(card).getByLabelText('60 מתוך 60')).toHaveAttribute('dir', 'ltr');
    expect(within(card).getByText('פירעון מלא')).toBeInTheDocument();
    expect(within(card).queryByText('נפרעה מוקדם')).not.toBeInTheDocument();
  });

  it('renders early payoff history, exact running balance, and ancillary transactions distinctly', async () => {
    const payments = closedPayments();
    const closed = loan({
      id: 9,
      name: 'כאל - אקספרס 6,000',
      lender_name: 'כאל',
      original_amount: '6000.00',
      current_balance: '0.00',
      monthly_payment: '110.78',
      status: 'paid',
      total_installments: 72,
      remaining_installments: 0,
      start_date: '2024-05-01',
      end_date: '2030-05-02',
      closed_date: '2026-06-03',
      calculation_mode: 'loan_payments',
      regular_payment_count: 25,
      has_early_payoff: true,
    });
    getAllLoans.mockResolvedValue({ data: [closed] });
    getLoanDetails.mockResolvedValue({
      data: {
        loan: { ...closed, payment_source: { id: 5, name: 'Cal - 5746' } },
        loan_payments: payments,
        related_transactions: [
          {
            id: 1025,
            description: 'תשלום הלוואה',
            charge_date: '2026-06-02',
            total_amount: '110.78',
            installment_number: 25,
            installment_count: 72,
            installments_info: '25/72',
            category: { id: 24, name: 'הלוואות' },
            payment_source: { id: 5, name: 'Cal - 5746' },
          },
          {
            id: 70,
            description: 'ריבית גישור',
            charge_date: '2024-05-02',
            total_amount: '165.70',
            installment_number: null,
            category: { id: 24, name: 'הלוואות' },
            payment_source: { id: 5, name: 'Cal - 5746' },
          },
        ],
      },
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /הצג 1 הלוואה סגורה/ }));
    await userEvent.click(screen.getByRole('button', { name: 'הלוואה: כאל - אקספרס 6,000' }));
    const modal = await screen.findByRole('dialog', { name: 'כאל - אקספרס 6,000' });
    expect(within(modal).getByText('נפרעה מוקדם')).toBeInTheDocument();
    expect(within(modal).getByText('סיום מתוכנן')).toBeInTheDocument();
    expect(within(modal).getByText('תאריך סגירה בפועל')).toBeInTheDocument();
    expect(within(modal).getAllByText('אופן סגירה').length).toBeGreaterThan(0);
    expect(within(modal).getAllByText('פירעון מוקדם').length).toBeGreaterThan(0);
    expect(within(modal).getAllByText('03/06/2026').length).toBeGreaterThan(0);

    await userEvent.click(within(modal).getByRole('tab', { name: /לוח תשלומים/ }));
    const table = within(modal).getByRole('table', { name: 'לוח תשלומי הלוואה' });
    const paymentTableRows = within(table).getAllByRole('row');
    expect(paymentTableRows).toHaveLength(27);
    expect(within(table).getByText('25/72')).toBeInTheDocument();
    expect(within(table).getByText('פירעון מוקדם')).toBeInTheDocument();
    expect(within(table).queryByText('26/72')).not.toBeInTheDocument();
    expect(within(table).getAllByText('₪4,298.66').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('₪0.00').length).toBeGreaterThan(0);
    expect(within(paymentTableRows.at(-1)).getByText('פירעון מוקדם')).toBeInTheDocument();

    await userEvent.click(within(modal).getByRole('tab', { name: /תנועות קשורות/ }));
    const ancillary = within(modal).getByText('ריבית גישור').closest('article');
    expect(within(ancillary).getByText('הוצאה קשורה')).toBeInTheDocument();
    const regular = within(modal).getAllByText('תשלום הלוואה')
      .find((element) => element.tagName === 'STRONG')
      .closest('article');
    expect(within(regular).getByText('תשלום הלוואה', { selector: '.is-payment' })).toBeInTheDocument();
  });

  it('handles a legacy loan with no loan_payments history', async () => {
    const legacy = loan({ calculation_mode: 'legacy', loan_payments: [] });
    getAllLoans.mockResolvedValue({ data: [legacy] });
    getLoanDetails.mockResolvedValue({
      data: { loan: legacy, loan_payments: [], related_transactions: [] },
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'הלוואה: הלוואת רכב' }));
    const drawer = await screen.findByRole('dialog', { name: 'הלוואת רכב' });
    await userEvent.click(within(drawer).getByRole('tab', { name: /לוח תשלומים/ }));
    expect(within(drawer).getByText('אין להלוואה זו היסטוריית תשלומים חשבונאית.')).toBeInTheDocument();
  });
});

describe('create loan dialog', () => {
  const fillRequiredFields = async (dialog, { prime = false, withAutoFields = true } = {}) => {
    await userEvent.type(within(dialog).getByLabelText(/שם ההלוואה/), 'הלוואת מבחן');
    await userEvent.type(within(dialog).getByLabelText(/סכום מקורי/), '100000');
    await userEvent.type(within(dialog).getByLabelText(/מספר תשלומים/), '60');
    fireEvent.change(within(dialog).getByLabelText(/תאריך תחילה/), { target: { value: '2026-08-09' } });
    await userEvent.type(within(dialog).getByLabelText(/ריבית שנתית נומינלית נוכחית/), prime ? '11.85' : '7.5');
    await userEvent.type(within(dialog).getByLabelText(/החזר חודשי נוכחי/), '1800');
    if (withAutoFields) {
      await userEvent.selectOptions(within(dialog).getByLabelText(/מקור תשלום/), '5');
      fireEvent.change(within(dialog).getByLabelText(/תאריך התשלום הבא/), { target: { value: '2026-09-02' } });
    }
  };

  it('exposes the modern fields, defaults automation on, and validates its dependencies', async () => {
    renderPage();
    await screen.findByRole('button', { name: /הלוואה:/ });
    await userEvent.click(screen.getByRole('button', { name: 'הוספת הלוואה' }));

    const dialog = screen.getByRole('dialog', { name: 'הלוואה חדשה' });
    expect(getPaymentSources).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('checkbox', { name: /תשלום אוטומטי/ })).toBeChecked();
    expect(await within(dialog).findByRole('option', { name: 'Cal - 5746' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/ריבית שנתית נומינלית נוכחית/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('מרווח פריים')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('יתרה נוכחית')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('radio', { name: 'בלון' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('radio', { name: 'גרייס' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'ללא הצמדה' })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: 'מדד המחירים לצרכן' })).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('מדד בסיס')).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'יצירת ההלוואה' }));
    expect(within(dialog).getByText('יש לתקן את השדות המסומנים לפני יצירת ההלוואה.')).toBeInTheDocument();
    expect(within(dialog).getByText('מקור תשלום נדרש לתשלום אוטומטי')).toBeInTheDocument();
    expect(within(dialog).getByText('תאריך התשלום הבא נדרש לתשלום אוטומטי')).toBeInTheDocument();
    expect(createLoan).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('radio', { name: 'ריבית פריים / משתנה' }));
    expect(within(dialog).getByLabelText(/מרווח פריים/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/מרווח פריים/), '6.85');
    await userEvent.type(within(dialog).getByLabelText(/ריבית שנתית נומינלית נוכחית/), '11.85');
    expect(within(dialog).getByText('P + 6.85% · ריבית נוכחית: 11.85%')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('radio', { name: 'ריבית קבועה' }));
    expect(within(dialog).queryByLabelText('מרווח פריים')).not.toBeInTheDocument();
  });

  it('submits an explicit fixed-rate payload containing only supported create fields', async () => {
    renderPage();
    await screen.findByRole('button', { name: /הלוואה:/ });
    await userEvent.click(screen.getByRole('button', { name: 'הוספת הלוואה' }));
    const dialog = screen.getByRole('dialog', { name: 'הלוואה חדשה' });

    await fillRequiredFields(dialog);
    await userEvent.type(within(dialog).getByLabelText('מלווה'), 'בנק לדוגמה');
    await userEvent.click(within(dialog).getByRole('button', { name: 'יצירת ההלוואה' }));

    await waitFor(() => expect(createLoan).toHaveBeenCalledTimes(1));
    expect(createLoan).toHaveBeenCalledWith({
      name: 'הלוואת מבחן',
      lender_name: 'בנק לדוגמה',
      original_amount: 100000,
      total_installments: 60,
      start_date: '2026-08-09',
      end_date: null,
      interest_type: 'fixed',
      interest_rate: 7.5,
      prime_margin: 0,
      indexation_type: 'none',
      base_index: null,
      monthly_payment: 1800,
      payment_source_id: 5,
      next_payment_date: '2026-09-02',
      auto_payment_enabled: true,
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'הלוואה חדשה' })).not.toBeInTheDocument());
    expect(getAllLoans).toHaveBeenCalledTimes(2);
  });

  it('stores effective interest and Prime margin independently for a variable-rate loan', async () => {
    renderPage();
    await screen.findByRole('button', { name: /הלוואה:/ });
    await userEvent.click(screen.getByRole('button', { name: 'הוספת הלוואה' }));
    const dialog = screen.getByRole('dialog', { name: 'הלוואה חדשה' });

    await userEvent.click(within(dialog).getByRole('radio', { name: 'ריבית פריים / משתנה' }));
    await fillRequiredFields(dialog, { prime: true });
    await userEvent.type(within(dialog).getByLabelText(/מרווח פריים/), '6.85');
    await userEvent.click(within(dialog).getByRole('button', { name: 'יצירת ההלוואה' }));

    await waitFor(() => expect(createLoan).toHaveBeenCalledTimes(1));
    expect(createLoan).toHaveBeenCalledWith(expect.objectContaining({
      interest_type: 'prime',
      interest_rate: 11.85,
      prime_margin: 6.85,
    }));
  });

  it('reveals optional CPI metadata and turns unsupported automation off', async () => {
    renderPage();
    await screen.findByRole('button', { name: /הלוואה:/ });
    await userEvent.click(screen.getByRole('button', { name: 'הוספת הלוואה' }));
    const dialog = screen.getByRole('dialog', { name: 'הלוואה חדשה' });
    const automaticPayment = within(dialog).getByRole('checkbox', { name: /תשלום אוטומטי/ });

    expect(automaticPayment).toBeChecked();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'מדד המחירים לצרכן' }));

    expect(automaticPayment).not.toBeChecked();
    expect(automaticPayment).toBeDisabled();
    expect(within(dialog).getByLabelText('מדד בסיס')).toBeInTheDocument();
    expect(within(dialog).getByText('תשלום אוטומטי להלוואה צמודת מדד אינו נתמך עדיין')).toBeInTheDocument();

    await fillRequiredFields(dialog, { withAutoFields: false });
    await userEvent.type(within(dialog).getByLabelText('מדד בסיס'), '14024');
    await userEvent.click(within(dialog).getByRole('button', { name: 'יצירת ההלוואה' }));

    await waitFor(() => expect(createLoan).toHaveBeenCalledTimes(1));
    expect(createLoan).toHaveBeenCalledWith(expect.objectContaining({
      interest_type: 'fixed',
      indexation_type: 'cpi',
      base_index: 14024,
      auto_payment_enabled: false,
    }));
  });

  it('allows an explicitly manual loan to omit automatic-payment dependencies', async () => {
    renderPage();
    await screen.findByRole('button', { name: /הלוואה:/ });
    await userEvent.click(screen.getByRole('button', { name: 'הוספת הלוואה' }));
    const dialog = screen.getByRole('dialog', { name: 'הלוואה חדשה' });

    await userEvent.click(within(dialog).getByRole('checkbox', { name: /תשלום אוטומטי/ }));
    await fillRequiredFields(dialog, { withAutoFields: false });
    await userEvent.click(within(dialog).getByRole('button', { name: 'יצירת ההלוואה' }));

    await waitFor(() => expect(createLoan).toHaveBeenCalledTimes(1));
    expect(createLoan).toHaveBeenCalledWith(expect.objectContaining({
      auto_payment_enabled: false,
      payment_source_id: null,
      next_payment_date: null,
    }));
  });

  it('retains values on failure and prevents duplicate submission while saving', async () => {
    const request = deferred();
    createLoan.mockReturnValue(request.promise);
    renderPage();
    await screen.findByRole('button', { name: /הלוואה:/ });
    await userEvent.click(screen.getByRole('button', { name: 'הוספת הלוואה' }));
    const dialog = screen.getByRole('dialog', { name: 'הלוואה חדשה' });
    const name = within(dialog).getByLabelText(/שם ההלוואה/);

    await fillRequiredFields(dialog);
    await userEvent.clear(name);
    await userEvent.type(name, 'הלוואה שנשמרת');
    const submit = within(dialog).getByRole('button', { name: 'יצירת ההלוואה' });
    await userEvent.click(submit);
    expect(submit).toBeDisabled();
    await userEvent.click(submit);
    expect(createLoan).toHaveBeenCalledTimes(1);

    request.reject({ response: { data: { error: 'שמירה נכשלה' } } });
    expect(await within(dialog).findByText('שמירה נכשלה')).toBeInTheDocument();
    expect(name).toHaveValue('הלוואה שנשמרת');
    expect(screen.getByRole('dialog', { name: 'הלוואה חדשה' })).toBeInTheDocument();
  });
});

describe('early repayment simulator', () => {
  it('preserves the highest-effective-rate recommendation and labels the result as an estimate', async () => {
    render(
      <LoanSimulator loans={[
        loan(),
        loan({
          id: 2,
          name: 'הלוואת פריים',
          lender_name: 'בנק אחר',
          interest_type: 'prime',
          interest_rate: 0,
          prime_margin: 2,
          current_balance: 10000,
        }),
      ]} />,
    );

    expect(screen.getByText('הזן סכום כדי לראות הערכת חיסכון בריבית לשנה.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'חישוב חיסכון משוער' }));
    expect(screen.getByText('יש להזין סכום לפירעון מוקדם.')).toBeInTheDocument();

    const input = screen.getByLabelText('סכום לפירעון מוקדם');
    await userEvent.type(input, '-5');
    expect(screen.getByText('הסכום חייב להיות גדול מאפס')).toBeInTheDocument();

    await userEvent.clear(input);
    await userEvent.type(input, '1000');
    expect(screen.getByText('הלוואת פריים — בנק אחר')).toBeInTheDocument();
    expect(screen.getByText('8.00%')).toBeInTheDocument();
    expect(screen.getByText('₪80')).toBeInTheDocument();
    expect(screen.getByText(/זוהי הערכה/)).toBeInTheDocument();
    expect(screen.getByText('מחושב לפי נתוני הריבית הקיימים במערכת')).toBeInTheDocument();
  });

  it('shows a truthful no-suitable-loan state', async () => {
    render(<LoanSimulator loans={[loan({ current_balance: 0 })]} />);
    await userEvent.type(screen.getByLabelText('סכום לפירעון מוקדם'), '1000');
    expect(screen.getByText('לא נמצאה הלוואה פעילה שמתאימה לפירעון מוקדם.')).toBeInTheDocument();
  });
});
