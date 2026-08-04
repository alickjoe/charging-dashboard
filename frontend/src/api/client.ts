import axios from 'axios';

const isElectron = typeof window !== 'undefined' && window.__ELECTRON__ === true;

const api = axios.create({
  baseURL: isElectron ? 'http://localhost:8000/api/v1' : '/api/v1',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;
