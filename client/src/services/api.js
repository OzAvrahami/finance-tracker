import axios from 'axios';

// Site URL
const API_URL = 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_URL,
});


// Send data
export const createTransaction = (data) => api.post('/transactions', data);
export const getTransactions = () => api.get('/transactions');

// Lego set collection
export const getLegoSets = () => api.get('/lego');

// Add new lego set
export const addLegoSet = (setData) => api.post('/lego', setData);

export const updateLegoSet = (id, setData) => api.put(`/lego/${id}`, setData);
export default api;