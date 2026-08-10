import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AddTransaction from './AddTransaction';
import {
  createCategory,
  createTransaction,
  getAllLoans,
  getCategories,
  getLegoSetDetails,
  getLegoThemes,
  getPaymentSources,
  getTags,
  getTransactionById,
  updateTransaction,
} from '../../services/api';

vi.mock('../../services/api', () => ({
  createCategory: vi.fn(),
  createTransaction: vi.fn(),
  getAllLoans: vi.fn(),
  getCategories: vi.fn(),
  getLegoSetDetails: vi.fn(),
  getLegoThemes: vi.fn(),
  getPaymentSources: vi.fn(),
  getTags: vi.fn(),
  getTransactionById: vi.fn(),
  updateTransaction: vi.fn(),
}));

const categories = [
  { id: 1, name: 'מזון', keywords: ['סופר'] },
  { id: 2, name: 'Lego', keywords: ['לגו'] },
  { id: 24, name: 'הלוואות', keywords: ['הלוואה'] },
];

const paymentSources = [
  { id: 10, name: 'ויזה', last4: '1234', method: 'credit_card' },
  { id: 11, name: 'מזומן', method: 'cash' },
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

const renderForm = (path = '/add') => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/add" element={<AddTransaction />} />
      <Route path="/edit-transaction/:id" element={<AddTransaction />} />
      <Route path="/transactions" element={<div>transactions destination</div>} />
      <Route path="/" element={<div>home destination</div>} />
    </Routes>
  </MemoryRouter>,
);

const settleInitialData = async () => {
  await waitFor(() => expect(getPaymentSources).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByLabelText(/^אמצעי תשלום/)).toHaveValue('10'));
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('alert', vi.fn());
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  getTags.mockResolvedValue({ data: ['unused-tag'] });
  getLegoThemes.mockResolvedValue({ data: ['Star Wars'] });
  getCategories.mockResolvedValue({ data: categories });
  getPaymentSources.mockResolvedValue({ data: paymentSources });
  getAllLoans.mockResolvedValue({ data: [{ id: 7, name: 'הלוואת רכב', lender_name: 'בנק', current_balance: 12000 }] });
  createTransaction.mockResolvedValue({ data: { id: 100 } });
  updateTransaction.mockResolvedValue({ data: { id: 42 } });
});

describe('AddTransaction characterization', () => {
  it('renders the approved numbered Finance v3 hierarchy with notes in the core and a compact footer', async () => {
    const { container } = renderForm();
    await settleInitialData();

    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'פרטי הליבה',
      'סכום התנועה',
      'תשלומים',
      'מטבע חוץ',
    ]);
    expect([...container.querySelectorAll('.transaction-form-section__step')].map((step) => step.textContent)).toEqual(['1', '2', '3', '4']);
    const coreSection = screen.getByRole('heading', { name: 'פרטי הליבה' }).closest('.transaction-form-section');
    expect(within(coreSection).getByLabelText('הערות')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ביטול' })).toHaveAttribute('href', '/transactions');
  });

  it('shows the edit loading skeleton until the existing transaction request resolves', async () => {
    const request = deferred();
    getTransactionById.mockReturnValue(request.promise);
    renderForm('/edit-transaction/42');

    expect(screen.getByRole('status', { name: 'טוען את פרטי התנועה' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'עדכן תנועה' })).not.toBeInTheDocument();

    request.resolve({ data: { id: 42, description: 'נטען', transaction_date: '2026-08-01' } });
    expect(await screen.findByDisplayValue('נטען')).toBeInTheDocument();
  });

  it('preserves the existing edit-load failure alert and return destination', async () => {
    getTransactionById.mockRejectedValue(new Error('load failed'));
    renderForm('/edit-transaction/42');

    expect(await screen.findByText('home destination')).toBeInTheDocument();
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('שגיאה בטעינת'));
  });

  it('keeps the create defaults, category keyword detection, date/payment behavior, and direct payload', async () => {
    const user = userEvent.setup();
    renderForm();
    await settleInitialData();

    expect(screen.getByRole('radio', { name: 'הוצאה' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByText('unused-tag')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'הכנסה' }));
    await user.type(screen.getByRole('textbox', { name: /^תיאור/ }), 'קניות סופר');
    fireEvent.change(screen.getByLabelText(/^תאריך התנועה/), { target: { value: '2026-08-08' } });
    fireEvent.change(screen.getByLabelText(/^אמצעי תשלום/), { target: { value: '11' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: /^סכום$/ }), { target: { value: '123.45' } });
    fireEvent.change(screen.getByLabelText('מספר תשלומים'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('מטבע'), { target: { value: 'USD' } });
    fireEvent.change(screen.getByLabelText('סכום מקורי (USD)'), { target: { value: '35.5' } });
    fireEvent.change(screen.getByLabelText('שער המרה'), { target: { value: '3.4775' } });
    await user.type(screen.getByLabelText('הערות'), 'הערה mixed English');
    await user.click(screen.getByRole('button', { name: 'שמור תנועה' }));

    await waitFor(() => expect(createTransaction).toHaveBeenCalledTimes(1));
    expect(createTransaction).toHaveBeenCalledWith({
      transaction: expect.objectContaining({
        movement_type: 'income',
        description: 'קניות סופר',
        category_id: 1,
        payment_source_id: 11,
        transaction_date: '2026-08-08',
        charge_date: '2026-08-08',
        total_amount: '123.45',
        installment_count: 3,
        currency: 'USD',
        original_amount: '35.5',
        exchange_rate: '3.4775',
        notes: 'הערה mixed English',
      }),
      items: [],
    });
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('נשמרה'));
    expect(screen.getByLabelText(/^אמצעי תשלום/)).toHaveValue('11');
  });

  it('switches between direct and itemized amount modes without submitting the form', async () => {
    const user = userEvent.setup();
    renderForm();
    await settleInitialData();

    const directMode = screen.getByRole('radio', { name: 'סכום אחיד' });
    const itemizedMode = screen.getByRole('radio', { name: 'פירוט פריטים' });

    expect(directMode).toHaveAttribute('aria-checked', 'true');
    expect(directMode).toHaveAttribute('type', 'button');
    expect(itemizedMode).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('spinbutton', { name: /^סכום$/ })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /^שם הפריט/ })).not.toBeInTheDocument();

    await user.click(itemizedMode);

    expect(itemizedMode).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('textbox', { name: /^שם הפריט/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'הוספת פריט' })).toBeInTheDocument();
    expect(createTransaction).not.toHaveBeenCalled();

    await user.click(directMode);

    expect(directMode).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('spinbutton', { name: /^סכום$/ })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /^שם הפריט/ })).not.toBeInTheDocument();
    expect(createTransaction).not.toHaveBeenCalled();
  });

  it('preserves category selection and inline category creation', async () => {
    const user = userEvent.setup();
    createCategory.mockResolvedValue({ data: { id: 9, name: 'לימודים' } });
    renderForm();
    await settleInitialData();

    const categoryInput = screen.getByRole('combobox', { name: 'קטגוריה' });
    await user.click(categoryInput);
    await user.click(screen.getByRole('option', { name: /מזון/ }));
    expect(categoryInput).toHaveValue('מזון');

    await user.clear(categoryInput);
    await user.type(categoryInput, 'לימודים');
    await user.click(screen.getByRole('button', { name: /יצירת קטגוריה/ }));
    expect(screen.getByRole('dialog', { name: 'קטגוריה חדשה' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'שמירת קטגוריה' }));

    await waitFor(() => expect(createCategory).toHaveBeenCalledWith({ name: 'לימודים' }));
    await waitFor(() => expect(categoryInput).toHaveValue('לימודים'));
  });

  it('keeps item add/remove, fixed and percentage discounts, global discount, and calculated total', async () => {
    const user = userEvent.setup();
    renderForm();
    await settleInitialData();

    await user.click(screen.getByRole('radio', { name: 'פירוט פריטים' }));
    await user.click(screen.getByRole('button', { name: 'הוספת פריט' }));
    const itemCards = screen.getAllByRole('article');

    await user.type(within(itemCards[0]).getByRole('textbox', { name: /^שם הפריט/ }), 'פריט קבוע');
    fireEvent.change(within(itemCards[0]).getByLabelText('כמות'), { target: { value: '2' } });
    fireEvent.change(within(itemCards[0]).getByLabelText('מחיר ליחידה'), { target: { value: '100' } });
    fireEvent.change(within(itemCards[0]).getByLabelText('ערך ההנחה'), { target: { value: '10' } });

    await user.type(within(itemCards[1]).getByRole('textbox', { name: /^שם הפריט/ }), 'פריט באחוזים');
    fireEvent.change(within(itemCards[1]).getByLabelText('כמות'), { target: { value: '2' } });
    fireEvent.change(within(itemCards[1]).getByLabelText('מחיר ליחידה'), { target: { value: '50' } });
    await user.click(within(itemCards[1]).getByRole('button', { name: 'אחוזים' }));
    fireEvent.change(within(itemCards[1]).getByLabelText('ערך ההנחה'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('הנחה על כל התנועה'), { target: { value: '20' } });

    const amountSummary = screen.getByLabelText('סיכום סכום התנועה');
    await waitFor(() => expect(amountSummary).toHaveTextContent('₪250'));
    await user.click(within(itemCards[1]).getByRole('button', { name: 'הסרת פריט 2' }));
    await waitFor(() => expect(amountSummary).toHaveTextContent('₪160'));
  });

  it('shows loan context only for the existing category trigger and preserves the selected loan ID', async () => {
    const user = userEvent.setup();
    renderForm();
    await settleInitialData();

    expect(screen.queryByRole('combobox', { name: /הלוואה/ })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /^תיאור/ }), 'תשלום הלוואה');
    await waitFor(() => expect(screen.getByRole('combobox', { name: /הלוואה/ })).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox', { name: /הלוואה/ }), { target: { value: '7' } });
    await user.type(screen.getByRole('spinbutton', { name: /^סכום$/ }), '400');
    await user.click(screen.getByRole('button', { name: 'שמור תנועה' }));

    await waitFor(() => expect(createTransaction).toHaveBeenCalled());
    expect(createTransaction.mock.calls[0][0].transaction.loan_id).toBe(7);
  });

  it('preserves LEGO lookup success and failure while keeping item state in the create payload', async () => {
    const user = userEvent.setup();
    getLegoSetDetails
      .mockResolvedValueOnce({ data: { name: 'Millennium Falcon', theme: 'Star Wars' } })
      .mockRejectedValueOnce(new Error('not found'));
    renderForm();
    await settleInitialData();

    await user.type(screen.getByRole('textbox', { name: /^תיאור/ }), 'קניית לגו');
    await user.click(screen.getByRole('button', { name: 'הוספת פריט' }));
    const legoFields = screen.getByRole('article', { name: 'פרטי LEGO לפריט 1' });
    const setInput = within(legoFields).getByLabelText('מספר סט');
    await user.type(setInput, '75379-1');
    fireEvent.blur(setInput);
    await waitFor(() => expect(within(legoFields).getByText('הסט נמצא')).toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: /^שם הפריט/ })).toHaveValue('Millennium Falcon');
    expect(within(legoFields).getByLabelText('נושא')).toHaveValue('Star Wars');

    await user.clear(setInput);
    await user.type(setInput, '00000-1');
    fireEvent.blur(setInput);
    await waitFor(() => expect(within(legoFields).getByText(/האימות.*נכשל/)).toBeInTheDocument());
  });

  it('uses the same interactive amount-mode control for an itemized edit', async () => {
    const user = userEvent.setup();
    getTransactionById.mockResolvedValue({
      data: {
        id: 42,
        transaction_date: '2026-07-10',
        description: 'עסקה קיימת',
        total_amount: 90,
        transaction_items: [{
          id: 88,
          item_name: 'פריט קיים',
          quantity: 1,
          price_per_unit: 90,
          discount_type: 'amount',
          discount_value: 0,
        }],
      },
    });
    renderForm('/edit-transaction/42');

    expect(await screen.findByDisplayValue('פריט קיים')).toBeInTheDocument();
    const directMode = screen.getByRole('radio', { name: 'סכום אחיד' });
    const itemizedMode = screen.getByRole('radio', { name: 'פירוט פריטים' });
    expect(itemizedMode).toHaveAttribute('aria-checked', 'true');

    await user.click(directMode);
    expect(screen.getByRole('spinbutton', { name: /^סכום$/ })).toBeInTheDocument();

    await user.click(itemizedMode);
    expect(screen.getByRole('textbox', { name: /^שם הפריט/ })).toBeInTheDocument();
    expect(updateTransaction).not.toHaveBeenCalled();
  });

  it('loads and updates one existing transaction with its category, payment, items, notes, and navigation unchanged', async () => {
    const user = userEvent.setup();
    getTransactionById.mockResolvedValue({
      data: {
        id: 42,
        transaction_date: '2026-07-10',
        charge_date: '2026-08-02',
        description: 'עסקה קיימת',
        movement_type: 'expense',
        category_id: 1,
        payment_source_id: 10,
        total_amount: 90,
        global_discount: 10,
        currency: 'ILS',
        installments_info: '2/3 תשלומים',
        notes: 'הערה קיימת',
        transaction_items: [{
          id: 88,
          item_name: 'פריט קיים',
          quantity: 1,
          price_per_unit: 100,
          discount_type: 'amount',
          discount_value: 0,
          set_number: '',
          theme: '',
          brand: 'LEGO',
        }],
      },
    });
    renderForm('/edit-transaction/42');

    expect(await screen.findByDisplayValue('עסקה קיימת')).toBeInTheDocument();
    expect(screen.getByText(/התנועה הזאת בלבד/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^אמצעי תשלום/)).toHaveValue('10');
    expect(screen.getByLabelText('הערות')).toHaveValue('הערה קיימת');
    expect(screen.getByRole('textbox', { name: /^שם הפריט/ })).toHaveValue('פריט קיים');
    expect(screen.queryByRole('button', { name: /מחיק/ })).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('הערות'));
    await user.type(screen.getByLabelText('הערות'), 'עודכן');
    await user.click(screen.getByRole('button', { name: 'עדכן תנועה' }));

    await waitFor(() => expect(updateTransaction).toHaveBeenCalledTimes(1));
    expect(updateTransaction).toHaveBeenCalledWith('42', expect.objectContaining({
      transaction: expect.objectContaining({ notes: 'עודכן', category_id: 1, payment_source_id: 10 }),
      items: [expect.objectContaining({ id: 88, item_name: 'פריט קיים' })],
    }));
    expect(await screen.findByText('transactions destination')).toBeInTheDocument();
  });

  it('prevents duplicate submissions and keeps entered data after a failed save', async () => {
    const user = userEvent.setup();
    let rejectRequest;
    createTransaction.mockImplementation(() => new Promise((resolve, reject) => {
      rejectRequest = reject;
    }));
    renderForm();
    await settleInitialData();

    await user.type(screen.getByRole('textbox', { name: /^תיאור/ }), 'יישאר בטופס');
    const categoryInput = screen.getByRole('combobox', { name: 'קטגוריה' });
    await user.click(categoryInput);
    await user.click(screen.getByRole('option', { name: /מזון/ }));
    fireEvent.change(screen.getByRole('spinbutton', { name: /^סכום$/ }), { target: { value: '55' } });
    const submit = screen.getByRole('button', { name: 'שמור תנועה' });
    await user.click(submit);
    await user.click(submit);
    expect(createTransaction).toHaveBeenCalledTimes(1);

    rejectRequest(new Error('save failed'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringContaining('שגיאה')));
    expect(screen.getByRole('textbox', { name: /^תיאור/ })).toHaveValue('יישאר בטופס');
    expect(screen.getByRole('spinbutton', { name: /^סכום$/ })).toHaveValue(55);
  });
});
