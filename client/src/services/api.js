import axios from 'axios';

// כתובת השרת שלך (ה-Backend שיצרנו קודם)
const API_URL = 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_URL,
});

// פונקציות עזר לשליחת נתונים
export const createTransaction = (data) => api.post('/transactions', data);
export const getTransactions = () => api.get('/transactions');

export default api;