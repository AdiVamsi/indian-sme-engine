/**
 * dashboard.js — Pure orchestration.
 *
 * Imports DashAPI, DashUI, and connectRealtime from their modules.
 * Owns auth state, session expiry, tab routing, and realtime wiring.
 * Zero raw DOM manipulation (delegated to ui).
 * Zero fetch() calls (delegated to api).
 */

import { DashAPI }         from './api.js';
import { DashUI }          from './ui.js';
import { connectRealtime } from './realtime.js';
import { BUSINESS_SLUG }   from './config.js';

/* Hide slug field when tenant is known from the domain */
const slugRow = document.getElementById('slug')?.closest('.form-group');
if (slugRow && BUSINESS_SLUG) slugRow.style.display = 'none';

/* ── Module-level state ── */
let api            = null;
let ui             = null;
let config         = null;
let activeTab      = 'leads';
let loadedSections = new Set();
let wsClient       = null;
let expiryTimer    = null;

const $ = (id) => document.getElementById(id);

/* ─────────────────────────────────────────────────
   JWT UTILITIES
───────────────────────────────────────────────── */
function decodeJwt(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

function checkTokenAndSchedule(token) {
  const payload = decodeJwt(token);
  if (!payload?.exp) return;

  const msLeft = payload.exp * 1000 - Date.now();

  if (msLeft <= 0) {
    doLogout('Session expired. Please log in again.');
    return;
  }

  clearTimeout(expiryTimer);
  /* setTimeout max is ~24.8 days; cap to prevent overflow */
  expiryTimer = setTimeout(
    () => doLogout('Session expired. Please log in again.'),
    Math.min(msLeft, 2_147_483_647)
  );
}

/* ─────────────────────────────────────────────────
   LOGOUT — single function used by button + auto-expiry + 401
───────────────────────────────────────────────── */
function doLogout(reason) {
  if (wsClient) wsClient.close();
  clearTimeout(expiryTimer);
  localStorage.removeItem('dash_token');

  api            = null;
  ui             = null;
  config         = null;
  wsClient       = null;
  expiryTimer    = null;
  activeTab      = 'leads';
  loadedSections.clear();

  document.body.removeAttribute('data-mood');

  /* Clear all dynamic content */
  $('stats-grid').innerHTML          = '';
  $('leads-tbody').innerHTML         = '';
  $('appt-tbody').innerHTML          = '';
  $('services-tbody').innerHTML      = '';
  $('testimonials-tbody').innerHTML  = '';
  $('leads-thead').innerHTML         = '';
  $('appt-thead').innerHTML          = '';
  $('services-thead').innerHTML      = '';
  $('testimonials-thead').innerHTML  = '';
  $('biz-name').textContent          = '';

  const greetEl = $('greeting');
  if (greetEl) greetEl.textContent = '';

  const logoEl = $('biz-logo');
  if (logoEl) logoEl.style.display = 'none';

  const chartEl = $('chart-container');
  if (chartEl) chartEl.innerHTML = '';

  /* Reset tabs */
  document.querySelectorAll('.tab').forEach((b) =>
    b.classList.toggle('tab--active', b.dataset.tab === 'leads')
  );
  ['leads', 'appointments', 'services', 'testimonials'].forEach((t) => {
    const el = $(`section-${t}`);
    if (el) el.classList.toggle('hidden', t !== 'leads');
  });

  $('login-form').reset();
  $('login-error').textContent = reason ?? '';
  $('dashboard-screen').classList.add('hidden');
  $('login-screen').classList.remove('hidden');
}

$('logout-btn').addEventListener('click', () => doLogout());

/* ─────────────────────────────────────────────────
   LOGIN
───────────────────────────────────────────────── */
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const errEl = $('login-error');
  errEl.textContent = '';

  /* Loading state */
  const loginBtn   = $('login-form').querySelector('.btn-login');
  const loginLabel = loginBtn?.querySelector('.btn-login__label');
  const loginIcon  = loginBtn?.querySelector('.btn-login__icon');
  if (loginBtn)   loginBtn.disabled       = true;
  if (loginLabel) loginLabel.textContent  = 'Signing in…';
  if (loginIcon)  loginIcon.style.opacity = '0';

  try {
    const tmpApi = DashAPI(null);
    const { ok, data } = await tmpApi.login(
      $('slug').value.trim(),
      $('email').value.trim(),
      $('password').value
    ).catch(() => ({ ok: false, data: { error: 'Could not reach server.' } }));

    if (!ok) {
      errEl.textContent = data.error || 'Login failed.';
      return;
    }

    /* Verify token is not already expired */
    const payload = decodeJwt(data.token);
    if (payload?.exp && payload.exp * 1000 <= Date.now()) {
      errEl.textContent = 'Received an expired token. Please try again.';
      return;
    }

    /* Build authenticated API instance with 401 → auto-logout */
    api = DashAPI(data.token, {
      onUnauthorized: () => doLogout('Session expired. Please log in again.'),
    });

    /* Expose on window so browser console can inspect: window.api */
    window.api = api;

    /* Persist token for agent.html (separate page, same session) */
    localStorage.setItem('dash_token', data.token);

    /* Schedule auto-logout at token expiry */
    checkTokenAndSchedule(data.token);

    $('login-screen').classList.add('hidden');
    $('dashboard-screen').classList.remove('hidden');

    /* Skeleton placeholders while data loads */
    $('stats-grid').innerHTML = Array(6).fill(0).map(() => `
      <div class="stat-card">
        <div class="skeleton skeleton--sm" style="margin-bottom:0.5rem"></div>
        <div class="skeleton" style="width:55%;height:2.25rem;border-radius:0.4rem"></div>
      </div>`).join('');

    try {
      await bootDashboard();
      startRealtime(data.token);
    } catch (err) {
      console.error('[Login] bootDashboard failed:', err);
      errEl.textContent = 'Dashboard failed to load. Please try again.';
      doLogout();
    }

  } finally {
    if (loginBtn)   loginBtn.disabled       = false;
    if (loginLabel) loginLabel.textContent  = 'Sign In';
    if (loginIcon)  loginIcon.style.opacity = '';
  }
});

/* ─────────────────────────────────────────────────
   SAFE FETCH — wraps an API call so a single failure
   never crashes the entire boot sequence.
───────────────────────────────────────────────── */
async function safeFetch(fn, label) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[Dashboard] ${label} failed:`, err);
    return null;
  }
}

/* ─────────────────────────────────────────────────
   BOOT — loads each widget independently so one
   failing endpoint never freezes the whole UI.
───────────────────────────────────────────────── */
async function bootDashboard() {
  console.log('[Dashboard] Boot starting');

  /* Config is required — it seeds DashUI and all column/stat labels.
     If this fails the caller's try-catch handles it. */
  const cfg = await api.getConfig();
  config = cfg;
  ui     = DashUI(cfg);
  loadedSections.add('leads');

  ui.applyMood();
  ui.renderBizHeader();
  ui.renderColumns('leads-thead', cfg.tableColumns.leads);

  /* Stats — optional; skeleton stays if it fails */
  const summary = await safeFetch(() => api.getDashboard(), 'dashboard stats');
  if (summary) ui.renderStats(summary);

  /* Leads — optional; empty state shown if it fails */
  const leads = await safeFetch(() => api.getLeads(), 'leads');
  renderLeads(leads ?? []);

  /* Chart — optional; chart area stays blank if it fails */
  const chartData = await safeFetch(() => api.getLeadsByDay(7), 'leads by day');
  if (chartData) ui.renderChart(chartData);

  console.log('[Dashboard] Boot completed');
}

/* ─────────────────────────────────────────────────
   TABS
───────────────────────────────────────────────── */
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

async function switchTab(tab) {
  if (tab === activeTab) return;
  activeTab = tab;

  document.querySelectorAll('.tab').forEach((b) =>
    b.classList.toggle('tab--active', b.dataset.tab === tab)
  );

  ['leads', 'appointments', 'services', 'testimonials'].forEach((t) => {
    const el = $(`section-${t}`);
    if (el) el.classList.toggle('hidden', t !== tab);
  });

  await loadSection(tab);
}

async function loadSection(tab) {
  if (loadedSections.has(tab)) return;
  loadedSections.add(tab);

  if (tab === 'appointments') {
    ui.renderColumns('appt-thead', config.tableColumns.appointments);
    ui.showSkeletonRows('appt-tbody', config.tableColumns.appointments.length);
    renderAppointments(await api.getAppts());

  } else if (tab === 'services') {
    ui.renderColumns('services-thead', config.tableColumns.services);
    ui.showSkeletonRows('services-tbody', config.tableColumns.services.length);
    renderServices(await api.getServices());

  } else if (tab === 'testimonials') {
    ui.renderColumns('testimonials-thead', config.tableColumns.testimonials);
    ui.showSkeletonRows('testimonials-tbody', config.tableColumns.testimonials.length);
    renderTestimonials(await api.getTestimonials());
  }
}

/* ─────────────────────────────────────────────────
   EMPTY STATES
───────────────────────────────────────────────── */

/* Leads empty state — with copy-to-clipboard enquiry link */
function buildLeadsEmptyState(tbody, colSpan) {
  const slug = config.business?.slug ?? '';
  const url  = `https://indian-sme-engine.onrender.com/api/public/${slug}/leads`;

  tbody.innerHTML = `
    <tr class="empty-row">
      <td colspan="${colSpan}" class="empty">
        <div class="empty-state">
          <p class="empty-state__icon">📭</p>
          <p class="empty-state__title">No enquiries yet</p>
          <p class="empty-state__sub">Share your public enquiry endpoint to start capturing leads</p>
          <div class="empty-state__row">
            <code class="empty-state__url">${url}</code>
            <button class="btn-copy">Copy link</button>
          </div>
        </div>
      </td>
    </tr>`;

  const btn = tbody.querySelector('.btn-copy');
  if (btn) {
    btn.addEventListener('click', () => {
      navigator.clipboard?.writeText(url)
        .then(() => {
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = 'Copy link'; }, 2200);
        })
        .catch(() => { btn.textContent = 'Copy failed'; });
    });
  }
}

function simpleEmptyState(icon, title, sub) {
  return `
    <div class="empty-state">
      <p class="empty-state__icon">${icon}</p>
      <p class="empty-state__title">${title}</p>
      <p class="empty-state__sub">${sub}</p>
    </div>`;
}

/* ─────────────────────────────────────────────────
   LEADS
───────────────────────────────────────────────── */
function renderLeads(leads) {
  const tbody   = $('leads-tbody');
  const colSpan = (config.tableColumns.leads?.length ?? 5) + 1;
  tbody.innerHTML = '';

  if (!leads.length) {
    buildLeadsEmptyState(tbody, colSpan);
    return;
  }
  leads.forEach((l) => {
    const row = ui.buildLeadRow(l);
    wireLeadRow(row);
    tbody.appendChild(row);
  });
}

function wireLeadRow(row) {
  const sel = row.querySelector('.status-select');
  const del = row.querySelector('.btn-delete');
  if (sel) sel.addEventListener('change', onLeadStatusChange);
  if (del) del.addEventListener('click', (e) =>
    ui.showDeleteModal(e.currentTarget.dataset.id, doDeleteLead, 'lead')
  );
}

async function onLeadStatusChange(e) {
  const select    = e.target;
  const id        = select.dataset.id;
  const newStatus = select.value;
  const oldClass  = [...select.classList].find((c) => c.startsWith('status--'));
  const oldStatus = oldClass?.replace('status--', '').toUpperCase() ?? null;

  select.disabled = true;
  try {
    await api.updateLeadStatus(id, newStatus);

    if (oldClass) select.classList.remove(oldClass);
    select.classList.add(`status--${newStatus.toLowerCase()}`);
    ui.applyStatusPulse(select);

    if (oldStatus === 'NEW' && newStatus !== 'NEW')
      ui.updateStat('newLeads', Math.max(0, ui.getStat('newLeads') - 1));
    if (oldStatus !== 'NEW' && newStatus === 'NEW')
      ui.updateStat('newLeads', ui.getStat('newLeads') + 1);

    ui.showToast(`Status → ${newStatus}`, 'success');
  } catch (err) {
    console.error('[Dashboard] updateLeadStatus failed:', err);
    select.value = oldStatus || config.leadStatuses[0];
    ui.showToast(err.message || 'Could not update status', 'error');
  } finally {
    select.disabled = false;
  }
}

async function doDeleteLead(id) {
  const row    = document.querySelector(`tr[data-lead-id="${id}"]`);
  const wasNew = row?.querySelector('.status-select')?.value === 'NEW';

  await ui.animateRowOut(row);

  try {
    await api.deleteLead(id);
    if (row) row.remove();

    /* Show leads-specific empty state if now empty */
    const tbody   = $('leads-tbody');
    const colSpan = (config.tableColumns.leads?.length ?? 5) + 1;
    if (!tbody.querySelector('tr:not(.empty-row)')) {
      buildLeadsEmptyState(tbody, colSpan);
    }

    ui.updateStat('totalLeads', Math.max(0, ui.getStat('totalLeads') - 1));
    if (wasNew) ui.updateStat('newLeads', Math.max(0, ui.getStat('newLeads') - 1));
    ui.showToast('Lead deleted', 'success');
  } catch (err) {
    console.error('[Dashboard] deleteLead failed:', err);
    if (row) { row.classList.remove('row-exit'); row.style.cssText = ''; }
    ui.showToast(err.message || 'Could not delete lead', 'error');
  }
}

/* ─────────────────────────────────────────────────
   APPOINTMENTS
───────────────────────────────────────────────── */
function renderAppointments(appts) {
  const tbody   = $('appt-tbody');
  const colSpan = (config.tableColumns.appointments?.length ?? 5) + 1;
  tbody.innerHTML = '';

  if (!appts.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${colSpan}" class="empty">
      ${simpleEmptyState('📅', 'No appointments yet', 'Use the "+ New" button above to create one')}
    </td></tr>`;
    return;
  }
  appts.forEach((a) => {
    const row = ui.buildApptRow(a);
    wireApptRow(row);
    tbody.appendChild(row);
  });
}

function wireApptRow(row) {
  const sel = row.querySelector('.status-select');
  const del = row.querySelector('.btn-delete');
  if (sel) sel.addEventListener('change', onApptStatusChange);
  if (del) del.addEventListener('click', (e) =>
    ui.showDeleteModal(e.currentTarget.dataset.id, doDeleteAppt, 'appointment')
  );
}

async function onApptStatusChange(e) {
  const select    = e.target;
  const id        = select.dataset.id;
  const newStatus = select.value;
  const oldClass  = [...select.classList].find((c) => c.startsWith('status--'));
  const oldStatus = oldClass?.replace('status--', '').toUpperCase() ?? null;

  select.disabled = true;
  try {
    await api.updateApptStatus(id, newStatus);
    if (oldClass) select.classList.remove(oldClass);
    select.classList.add(`status--${newStatus.toLowerCase()}`);
    ui.applyStatusPulse(select);
    ui.showToast(`Status → ${newStatus}`, 'success');
  } catch (err) {
    console.error('[Dashboard] updateApptStatus failed:', err);
    select.value = oldStatus || config.appointmentStatuses[0];
    ui.showToast(err.message || 'Could not update status', 'error');
  } finally {
    select.disabled = false;
  }
}

async function doDeleteAppt(id) {
  const row    = document.querySelector(`tr[data-appt-id="${id}"]`);
  const status = row?.querySelector('.status-select')?.value;
  await ui.animateRowOut(row);

  try {
    await api.deleteAppt(id);
    if (row) row.remove();
    ui.checkEmpty('appt-tbody', config.tableColumns.appointments?.length ?? 5);
    ui.updateStat('totalAppointments', Math.max(0, ui.getStat('totalAppointments') - 1));
    if (status === 'NEW' || status === 'CONFIRMED')
      ui.updateStat('upcomingAppointments', Math.max(0, ui.getStat('upcomingAppointments') - 1));
    ui.showToast('Appointment deleted', 'success');
  } catch (err) {
    console.error('[Dashboard] deleteAppt failed:', err);
    if (row) { row.classList.remove('row-exit'); row.style.cssText = ''; }
    ui.showToast(err.message || 'Could not delete', 'error');
  }
}

$('btn-new-appointment').addEventListener('click', () => {
  ui.showFormModal('New Appointment', [
    { name: 'customerName', label: 'Customer Name', type: 'text',           required: true  },
    { name: 'phone',        label: 'Phone',          type: 'tel',            required: true  },
    { name: 'scheduledAt',  label: 'Date & Time',    type: 'datetime-local', required: true  },
    { name: 'notes',        label: 'Notes',          type: 'text',           required: false },
  ], async (data) => {
    try {
      if (data.scheduledAt) data.scheduledAt = new Date(data.scheduledAt).toISOString();
      const appt = await api.createAppt(data);
      const row  = ui.buildApptRow(appt);
      wireApptRow(row);
      ui.prependRow('appt-tbody', row);
      ui.updateStat('totalAppointments', ui.getStat('totalAppointments') + 1);
      ui.showToast('Appointment created', 'success');
    } catch (err) {
      console.error('[Dashboard] createAppt failed:', err);
      throw err;
    }
  });
});

/* ─────────────────────────────────────────────────
   SERVICES
───────────────────────────────────────────────── */
function renderServices(svcs) {
  const tbody   = $('services-tbody');
  const colSpan = (config.tableColumns.services?.length ?? 4) + 1;
  tbody.innerHTML = '';

  if (!svcs.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${colSpan}" class="empty">
      ${simpleEmptyState('🛍️', 'No services yet', 'Use the "+ New" button above to add one')}
    </td></tr>`;
    return;
  }
  svcs.forEach((s) => {
    const row = ui.buildServiceRow(s);
    wireServiceRow(row, s);
    tbody.appendChild(row);
  });
}

function wireServiceRow(row, svc) {
  const ed  = row.querySelector('.btn-edit');
  const del = row.querySelector('.btn-delete');
  if (ed)  ed.addEventListener('click',  () => onEditService(svc));
  if (del) del.addEventListener('click', (e) =>
    ui.showDeleteModal(e.currentTarget.dataset.id, doDeleteService, 'service')
  );
}

const SERVICE_FIELDS = [
  { name: 'title',       label: 'Title',       type: 'text',     required: true  },
  { name: 'description', label: 'Description', type: 'textarea', required: false },
  { name: 'priceInr',   label: 'Price (₹)',   type: 'number',   required: false, min: 0 },
];

function onEditService(svc) {
  ui.showFormModal('Edit Service', SERVICE_FIELDS, async (data) => {
    try {
      const updated = await api.updateService(svc.id, data);
      const merged  = { ...svc, ...updated };
      const oldRow  = document.querySelector(`tr[data-service-id="${svc.id}"]`);
      const newRow  = ui.buildServiceRow(merged);
      wireServiceRow(newRow, merged);
      if (oldRow) oldRow.parentNode.replaceChild(newRow, oldRow);
      ui.showToast('Service updated', 'success');
    } catch (err) {
      console.error('[Dashboard] updateService failed:', err);
      throw err;
    }
  }, {
    title:       svc.title,
    description: svc.description ?? '',
    priceInr:    svc.priceInr    ?? '',
  });
}

$('btn-new-service').addEventListener('click', () => {
  ui.showFormModal('New Service', SERVICE_FIELDS, async (data) => {
    try {
      const svc = await api.createService(data);
      const row = ui.buildServiceRow(svc);
      wireServiceRow(row, svc);
      ui.prependRow('services-tbody', row);
      ui.updateStat('totalServices', ui.getStat('totalServices') + 1);
      ui.showToast('Service created', 'success');
    } catch (err) {
      console.error('[Dashboard] createService failed:', err);
      throw err;
    }
  });
});

async function doDeleteService(id) {
  const row = document.querySelector(`tr[data-service-id="${id}"]`);
  await ui.animateRowOut(row);

  try {
    await api.deleteService(id);
    if (row) row.remove();
    ui.checkEmpty('services-tbody', config.tableColumns.services?.length ?? 4);
    ui.updateStat('totalServices', Math.max(0, ui.getStat('totalServices') - 1));
    ui.showToast('Service deleted', 'success');
  } catch (err) {
    console.error('[Dashboard] deleteService failed:', err);
    if (row) { row.classList.remove('row-exit'); row.style.cssText = ''; }
    ui.showToast(err.message || 'Could not delete', 'error');
  }
}

/* ─────────────────────────────────────────────────
   TESTIMONIALS
───────────────────────────────────────────────── */
function renderTestimonials(testimonials) {
  const tbody   = $('testimonials-tbody');
  const colSpan = (config.tableColumns.testimonials?.length ?? 4) + 1;
  tbody.innerHTML = '';

  if (!testimonials.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${colSpan}" class="empty">
      ${simpleEmptyState('⭐', 'No testimonials yet', 'Use the "+ New" button above to add one')}
    </td></tr>`;
    return;
  }
  testimonials.forEach((t) => {
    const row = ui.buildTestimonialRow(t);
    wireTestimonialRow(row);
    tbody.appendChild(row);
  });
}

function wireTestimonialRow(row) {
  const del = row.querySelector('.btn-delete');
  if (del) del.addEventListener('click', (e) =>
    ui.showDeleteModal(e.currentTarget.dataset.id, doDeleteTestimonial, 'testimonial')
  );
}

$('btn-new-testimonial').addEventListener('click', () => {
  ui.showFormModal('New Testimonial', [
    { name: 'customerName', label: 'Customer Name',  type: 'text',     required: true  },
    { name: 'text',         label: 'Testimonial',    type: 'textarea', required: true  },
    { name: 'rating',       label: 'Rating (1–5)',   type: 'number',   required: false, min: 1, max: 5 },
  ], async (data) => {
    try {
      const t   = await api.createTestimonial(data);
      const row = ui.buildTestimonialRow(t);
      wireTestimonialRow(row);
      ui.prependRow('testimonials-tbody', row);
      ui.updateStat('totalTestimonials', ui.getStat('totalTestimonials') + 1);
      ui.showToast('Testimonial added', 'success');
    } catch (err) {
      console.error('[Dashboard] createTestimonial failed:', err);
      throw err;
    }
  });
});

async function doDeleteTestimonial(id) {
  const row = document.querySelector(`tr[data-testimonial-id="${id}"]`);
  await ui.animateRowOut(row);

  try {
    await api.deleteTestimonial(id);
    if (row) row.remove();
    ui.checkEmpty('testimonials-tbody', config.tableColumns.testimonials?.length ?? 4);
    ui.updateStat('totalTestimonials', Math.max(0, ui.getStat('totalTestimonials') - 1));
    ui.showToast('Testimonial deleted', 'success');
  } catch (err) {
    console.error('[Dashboard] deleteTestimonial failed:', err);
    if (row) { row.classList.remove('row-exit'); row.style.cssText = ''; }
    ui.showToast(err.message || 'Could not delete', 'error');
  }
}

/* ─────────────────────────────────────────────────
   REALTIME WEBSOCKET
───────────────────────────────────────────────── */
function startRealtime(token) {
  wsClient = connectRealtime(token, {
    'lead:new':            onNewLead,
    'lead:deleted':        ({ id }) => doDeleteLead(id),
    'lead:status_changed': onRemoteLeadStatusChange,
  });
}

function onNewLead(lead) {
  ui.updateStat('totalLeads', ui.getStat('totalLeads') + 1);
  if (lead.status === config.leadStatuses[0])
    ui.updateStat('newLeads', ui.getStat('newLeads') + 1);

  const row = ui.buildLeadRow(lead, true);
  wireLeadRow(row);
  void row.offsetWidth;
  row.classList.add('lead-new--visible');
  ui.prependRow('leads-tbody', row);

  ui.showToast(config.notifText?.newLead ?? 'New lead!');
}

function onRemoteLeadStatusChange({ id, status }) {
  const select = document.querySelector(`.status-select[data-id="${id}"]`);
  if (!select) return;

  const oldClass  = [...select.classList].find((c) => c.startsWith('status--'));
  const oldStatus = oldClass?.replace('status--', '').toUpperCase() ?? null;

  if (oldClass) select.classList.remove(oldClass);
  select.classList.add(`status--${status.toLowerCase()}`);
  select.value = status;
  ui.applyStatusPulse(select);

  if (oldStatus === 'NEW' && status !== 'NEW')
    ui.updateStat('newLeads', Math.max(0, ui.getStat('newLeads') - 1));
  if (oldStatus !== 'NEW' && status === 'NEW')
    ui.updateStat('newLeads', ui.getStat('newLeads') + 1);
}

/* ─────────────────────────────────────────────────
   AUTO-LOGIN — restore session from persisted token
   Runs once on every page load. If a valid, non-expired
   token exists in localStorage the login screen is skipped
   and the dashboard boots immediately.
───────────────────────────────────────────────── */
(async () => {
  const stored = localStorage.getItem('dash_token');
  if (!stored) return;

  /* Reject expired tokens without hitting the server */
  const payload = decodeJwt(stored);
  if (!payload?.exp || payload.exp * 1000 <= Date.now()) {
    localStorage.removeItem('dash_token');
    return;
  }

  api = DashAPI(stored, {
    onUnauthorized: () => doLogout('Session expired. Please log in again.'),
  });

  /* Expose on window so browser console can inspect: window.api */
  window.api = api;

  checkTokenAndSchedule(stored);

  $('login-screen').classList.add('hidden');
  $('dashboard-screen').classList.remove('hidden');

  $('stats-grid').innerHTML = Array(6).fill(0).map(() => `
    <div class="stat-card">
      <div class="skeleton skeleton--sm" style="margin-bottom:0.5rem"></div>
      <div class="skeleton" style="width:55%;height:2.25rem;border-radius:0.4rem"></div>
    </div>`).join('');

  try {
    await bootDashboard();
    startRealtime(stored);
  } catch (err) {
    console.error('[AutoLogin] bootDashboard failed:', err);
    doLogout('Could not load dashboard data. Please log in again.');
  }
})();
