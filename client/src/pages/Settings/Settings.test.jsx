import { useMemo, useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import {
  createAdminShoppingCatalogCategory,
  createAdminShoppingListType,
  createSettingsCategory,
  createSettingsPaymentSource,
  deleteAdminShoppingCatalogCategory,
  deleteAdminShoppingListType,
  deleteSettingsCategory,
  deleteSettingsPaymentSource,
  getAdminListTypeCategoryLinks,
  getAdminShoppingCatalogCategories,
  getAdminShoppingListTypes,
  getSettingsCategories,
  getSettingsPaymentSources,
  setAdminListTypeCategoryLinks,
  setSettingsCategoryRecurringBudget,
  updateAdminShoppingCatalogCategory,
  updateAdminShoppingListType,
  updateSettingsCategory,
  updateSettingsPaymentSource,
} from '../../services/api';
import Settings from './Settings';

vi.mock('../../services/api', () => ({
  createAdminShoppingCatalogCategory: vi.fn(),
  createAdminShoppingListType: vi.fn(),
  createSettingsCategory: vi.fn(),
  createSettingsPaymentSource: vi.fn(),
  deleteAdminShoppingCatalogCategory: vi.fn(),
  deleteAdminShoppingListType: vi.fn(),
  deleteSettingsCategory: vi.fn(),
  deleteSettingsPaymentSource: vi.fn(),
  getAdminListTypeCategoryLinks: vi.fn(),
  getAdminShoppingCatalogCategories: vi.fn(),
  getAdminShoppingListTypes: vi.fn(),
  getSettingsCategories: vi.fn(),
  getSettingsPaymentSources: vi.fn(),
  setAdminListTypeCategoryLinks: vi.fn(),
  setSettingsCategoryRecurringBudget: vi.fn(),
  updateAdminShoppingCatalogCategory: vi.fn(),
  updateAdminShoppingListType: vi.fn(),
  updateSettingsCategory: vi.fn(),
  updateSettingsPaymentSource: vi.fn(),
}));

const categories = [
  { id: 1, name: 'מזון', type: 'expense', icon: '🛒', keywords: ['רמי לוי', 'שופרסל'], is_active: true },
  { id: 2, name: 'משכורת', type: 'income', icon: '💰', keywords: [], is_active: false },
];

const paymentSources = [
  {
    id: 10,
    name: 'כרטיס יומיומי',
    method: 'credit_card',
    issuer: 'Visa Cal',
    last4: '4821',
    owner: 'דניאל',
    is_active: true,
  },
  {
    id: 11,
    name: 'מזומן ישן',
    method: 'cash',
    issuer: null,
    last4: null,
    owner: null,
    is_active: false,
  },
];

const listTypes = [
  { id: 20, name: 'סופרמרקט', slug: 'supermarket', is_active: true },
  { id: 21, name: 'בית מרקחת', slug: 'pharmacy', is_active: false },
];

const catalogCategories = [
  { id: 30, name: 'ירקות ופירות', icon: '🥬', is_active: true, linked: true },
  { id: 31, name: 'מוצרי חלב', icon: '🥛', is_active: true, linked: false },
  { id: 32, name: 'ארכיון', icon: '📦', is_active: false, linked: false },
];

const HeaderHarness = ({ children }) => {
  const [header, setHeader] = useState(null);
  const value = useMemo(() => ({ setPageHeader: setHeader }), []);
  return (
    <PageHeaderContext.Provider value={value}>
      {header && <div data-testid="page-header">{header.title} — {header.subtitle}</div>}
      {children}
    </PageHeaderContext.Provider>
  );
};

const renderSettings = () => render(<Settings />, { wrapper: HeaderHarness });

beforeEach(() => {
  vi.resetAllMocks();
  getSettingsCategories.mockResolvedValue({ data: categories });
  getSettingsPaymentSources.mockResolvedValue({ data: paymentSources });
  getAdminShoppingListTypes.mockResolvedValue({ data: listTypes });
  getAdminShoppingCatalogCategories.mockResolvedValue({ data: catalogCategories });
  getAdminListTypeCategoryLinks.mockResolvedValue({ data: catalogCategories });
  createSettingsCategory.mockResolvedValue({ data: {} });
  updateSettingsCategory.mockResolvedValue({ data: {} });
  deleteSettingsCategory.mockResolvedValue({ data: {} });
  createSettingsPaymentSource.mockResolvedValue({ data: {} });
  updateSettingsPaymentSource.mockResolvedValue({ data: {} });
  deleteSettingsPaymentSource.mockResolvedValue({ data: {} });
  createAdminShoppingListType.mockResolvedValue({ data: {} });
  updateAdminShoppingListType.mockResolvedValue({ data: {} });
  deleteAdminShoppingListType.mockResolvedValue({ data: {} });
  createAdminShoppingCatalogCategory.mockResolvedValue({ data: {} });
  updateAdminShoppingCatalogCategory.mockResolvedValue({ data: {} });
  deleteAdminShoppingCatalogCategory.mockResolvedValue({ data: {} });
  setAdminListTypeCategoryLinks.mockResolvedValue({ data: {} });
  setSettingsCategoryRecurringBudget.mockResolvedValue({ data: {} });
});

describe('Settings navigation and categories', () => {
  it('uses the shell heading, accessible real tabs, and initially loads only categories', async () => {
    renderSettings();

    expect(await screen.findByText('מזון')).toBeInTheDocument();
    expect(screen.getByTestId('page-header')).toHaveTextContent('הגדרות — קטגוריות, אמצעי תשלום והגדרות קניות');
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'קטגוריות' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'אמצעי תשלום' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'הגדרות קניות' })).toBeInTheDocument();
    expect(getSettingsCategories).toHaveBeenCalledTimes(1);
    expect(getSettingsPaymentSources).not.toHaveBeenCalled();
    expect(getAdminShoppingListTypes).not.toHaveBeenCalled();
  });

  it('preserves create payload including type, emoji, and comma-separated keyword behavior', async () => {
    renderSettings();
    await screen.findByText('מזון');
    await userEvent.click(screen.getByRole('button', { name: 'קטגוריה חדשה' }));
    const dialog = screen.getByRole('dialog', { name: 'קטגוריה חדשה' });

    await userEvent.type(within(dialog).getByLabelText('סמל'), '🍕');
    await userEvent.type(within(dialog).getByLabelText(/שם הקטגוריה/), 'מסעדות');
    await userEvent.selectOptions(within(dialog).getByLabelText('סוג'), 'expense');
    await userEvent.type(within(dialog).getByLabelText('מילות זיהוי לסיווג אוטומטי'), 'פיצה,  מסעדה, ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'שמירה' }));

    await waitFor(() => expect(createSettingsCategory).toHaveBeenCalledWith({
      name: 'מסעדות',
      type: 'expense',
      icon: '🍕',
      keywords: ['פיצה', 'מסעדה'],
    }));
  });

  it('keeps edit values and dialog open when the category type change conflicts', async () => {
    updateSettingsCategory.mockRejectedValueOnce({ response: { data: { error: 'לא ניתן לשנות סוג לקטגוריה עם תנועות' } } });
    renderSettings();
    await screen.findByText('מזון');
    await userEvent.click(screen.getByRole('button', { name: 'עריכת הקטגוריה מזון' }));
    const dialog = screen.getByRole('dialog', { name: 'עריכת קטגוריה' });

    await userEvent.selectOptions(within(dialog).getByLabelText('סוג'), 'income');
    await userEvent.click(within(dialog).getByRole('button', { name: 'שמירה' }));

    expect(await within(dialog).findByText('לא ניתן לשנות סוג לקטגוריה עם תנועות')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/שם הקטגוריה/)).toHaveValue('מזון');
    expect(updateSettingsCategory).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'income' }));
  });

  it('soft-deactivates through confirmation and can reveal/reactivate inactive categories', async () => {
    renderSettings();
    await screen.findByText('מזון');

    await userEvent.click(screen.getByRole('button', { name: 'השבתת מזון' }));
    const confirm = screen.getByRole('dialog', { name: /השבתת „מזון”/ });
    expect(within(confirm).getByText(/תנועות היסטוריות יישארו משויכות/)).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole('button', { name: 'השבתה' }));
    await waitFor(() => expect(deleteSettingsCategory).toHaveBeenCalledWith(1));

    await userEvent.click(screen.getByRole('switch', { name: /הצגת לא פעילות/ }));
    expect(screen.getByText('משכורת')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'הפעלה מחדש' }));
    await waitFor(() => expect(updateSettingsCategory).toHaveBeenCalledWith(2, { is_active: true }));
  });
  it('configures, displays, and disables an exact recurring budget only for an expense category', async () => {
    getSettingsCategories
      .mockResolvedValueOnce({ data: categories })
      .mockResolvedValueOnce({ data: [{ ...categories[0], recurring_budget_amount: '9007199254740993.01' }, categories[1]] })
      .mockResolvedValueOnce({ data: categories });
    renderSettings();
    await screen.findByText('מזון');
    expect(screen.queryByRole('button', { name: 'הגדרת תקציב חוזר עבור משכורת' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'הגדרת תקציב חוזר עבור מזון' }));
    const createDialog = screen.getByRole('dialog', { name: /תקציב חוזר/ });
    const amount = within(createDialog).getByLabelText(/^סכום חודשי חוזר/);
    await userEvent.type(amount, '9007199254740993.01');
    await userEvent.click(within(createDialog).getByRole('button', { name: 'שמירת תקציב חוזר' }));
    await waitFor(() => expect(setSettingsCategoryRecurringBudget).toHaveBeenCalledWith(1, {
      amount: '9007199254740993.01',
    }));
    expect(await screen.findByText('₪9,007,199,254,740,993.01')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'הגדרת תקציב חוזר עבור מזון' }));
    const disableDialog = screen.getByRole('dialog', { name: /תקציב חוזר/ });
    expect(within(disableDialog).getByLabelText(/^סכום חודשי חוזר/)).toHaveValue('9007199254740993.01');
    await userEvent.click(within(disableDialog).getByRole('button', { name: 'השבתת תקציב חוזר' }));
    await waitFor(() => expect(setSettingsCategoryRecurringBudget).toHaveBeenLastCalledWith(1, { amount: null }));
  });

  it('preserves explicit zero and user input after a recurring-budget save failure', async () => {
    setSettingsCategoryRecurringBudget.mockRejectedValueOnce({ response: { data: { error: 'שגיאת תקציב חוזר' } } });
    renderSettings();
    await screen.findByText('מזון');
    await userEvent.click(screen.getByRole('button', { name: 'הגדרת תקציב חוזר עבור מזון' }));
    const dialog = screen.getByRole('dialog', { name: /תקציב חוזר/ });
    const amount = within(dialog).getByLabelText(/^סכום חודשי חוזר/);
    await userEvent.type(amount, '0');
    await userEvent.click(within(dialog).getByRole('button', { name: 'שמירת תקציב חוזר' }));
    expect(await within(dialog).findByText('שגיאת תקציב חוזר')).toBeInTheDocument();
    expect(amount).toHaveValue('0');
    expect(setSettingsCategoryRecurringBudget).toHaveBeenCalledWith(1, { amount: '0' });
  });
});

describe('Payment sources', () => {
  it('shows only real source fields with bidi-safe technical values and excludes balances and limits', async () => {
    renderSettings();
    await userEvent.click(screen.getByRole('tab', { name: 'אמצעי תשלום' }));
    const source = await screen.findByRole('article', { name: 'כרטיס יומיומי' });

    expect(within(source).getByText('Visa Cal')).toHaveAttribute('dir', 'ltr');
    expect(within(source).getByText('•••• 4821')).toHaveAttribute('dir', 'ltr');
    expect(within(source).getByText('דניאל')).toBeInTheDocument();
    expect(screen.queryByText('יתרה זמינה')).not.toBeInTheDocument();
    expect(screen.queryByText('מסגרת אשראי', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('יתרת חשבון', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText(/אינה שומרת יתרת חשבון/)).toBeInTheDocument();
  });

  it('preserves the payment-source create contract and method values', async () => {
    renderSettings();
    await userEvent.click(screen.getByRole('tab', { name: 'אמצעי תשלום' }));
    await screen.findByText('כרטיס יומיומי');
    await userEvent.click(screen.getByRole('button', { name: 'אמצעי תשלום חדש' }));
    const dialog = screen.getByRole('dialog', { name: 'אמצעי תשלום חדש' });

    await userEvent.type(within(dialog).getByLabelText(/שם התצוגה/), 'ארנק משפחתי');
    await userEvent.selectOptions(within(dialog).getByLabelText('אמצעי'), 'digital_wallet');
    await userEvent.type(within(dialog).getByLabelText('מנפיק או בנק'), 'PayBox');
    await userEvent.type(within(dialog).getByLabelText('ארבע ספרות אחרונות'), '12x345');
    await userEvent.type(within(dialog).getByLabelText('בעלים'), 'נועה');
    await userEvent.click(within(dialog).getByRole('button', { name: 'שמירה' }));

    await waitFor(() => expect(createSettingsPaymentSource).toHaveBeenCalledWith({
      name: 'ארנק משפחתי',
      method: 'digital_wallet',
      issuer: 'PayBox',
      last4: '1234',
      owner: 'נועה',
    }));
  });

  it('uses reversible deactivation wording and preserves the delete API boundary', async () => {
    renderSettings();
    await userEvent.click(screen.getByRole('tab', { name: 'אמצעי תשלום' }));
    await screen.findByText('כרטיס יומיומי');
    await userEvent.click(screen.getByRole('button', { name: 'השבתת כרטיס יומיומי' }));
    const confirm = screen.getByRole('dialog', { name: /השבתת „כרטיס יומיומי”/ });
    expect(within(confirm).queryByText(/מחיקה לצמיתות/)).not.toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole('button', { name: 'השבתה' }));
    await waitFor(() => expect(deleteSettingsPaymentSource).toHaveBeenCalledWith(10));
  });

  it('preserves payment-source edit and reactivation payloads', async () => {
    renderSettings();
    await userEvent.click(screen.getByRole('tab', { name: 'אמצעי תשלום' }));
    await screen.findByText('כרטיס יומיומי');
    await userEvent.click(screen.getByRole('button', { name: 'עריכת אמצעי התשלום כרטיס יומיומי' }));
    const dialog = screen.getByRole('dialog', { name: 'עריכת אמצעי תשלום' });
    const owner = within(dialog).getByLabelText('בעלים');
    await userEvent.clear(owner);
    await userEvent.type(owner, 'יעל');
    await userEvent.click(within(dialog).getByRole('button', { name: 'שמירה' }));
    await waitFor(() => expect(updateSettingsPaymentSource).toHaveBeenCalledWith(10, {
      name: 'כרטיס יומיומי',
      method: 'credit_card',
      issuer: 'Visa Cal',
      last4: '4821',
      owner: 'יעל',
      is_active: true,
    }));

    await userEvent.click(screen.getByRole('switch', { name: /הצגת לא פעילים/ }));
    await userEvent.click(screen.getByRole('button', { name: 'הפעלה מחדש' }));
    await waitFor(() => expect(updateSettingsPaymentSource).toHaveBeenCalledWith(11, { is_active: true }));
  });
});

describe('Shopping configuration', () => {
  const openShopping = async () => {
    await userEvent.click(screen.getByRole('tab', { name: 'הגדרות קניות' }));
    await screen.findByText('סופרמרקט');
  };

  it('loads list types lazily, preserves slug normalization/validation, and creates with the same payload', async () => {
    renderSettings();
    await openShopping();
    expect(getAdminShoppingListTypes).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'סוג חדש' }));
    const dialog = screen.getByRole('dialog', { name: 'סוג רשימה חדש' });
    await userEvent.type(within(dialog).getByLabelText(/שם הסוג/), 'חומרי בניין');
    await userEvent.type(within(dialog).getByLabelText(/מזהה טכני/), 'Hardware Store!');
    expect(within(dialog).getByLabelText(/מזהה טכני/)).toHaveValue('hardwarestore');
    await userEvent.click(within(dialog).getByRole('button', { name: 'שמירה' }));

    await waitFor(() => expect(createAdminShoppingListType).toHaveBeenCalledWith({
      name: 'חומרי בניין',
      slug: 'hardwarestore',
    }));
  });

  it('keeps a list type active and surfaces a deactivation conflict inside the confirmation', async () => {
    deleteAdminShoppingListType.mockRejectedValueOnce({ response: { data: { error: 'קיימות רשימות שמשויכות לסוג זה' } } });
    renderSettings();
    await openShopping();
    await userEvent.click(screen.getByRole('button', { name: 'השבתת סופרמרקט' }));
    const confirm = screen.getByRole('dialog', { name: /השבתת „סופרמרקט”/ });
    await userEvent.click(within(confirm).getByRole('button', { name: 'השבתה' }));

    expect(await within(confirm).findByText(/לא ניתן להשבית את סוג הרשימה/)).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'סופרמרקט' })).toBeInTheDocument();
  });

  it('preserves list-type edit and reactivation payloads', async () => {
    renderSettings();
    await openShopping();
    await userEvent.click(screen.getByRole('button', { name: 'עריכת סוג הרשימה סופרמרקט' }));
    const dialog = screen.getByRole('dialog', { name: 'עריכת סוג רשימה' });
    const name = within(dialog).getByLabelText(/שם הסוג/);
    await userEvent.clear(name);
    await userEvent.type(name, 'סופר שבועי');
    await userEvent.click(within(dialog).getByRole('button', { name: 'שמירה' }));
    await waitFor(() => expect(updateAdminShoppingListType).toHaveBeenCalledWith(20, {
      name: 'סופר שבועי',
      slug: 'supermarket',
      is_active: true,
    }));

    await userEvent.click(screen.getByRole('switch', { name: /הצגת לא פעילים/ }));
    await userEvent.click(screen.getByRole('button', { name: 'הפעלה מחדש' }));
    await waitFor(() => expect(updateAdminShoppingListType).toHaveBeenCalledWith(21, { is_active: true }));
  });

  it('creates and reactivates catalog categories without confusing them with transaction categories', async () => {
    renderSettings();
    await openShopping();
    await userEvent.click(screen.getByRole('tab', { name: 'קטגוריות קטלוג' }));
    await screen.findByText('ירקות ופירות');
    expect(screen.getByText(/אינן קטגוריות של תנועות כספיות/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'קטגוריה חדשה' }));
    const dialog = screen.getByRole('dialog', { name: 'קטגוריית קטלוג חדשה' });
    await userEvent.type(within(dialog).getByLabelText('סמל'), '🥖');
    await userEvent.type(within(dialog).getByLabelText(/שם הקטגוריה/), 'מאפים');
    await userEvent.click(within(dialog).getByRole('button', { name: 'שמירה' }));
    await waitFor(() => expect(createAdminShoppingCatalogCategory).toHaveBeenCalledWith({ name: 'מאפים', icon: '🥖' }));
  });

  it('preserves catalog-category edit and soft-deactivation contracts', async () => {
    renderSettings();
    await openShopping();
    await userEvent.click(screen.getByRole('tab', { name: 'קטגוריות קטלוג' }));
    await screen.findByText('ירקות ופירות');
    await userEvent.click(screen.getByRole('button', { name: 'עריכת קטגוריית הקטלוג ירקות ופירות' }));
    const dialog = screen.getByRole('dialog', { name: 'עריכת קטגוריית קטלוג' });
    const name = within(dialog).getByLabelText(/שם הקטגוריה/);
    await userEvent.clear(name);
    await userEvent.type(name, 'ירקות');
    await userEvent.click(within(dialog).getByRole('button', { name: 'שמירה' }));
    await waitFor(() => expect(updateAdminShoppingCatalogCategory).toHaveBeenCalledWith(30, {
      name: 'ירקות',
      icon: '🥬',
      is_active: true,
    }));

    await userEvent.click(screen.getByRole('button', { name: 'השבתת ירקות ופירות' }));
    const confirm = screen.getByRole('dialog', { name: /השבתת „ירקות ופירות”/ });
    await userEvent.click(within(confirm).getByRole('button', { name: 'השבתה' }));
    await waitFor(() => expect(deleteAdminShoppingCatalogCategory).toHaveBeenCalledWith(30));
  });

  it('loads existing mappings, adds/removes independently, and saves the exact explicit categoryIds payload', async () => {
    renderSettings();
    await openShopping();
    await userEvent.click(screen.getByRole('tab', { name: 'מיפוי קטגוריות' }));

    expect(await screen.findByRole('button', { name: 'הוספת מוצרי חלב למיפוי' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'הסרת ירקות ופירות מהמיפוי' })).toBeInTheDocument();
    expect(getAdminListTypeCategoryLinks).toHaveBeenCalledWith('20');

    await userEvent.click(screen.getByRole('button', { name: 'הסרת ירקות ופירות מהמיפוי' }));
    await userEvent.click(screen.getByRole('button', { name: 'הוספת מוצרי חלב למיפוי' }));
    await userEvent.click(screen.getByRole('button', { name: 'שמירת שינויים (1 קטגוריות)' }));
    await waitFor(() => expect(setAdminListTypeCategoryLinks).toHaveBeenCalledWith('20', {
      categoryIds: [31],
    }));
    expect(await screen.findByText('המיפוי נשמר.')).toBeInTheDocument();
  });

  it('preserves mapping choices after a save failure and supports retrying the local save', async () => {
    setAdminListTypeCategoryLinks
      .mockRejectedValueOnce({ response: { status: 409, data: { error: 'המיפוי עודכן במקום אחר' } } })
      .mockResolvedValueOnce({ data: {} });
    renderSettings();
    await openShopping();
    await userEvent.click(screen.getByRole('tab', { name: 'מיפוי קטגוריות' }));
    await screen.findByRole('button', { name: 'הוספת מוצרי חלב למיפוי' });
    await userEvent.click(screen.getByRole('button', { name: 'הוספת מוצרי חלב למיפוי' }));
    await userEvent.click(screen.getByRole('button', { name: 'שמירת שינויים (2 קטגוריות)' }));

    expect(await screen.findByText('המיפוי עודכן במקום אחר')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'הסרת מוצרי חלב מהמיפוי' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'שמירת שינויים (2 קטגוריות)' }));
    await waitFor(() => expect(setAdminListTypeCategoryLinks).toHaveBeenCalledTimes(2));
  });
});

describe('Settings states and product truth', () => {
  it('shows a retryable category load error instead of a fake empty state', async () => {
    getSettingsCategories.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: [] });
    renderSettings();
    expect(await screen.findByText('טעינת הקטגוריות נכשלה')).toBeInTheDocument();
    expect(screen.queryByText('לא הוגדרו קטגוריות')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'נסו שוב' }));
    expect(await screen.findByText('לא הוגדרו קטגוריות')).toBeInTheDocument();
  });

  it('does not expose unsupported settings modules or financial-source metrics', async () => {
    renderSettings();
    await screen.findByText('מזון');
    for (const unsupported of [
      'מטבע ברירת מחדל',
      'חודש פיננסי',
      'התראות תקציב',
      'ערכת נושא לפי המערכת',
      'חיבור חשבונות',
      'יעדי חיסכון',
    ]) {
      expect(screen.queryByText(unsupported)).not.toBeInTheDocument();
    }
  });
});
