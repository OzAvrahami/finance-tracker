import { useMemo, useState } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import {
  addShoppingListItem,
  checkoutShoppingList,
  createShoppingCatalogCategory,
  createShoppingList,
  deleteShoppingList,
  getCategories,
  getPaymentSources,
  getShoppingCatalogCategories,
  getShoppingCatalogItems,
  getShoppingListById,
  getShoppingLists,
  getShoppingListTypes,
  removeShoppingListItem,
  toggleShoppingItemPurchased,
  updateShoppingList,
} from '../../services/api';
import ShoppingLists from './ShoppingLists';

vi.mock('../../services/api', () => ({
  addShoppingListItem: vi.fn(),
  checkoutShoppingList: vi.fn(),
  createShoppingCatalogCategory: vi.fn(),
  createShoppingList: vi.fn(),
  deleteShoppingList: vi.fn(),
  getCategories: vi.fn(),
  getPaymentSources: vi.fn(),
  getShoppingCatalogCategories: vi.fn(),
  getShoppingCatalogItems: vi.fn(),
  getShoppingListById: vi.fn(),
  getShoppingLists: vi.fn(),
  getShoppingListTypes: vi.fn(),
  removeShoppingListItem: vi.fn(),
  toggleShoppingItemPurchased: vi.fn(),
  updateShoppingList: vi.fn(),
}));

const listTypes = [
  { id: 4, name: 'סופרמרקט' },
  { id: 5, name: 'ציוד לבית' },
];

const overviewLists = [
  {
    id: 1,
    title: 'קניות שבועיות',
    list_type_id: 4,
    status: 'active',
    item_count: 2,
    purchased_count: 1,
    updated_at: '2026-08-10T06:30:00Z',
    shopping_list_types: { name: 'סופרמרקט' },
  },
  {
    id: 2,
    title: 'ציוד לבית',
    list_type_id: 5,
    status: 'draft',
    item_count: 0,
    purchased_count: 0,
    updated_at: '2026-08-09T06:30:00Z',
    shopping_list_types: { name: 'ציוד לבית' },
  },
  {
    id: 3,
    title: 'קנייה ישנה',
    list_type_id: 4,
    status: 'checked_out',
    item_count: 3,
    purchased_count: 3,
    updated_at: '2026-08-01T06:30:00Z',
    shopping_list_types: { name: 'סופרמרקט' },
  },
  {
    id: 4,
    title: 'רשימה בארכיון',
    list_type_id: 4,
    status: 'archived',
    item_count: 1,
    purchased_count: 1,
    updated_at: '2026-07-01T06:30:00Z',
    shopping_list_types: { name: 'סופרמרקט' },
  },
];

const catalogCategories = [
  { id: 21, name: 'ירקות ופירות', icon: '🥬' },
  { id: 22, name: 'חלב וביצים', icon: '🥛' },
];

const catalogItems = [
  { id: 31, name: 'עגבניות שרי', default_unit: 'ק״ג', default_price: 12.9 },
];

const detailList = (overrides = {}) => ({
  id: 1,
  title: 'קניות שבועיות',
  list_type_id: 4,
  status: 'active',
  shopping_list_items: [
    {
      id: 11,
      list_id: 1,
      catalog_item_id: 31,
      category_id: 21,
      quantity: 2,
      unit: 'ק״ג',
      price: 12.9,
      notes: 'רק טריות',
      is_purchased: false,
      shopping_catalog_items: { name: 'עגבניות שרי' },
      shopping_catalog_categories: { name: 'ירקות ופירות', icon: '🥬' },
    },
    {
      id: 12,
      list_id: 1,
      catalog_item_id: null,
      custom_name: 'Milk English',
      category_id: 22,
      quantity: 1,
      unit: 'יח׳',
      price: 9.700000000000003,
      notes: null,
      is_purchased: true,
      shopping_catalog_items: null,
      shopping_catalog_categories: { name: 'חלב וביצים', icon: '🥛' },
    },
  ],
  ...overrides,
});

const paymentSources = [{ id: 41, name: 'מקס', last4: '7710' }];
const financialCategories = [{ id: 51, name: 'מזון', icon: '🍔', type: 'expense' }];

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
  const value = useMemo(() => ({ setPageHeader: setHeader }), []);

  return (
    <PageHeaderContext.Provider value={value}>
      {header?.subtitle && <p>{header.subtitle}</p>}
      {header?.primaryAction && (
        <button type="button" onClick={header.primaryAction.onClick}>
          {header.primaryAction.label}
        </button>
      )}
      {children}
    </PageHeaderContext.Provider>
  );
};

const renderPage = () => render(
  <ToastProvider>
    <HeaderHarness><ShoppingLists /></HeaderHarness>
  </ToastProvider>,
);

const openList = async (title = 'קניות שבועיות') => {
  renderPage();
  const card = await screen.findByRole('article', { name: new RegExp(title) });
  await userEvent.click(within(card).getByRole('button', { name: 'פתיחה' }));
  return screen.findByRole('heading', { name: title, level: 2 });
};

beforeEach(() => {
  vi.resetAllMocks();
  getShoppingLists.mockResolvedValue({ data: overviewLists });
  getShoppingListTypes.mockResolvedValue({ data: listTypes });
  getShoppingListById.mockResolvedValue({ data: detailList() });
  getShoppingCatalogCategories.mockResolvedValue({ data: catalogCategories });
  getShoppingCatalogItems.mockResolvedValue({ data: catalogItems });
  getPaymentSources.mockResolvedValue({ data: paymentSources });
  getCategories.mockResolvedValue({ data: financialCategories });
  createShoppingList.mockResolvedValue({ data: {} });
  deleteShoppingList.mockResolvedValue({ data: { success: true } });
  addShoppingListItem.mockResolvedValue({ data: {} });
  createShoppingCatalogCategory.mockResolvedValue({ data: { id: 23, name: 'מאפים', icon: '🥖' } });
  toggleShoppingItemPurchased.mockResolvedValue({ data: {} });
  removeShoppingListItem.mockResolvedValue({ data: { success: true } });
  updateShoppingList.mockResolvedValue({ data: { status: 'active' } });
  checkoutShoppingList.mockResolvedValue({ data: { transaction_id: 91, total_amount: 9.7 } });
});

describe('Shopping overview', () => {
  it('uses the shell action, loads once, preserves every real status, count, and card field', async () => {
    renderPage();

    expect(screen.getByLabelText('טעינת רשימות קניות')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'רשימה חדשה' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(getShoppingLists).toHaveBeenCalledTimes(1);
    expect(getShoppingListTypes).toHaveBeenCalledTimes(1);

    const tabs = screen.getByRole('tablist', { name: 'סינון לפי סטטוס רשימה' });
    for (const label of ['הכול', 'טיוטה', 'פעילות', 'הושלמו בקופה', 'בארכיון']) {
      expect(within(tabs).getByRole('tab', { name: new RegExp(label) })).toBeInTheDocument();
    }

    const activeCard = screen.getByRole('article', { name: /קניות שבועיות/ });
    expect(within(activeCard).getByText('סופרמרקט')).toBeInTheDocument();
    expect(within(activeCard).getByText('פעילה')).toBeInTheDocument();
    expect(within(activeCard).getByText('1 מתוך 2 פריטים')).toBeInTheDocument();
    expect(within(activeCard).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  it('filters locally, distinguishes filtered and dataset empty states, and does not refetch', async () => {
    const populatedView = renderPage();
    await screen.findByRole('article', { name: /קניות שבועיות/ });
    await userEvent.click(screen.getByRole('tab', { name: /הושלמו בקופה/ }));

    expect(screen.getByRole('article', { name: /קנייה ישנה/ })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: /קניות שבועיות/ })).not.toBeInTheDocument();
    expect(getShoppingLists).toHaveBeenCalledTimes(1);
    populatedView.unmount();

    getShoppingLists.mockResolvedValueOnce({
      data: overviewLists.filter((list) => list.status !== 'archived'),
    });
    const filteredView = renderPage();
    await screen.findByRole('article', { name: /קניות שבועיות/ });
    await userEvent.click(screen.getByRole('tab', { name: /בארכיון/ }));
    expect(screen.getByText('אין רשימות בסטטוס הזה')).toBeInTheDocument();
    filteredView.unmount();

    getShoppingLists.mockResolvedValueOnce({ data: [] });
    renderPage();
    expect(await screen.findByText('אין רשימות קניות')).toBeInTheDocument();
  });

  it('creates a draft with the existing title/type payload, validates, prevents duplicates, and retains failure input', async () => {
    const request = deferred();
    createShoppingList.mockReturnValueOnce(request.promise);
    renderPage();
    await screen.findByRole('article', { name: /קניות שבועיות/ });
    await userEvent.click(screen.getByRole('button', { name: 'רשימה חדשה' }));

    const dialog = screen.getByRole('dialog', { name: 'רשימת קניות חדשה' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'יצירת הרשימה' }));
    expect(within(dialog).getByText('יש להזין שם לרשימה')).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText(/שם הרשימה/), 'קנייה לסוף השבוע');
    await userEvent.selectOptions(within(dialog).getByLabelText(/סוג רשימה/), '5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'יצירת הרשימה' }));
    await userEvent.click(within(dialog).getByRole('button', { name: /יוצר רשימה/ }));
    expect(createShoppingList).toHaveBeenCalledTimes(1);
    expect(createShoppingList).toHaveBeenCalledWith({ title: 'קנייה לסוף השבוע', list_type_id: '5' });

    await act(async () => request.reject(new Error('failed')));
    expect(await within(dialog).findByText(/יצירת הרשימה נכשלה/)).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('קנייה לסוף השבוע')).toBeInTheDocument();
  });

  it('deletes only allowed list states through accessible confirmation', async () => {
    renderPage();
    const activeCard = await screen.findByRole('article', { name: /קניות שבועיות/ });
    const checkedOutCard = screen.getByRole('article', { name: /קנייה ישנה/ });
    expect(within(checkedOutCard).queryByRole('button', { name: /מחיקת הרשימה/ })).not.toBeInTheDocument();

    await userEvent.click(within(activeCard).getByRole('button', { name: /מחיקת הרשימה/ }));
    const dialog = screen.getByRole('dialog', { name: 'מחיקת רשימת קניות' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'ביטול' }));
    expect(deleteShoppingList).not.toHaveBeenCalled();

    await userEvent.click(within(activeCard).getByRole('button', { name: /מחיקת הרשימה/ }));
    await userEvent.click(screen.getByRole('button', { name: 'מחיקת הרשימה' }));
    await waitFor(() => expect(deleteShoppingList).toHaveBeenCalledWith(1));
  });
});

describe('Shopping in-page detail and item lifecycle', () => {
  it('opens detail without routing, preserves mapped categories, grouping, totals, and floating-point formatting', async () => {
    await openList();

    expect(getShoppingListById).toHaveBeenCalledWith(1);
    expect(getShoppingCatalogCategories).toHaveBeenCalledWith(4);
    expect(screen.getByText('סופרמרקט')).toBeInTheDocument();
    expect(screen.getByText('ירקות ופירות')).toBeInTheDocument();
    expect(screen.getByText('חלב וביצים')).toBeInTheDocument();
    expect(screen.getByText('רק טריות')).toBeInTheDocument();
    expect(screen.getByText('₪35.50')).toBeInTheDocument();
    expect(screen.getAllByText('₪9.70').length).toBeGreaterThan(0);
    expect(screen.queryByText(/000000000/)).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'התקדמות הקנייה' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText(/פירוט הרשימה נשאר בתוך עמוד הקניות/)).toBeInTheDocument();
  });

  it('adds an existing catalog item with mapped defaults and the unchanged payload', async () => {
    await openList();
    await userEvent.click(screen.getByRole('button', { name: 'הוספת פריט' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^קטגוריית קטלוג/ }), '21');
    await waitFor(() => expect(getShoppingCatalogItems).toHaveBeenCalledWith({ category_id: '21' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^פריט מהקטלוג/ }), '31');
    await waitFor(() => expect(screen.getByLabelText('יחידה')).toHaveValue('ק״ג'));
    expect(screen.getByLabelText(/^מחיר ליחידה$/)).toHaveValue(12.9);
    await userEvent.clear(screen.getByLabelText(/^כמות/));
    await userEvent.type(screen.getByLabelText(/^כמות/), '2');
    await userEvent.type(screen.getByLabelText('הערות'), 'ללא אריזה');
    await userEvent.click(screen.getByRole('button', { name: 'הוספה לרשימה' }));

    await waitFor(() => expect(addShoppingListItem).toHaveBeenCalledWith(1, {
      catalog_item_id: '31',
      custom_name: null,
      category_id: '21',
      quantity: '2',
      unit: 'ק״ג',
      price: 12.9,
      notes: 'ללא אריזה',
    }));
  });

  it('adds a custom item and creates a mapped catalog category using the existing APIs', async () => {
    await openList();
    await userEvent.click(screen.getByRole('button', { name: 'הוספת פריט' }));
    await userEvent.click(screen.getByRole('radio', { name: 'פריט חופשי' }));
    await userEvent.click(screen.getByRole('button', { name: 'יצירת קטגוריית קטלוג חדשה' }));
    const categoryDialog = screen.getByRole('dialog', { name: 'קטגוריית קטלוג חדשה' });
    await userEvent.type(within(categoryDialog).getByLabelText(/שם קטגוריית הקטלוג/), 'מאפים');
    await userEvent.click(within(categoryDialog).getByRole('button', { name: 'שמירה' }));
    await waitFor(() => expect(createShoppingCatalogCategory).toHaveBeenCalledWith({ name: 'מאפים', list_type_id: 4 }));

    await userEvent.type(screen.getByLabelText(/שם הפריט/), 'לחם מחמצת');
    await userEvent.clear(screen.getByLabelText(/^כמות/));
    await userEvent.type(screen.getByLabelText(/^כמות/), '1');
    await userEvent.type(screen.getByLabelText('יחידה'), 'יח׳');
    await userEvent.type(screen.getByLabelText(/^מחיר ליחידה$/), '18.5');
    await userEvent.type(screen.getByLabelText('הערות'), 'פרוס');
    await userEvent.click(screen.getByRole('button', { name: 'הוספה לרשימה' }));

    await waitFor(() => expect(addShoppingListItem).toHaveBeenCalledWith(1, {
      catalog_item_id: null,
      custom_name: 'לחם מחמצת',
      category_id: '23',
      quantity: '1',
      unit: 'יח׳',
      price: '18.5',
      notes: 'פרוס',
    }));
  });

  it('toggles purchase only after the existing API and removes through confirmation', async () => {
    await openList();
    await userEvent.click(screen.getByRole('button', { name: 'סימון עגבניות שרי כנקנה' }));
    await waitFor(() => expect(toggleShoppingItemPurchased).toHaveBeenCalledWith(1, 11));

    await userEvent.click(screen.getByRole('button', { name: 'הסרת עגבניות שרי מהרשימה' }));
    const dialog = screen.getByRole('dialog', { name: 'הסרת פריט מהרשימה' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'הסרת הפריט' }));
    await waitFor(() => expect(removeShoppingListItem).toHaveBeenCalledWith(1, 11));
  });

  it('activates a draft using the same status payload and keeps failure recoverable', async () => {
    getShoppingListById.mockResolvedValue({ data: detailList({ id: 2, title: 'ציוד לבית', status: 'draft', shopping_list_items: [] }) });
    updateShoppingList.mockRejectedValueOnce(new Error('failed'));
    await openList('ציוד לבית');

    await userEvent.click(screen.getByRole('button', { name: 'הפעלת הרשימה' }));
    const dialog = screen.getByRole('dialog', { name: 'הפעלת הרשימה' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'הפעלת הרשימה' }));
    await waitFor(() => expect(updateShoppingList).toHaveBeenCalledWith(2, { status: 'active' }));
    expect(await within(dialog).findByText(/הפעלת הרשימה נכשלה/)).toBeInTheDocument();
  });

  it('renders checked-out lists as read-only without reopen, edit, toggle, or delete actions', async () => {
    getShoppingListById.mockResolvedValue({ data: detailList({ id: 3, title: 'קנייה ישנה', status: 'checked_out' }) });
    await openList('קנייה ישנה');

    expect(screen.getByText(/נשמרת לקריאה בלבד/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'הוספת פריט' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /סימון .* כנקנה/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /הסרת .* מהרשימה/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /פתיחה מחדש/ })).not.toBeInTheDocument();
  });
});

describe('Shopping checkout safety', () => {
  it('uses purchased-only total, optional financial links, unchanged payload, and blocks duplicate checkout', async () => {
    const request = deferred();
    checkoutShoppingList.mockReturnValueOnce(request.promise);
    getShoppingListById
      .mockResolvedValueOnce({ data: detailList() })
      .mockResolvedValueOnce({ data: detailList({ status: 'checked_out' }) });
    await openList();
    await userEvent.click(screen.getByRole('button', { name: 'סגירת קנייה' }));

    const dialog = await screen.findByRole('dialog', { name: 'סגירת קנייה' });
    expect(within(dialog).getByText('₪9.70')).toBeInTheDocument();
    expect(within(dialog).getByText(/קטגוריה של תנועות כספיות/)).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText('קטגוריה פיננסית לתנועה'), '51');
    expect(within(dialog).getByLabelText('אמצעי תשלום')).toHaveValue('41');
    const confirm = within(dialog).getByRole('button', { name: /סגירת הקנייה ויצירת תנועה/ });
    await userEvent.click(confirm);
    await userEvent.click(confirm);
    expect(checkoutShoppingList).toHaveBeenCalledTimes(1);
    expect(checkoutShoppingList).toHaveBeenCalledWith(1, { payment_source_id: '41', category_id: '51' });

    await act(async () => request.resolve({ data: { transaction_id: 91, total_amount: 9.7 } }));
    expect(await screen.findByText('הקנייה נסגרה')).toBeInTheDocument();
    expect(screen.getByText(/נשמרת לקריאה בלבד/)).toBeInTheDocument();
  });

  it('keeps checkout open and never shows success after endpoint or confirmation-refresh failure', async () => {
    checkoutShoppingList.mockRejectedValueOnce(new Error('partial failure'));
    await openList();
    await userEvent.click(screen.getByRole('button', { name: 'סגירת קנייה' }));
    const dialog = await screen.findByRole('dialog', { name: 'סגירת קנייה' });
    await userEvent.click(within(dialog).getByRole('button', { name: /סגירת הקנייה ויצירת תנועה/ }));

    expect(await within(dialog).findByText('סגירת הקנייה לא הושלמה')).toBeInTheDocument();
    expect(screen.queryByText('הקנייה נסגרה')).not.toBeInTheDocument();
    expect(screen.getByText('פעילה')).toBeInTheDocument();
  });
});

describe('Shopping states and product truth', () => {
  it('shows retryable page and detail failures without fake content', async () => {
    getShoppingLists.mockRejectedValueOnce(new Error('offline'));
    renderPage();
    expect(await screen.findByText('טעינת רשימות הקניות נכשלה')).toBeInTheDocument();

    getShoppingLists.mockResolvedValueOnce({ data: overviewLists });
    await userEvent.click(screen.getByRole('button', { name: 'נסה שוב' }));
    expect(await screen.findByRole('article', { name: /קניות שבועיות/ })).toBeInTheDocument();
  });

  it('contains no unsupported shopping routes or actions and shares one detail rendering across widths', async () => {
    await openList();
    expect(screen.queryByText(/ברקוד|שיתוף|מלאי|השוואת מחירים|תזכורת|Rollback/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /פתיחה מחדש|ביטול סגירה/ })).not.toBeInTheDocument();
    expect(getShoppingListById).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('article', { name: 'עגבניות שרי' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Milk English' })).toBeInTheDocument();
  });
});
