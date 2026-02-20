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
export const getTransactions = () => api.get('/transactions');
export const getTags = () => api.get('/transactions/tags');
export const getCategories = () => api.get('/transactions/categories');
export const getPaymentSources = () => api.get('/transactions/payment-sources');
export const getTransactionById = (id) => api.get(`transactions/${id}`);
export const updateTransaction = (id, data) => api.put(`transactions/${id}`, data);
export const deleteTransaction = (id) => api.delete(`/transactions/${id}`);

// Loan
export const getAllLoans = () => api.get('/loans');
export const createLoan = (data) => api.post('/loans', data);

// Lego set collection
export const getLegoSets = () => api.get('/lego');
export const addLegoSet = (setData) => api.post('/lego', setData);
export const updateLegoSet = (id, setData) => api.put(`/lego/${id}`, setData);
export const getLegoThemes = () => api.get('/lego/themes');
export const getLegoSetDetails = (setNum) => api.get(`/transactions/lego/details/${setNum}`);

// Budget
export const getBudgetsByMonth = (month) => api.get(`/budgets?month=${month}`);
export const upsertBudget = (data) => api.post('/budgets', data);
export const copyBudget = (data) => api.post('/budgets/copy', data);
export const deleteBudget = (id) => api.delete(`/budgets/${id}`);

// Shopping Lists
export const getShoppingListTypes = () => api.get('/shopping/list-types');
export const getShoppingCatalogCategories = (listTypeId) => api.get('/shopping/catalog-categories', { params: listTypeId ? { list_type_id: listTypeId } : {} });
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

export default api;
