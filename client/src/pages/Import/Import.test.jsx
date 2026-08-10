import { useMemo, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import {
  createCategory,
  getCategories,
  getPaymentSources,
  saveImportedTransactions,
  uploadImportFile,
} from '../../services/api';
import Import from './Import';

vi.mock('../../services/api', () => ({
  createCategory: vi.fn(),
  getCategories: vi.fn(),
  getPaymentSources: vi.fn(),
  saveImportedTransactions: vi.fn(),
  uploadImportFile: vi.fn(),
}));

const categories = [
  { id: 7, name: 'מזון', icon: '🍔' },
  { id: 8, name: 'דיור', icon: '🏠' },
];

const paymentSources = [
  { id: 11, name: 'מקס', last4: '7710' },
  { id: 12, name: 'חשבון בנק' },
];

const previewRows = [
  {
    id: 0,
    transaction_date: '2026-08-03',
    charge_date: '2026-08-05',
    description: 'PAYPAL *STEAM',
    total_amount: 129.00000000001,
    movement_type: 'expense',
    original_amount: 35,
    currency: 'USD',
    exchange_rate: 3.6857,
    installments_info: 'תשלום 1 מתוך 3',
    suggested_category: { id: 7, name: 'מזון', icon: '🍔' },
    notes: 'חיוב מחו״ל',
  },
  {
    id: 1,
    transaction_date: '2026-08-04',
    charge_date: '2026-08-04',
    description: 'GOOGLE *CLOUD',
    total_amount: 74.25,
    movement_type: 'expense',
    original_amount: null,
    currency: 'ILS',
    exchange_rate: null,
    installments_info: null,
    suggested_category: null,
    notes: null,
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
      {header?.subtitle && <p>{header.subtitle}</p>}
      {children}
    </PageHeaderContext.Provider>
  );
};

const renderPage = () => render(
  <ToastProvider>
    <MemoryRouter initialEntries={['/import']}>
      <HeaderHarness>
        <Routes>
          <Route path="/import" element={<Import />} />
          <Route path="/" element={<div>מסך הבית</div>} />
          <Route path="/add" element={<div>הוספה ידנית</div>} />
        </Routes>
      </HeaderHarness>
    </MemoryRouter>
  </ToastProvider>,
);

const file = () => new File(['date,description,amount'], 'august-statement.xlsx', {
  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
});

const advanceToPreview = async (selectedFile = file()) => {
  renderPage();
  const fileInput = await screen.findByLabelText(/קובץ תנועות/);
  await userEvent.upload(fileInput, selectedFile);
  await userEvent.click(screen.getByRole('button', { name: /המשך לבדיקת התנועות/ }));
  return screen.findByRole('region', { name: 'טבלת תצוגה מקדימה' });
};

beforeEach(() => {
  vi.resetAllMocks();
  getCategories.mockResolvedValue({ data: categories });
  getPaymentSources.mockResolvedValue({ data: paymentSources });
  uploadImportFile.mockResolvedValue({
    data: { totalRows: previewRows.length, previewData: previewRows },
  });
  createCategory.mockResolvedValue({ data: { id: 9, name: 'כלי עבודה', icon: '🛠️' } });
  saveImportedTransactions.mockResolvedValue({ data: { success: true, count: previewRows.length } });
});

describe('Import setup and preview contract', () => {
  it('uses the shell heading, preserves the four real profile values, source default, and accepted file types', async () => {
    renderPage();

    expect(screen.getByLabelText('טעינת נתוני הייבוא')).toBeInTheDocument();
    const profile = await screen.findByLabelText(/פרופיל ייבוא/);
    const source = screen.getByLabelText(/אמצעי תשלום/);
    const upload = screen.getByLabelText(/קובץ תנועות/);

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByText('קליטת דפי בנק וכרטיסי אשראי בשני צעדים')).toBeInTheDocument();
    expect(profile).toHaveValue('cal_bank');
    expect(within(profile).getAllByRole('option').map((option) => option.value)).toEqual([
      'cal_bank',
      'debit_bank',
      'cal',
      'max',
    ]);
    expect(source).toHaveValue('11');
    expect(upload).toHaveAttribute('accept', '.csv,.xls,.xlsx');
    expect(screen.getByRole('button', { name: /המשך לבדיקת התנועות/ })).toBeDisabled();
    expect(screen.queryByText(/זיהוי אוטומטי|Automatic|מיפוי עמודות/)).not.toBeInTheDocument();
  });

  it('calls the existing multipart preview API with only the selected file and profile and announces processing', async () => {
    const request = deferred();
    uploadImportFile.mockReturnValue(request.promise);
    renderPage();
    const selectedFile = file();
    await userEvent.upload(await screen.findByLabelText(/קובץ תנועות/), selectedFile);
    await userEvent.selectOptions(screen.getByLabelText(/פרופיל ייבוא/), 'max');
    await userEvent.click(screen.getByRole('button', { name: /המשך לבדיקת התנועות/ }));

    expect(uploadImportFile).toHaveBeenCalledTimes(1);
    const sentFormData = uploadImportFile.mock.calls[0][0];
    expect(sentFormData.get('file')).toBe(selectedFile);
    expect(sentFormData.get('profile')).toBe('max');
    expect(Array.from(sentFormData.keys())).toEqual(['file', 'profile']);
    expect(screen.getByText('מעלה ומפענח את הקובץ…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'מעלה ומעבד…' })).toBeDisabled();

    request.resolve({ data: { totalRows: 2, previewData: previewRows } });
    expect(await screen.findByRole('region', { name: 'טבלת תצוגה מקדימה' })).toBeInTheDocument();
  });

  it('renders the same real preview rows and fields in the desktop table and mobile cards', async () => {
    const tableRegion = await advanceToPreview();
    const table = within(tableRegion);
    const cards = screen.getByLabelText('כרטיסי תצוגה מקדימה');

    expect(table.getByText('2026-08-03')).toHaveAttribute('dir', 'ltr');
    expect(table.getByText('PAYPAL *STEAM')).toBeInTheDocument();
    expect(table.getByText('₪129.00')).toBeInTheDocument();
    expect(table.getByText('35.00')).toBeInTheDocument();
    expect(table.getByText('USD')).toHaveAttribute('dir', 'ltr');
    expect(table.getByText('3.6857')).toHaveAttribute('dir', 'ltr');
    expect(table.getByText('תשלום 1 מתוך 3')).toBeInTheDocument();
    expect(table.getByText('חיוב מחו״ל')).toBeInTheDocument();
    expect(within(cards).getByRole('article', { name: 'תנועה מיובאת: PAYPAL *STEAM' })).toBeInTheDocument();
    expect(within(cards).getByRole('article', { name: 'תנועה מיובאת: GOOGLE *CLOUD' })).toBeInTheDocument();
    expect(within(cards).getAllByText('₪129.00').length).toBeGreaterThan(0);
    expect(document.body).not.toHaveTextContent('129.00000000001');
    const summary = screen.getByLabelText('סיכום התצוגה המקדימה');
    expect(summary).toHaveTextContent('2 שורות נקלטו');
    expect(summary).toHaveTextContent('1 מסווגות');
    expect(summary).toHaveTextContent('1 ללא קטגוריה');
    expect(summary).toHaveTextContent('0 הוסרו');
  });

  it('shows parse failure without discarding the selected profile, source, or file', async () => {
    uploadImportFile.mockRejectedValueOnce(new Error('invalid spreadsheet'));
    renderPage();
    await userEvent.upload(await screen.findByLabelText(/קובץ תנועות/), file());
    await userEvent.selectOptions(screen.getByLabelText(/פרופיל ייבוא/), 'debit_bank');
    await userEvent.selectOptions(screen.getByLabelText(/אמצעי תשלום/), '12');
    await userEvent.click(screen.getByRole('button', { name: /המשך לבדיקת התנועות/ }));

    expect(await screen.findByText('פענוח הקובץ נכשל')).toBeInTheDocument();
    expect(screen.getByLabelText(/פרופיל ייבוא/)).toHaveValue('debit_bank');
    expect(screen.getByLabelText(/אמצעי תשלום/)).toHaveValue('12');
    expect(screen.getByText('august-statement.xlsx')).toBeInTheDocument();
  });

  it('rejects unsupported file extensions at the presentation boundary without calling the parser', async () => {
    renderPage();
    const unsupportedFile = new File(['statement'], 'statement.pdf', { type: 'application/pdf' });
    await userEvent.upload(await screen.findByLabelText(/קובץ תנועות/), unsupportedFile, {
      applyAccept: false,
    });

    expect(screen.getByText('סוג הקובץ אינו נתמך. ניתן לייבא קבצי CSV, XLS ו־XLSX בלבד.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /המשך לבדיקת התנועות/ })).toBeDisabled();
    expect(uploadImportFile).not.toHaveBeenCalled();
  });

  it('provides a retryable supporting-data load error', async () => {
    getCategories.mockRejectedValueOnce(new Error('network'));
    renderPage();

    expect(await screen.findByRole('heading', { name: 'טעינת נתוני הייבוא נכשלה' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'נסה שוב' }));
    expect(await screen.findByLabelText(/פרופיל ייבוא/)).toBeInTheDocument();
    expect(getCategories).toHaveBeenCalledTimes(2);
    expect(getPaymentSources).toHaveBeenCalledTimes(2);
  });
});

describe('Import categories and row removal', () => {
  it('keeps row category assignments independent and uses the existing category id contract', async () => {
    const tableRegion = await advanceToPreview();
    const table = within(tableRegion);
    const firstCategory = table.getByRole('combobox', { name: 'קטגוריה עבור PAYPAL *STEAM' });
    const secondCategory = table.getByRole('combobox', { name: 'קטגוריה עבור GOOGLE *CLOUD' });

    expect(firstCategory).toHaveValue('🍔 מזון');
    expect(secondCategory).toHaveValue('');
    await userEvent.click(secondCategory);
    await userEvent.click(table.getByRole('option', { name: /דיור/ }));
    expect(secondCategory).toHaveValue('🏠 דיור');
    expect(firstCategory).toHaveValue('🍔 מזון');
    expect(table.queryByText('ללא קטגוריה')).not.toBeInTheDocument();
  });

  it('creates a category with the existing API and assigns it to the row that opened the dialog', async () => {
    const request = deferred();
    createCategory.mockReturnValue(request.promise);
    const tableRegion = await advanceToPreview();
    const table = within(tableRegion);
    const secondCategory = table.getByRole('combobox', { name: 'קטגוריה עבור GOOGLE *CLOUD' });
    fireEvent.change(secondCategory, { target: { value: 'כלי עבודה' } });
    fireEvent.click(table.getByRole('button', { name: 'יצירת קטגוריה ״כלי עבודה״' }));

    const dialog = screen.getByRole('dialog', { name: 'קטגוריה חדשה' });
    expect(within(dialog).getByLabelText(/שם הקטגוריה/)).toHaveValue('כלי עבודה');
    fireEvent.click(within(dialog).getByRole('button', { name: 'יצירה ושיוך' }));

    await waitFor(() => expect(createCategory).toHaveBeenCalledWith({ name: 'כלי עבודה' }));
    await act(async () => {
      request.resolve({ data: { id: 9, name: 'כלי עבודה', icon: '🛠️' } });
      await request.promise;
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'קטגוריה חדשה' })).not.toBeInTheDocument());
    await waitFor(() => expect(table.getByRole('combobox', { name: 'קטגוריה עבור GOOGLE *CLOUD' })).toHaveValue('🛠️ כלי עבודה'));
    expect(table.getByRole('combobox', { name: 'קטגוריה עבור PAYPAL *STEAM' })).toHaveValue('🍔 מזון');
  });

  it('removes rows only from preview state, updates counts, and distinguishes all-removed from parser-empty', async () => {
    const tableRegion = await advanceToPreview();
    const table = within(tableRegion);
    await userEvent.click(table.getByRole('button', { name: 'הסרת השורה PAYPAL *STEAM מהייבוא' }));

    expect(table.queryByText('PAYPAL *STEAM')).not.toBeInTheDocument();
    expect(table.getByText('GOOGLE *CLOUD')).toBeInTheDocument();
    expect(screen.getByLabelText('סיכום התצוגה המקדימה')).toHaveTextContent('1 הוסרו');
    expect(saveImportedTransactions).not.toHaveBeenCalled();

    await userEvent.click(table.getByRole('button', { name: 'הסרת השורה GOOGLE *CLOUD מהייבוא' }));
    expect(await screen.findByRole('heading', { name: 'לא נותרו שורות לשמירה' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /שמירת .* תנועות/ })).not.toBeInTheDocument();

    uploadImportFile.mockResolvedValueOnce({ data: { totalRows: 0, previewData: [] } });
    await userEvent.click(screen.getByRole('button', { name: 'חזרה לבחירת קובץ' }));
    await userEvent.click(screen.getByRole('button', { name: /המשך לבדיקת התנועות/ }));
    expect(await screen.findByRole('heading', { name: 'לא נמצאו תנועות בקובץ' })).toBeInTheDocument();
  });
});

describe('Import save behavior', () => {
  it('cancels and confirms uncategorized save, preserves the payload, prevents duplicates, and navigates home', async () => {
    const request = deferred();
    saveImportedTransactions.mockReturnValue(request.promise);
    await advanceToPreview();
    await userEvent.click(screen.getByRole('button', { name: 'שמירת 2 תנועות' }));

    let dialog = screen.getByRole('dialog', { name: 'שמירה עם תנועות לא מסווגות' });
    expect(within(dialog).getByText(/1 תנועות יישמרו ללא קטגוריה/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'חזרה לסיווג' })).toHaveFocus();
    await userEvent.click(within(dialog).getByRole('button', { name: 'חזרה לסיווג' }));
    expect(saveImportedTransactions).not.toHaveBeenCalled();
    expect(screen.getAllByText('GOOGLE *CLOUD').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: 'שמירת 2 תנועות' }));
    dialog = screen.getByRole('dialog', { name: 'שמירה עם תנועות לא מסווגות' });
    const confirm = within(dialog).getByRole('button', { name: 'שמירה בכל זאת' });
    await userEvent.click(confirm);
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(saveImportedTransactions).toHaveBeenCalledTimes(1);
    expect(saveImportedTransactions).toHaveBeenCalledWith([
      { ...previewRows[0], category_id: 7 },
      { ...previewRows[1], category_id: '' },
    ], 11);

    request.resolve({ data: { success: true, count: 2 } });
    expect(await screen.findByText('מסך הבית')).toBeInTheDocument();
    expect(screen.getByText('2 תנועות נשמרו בהצלחה.')).toBeInTheDocument();
  });

  it('retains preview rows, category assignments, and removed state after save failure', async () => {
    saveImportedTransactions.mockRejectedValueOnce(new Error('save failed'));
    const tableRegion = await advanceToPreview();
    const table = within(tableRegion);
    await userEvent.click(table.getByRole('button', { name: 'הסרת השורה PAYPAL *STEAM מהייבוא' }));
    const remainingCategory = table.getByRole('combobox', { name: 'קטגוריה עבור GOOGLE *CLOUD' });
    await userEvent.click(remainingCategory);
    await userEvent.click(table.getByRole('option', { name: /דיור/ }));
    await userEvent.click(screen.getByRole('button', { name: 'שמירת 1 תנועות' }));

    expect(await screen.findByText(/שמירת התנועות נכשלה/)).toBeInTheDocument();
    expect(table.getByText('GOOGLE *CLOUD')).toBeInTheDocument();
    expect(table.queryByText('PAYPAL *STEAM')).not.toBeInTheDocument();
    expect(table.getByRole('combobox', { name: 'קטגוריה עבור GOOGLE *CLOUD' })).toHaveValue('🏠 דיור');
    expect(screen.getByLabelText('סיכום התצוגה המקדימה')).toHaveTextContent('1 הוסרו');
    expect(screen.queryByText('מסך הבית')).not.toBeInTheDocument();
  });

  it('does not show uncategorized confirmation after every remaining row is categorized', async () => {
    const tableRegion = await advanceToPreview();
    const table = within(tableRegion);
    const category = table.getByRole('combobox', { name: 'קטגוריה עבור GOOGLE *CLOUD' });
    await userEvent.click(category);
    await userEvent.click(table.getByRole('option', { name: /דיור/ }));
    await userEvent.click(screen.getByRole('button', { name: 'שמירת 2 תנועות' }));

    await waitFor(() => expect(saveImportedTransactions).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog', { name: 'שמירה עם תנועות לא מסווגות' })).not.toBeInTheDocument();
    expect(saveImportedTransactions.mock.calls[0][0][1].category_id).toBe(8);
  });

  it('contains no unsupported import features or additional backend requests', async () => {
    await advanceToPreview();

    expect(screen.queryByText(/כפילויות|היסטוריית ייבוא|מיפוי עמודות|זיהוי ספק אוטומטי|ייבוא ברקע|Rollback/i)).not.toBeInTheDocument();
    expect(uploadImportFile).toHaveBeenCalledTimes(1);
    expect(getCategories).toHaveBeenCalledTimes(1);
    expect(getPaymentSources).toHaveBeenCalledTimes(1);
  });
});
