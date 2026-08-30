import axios from 'axios';
import { supabase } from '../config/supabase';

// Site URL
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5050/api';

const api = axios.create({
  baseURL: API_URL,
});

// Attach Supabase auth token to every request
api.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession();

  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`;
  }

  return config;
});

// On 401 response, sign out and redirect to login
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await supabase.auth.signOut();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Categories
export const createCategory = (data) => api.post('/categories', data);

// Import file
export const uploadImportFile = (formData) => api.post('/import/preview', formData, { headers: { 'Content-Type': 'multipart/form-data' }});
export const saveImportedTransactions = (transactions, paymentSourceId) => api.post('/import/save', { transactions, payment_source_id: paymentSourceId });

// Transaction
export const createTransaction = (data) => api.post('/transactions', data);

/**
 * Fetches one filtered, keyset-paginated page of transactions.
 *
 * All filtering happens on the server. Passing no filters returns the newest
 * page of the full history, not the whole table.
 *
 * @param {object} params
 * @param {string} [params.from]              Inclusive start date, 'YYYY-MM-DD'.
 * @param {string} [params.to]                Inclusive end date, 'YYYY-MM-DD'.
 * @param {string|number} [params.categoryId] Category id, or 'all'/'' for no filter.
 * @param {string|number} [params.paymentSourceId] Payment source id, or 'all'/'' for no filter.
 * @param {boolean} [params.uncategorizedOnly]
 * @param {string} [params.search]
 * @param {number} [params.limit]
 * @param {'transaction_date'|'description'|'total_amount'} [params.sortBy]
 * @param {'asc'|'desc'} [params.sortDirection]
 * @param {string|null} [params.cursor]       Opaque cursor from a previous response.
 * @param {boolean} [params.includeTotals]    Ask for totals over the whole filtered set.
 * @returns {Promise} axios response; `res.data` is
 *   { data, pagination: { limit, hasMore, sortBy, sortDirection, nextCursor }, totals? }
 */
export const getTransactions = ({
  from,
  to,
  categoryId,
  paymentSourceId,
  uncategorizedOnly,
  search,
  limit,
  sortBy,
  sortDirection,
  cursor,
  includeTotals,
} = {}) => {
  const query = new URLSearchParams();

  // Date strings are passed through verbatim. They must stay 'YYYY-MM-DD' —
  // running them through Date.toISOString() would shift them by the UTC offset
  // and silently move a transaction into the neighbouring day.
  if (from) query.set('from', from);
  if (to) query.set('to', to);

  // 'all' is the UI's "no filter" sentinel; omit it rather than sending it.
  if (categoryId && categoryId !== 'all') query.set('categoryId', String(categoryId));
  if (paymentSourceId && paymentSourceId !== 'all') query.set('paymentSourceId', String(paymentSourceId));

  if (uncategorizedOnly) query.set('uncategorizedOnly', 'true');
  if (search && search.trim()) query.set('search', search.trim());
  if (limit) query.set('limit', String(limit));

  // Sorting is applied by the database across the whole filtered set. The
  // defaults are the server's, so they are omitted rather than restated.
  if (sortBy && sortBy !== 'transaction_date') query.set('sortBy', sortBy);
  if (sortDirection && sortDirection !== 'desc') query.set('sortDirection', sortDirection);

  // The cursor is opaque: it is echoed back exactly as the server issued it.
  // Do not parse it, rebuild it, or carry its parts in separate params — its
  // contents (including a NUMERIC amount as a decimal string) are owned by
  // server/utils/transactionQuery.js.
  if (cursor) query.set('cursor', cursor);

  if (includeTotals) query.set('includeTotals', 'true');

  const qs = query.toString();
  return api.get(qs ? `/transactions?${qs}` : '/transactions');
};
export const getTags = () => api.get('/transactions/tags');
export const getCategories = () => api.get('/transactions/categories');
export const getPaymentSources = () => api.get('/transactions/payment-sources');
export const getTransactionById = (id) => api.get(`transactions/${id}`);
export const updateTransaction = (id, data) => api.put(`transactions/${id}`, data);
export const deleteTransaction = (id) => api.delete(`/transactions/${id}`);

// Dashboard aggregates — totals are computed in PostgreSQL and returned as a
// small bounded payload. The Dashboard must not sum transaction rows itself.
export const getDashboardSummary = (from, to) =>
  api.get('/dashboard/summary', { params: { from, to } });
export const getDashboardMonthlySeries = (months = 6) =>
  api.get('/dashboard/monthly-series', { params: { months } });

// Loan
export const getAllLoans = () => api.get('/loans');
export const getLoanDetails = (id) => api.get(`/loans/${id}/details`);
export const createLoan = (data) => api.post('/loans', data);

// Lego set collection
export const getLegoSets = () => api.get('/lego');
export const addLegoSet = (setData) => api.post('/lego', setData);
export const updateLegoSet = (id, setData) => api.put(`/lego/${id}`, setData);
export const deleteLegoSet = (id) => api.delete(`/lego/${id}`);
export const getLegoThemes = () => api.get('/lego/themes');
export const getLegoSetDetails = (setNum) => api.get(`/transactions/lego/details/${setNum}`);

// Budget
export const getBudgetsByMonth = (month) => api.get(`/budgets?month=${month}`);
export const getFundedBudgetMonth = (month) => api.get('/budgets/funded', { params: { month } });
export const addManualBudgetFunding = (data) => api.post('/budgets/funded/funding', data);
export const initializeRecurringBudgets = (data) => api.post('/budgets/funded/recurring/initialize', data);
export const establishFundedBudget = (data) => api.post('/budgets/funded/categories', data);
export const adjustFundedBudget = (id, data) => api.patch(`/budgets/funded/categories/${id}`, data);
export const removeFundedBudget = (id, data) => api.post(`/budgets/funded/categories/${id}/remove`, data);
export const reactivateFundedBudget = (id, data) => api.post(`/budgets/funded/categories/${id}/reactivate`, data);
export const reverseFundedBudgetOperation = (id, data) => api.post(`/budgets/funded/operations/${id}/reverse`, data);
export const upsertBudget = (data) => api.post('/budgets', data);
export const copyBudget = (data) => api.post('/budgets/copy', data);
export const deleteBudget = (id) => api.delete(`/budgets/${id}`);

// Shopping Lists
export const getShoppingListTypes = () => api.get('/shopping/list-types');
export const getShoppingCatalogCategories = (listTypeId) => api.get('/shopping/catalog-categories', { params: listTypeId ? { list_type_id: listTypeId } : {} });
export const createShoppingCatalogCategory = (data) => api.post('/shopping/catalog-categories', data);
export const getShoppingCatalogItems = (params) => api.get('/shopping/catalog-items', { params });
export const getShoppingLists = (status) => api.get('/shopping/lists', { params: status ? { status } : {} });
export const getShoppingListById = (id) => api.get(`/shopping/lists/${id}`);
export const createShoppingList = (data) => api.post('/shopping/lists', data);
export const updateShoppingList = (id, data) => api.put(`/shopping/lists/${id}`, data);
export const deleteShoppingList = (id) => api.delete(`/shopping/lists/${id}`);
export const addShoppingListItem = (listId, data) => api.post(`/shopping/lists/${listId}/items`, data);
export const updateShoppingListItem = (listId, itemId, data) => api.put(`/shopping/lists/${listId}/items/${itemId}`, data);
export const removeShoppingListItem = (listId, itemId) => api.delete(`/shopping/lists/${listId}/items/${itemId}`);
export const toggleShoppingItemPurchased = (listId, itemId) => api.patch(`/shopping/lists/${listId}/items/${itemId}/toggle`);
export const checkoutShoppingList = (listId, data) => api.post(`/shopping/lists/${listId}/checkout`, data);

// Annual Summary
export const getAnnualBudgetSummary = (year) => api.get('/budgets/annual-summary', { params: { year } });
export const getMonthlyCategoryBreakdown = (year) => api.get('/budgets/monthly-category-breakdown', { params: { year } });

// Settings — Categories
export const getSettingsCategories = () => api.get('/settings/categories');
export const createSettingsCategory = (data) => api.post('/settings/categories', data);
export const updateSettingsCategory = (id, data) => api.put(`/settings/categories/${id}`, data);
export const deleteSettingsCategory = (id) => api.delete(`/settings/categories/${id}`);
export const setSettingsCategoryRecurringBudget = (id, data) => api.put(`/settings/categories/${id}/recurring-budget`, data);

// Settings — Payment Sources
export const getSettingsPaymentSources   = ()        => api.get('/settings/payment-sources');
export const createSettingsPaymentSource = (data)    => api.post('/settings/payment-sources', data);
export const updateSettingsPaymentSource = (id, data) => api.put(`/settings/payment-sources/${id}`, data);
export const deleteSettingsPaymentSource = (id)      => api.delete(`/settings/payment-sources/${id}`);

// Settings — Shopping List Types
export const getAdminShoppingListTypes         = ()        => api.get('/settings/shopping/list-types');
export const createAdminShoppingListType       = (data)    => api.post('/settings/shopping/list-types', data);
export const updateAdminShoppingListType       = (id, data) => api.put(`/settings/shopping/list-types/${id}`, data);
export const deleteAdminShoppingListType       = (id)      => api.delete(`/settings/shopping/list-types/${id}`);

// Settings — Shopping Catalog Categories
export const getAdminShoppingCatalogCategories    = ()        => api.get('/settings/shopping/catalog-categories');
export const createAdminShoppingCatalogCategory   = (data)    => api.post('/settings/shopping/catalog-categories', data);
export const updateAdminShoppingCatalogCategory   = (id, data) => api.put(`/settings/shopping/catalog-categories/${id}`, data);
export const deleteAdminShoppingCatalogCategory   = (id)      => api.delete(`/settings/shopping/catalog-categories/${id}`);

// Settings — Shopping Mapping
export const getAdminListTypeCategoryLinks  = (listTypeId)        => api.get(`/settings/shopping/list-types/${listTypeId}/categories`);
export const setAdminListTypeCategoryLinks  = (listTypeId, data)  => api.put(`/settings/shopping/list-types/${listTypeId}/categories`, data);

// Tasks
export const getTasks = (params) => api.get('/tasks', { params });
export const createTask = (data) => api.post('/tasks', data);
export const getTaskById = (id) => api.get(`/tasks/${id}`);
export const updateTask = (id, data) => api.put(`/tasks/${id}`, data);
export const deleteTask = (id) => api.delete(`/tasks/${id}`);

export default api;
