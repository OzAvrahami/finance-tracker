import { isCalendarDate } from './calendarDate';
import { getMonthRange } from './dateRange';
import { cashFlowLabels } from './savingsReporting';

export const DEFAULT_TRANSACTION_SORT = { key: 'transaction_date', direction: 'desc' };
const keys = ['month', 'from', 'to', 'categoryId', 'uncategorized', 'paymentSourceId', 'search', 'sortBy', 'sortDirection', 'savingsAccountId', 'savingsFlow'];
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
  if (strict && [...params.keys()].some(key => !keys.includes(key))) return null;
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

export function transactionCriteriaParams(criteria) {
  return new URLSearchParams({
    from: criteria.dateRange.start, to: criteria.dateRange.end,
    categoryId: criteria.selectedCategory, paymentSourceId: criteria.selectedPaymentSource,
    uncategorized: criteria.showUncategorizedOnly ? '1' : '0', search: criteria.searchText,
    sortBy: criteria.sortConfig.key, sortDirection: criteria.sortConfig.direction,
    savingsAccountId: criteria.selectedSavingsAccount, savingsFlow: criteria.savingsFlow,
  });
}

export const transactionsDestination = criteria => `/transactions?${transactionCriteriaParams(criteria)}`;

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
  return criteria ? transactionsDestination(criteria) : '/transactions';
}
