/**
 * api.js — All API calls for the admin dashboard.
 *
 * Imports API_BASE_URL and BUSINESS_SLUG from config.js.
 * Neither value is hardcoded or duplicated here.
 *
 * DashAPI(token) is a factory; token is the only runtime dependency
 * (it changes on login / logout). All URL construction uses the
 * module-level constants from config.
 *
 * BUSINESS_SLUG usage
 * ───────────────────
 *  On a tenant domain (e.g. academy.indian-sme.com), BUSINESS_SLUG is
 *  detected from the hostname and takes precedence over any slug typed
 *  in the login form. When null (local dev / platform root), the caller
 *  must supply the slug explicitly.
 */

import { API_BASE_URL, BUSINESS_SLUG } from './config.js';

/**
 * @param {string|null}  token
 * @param {{ onUnauthorized?: () => void }} [opts]
 */
export function DashAPI(token, { onUnauthorized } = {}) {
  /* Headers helpers */
  const jsonHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });

  const authHeaders = () => ({
    Authorization: `Bearer ${token}`,
  });

  /**
   * Core request helper.
   * Detects 401 → calls onUnauthorized() then throws.
   * Logs all non-2xx responses to console.error for debugging.
   */
  async function req(method, path, body) {
    const opts = {
      method,
      headers: body !== undefined ? jsonHeaders() : authHeaders(),
    };
    if (body !== undefined) opts.body = JSON.stringify(body);

    const res  = await fetch(`${API_BASE_URL}${path}`, opts);
    if (res.status === 204) return null;

    const data = await res.json();

    if (res.status === 401) {
      console.error(`[API] 401 Unauthorized — ${method} ${path}`);
      onUnauthorized?.();
      throw new Error('Session expired. Please log in again.');
    }

    if (!res.ok) {
      console.error(`[API] ${res.status} — ${method} ${path}:`, data.error ?? 'Unknown error');
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    return data;
  }

  return {
    /* ── Auth ── */

    /**
     * Login uses the module-level BUSINESS_SLUG when available
     * (tenant domain detected from hostname). The caller-supplied `slug`
     * acts as a fallback for local dev / platform root where the user
     * must type it in the form.
     *
     * @param {string|null} slug  — form value; ignored when BUSINESS_SLUG is set
     * @param {string}      email
     * @param {string}      password
     */
    login(slug, email, password) {
      const businessSlug = BUSINESS_SLUG ?? slug;

      return fetch(`${API_BASE_URL}/api/admin/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ businessSlug, email, password }),
      }).then((r) => r.json().then((d) => ({ ok: r.ok, data: d })));
    },

    /* ── Admin reads ── */
    getConfig:       ()         => req('GET', '/api/admin/config'),
    getBusiness:     ()         => req('GET', '/api/admin/business'),
    getDashboard:    ()         => req('GET', '/api/admin/dashboard'),
    getLeads:        ()         => req('GET', '/api/admin/leads'),
    getLeadsByDay:   (days = 7) => req('GET', `/api/admin/leads/by-day?days=${days}`),
    getAppts:        ()         => req('GET', '/api/admin/appointments'),
    getServices:     ()         => req('GET', '/api/admin/services'),
    getTestimonials: ()         => req('GET', '/api/admin/testimonials'),

    /* ── Lead mutations ── */
    updateLeadStatus: (id, status) => req('PATCH',  `/api/leads/${id}/status`, { status }),
    deleteLead:       (id)         => req('DELETE', `/api/leads/${id}`),

    /* ── Appointment mutations ── */
    createAppt:       (data)       => req('POST',   '/api/appointments', data),
    updateApptStatus: (id, status) => req('PATCH',  `/api/appointments/${id}/status`, { status }),
    deleteAppt:       (id)         => req('DELETE', `/api/appointments/${id}`),

    /* ── Service mutations ── */
    createService:  (data)     => req('POST',   '/api/services', data),
    updateService:  (id, data) => req('PATCH',  `/api/services/${id}`, data),
    deleteService:  (id)       => req('DELETE', `/api/services/${id}`),

    /* ── Testimonial mutations ── */
    createTestimonial: (data) => req('POST',   '/api/testimonials', data),
    deleteTestimonial: (id)   => req('DELETE', `/api/testimonials/${id}`),
  };
}
