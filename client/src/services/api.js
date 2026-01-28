import axios from 'axios';

// Site URL
const API_URL = 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_URL,
});


// Send data
export const createTransaction = (data) => api.post('/transactions', data);
export const getTransactions = () => api.get('/transactions');
export const deleteTransaction = (id) => api.delete(`/transactions/${id}`);
export const getTags = () => api.get('/transactions/tags');

/*
// שליפת רשימת תגיות ייחודיות
export const getExistingTags = async () => {
  const { data, error } = await supabase.rpc('get_unique_tags');
  if (error) throw error;
  return data.map(t => t.tag).filter(Boolean); // מחזיר מערך נקי של מילים
};*/


// Lego set collection
export const getLegoSets = () => api.get('/lego');
export const addLegoSet = (setData) => api.post('/lego', setData);
export const updateLegoSet = (id, setData) => api.put(`/lego/${id}`, setData);

export default api;