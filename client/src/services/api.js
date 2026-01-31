import axios from 'axios';

// Site URL
const API_URL = 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_URL,
});


// Transaction
export const createTransaction = (data) => api.post('/transactions', data);
export const getTransactions = () => api.get('/transactions');
export const getTags = () => api.get('/transactions/tags');
export const getTransactionById = (id) => api.get(`transactions/${id}`);
export const updateTransaction = (id, data) => api.put(`transactions/${id}`, data);
export const deleteTransaction = (id) => api.delete(`/transactions/${id}`);

// Lego set collection
export const getLegoSets = () => api.get('/lego');
export const addLegoSet = (setData) => api.post('/lego', setData);
export const updateLegoSet = (id, setData) => api.put(`/lego/${id}`, setData);
export const getLegoThemes = () => api.get('/lego/themes');
export const getLegoSetDetails = (setNum) => api.get(`/transactions/lego/details/${setNum}`);

export default api;