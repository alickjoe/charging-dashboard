import axios from 'axios';

const isElectron = typeof window !== 'undefined' && window.__ELECTRON__ === true;

const api = axios.create({
  // __AIDB_API_BASE__ is injected by the npm desktop deployment's preload
  // (backend port is dynamic there); the exe deployment keeps the fixed
  // localhost:8000 base, and the web/Docker deployment uses the relative path.
  baseURL: window.__AIDB_API_BASE__ ?? (isElectron ? 'http://localhost:8000/api/v1' : '/api/v1'),
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;
