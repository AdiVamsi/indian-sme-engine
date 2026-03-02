/**
 * dashboard.js — Pure orchestration.
 *
 * Imports DashAPI, DashUI, and connectRealtime from their respective modules.
 * Owns routing, auth state, tab state, and realtime event wiring.
 * Zero raw DOM manipulation (all delegated to ui).
 * Zero fetch() calls (all delegated to api).
 * Zero hardcoded URLs (all URLs live in config.js).
 */

import { DashAPI }         from './api.js';
import { DashUI }          from './ui.js';
import { connectRealtime } from './realtime.js';
import { BUSINESS_SLUG }   from './config.js';

/* Hide the slug field when the tenant is already known from the domain */
const slugRow = document.getElementById('slug')?.closest('.form-group');
if (slugRow && BUSINESS_SLUG) slugRow.style.display = 'none';

let api = null;     /* DashAPI instance — set on login */
let ui  = null;     /* DashUI instance — set after config loaded */

let config      = null;
let activeTab   = 'leads';
let loadedSections = new Set();
let wsClient    = null;

const $ = (id) => document.getElementById(id);

/* ─────────────────────────────────────────────────────────
   Login
───────────────────────────────────────────────────────── */
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('login-error');
  errEl.textContent = '';

  /* Temporary un-authenticated api instance just for login */
  const tmpApi = DashAPI(null);
  const { ok, data } = await tmpApi.login(
    $('slug').value.trim(),
    $('email').value.trim(),
    $('password').value
  ).catch(() => ({ ok: false, data: { error: 'Could not reach server.' } }));

  if (!ok) { errEl.textContent = data.error || 'Login failed.'; return; }

  /* Authenticated API + boot dashboard */
  api = DashAPI(data.token);

  $('login-screen').classList.add('hidden');
  $('dashboard-screen').classList.remove('hidden');

  /* Placeholder skeletons while data loads */
  $('stats-grid').innerHTML = Array(6).fill(0).map(() => `
    <div class="stat-card">
      <div class="skeleton skeleton--sm" style="margin-bottom:0.5rem"></div>
      <div class="skeleton" style="width:55%;height:2.25rem;border-radius:0.4rem"></div>
    </div>`).join('');

  await bootDashboard();
  startRealtime(data.token);
});

/* ─────────────────────────────────────────────────────────
   Boot — load config + dashboard + leads in parallel
───────────────────────────────────────────────────────── */
async function bootDashboard() {
  const [cfg, summary, leads, chartData] = await Promise.all([
    api.getConfig(),
    api.getDashboard(),
    api.getLeads(),
    api.getLeadsByDay(7),
  ]);

  config = cfg;
  ui     = DashUI(cfg);           /* ui reads biz context from cfg */
  loadedSections.add('leads');

  ui.applyMood();
  ui.renderBizHeader();
  ui.renderStats(summary);
  ui.renderChart(chartData);
  ui.renderColumns('leads-thead', cfg.tableColumns.leads);
  renderLeads(leads);
}

/* ─────────────────────────────────────────────────────────
   Tab switching
───────────────────────────────────────────────────────── */
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
    const data = await api.getAppts();
    renderAppointments(data);

  } else if (tab === 'services') {
    ui.renderColumns('services-thead', config.tableColumns.services);
    ui.showSkeletonRows('services-tbody', config.tableColumns.services.length);
    const data = await api.getServices();
    renderServices(data);

  } else if (tab === 'testimonials') {
    ui.renderColumns('testimonials-thead', config.tableColumns.testimonials);
    ui.showSkeletonRows('testimonials-tbody', config.tableColumns.testimonials.length);
    const data = await api.getTestimonials();
    renderTestimonials(data);
  }
}

/* ─────────────────────────────────────────────────────────
   LEADS
───────────────────────────────────────────────────────── */
function renderLeads(leads) {
  const tbody = $('leads-tbody');
  tbody.innerHTML = '';
  if (!leads.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6" class="empty">No leads yet. Submit the contact form to see them here.</td></tr>';
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
    select.value = oldStatus || config.leadStatuses[0];
    ui.showToast(err.message || 'Could not update status', 'error');
  }
}

async function doDeleteLead(id) {
  const row    = document.querySelector(`tr[data-lead-id="${id}"]`);
  const wasNew = row?.querySelector('.status-select')?.value === 'NEW';

  await ui.animateRowOut(row);

  try {
    await api.deleteLead(id);
    if (row) row.remove();
    ui.checkEmpty('leads-tbody', 5, 'No leads yet. Submit the contact form to see them here.');
    ui.updateStat('totalLeads', Math.max(0, ui.getStat('totalLeads') - 1));
    if (wasNew) ui.updateStat('newLeads', Math.max(0, ui.getStat('newLeads') - 1));
    ui.showToast('Lead deleted', 'success');
  } catch (err) {
    if (row) { row.classList.remove('row-exit'); row.style.cssText = ''; }
    ui.showToast(err.message || 'Could not delete lead', 'error');
  }
}

/* ─────────────────────────────────────────────────────────
   APPOINTMENTS
───────────────────────────────────────────────────────── */
function renderAppointments(appts) {
  const tbody = $('appt-tbody');
  tbody.innerHTML = '';
  if (!appts.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6" class="empty">No appointments yet.</td></tr>';
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

  try {
    await api.updateApptStatus(id, newStatus);
    if (oldClass) select.classList.remove(oldClass);
    select.classList.add(`status--${newStatus.toLowerCase()}`);
    ui.applyStatusPulse(select);
    ui.showToast(`Status → ${newStatus}`, 'success');
  } catch (err) {
    select.value = oldStatus || config.appointmentStatuses[0];
    ui.showToast(err.message || 'Could not update status', 'error');
  }
}

async function doDeleteAppt(id) {
  const row    = document.querySelector(`tr[data-appt-id="${id}"]`);
  const status = row?.querySelector('.status-select')?.value;
  await ui.animateRowOut(row);

  try {
    await api.deleteAppt(id);
    if (row) row.remove();
    ui.checkEmpty('appt-tbody', 5);
    ui.updateStat('totalAppointments', Math.max(0, ui.getStat('totalAppointments') - 1));
    if (status === 'NEW' || status === 'CONFIRMED')
      ui.updateStat('upcomingAppointments', Math.max(0, ui.getStat('upcomingAppointments') - 1));
    ui.showToast('Appointment deleted', 'success');
  } catch (err) {
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
    if (data.scheduledAt) data.scheduledAt = new Date(data.scheduledAt).toISOString();
    const appt = await api.createAppt(data);
    const row  = ui.buildApptRow(appt);
    wireApptRow(row);
    ui.prependRow('appt-tbody', row);
    ui.updateStat('totalAppointments', ui.getStat('totalAppointments') + 1);
    ui.showToast('Appointment created', 'success');
  });
});

/* ─────────────────────────────────────────────────────────
   SERVICES
───────────────────────────────────────────────────────── */
function renderServices(svcs) {
  const tbody = $('services-tbody');
  tbody.innerHTML = '';
  if (!svcs.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5" class="empty">No services yet.</td></tr>';
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
    const updated = await api.updateService(svc.id, data);
    const merged  = { ...svc, ...updated };
    const oldRow  = document.querySelector(`tr[data-service-id="${svc.id}"]`);
    const newRow  = ui.buildServiceRow(merged);
    wireServiceRow(newRow, merged);
    if (oldRow) oldRow.parentNode.replaceChild(newRow, oldRow);
    ui.showToast('Service updated', 'success');
  }, {
    title:       svc.title,
    description: svc.description ?? '',
    priceInr:    svc.priceInr    ?? '',
  });
}

$('btn-new-service').addEventListener('click', () => {
  ui.showFormModal('New Service', SERVICE_FIELDS, async (data) => {
    const svc = await api.createService(data);
    const row = ui.buildServiceRow(svc);
    wireServiceRow(row, svc);
    ui.prependRow('services-tbody', row);
    ui.updateStat('totalServices', ui.getStat('totalServices') + 1);
    ui.showToast('Service created', 'success');
  });
});

async function doDeleteService(id) {
  const row = document.querySelector(`tr[data-service-id="${id}"]`);
  await ui.animateRowOut(row);

  try {
    await api.deleteService(id);
    if (row) row.remove();
    ui.checkEmpty('services-tbody', 4);
    ui.updateStat('totalServices', Math.max(0, ui.getStat('totalServices') - 1));
    ui.showToast('Service deleted', 'success');
  } catch (err) {
    if (row) { row.classList.remove('row-exit'); row.style.cssText = ''; }
    ui.showToast(err.message || 'Could not delete', 'error');
  }
}

/* ─────────────────────────────────────────────────────────
   TESTIMONIALS
───────────────────────────────────────────────────────── */
function renderTestimonials(testimonials) {
  const tbody = $('testimonials-tbody');
  tbody.innerHTML = '';
  if (!testimonials.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5" class="empty">No testimonials yet.</td></tr>';
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
    const t   = await api.createTestimonial(data);
    const row = ui.buildTestimonialRow(t);
    wireTestimonialRow(row);
    ui.prependRow('testimonials-tbody', row);
    ui.updateStat('totalTestimonials', ui.getStat('totalTestimonials') + 1);
    ui.showToast('Testimonial added', 'success');
  });
});

async function doDeleteTestimonial(id) {
  const row = document.querySelector(`tr[data-testimonial-id="${id}"]`);
  await ui.animateRowOut(row);

  try {
    await api.deleteTestimonial(id);
    if (row) row.remove();
    ui.checkEmpty('testimonials-tbody', 4);
    ui.updateStat('totalTestimonials', Math.max(0, ui.getStat('totalTestimonials') - 1));
    ui.showToast('Testimonial deleted', 'success');
  } catch (err) {
    if (row) { row.classList.remove('row-exit'); row.style.cssText = ''; }
    ui.showToast(err.message || 'Could not delete', 'error');
  }
}

/* ─────────────────────────────────────────────────────────
   Realtime WebSocket
───────────────────────────────────────────────────────── */
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

  /* Industry-aware notification text */
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

/* ─────────────────────────────────────────────────────────
   Logout — full state reset
───────────────────────────────────────────────────────── */
$('logout-btn').addEventListener('click', () => {
  if (wsClient) wsClient.close();

  api            = null;
  ui             = null;
  config         = null;
  wsClient       = null;
  activeTab      = 'leads';
  loadedSections.clear();

  /* Reset body mood */
  document.body.removeAttribute('data-mood');

  /* Clear dynamic content */
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
  $('login-error').textContent = '';
  $('dashboard-screen').classList.add('hidden');
  $('login-screen').classList.remove('hidden');
});
