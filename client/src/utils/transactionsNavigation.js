import { isCalendarDate } from './calendarDate';
import { getMonthRange } from './dateRange';
import { cashFlowLabels } from './savingsReporting';

export const DEFAULT_TRANSACTION_SORT = { key: 'transaction_date', direction: 'desc' };
const keys = ['month', 'from', 'to', 'categoryId', 'uncategorized', 'paymentSourceId', 'search', 'sortBy', 'sortDirection', 'savingsAccountId', 'savingsFlow'];
const originKeys = ['origin', 'budgetMonth', 'budgetSection', 'budgetCategory'];
export const isBudgetMonth = value => typeof value === 'string' && isCalendarDate(`${value}-01`);

// Origin is independent of editable list criteria. Invalid origin is discarded as
// a unit, never used as an arbitrary return URL and never invalidates list filters.
export function readBudgetOrigin(params) {
  if (originKeys.some(key => params.getAll(key).length !== 1)) return null;
  const category = params.get('budgetCategory');
  if (params.get('origin') !== 'budget' || !isBudgetMonth(params.get('budgetMonth'))
    || params.get('budgetSection') !== 'unbudgeted'
    || !(category === 'uncategorized' || (/^[1-9]\d*$/.test(category) && Number.isSafeInteger(Number(category))))) return null;
  return { month: params.get('budgetMonth'), section: 'unbudgeted', category };
}

export function budgetOriginParams(origin) {
  return new URLSearchParams({ origin: 'budget', budgetMonth: origin.month,
    budgetSection: origin.section, budgetCategory: origin.category });
}

export const budgetDestination = origin => `/budget?${new URLSearchParams({
  month: origin.month, section: origin.section, category: origin.category,
})}`;

export function budgetReviewDestination(month, categoryId) {
  const params = budgetOriginParams({ month, section: 'unbudgeted', category: String(categoryId ?? 'uncategorized') });
  params.set('month', month);
  params.set(categoryId == null ? 'uncategorized' : 'categoryId', categoryId == null ? '1' : String(categoryId));
  return `/transactions?${params}`;
}

export function readBudgetTarget(params) {
  if (['month', 'section', 'category'].some(key => params.getAll(key).length !== 1)) return null;
  return readBudgetOrigin(new URLSearchParams({ origin: 'budget', budgetMonth: params.get('month'),
    budgetSection: params.get('section'), budgetCategory: params.get('category') }));
}
const validId = value => value === 'all' || (/^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)));
// Savings IDs are PostgreSQL bigint strings, not UUIDs. Keep them exact even
// beyond Number.MAX_SAFE_INTEGER and reject values outside the database range.
const validAccount = value => value === 'all'
  || (/^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n);

export const defaultTransactionCriteria = () => ({
  dateRange: getMonthRange(), selectedCategory: 'all', selectedPaymentSource: 'all',
  selectedSavingsAccount: 'all', savingsFlow: 'all', searchText: '',
  showUncategorizedOnly: false, sortConfig: DEFAULT_TRANSACTION_SORT,
});

export function readTransactionCriteria(params, { strict = false } = {}) {
  const defaults = defaultTransactionCriteria();
  if (keys.some(key => params.getAll(key).length > 1)) return null;
  if (strict && [...params.keys()].some(key => !keys.includes(key) && !originKeys.includes(key))) return null;
  const month = params.get('month');
  if (month !== null && !isCalendarDate(`${month}-01`)) return null;
  let dateRange = month ? getMonthRange(new Date(`${month}-01T12:00:00`)) : defaults.dateRange;
  // Presence, not truthiness: empty bounds explicitly mean unbounded history.
  if (params.has('from') || params.has('to')) {
    dateRange = { start: params.get('from') || '', end: params.get('to') || '' };
    if ([dateRange.start, dateRange.end].some(value => value && !isCalendarDate(value))) return null;
    if (strict && dateRange.start && dateRange.end && dateRange.start > dateRange.end) return null;
  }
  const selectedCategory = params.get('categoryId') || 'all';
  const selectedPaymentSource = params.get('paymentSourceId') || 'all';
  const selectedSavingsAccount = params.get('savingsAccountId') || 'all';
  const savingsFlow = params.get('savingsFlow') || 'all';
  const sortConfig = { key: params.get('sortBy') || defaults.sortConfig.key, direction: params.get('sortDirection') || defaults.sortConfig.direction };
  if (!validId(selectedCategory) || !validId(selectedPaymentSource) || !validAccount(selectedSavingsAccount)) return null;
  if (savingsFlow !== 'all' && !Object.hasOwn(cashFlowLabels, savingsFlow)) return null;
  if (!['transaction_date', 'description', 'total_amount'].includes(sortConfig.key) || !['asc', 'desc'].includes(sortConfig.direction)) return null;
  if (params.has('uncategorized') && !['0', '1'].includes(params.get('uncategorized'))) return null;
  if (strict && (params.get('search') || '').trim().length > 200) return null;
  return {
    dateRange, selectedCategory, selectedPaymentSource, selectedSavingsAccount, savingsFlow, sortConfig,
    searchText: params.get('search') || '', showUncategorizedOnly: params.get('uncategorized') === '1',
  };
}

export function transactionCriteriaParams(criteria, origin = null) {
  const params = new URLSearchParams({
    from: criteria.dateRange.start, to: criteria.dateRange.end,
    categoryId: criteria.selectedCategory, paymentSourceId: criteria.selectedPaymentSource,
    uncategorized: criteria.showUncategorizedOnly ? '1' : '0', search: criteria.searchText,
    sortBy: criteria.sortConfig.key, sortDirection: criteria.sortConfig.direction,
    savingsAccountId: criteria.selectedSavingsAccount, savingsFlow: criteria.savingsFlow,
  });
  if (origin) budgetOriginParams(origin).forEach((value, key) => params.set(key, value));
  return params;
}

export const transactionsDestination = (criteria, origin = null) => `/transactions?${transactionCriteriaParams(criteria, origin)}`;

// Only this route and its validated criteria are trusted. No history traversal,
// persistent preferences, arbitrary destination, cursors or cached rows.
export function transactionReturnDestination(params) {
  if (params.getAll('returnTo').length !== 1) return '/transactions';
  const raw = params.get('returnTo');
  if (raw !== '/transactions' && !raw.startsWith('/transactions?')) return '/transactions';
  const url = new URL(raw, 'https://local.invalid');
  if (url.pathname !== '/transactions' || url.hash) return '/transactions';
  if (!url.search) return '/transactions';
  const criteria = readTransactionCriteria(url.searchParams, { strict: true });
  return criteria ? transactionsDestination(criteria, readBudgetOrigin(url.searchParams)) : '/transactions';
}
