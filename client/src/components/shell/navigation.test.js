import { describe, expect, it } from 'vitest';
import {
  addTransactionItem,
  isNavigationItemActive,
  mobileMoreItems,
  mobilePrimaryItems,
  navigationItems,
  resolveRouteMetadata,
  routeMetadata,
  standardNavigationItems,
} from './navigation';

describe('Finance Tracker route metadata', () => {
  it.each([
    ['/', 'לוח בקרה'],
    ['/add', 'הוספת תנועה'],
    ['/transactions', 'תנועות'],
    ['/edit-transaction/42', 'עריכת תנועה'],
    ['/budget', 'תקציב חודשי'],
    ['/annual-summary', 'סיכום שנתי'],
    ['/loans', 'הלוואות'],
    ['/shopping', 'רשימות קניות'],
    ['/tasks', 'מטלות'],
    ['/import', 'ייבוא תנועות'],
    ['/lego', 'אוסף לגו'],
    ['/settings', 'הגדרות'],
  ])('resolves %s to its production title', (pathname, title) => {
    expect(resolveRouteMetadata(pathname).title).toBe(title);
  });

  it('provides a non-blank safe fallback without creating a route', () => {
    expect(resolveRouteMetadata('/not-a-route')).toEqual({ key: 'unknown', title: 'פיננסים.' });
  });
});

describe('shared navigation configuration', () => {
  it('contains ten destinations and the existing add-transaction action', () => {
    expect(navigationItems).toHaveLength(11);
    expect(standardNavigationItems).toHaveLength(10);
    expect(addTransactionItem).toMatchObject({ path: '/add', label: 'תנועה חדשה', kind: 'action' });
  });

  it('partitions mobile destinations into four primary and six More links', () => {
    expect(mobilePrimaryItems.map((item) => item.path)).toEqual([
      '/', '/transactions', '/budget', '/tasks',
    ]);
    expect(mobileMoreItems).toHaveLength(6);
    expect([...mobilePrimaryItems, ...mobileMoreItems]).toHaveLength(10);
  });

  it('activates Transactions for dynamic edit routes', () => {
    const transactions = navigationItems.find((item) => item.path === '/transactions');
    expect(isNavigationItemActive(transactions, '/edit-transaction/123')).toBe(true);
    expect(isNavigationItemActive(transactions, '/budget')).toBe(false);
  });

  it('keeps Dashboard exact and tolerates trailing slashes on canonical routes', () => {
    const dashboard = navigationItems.find((item) => item.path === '/');
    const budget = navigationItems.find((item) => item.path === '/budget');
    expect(isNavigationItemActive(dashboard, '/transactions')).toBe(false);
    expect(isNavigationItemActive(budget, '/budget/')).toBe(true);
  });

  it('contains no design-review destinations', () => {
    const productionText = [...navigationItems, ...routeMetadata]
      .map((item) => `${item.path || item.prefix} ${item.label || item.title}`)
      .join(' ');
    ['יסודות', 'רכיבים', 'רספונסיביות', 'מסירה ליישום', 'Review dock']
      .forEach((label) => expect(productionText).not.toContain(label));
  });

  it('uses the approved Dashboard subtitle verbatim', () => {
    expect(resolveRouteMetadata('/').subtitle).toBe(
      'תמונת מצב לפי תקופות — חודש נבחר, מגמה של חצי שנה ונתונים נכון להיום',
    );
  });
});
