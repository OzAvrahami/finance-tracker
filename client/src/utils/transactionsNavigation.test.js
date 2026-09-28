import { describe, expect, it } from 'vitest';
import { budgetDestination, budgetReviewDestination, isBudgetMonth, readBudgetOrigin,
  readBudgetTarget, readTransactionCriteria, transactionCriteriaParams, transactionReturnDestination } from './transactionsNavigation';

const context = 'origin=budget&budgetMonth=2026-08&budgetSection=unbudgeted&budgetCategory=7';
const filters = 'from=&to=2026-08-31&categoryId=2&paymentSourceId=10&savingsAccountId=9007199254740993&savingsFlow=deposit&search=abc&sortBy=description&sortDirection=asc';
const editorReturn = query => transactionReturnDestination(new URLSearchParams({ returnTo: `/transactions?${query}` }));

describe('explicit Budget context extends the strict #51 contract', () => {
  it.each(['2026-00', '2026-13', '0000-01', '2026-1', '2026-01-01', '', null])('rejects malformed calendar month %s', month => {
    expect(isBudgetMonth(month)).toBe(false);
  });
  it.each([
    context.replace('origin=budget', 'origin=https://evil.test'),
    context.replace('2026-08', '2026-13'),
    context.replace('unbudgeted', 'funding'),
    context.replace('budgetCategory=7', 'budgetCategory=-7'),
    context.replace('budgetCategory=7', 'budgetCategory=all'),
    context.replace('budgetCategory=7', 'budgetCategory=9007199254740993'),
    context + '&budgetCategory=8', context + '&origin=budget', context + '&budgetMonth=2026-07',
    context + '&budgetSection=unbudgeted', context.replace('&budgetSection=unbudgeted', ''),
  ])('drops only invalid origin and preserves valid ordinary/Savings filters: %s', bad => {
    expect(readBudgetOrigin(new URLSearchParams(bad))).toBeNull();
    const result = new URL(editorReturn(`${filters}&${bad}`), 'https://local.invalid');
    expect(result.pathname).toBe('/transactions');
    expect(result.searchParams.has('origin')).toBe(false);
    expect(readTransactionCriteria(result.searchParams)).toEqual(readTransactionCriteria(new URLSearchParams(filters)));
  });
  it('retains independent origin through serialization, modified filters and nested editor return', () => {
    const params = new URLSearchParams(`${filters}&${context}`);
    const criteria = readTransactionCriteria(params), origin = readBudgetOrigin(params);
    criteria.dateRange = { start: '2026-07-01', end: '' };
    const serialized = transactionCriteriaParams(criteria, origin);
    const returned = new URL(editorReturn(serialized), 'https://local.invalid');
    expect(readTransactionCriteria(returned.searchParams)).toEqual(criteria);
    expect(readBudgetOrigin(returned.searchParams)).toEqual({ month: '2026-08', section: 'unbudgeted', category: '7' });
    expect(budgetDestination(origin)).toBe('/budget?month=2026-08&section=unbudgeted&category=7');
  });
  it.each([null, 7])('creates categorized/uncategorized links without confusing filters and origin: %s', id => {
    const url = new URL(budgetReviewDestination('2026-08', id), 'https://local.invalid');
    expect(readBudgetOrigin(url.searchParams)?.category).toBe(id === null ? 'uncategorized' : '7');
    expect(readTransactionCriteria(url.searchParams)).toMatchObject({ selectedCategory: id === null ? 'all' : '7', showUncategorizedOnly: id === null });
  });
  it.each(['/budget', '//evil.test/transactions', '/transactions/../budget', '/transactions?month=2026-08#bad', '/transactions?evil=1'])(
  'does not expand trusted editor destination: %s', returnTo => {
    expect(transactionReturnDestination(new URLSearchParams({ returnTo }))).toBe('/transactions');
  });
  it('rejects repeated returnTo and repeated ordinary criteria', () => {
    expect(transactionReturnDestination(new URLSearchParams('returnTo=/transactions&returnTo=/budget'))).toBe('/transactions');
    expect(editorReturn(`${filters}&categoryId=3&${context}`)).toBe('/transactions');
  });
  it('ordinary month/category alone never imply origin; Budget targets validate independently', () => {
    expect(readBudgetOrigin(new URLSearchParams('month=2026-08&categoryId=7'))).toBeNull();
    expect(readBudgetTarget(new URLSearchParams('month=2026-08&section=unbudgeted&category=uncategorized'))?.category).toBe('uncategorized');
    expect(readBudgetTarget(new URLSearchParams('month=2026-08&month=2026-07&section=unbudgeted&category=7'))).toBeNull();
    expect(readBudgetTarget(new URLSearchParams('month=2026-08&section=arbitrary&category=7'))).toBeNull();
  });
});
