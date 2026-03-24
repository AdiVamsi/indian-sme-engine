/**
 * dashboard.js — Pure orchestration.
 *
 * Imports DashAPI, DashUI, and connectRealtime from their modules.
 * Owns auth state, session expiry, tab routing, and realtime wiring.
 * Zero raw DOM manipulation (delegated to ui).
 * Zero fetch() calls (delegated to api).
 */

import { DashAPI } from './api.js';
import { getCallbackCue } from './callbacks.js';
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
let dashboardReconcileTimer = null;
let dashboardReconcileInFlight = false;
let _leadsSort = { col: null, dir: 'asc' };
let _actionQueue = [];
let _actionQueueRequestSeq = 0;
let _actionQueueFilter = 'all';
let activeDrawerLeadId = null;
let activeDrawerData = null;
let activeDrawerActionBusy = false;
let activeDrawerActionPending = null;
let activeDrawerSelectedAction = null;
let activeDrawerDraft = { callbackTime: '', note: '', standaloneNote: '' };

/* Maps tableColumns.leads index → sortable field (null = unsortable) */
const LEAD_SORT_FIELDS = ['name', null, null, 'status', 'priority', 'score', 'createdAt'];
const LEAD_PRIORITY_ORDER = { HIGH: 3, NORMAL: 2, LOW: 1 };
const DASHBOARD_RECONCILE_INTERVAL_MS = 10_000;

const $ = (id) => document.getElementById(id);

const ALL_SECTIONS = ['overview', 'queue', 'leads', 'automations', 'appointments', 'services', 'testimonials', 'settings'];
const ACTION_QUEUE_FILTERS = [
  {
    id: 'all',
    label: 'All',
    match: () => true,
    emptyState: {
      icon: '✅',
      title: 'Queue is clear',
      sub: 'New leads, overdue follow-ups, and AI review cases will show up here.',
    },
  },
  {
    id: 'high_priority',
    label: 'High Priority',
    match: (item) => String(item?.priority || '').toUpperCase() === 'HIGH',
    emptyState: {
      icon: '🔥',
      title: 'No high-priority leads',
      sub: 'Urgent leads will show up here when the queue needs fast follow-up.',
    },
  },
  {
    id: 'overdue_follow_up',
    label: 'Overdue Follow-up',
    match: (item) => Boolean(item?.isOverdue) || _getQueueReasonCodes(item).has('FOLLOW_UP_OVERDUE'),
    emptyState: {
      icon: '⏰',
      title: 'No overdue follow-ups',
      sub: 'Missed follow-up deadlines will show up here when a human touch is overdue.',
    },
  },
  {
    id: 'whatsapp_response',
    label: 'WhatsApp Response Needed',
    match: (item) => _getQueueReasonCodes(item).has('WHATSAPP_RESPONSE_REQUIRED'),
    emptyState: {
      icon: '💬',
      title: 'No WhatsApp responses pending',
      sub: 'WhatsApp handoffs and delivery-failure cases will show up here.',
    },
  },
  {
    id: 'classification_review',
    label: 'Classification Review',
    match: (item) => _getQueueReasonCodes(item).has('LOW_CONFIDENCE_REVIEW'),
    emptyState: {
      icon: '🔎',
      title: 'No classification reviews pending',
      sub: 'Weak-confidence or fallback AI classifications will show up here.',
    },
  },
];

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
  clearInterval(dashboardReconcileTimer);
  localStorage.removeItem('dash_token');

  api = null;
  ui = null;
  config = null;
  wsClient = null;
  expiryTimer = null;
  dashboardReconcileTimer = null;
  dashboardReconcileInFlight = false;
  activeTab = 'overview';
  loadedSections.clear();
  _allLeads = [];
  _actionQueue = [];
  _actionQueueRequestSeq = 0;
  _actionQueueFilter = 'all';

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

  const queueSummaryEl = $('ac-body');
  if (queueSummaryEl) queueSummaryEl.innerHTML = '';

  const queueListEl = $('queue-list');
  if (queueListEl) queueListEl.innerHTML = '';

  const queueBadgeEl = $('queue-badge');
  if (queueBadgeEl) queueBadgeEl.textContent = '';

  const queueFiltersEl = $('queue-filters');
  if (queueFiltersEl) queueFiltersEl.innerHTML = '';

  const acBadgeEl = $('ac-badge');
  if (acBadgeEl) acBadgeEl.textContent = '';

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
      startDashboardReconcileLoop();
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
   ACTION QUEUE — backend-powered operator queue
─────────────────────────────────────────────────── */
function _fmtAge(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function _queueEsc(value) {
  if (ui?.esc) return ui.esc(value);
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _getQueueReasonCodes(item) {
  return new Set(
    (Array.isArray(item?.queueReasons) ? item.queueReasons : [])
      .map((reason) => reason?.code)
      .filter(Boolean)
  );
}

function _getActionQueueFilter(filterId = _actionQueueFilter) {
  return ACTION_QUEUE_FILTERS.find((filter) => filter.id === filterId) || ACTION_QUEUE_FILTERS[0];
}

function _getFilteredActionQueueItems() {
  const filter = _getActionQueueFilter();
  return _actionQueue.filter((item) => filter.match(item));
}

function _buildQueuePriorityBadge(priority) {
  const normalized = String(priority || 'LOW').toUpperCase();
  const cls = normalized === 'HIGH' ? 'badge--hot'
    : normalized === 'NORMAL' ? 'badge--warm'
      : 'badge--normal';
  return `<span class="priority-badge ${cls}">${_queueEsc(normalized)}</span>`;
}

function _buildQueueSourceBadge(source) {
  const normalized = String(source || 'web').toLowerCase();
  const label = normalized === 'whatsapp'
    ? 'WhatsApp'
    : normalized === 'web'
      ? 'Website Form'
      : normalized.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());

  return `<span class="lead-source-badge lead-source-badge--${_queueEsc(normalized)}">${_queueEsc(label)}</span>`;
}

function _buildQueueDueState(item) {
  if (!item?.dueAt) return '';

  const dueAtTime = new Date(item.dueAt).getTime();
  const isDueSoon = (
    Number.isFinite(dueAtTime)
    && dueAtTime > Date.now()
    && dueAtTime <= Date.now() + 30 * 60 * 1000
  );
  const tone = item.isOverdue ? 'overdue' : isDueSoon ? 'due-soon' : 'scheduled';
  const label = item.isOverdue ? 'Overdue' : isDueSoon ? 'Due soon' : 'Scheduled';
  return `<span class="callback-status-badge callback-status-badge--${tone}">${_queueEsc(label)}</span>`;
}

function _canQueueLeadBeMarkedContacted(item) {
  return String(item?.status || '').toUpperCase() === 'NEW';
}

function _getQueueLeadById(leadId) {
  return _actionQueue.find((item) => item.leadId === leadId) || null;
}

function _formatQueueLabel(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function _getQueueTone(item) {
  const reasonCodes = _getQueueReasonCodes(item);
  if (item?.isOverdue) return 'critical';
  if (String(item?.priority || '').toUpperCase() === 'HIGH') return 'high';
  if (reasonCodes.has('WHATSAPP_RESPONSE_REQUIRED')) return 'whatsapp';
  if (reasonCodes.has('LOW_CONFIDENCE_REVIEW')) return 'review';
  return 'standard';
}

function _buildQueueMeta(item, { createdLabel, latestActivityLabel } = {}) {
  const metaParts = [];

  if (item?.phone) metaParts.push(`<span class="queue-item__meta-phone">${_queueEsc(item.phone)}</span>`);
  metaParts.push(`<span class="queue-item__meta-copy">Created ${_queueEsc(createdLabel)}</span>`);
  metaParts.push('<span class="queue-item__meta-sep" aria-hidden="true"></span>');
  metaParts.push(`<span class="queue-item__meta-copy">Latest ${_queueEsc(latestActivityLabel)}</span>`);

  return metaParts.join('');
}

function _buildQueueContext(item, tags = [], { compact = false } = {}) {
  const visibleTags = tags.slice(0, compact ? 2 : 2);
  const hiddenTagCount = tags.length - visibleTags.length;
  const confidenceLabel = String(item?.confidenceLabel || '').toLowerCase();

  return `
    <div class="queue-item__context">
      ${_buildQueueSourceBadge(item?.source)}
      ${item?.bestCategory ? `<span class="queue-item__facet">${_queueEsc(_formatQueueLabel(item.bestCategory))}</span>` : ''}
      ${confidenceLabel && confidenceLabel !== 'high' ? `<span class="queue-item__facet queue-item__facet--confidence">${_queueEsc(_formatQueueLabel(`${confidenceLabel} confidence`))}</span>` : ''}
      ${visibleTags.map((tag) => `<span class="tag-chip tag-chip--${_queueEsc(String(tag).toLowerCase().replace(/_/g, '-'))}">${_queueEsc(_formatQueueLabel(tag))}</span>`).join('')}
      ${hiddenTagCount > 0 ? `<span class="queue-item__facet queue-item__facet--count">+${hiddenTagCount}</span>` : ''}
    </div>`;
}

function _getQueueKicker(item, { featured = false } = {}) {
  const reasonCodes = _getQueueReasonCodes(item);

  if (featured) return 'Top of queue';
  if (item?.isOverdue || reasonCodes.has('FOLLOW_UP_OVERDUE')) return 'Callback overdue';
  if (String(item?.priority || '').toUpperCase() === 'HIGH') return 'Priority lead';
  if (reasonCodes.has('WHATSAPP_RESPONSE_REQUIRED')) return 'WhatsApp response';
  if (reasonCodes.has('LOW_CONFIDENCE_REVIEW')) return 'Review needed';
  return 'Needs attention';
}

function _buildQueueSnoozeControl(item, { compact = false } = {}) {
  if (compact) return '';

  return `
    <div class="queue-item__snooze-wrap">
      <span class="queue-item__action-label">Defer</span>
      <select
        class="queue-item__snooze"
        data-queue-snooze-select="${_queueEsc(item.leadId)}"
        aria-label="Snooze ${_queueEsc(item.leadName || 'lead')}"
      >
        <option value="">Choose</option>
        <option value="1">1 day</option>
        <option value="3">3 days</option>
        <option value="7">7 days</option>
      </select>
    </div>`;
}

function _buildQueueReasonPanel(reasons = [], { compact = false } = {}) {
  if (!reasons.length) return '';

  if (compact) {
    return `
      <div class="queue-item__reason-strip">
        ${reasons.slice(0, 2).map((reason) => `<span class="queue-reason">${_queueEsc(reason.label)}</span>`).join('')}
      </div>`;
  }

  return `
    <section class="queue-item__panel queue-item__panel--reasons">
      <span class="queue-item__panel-label">Why now</span>
      <div class="queue-item__reasons">
        ${reasons.map((reason) => `
          <div class="queue-reason-row">
            <span class="queue-reason">${_queueEsc(reason.label)}</span>
            <p class="queue-reason-row__detail">${_queueEsc(reason.detail || '')}</p>
          </div>`).join('')}
      </div>
    </section>`;
}

function _buildQueueActions(item, { compact = false, canMarkContacted = false } = {}) {
  return `
    <div class="queue-item__actions">
      ${compact ? '' : `
        <div class="queue-item__actions-head">
          <span class="queue-item__actions-eyebrow">Operator controls</span>
          <p class="queue-item__actions-sub">Move this lead forward now or bring it back into the queue later.</p>
        </div>`}
      <button type="button" class="queue-item__open" data-queue-open="${_queueEsc(item.leadId)}">Open lead</button>
      <div class="queue-item__action-row">
        ${canMarkContacted ? `
          <button
            type="button"
            class="queue-item__mark"
            data-queue-mark-contacted="${_queueEsc(item.leadId)}"
          >${compact ? 'Contacted' : 'Mark contacted'}</button>` : ''}
        <a class="btn-timeline queue-item__timeline" href="/dashboard/lead-activity.html?leadId=${_queueEsc(item.leadId)}" title="View timeline">${compact ? 'Activity' : 'Timeline'}</a>
      </div>
      ${_buildQueueSnoozeControl(item, { compact })}
    </div>`;
}

function _buildQueueItemHtml(item, { compact = false, featured = false } = {}) {
  const tags = Array.isArray(item?.tags) ? item.tags : [];
  const reasons = Array.isArray(item?.queueReasons) ? item.queueReasons : [];
  const canMarkContacted = _canQueueLeadBeMarkedContacted(item);
  const tone = _getQueueTone(item);
  const kicker = _getQueueKicker(item, { featured });
  const dueAtLabel = item?.dueAt
    ? (ui?.fmtDate ? ui.fmtDate(item.dueAt) : new Date(item.dueAt).toLocaleString('en-IN'))
    : null;
  const createdLabel = item?.createdAt
    ? (ui?.fmtRelativeDate ? ui.fmtRelativeDate(item.createdAt) : _fmtAge(item.createdAt))
    : 'just now';
  const latestActivityLabel = item?.latestRelevantActivityAt
    ? (ui?.fmtRelativeDate ? ui.fmtRelativeDate(item.latestRelevantActivityAt) : _fmtAge(item.latestRelevantActivityAt))
    : createdLabel;

  if (compact) {
    return `
      <article class="queue-item queue-item--${tone} queue-item--compact" data-queue-item="${_queueEsc(item.leadId)}">
        <div class="queue-item__main">
          <div class="queue-item__header">
            <div class="queue-item__headline">
              <span class="queue-item__kicker">${_queueEsc(kicker)}</span>
              <button type="button" class="lead-name-btn queue-item__name" data-queue-open="${_queueEsc(item.leadId)}">${_queueEsc(item.leadName || 'Unknown lead')}</button>
              <div class="queue-item__meta">
                ${_buildQueueMeta(item, { createdLabel, latestActivityLabel })}
              </div>
            </div>
            <div class="queue-item__state">
              ${_buildQueueDueState(item)}
              ${_buildQueuePriorityBadge(item.priority)}
            </div>
          </div>

          ${_buildQueueContext(item, tags, { compact: true })}

          <p class="queue-item__message">${_queueEsc(item.messagePreview || 'No message provided.')}</p>

          ${_buildQueueReasonPanel(reasons, { compact: true })}
        </div>

        ${_buildQueueActions(item, { compact: true, canMarkContacted })}
      </article>`;
  }

  return `
    <article class="queue-item queue-item--${tone}${featured ? ' queue-item--featured' : ''}" data-queue-item="${_queueEsc(item.leadId)}">
      <div class="queue-item__main">
        <div class="queue-item__header">
          <div class="queue-item__headline">
            <div class="queue-item__kicker-row">
              <span class="queue-item__kicker">${_queueEsc(kicker)}</span>
              ${featured ? '<span class="queue-item__spotlight">Handle next</span>' : ''}
            </div>
            <button type="button" class="lead-name-btn queue-item__name" data-queue-open="${_queueEsc(item.leadId)}">${_queueEsc(item.leadName || 'Unknown lead')}</button>
            <div class="queue-item__meta">
              ${_buildQueueMeta(item, { createdLabel, latestActivityLabel })}
            </div>
          </div>
          <div class="queue-item__state">
            ${_buildQueueDueState(item)}
            ${_buildQueuePriorityBadge(item.priority)}
          </div>
        </div>

        ${_buildQueueContext(item, tags)}

        <div class="queue-item__summary">
          <span class="queue-item__summary-label">Lead message</span>
          <p class="queue-item__message">${_queueEsc(item.messagePreview || 'No message provided.')}</p>
        </div>

        <div class="queue-item__panels">
          ${_buildQueueReasonPanel(reasons)}

          <section class="queue-item__panel queue-item__panel--next">
            <span class="queue-item__panel-label">Next step</span>
            <p class="queue-item__next-text">${_queueEsc(item.suggestedNextAction || 'Review the lead and take the next operator step.')}</p>

            ${item.dueAt ? `
              <div class="queue-item__due">
                <span class="queue-item__due-label">${item.isOverdue ? 'Due since' : 'Due at'}</span>
                <span class="queue-item__due-value">${_queueEsc(dueAtLabel)}</span>
              </div>` : ''}
          </section>

          ${item.outreachDraftPreview ? `
            <section class="queue-item__panel queue-item__panel--draft">
              <span class="queue-item__panel-label">Reply draft</span>
              <p class="queue-item__draft-text">${_queueEsc(item.outreachDraftPreview)}</p>
            </section>` : ''}
        </div>
      </div>

      ${_buildQueueActions(item, { canMarkContacted })}
    </article>`;
}

function renderActionQueueSummary() {
  const body = $('ac-body');
  const badge = $('ac-badge');
  if (!body) return;

  const total = _actionQueue.length;

  if (badge) badge.textContent = total > 0 ? String(total) : '';

  if (total === 0) {
    body.innerHTML = `<p class="ac-empty">All caught up — no leads need attention right now.</p>`;
    return;
  }

  const previewItems = _actionQueue.slice(0, 4);
  const remaining = total - previewItems.length;

  body.innerHTML = `
    <div class="queue-list queue-list--summary">
      ${previewItems.map((item) => _buildQueueItemHtml(item, { compact: true })).join('')}
    </div>
    ${remaining > 0 ? `<p class="queue-list__overflow">+${remaining} more lead${remaining === 1 ? '' : 's'} in the full queue</p>` : ''}`;
}

function renderActionQueueFilters() {
  const row = $('queue-filters');
  if (!row) return;

  row.innerHTML = ACTION_QUEUE_FILTERS.map((filter) => `
    <button
      type="button"
      class="queue-filter${filter.id === _actionQueueFilter ? ' is-active' : ''}"
      data-queue-filter="${_queueEsc(filter.id)}"
      aria-pressed="${filter.id === _actionQueueFilter ? 'true' : 'false'}"
    >${_queueEsc(filter.label)}</button>`).join('');
}

function renderActionQueueSection() {
  const list = $('queue-list');
  const badge = $('queue-badge');
  if (!list) return;

  renderActionQueueFilters();

  const total = _actionQueue.length;
  const filteredItems = _getFilteredActionQueueItems();
  const visible = filteredItems.length;
  const activeFilter = _getActionQueueFilter();

  if (badge) {
    if (!total) {
      badge.textContent = '';
    } else if (activeFilter.id === 'all') {
      badge.textContent = `${total} item${total === 1 ? '' : 's'}`;
    } else {
      badge.textContent = `${visible} of ${total}`;
    }
  }

  if (!visible) {
    list.innerHTML = simpleEmptyState(
      activeFilter.emptyState.icon,
      activeFilter.emptyState.title,
      activeFilter.emptyState.sub
    );
    return;
  }

  list.innerHTML = filteredItems.map((item, index) => _buildQueueItemHtml(item, { featured: index === 0 })).join('');
}

function renderActionQueueSurfaces() {
  renderActionQueueSummary();
  renderActionQueueSection();
}

async function refreshActionQueue({ showToastOnError = false } = {}) {
  if (!api) return;

  const requestSeq = ++_actionQueueRequestSeq;

  try {
    const items = await api.getActionQueue();
    if (requestSeq !== _actionQueueRequestSeq) return true;
    _actionQueue = Array.isArray(items) ? items : [];
    renderActionQueueSurfaces();
    return true;
  } catch (err) {
    console.error('[Dashboard] action queue refresh failed:', err);
    if (requestSeq !== _actionQueueRequestSeq) return true;
    if (!_actionQueue.length) renderActionQueueSurfaces();
    if (showToastOnError) {
      ui?.showToast(err.message || 'Could not refresh the queue.', 'error');
    }
    return false;
  }
}

async function handleQueueMarkContacted(button) {
  if (!api || !button) return;

  const leadId = button.dataset.queueMarkContacted;
  const queueLead = _getQueueLeadById(leadId);
  const cachedLead = _allLeads.find((lead) => lead.id === leadId);
  const currentStatus = String(cachedLead?.status || queueLead?.status || '').toUpperCase();

  if (currentStatus !== 'NEW') {
    void refreshActionQueue();
    return;
  }

  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Saving…';

  try {
    await api.updateLeadStatus(leadId, 'CONTACTED');

    if (cachedLead) cachedLead.status = 'CONTACTED';

    ui?.updateStat('newLeads', Math.max(0, ui.getStat('newLeads') - 1));
    ui?.showToast('Status → CONTACTED', 'success');

    syncLeadDerivedViews({ rerenderTable: activeTab === 'leads' });
    void refreshActionQueue();
  } catch (err) {
    console.error('[Dashboard] queue mark contacted failed:', err);
    button.disabled = false;
    button.textContent = originalLabel;
    ui?.showToast(err.message || 'Could not update status', 'error');
  }
}

async function handleQueueSnooze(select) {
  if (!api || !select) return;

  const leadId = select.dataset.queueSnoozeSelect;
  const snoozeDays = Number.parseInt(select.value, 10);
  if (![1, 3, 7].includes(snoozeDays)) {
    select.value = '';
    return;
  }

  select.disabled = true;

  try {
    const payload = await api.runLeadAction(leadId, { action: 'SNOOZE', snoozeDays });
    const cachedLead = _allLeads.find((lead) => lead.id === leadId);
    if (cachedLead) {
      cachedLead.snoozedUntil = payload?.lead?.snoozedUntil || null;
    }

    ui?.showToast(`Snoozed for ${snoozeDays} day${snoozeDays === 1 ? '' : 's'}.`, 'success');

    const refreshed = await refreshActionQueue({ showToastOnError: true });
    if (!refreshed) {
      select.disabled = false;
      select.value = '';
    }
  } catch (err) {
    console.error('[Dashboard] queue snooze failed:', err);
    select.disabled = false;
    select.value = '';
    ui?.showToast(err.message || 'Could not snooze lead', 'error');
  }
}

(function initActionQueueUi() {
  $('ac-open-queue')?.addEventListener('click', () => switchTab('queue'));

  const onQueueClick = (event) => {
    const markButton = event.target.closest('[data-queue-mark-contacted]');
    if (markButton) {
      event.preventDefault();
      void handleQueueMarkContacted(markButton);
      return;
    }

    const button = event.target.closest('[data-queue-open]');
    if (!button) return;
    event.preventDefault();
    openLeadDrawer(button.dataset.queueOpen);
  };

  $('ac-body')?.addEventListener('click', onQueueClick);
  $('queue-list')?.addEventListener('click', onQueueClick);
  $('queue-list')?.addEventListener('change', (event) => {
    const select = event.target.closest('[data-queue-snooze-select]');
    if (!select) return;
    void handleQueueSnooze(select);
  });
  $('queue-filters')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-queue-filter]');
    if (!button) return;

    const nextFilter = button.dataset.queueFilter;
    if (!ACTION_QUEUE_FILTERS.some((filter) => filter.id === nextFilter) || nextFilter === _actionQueueFilter) return;

    _actionQueueFilter = nextFilter;
    renderActionQueueSection();
  });
}());

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

  const actionQueue = await safeFetch(() => api.getActionQueue(), 'action queue');
  _actionQueue = Array.isArray(actionQueue) ? actionQueue : [];
  renderActionQueueSurfaces();

  /* Chart — optional; chart area stays blank if it fails */
  const chartData = await safeFetch(() => api.getLeadsByDay(7), 'leads by day');
  if (chartData) ui.renderChart(chartData);

  /* Donut chart — computed from already-loaded leads */
  ui.renderDonutChart(_allLeads);
  renderOverviewActivity(_allLeads);
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
    renderActionQueueSummary();
  }

  if (tab === 'queue' && ui) {
    renderActionQueueSection();
    void refreshActionQueue();
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

  } else if (tab === 'queue') {
    renderActionQueueSection();

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

function buildLeadRefreshSignature(leads = []) {
  return leads.map((lead) => [
    lead.id,
    lead.status,
    lead.priority,
    lead.priorityScore ?? '',
    lead.callbackAt ?? '',
    lead.callbackTime ?? '',
    lead.whatsappFailureAt ?? '',
    lead.whatsappNeedsAttention ? '1' : '0',
    lead.handoffReady ? '1' : '0',
    lead.createdAt,
    lead.updatedAt ?? '',
  ].join('|')).join('||');
}

function syncLeadDerivedViews({ rerenderTable = false } = {}) {
  if (rerenderTable) _applyLeadFilters();
  ui?.renderDonutChart(_allLeads);
  renderWhatsAppHealthAlert(_allLeads);
  renderActionQueueSurfaces();
  if (activeTab === 'overview') renderOverviewActivity(_allLeads);
  if (activeTab === 'automations') renderAutomations(_allLeads);
}

async function reconcileDashboardState({ force = false } = {}) {
  if (!api || dashboardReconcileInFlight) return false;
  if (!force && document.visibilityState === 'hidden') return false;

  dashboardReconcileInFlight = true;
  const previousSignature = buildLeadRefreshSignature(_allLeads);

  try {
    const leads = await api.getLeads();
    const normalizedLeads = Array.isArray(leads) ? leads : [];

    if (buildLeadRefreshSignature(normalizedLeads) !== previousSignature) {
      renderLeads(normalizedLeads);
    }

    await refreshActionQueue();
    return true;
  } catch (err) {
    console.error('[Dashboard] background reconcile failed:', err);
    return false;
  } finally {
    dashboardReconcileInFlight = false;
  }
}

function startDashboardReconcileLoop() {
  clearInterval(dashboardReconcileTimer);
  dashboardReconcileTimer = setInterval(() => {
    void reconcileDashboardState();
  }, DASHBOARD_RECONCILE_INTERVAL_MS);
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
    void refreshActionQueue();
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
    void refreshActionQueue();
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
    if (lead.hasClassification)
      events.push({ type: 'AGENT_CLASSIFIED', lead, time: lead.createdAt, tags: lead.tags });
    if (lead.hasPrioritization)
      events.push({ type: 'AGENT_PRIORITIZED', lead, time: lead.createdAt, score: lead.priorityScore });
    if (lead.whatsappNeedsAttention)
      events.push({
        type: 'WHATSAPP_REPLY_FAILED',
        lead,
        time: lead.whatsappFailureAt || lead.createdAt,
        failureTitle: lead.whatsappFailureTitle,
      });
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
    if (ev.type === 'WHATSAPP_REPLY_FAILED') detail += ` — ${_escDrawer(ev.failureTitle || 'Operator attention needed')}`;

    return `
      <div class="auto-event${cfg.tone ? ` auto-event--${cfg.tone}` : ''}">
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
  WHATSAPP_REPLY_FAILED: { icon: '⚠️', label: 'WhatsApp reply failed', tone: 'critical' },
};

function renderAutomations(leads) {
  _renderActivityInto('automations-feed', _buildActivityEvents(leads), 50);
}

function deriveWhatsAppHealth(leads = []) {
  const failingLeads = [...leads]
    .filter((lead) => lead?.whatsappNeedsAttention)
    .sort((a, b) => new Date(b.whatsappFailureAt || b.createdAt) - new Date(a.whatsappFailureAt || a.createdAt));

  if (!failingLeads.length) {
    return null;
  }

  const latest = failingLeads[0];
  return {
    title: latest.whatsappFailureTitle || 'WhatsApp sending is unhealthy',
    detail: latest.whatsappFailureDetail || 'An outbound WhatsApp reply failed and needs operator attention.',
    failureAt: latest.whatsappFailureAt || latest.createdAt,
    leadName: latest.name || 'Unknown lead',
    affectedLeadCount: failingLeads.length,
  };
}

function renderWhatsAppHealthAlert(leads = []) {
  const container = $('whatsapp-health-alert');
  if (!container) return;

  const health = deriveWhatsAppHealth(leads);
  if (!health) {
    container.innerHTML = '';
    return;
  }

  const affectedLabel = health.affectedLeadCount > 1
    ? `${health.affectedLeadCount} leads affected`
    : `Lead: ${health.leadName}`;

  container.innerHTML = `
    <div class="health-alert">
      <div class="health-alert__body">
        <div class="health-alert__eyebrow">WhatsApp sending warning</div>
        <div class="health-alert__title">${_escDrawer(health.title)}</div>
        <p class="health-alert__detail">${_escDrawer(health.detail)}</p>
      </div>
      <span class="health-alert__meta">${_escDrawer(affectedLabel)}</span>
    </div>`;
}

/* ─────────────────────────────────────────────────
   REALTIME WEBSOCKET
───────────────────────────────────────────────── */
function startRealtime(token) {
  wsClient = connectRealtime(token, {
    'lead:new': onNewLead,
    'lead:deleted': onRemoteLeadDeleted,
    'lead:status_changed': onRemoteLeadStatusChange,
  }, {
    onOpen: () => {
      void reconcileDashboardState({ force: true });
    },
  });
}

function onNewLead(lead) {
  const existing = _allLeads.find((item) => item.id === lead.id);
  const isRealtimeUpdate = Boolean(existing);
  if (existing) {
    Object.assign(existing, lead);
  } else {
    _allLeads.unshift(lead);
    ui.updateStat('totalLeads', ui.getStat('totalLeads') + 1);
    if (lead.status === config.leadStatuses[0])
      ui.updateStat('newLeads', ui.getStat('newLeads') + 1);
  }

  if (!isRealtimeUpdate) {
    const name = lead.name ? `: ${lead.name}` : '';
    if (lead.whatsappNeedsAttention) {
      ui.showToast(`WhatsApp reply failed${name} — ${lead.whatsappFailureTitle || 'operator attention needed'}`, 'error');
    } else {
      const toastMsg = lead.priority === 'HIGH'
        ? `🔥 New High Priority Lead${name}`
        : lead.priority === 'NORMAL'
          ? `⭐ New Lead${name}`
          : (config.notifText?.newLead ?? `New lead${name}`);

      ui.showToast(toastMsg, lead.priority === 'HIGH' ? 'success' : 'info');
    }
  }

  syncLeadDerivedViews({ rerenderTable: activeTab === 'leads' });
  void refreshActionQueue();

  const drawerIsOpen = $('lead-drawer')?.classList.contains('is-open');
  if (
    isRealtimeUpdate
    && drawerIsOpen
    && activeDrawerLeadId === lead.id
    && !activeDrawerActionBusy
    && !activeDrawerSelectedAction
  ) {
    void openLeadDrawer(lead.id, { preserveTab: true });
  }
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
  void refreshActionQueue();
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
  void refreshActionQueue();
}

/* ─────────────────────────────────────────────────
   LEAD DRAWER
───────────────────────────────────────────────── */
const DRAWER_ACTIVITY_MAP = {
  LEAD_CREATED: { label: 'Lead created', icon: '📋', dot: 'dtl-dot--created' },
  AGENT_CLASSIFIED: { label: 'AI classified the lead', icon: '🏷️', dot: 'dtl-dot--classified' },
  AGENT_PRIORITIZED: { label: 'AI priority updated', icon: '⚡', dot: 'dtl-dot--prioritized' },
  FOLLOW_UP_SCHEDULED: { label: 'Follow-up scheduled', icon: '📅', dot: 'dtl-dot--followup' },
  STATUS_CHANGED: { label: 'Lead status updated', icon: '🔄', dot: 'dtl-dot--default' },
  AUTOMATION_DEMO_INTENT: { label: 'Demo interest detected', icon: '🎓', dot: 'dtl-dot--automation' },
  AUTOMATION_ADMISSION_INTENT: { label: 'Admission interest detected', icon: '📘', dot: 'dtl-dot--automation' },
};

const DRAWER_INTENT_LABELS = {
  ADMISSION: 'Admission enquiry',
  DEMO_REQUEST: 'Demo request',
  FEE_ENQUIRY: 'Fee enquiry',
  SCHOLARSHIP_ENQUIRY: 'Scholarship enquiry',
  CALLBACK_REQUEST: 'Callback request',
  GENERAL_ENQUIRY: 'General enquiry',
  WRONG_FIT: 'Wrong fit',
  NOT_INTERESTED: 'Not interested',
  JUNK: 'Junk',
};

const TERMINAL_LEAD_STATUSES = new Set(['WON', 'LOST']);

function _escDrawer(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _escDrawerAttr(s) {
  return _escDrawer(s).replace(/"/g, '&quot;');
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

function _formatDrawerIntentLabel(intent) {
  return DRAWER_INTENT_LABELS[intent] || _titleCaseDrawer(intent);
}

function _formatDrawerSourceLabel(source) {
  if (source === 'whatsapp') return 'WhatsApp';
  if (source === 'web') return 'Website form';
  return _titleCaseDrawer(source || 'web');
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

function _isTerminalLead(lead) {
  return TERMINAL_LEAD_STATUSES.has(String(lead?.status || '').toUpperCase());
}

function _getLeadClosureLabel(lead) {
  const status = String(lead?.status || '').toUpperCase();
  if (status === 'WON') return 'Lead closed as Won';
  if (status === 'LOST') return 'Lead closed as Lost';
  return 'Lead closed';
}

function _resolveDrawerActivityPresentation(act) {
  const meta = act.metadata || {};

  if (act.type === 'FOLLOW_UP_SCHEDULED' && meta.reason === 'OPERATOR_CALLBACK_SCHEDULED') {
    return {
      label: 'Callback scheduled',
      icon: '📞',
      dot: 'dtl-dot--operator',
      category: 'operator',
      categoryLabel: 'Operator',
      emphasis: 'high',
      message: act.message || '',
    };
  }

  if (act.type === 'AUTOMATION_ALERT') {
    if (meta.reason === 'WHATSAPP_AUTO_REPLY_FAILED') {
      return {
        label: 'WhatsApp reply failed',
        icon: '⚠️',
        dot: 'dtl-dot--error',
        category: 'system',
        categoryLabel: 'Workflow',
        emphasis: 'high',
        message: [meta.failureTitle, meta.failureDetail].filter(Boolean).join('. ') || act.message || '',
      };
    }

    if (meta.reason === 'OPERATOR_MARKED_CALLED') {
      return {
        label: 'Marked as called',
        icon: '📞',
        dot: 'dtl-dot--operator',
        category: 'operator',
        categoryLabel: 'Operator',
        emphasis: 'high',
        message: act.message || '',
      };
    }

    if (meta.reason === 'OPERATOR_FEE_DETAILS_SENT') {
      return {
        label: 'Fee details sent',
        icon: '📄',
        dot: 'dtl-dot--operator',
        category: 'operator',
        categoryLabel: 'Operator',
        emphasis: 'high',
        message: act.message || '',
      };
    }

    if (meta.reason === 'OPERATOR_HANDOFF_COMPLETED') {
      return {
        label: 'Handoff marked complete',
        icon: '✅',
        dot: 'dtl-dot--operator',
        category: 'operator',
        categoryLabel: 'Operator',
        emphasis: 'high',
        message: act.message || '',
      };
    }

    if (meta.reason === 'OPERATOR_NOTE_ADDED') {
      return {
        label: 'Operator note added',
        icon: '📝',
        dot: 'dtl-dot--operator',
        category: 'operator',
        categoryLabel: 'Operator',
        emphasis: 'medium',
        message: meta.operatorNote || act.message || '',
      };
    }

    if (meta.channel === 'whatsapp' && meta.direction === 'inbound') {
      return {
        label: 'Customer message received',
        icon: '💬',
        dot: 'dtl-dot--whatsapp-in',
        category: 'customer',
        categoryLabel: 'Customer',
        emphasis: 'high',
        message: meta.messageText || act.message || '',
      };
    }

    if (meta.channel === 'whatsapp' && meta.direction === 'outbound') {
      if (meta.replyIntent === 'BUSINESS_KNOWLEDGE_ANSWER' || meta.groundedAnswer) {
        return {
          label: 'Business details shared on WhatsApp',
          icon: '📘',
          dot: 'dtl-dot--whatsapp-out',
          category: 'ai',
          categoryLabel: 'AI Assistant',
          emphasis: 'medium',
          message: meta.replyMessage || meta.messageText || act.message || '',
        };
      }

      if (meta.replyIntent === 'BUSINESS_KNOWLEDGE_UNCERTAIN') {
        return {
          label: 'Question handed to counsellor',
          icon: '🤝',
          dot: 'dtl-dot--whatsapp-out',
          category: 'system',
          categoryLabel: 'Workflow',
          emphasis: 'high',
          message: meta.replyMessage || meta.messageText || act.message || '',
        };
      }

      const isHandoff = String(meta.replyIntent || '').includes('HANDOFF');
      return {
        label: isHandoff ? 'Ready for counsellor handoff' : 'WhatsApp reply sent',
        icon: isHandoff ? '🤝' : '📲',
        dot: 'dtl-dot--whatsapp-out',
        category: isHandoff ? 'system' : 'ai',
        categoryLabel: isHandoff ? 'Workflow' : 'AI Assistant',
        emphasis: isHandoff ? 'high' : 'medium',
        message: meta.replyMessage || meta.messageText || act.message || '',
      };
    }

    if (meta.reason === 'HIGH_PRIORITY_LEAD') {
      return {
        label: 'High-priority lead flagged',
        icon: '🚨',
        dot: 'dtl-dot--prioritized',
        category: 'system',
        categoryLabel: 'Workflow',
        emphasis: 'high',
        message: `This lead was flagged for quick follow-up with score ${_escDrawer(meta.score ?? '—')}.`,
      };
    }
  }

  const cfg = DRAWER_ACTIVITY_MAP[act.type] ?? {
    label: _titleCaseDrawer(act.type),
    icon: '●',
    dot: 'dtl-dot--default',
  };

  const categoryDefaults = {
    LEAD_CREATED: { category: 'system', categoryLabel: 'System', emphasis: 'low' },
    AGENT_CLASSIFIED: { category: 'ai', categoryLabel: 'AI Assistant', emphasis: 'low' },
    AGENT_PRIORITIZED: { category: 'ai', categoryLabel: 'AI Assistant', emphasis: 'low' },
    STATUS_CHANGED: { category: 'system', categoryLabel: 'System', emphasis: 'low' },
    AUTOMATION_DEMO_INTENT: { category: 'system', categoryLabel: 'Workflow', emphasis: 'medium' },
    AUTOMATION_ADMISSION_INTENT: { category: 'system', categoryLabel: 'Workflow', emphasis: 'medium' },
  }[act.type] || {
    category: 'system',
    categoryLabel: 'System',
    emphasis: 'low',
  };

  return {
    ...cfg,
    ...categoryDefaults,
    message: act.message || '',
  };
}

function _buildWhatsAppSummaryHtml(summary, { leadStatus = null } = {}) {
  if (!summary) return '';
  const isTerminal = TERMINAL_LEAD_STATUSES.has(String(leadStatus || '').toUpperCase());
  const hasFailedReply = Boolean(summary.latestFailedReply);

  const callbackCue = summary.latestCallback
    ? getCallbackCue({
      callbackTime: summary.latestCallback.callbackTime,
      callbackAt: summary.latestCallback.callbackAt,
    })
    : null;
  const latestCallbackDisplay = _getCallbackDisplayText(
    summary.latestCallback?.callbackTime,
    summary.latestCallback?.callbackAt
  );
  const fields = Object.entries(summary.capturedFields || {})
    .filter(([, value]) => value)
    .map(([key, value]) => `
      <div class="wa-summary__field">
        <span class="wa-summary__field-label">${_escDrawer(_formatDrawerFieldLabel(key))}</span>
        <strong class="wa-summary__field-value">${_escDrawer(value)}</strong>
      </div>`)
    .join('');

  const transcript = Array.isArray(summary.transcript) ? summary.transcript : [];
  const transcriptHtml = `
    <div class="wa-transcript">
      <div class="wa-transcript__header">
        <span class="wa-transcript__title">WhatsApp Conversation</span>
        <span class="wa-transcript__count">${transcript.length} turns</span>
      </div>
      ${transcript.length ? `
        <div class="wa-transcript__list">
          ${transcript.map((turn) => `
            <div class="wa-turn wa-turn--${_escDrawer(turn.direction)}">
              <div class="wa-turn__meta">
                <span class="wa-turn__speaker">${_escDrawer(turn.speaker)}</span>
                <span class="wa-turn__time">${_escDrawer(_fmtDrawerTime(turn.createdAt))}</span>
              </div>
              <div class="wa-turn__bubble">${_escDrawer(turn.text)}</div>
            </div>`).join('')}
        </div>` : `
        <div class="wa-transcript__empty">
          No WhatsApp conversation is visible yet. New customer and assistant messages will appear here automatically.
        </div>`}
    </div>`;

  return `
    <div class="wa-summary${isTerminal ? ' wa-summary--closed' : ''}${hasFailedReply ? ' wa-summary--error' : ''}">
      <div class="wa-summary__header">
        <div>
          <div class="wa-summary__eyebrow">${_escDrawer(isTerminal ? 'WhatsApp history' : 'WhatsApp handoff')}</div>
          <div class="wa-summary__intent">${_escDrawer(summary.primaryIntentLabel || 'WhatsApp lead')}</div>
        </div>
        <span class="wa-summary__status wa-summary__status--${_escDrawer(summary.conversationStatus || 'captured')}">
          ${_escDrawer(summary.conversationStatusLabel || 'Conversation captured')}
        </span>
      </div>

      ${summary.latestFailedReply ? `
        <div class="wa-summary__failure">
          <div class="wa-summary__failure-title">Latest outbound failure</div>
          <p class="wa-summary__failure-text">${_escDrawer(
            [summary.latestFailedReply.title, summary.latestFailedReply.detail].filter(Boolean).join('. ')
            || 'The latest WhatsApp reply attempt failed.'
          )}</p>
        </div>` : ''}

      ${fields ? `<div class="wa-summary__fields">${fields}</div>` : '<div class="wa-summary__empty">No captured fields yet. Use the transcript below for context.</div>'}

      ${latestCallbackDisplay ? `
        <div class="wa-summary__next">
          <span class="wa-summary__next-label">${isTerminal ? 'Latest callback plan' : 'Callback plan'}</span>
          <p class="wa-summary__next-text">
            ${_escDrawer(latestCallbackDisplay)}
            ${(!isTerminal && callbackCue) ? `<span class="callback-status-badge callback-status-badge--${_escDrawer(callbackCue.state)}">${_escDrawer(callbackCue.stateLabel)}</span>` : ''}
          </p>
        </div>` : ''}

      <div class="wa-summary__next">
        <span class="wa-summary__next-label">${isTerminal ? 'Closure status' : 'Recommended next action'}</span>
        <p class="wa-summary__next-text">${_escDrawer(
          isTerminal
            ? `${_getLeadClosureLabel({ status: leadStatus })}. No further follow-up is currently recommended.`
            : (summary.recommendedNextAction || 'Review the WhatsApp conversation and continue manually.')
        )}</p>
      </div>
    </div>
    ${transcriptHtml}`;
}

function _leadTagsForDrawer(activities = []) {
  return activities.find((activity) => activity.type === 'AGENT_CLASSIFIED')?.metadata?.tags || [];
}

function _getLeadDrawerQuickActions({ lead, activities, whatsappConversation }) {
  if (config?.business?.industry !== 'academy' || !lead) return [];
  if (['WON', 'LOST'].includes(lead.status)) return [];

  const tags = new Set(_leadTagsForDrawer(activities));
  const actions = [];

  if (lead.status === 'NEW') {
    actions.push({
      action: 'MARK_CALLED',
      label: 'Mark as Called',
      tone: 'neutral',
      helper: 'Sets the lead status to Contacted.',
    });
  }

  actions.push({
    action: 'SCHEDULE_CALLBACK',
    label: 'Schedule Callback',
    tone: 'neutral',
    helper: 'Logs the callback date and time with an optional note.',
  });

  const requestedTopic = String(whatsappConversation?.capturedFields?.requestedTopic || '').toLowerCase();
  if (tags.has('FEE_ENQUIRY') || tags.has('FEES') || requestedTopic.includes('fee')) {
    actions.push({
      action: 'SEND_FEE_DETAILS',
      label: 'Send Fee Details',
      tone: 'neutral',
      helper: 'Records that the fee details were shared with the lead.',
    });
  }

  if (whatsappConversation?.conversationStatus === 'handoff' && !['QUALIFIED', 'WON', 'LOST'].includes(lead.status)) {
    actions.push({
      action: 'MARK_HANDOFF_COMPLETE',
      label: 'Mark Handoff Complete',
      tone: 'primary',
      helper: 'Closes the WhatsApp handoff and moves the lead forward.',
    });
  }

  return actions;
}

function _getRecommendedLeadAction(actions = [], whatsappConversation) {
  if (!actions.length) return null;
  if (whatsappConversation?.conversationStatus === 'handoff') {
    return actions.find((item) => item.action === 'MARK_HANDOFF_COMPLETE')?.action || actions[0].action;
  }
  return actions.find((item) => item.action === 'SCHEDULE_CALLBACK')?.action || actions[0].action;
}

function _getLeadDrawerActionLabel(action, { isPending = false, isSelected = false } = {}) {
  switch (action) {
    case 'MARK_CALLED':
      return isPending ? 'Saving…' : 'Mark as Called';
    case 'SCHEDULE_CALLBACK':
      if (isPending) return 'Scheduling…';
      return isSelected ? 'Save Callback' : 'Schedule Callback';
    case 'SEND_FEE_DETAILS':
      return isPending ? 'Saving…' : 'Send Fee Details';
    case 'MARK_HANDOFF_COMPLETE':
      return isPending ? 'Saving…' : 'Mark Handoff Complete';
    default:
      return isPending ? 'Saving…' : _titleCaseDrawer(action);
  }
}

function _buildLeadDrawerActionsHtml({ lead, activities, whatsappConversation }) {
  const actions = _getLeadDrawerQuickActions({ lead, activities, whatsappConversation });
  if (!actions.length) return '';

  const recommendedAction = _getRecommendedLeadAction(actions, whatsappConversation);
  const showCallbackFields = activeDrawerSelectedAction === 'SCHEDULE_CALLBACK'
    && actions.some((item) => item.action === 'SCHEDULE_CALLBACK');
  const callbackDraft = activeDrawerDraft.callbackTime || '';
  const noteDraft = activeDrawerDraft.note || '';

  return `
    <div class="drawer-actions-card">
      <div class="drawer-actions-card__header">
        <div>
          <div class="drawer-actions-card__eyebrow">Operator quick actions</div>
          <div class="drawer-actions-card__title">Handle this lead without leaving the drawer</div>
        </div>
        <span class="drawer-actions-card__badge">Academy workflow</span>
      </div>

      <div class="drawer-actions-card__buttons">
        ${actions.map((item) => `
          <button
            type="button"
            class="drawer-action-btn drawer-action-btn--${_escDrawer(item.tone)}${item.action === recommendedAction ? ' is-recommended' : ''}${item.action === activeDrawerSelectedAction ? ' is-selected' : ''}${item.action === activeDrawerActionPending ? ' is-loading' : ''}"
            data-lead-action="${_escDrawer(item.action)}"
            title="${_escDrawer(item.helper)}"
            ${activeDrawerActionBusy ? 'disabled' : ''}
          >
            <span class="drawer-action-btn__label">${_escDrawer(_getLeadDrawerActionLabel(item.action, {
              isPending: item.action === activeDrawerActionPending,
              isSelected: item.action === activeDrawerSelectedAction,
            }))}</span>
            ${item.action === recommendedAction ? '<span class="drawer-action-btn__badge">Recommended</span>' : ''}
          </button>`).join('')}
      </div>

      ${showCallbackFields ? `
        <div class="drawer-actions-card__detail">
          <div class="drawer-actions-card__detail-header">
            <div class="drawer-actions-card__detail-title">Schedule the callback</div>
            <button type="button" class="drawer-actions-card__cancel" data-lead-action-cancel="SCHEDULE_CALLBACK">Cancel</button>
          </div>
          <div class="drawer-actions-card__fields">
            <label class="drawer-actions-card__field">
              <span>Callback date & time</span>
              <input id="drawer-callback-time" type="datetime-local" value="${_escDrawerAttr(callbackDraft)}" ${activeDrawerActionPending === 'SCHEDULE_CALLBACK' ? 'disabled' : ''} />
            </label>
            <label class="drawer-actions-card__field drawer-actions-card__field--full">
              <span>Operator note</span>
              <textarea id="drawer-action-note" rows="2" placeholder="Optional note for the activity timeline" ${activeDrawerActionPending === 'SCHEDULE_CALLBACK' ? 'disabled' : ''}>${_escDrawer(noteDraft)}</textarea>
            </label>
          </div>
        </div>` : ''}

      <p class="drawer-actions-card__hint">Use these after the AI handoff to keep the lead moving and leave a clear trail for your team.</p>
    </div>`;
}

function _getActiveDrawerTab() {
  return document.querySelector('.drawer__tab.is-active')?.dataset.drawerTab || 'activity';
}

function _setActiveDrawerTab(target = 'activity') {
  const nextTarget = target === 'overview' ? 'overview' : 'activity';
  document.querySelectorAll('.drawer__tab').forEach((t) =>
    t.classList.toggle('is-active', t.dataset.drawerTab === nextTarget)
  );
  $('drawer-pane-activity').classList.toggle('drawer__pane--hidden', nextTarget !== 'activity');
  $('drawer-pane-overview').classList.toggle('drawer__pane--hidden', nextTarget !== 'overview');
}

function _setDrawerActionButtonsBusy(isBusy) {
  activeDrawerActionBusy = isBusy;
}

function _leadDrawerActionToast(action) {
  return {
    MARK_CALLED: 'Lead marked as called.',
    SCHEDULE_CALLBACK: 'Callback scheduled.',
    SEND_FEE_DETAILS: 'Fee details marked as sent.',
    MARK_HANDOFF_COMPLETE: 'Handoff marked complete.',
    ADD_NOTE: 'Operator note saved.',
  }[action] || 'Lead action saved.';
}

async function _runLeadDrawerAction(action) {
  if (!activeDrawerLeadId || activeDrawerActionBusy) return;

  const rawCallbackTime = action === 'SCHEDULE_CALLBACK'
    ? String(activeDrawerDraft.callbackTime || '').trim()
    : '';
  const parsedCallbackAt = rawCallbackTime ? new Date(rawCallbackTime) : null;
  const callbackAt = parsedCallbackAt && !Number.isNaN(parsedCallbackAt.getTime())
    ? parsedCallbackAt.toISOString()
    : '';
  const callbackTime = callbackAt
    ? (ui?.fmtDate ? ui.fmtDate(callbackAt) : new Date(callbackAt).toLocaleString('en-IN'))
    : '';
  const note = action === 'SCHEDULE_CALLBACK'
    ? String(activeDrawerDraft.note || '').trim()
    : action === 'ADD_NOTE'
      ? String(activeDrawerDraft.standaloneNote || '').trim()
    : '';

  if (action === 'SCHEDULE_CALLBACK' && !callbackAt) {
    ui?.showToast('Callback date and time are required.', 'error');
    return;
  }

  try {
    activeDrawerActionPending = action;
    _setDrawerActionButtonsBusy(true);
    if (activeDrawerData) _renderDrawerTimeline(activeDrawerData);

    const payload = await api.runLeadAction(activeDrawerLeadId, { action, callbackTime, callbackAt, note });

    activeDrawerActionPending = null;
    activeDrawerSelectedAction = null;
    activeDrawerDraft = { callbackTime: '', note: '', standaloneNote: '' };
    ui?.showToast(_leadDrawerActionToast(action), 'success');
    _applyLeadDrawerData(payload);
    void refreshActionQueue();
  } catch (err) {
    console.error('[Dashboard] runLeadAction failed:', err);
    activeDrawerActionPending = null;
    ui?.showToast(err.message || 'Could not save the lead action.', 'error');
    if (activeDrawerData) _renderDrawerTimeline(activeDrawerData);
  } finally {
    _setDrawerActionButtonsBusy(false);
  }
}

function _deriveLeadDrawerDisplayMeta(data) {
  const activities = data?.activities || [];
  const classified = activities.find((activity) => activity.type === 'AGENT_CLASSIFIED')?.metadata || {};
  const prioritized = activities.find((activity) => activity.type === 'AGENT_PRIORITIZED')?.metadata || {};
  const latestFailedReply = [...activities]
    .filter((activity) =>
      activity?.metadata?.channel === 'whatsapp'
      && activity?.metadata?.direction === 'outbound'
      && activity?.metadata?.deliveryStatus === 'failed'
    )
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
  const priorityScore = prioritized.priorityScore ?? 0;
  const hasClassification = activities.some((activity) => activity.type === 'AGENT_CLASSIFIED');
  const hasPrioritization = activities.some((activity) => activity.type === 'AGENT_PRIORITIZED');

  return {
    priorityScore,
    priority: priorityScore >= 30 ? 'HIGH' : priorityScore >= 10 ? 'NORMAL' : 'LOW',
    tags: Array.isArray(classified.tags) ? classified.tags : [],
    source: classified.source || 'web',
    hasClassification,
    hasPrioritization,
    whatsappDeliveryStatus: latestFailedReply ? 'failed' : null,
    whatsappNeedsAttention: Boolean(latestFailedReply),
    whatsappFailureTitle: latestFailedReply?.metadata?.failureTitle || null,
    whatsappFailureDetail: latestFailedReply?.metadata?.failureDetail || null,
    whatsappFailureCategory: latestFailedReply?.metadata?.failureCategory || null,
    whatsappFailureAt: latestFailedReply?.createdAt || null,
    whatsappOperatorActionRequired: latestFailedReply?.metadata?.operatorActionRequired || null,
  };
}

function _getDrawerClassificationMeta(activities = []) {
  return activities.find((activity) => activity.type === 'AGENT_CLASSIFIED')?.metadata || {};
}

function _getDrawerPrioritizationMeta(activities = []) {
  return activities.find((activity) => activity.type === 'AGENT_PRIORITIZED')?.metadata || {};
}

function _getLastCustomerActivityText({ lead, activities = [], source }) {
  const lastInboundWhatsApp = [...activities]
    .filter((activity) => activity?.metadata?.channel === 'whatsapp' && activity?.metadata?.direction === 'inbound')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

  if (lastInboundWhatsApp) {
    return `Customer last replied on ${_fmtDrawerTime(lastInboundWhatsApp.createdAt)}.`;
  }

  if (lead?.createdAt) {
    const label = source === 'whatsapp' ? 'Lead created' : 'Website enquiry received';
    return `${label} on ${_fmtDrawerTime(lead.createdAt)}.`;
  }

  return 'No recent customer activity yet.';
}

function _buildDrawerOverviewSummary({
  lead,
  hasClassification,
  primaryIntentLabel,
  sourceLabel,
  classified,
  whatsappConversation,
}) {
  if (_isTerminalLead(lead)) {
    if (primaryIntentLabel && primaryIntentLabel !== 'Pending AI classification') {
      return `${_getLeadClosureLabel(lead)}. Lead was classified as ${primaryIntentLabel.toLowerCase()}.`;
    }
    return `${_getLeadClosureLabel(lead)}. Original enquiry and timeline are shown below for reference.`;
  }

  return whatsappConversation?.recommendedNextAction
    || classified.suggestedNextAction
    || (!hasClassification
      ? 'AI is still processing this lead. Review the message now or wait a moment for tags and priority.'
      : sourceLabel === 'WhatsApp'
        ? 'Review the WhatsApp context in Activity and continue the operator follow-up from there.'
        : 'Review the lead details and take the next operator action from the Activity tab.');
}

function _buildLeadFocusCardHtml({ lead, activities, whatsappConversation }) {
  if (!lead) return '';
  if (_isTerminalLead(lead)) return '';
  if (whatsappConversation) return '';

  const classified = _getDrawerClassificationMeta(activities);
  const prioritized = _getDrawerPrioritizationMeta(activities);
  const hasClassification = activities.some((activity) => activity.type === 'AGENT_CLASSIFIED');
  const priorityScore = prioritized.priorityScore ?? 0;

  let eyebrow = 'Operator focus';
  let title = 'What to do next';
  let text = '';
  let tone = 'default';

  if (!hasClassification) {
    eyebrow = 'AI update pending';
    title = 'Review the fresh enquiry now';
    text = 'The lead is already saved and visible. Tags and priority will appear here as soon as AI processing finishes.';
    tone = 'pending';
  } else if (classified.suggestedNextAction) {
    text = classified.suggestedNextAction;
    tone = priorityScore >= 30 ? 'urgent' : 'default';
  } else if (priorityScore >= 30) {
    text = 'Call this lead soon and move the conversation forward while interest is still high.';
    tone = 'urgent';
  } else if (lead.status === 'NEW') {
    text = 'Review the enquiry, record the first operator action, and move the lead into contact.';
  }

  if (!text) return '';

  return `
    <div class="drawer-focus-card drawer-focus-card--${_escDrawer(tone)}">
      <div class="drawer-focus-card__eyebrow">${_escDrawer(eyebrow)}</div>
      <div class="drawer-focus-card__title">${_escDrawer(title)}</div>
      <p class="drawer-focus-card__text">${_escDrawer(text)}</p>
    </div>`;
}

function _buildLeadClosureCardHtml({ lead, activities = [], whatsappConversation = null }) {
  if (!lead || !_isTerminalLead(lead)) return '';

  const classified = _getDrawerClassificationMeta(activities);
  const primaryIntent = whatsappConversation?.primaryIntent || classified.bestCategory || null;
  const primaryIntentLabel = primaryIntent ? _formatDrawerIntentLabel(primaryIntent).toLowerCase() : null;
  const lastCustomerActivity = _getLastCustomerActivityText({
    lead,
    activities,
    source: classified.source || 'web',
  });

  return `
    <div class="drawer-closure-card drawer-closure-card--${_escDrawer(String(lead.status || '').toLowerCase())}">
      <div class="drawer-closure-card__eyebrow">Closed lead</div>
      <div class="drawer-closure-card__title">${_escDrawer(_getLeadClosureLabel(lead))}</div>
      <p class="drawer-closure-card__text">${_escDrawer(
        primaryIntentLabel
          ? `This lead was classified as ${primaryIntentLabel}. Timeline and conversation details below are shown for reference only.`
          : 'Timeline and conversation details below are shown for reference only.'
      )}</p>
      <div class="drawer-closure-card__hint">${_escDrawer(`${lastCustomerActivity} No further follow-up is currently recommended.`)}</div>
    </div>`;
}

function _getLeadOperatorNoteContextLabel(reason) {
  return {
    OPERATOR_NOTE_ADDED: 'Operator note',
    OPERATOR_CALLBACK_SCHEDULED: 'Callback note',
    OPERATOR_MARKED_CALLED: 'Call update',
    OPERATOR_FEE_DETAILS_SENT: 'Fee follow-up',
    OPERATOR_HANDOFF_COMPLETED: 'Handoff note',
  }[reason] || 'Operator note';
}

function _getLeadOperatorNotes(activities = []) {
  return [...activities]
    .filter((activity) => {
      const meta = activity?.metadata || {};
      return meta.reason === 'OPERATOR_NOTE_ADDED' || Boolean(meta.operatorNote);
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((activity) => ({
      id: activity.id,
      text: activity.metadata?.operatorNote || '',
      createdAt: activity.createdAt,
      label: _getLeadOperatorNoteContextLabel(activity.metadata?.reason),
    }))
    .filter((note) => note.text);
}

function _getCallbackDisplayText(callbackTime, callbackAt) {
  if (callbackTime) return callbackTime;
  if (!callbackAt) return null;
  return ui?.fmtDate ? ui.fmtDate(callbackAt) : new Date(callbackAt).toLocaleString('en-IN');
}

function _getLatestCallbackMemory(activities = []) {
  const latest = [...activities]
    .filter((activity) =>
      activity.type === 'FOLLOW_UP_SCHEDULED'
      && activity.metadata?.reason === 'OPERATOR_CALLBACK_SCHEDULED'
    )
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

  if (!latest) return null;

  const cue = getCallbackCue({
    callbackTime: latest.metadata?.callbackTime || null,
    callbackAt: latest.metadata?.callbackAt || null,
  });

  return {
    callbackTime: latest.metadata?.callbackTime || null,
    callbackAt: latest.metadata?.callbackAt || null,
    displayTime: _getCallbackDisplayText(latest.metadata?.callbackTime || null, latest.metadata?.callbackAt || null),
    callbackScheduledAt: latest.createdAt,
    note: latest.metadata?.operatorNote || null,
    createdAt: latest.createdAt,
    cue,
  };
}

function _buildLeadOperatorNotesHtml({ lead = null, activities = [] }) {
  const notes = _getLeadOperatorNotes(activities).slice(0, 3);
  const latestNote = notes[0] || null;
  const olderNotes = latestNote ? notes.slice(1) : notes;
  const latestCallback = _getLatestCallbackMemory(activities);
  const noteDraft = activeDrawerDraft.standaloneNote || '';
  const saveDisabled = activeDrawerActionBusy || !String(noteDraft).trim();
  const callbackTone = latestCallback?.cue?.state || 'scheduled';
  const callbackToneLabel = latestCallback?.cue?.badgeLabel || 'Callback scheduled';
  const isTerminal = _isTerminalLead(lead);

  return `
    <div class="drawer-notes-card${isTerminal ? ' drawer-notes-card--historical' : ''}">
      <div class="drawer-notes-card__header">
        <div>
          <div class="drawer-notes-card__eyebrow">${_escDrawer(isTerminal ? 'Operator notes history' : 'Operator notes')}</div>
          <div class="drawer-notes-card__title">${_escDrawer(
            isTerminal
              ? 'Callback plans and notes recorded before this lead was closed'
              : 'Keep useful human follow-up context on this lead'
          )}</div>
        </div>
        <span class="drawer-notes-card__badge">${_escDrawer(isTerminal ? 'Read only' : 'Internal')}</span>
      </div>

      ${latestCallback ? `
        <div class="drawer-notes-card__memory drawer-notes-card__memory--${_escDrawer(callbackTone)}">
          <div class="drawer-notes-card__memory-head">
            <div>
              <div class="drawer-notes-card__memory-label">${_escDrawer(isTerminal ? 'Last callback plan' : 'Latest callback memory')}</div>
              <div class="drawer-notes-card__memory-value">${_escDrawer(latestCallback.displayTime || 'Scheduled callback')}</div>
            </div>
            ${!isTerminal ? `<span class="callback-status-badge callback-status-badge--${_escDrawer(callbackTone)}">${_escDrawer(latestCallback.cue?.stateLabel || 'Scheduled')}</span>` : ''}
          </div>
          <div class="drawer-notes-card__memory-sub">
            ${_escDrawer(latestCallback.note || `Last updated on ${_fmtDrawerTime(latestCallback.createdAt)}.`)}
          </div>
          <div class="drawer-notes-card__memory-meta">${_escDrawer(isTerminal ? 'Recorded before closure' : callbackToneLabel)}</div>
        </div>` : ''}

      ${latestNote ? `
        <div class="drawer-notes-card__latest">
          <span class="drawer-notes-card__latest-label">Latest note</span>
          <p class="drawer-notes-card__latest-text">${_escDrawer(latestNote.text)}</p>
        </div>` : ''}

      ${olderNotes.length ? `
        <div class="drawer-note-list">
          ${olderNotes.map((note) => `
            <div class="drawer-note-item">
              <div class="drawer-note-item__meta">
                <span class="drawer-note-item__kind">${_escDrawer(note.label)}</span>
                <span class="drawer-note-item__time">${_escDrawer(_fmtDrawerTime(note.createdAt))}</span>
              </div>
              <div class="drawer-note-item__text">${_escDrawer(note.text)}</div>
            </div>`).join('')}
        </div>` : !latestNote ? `
        <div class="drawer-notes-card__empty">
          ${_escDrawer(
            isTerminal
              ? 'No operator notes were recorded before this lead was closed.'
              : 'No operator notes yet. Add small reminders like “prefers Hindi” or “asked about Class 11 batch”.'
          )}
        </div>` : ''}

      ${!isTerminal ? `
      <div class="drawer-notes-card__composer">
        <label class="drawer-notes-card__field">
          <span>New note</span>
          <textarea
            id="drawer-standalone-note"
            rows="2"
            placeholder="Add a quick operator note for follow-up"
            ${activeDrawerActionPending === 'ADD_NOTE' ? 'disabled' : ''}
          >${_escDrawer(noteDraft)}</textarea>
        </label>
        <button
          type="button"
          class="drawer-notes-card__save${activeDrawerActionPending === 'ADD_NOTE' ? ' is-loading' : ''}"
          data-lead-action="ADD_NOTE"
          ${saveDisabled ? 'disabled' : ''}
        >
          ${activeDrawerActionPending === 'ADD_NOTE' ? 'Saving…' : 'Save note'}
        </button>
      </div>` : ''}
    </div>`;
}

function _syncDrawerLeadCache(data) {
  const lead = data?.lead;
  if (!lead) return;

  const derived = _deriveLeadDrawerDisplayMeta(data);
  const latestCallback = _getLatestCallbackMemory(data?.activities || []);
  const conversationStatus = data?.whatsappConversation?.conversationStatus || null;
  const cached = _allLeads.find((item) => item.id === lead.id);

  if (cached) {
    Object.assign(cached, {
      ...cached,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      message: lead.message,
      status: lead.status,
      callbackTime: latestCallback?.displayTime || null,
      callbackAt: latestCallback?.callbackAt || null,
      callbackScheduledAt: latestCallback?.callbackScheduledAt || null,
      conversationStatus,
      handoffReady: conversationStatus === 'handoff',
      ...derived,
    });
  }

  syncLeadDerivedViews({ rerenderTable: activeTab === 'leads' });
}

function _applyLeadDrawerData(data) {
  if (!data) return;
  activeDrawerData = data;
  _syncDrawerLeadCache(data);
  _renderDrawerTimeline(data);
  _renderDrawerOverview(data);
}

async function openLeadDrawer(leadId, { preserveTab = false } = {}) {
  const drawer = $('lead-drawer');
  if (!drawer) return;
  activeDrawerLeadId = leadId;
  activeDrawerData = null;
  activeDrawerActionPending = null;
  activeDrawerActionBusy = false;
  activeDrawerSelectedAction = null;
  activeDrawerDraft = { callbackTime: '', note: '', standaloneNote: '' };
  const targetTab = preserveTab ? _getActiveDrawerTab() : 'activity';

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
  _setActiveDrawerTab(targetTab);

  /* Open */
  drawer.classList.add('is-open');
  document.body.style.overflow = 'hidden';

  /* Show loading state while the drawer summary loads */
  $('drawer-timeline').innerHTML = `
    <div class="drawer-loading">
      <div class="drawer-loading__spinner"></div>
      Loading timeline…
    </div>`;
  $('drawer-overview-content').innerHTML = `
    <div class="drawer-loading">
      <div class="drawer-loading__spinner"></div>
      Loading lead summary…
    </div>`;

  const [actRes] = await Promise.allSettled([api.getLeadActivity(leadId)]);

  if (actRes.status === 'fulfilled') {
    _applyLeadDrawerData(actRes.value);
  } else {
    $('drawer-timeline').innerHTML =
      `<p class="drawer-error">Could not load timeline: ${_escDrawer(actRes.reason?.message)}</p>`;
    $('drawer-overview-content').innerHTML =
      `<p class="drawer-error">Could not load the lead summary.</p>`;
  }
}

function closeLeadDrawer() {
  const drawer = $('lead-drawer');
  if (!drawer) return;
  drawer.classList.remove('is-open');
  document.body.style.overflow = '';
  activeDrawerLeadId = null;
  activeDrawerData = null;
  activeDrawerActionBusy = false;
  activeDrawerActionPending = null;
  activeDrawerSelectedAction = null;
  activeDrawerDraft = { callbackTime: '', note: '', standaloneNote: '' };
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
  const classified = activities.find((activity) => activity.type === 'AGENT_CLASSIFIED');
  const priorityScore = prioritized?.metadata?.priorityScore ?? 0;
  const priorityLabel = priorityScore >= 30 ? 'HIGH' : priorityScore >= 10 ? 'NORMAL' : 'LOW';
  const source = classified?.metadata?.source
    || _allLeads.find((item) => item.id === lead?.id)?.source
    || 'web';
  const sourceLabel = _formatDrawerSourceLabel(source);
  const headerBadges = [
    `<span class="drawer__meta-badge">Status: <strong>${_escDrawer(lead?.status ?? 'NEW')}</strong></span>`,
    `<span class="drawer__meta-badge">Priority: <strong>${_escDrawer(priorityLabel)}</strong></span>`,
    `<span class="drawer__meta-badge">Score: <strong>${_escDrawer(priorityScore)}</strong></span>`,
    `<span class="drawer__meta-badge">Source: <strong>${_escDrawer(sourceLabel)}</strong></span>`,
  ];
  $('drawer-meta').innerHTML = headerBadges.join('');

  if (!activities.length) {
    $('drawer-timeline').innerHTML = `
      ${_buildLeadDrawerActionsHtml({ lead, activities, whatsappConversation })}
      ${_buildLeadClosureCardHtml({ lead, activities, whatsappConversation })}
      ${_buildLeadOperatorNotesHtml({ lead, activities })}
      ${_buildLeadFocusCardHtml({ lead, activities, whatsappConversation })}
      ${_buildWhatsAppSummaryHtml(whatsappConversation, { leadStatus: lead?.status })}
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
    } else if (act.type === 'FOLLOW_UP_SCHEDULED' && (meta?.callbackTime || meta?.callbackAt)) {
      const callbackDisplay = _getCallbackDisplayText(meta?.callbackTime, meta?.callbackAt);
      const callbackCue = getCallbackCue({
        callbackTime: meta.callbackTime,
        callbackAt: meta.callbackAt,
      });
      metaHtml = `
        <div class="dtl-pills">
          <span class="dtl-pill">Callback: ${_escDrawer(callbackDisplay || 'Scheduled callback')}</span>
          <span class="dtl-pill dtl-pill--callback-${_escDrawer(callbackCue.state)}">${_escDrawer(callbackCue.stateLabel)}</span>
        </div>`;
    } else if (meta?.channel === 'whatsapp' && meta?.direction === 'outbound' && meta?.conversationState?.status) {
      const pills = [
        `<span class="dtl-pill">${_escDrawer(_titleCaseDrawer(meta.conversationState.status))}</span>`,
      ];
      if (meta?.deliveryStatus === 'failed' && meta?.failureTitle) {
        pills.push(`<span class="dtl-pill dtl-pill--callback-overdue">${_escDrawer(meta.failureTitle)}</span>`);
      }
      metaHtml = `<div class="dtl-pills">${pills.join('')}</div>`;
    }

    return `
      <div class="dtl-item dtl-item--${_escDrawer(cfg.category || 'system')} dtl-item--${_escDrawer(cfg.emphasis || 'low')}" style="--i:${i}">
        <div class="dtl-dot ${_escDrawer(cfg.dot)}">${cfg.icon}</div>
        <div class="dtl-content">
          <div class="dtl-header-row">
            <span class="dtl-kind dtl-kind--${_escDrawer(cfg.category || 'system')}">${_escDrawer(cfg.categoryLabel || 'System')}</span>
            <div class="dtl-title">${_escDrawer(cfg.label)}</div>
          </div>
          <div class="dtl-time">${_escDrawer(_fmtDrawerTime(act.createdAt))}</div>
          ${cfg.message ? `<div class="dtl-msg">${_escDrawer(cfg.message)}</div>` : ''}
          ${metaHtml}
        </div>
      </div>`;
  }).join('');

  $('drawer-timeline').innerHTML = `
    ${_buildLeadDrawerActionsHtml({ lead, activities, whatsappConversation })}
    ${_buildLeadClosureCardHtml({ lead, activities, whatsappConversation })}
    ${_buildLeadOperatorNotesHtml({ lead, activities })}
    ${_buildLeadFocusCardHtml({ lead, activities, whatsappConversation })}
    ${_buildWhatsAppSummaryHtml(whatsappConversation, { leadStatus: lead?.status })}
    <div class="drawer-timeline">${html}</div>`;
}

function _renderDrawerOverview(data) {
  const lead = data?.lead;
  if (!lead) { $('drawer-overview-content').innerHTML = ''; return; }

  const esc = _escDrawer;
  const activities = data?.activities || [];
  const whatsappConversation = data?.whatsappConversation || null;
  const classified = _getDrawerClassificationMeta(activities);
  const prioritized = _getDrawerPrioritizationMeta(activities);
  const source = classified.source
    || _allLeads.find((item) => item.id === lead.id)?.source
    || 'web';
  const sourceLabel = _formatDrawerSourceLabel(source);
  const priorityScore = prioritized.priorityScore ?? 0;
  const priorityLabel = priorityScore >= 30 ? 'HIGH' : priorityScore >= 10 ? 'NORMAL' : 'LOW';
  const primaryIntent = whatsappConversation?.primaryIntent || classified.bestCategory || null;
  const primaryIntentLabel = primaryIntent ? _formatDrawerIntentLabel(primaryIntent) : 'Pending AI classification';
  const hasClassification = activities.some((activity) => activity.type === 'AGENT_CLASSIFIED');
  const tags = Array.isArray(classified.tags) ? classified.tags : [];
  const capturedFields = Object.entries(whatsappConversation?.capturedFields || {}).filter(([, value]) => value);
  const conversationStatus = whatsappConversation?.conversationStatus || null;
  const latestCallback = _getLatestCallbackMemory(activities);
  const callbackCue = latestCallback?.cue || null;
  const lastCustomerActivity = _getLastCustomerActivityText({ lead, activities, source });
  const summaryText = _buildDrawerOverviewSummary({
    lead,
    hasClassification,
    primaryIntentLabel,
    sourceLabel,
    classified,
    whatsappConversation,
  });
  const dispositionLabel = hasClassification
    ? _titleCaseDrawer(classified.leadDisposition || 'valid')
    : 'Pending AI';

  $('drawer-overview-content').innerHTML = `
    <div class="drawer-overview">
      <section class="drawer-overview__section drawer-overview__section--hero">
        <div class="drawer-overview__eyebrow">Lead snapshot</div>
        <div class="drawer-overview__headline">${esc(primaryIntentLabel)}</div>
        <div class="drawer-overview__badges">
          <span class="drawer-overview__badge drawer-overview__badge--status drawer-overview__badge--status-${esc(String(lead.status || 'new').toLowerCase())}">${esc(_titleCaseDrawer(lead.status || 'NEW'))}</span>
          ${conversationStatus ? `<span class="drawer-overview__badge drawer-overview__badge--conversation drawer-overview__badge--conversation-${esc(conversationStatus)}">${esc(whatsappConversation.conversationStatusLabel || _titleCaseDrawer(conversationStatus))}</span>` : ''}
          ${(!_isTerminalLead(lead) && callbackCue) ? `<span class="drawer-overview__badge drawer-overview__badge--callback drawer-overview__badge--callback-${esc(callbackCue.state)}">${esc(callbackCue.badgeLabel)}</span>` : ''}
          <span class="drawer-overview__badge drawer-overview__badge--source">${esc(sourceLabel)}</span>
        </div>
        <p class="drawer-overview__summary">${esc(summaryText)}</p>
        <div class="drawer-overview__hint">${esc(lastCustomerActivity)}</div>
      </section>

      <section class="drawer-overview__section">
        <div class="drawer-overview__section-title">Lead basics</div>
        <div class="drawer-overview__grid">
          <div class="drawer-overview__item">
            <span class="drawer-overview__label">Phone</span>
            <strong class="drawer-overview__value">${esc(lead.phone ?? '—')}</strong>
          </div>
          ${lead.email ? `
            <div class="drawer-overview__item">
              <span class="drawer-overview__label">Email</span>
              <strong class="drawer-overview__value">${esc(lead.email)}</strong>
            </div>` : ''}
          <div class="drawer-overview__item">
            <span class="drawer-overview__label">Priority</span>
            <strong class="drawer-overview__value">${esc(priorityLabel)}</strong>
          </div>
          <div class="drawer-overview__item">
            <span class="drawer-overview__label">Score</span>
            <strong class="drawer-overview__value">${esc(priorityScore)}</strong>
          </div>
          ${latestCallback?.displayTime ? `
            <div class="drawer-overview__item">
              <span class="drawer-overview__label">${esc(_isTerminalLead(lead) ? 'Last Callback' : 'Latest Callback')}</span>
              <strong class="drawer-overview__value">${esc(latestCallback.displayTime)}</strong>
            </div>` : ''}
        </div>
      </section>

      <section class="drawer-overview__section">
        <div class="drawer-overview__section-title">Lead intelligence</div>
        <div class="drawer-overview__grid">
          <div class="drawer-overview__item">
            <span class="drawer-overview__label">Primary intent</span>
            <strong class="drawer-overview__value">${esc(primaryIntentLabel)}</strong>
          </div>
          <div class="drawer-overview__item">
            <span class="drawer-overview__label">Disposition</span>
            <strong class="drawer-overview__value">${esc(dispositionLabel)}</strong>
          </div>
        </div>
        ${tags.length ? `
          <div class="drawer-overview__chips">
            ${tags.map((tag) => `<span class="dtl-pill">${esc(tag)}</span>`).join('')}
          </div>` : `
          <div class="drawer-overview__empty">AI tags will appear here after classification completes.</div>`}
      </section>

      ${capturedFields.length ? `
        <section class="drawer-overview__section">
          <div class="drawer-overview__section-title">Captured context</div>
          <div class="drawer-overview__grid">
            ${capturedFields.map(([key, value]) => `
              <div class="drawer-overview__item">
                <span class="drawer-overview__label">${esc(_formatDrawerFieldLabel(key))}</span>
                <strong class="drawer-overview__value">${esc(value)}</strong>
              </div>`).join('')}
          </div>
        </section>` : ''}

      ${lead.message ? `
        <section class="drawer-overview__section">
          <div class="drawer-overview__section-title">Original message</div>
          <div class="drawer-overview__message">${esc(lead.message)}</div>
        </section>` : ''}
    </div>`;
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
    _setActiveDrawerTab(tab.dataset.drawerTab);
  });
});

$('drawer-timeline')?.addEventListener('click', (event) => {
  const cancelButton = event.target.closest('[data-lead-action-cancel]');
  if (cancelButton) {
    activeDrawerSelectedAction = null;
    activeDrawerDraft = { ...activeDrawerDraft, callbackTime: '', note: '' };
    if (activeDrawerData) _renderDrawerTimeline(activeDrawerData);
    return;
  }

  const button = event.target.closest('[data-lead-action]');
  if (!button) return;
  const action = button.dataset.leadAction;

  if (action === 'SCHEDULE_CALLBACK' && activeDrawerSelectedAction !== 'SCHEDULE_CALLBACK') {
    activeDrawerSelectedAction = 'SCHEDULE_CALLBACK';
    if (activeDrawerData) _renderDrawerTimeline(activeDrawerData);
    requestAnimationFrame(() => $('drawer-callback-time')?.focus());
    return;
  }

  _runLeadDrawerAction(action);
});

$('drawer-timeline')?.addEventListener('input', (event) => {
  if (event.target.id === 'drawer-callback-time') {
    activeDrawerDraft.callbackTime = event.target.value;
  }
  if (event.target.id === 'drawer-action-note') {
    activeDrawerDraft.note = event.target.value;
  }
  if (event.target.id === 'drawer-standalone-note') {
    activeDrawerDraft.standaloneNote = event.target.value;
    const saveButton = event.currentTarget.querySelector('[data-lead-action="ADD_NOTE"]');
    if (saveButton && activeDrawerActionPending !== 'ADD_NOTE') {
      saveButton.disabled = activeDrawerActionBusy || !String(activeDrawerDraft.standaloneNote).trim();
    }
  }
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
    startDashboardReconcileLoop();
    startRealtime(stored);
  } catch (err) {
    console.error('[AutoLogin] bootDashboard failed:', err);
    doLogout('Could not load dashboard data. Please log in again.');
  }
})();

window.addEventListener('focus', () => {
  void reconcileDashboardState({ force: true });
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void reconcileDashboardState({ force: true });
  }
});
