import { useEffect } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import Layout from './Layout';
import { usePageHeaderContext } from '../context/PageHeaderContext';
import {
  mobileMoreItems,
  mobilePrimaryItems,
  standardNavigationItems,
} from './shell/navigation';

const layoutStyles = readFileSync('src/components/Layout.css', 'utf8');

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  toggleTheme: vi.fn(),
}));

vi.mock('../context/auth-context', () => ({
  useAuth: () => ({
    user: { email: 'finance.user.with.a.long.address@example.com' },
    signOut: mocks.signOut,
  }),
}));

vi.mock('../context/theme-context', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: mocks.toggleTheme }),
}));

const PlainPage = () => <div>תוכן העמוד</div>;

const HeaderOverridePage = () => {
  const { setPageHeader } = usePageHeaderContext();

  useEffect(() => {
    setPageHeader({
      title: 'כותרת עמוד ישנה',
      subtitle: 'כותרת משנה מותאמת',
      primaryAction: <button type="button">פעולה מותאמת</button>,
    });
  }, [setPageHeader]);

  return <Link to="/loans">מעבר להלוואות</Link>;
};

const renderShell = (path = '/') => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route element={<Layout />}>
        <Route path="*" element={<PlainPage />} />
      </Route>
    </Routes>
  </MemoryRouter>,
);

afterEach(() => {
  mocks.signOut.mockReset();
  mocks.toggleTheme.mockReset();
  document.body.style.overflow = '';
});

describe('responsive navigation surfaces', () => {
  it('renders every standard destination in the desktop navigation', () => {
    renderShell('/');
    const nav = screen.getByRole('navigation', { name: 'ניווט ראשי' });
    standardNavigationItems.forEach((item) => {
      expect(within(nav).getByRole('link', { name: item.label })).toHaveAttribute('href', item.path);
    });
    expect(within(screen.getByLabelText('סרגל היישום')).queryByRole('link', { name: 'תנועה חדשה' }))
      .not.toBeInTheDocument();
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'תנועה חדשה' }))
      .toHaveAttribute('href', '/add');
  });

  it('renders every standard destination and add action in the tablet rail', () => {
    renderShell('/');
    const nav = screen.getByRole('navigation', { name: 'ניווט לטאבלט' });
    standardNavigationItems.forEach((item) => {
      expect(within(nav).getByRole('link', { name: item.label })).toHaveAttribute('href', item.path);
    });
    expect(within(screen.getByLabelText('סרגל ניווט מצומצם')).getByRole('link', { name: 'תנועה חדשה' }))
      .toHaveAttribute('href', '/add');
  });

  it('renders four primary mobile links and a fifth More slot', () => {
    renderShell('/');
    const nav = screen.getByRole('navigation', { name: 'ניווט נייד' });
    mobilePrimaryItems.forEach((item) => {
      expect(within(nav).getByRole('link', { name: item.shortLabel || item.label }))
        .toHaveAttribute('href', item.path);
    });
    expect(within(nav).getByRole('button', { name: 'עוד' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('marks active links with aria-current and maps edit routes to Transactions', () => {
    renderShell('/edit-transaction/91');
    const desktop = screen.getByRole('navigation', { name: 'ניווט ראשי' });
    const tablet = screen.getByRole('navigation', { name: 'ניווט לטאבלט' });
    const mobile = screen.getByRole('navigation', { name: 'ניווט נייד' });
    expect(within(desktop).getByRole('link', { name: 'תנועות' })).toHaveAttribute('aria-current', 'page');
    expect(within(tablet).getByRole('link', { name: 'תנועות' })).toHaveAttribute('aria-current', 'page');
    expect(within(mobile).getByRole('link', { name: 'תנועות' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'תנועה חדשה' })).not.toBeInTheDocument();
  });

  it('shows the header add action on Transactions and hides it on add and edit routes', () => {
    const { unmount } = renderShell('/transactions');
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'תנועה חדשה' }))
      .toHaveAttribute('href', '/add');

    unmount();
    const addRoute = renderShell('/add');
    expect(screen.queryByRole('link', { name: 'תנועה חדשה' })).not.toBeInTheDocument();

    addRoute.unmount();
    renderShell('/edit-transaction/91');
    expect(screen.queryByRole('link', { name: 'תנועה חדשה' })).not.toBeInTheDocument();
  });
});

describe('mobile More sheet', () => {
  it('restores the portal layer display inside the mobile breakpoint', () => {
    expect(layoutStyles).toMatch(
      /@media\s*\(max-width:\s*833\.98px\)\s*\{[\s\S]*?\.shell-sheet-layer\s*\{[^}]*display:\s*flex;/,
    );
  });

  it('opens with focus inside and contains every remaining destination', async () => {
    const user = userEvent.setup();
    renderShell('/');
    const trigger = screen.getByRole('button', { name: 'עוד' });

    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'עוד בפיננסים.' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'סגירה' })).toHaveFocus();
    const nav = within(dialog).getByRole('navigation', { name: 'ניווט נוסף' });
    mobileMoreItems.forEach((item) => {
      expect(within(nav).getByRole('link', { name: item.label })).toHaveAttribute('href', item.path);
    });
    expect(document.body).toHaveStyle({ overflow: 'hidden' });
  });

  it('dismisses on Escape, restores scrolling, and returns focus', async () => {
    const user = userEvent.setup();
    renderShell('/');
    const trigger = screen.getByRole('button', { name: 'עוד' });
    await user.click(trigger);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('dismisses through the accessible backdrop', async () => {
    const user = userEvent.setup();
    renderShell('/');
    const trigger = screen.getByRole('button', { name: 'עוד' });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'סגירת תפריט נוסף' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('preserves the existing mobile-session logout callback inside the pilot sheet', async () => {
    const user = userEvent.setup();
    renderShell('/');
    await user.click(screen.getByRole('button', { name: 'עוד' }));
    const dialog = screen.getByRole('dialog', { name: 'עוד בפיננסים.' });
    await user.click(within(dialog).getByRole('button', { name: 'התנתקות' }));
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
});

describe('page header and shell controls', () => {
  it('uses route defaults for regular and dynamic routes', () => {
    const { unmount } = renderShell('/budget');
    expect(screen.getByRole('heading', { level: 1, name: 'תקציב חודשי' })).toBeInTheDocument();
    unmount();
    renderShell('/edit-transaction/12');
    expect(screen.getByRole('heading', { level: 1, name: 'עריכת תנועה' })).toBeInTheDocument();
  });

  it('renders the approved Dashboard title and subtitle', () => {
    renderShell('/');
    expect(screen.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeInTheDocument();
    expect(screen.getByText('תמונת מצב לפי תקופות — חודש נבחר, מגמה של חצי שנה ונתונים נכון להיום'))
      .toBeInTheDocument();
  });

  it('applies an override and clears it when navigation remounts the route contract', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/budget']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/budget" element={<HeaderOverridePage />} />
            <Route path="/loans" element={<PlainPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('כותרת משנה מותאמת')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'תקציב חודשי' })).toBeInTheDocument();
    expect(screen.queryByText('כותרת עמוד ישנה')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'פעולה מותאמת' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'מעבר להלוואות' }));
    expect(screen.getByRole('heading', { level: 1, name: 'הלוואות' })).toBeInTheDocument();
    expect(screen.queryByText('כותרת משנה מותאמת')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'פעולה מותאמת' })).not.toBeInTheDocument();
  });

  it('preserves theme and logout controls', async () => {
    const user = userEvent.setup();
    renderShell('/');
    await user.click(screen.getByRole('button', { name: 'מעבר לערכת נושא בהירה' }));
    expect(mocks.toggleTheme).toHaveBeenCalledOnce();

    const desktopSidebar = screen.getByLabelText('סרגל היישום');
    await user.click(within(desktopSidebar).getByRole('button', { name: 'התנתקות' }));
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it('provides a skip link and one named main content landmark', () => {
    renderShell('/');
    expect(screen.getByRole('link', { name: 'דילוג לתוכן הראשי' })).toHaveAttribute('href', '#main-content');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
  });

  it('uses approved branding and omits unsupported or review-only controls', () => {
    renderShell('/');
    expect(screen.getAllByText('פיננסים.').length).toBeGreaterThan(0);
    expect(screen.getByText('ניהול כספים אישי')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'פיננסים. — לוח בקרה' }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/MyFinance|כספומטר|Finance & Lego Tracker/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('חיפוש')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'התראות' })).not.toBeInTheDocument();
    expect(screen.queryByText('יוני 2026')).not.toBeInTheDocument();
    ['יסודות', 'רכיבים', 'רספונסיביות', 'מסירה ליישום', 'Review dock']
      .forEach((label) => expect(screen.queryByText(label)).not.toBeInTheDocument());
  });
});
