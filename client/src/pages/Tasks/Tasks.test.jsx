import { useMemo, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import {
  createTask,
  deleteTask,
  getAllLoans,
  getTasks,
  getTransactions,
  updateTask,
} from '../../services/api';
import { DEFAULT_TASK_FILTERS, filterAndSortTasks } from '../../utils/taskHelpers';
import Tasks from './Tasks';

vi.mock('../../services/api', () => ({
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  getAllLoans: vi.fn(),
  getTasks: vi.fn(),
  getTransactions: vi.fn(),
  updateTask: vi.fn(),
}));

const task = (overrides = {}) => ({
  id: 1,
  title: 'בדיקת חיוב כפול',
  notes: 'להתקשר לחברת האשראי עם מספר הפנייה',
  status: 'open',
  priority: 'high',
  category: 'finance',
  due_date: '2026-08-08',
  transaction_id: 101,
  loan_id: 201,
  created_at: '2026-08-01T08:00:00Z',
  transactions: {
    id: 101,
    description: 'חיוב Visa Store',
    total_amount: 252.04999999999995,
    transaction_date: '2026-08-07',
  },
  loans: { id: 201, name: 'הלוואת רכב' },
  ...overrides,
});

const tasks = [
  task(),
  task({
    id: 2,
    title: 'להשוות מסלולי ריבית',
    notes: '',
    status: 'in_progress',
    priority: 'urgent',
    category: 'work',
    due_date: '2026-08-10',
    transaction_id: null,
    loan_id: null,
    transactions: null,
    loans: null,
    created_at: '2026-08-03T08:00:00Z',
  }),
  task({
    id: 3,
    title: 'לתאם פגישה בבנק',
    status: 'waiting',
    priority: 'medium',
    category: 'personal',
    due_date: null,
    transaction_id: null,
    loan_id: null,
    transactions: null,
    loans: null,
    created_at: '2026-08-04T08:00:00Z',
  }),
  task({
    id: 4,
    title: 'מטלה שהושלמה',
    status: 'done',
    priority: 'high',
    category: 'system',
    due_date: '2026-08-01',
    transaction_id: null,
    loan_id: null,
    transactions: null,
    loans: null,
    created_at: '2026-08-05T08:00:00Z',
  }),
  task({
    id: 5,
    title: 'מטלה שבוטלה',
    status: 'cancelled',
    priority: 'low',
    category: 'other',
    due_date: null,
    transaction_id: null,
    loan_id: null,
    transactions: null,
    loans: null,
    created_at: '2026-08-06T08:00:00Z',
  }),
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

const renderPage = () => render(<Tasks />, { wrapper: HeaderHarness });

beforeEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
  vi.setSystemTime(new Date('2026-08-09T09:00:00Z'));
  getTasks.mockResolvedValue({ data: tasks });
  getAllLoans.mockResolvedValue({ data: [{ id: 201, name: 'הלוואת רכב', current_balance: 74300 }] });
  getTransactions.mockResolvedValue({
    data: {
      data: [{
        id: 101,
        description: 'חיוב Visa Store',
        total_amount: 252.04999999999995,
        transaction_date: '2026-08-07',
      }],
    },
  });
  createTask.mockResolvedValue({ data: {} });
  updateTask.mockResolvedValue({ data: {} });
  deleteTask.mockResolvedValue({ data: {} });
});

describe('Tasks loading, navigation, filters, and ordering', () => {
  it('uses the shell header, fetches once, and shows truthful status and overdue counts', async () => {
    renderPage();

    expect(screen.getByLabelText('טעינת מטלות')).toBeInTheDocument();
    expect(await screen.findByText('בדיקת חיוב כפול')).toBeInTheDocument();
    expect(getTasks).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByText('מעקב מטלות פיננסיות לפי סטטוס ועדיפות')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'מטלה חדשה' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /הכול\s*5/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /פעילות\s*3/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /פתוחות\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /בתהליך\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /ממתינות\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /הושלמו\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /בוטלו\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /באיחור\s*1/ })).toBeInTheDocument();
  });

  it('preserves every status view including the combined active and derived overdue views', async () => {
    renderPage();
    await screen.findByText('בדיקת חיוב כפול');

    expect(screen.queryByText('מטלה שהושלמה')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /הכול\s*5/ }));
    expect(screen.getByText('מטלה שהושלמה')).toBeInTheDocument();
    expect(screen.getByText('מטלה שבוטלה')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /בתהליך\s*1/ }));
    expect(screen.getByText('להשוות מסלולי ריבית')).toBeInTheDocument();
    expect(screen.queryByText('בדיקת חיוב כפול')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /ממתינות\s*1/ }));
    expect(screen.getByText('לתאם פגישה בבנק')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /פתוחות\s*1/ }));
    expect(screen.getByText('בדיקת חיוב כפול')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /הושלמו\s*1/ }));
    expect(screen.getByText('מטלה שהושלמה')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /בוטלו\s*1/ }));
    expect(screen.getByText('מטלה שבוטלה')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /באיחור\s*1/ }));
    expect(screen.getByText('בדיקת חיוב כפול')).toBeInTheDocument();
    expect(screen.queryByText('להשוות מסלולי ריבית')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /באיחור\s*1/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('combines priority, category, and title filters and restores the existing active default', async () => {
    renderPage();
    await screen.findByText('בדיקת חיוב כפול');

    await userEvent.selectOptions(screen.getByLabelText('עדיפות'), 'urgent');
    expect(screen.getByText('להשוות מסלולי ריבית')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('קטגוריית מטלה'), 'work');
    await userEvent.type(screen.getByRole('searchbox', { name: 'חיפוש לפי כותרת' }), 'ריבית');
    expect(screen.getByText('להשוות מסלולי ריבית')).toBeInTheDocument();
    expect(screen.getByLabelText('מסננים פעילים')).toHaveTextContent('עדיפות: דחוף');
    expect(screen.getByLabelText('מסננים פעילים')).toHaveTextContent('קטגוריה: עבודה');
    expect(screen.getByLabelText('מסננים פעילים')).toHaveTextContent('חיפוש: ריבית');

    await userEvent.click(screen.getAllByRole('button', { name: 'ניקוי מסננים' })[0]);
    expect(screen.getByRole('tab', { name: /פעילות\s*3/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('עדיפות')).toHaveValue('all');
    expect(screen.getByLabelText('קטגוריית מטלה')).toHaveValue('all');
    expect(screen.getByRole('searchbox', { name: 'חיפוש לפי כותרת' })).toHaveValue('');
  });

  it('characterizes incomplete, overdue, priority, due-date, and recency ordering', () => {
    const ordered = filterAndSortTasks([
      task({ id: 10, title: 'הושלמה', status: 'done', priority: 'urgent' }),
      task({ id: 11, title: 'ללא יעד ישנה', due_date: null, priority: 'low', created_at: '2026-07-01T00:00:00Z' }),
      task({ id: 12, title: 'ללא יעד חדשה', due_date: null, priority: 'low', created_at: '2026-08-01T00:00:00Z' }),
      task({ id: 13, title: 'דחופה עתידית', due_date: '2026-08-20', priority: 'urgent' }),
      task({ id: 14, title: 'באיחור בינונית', due_date: '2026-08-01', priority: 'medium' }),
      task({ id: 15, title: 'באיחור דחופה', due_date: '2026-08-02', priority: 'urgent' }),
    ], { ...DEFAULT_TASK_FILTERS, status: 'all' });

    expect(ordered.map((item) => item.id)).toEqual([15, 14, 13, 12, 11, 10]);
  });

  it('renders compact real cards with notes, financial links, bidi-safe dates, and no unsupported actions', async () => {
    renderPage();
    const card = await screen.findByRole('article', { name: 'בדיקת חיוב כפול' });

    expect(within(card).getByText('להתקשר לחברת האשראי עם מספר הפנייה')).toBeInTheDocument();
    expect(within(card).getByText('פתוח')).toBeInTheDocument();
    expect(within(card).getByText('עדיפות גבוה')).toBeInTheDocument();
    expect(within(card).getByText('פיננסי')).toBeInTheDocument();
    expect(within(card).getAllByText('באיחור').length).toBeGreaterThan(0);
    expect(within(card).getByText('תנועה: חיוב Visa Store')).toBeInTheDocument();
    expect(within(card).getByText('₪252.05')).toBeInTheDocument();
    expect(within(card).getByText('הלוואה: הלוואת רכב')).toBeInTheDocument();
    expect(within(card).getByText(/8 באוג׳ 2026/)).toHaveAttribute('dir', 'ltr');
    expect(document.body).not.toHaveTextContent('252.04999999999995');
    expect(screen.queryByText(/חזרתיות|תזכורת|משויך ל|תת־משימה|קנבן|AI/)).not.toBeInTheDocument();
  });

  it('shows retryable page errors and distinguishes dataset and filtered empty states', async () => {
    getTasks.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ data: [] });
    const firstRender = renderPage();

    expect(await screen.findByRole('heading', { name: 'טעינת המטלות נכשלה' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'נסה שוב' }));
    expect(await screen.findByRole('heading', { name: 'אין מטלות' })).toBeInTheDocument();
    firstRender.unmount();

    getTasks.mockResolvedValue({ data: tasks });
    renderPage();
    await screen.findByText('בדיקת חיוב כפול');
    await userEvent.type(screen.getByRole('searchbox', { name: 'חיפוש לפי כותרת' }), 'לא קיים');
    expect(screen.getByRole('heading', { name: 'אין מטלות שמתאימות למסננים' })).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'ניקוי מסננים' })[0]);
    expect(screen.getByText('בדיקת חיוב כפול')).toBeInTheDocument();
  });
});

describe('Tasks create and edit dialog', () => {
  it('opens from the shell action, validates title, and keeps the recent-transaction request bounded', async () => {
    renderPage();
    await screen.findByText('בדיקת חיוב כפול');
    await userEvent.click(screen.getByRole('button', { name: 'מטלה חדשה' }));

    const dialog = screen.getByRole('dialog', { name: 'מטלה חדשה' });
    expect(within(dialog).getByLabelText(/כותרת/)).toHaveFocus();
    await userEvent.click(within(dialog).getByRole('button', { name: 'יצירת מטלה' }));
    expect(within(dialog).getByText('יש להזין כותרת למטלה')).toBeInTheDocument();
    expect(createTask).not.toHaveBeenCalled();
    expect(getTransactions).toHaveBeenCalledTimes(1);
    expect(getTransactions).toHaveBeenCalledWith({ limit: 50 });
    expect(within(dialog).getByText('הרשימה כוללת את 50 התנועות האחרונות בלבד.')).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText(/כותרת/), 'חיפוש שלא מפעיל API');
    expect(getTransactions).toHaveBeenCalledTimes(1);
  });

  it('submits the existing create payload including transaction and loan links', async () => {
    renderPage();
    await screen.findByText('בדיקת חיוב כפול');
    await userEvent.click(screen.getByRole('button', { name: 'מטלה חדשה' }));
    const dialog = screen.getByRole('dialog', { name: 'מטלה חדשה' });

    await userEvent.type(within(dialog).getByLabelText(/כותרת/), 'לעבור על התקציב');
    await userEvent.type(within(dialog).getByLabelText('הערות'), 'כולל סעיפים חריגים');
    await userEvent.selectOptions(within(dialog).getByLabelText('סטטוס'), 'in_progress');
    await userEvent.selectOptions(within(dialog).getByLabelText('עדיפות'), 'urgent');
    await userEvent.selectOptions(within(dialog).getByLabelText('קטגוריית מטלה'), 'finance');
    fireEvent.change(within(dialog).getByLabelText('תאריך יעד'), { target: { value: '2026-08-25' } });
    await waitFor(() => expect(within(dialog).getByLabelText('תנועה מקושרת')).not.toBeDisabled());
    await userEvent.selectOptions(within(dialog).getByLabelText('תנועה מקושרת'), '101');
    await userEvent.selectOptions(within(dialog).getByLabelText('הלוואה מקושרת'), '201');
    await userEvent.click(within(dialog).getByRole('button', { name: 'יצירת מטלה' }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(createTask).toHaveBeenCalledWith({
      title: 'לעבור על התקציב',
      notes: 'כולל סעיפים חריגים',
      status: 'in_progress',
      priority: 'urgent',
      category: 'finance',
      due_date: '2026-08-25',
      transaction_id: 101,
      loan_id: 201,
    });
    expect(getTasks).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog', { name: 'מטלה חדשה' })).not.toBeInTheDocument();
  });

  it('loads existing values and preserves the update payload', async () => {
    renderPage();
    const edit = await screen.findByRole('button', { name: 'עריכת המטלה בדיקת חיוב כפול' });
    await userEvent.click(edit);
    const dialog = screen.getByRole('dialog', { name: 'עריכת מטלה' });

    expect(within(dialog).getByLabelText(/כותרת/)).toHaveValue('בדיקת חיוב כפול');
    expect(within(dialog).getByLabelText('הערות')).toHaveValue('להתקשר לחברת האשראי עם מספר הפנייה');
    expect(within(dialog).getByLabelText('סטטוס')).toHaveValue('open');
    expect(within(dialog).getByLabelText('עדיפות')).toHaveValue('high');
    expect(within(dialog).getByLabelText('קטגוריית מטלה')).toHaveValue('finance');
    expect(within(dialog).getByLabelText('תאריך יעד')).toHaveValue('2026-08-08');
    await waitFor(() => expect(within(dialog).getByLabelText('תנועה מקושרת')).not.toBeDisabled());
    await userEvent.clear(within(dialog).getByLabelText(/כותרת/));
    await userEvent.type(within(dialog).getByLabelText(/כותרת/), 'בדיקת חיוב מעודכנת');
    await userEvent.click(within(dialog).getByRole('button', { name: 'שמירת שינויים' }));

    await waitFor(() => expect(updateTask).toHaveBeenCalledTimes(1));
    expect(updateTask).toHaveBeenCalledWith(1, expect.objectContaining({
      title: 'בדיקת חיוב מעודכנת',
      notes: 'להתקשר לחברת האשראי עם מספר הפנייה',
      status: 'open',
      priority: 'high',
      category: 'finance',
      due_date: '2026-08-08',
      transaction_id: 101,
      loan_id: 201,
    }));
  });

  it('prevents duplicate create and retains entered values after failure', async () => {
    const request = deferred();
    createTask.mockReturnValue(request.promise);
    renderPage();
    await screen.findByText('בדיקת חיוב כפול');
    await userEvent.click(screen.getByRole('button', { name: 'מטלה חדשה' }));
    const dialog = screen.getByRole('dialog', { name: 'מטלה חדשה' });
    const title = within(dialog).getByLabelText(/כותרת/);
    await userEvent.type(title, 'מטלה שנשמרת');
    const submit = within(dialog).getByRole('button', { name: 'יצירת מטלה' });
    await userEvent.click(submit);
    expect(submit).toBeDisabled();
    await userEvent.click(submit);
    expect(createTask).toHaveBeenCalledTimes(1);

    request.reject(new Error('failed'));
    expect(await within(dialog).findByText('שמירת המטלה נכשלה. הפרטים נשמרו בטופס וניתן לנסות שוב.')).toBeInTheDocument();
    expect(title).toHaveValue('מטלה שנשמרת');
    expect(screen.getByRole('dialog', { name: 'מטלה חדשה' })).toBeInTheDocument();
  });
});

describe('Tasks status and deletion mutations', () => {
  it('marks an open task done and reopens a completed task with the existing update contract', async () => {
    renderPage();
    const openCard = await screen.findByRole('article', { name: 'בדיקת חיוב כפול' });
    await userEvent.click(within(openCard).getByRole('button', { name: 'סימון כהושלמה' }));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(1, { status: 'done' }));

    await userEvent.click(screen.getByRole('tab', { name: /הושלמו\s*1/ }));
    const doneCard = screen.getByRole('article', { name: 'מטלה שהושלמה' });
    await userEvent.click(within(doneCard).getByRole('button', { name: 'פתיחה מחדש' }));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(4, { status: 'open' }));
  });

  it('uses accessible confirmation, cancels safely, and retains the task after delete failure', async () => {
    renderPage();
    const deleteButton = await screen.findByRole('button', { name: 'מחיקת המטלה בדיקת חיוב כפול' });
    await userEvent.click(deleteButton);
    let dialog = screen.getByRole('dialog', { name: 'מחיקת מטלה' });
    expect(within(dialog).getByRole('button', { name: 'ביטול' })).toHaveFocus();
    await userEvent.click(within(dialog).getByRole('button', { name: 'ביטול' }));
    expect(deleteTask).not.toHaveBeenCalled();

    deleteTask.mockRejectedValueOnce(new Error('failed'));
    await userEvent.click(deleteButton);
    dialog = screen.getByRole('dialog', { name: 'מחיקת מטלה' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'מחיקת המטלה' }));
    expect(await within(dialog).findByText('מחיקת המטלה נכשלה. המטלה נשארה ברשימה.')).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'בדיקת חיוב כפול' })).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'מחיקת המטלה' }));
    await waitFor(() => expect(deleteTask).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'מחיקת מטלה' })).not.toBeInTheDocument());
    expect(getTasks).toHaveBeenCalledTimes(2);
  });
});
