/**
 * admin-api.js — AdminAPI factory.
 * Pure HTTP — no DOM, no state.
 *
 * Usage:
 *   const api = AdminAPI(token);
 *   const data = await api.getOverview();
 */

import { API_BASE_URL } from './config.js';

export function AdminAPI(token) {
  const h = () => ({
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

  async function request(method, path, body) {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: h(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    /* 401 — signal to caller to clear token + redirect */
    if (res.status === 401) {
      const err = new Error('UNAUTHORIZED');
      err.status = 401;
      throw err;
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  return {
    login:         (password)  => request('POST', '/api/superadmin/login', { password }),
    getOverview:   ()          => request('GET',  '/api/superadmin/overview'),
    getBusinesses: ()          => request('GET',  '/api/superadmin/businesses'),
    getLeads:      ()          => request('GET',  '/api/superadmin/leads'),
    getLogs:       ()          => request('GET',  '/api/superadmin/logs'),
  };
}
