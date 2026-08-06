import {
  BarChart2,
  CheckSquare,
  CreditCard,
  DollarSign,
  Home,
  Package,
  PieChart,
  Plus,
  Settings,
  ShoppingCart,
  Upload,
} from 'lucide-react';

export const navigationItems = [
  { path: '/', label: 'לוח בקרה', icon: Home, mobilePriority: 1 },
  { path: '/add', label: 'תנועה חדשה', shortLabel: 'הוספה', icon: Plus, kind: 'action' },
  {
    path: '/transactions',
    label: 'תנועות',
    icon: CreditCard,
    mobilePriority: 2,
    relatedPrefixes: ['/edit-transaction/'],
  },
  { path: '/budget', label: 'תקציב חודשי', shortLabel: 'תקציב', icon: PieChart, mobilePriority: 3 },
  { path: '/annual-summary', label: 'סיכום שנתי', icon: BarChart2 },
  { path: '/loans', label: 'הלוואות', icon: DollarSign },
  { path: '/shopping', label: 'רשימות קניות', shortLabel: 'קניות', icon: ShoppingCart },
  { path: '/tasks', label: 'מטלות', icon: CheckSquare, mobilePriority: 4 },
  { path: '/import', label: 'ייבוא תנועות', shortLabel: 'ייבוא', icon: Upload },
  { path: '/lego', label: 'אוסף לגו', shortLabel: 'לגו', icon: Package },
  { path: '/settings', label: 'הגדרות', icon: Settings },
];

export const addTransactionItem = navigationItems.find((item) => item.kind === 'action');
export const standardNavigationItems = navigationItems.filter((item) => item.kind !== 'action');
export const mobilePrimaryItems = standardNavigationItems
  .filter((item) => item.mobilePriority)
  .sort((a, b) => a.mobilePriority - b.mobilePriority);
export const mobileMoreItems = standardNavigationItems.filter((item) => !item.mobilePriority);

export const routeMetadata = [
  {
    key: 'dashboard',
    path: '/',
    title: 'לוח בקרה',
    subtitle: 'תמונת מצב לפי תקופות — חודש נבחר, מגמה של חצי שנה ונתונים נכון להיום',
  },
  { key: 'add-transaction', path: '/add', title: 'הוספת תנועה', hideGlobalAdd: true },
  { key: 'transactions', path: '/transactions', title: 'תנועות', hideGlobalAdd: true },
  { key: 'edit-transaction', prefix: '/edit-transaction/', title: 'עריכת תנועה', hideGlobalAdd: true },
  { key: 'budget', path: '/budget', title: 'תקציב חודשי' },
  { key: 'annual-summary', path: '/annual-summary', title: 'סיכום שנתי' },
  { key: 'loans', path: '/loans', title: 'הלוואות' },
  { key: 'shopping', path: '/shopping', title: 'רשימות קניות' },
  { key: 'tasks', path: '/tasks', title: 'מטלות' },
  { key: 'import', path: '/import', title: 'ייבוא תנועות' },
  { key: 'lego', path: '/lego', title: 'אוסף לגו' },
  { key: 'settings', path: '/settings', title: 'הגדרות' },
];

const normalizePath = (pathname) => {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '');
};

export const isNavigationItemActive = (item, pathname) => {
  const currentPath = normalizePath(pathname);
  if (normalizePath(item.path) === currentPath) return true;
  return item.relatedPrefixes?.some((prefix) => pathname.startsWith(prefix)) ?? false;
};

export const resolveRouteMetadata = (pathname) => {
  const currentPath = normalizePath(pathname);
  return routeMetadata.find((route) => (
    route.path ? route.path === currentPath : pathname.startsWith(route.prefix)
  )) ?? { key: 'unknown', title: 'פיננסים.' };
};
