'use strict';

/**
 * api.js — single source of truth for all backend communication.
 *
 * Reads SITE.api.baseUrl and SITE.api.slug from config.js (loaded first).
 * Exposes window.API so script.js can call API.createLead(data).
 */
(function () {

  /**
   * Submit a lead enquiry to the backend.
   *
   * @param {{ name: string, phone: string, email?: string, message?: string, hp?: string }} data
   * @returns {Promise<{ ok: true }>}
   * @throws {Error} with .status (HTTP code) and .body (parsed JSON) on failure
   */
  async function createLead(data) {
    const url = `${SITE.api.baseUrl}/api/public/${SITE.api.slug}/leads`;

    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        name:    data.name,
        phone:   data.phone,
        email:   data.email   || '',
        message: data.message || '',
        hp:      data.hp      || '',
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err  = new Error(body.error || 'Request failed');
      err.status = res.status;
      err.body   = body;
      throw err;
    }

    return res.json();
  }

  window.API = { createLead };

}());
