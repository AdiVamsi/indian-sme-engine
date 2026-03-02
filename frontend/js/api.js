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
      const body    = await res.json().catch(() => ({}));
      /* body.error may be a string or an object (e.g. Zod flatten()).
         Always coerce to a plain string so callers can safely use err.message. */
      const message = typeof body.error === 'string'
        ? body.error
        : 'Request failed';
      const err  = new Error(message);
      err.status = res.status;
      err.body   = body;
      throw err;
    }

    return res.json();
  }

  window.API = { createLead };

}());
