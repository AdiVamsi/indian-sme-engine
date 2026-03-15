/**
 * dashboard.js — Pure orchestration.
 *
 * Imports DashAPI, DashUI, and connectRealtime from their modules.
 * Owns auth state, session expiry, tab routing, and realtime wiring.
 * Zero raw DOM manipulation (delegated to ui).
 * Zero fetch() calls (delegated to api).
 */

import { DashAPI } from './api.js';
import { DashUI } from './ui.js';
import { connectRealtime } from './realtime.js';
import { BUSINESS_SLUG } from './config.js';

/* Hide slug field when tenant is known from the domain */
const slugRow = document.getElementById('slug')?.closest('.form-group');
if (slugRow && BUSINESS_SLUG) slugRow.style.display = 'none';

/* ── Module-level state ── */
let api = null;
let ui = null;
let config = null;
let activeTab = 'overview';
let loadedSections = new Set();
let wsClient = null;
let expiryTimer = null;
let _leadsSort = { col: null, dir: 'asc' };

/* Maps tableColumns.leads index → sortable field (null = unsortable) */
const LEAD_SORT_FIELDS = ['name', null, null, 'status', 'priority', 'score', 'createdAt'];
const LEAD_PRIORITY_ORDER = { HIGH: 3, NORMAL: 2, LOW: 1 };

const $ = (id) => document.getElementById(id);

const ALL_SECTIONS = ['overview', 'leads', 'automations', 'appointments', 'services', 'testimonials', 'settings'];

function getRequestedTab() {
  const hash = window.location.hash.slice(1);
  return ALL_SECTIONS.includes(hash) ? hash : 'overview';
}

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

  api = null;
  ui = null;
  config = null;
  wsClient = null;
  expiryTimer = null;
  activeTab = 'overview';
  loadedSections.clear();

  document.body.removeAttribute('data-mood');

  /* Clear all dynamic content */
  $('stats-grid').innerHTML = '';
  $('leads-tbody').innerHTML = '';
  $('appt-tbody').innerHTML = '';
  $('services-tbody').innerHTML = '';
  $('testimonials-tbody').innerHTML = '';
  $('leads-thead').innerHTML = '';
  $('appt-thead').innerHTML = '';
  $('services-thead').innerHTML = '';
  $('testimonials-thead').innerHTML = '';
  $('biz-name').textContent = '';

  const greetEl = $('greeting');
  if (greetEl) greetEl.textContent = 'Overview';

  const subEl = $('biz-name-sub');
  if (subEl) subEl.textContent = '';

  const logoEl = $('biz-logo');
  if (logoEl) logoEl.style.display = 'none';

  const chartEl = $('chart-container');
  if (chartEl) chartEl.innerHTML = '';

  const donutEl = $('donut-container');
  if (donutEl) donutEl.innerHTML = '';

  const autoEl = $('automations-feed');
  if (autoEl) autoEl.innerHTML = '';

  /* Reset tabs + sidebar */
  document.querySelectorAll('.tab').forEach((b) =>
    b.classList.toggle('tab--active', b.dataset.tab === 'overview')
  );
  document.querySelectorAll('#sidebar-nav .sidebar__item[data-tab]').forEach((item) =>
    item.classList.toggle('is-active', item.dataset.tab === 'overview')
  );
  ALL_SECTIONS.forEach((t) => {
    const el = $(`section-${t}`);
    if (el) el.classList.toggle('hidden', t !== 'overview');
  });

  $('login-form').reset();
  $('login-error').textContent = reason ?? '';
  $('dashboard-screen').classList.add('hidden');
  $('login-screen').classList.remove('hidden');
}

$('logout-btn').addEventListener('click', () => doLogout());

/* ─────────────────────────────────────────────────
   SIDEBAR
───────────────────────────────────────────────── */
(function initSidebar() {
  const sidebar = $('sidebar');
  if (!sidebar) return;

  /* Restore persisted collapsed state */
  if (localStorage.getItem('sidebar-collapsed') === 'true') {
    sidebar.classList.add('is-collapsed');
  }

  $('sidebar-toggle')?.addEventListener('click', () => {
    sidebar.classList.toggle('is-collapsed');
    localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('is-collapsed'));
  });

  /* Mobile hamburger — opens sidebar on narrow screens */
  function closeMobileSidebar() {
    sidebar.classList.remove('is-mobile-open');
    $('sidebar-overlay')?.classList.remove('is-visible');
  }

  $('topbar-hamburger')?.addEventListener('click', () => {
    const isOpen = sidebar.classList.toggle('is-mobile-open');
    $('sidebar-overlay')?.classList.toggle('is-visible', isOpen);
  });

  $('sidebar-overlay')?.addEventListener('click', () => closeMobileSidebar());

  /* Expose closer for switchTab to call */
  window._closeMobileSidebar = closeMobileSidebar;

  /* Sidebar nav items → switchTab */
  document.querySelectorAll('#sidebar-nav .sidebar__item[data-tab]').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab(item.dataset.tab);
    });
  });

  /* Sidebar sign-out mirrors existing button */
  $('sidebar-logout')?.addEventListener('click', () => doLogout());
}());

/* ─────────────────────────────────────────────────
   LOGIN
───────────────────────────────────────────────── */
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const errEl = $('login-error');
  errEl.textContent = '';

  /* Loading state */
  const loginBtn = $('login-form').querySelector('.btn-login');
  const loginLabel = loginBtn?.querySelector('.btn-login__label');
  const loginIcon = loginBtn?.querySelector('.btn-login__icon');
  if (loginBtn) loginBtn.disabled = true;
  if (loginLabel) loginLabel.textContent = 'Signing in…';
  if (loginIcon) loginIcon.style.opacity = '0';

  try {
    const tmpApi = DashAPI(null);
    const { ok, data } = await tmpApi.login(
      $('slug').value.trim(),
      $('email').value.trim(),
      $('password').value
    ).catch(() => ({ ok: false, data: { error: 'Could not reach server.' } }));

    if (!ok) {
      /* data.error may be a Zod flatten object { fieldErrors, formErrors }
         when required fields are blank — extract the first human-readable string */
      const errMsg = typeof data.error === 'string'
        ? data.error
        : Object.values(data.error?.fieldErrors ?? {}).flat()[0]
        ?? data.error?.formErrors?.[0]
        ?? 'Invalid credentials. Please check your details.';
      errEl.textContent = errMsg;
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

    /* Fresh login always lands on Overview, regardless of any stale hash. */
    activeTab = 'overview';
    history.replaceState(null, '', '#overview');

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
    if (loginBtn) loginBtn.disabled = false;
    if (loginLabel) loginLabel.textContent = 'Sign In';
    if (loginIcon) loginIcon.style.opacity = '';
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
/* ─────────────────────────────────────────────────
   GO LIVE CARD — persistent utility in the Overview
   tab. Shows the business's public form URL with
   copy and open actions.
───────────────────────────────────────────────── */
function wireGoLiveCard(cfg) {
  const slug = cfg?.business?.slug;
  if (!slug) return;

  const formUrl = `${window.location.origin}/form/${slug}`;
  const urlEl = $('golive-url');
  const copyBtn = $('golive-copy');
  const openLink = $('golive-open');

  if (urlEl) urlEl.textContent = formUrl;
  if (openLink) openLink.href = formUrl;

  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(formUrl);
        copyBtn.textContent = 'Copied ✓';
        setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 1500);
      } catch {
        /* Clipboard API unavailable — prompt user to copy manually */
        copyBtn.textContent = 'Copy failed';
        setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 1500);
      }
    });
  }
}

/* ─────────────────────────────────────────────────
   ACTION CENTER — buckets of leads that need human
   attention right now. Frontend-only computation
   over the already-loaded _allLeads array.
─────────────────────────────────────────────────── */
const AC_MS = { FOLLOWUP: 30 * 60 * 1000, STALE: 4 * 60 * 60 * 1000 };

function computeActionItems() {
  const now = Date.now();
  const urgent = [];
  const followup = [];
  const stale = [];

  for (const lead of _allLeads) {
    if (lead.status !== 'NEW') continue;
    const age = now - new Date(lead.createdAt).getTime();
    const isUrgent = lead.priority === 'HIGH';

    if (isUrgent) {
      urgent.push(lead);
    } else if (age > AC_MS.STALE) {
      stale.push(lead);
    } else if (age > AC_MS.FOLLOWUP) {
      followup.push(lead);
    }
    /* age ≤ 30 min and non-urgent → no bucket yet */
  }

  /* Oldest first within each bucket */
  const byAge = (a, b) => new Date(a.createdAt) - new Date(b.createdAt);
  urgent.sort(byAge);
  followup.sort(byAge);
  stale.sort(byAge);

  return { urgent, followup, stale };
}

function _fmtAge(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function renderActionCenter() {
  const body = $('ac-body');
  const badge = $('ac-badge');
  if (!body) return;

  const { urgent, followup, stale } = computeActionItems();
  const total = urgent.length + followup.length + stale.length;

  if (badge) badge.textContent = total > 0 ? String(total) : '';

  if (total === 0) {
    body.innerHTML = `<p class="ac-empty">All caught up — no leads need attention right now.</p>`;
    return;
  }

  const buckets = [
    { key: 'urgent', mod: 'urgent', label: 'Urgent', leads: urgent },
    { key: 'followup', mod: 'followup', label: 'Follow-up due', leads: followup },
    { key: 'stale', mod: 'stale', label: 'Stale', leads: stale },
  ];

  body.innerHTML = buckets
    .filter((b) => b.leads.length > 0)
    .map((b) => `
      <div class="ac-bucket ac-bucket--${b.mod}" data-bucket="${b.key}">
        <div class="ac-bucket__heading" data-toggle="${b.key}">
          <span class="ac-bucket__dot"></span>
          ${b.label}
          <span class="ac-bucket__count">${b.leads.length}</span>
        </div>
        <div class="ac-bucket__rows" id="ac-rows-${b.key}">
          ${b.leads.map((l) => _buildAcRow(l)).join('')}
        </div>
      </div>`)
    .join('');

  /* Wire collapse toggles */
  body.querySelectorAll('[data-toggle]').forEach((heading) => {
    heading.addEventListener('click', () => {
      const rows = $(`ac-rows-${heading.dataset.toggle}`);
      if (rows) rows.classList.toggle('is-collapsed');
    });
  });

  /* Wire "Contacted" buttons */
  body.querySelectorAll('[data-ac-id]').forEach((btn) => {
    btn.addEventListener('click', () => handleMarkContacted(btn.dataset.acId, btn));
  });
}

function _buildAcRow(lead) {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const phone = lead.phone ? ` · ${esc(lead.phone)}` : '';
  return `
    <div class="ac-row" data-ac-lead="${lead.id}">
      <div class="ac-row__info">
        <div class="ac-row__name">${esc(lead.name || '—')}</div>
        <div class="ac-row__meta">${_fmtAge(lead.createdAt)}${phone}</div>
      </div>
      <button class="ac-row__btn" data-ac-id="${esc(lead.id)}">Contacted</button>
    </div>`;
}

async function handleMarkContacted(leadId, btn) {
  const lead = _allLeads.find((l) => l.id === leadId);
  if (!lead) return;
  const oldStatus = lead.status;

  /* Optimistic: mutate status in place — keep lead in _allLeads for other components */
  btn.disabled = true;
  btn.textContent = '…';
  lead.status = 'CONTACTED';

  /* Refresh all affected surfaces */
  syncLeadDerivedViews({ rerenderTable: activeTab === 'leads' });

  /* Keep the leads table row in sync if visible */
  const sel = document.querySelector(`.status-select[data-id="${leadId}"]`);
  if (sel) {
    const oldClass = [...sel.classList].find((c) => c.startsWith('status--'));
    if (oldClass) sel.classList.remove(oldClass);
    sel.classList.add('status--contacted');
    sel.value = 'CONTACTED';
    ui?.applyStatusPulse(sel);
  }
  ui?.updateStat('newLeads', Math.max(0, ui.getStat('newLeads') - 1));

  try {
    await api.updateLeadStatus(leadId, 'CONTACTED');
    ui?.showToast('Marked contacted', 'success');
  } catch (err) {
    console.error('[ActionCenter] markContacted failed:', err);
    /* Rollback: restore status in place — no re-insert needed */
    lead.status = oldStatus;
    syncLeadDerivedViews({ rerenderTable: activeTab === 'leads' });
    if (sel) {
      const revertClass = [...sel.classList].find((c) => c.startsWith('status--'));
      if (revertClass) sel.classList.remove(revertClass);
      sel.classList.add(`status--${oldStatus.toLowerCase()}`);
      sel.value = oldStatus;
    }
    ui?.updateStat('newLeads', ui.getStat('newLeads') + 1);
    ui?.showToast(err.message || 'Could not update status', 'error');
  }
}

/* ─────────────────────────────────────────────────
   ACTIVATION FLOW — first-run overlay for STARTING
   businesses. Resolves when the user completes the
   test lead or clicks "Skip for now".
───────────────────────────────────────────────── */
function renderActivationResult(metadata) {
  const body = $('act-result-body');
  const tags = metadata?.tags ?? [];
  const score = metadata?.priorityScore ?? 0;
  const label = score >= 30 ? 'HIGH' : score >= 10 ? 'NORMAL' : 'LOW';
  const best = metadata?.bestCategory ?? '—';
  const via = metadata?.via ?? '—';

  const tagsHtml = tags.length
    ? tags.map((t) => `<span class="act-tag">${t}</span>`).join('')
    : '<span style="color:var(--text-2)">none</span>';

  body.innerHTML = `
    <div class="act-result-row">
      <span class="act-result-label">Tags detected</span>
      <span class="act-result-value">${tagsHtml}</span>
    </div>
    <div class="act-result-row">
      <span class="act-result-label">Best intent</span>
      <span class="act-result-value">${best}</span>
    </div>
    <div class="act-result-row">
      <span class="act-result-label">Priority</span>
      <span class="act-result-value">${label} (score ${score})</span>
    </div>
    <div class="act-result-row">
      <span class="act-result-label">Classified via</span>
      <span class="act-result-value">${via}</span>
    </div>`;
}

async function runActivationFlow() {
  return new Promise((resolve) => {
    const overlay = $('activation-overlay');
    const formPanel = $('act-form-panel');
    const resultPanel = $('act-result-panel');
    const msgArea = $('act-message');
    const submitBtn = $('act-submit');
    const submitLabel = $('act-submit-label');
    const errorEl = $('act-error');
    const skipBtn = $('act-skip');
    const continueBtn = $('act-continue');

    overlay.classList.remove('hidden');

    /* Initialise AgentConfig and retrieve test message */
    api.activate()
      .then((result) => {
        if (result.alreadyActivated) {
          overlay.classList.add('hidden');
          return resolve();
        }
        msgArea.value = result.testMessage ?? '';
      })
      .catch(() => {
        /* If activate() fails, dismiss silently — don't block dashboard boot */
        overlay.classList.add('hidden');
        resolve();
      });

    /* Submit handler */
    $('act-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const message = msgArea.value.trim();
      if (!message) return;

      submitBtn.disabled = true;
      submitLabel.textContent = 'Processing…';
      errorEl.textContent = '';

      try {
        const lead = await api.createLead({ name: '[Test] Lead', phone: '+91 00000 00000', message });
        const activity = await api.getLeadActivity(lead.id);

        const classified = activity?.activities?.find((a) => a.type === 'AGENT_CLASSIFIED');
        const prioritized = activity?.activities?.find((a) => a.type === 'AGENT_PRIORITIZED');

        renderActivationResult({
          ...(classified?.metadata ?? {}),
          priorityScore: prioritized?.metadata?.priorityScore ?? 0,
        });

        formPanel.classList.add('hidden');
        resultPanel.classList.remove('hidden');
      } catch {
        submitBtn.disabled = false;
        submitLabel.textContent = 'Submit';
        errorEl.textContent = 'Something went wrong. Please try again.';
      }
    });

    /* Continue after seeing result */
    continueBtn.addEventListener('click', () => {
      overlay.classList.add('hidden');
      resolve();
    });

    /* Skip — upserts config server-side, stage stays STARTING */
    skipBtn.addEventListener('click', async () => {
      skipBtn.disabled = true;
      skipBtn.textContent = 'Skipping…';
      try { await api.activateSkip(); } catch { /* ignore */ }
      overlay.classList.add('hidden');
      resolve();
    });
  });
}

async function bootDashboard() {
  console.log('[Dashboard] Boot starting');

  /* Config is required — it seeds DashUI and all column/stat labels.
     If this fails the caller's try-catch handles it. */
  const cfg = await api.getConfig();
  config = cfg;

  /* Show activation overlay for STARTING businesses before rendering dashboard */
  if (cfg.needsActivation) {
    await runActivationFlow();
  }

  ui = DashUI(cfg);
  loadedSections.add('overview');
  loadedSections.add('leads');

  ui.applyMood();
  ui.renderBizHeader();
  ui.renderColumns('leads-thead', cfg.tableColumns.leads);
  _wireLeadSortHeaders();

  /* Populate status filter options from enum */
  const statusSelect = $('leads-status-filter');
  if (statusSelect && cfg.leadStatuses) {
    cfg.leadStatuses.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      statusSelect.appendChild(opt);
    });
  }

  /* Stats — optional; skeleton stays if it fails */
  const summary = await safeFetch(() => api.getDashboard(), 'dashboard stats');
  if (summary) ui.renderStats(summary);

  /* Leads — optional; empty state shown if it fails */
  const leads = await safeFetch(() => api.getLeads(), 'leads');
  renderLeads(leads ?? []);

  /* Chart — optional; chart area stays blank if it fails */
  const chartData = await safeFetch(() => api.getLeadsByDay(7), 'leads by day');
  if (chartData) ui.renderChart(chartData);

  /* Donut chart — computed from already-loaded leads */
  ui.renderDonutChart(_allLeads);
  renderOverviewActivity(_allLeads);
  renderActionCenter();
  renderAutomations(_allLeads);

  /* Go Live card — fills URL and wires copy button */
  wireGoLiveCard(cfg);

  const startTab = getRequestedTab();
  if (startTab !== 'overview') await switchTab(startTab);

  console.log('[Dashboard] Boot completed');
}

/* ─────────────────────────────────────────────────
   TABS
───────────────────────────────────────────────── */
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

window.addEventListener('hashchange', () => {
  const tab = getRequestedTab();
  if (tab !== activeTab) switchTab(tab);
});

async function switchTab(tab) {
  if (tab === activeTab) return;
  activeTab = tab;
  history.replaceState(null, '', `#${tab}`);

  /* Close mobile sidebar when navigating */
  window._closeMobileSidebar?.();

  /* Hidden tab buttons (JS state signal) */
  document.querySelectorAll('.tab').forEach((b) =>
    b.classList.toggle('tab--active', b.dataset.tab === tab)
  );

  /* Sidebar active highlight */
  document.querySelectorAll('#sidebar-nav .sidebar__item[data-tab]').forEach((item) =>
    item.classList.toggle('is-active', item.dataset.tab === tab)
  );

  ALL_SECTIONS.forEach((t) => {
    const el = $(`section-${t}`);
    if (el) el.classList.toggle('hidden', t !== tab);
  });

  await loadSection(tab);

  /* Force re-render of leads table if it grew/changed in background via websocket */
  if (tab === 'leads' && ui) {
    _applyLeadFilters();
  }

  /* When returning to Overview, always refresh derived displays.
     loadSection early-returns for already-loaded sections, so we do it here. */
  if (tab === 'overview' && ui) {
    ui.renderDonutChart(_allLeads);
    renderOverviewActivity(_allLeads);
    renderActionCenter();
  }

  if (tab === 'automations' && ui) {
    renderAutomations(_allLeads);
  }
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

  } else if (tab === 'automations') {
    renderAutomations(_allLeads);
  }
}

/* ─────────────────────────────────────────────────
   EMPTY STATES
───────────────────────────────────────────────── */

/* Leads empty state — with copy-to-clipboard enquiry link */
function buildLeadsEmptyState(tbody, colSpan) {
  const slug = config.business?.slug ?? '';
  const url = `https://indian-sme-engine.onrender.com/api/public/${slug}/leads`;

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
   LEADS — cache + search/filter
───────────────────────────────────────────────── */
let _allLeads = [];

function renderLeads(leads) {
  _allLeads = leads ?? [];
  _applyLeadFilters();
  syncLeadDerivedViews();
}

function syncLeadDerivedViews({ rerenderTable = false } = {}) {
  if (rerenderTable) _applyLeadFilters();
  ui?.renderDonutChart(_allLeads);
  renderActionCenter();
  if (activeTab === 'overview') renderOverviewActivity(_allLeads);
  if (activeTab === 'automations') renderAutomations(_allLeads);
}

function _sortLeads(rows) {
  if (!_leadsSort.col) return rows;
  const { col, dir } = _leadsSort;
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (col === 'priority') {
      return mul * ((LEAD_PRIORITY_ORDER[a.priority] ?? 0) - (LEAD_PRIORITY_ORDER[b.priority] ?? 0));
    }
    if (col === 'score') {
      return mul * ((a.priorityScore ?? a.score ?? 0) - (b.priorityScore ?? b.score ?? 0));
    }
    if (col === 'createdAt') {
      return mul * (new Date(a.createdAt) - new Date(b.createdAt));
    }
    const av = (a[col] ?? '').toString().toLowerCase();
    const bv = (b[col] ?? '').toString().toLowerCase();
    return mul * av.localeCompare(bv);
  });
}

function _updateLeadSortIndicators() {
  const thead = $('leads-thead');
  if (!thead) return;
  thead.querySelectorAll('[data-sort]').forEach((th) => {
    th.classList.remove('th-sorted--asc', 'th-sorted--desc');
    const ind = th.querySelector('.sort-ind');
    if (ind) ind.textContent = '';
    if (th.dataset.sort === _leadsSort.col) {
      th.classList.add(`th-sorted--${_leadsSort.dir}`);
      if (ind) ind.textContent = _leadsSort.dir === 'asc' ? '↑' : '↓';
    }
  });
}

function _wireLeadSortHeaders() {
  const thead = $('leads-thead');
  if (!thead) return;
  thead.querySelectorAll('th').forEach((th, i) => {
    const field = LEAD_SORT_FIELDS[i];
    if (!field) return;
    th.dataset.sort = field;
    th.style.cursor = 'pointer';
    th.title = `Sort by ${th.textContent.trim()}`;
    /* Append sort indicator span */
    const ind = document.createElement('span');
    ind.className = 'sort-ind';
    th.appendChild(ind);
    th.addEventListener('click', () => {
      if (_leadsSort.col === field) {
        _leadsSort.dir = _leadsSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        _leadsSort.col = field;
        _leadsSort.dir = 'asc';
      }
      _updateLeadSortIndicators();
      _applyLeadFilters();
    });
  });
}

function _applyLeadFilters() {
  const search = ($('leads-search')?.value ?? '').toLowerCase().trim();
  const status = $('leads-status-filter')?.value ?? '';
  const priority = $('leads-priority-filter')?.value ?? '';

  const filtered = _allLeads.filter((l) => {
    const matchSearch = !search || (l.name?.toLowerCase().includes(search) || l.phone?.includes(search));
    const matchStatus = !status || l.status === status;
    const matchPriority = !priority || l.priority === priority;
    return matchSearch && matchStatus && matchPriority;
  });

  _renderFilteredLeads(_sortLeads(filtered));
}

function _renderFilteredLeads(leads) {
  const tbody = $('leads-tbody');
  const colSpan = (config.tableColumns.leads?.length ?? 5) + 1;
  tbody.innerHTML = '';

  if (!leads.length) {
    if (!_allLeads.length) {
      buildLeadsEmptyState(tbody, colSpan);
    } else {
      tbody.innerHTML = `
        <tr class="empty-row">
          <td colspan="${colSpan}" class="empty">
            <div class="empty-state">
              <p class="empty-state__icon">🔍</p>
              <p class="empty-state__title">No leads match your filters</p>
              <p class="empty-state__sub">Try adjusting the search or filter</p>
            </div>
          </td>
        </tr>`;
    }
    return;
  }

  leads.forEach((l) => {
    const row = ui.buildLeadRow(l);
    wireLeadRow(row);
    tbody.appendChild(row);
  });
}

/* Wire search/filter inputs */
(function initLeadToolbar() {
  $('leads-search')?.addEventListener('input', _applyLeadFilters);
  $('leads-status-filter')?.addEventListener('change', _applyLeadFilters);
  $('leads-priority-filter')?.addEventListener('change', _applyLeadFilters);
}());

/* "/" key focuses the search bar */
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
    e.preventDefault();
    const searchEl = $('leads-search');
    if (searchEl) {
      searchEl.focus();
      searchEl.select();
    }
  }
});

/* ⌘K / Ctrl+K → switch to Leads and focus search */
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    switchTab('leads');
    setTimeout(() => {
      const searchEl = $('leads-search');
      if (searchEl) { searchEl.focus(); searchEl.select(); }
    }, 50);
  }
});

/* Topbar search button — same as ⌘K */
$('topbar-search-btn')?.addEventListener('click', () => {
  switchTab('leads');
  setTimeout(() => {
    const searchEl = $('leads-search');
    if (searchEl) { searchEl.focus(); searchEl.select(); }
  }, 50);
});

/* Entire lead row → drawer (except status select / action buttons) */
$('leads-tbody').addEventListener('click', (e) => {
  if (e.target.closest('.status-select, .btn-delete, .btn-timeline, .btn-edit, .lead-name-btn')) {
    /* Let the name button still work for drawer too */
    const btn = e.target.closest('.lead-name-btn');
    if (btn) openLeadDrawer(btn.dataset.leadId);
    return;
  }
  const row = e.target.closest('tr[data-lead-id]');
  if (row) openLeadDrawer(row.dataset.leadId);
});

function wireLeadRow(row) {
  const sel = row.querySelector('.status-select');
  const del = row.querySelector('.btn-delete');
  if (sel) sel.addEventListener('change', onLeadStatusChange);
  if (del) del.addEventListener('click', (e) =>
    ui.showDeleteModal(e.currentTarget.dataset.id, doDeleteLead, 'lead')
  );
}

async function onLeadStatusChange(e) {
  const select = e.target;
  const id = select.dataset.id;
  const newStatus = select.value;
  const oldClass = [...select.classList].find((c) => c.startsWith('status--'));
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

    /* Keep in-memory cache in sync and refresh all affected surfaces */
    const cached = _allLeads.find((l) => l.id === id);
    if (cached) cached.status = newStatus;
    syncLeadDerivedViews({ rerenderTable: activeTab === 'leads' });
  } catch (err) {
    console.error('[Dashboard] updateLeadStatus failed:', err);
    select.value = oldStatus || config.leadStatuses[0];
    ui.showToast(err.message || 'Could not update status', 'error');
  } finally {
    select.disabled = false;
  }
}

async function doDeleteLead(id) {
  const row = document.querySelector(`tr[data-lead-id="${id}"]`);
  const wasNew = row?.querySelector('.status-select')?.value === 'NEW';

  await ui.animateRowOut(row);

  try {
    await api.deleteLead(id);
    if (row) row.remove();

    _allLeads = _allLeads.filter((lead) => lead.id !== id);
    syncLeadDerivedViews({ rerenderTable: activeTab === 'leads' });

    /* Show leads-specific empty state if now empty */
    const tbody = $('leads-tbody');
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
  const tbody = $('appt-tbody');
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
  const select = e.target;
  const id = select.dataset.id;
  const newStatus = select.value;
  const oldClass = [...select.classList].find((c) => c.startsWith('status--'));
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
  const row = document.querySelector(`tr[data-appt-id="${id}"]`);
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
    { name: 'customerName', label: 'Customer Name', type: 'text', required: true },
    { name: 'phone', label: 'Phone', type: 'tel', required: true },
    { name: 'scheduledAt', label: 'Date & Time', type: 'datetime-local', required: true },
    { name: 'notes', label: 'Notes', type: 'text', required: false },
  ], async (data) => {
    try {
      if (data.scheduledAt) data.scheduledAt = new Date(data.scheduledAt).toISOString();
      const appt = await api.createAppt(data);
      const row = ui.buildApptRow(appt);
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
  const tbody = $('services-tbody');
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
  const ed = row.querySelector('.btn-edit');
  const del = row.querySelector('.btn-delete');
  if (ed) ed.addEventListener('click', () => onEditService(svc));
  if (del) del.addEventListener('click', (e) =>
    ui.showDeleteModal(e.currentTarget.dataset.id, doDeleteService, 'service')
  );
}

const SERVICE_FIELDS = [
  { name: 'title', label: 'Title', type: 'text', required: true },
  { name: 'description', label: 'Description', type: 'textarea', required: false },
  { name: 'priceInr', label: 'Price (₹)', type: 'number', required: false, min: 0 },
];

function onEditService(svc) {
  ui.showFormModal('Edit Service', SERVICE_FIELDS, async (data) => {
    try {
      const updated = await api.updateService(svc.id, data);
      const merged = { ...svc, ...updated };
      const oldRow = document.querySelector(`tr[data-service-id="${svc.id}"]`);
      const newRow = ui.buildServiceRow(merged);
      wireServiceRow(newRow, merged);
      if (oldRow) oldRow.parentNode.replaceChild(newRow, oldRow);
      ui.showToast('Service updated', 'success');
    } catch (err) {
      console.error('[Dashboard] updateService failed:', err);
      throw err;
    }
  }, {
    title: svc.title,
    description: svc.description ?? '',
    priceInr: svc.priceInr ?? '',
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
  const tbody = $('testimonials-tbody');
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
    { name: 'customerName', label: 'Customer Name', type: 'text', required: true },
    { name: 'text', label: 'Testimonial', type: 'textarea', required: true },
    { name: 'rating', label: 'Rating (1–5)', type: 'number', required: false, min: 1, max: 5 },
  ], async (data) => {
    try {
      const t = await api.createTestimonial(data);
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
   SHARED ACTIVITY HELPERS
───────────────────────────────────────────────── */

function _buildActivityEvents(leads) {
  const events = [];
  leads.forEach((lead) => {
    events.push({ type: 'LEAD_CREATED', lead, time: lead.createdAt });
    if (lead.tags?.length)
      events.push({ type: 'AGENT_CLASSIFIED', lead, time: lead.createdAt, tags: lead.tags });
    if (lead.priorityScore != null)
      events.push({ type: 'AGENT_PRIORITIZED', lead, time: lead.createdAt, score: lead.priorityScore });
  });
  events.sort((a, b) => new Date(b.time) - new Date(a.time));
  return events;
}

function _renderActivityInto(containerId, events, limit) {
  const feed = $(containerId);
  if (!feed) return;

  if (!events.length) {
    feed.innerHTML = '<p class="auto-empty">No activity yet.</p>';
    return;
  }

  feed.innerHTML = events.slice(0, limit).map((ev) => {
    const cfg = AUTO_EVENT_CFG[ev.type];
    let detail = _escDrawer(ev.lead.name ?? 'Unknown');
    if (ev.type === 'AGENT_CLASSIFIED') detail += ` — ${_escDrawer(ev.tags.join(', '))}`;
    if (ev.type === 'AGENT_PRIORITIZED') detail += ` — Score: ${_escDrawer(ev.score)}`;

    return `
      <div class="auto-event">
        <span class="auto-event__icon">${cfg.icon}</span>
        <div class="auto-event__body">
          <span class="auto-event__label">${cfg.label}</span>
          <span class="auto-event__detail">${detail}</span>
        </div>
        <span class="auto-event__time">${_fmtDrawerTime(ev.time)}</span>
      </div>`;
  }).join('');
}

function renderOverviewActivity(leads) {
  _renderActivityInto('overview-activity', _buildActivityEvents(leads), 10);
}

/* ─────────────────────────────────────────────────
   AUTOMATIONS FEED — synthetic events from lead data
───────────────────────────────────────────────── */
const AUTO_EVENT_CFG = {
  LEAD_CREATED: { icon: '📋', label: 'New enquiry received' },
  AGENT_CLASSIFIED: { icon: '🏷️', label: 'Lead classified' },
  AGENT_PRIORITIZED: { icon: '⚡', label: 'Priority scored' },
};

function renderAutomations(leads) {
  _renderActivityInto('automations-feed', _buildActivityEvents(leads), 50);
}

/* ─────────────────────────────────────────────────
   REALTIME WEBSOCKET
───────────────────────────────────────────────── */
function startRealtime(token) {
  wsClient = connectRealtime(token, {
    'lead:new': onNewLead,
    'lead:deleted': onRemoteLeadDeleted,
    'lead:status_changed': onRemoteLeadStatusChange,
  });
}

function onNewLead(lead) {
  const existing = _allLeads.find((item) => item.id === lead.id);
  if (existing) {
    Object.assign(existing, lead);
  } else {
    _allLeads.unshift(lead);
    ui.updateStat('totalLeads', ui.getStat('totalLeads') + 1);
    if (lead.status === config.leadStatuses[0])
      ui.updateStat('newLeads', ui.getStat('newLeads') + 1);
  }

  const name = lead.name ? `: ${lead.name}` : '';
  const toastMsg = lead.priority === 'HIGH'
    ? `🔥 New High Priority Lead${name}`
    : lead.priority === 'NORMAL'
      ? `⭐ New Lead${name}`
      : (config.notifText?.newLead ?? `New lead${name}`);

  ui.showToast(toastMsg, lead.priority === 'HIGH' ? 'success' : 'info');

  syncLeadDerivedViews({ rerenderTable: activeTab === 'leads' });
}

function onRemoteLeadStatusChange({ id, status }) {
  const select = document.querySelector(`.status-select[data-id="${id}"]`);

  if (select) {
    const oldClass = [...select.classList].find((c) => c.startsWith('status--'));
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

  /* Keep cache in sync and refresh all affected surfaces */
  const cached = _allLeads.find((l) => l.id === id);
  if (cached) cached.status = status;
  syncLeadDerivedViews({ rerenderTable: activeTab === 'leads' });
}

function onRemoteLeadDeleted({ id }) {
  const deleted = _allLeads.find((lead) => lead.id === id);
  if (!deleted) return;
  const wasNew = deleted?.status === 'NEW';
  const row = document.querySelector(`tr[data-lead-id="${id}"]`);

  _allLeads = _allLeads.filter((lead) => lead.id !== id);
  if (row) row.remove();

  const tbody = $('leads-tbody');
  const colSpan = (config.tableColumns.leads?.length ?? 5) + 1;
  if (tbody && !tbody.querySelector('tr:not(.empty-row)')) {
    buildLeadsEmptyState(tbody, colSpan);
  }

  ui.updateStat('totalLeads', Math.max(0, ui.getStat('totalLeads') - 1));
  if (wasNew) ui.updateStat('newLeads', Math.max(0, ui.getStat('newLeads') - 1));
  syncLeadDerivedViews({ rerenderTable: activeTab === 'leads' });
}

/* ─────────────────────────────────────────────────
   LEAD DRAWER
───────────────────────────────────────────────── */
const DRAWER_ACTIVITY_MAP = {
  LEAD_CREATED: { label: 'Lead created', icon: '📋', dot: 'dtl-dot--created' },
  AGENT_CLASSIFIED: { label: 'Lead classified', icon: '🏷️', dot: 'dtl-dot--classified' },
  AGENT_PRIORITIZED: { label: 'Priority score set', icon: '⚡', dot: 'dtl-dot--prioritized' },
  FOLLOW_UP_SCHEDULED: { label: 'Follow-up scheduled', icon: '📅', dot: 'dtl-dot--followup' },
  STATUS_CHANGED: { label: 'Status updated', icon: '🔄', dot: 'dtl-dot--default' },
  AUTOMATION_DEMO_INTENT: { label: 'Demo interest detected', icon: '🎓', dot: 'dtl-dot--automation' },
  AUTOMATION_ADMISSION_INTENT: { label: 'Admission interest detected', icon: '📘', dot: 'dtl-dot--automation' },
};

function _escDrawer(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _fmtDrawerTime(iso) {
  try {
    return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch { return iso; }
}

function _titleCaseDrawer(value) {
  return String(value ?? '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function _formatDrawerFieldLabel(key) {
  const labels = {
    studentClass: 'Student Class',
    requestedTopic: 'Requested Topic',
    preferredCallTime: 'Preferred Call Time',
    recentMarks: 'Recent Marks',
  };
  return labels[key] || _titleCaseDrawer(key);
}

function _resolveDrawerActivityPresentation(act) {
  const meta = act.metadata || {};

  if (act.type === 'AUTOMATION_ALERT') {
    if (meta.channel === 'whatsapp' && meta.direction === 'inbound') {
      return {
        label: 'Customer message received',
        icon: '💬',
        dot: 'dtl-dot--whatsapp-in',
        message: meta.messageText || act.message || '',
      };
    }

    if (meta.channel === 'whatsapp' && meta.direction === 'outbound') {
      const isHandoff = String(meta.replyIntent || '').includes('HANDOFF');
      return {
        label: isHandoff ? 'Counsellor handoff reply sent' : 'WhatsApp reply sent',
        icon: isHandoff ? '🤝' : '📲',
        dot: 'dtl-dot--whatsapp-out',
        message: meta.replyMessage || meta.messageText || act.message || '',
      };
    }

    if (meta.reason === 'HIGH_PRIORITY_LEAD') {
      return {
        label: 'High-priority lead flagged',
        icon: '🚨',
        dot: 'dtl-dot--prioritized',
        message: `This lead was flagged for quick follow-up with score ${_escDrawer(meta.score ?? '—')}.`,
      };
    }
  }

  const cfg = DRAWER_ACTIVITY_MAP[act.type] ?? {
    label: _titleCaseDrawer(act.type),
    icon: '●',
    dot: 'dtl-dot--default',
  };

  return {
    ...cfg,
    message: act.message || '',
  };
}

function _buildWhatsAppSummaryHtml(summary) {
  if (!summary) return '';

  const fields = Object.entries(summary.capturedFields || {})
    .filter(([, value]) => value)
    .map(([key, value]) => `
      <div class="wa-summary__field">
        <span class="wa-summary__field-label">${_escDrawer(_formatDrawerFieldLabel(key))}</span>
        <strong class="wa-summary__field-value">${_escDrawer(value)}</strong>
      </div>`)
    .join('');

  const transcript = Array.isArray(summary.transcript) ? summary.transcript : [];
  const transcriptHtml = transcript.length
    ? `
      <div class="wa-transcript">
        <div class="wa-transcript__header">
          <span class="wa-transcript__title">WhatsApp Conversation</span>
          <span class="wa-transcript__count">${transcript.length} turns</span>
        </div>
        <div class="wa-transcript__list">
          ${transcript.map((turn) => `
            <div class="wa-turn wa-turn--${_escDrawer(turn.direction)}">
              <div class="wa-turn__meta">
                <span class="wa-turn__speaker">${_escDrawer(turn.speaker)}</span>
                <span class="wa-turn__time">${_escDrawer(_fmtDrawerTime(turn.createdAt))}</span>
              </div>
              <div class="wa-turn__bubble">${_escDrawer(turn.text)}</div>
            </div>`).join('')}
        </div>
      </div>`
    : '';

  return `
    <div class="wa-summary">
      <div class="wa-summary__header">
        <div>
          <div class="wa-summary__eyebrow">WhatsApp handoff</div>
          <div class="wa-summary__intent">${_escDrawer(summary.primaryIntentLabel || 'WhatsApp lead')}</div>
        </div>
        <span class="wa-summary__status wa-summary__status--${_escDrawer(summary.conversationStatus || 'captured')}">
          ${_escDrawer(summary.conversationStatusLabel || 'Conversation captured')}
        </span>
      </div>

      ${fields ? `<div class="wa-summary__fields">${fields}</div>` : '<div class="wa-summary__empty">No captured fields yet. Use the transcript below for context.</div>'}

      <div class="wa-summary__next">
        <span class="wa-summary__next-label">Recommended next action</span>
        <p class="wa-summary__next-text">${_escDrawer(summary.recommendedNextAction || 'Review the WhatsApp conversation and continue manually.')}</p>
      </div>
    </div>
    ${transcriptHtml}`;
}

async function openLeadDrawer(leadId) {
  const drawer = $('lead-drawer');
  if (!drawer) return;

  /* Populate header from cached lead while we fetch */
  const cached = _allLeads.find((l) => l.id === leadId);
  $('drawer-name').textContent = cached?.name ?? '—';
  $('drawer-phone').textContent = cached?.phone ?? '';
  if (cached) {
    $('drawer-meta').innerHTML = `
      <span class="drawer__meta-badge">Status: <strong>${_escDrawer(cached.status)}</strong></span>
      <span class="drawer__meta-badge">Priority: <strong>${_escDrawer(cached.priority ?? 'LOW')}</strong></span>
      <span class="drawer__meta-badge">Score: <strong>${_escDrawer(cached.priorityScore ?? 0)}</strong></span>`;
  }

  /* Reset to Activity tab */
  document.querySelectorAll('.drawer__tab').forEach((t) =>
    t.classList.toggle('is-active', t.dataset.drawerTab === 'activity')
  );
  $('drawer-pane-activity').classList.remove('drawer__pane--hidden');
  $('drawer-pane-overview').classList.add('drawer__pane--hidden');
  $('drawer-pane-suggestions').classList.add('drawer__pane--hidden');
  $('drawer-pane-outreach').classList.add('drawer__pane--hidden');

  /* Open */
  drawer.classList.add('is-open');
  document.body.style.overflow = 'hidden';

  /* Show spinners while fetching both data sources in parallel */
  $('drawer-timeline').innerHTML = `
    <div class="drawer-loading">
      <div class="drawer-loading__spinner"></div>
      Loading timeline…
    </div>`;
  $('drawer-suggestions').innerHTML = `
    <div class="drawer-loading">
      <div class="drawer-loading__spinner"></div>
      Analysing lead…
    </div>`;
  $('drawer-outreach').innerHTML = `
    <div class="drawer-loading">
      <div class="drawer-loading__spinner"></div>
      Drafting message…
    </div>`;

  const [actRes, sugRes, outRes] = await Promise.allSettled([
    api.getLeadActivity(leadId),
    api.getLeadSuggestions(leadId),
    api.getLeadOutreachDraft(leadId),
  ]);

  if (actRes.status === 'fulfilled') {
    _renderDrawerTimeline(actRes.value);
    _renderDrawerOverview(actRes.value?.lead ?? cached);
  } else {
    $('drawer-timeline').innerHTML =
      `<p class="drawer-error">Could not load timeline: ${_escDrawer(actRes.reason?.message)}</p>`;
  }

  if (sugRes.status === 'fulfilled') {
    _renderDrawerSuggestions(sugRes.value);
  } else {
    $('drawer-suggestions').innerHTML =
      `<p class="drawer-error">Could not load suggestions.</p>`;
  }

  if (outRes.status === 'fulfilled') {
    _renderDrawerOutreach(outRes.value);
  } else {
    $('drawer-outreach').innerHTML =
      `<p class="drawer-error">Could not load outreach draft.</p>`;
  }
}

function closeLeadDrawer() {
  const drawer = $('lead-drawer');
  if (!drawer) return;
  drawer.classList.remove('is-open');
  document.body.style.overflow = '';
}

function _renderDrawerTimeline(data) {
  if (!data) {
    $('drawer-timeline').innerHTML = '<p class="drawer-error">Lead not found.</p>';
    return;
  }

  const { lead, activities, whatsappConversation } = data;

  /* Update header with authoritative data */
  $('drawer-name').textContent = lead?.name ?? '—';
  $('drawer-phone').textContent = lead?.phone ?? '';

  const prioritized = activities.find((activity) => activity.type === 'AGENT_PRIORITIZED');
  const priorityScore = prioritized?.metadata?.priorityScore ?? 0;
  const priorityLabel = priorityScore >= 30 ? 'HIGH' : priorityScore >= 10 ? 'NORMAL' : 'LOW';
  const headerBadges = [
    `<span class="drawer__meta-badge">Status: <strong>${_escDrawer(lead?.status ?? 'NEW')}</strong></span>`,
    `<span class="drawer__meta-badge">Priority: <strong>${_escDrawer(priorityLabel)}</strong></span>`,
    `<span class="drawer__meta-badge">Score: <strong>${_escDrawer(priorityScore)}</strong></span>`,
  ];
  if (whatsappConversation) {
    headerBadges.push('<span class="drawer__meta-badge">Channel: <strong>WhatsApp</strong></span>');
  }
  $('drawer-meta').innerHTML = headerBadges.join('');

  if (!activities.length) {
    $('drawer-timeline').innerHTML = `
      ${_buildWhatsAppSummaryHtml(whatsappConversation)}
      <div class="drawer-empty">📭<br>No activity recorded yet.</div>`;
    return;
  }

  const sorted = [...activities].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  const html = sorted.map((act, i) => {
    const cfg = _resolveDrawerActivityPresentation(act);
    const meta = act.metadata;

    let metaHtml = '';
    if (act.type === 'AGENT_CLASSIFIED' && Array.isArray(meta?.tags) && meta.tags.length) {
      metaHtml = `<div class="dtl-pills">${meta.tags.map((t) => `<span class="dtl-pill">${_escDrawer(t)}</span>`).join('')}</div>`;
    } else if (act.type === 'AGENT_PRIORITIZED') {
      const score = meta?.priorityScore ?? meta?.score;
      if (score != null) metaHtml = `<div class="dtl-pills"><span class="dtl-pill">Score: ${_escDrawer(score)}</span></div>`;
    } else if (meta?.channel === 'whatsapp' && meta?.direction === 'outbound' && meta?.conversationState?.status) {
      metaHtml = `<div class="dtl-pills"><span class="dtl-pill">${_escDrawer(_titleCaseDrawer(meta.conversationState.status))}</span></div>`;
    }

    return `
      <div class="dtl-item" style="--i:${i}">
        <div class="dtl-dot ${_escDrawer(cfg.dot)}">${cfg.icon}</div>
        <div class="dtl-content">
          <div class="dtl-title">${_escDrawer(cfg.label)}</div>
          <div class="dtl-time">${_escDrawer(_fmtDrawerTime(act.createdAt))}</div>
          ${cfg.message ? `<div class="dtl-msg">${_escDrawer(cfg.message)}</div>` : ''}
          ${metaHtml}
        </div>
      </div>`;
  }).join('');

  $('drawer-timeline').innerHTML = `
    ${_buildWhatsAppSummaryHtml(whatsappConversation)}
    <div class="drawer-timeline">${html}</div>`;
}

function _renderDrawerOverview(lead) {
  if (!lead) { $('drawer-overview-content').innerHTML = ''; return; }
  const esc = _escDrawer;
  $('drawer-overview-content').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:0.75rem;font-size:0.875rem;">
      <div><span style="color:var(--text-2);font-weight:500;">Name</span><br><strong>${esc(lead.name ?? '—')}</strong></div>
      <div><span style="color:var(--text-2);font-weight:500;">Phone</span><br><strong>${esc(lead.phone ?? '—')}</strong></div>
      ${lead.email ? `<div><span style="color:var(--text-2);font-weight:500;">Email</span><br><strong>${esc(lead.email)}</strong></div>` : ''}
    </div>
    ${lead.message ? `
    <div style="margin-top:1.5rem;padding-top:1.25rem;border-top:1px solid var(--border);">
      <span style="color:var(--text-2);font-weight:500;display:block;margin-bottom:0.4rem;">Original Message</span>
      <div style="background:var(--bg-2);padding:1rem;border-radius:0.4rem;font-size:0.95rem;line-height:1.5;color:var(--text);white-space:pre-wrap;">${esc(lead.message)}</div>
    </div>` : ''}
  `;
}

const NBA_ICONS = {
  CALL_NOW: '⚡',
  SEND_DEMO_LINK: '🔗',
  FOLLOW_UP: '📩',
  SEND_ADMISSION_DETAILS: '📋',
};

function _renderDrawerSuggestions(suggestions) {
  const el = $('drawer-suggestions');
  if (!el) return;

  if (!Array.isArray(suggestions) || !suggestions.length) {
    el.innerHTML = `
      <div class="drawer-empty">
        ✓<br>No recommendation yet.<br>Continue monitoring this lead.
      </div>`;
    return;
  }

  el.innerHTML = suggestions.map((s, i) => {
    const pct = Math.round((s.confidence ?? 0) * 100);
    const icon = NBA_ICONS[s.action] ?? '💡';
    return `
      <div class="nba-card" style="--i:${i}">
        <div class="nba-card__header">
          <span class="nba-card__icon">${icon}</span>
          <span class="nba-card__label">${_escDrawer(s.label)}</span>
        </div>
        <p class="nba-card__reason">${_escDrawer(s.reason)}</p>
        <div class="nba-card__conf">
          <div class="nba-card__conf-track">
            <div class="nba-card__conf-fill" style="width:${pct}%"></div>
          </div>
          <span class="nba-card__conf-pct">${pct}% confidence</span>
        </div>
      </div>`;
  }).join('');
}

const OUTREACH_TYPE_LABELS = {
  DEMO_REPLY: 'Demo enquiry reply',
  ADMISSION_REPLY: 'Admission enquiry reply',
  URGENT_REPLY: 'Urgent reply',
  FOLLOW_UP: 'Follow-up',
  GENERAL_REPLY: 'General reply',
};

function _renderDrawerOutreach(draft) {
  const el = $('drawer-outreach');
  if (!el) return;

  if (!draft || !draft.message) {
    el.innerHTML = `<div class="drawer-empty">✉<br>No suggested message yet.</div>`;
    return;
  }

  const pct = Math.round((draft.confidence ?? 0) * 100);
  const label = OUTREACH_TYPE_LABELS[draft.type] ?? draft.type;
  const id = 'outreach-textarea';

  el.innerHTML = `
    <div class="outreach-card">
      <div class="outreach-card__header">
        <span class="outreach-card__type">${_escDrawer(label)}</span>
        <div class="outreach-card__conf">
          <div class="outreach-card__conf-track">
            <div class="outreach-card__conf-fill" style="width:${pct}%"></div>
          </div>
          <span class="outreach-card__conf-pct">${pct}%</span>
        </div>
      </div>
      <textarea id="${id}" class="outreach-card__textarea" readonly>${_escDrawer(draft.message)}</textarea>
      <div class="outreach-card__actions">
        <button class="outreach-card__btn outreach-card__btn--copy" id="outreach-copy-btn">Copy Message</button>
        <button class="outreach-card__btn outreach-card__btn--edit" id="outreach-edit-btn">Edit Message</button>
      </div>
    </div>`;

  $('outreach-copy-btn').addEventListener('click', () => {
    const text = document.getElementById(id).value;
    navigator.clipboard.writeText(text).then(() => {
      const btn = $('outreach-copy-btn');
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    });
  });

  $('outreach-edit-btn').addEventListener('click', () => {
    const ta = document.getElementById(id);
    const btn = $('outreach-edit-btn');
    const editing = ta.readOnly;
    ta.readOnly = !editing;
    btn.textContent = editing ? 'Lock Message' : 'Edit Message';
    if (editing) ta.focus();
  });
}

/* Drawer controls */
$('drawer-close')?.addEventListener('click', closeLeadDrawer);
$('drawer-overlay')?.addEventListener('click', closeLeadDrawer);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('lead-drawer')?.classList.contains('is-open')) closeLeadDrawer();
});

/* Drawer tabs */
document.querySelectorAll('.drawer__tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.drawerTab;
    document.querySelectorAll('.drawer__tab').forEach((t) =>
      t.classList.toggle('is-active', t.dataset.drawerTab === target)
    );
    $('drawer-pane-activity').classList.toggle('drawer__pane--hidden', target !== 'activity');
    $('drawer-pane-overview').classList.toggle('drawer__pane--hidden', target !== 'overview');
    $('drawer-pane-suggestions').classList.toggle('drawer__pane--hidden', target !== 'suggestions');
    $('drawer-pane-outreach').classList.toggle('drawer__pane--hidden', target !== 'outreach');
  });
});

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
