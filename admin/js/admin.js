/**
 * admin.js — SME Engine Admin Control Center
 *
 * Sections : overview | businesses | leads | logs
 * Auth     : SUPERADMIN JWT → localStorage 'admin_token'
 * Polling  : overview + activity refreshed every 30 s
 */

import { AdminAPI } from './admin-api.js';

/* ── State ───────────────────────────────────────────────────────────────── */
let token = localStorage.getItem('admin_token') ?? null;
let api = AdminAPI(token);
let activeTab = 'overview';
let _pollTimer = null;
let _cachedBusinesses = [];
let _allLeads = [];
let _searchListenerReady = false;
let _sortHeadersReady = false;
let _leadsSort = { col: null, dir: 'asc' };
const loadedSections = new Set();

/* Priority order for sorting (higher = more urgent) */
const PRIORITY_ORDER = { HIGH: 3, NORMAL: 2, LOW: 1 };

/* ── DOM helper ──────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

/* ── Toast ───────────────────────────────────────────────────────────────── */
function toast(msg, type = 'info') {
  const wrap = $('toast-area');
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = msg;
  wrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast--visible'));
  setTimeout(() => {
    el.classList.remove('toast--visible');
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

/* ── Auth helpers ────────────────────────────────────────────────────────── */
function requireAuth() {
  if (!token) { showLogin(); return false; }
  return true;
}

function showLogin() {
  $('admin-screen').style.display = 'none';
  $('login-screen').style.display = 'flex';
  $('login-password').value = '';
  $('login-error').textContent = '';
  $('login-password').focus();
}

function showAdmin() {
  $('login-screen').style.display = 'none';
  $('admin-screen').style.display = 'flex';
}

function handleUnauthorized() {
  stopPolling();
  localStorage.removeItem('admin_token');
  token = null;
  api = AdminAPI(null);
  showLogin();
  toast('Session expired. Please log in again.', 'error');
}

/* ── Login ───────────────────────────────────────────────────────────────── */
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('login-btn');
  const errEl = $('login-error');
  const password = $('login-password').value.trim();
  if (!password) return;

  btn.disabled = true;
  btn.textContent = 'Logging in…';
  errEl.textContent = '';

  try {
    const data = await AdminAPI(null).login(password);
    token = data.token;
    localStorage.setItem('admin_token', token);
    api = AdminAPI(token);
    loadedSections.clear();
    showAdmin();
    await bootAdmin();
  } catch (err) {
    errEl.textContent = err.message === 'Invalid credentials'
      ? 'Incorrect password.'
      : (err.message || 'Login failed.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Log in';
  }
});

/* ── Logout ──────────────────────────────────────────────────────────────── */
$('logout-btn').addEventListener('click', () => {
  stopPolling();
  localStorage.removeItem('admin_token');
  token = null;
  api = AdminAPI(null);
  loadedSections.clear();
  activeTab = 'overview';
  showLogin();
});

/* ── Tab switching ───────────────────────────────────────────────────────── */
const ALL_TABS = ['overview', 'businesses', 'leads', 'logs'];

function switchTab(tab) {
  activeTab = tab;
  history.replaceState(null, '', '#' + tab);

  document.querySelectorAll('.sidebar__link').forEach((el) => {
    el.classList.toggle('sidebar__link--active', el.dataset.tab === tab);
  });

  ALL_TABS.forEach((t) => {
    const el = $(`section-${t}`);
    if (el) el.hidden = (t !== tab);
  });

  loadSection(tab);
}

document.querySelectorAll('.sidebar__link').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    closeMobileSidebar();
    if (requireAuth()) switchTab(el.dataset.tab);
  });
});

/* Sync tab when the user navigates with browser back / forward buttons */
window.addEventListener('hashchange', () => {
  if (!token) return;
  const hash = window.location.hash.slice(1);
  const tab = ALL_TABS.includes(hash) ? hash : 'overview';
  if (tab !== activeTab) switchTab(tab);
});

/* ── Lazy section loading ────────────────────────────────────────────────── */
async function loadSection(tab) {
  /* Capture whether this is the first time visiting the tab BEFORE deleting.
     Leads and logs always re-fetch; firstLoad controls whether skeleton shows. */
  const firstLoad = !loadedSections.has(tab);

  /* Leads and logs always re-fetch on tab switch so status changes made in
     business dashboards are immediately visible. Overview uses polling;
     businesses manages its own cache via loadedSections.delete('businesses'). */
  if (tab === 'leads' || tab === 'logs') loadedSections.delete(tab);

  if (loadedSections.has(tab)) return;

  try {
    switch (tab) {
      case 'overview': await fetchAndRenderOverview(); break;
      case 'businesses': await fetchAndRenderBusinesses(); break;
      case 'leads': await fetchAndRenderLeads(firstLoad); break;
      case 'logs': await fetchAndRenderLogs(firstLoad); break;
    }
    loadedSections.add(tab);
  } catch (err) {
    if (err.status === 401) { handleUnauthorized(); return; }
    toast(err.message || `Failed to load ${tab}.`, 'error');
  }
}

/* ── Boot + 30-second poll ───────────────────────────────────────────────── */
async function bootAdmin() {
  const hash = window.location.hash.slice(1);
  const startTab = ALL_TABS.includes(hash) ? hash : 'overview';
  switchTab(startTab);
  startPolling();
}

function startPolling() {
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(async () => {
    try {
      if (activeTab === 'overview') {
        const [stats, leads, logs] = await Promise.all([
          api.getOverview(),
          api.getLeads(),
          api.getLogs(),
        ]);
        updateKPICounters(stats);
        renderPlatformSignals(leads, _cachedBusinesses);
        renderOverviewActivity(logs);
      }
      else if (activeTab === 'leads') {
        await fetchAndRenderLeads(false);
      }
      else if (activeTab === 'logs') {
        await fetchAndRenderLogs(false);
      }
    } catch (err) {
      if (err.status === 401) { handleUnauthorized(); }
    }
  }, 30_000);
}

function stopPolling() {
  clearInterval(_pollTimer);
  _pollTimer = null;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* OVERVIEW                                                                   */
/* ══════════════════════════════════════════════════════════════════════════ */

async function fetchAndRenderOverview() {
  $('overview-stats').innerHTML = skeletonCards(4);
  $('leads-chart').innerHTML = skeletonBlock(120);
  $('platform-signals').innerHTML = skeletonSignals();
  $('overview-activity').innerHTML = skeletonFeed(7);
  $('lifecycle-chart').innerHTML = skeletonBlock(180);
  $('growth-metrics').innerHTML = skeletonBlock(120);
  $('lead-signals').innerHTML = skeletonBlock(100);

  /* Parallel fetch for fast load */
  const [stats, leads, businesses, logs, analytics] = await Promise.all([
    api.getOverview(),
    api.getLeads(),
    api.getBusinesses(),
    api.getLogs(),
    api.getAnalytics(),
  ]);

  _cachedBusinesses = businesses;

  renderKPICards(stats);
  renderLeadsChart(leads);
  renderPlatformSignals(leads, businesses);
  renderOverviewActivity(logs);
  renderLifecycleChart(analytics);
  renderGrowthMetrics(analytics);
  renderLeadSignals(analytics);
}

/* ── KPI cards with stable IDs for counter updates ──────────────────────── */
function renderKPICards(data) {
  $('overview-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-card__label">Businesses</div>
      <div class="stat-card__value" id="stat-businesses">0</div>
    </div>
    <div class="stat-card">
      <div class="stat-card__label">Total Leads</div>
      <div class="stat-card__value" id="stat-leads">0</div>
    </div>
    <div class="stat-card">
      <div class="stat-card__label">Users</div>
      <div class="stat-card__value" id="stat-users">0</div>
    </div>
    <div class="stat-card">
      <div class="stat-card__label">Events Today</div>
      <div class="stat-card__value" id="stat-logs-today">0</div>
    </div>
  `;

  /* Stagger counter animations */
  setTimeout(() => animateCounter($('stat-businesses'), 0, data.businesses), 0);
  setTimeout(() => animateCounter($('stat-leads'), 0, data.leads), 80);
  setTimeout(() => animateCounter($('stat-users'), 0, data.users), 160);
  setTimeout(() => animateCounter($('stat-logs-today'), 0, data.logsToday), 240);
}

/* Animate from current displayed value → new value (used by polling) */
function updateKPICounters(data) {
  const map = {
    businesses: 'stat-businesses',
    leads: 'stat-leads',
    users: 'stat-users',
    logsToday: 'stat-logs-today',
  };
  for (const [field, id] of Object.entries(map)) {
    const el = $(id);
    if (!el) continue;
    const current = parseInt(el.textContent, 10) || 0;
    if (current !== data[field]) animateCounter(el, current, data[field]);
  }
}

/* ── Leads per day — SVG bar chart ──────────────────────────────────────── */
function renderLeadsChart(leads) {
  const container = $('leads-chart');
  if (!container) return;

  /* Build last 7 days */
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({
      date: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString('en-IN', { weekday: 'short' }),
      count: 0,
    });
  }

  leads.forEach((l) => {
    const slot = days.find((d) => d.date === l.createdAt?.slice(0, 10));
    if (slot) slot.count++;
  });

  const CHART_H = 110;
  const BAR_W = 28;
  const GAP = 14;
  const PAD = 10;
  const LABEL_H = 22;
  const maxVal = Math.max(...days.map((d) => d.count), 1);
  const totalW = PAD * 2 + days.length * (BAR_W + GAP) - GAP;

  const svgBars = days.map((d, i) => {
    const x = PAD + i * (BAR_W + GAP);
    const barH = Math.round((d.count / maxVal) * CHART_H);
    const barY = CHART_H - barH;
    return `
      <g>
        ${d.count > 0
        ? `<text x="${x + BAR_W / 2}" y="${barY - 5}" text-anchor="middle" class="bar-count">${d.count}</text>`
        : ''}
        <rect class="bar"
          x="${x}" y="${CHART_H}" width="${BAR_W}" height="0" rx="4"
          data-y="${barY}" data-h="${barH}"
        />
        <text x="${x + BAR_W / 2}" y="${CHART_H + LABEL_H - 4}"
          text-anchor="middle" class="bar-label">${d.label}</text>
      </g>`;
  }).join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${totalW} ${CHART_H + LABEL_H}"
         width="100%" class="leads-svg" preserveAspectRatio="xMidYMid meet">
      ${svgBars}
    </svg>`;

  /* Staggered bar animation */
  container.querySelectorAll('.bar').forEach((bar, i) => {
    const tY = parseFloat(bar.dataset.y);
    const tH = parseFloat(bar.dataset.h);
    if (tH === 0) return;
    setTimeout(() => animateBar(bar, CHART_H, tY, tH, 700), i * 70);
  });
}

/* ── Recent platform activity feed ──────────────────────────────────────── */
function renderOverviewActivity(logs) {
  const feed = $('overview-activity');
  if (!feed) return;

  const recent = logs.slice(0, 15);
  if (!recent.length) {
    feed.innerHTML = `<p class="feed__empty">No recent activity.</p>`;
    return;
  }

  feed.innerHTML = recent.map((r, i) => `
    <div class="activity-item" style="animation-delay:${i * 35}ms">
      <span class="activity-item__icon">${LOG_ICONS[r.type] ?? '🤖'}</span>
      <div class="activity-item__body">
        <div class="activity-item__event">${esc(r.type.replace(/_/g, ' '))}</div>
        <div class="activity-item__biz">${esc(r.lead?.business?.name ?? '—')}</div>
      </div>
      <div class="activity-item__time">${fmtRelative(r.createdAt)}</div>
    </div>
  `).join('');
}

/* ── Platform Signals ────────────────────────────────────────────────────── */
function renderPlatformSignals(leads, businesses) {
  const el = $('platform-signals');
  if (!el) return;

  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayStr = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);

  /* Signal 1 — Top lead source today */
  const todayLeads = leads.filter((l) => l.createdAt?.slice(0, 10) === todayStr);
  const bizTally = {};
  todayLeads.forEach((l) => { bizTally[l.businessName] = (bizTally[l.businessName] ?? 0) + 1; });
  const topEntry = Object.entries(bizTally).sort((a, b) => b[1] - a[1])[0];
  const s1 = topEntry
    ? { icon: '🔥', text: `${topEntry[0]} received ${topEntry[1]} lead${topEntry[1] > 1 ? 's' : ''} today`, alert: true }
    : { icon: '—', text: 'No new leads recorded today yet', alert: false };

  /* Signal 2 — High priority leads waiting */
  const urgent = leads.filter((l) => (l.score ?? 0) >= 30 && l.status === 'NEW');
  const s2 = urgent.length > 0
    ? { icon: '⚠️', text: `${urgent.length} high-priority lead${urgent.length > 1 ? 's' : ''} waiting for response`, alert: true }
    : { icon: '✓', text: 'No urgent leads waiting', alert: false };

  /* Signal 3 — Inactive businesses (no lead activity in past 7 days) */
  const inactive = businesses.filter(
    (b) => !b.lastActivity || new Date(b.lastActivity) < sevenDaysAgo,
  );
  const s3 = inactive.length > 0
    ? { icon: '💤', text: `${inactive.length} business${inactive.length > 1 ? 'es' : ''} inactive this week`, alert: true }
    : { icon: '✓', text: 'All businesses active this week', alert: false };

  /* Signal 4 — Lead spike: today > 2× yesterday */
  const todayCount = todayLeads.length;
  const yestCount = leads.filter((l) => l.createdAt?.slice(0, 10) === yesterdayStr).length;
  const isSpike = yestCount > 0 && todayCount > yestCount * 2;
  const s4 = isSpike
    ? { icon: '📈', text: `Lead spike detected — ${todayCount} today vs ${yestCount} yesterday`, alert: true }
    : { icon: '→', text: 'No lead spike detected today', alert: false };

  el.innerHTML = [s1, s2, s3, s4].map((s, i) => `
    <div class="signal-row signal-row--${s.alert ? 'alert' : 'ok'}"
         style="animation-delay:${i * 55}ms">
      <span class="signal-row__icon">${s.icon}</span>
      <span class="signal-row__text">${esc(s.text)}</span>
    </div>
  `).join('');
}

/* ── Lifecycle Distribution — horizontal bar chart ──────────────────────── */
function renderLifecycleChart(analytics) {
  const el = $('lifecycle-chart');
  if (!el) return;

  const dist = analytics.stageDistribution ?? {};
  const duration = analytics.avgStageDuration ?? {};
  const total = Object.values(dist).reduce((s, n) => s + n, 0);

  if (total === 0) {
    el.innerHTML = '<p style="color:var(--muted);font-size:0.8125rem;padding:0.5rem 0">No business data yet.</p>';
    return;
  }

  const maxCount = Math.max(...BUSINESS_STAGES.map((s) => dist[s] ?? 0), 1);

  el.innerHTML = BUSINESS_STAGES.map((stage, i) => {
    const count = dist[stage] ?? 0;
    const pct = Math.round((count / maxCount) * 100);
    const days = duration[stage];
    return `
      <div class="lifecycle-row" style="animation-delay:${i * 55}ms">
        <div class="lifecycle-row__label">${esc(STAGE_LABELS[stage])}</div>
        <div class="lifecycle-row__bar-wrap">
          <div class="lifecycle-row__bar" data-pct="${pct}"></div>
        </div>
        <div class="lifecycle-row__count">${count}</div>
        <div class="lifecycle-row__days">${days != null ? `${days}d avg` : '—'}</div>
      </div>`;
  }).join('');

  /* Animate bars via CSS transition */
  el.querySelectorAll('.lifecycle-row__bar').forEach((bar) => {
    const pct = parseFloat(bar.dataset.pct);
    bar.style.width = '0%';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bar.style.width = `${pct}%`;
    }));
  });
}

/* ── Platform Growth Metrics ─────────────────────────────────────────────── */
function renderGrowthMetrics(analytics) {
  const el = $('growth-metrics');
  if (!el) return;
  const g = analytics.growthMetrics ?? {};

  el.innerHTML = `
    <div class="analytics-stat-grid">
      <div class="analytics-stat">
        <div class="analytics-stat__val" id="ag-total">0</div>
        <div class="analytics-stat__label">Total Businesses</div>
      </div>
      <div class="analytics-stat">
        <div class="analytics-stat__val" id="ag-website">0</div>
        <div class="analytics-stat__label">Website Live</div>
      </div>
      <div class="analytics-stat">
        <div class="analytics-stat__val" id="ag-gen-leads">0</div>
        <div class="analytics-stat__label">Generating Leads</div>
      </div>
      <div class="analytics-stat">
        <div class="analytics-stat__val" id="ag-automation">0</div>
        <div class="analytics-stat__label">Using Automation</div>
      </div>
      <div class="analytics-stat">
        <div class="analytics-stat__val" id="ag-scaling">0</div>
        <div class="analytics-stat__label">Scaling</div>
      </div>
      <div class="analytics-stat analytics-stat--accent">
        <div class="analytics-stat__val"><span id="ag-rate">0</span>%</div>
        <div class="analytics-stat__label">Activation Rate</div>
      </div>
    </div>`;

  setTimeout(() => animateCounter($('ag-total'), 0, g.total ?? 0), 0);
  setTimeout(() => animateCounter($('ag-website'), 0, g.withWebsite ?? 0), 60);
  setTimeout(() => animateCounter($('ag-gen-leads'), 0, g.generatingLeads ?? 0), 120);
  setTimeout(() => animateCounter($('ag-automation'), 0, g.usingAutomation ?? 0), 180);
  setTimeout(() => animateCounter($('ag-scaling'), 0, g.scaling ?? 0), 240);
  setTimeout(() => animateCounter($('ag-rate'), 0, g.activationRate ?? 0), 300);
}

/* ── Lead Conversion Signals ─────────────────────────────────────────────── */
function renderLeadSignals(analytics) {
  const el = $('lead-signals');
  if (!el) return;
  const s = analytics.leadSignals ?? {};
  const timeStr = s.avgHoursToFirstContact != null
    ? `${s.avgHoursToFirstContact}h`
    : '—';

  el.innerHTML = `
    <div class="analytics-stat-grid">
      <div class="analytics-stat">
        <div class="analytics-stat__val" id="ls-score">0</div>
        <div class="analytics-stat__label">Avg Priority Score</div>
      </div>
      <div class="analytics-stat">
        <div class="analytics-stat__val">${esc(timeStr)}</div>
        <div class="analytics-stat__label">Avg Time to Contact</div>
      </div>
      <div class="analytics-stat">
        <div class="analytics-stat__val"><span id="ls-contacted">0</span>%</div>
        <div class="analytics-stat__label">Contacted Rate</div>
      </div>
      <div class="analytics-stat analytics-stat--accent">
        <div class="analytics-stat__val"><span id="ls-qualified">0</span>%</div>
        <div class="analytics-stat__label">Qualified / Won</div>
      </div>
    </div>`;

  setTimeout(() => animateCounter($('ls-score'), 0, s.avgPriorityScore ?? 0), 0);
  setTimeout(() => animateCounter($('ls-contacted'), 0, s.pctContacted ?? 0), 60);
  setTimeout(() => animateCounter($('ls-qualified'), 0, s.pctQualifiedOrWon ?? 0), 120);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* BUSINESSES                                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

const BUSINESS_STAGES = [
  'STARTING',
  'WEBSITE_DESIGN',
  'WEBSITE_LIVE',
  'LEADS_ACTIVE',
  'AUTOMATION_ACTIVE',
  'SCALING',
];

const STAGE_LABELS = {
  STARTING: 'Starting',
  WEBSITE_DESIGN: 'Website Design',
  WEBSITE_LIVE: 'Website Live',
  LEADS_ACTIVE: 'Leads Active',
  AUTOMATION_ACTIVE: 'Automation Active',
  SCALING: 'Scaling',
};

/**
 * Returns the next suggested lifecycle stage for a business based on data
 * signals, or null if no suggestion applies.
 */
function getSuggestedStage(b) {
  if (b.stage === 'WEBSITE_LIVE' && b.leadCount > 10) return 'LEADS_ACTIVE';
  if (b.stage === 'LEADS_ACTIVE' && b.automationEventCount > 20) return 'AUTOMATION_ACTIVE';
  if (b.stage === 'AUTOMATION_ACTIVE' && b.leadCount > 200) return 'SCALING';
  return null;
}

async function fetchAndRenderBusinesses() {
  const tbody = $('businesses-tbody');
  tbody.innerHTML = skeletonRows(5, 7);

  const rows = await api.getBusinesses();

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="table__empty">No businesses found.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((b) => {
    const stage = b.stage ?? 'STARTING';
    const stageOptions = BUSINESS_STAGES.map((s) =>
      `<option value="${s}"${s === stage ? ' selected' : ''}>${esc(STAGE_LABELS[s])}</option>`
    ).join('');

    const suggested = getSuggestedStage(b);
    const suggestCell = suggested
      ? `<button class="suggest-btn"
           data-biz-id="${esc(b.id)}"
           data-stage="${esc(suggested)}">
           ↑ ${esc(STAGE_LABELS[suggested])}
         </button>`
      : `<span class="text-muted">—</span>`;

    return `
      <tr data-biz-id="${esc(b.id)}">
        <td>
          <div class="cell-primary">${esc(b.name)}</div>
          <div class="cell-sub">${esc(b.slug)}</div>
        </td>
        <td>${esc(b.industry ?? '—')}</td>
        <td>${esc([b.city, b.country].filter(Boolean).join(', ') || '—')}</td>
        <td>
          <select class="stage-select stage-select--${stage.toLowerCase()}"
                  data-biz-id="${esc(b.id)}"
                  data-current="${esc(stage)}">
            ${stageOptions}
          </select>
        </td>
        <td>${suggestCell}</td>
        <td class="cell-num">${b.leadCount}</td>
        <td class="cell-date">${fmtDate(b.lastActivity ?? b.createdAt)}</td>
      </tr>`;
  }).join('');

  /* Wire stage selects */
  tbody.querySelectorAll('.stage-select').forEach((sel) => {
    sel.addEventListener('change', onStageChange);
  });

  /* Event delegation for suggest-btn — re-registered each render */
  tbody.addEventListener('click', async (e) => {
    const btn = e.target.closest('.suggest-btn');
    if (!btn) return;

    const bizId = btn.dataset.bizId;
    const stage = btn.dataset.stage;
    const label = STAGE_LABELS[stage];

    btn.disabled = true;
    btn.textContent = '…';

    try {
      await api.updateBusinessStage(bizId, stage);
      toast(`Stage → ${label}`, 'success');
      /* Invalidate cache and re-render so suggestion clears */
      loadedSections.delete('businesses');
      await fetchAndRenderBusinesses();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = `↑ ${label}`;
      toast(err.message || 'Could not update stage', 'error');
    }
  });
}

async function onStageChange(e) {
  const sel = e.target;
  const bizId = sel.dataset.bizId;
  const newStage = sel.value;
  const prev = sel.dataset.current;

  sel.disabled = true;
  sel.className = 'stage-select stage-select--loading';

  try {
    await api.updateBusinessStage(bizId, newStage);
    sel.dataset.current = newStage;
    sel.className = `stage-select stage-select--${newStage.toLowerCase()}`;
    toast(`Stage → ${STAGE_LABELS[newStage]}`, 'success');
  } catch (err) {
    sel.value = prev;
    sel.className = `stage-select stage-select--${prev.toLowerCase()}`;
    toast(err.message || 'Could not update stage', 'error');
  } finally {
    sel.disabled = false;
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* ONBOARDING WIZARD                                                          */
/* ══════════════════════════════════════════════════════════════════════════ */

function slugify(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/* ── Wizard state ──────────────────────────────────────────────────────── */
let _slugManuallyEdited = false;
let _slugCheckTimer = null;
let _lastCreated = null; /* { name, slug, email, password } for step 3 */

/* ── Step navigation ───────────────────────────────────────────────────── */
function wizardGoTo(step) {
  [1, 2, 3].forEach((n) => {
    $(`wizard-step-${n}`).hidden = n !== step;
    const dot = document.querySelector(`.wizard__step[data-step="${n}"]`);
    if (dot) {
      dot.classList.toggle('wizard__step--active', n === step);
      dot.classList.toggle('wizard__step--completed', n < step);
    }
  });
}

/* ── Open / close ──────────────────────────────────────────────────────── */
function openCreateModal() {
  _lastCreated = null;
  _slugManuallyEdited = false;
  /* Reset all fields */
  ['biz-name', 'biz-slug', 'biz-city',
    'biz-owner-name', 'biz-owner-email', 'biz-owner-password'].forEach((id) => {
      $$(id) && ($$(id).value = '');
    });
  $('biz-industry').value = '';
  $('biz-timezone').value = 'Asia/Kolkata';
  $('biz-currency').value = 'INR';
  $('biz-followup').value = '30';
  $('biz-autoreply').checked = false;
  $('slug-status').textContent = '';
  $('slug-status').className = 'slug-status';
  $('create-biz-error').textContent = '';
  renderPwStrength('');
  wizardGoTo(1);
  $('create-biz-modal').hidden = false;
  $('biz-name').focus();
}

function closeCreateModal() {
  clearTimeout(_slugCheckTimer);
  $('create-biz-modal').hidden = true;
}

function $$(id) { return document.getElementById(id); }

$('open-create-biz').addEventListener('click', openCreateModal);
$('close-create-biz').addEventListener('click', closeCreateModal);
$('cancel-create-biz').addEventListener('click', closeCreateModal);

/* Close on backdrop click */
$('create-biz-modal').addEventListener('click', (e) => {
  if (e.target === $('create-biz-modal')) closeCreateModal();
});

/* Close on Escape */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('create-biz-modal').hidden) closeCreateModal();
});

/* ── Slug auto-fill + live availability check ──────────────────────────── */
$('biz-slug').addEventListener('input', () => {
  _slugManuallyEdited = true;
  scheduleSlugCheck($('biz-slug').value);
});

$('biz-name').addEventListener('input', (e) => {
  if (!_slugManuallyEdited) {
    const s = slugify(e.target.value);
    $('biz-slug').value = s;
    scheduleSlugCheck(s);
  }
});

/* Fade-swap the slug status badge: fade out → swap text+class → fade in */
function setSlugStatus(text, cls) {
  const el = $('slug-status');
  el.style.opacity = '0';
  setTimeout(() => {
    el.textContent = text;
    el.className = cls;
    el.style.opacity = '';
  }, 90);
}

function scheduleSlugCheck(slug) {
  clearTimeout(_slugCheckTimer);
  if (!slug) { setSlugStatus('', 'slug-status'); return; }
  setSlugStatus('…', 'slug-status slug-status--checking');
  _slugCheckTimer = setTimeout(() => doSlugCheck(slug), 400);
}

async function doSlugCheck(slug) {
  try {
    const { available, slug: sanitized } = await api.checkSlug(slug);
    if (available) {
      setSlugStatus(`✓ ${sanitized} available`, 'slug-status slug-status--ok');
    } else {
      setSlugStatus(`✗ ${sanitized} taken`, 'slug-status slug-status--taken');
    }
  } catch {
    setSlugStatus('', 'slug-status');
  }
}

/* ── Password strength ──────────────────────────────────────────────────── */
$('biz-owner-password').addEventListener('input', (e) => {
  renderPwStrength(e.target.value);
});

function renderPwStrength(pw) {
  const el = $('pw-strength');
  if (!pw) { el.innerHTML = ''; return; }
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const level = score <= 2 ? 'weak' : score <= 3 ? 'fair' : 'strong';
  el.innerHTML = `
    <div class="pw-bar pw-bar--${level}">
      <span class="pw-bar__fill" style="width:${(score / 5) * 100}%"></span>
    </div>
    <span class="pw-label pw-label--${level}">${level}</span>
  `;
}

/* ── Step 1 → Step 2 ───────────────────────────────────────────────────── */
$('wizard-next-1').addEventListener('click', () => {
  const name = $('biz-name').value.trim();
  if (!name) { $('biz-name').focus(); return; }
  /* Warn if slug is marked taken but allow proceeding — server will confirm */
  wizardGoTo(2);
  $('biz-owner-name').focus();
});

/* ── Step 2 → Step 1 ───────────────────────────────────────────────────── */
$('wizard-back-2').addEventListener('click', () => wizardGoTo(1));

/* ── Step 2 submit ──────────────────────────────────────────────────────── */
$('wizard-submit').addEventListener('click', async () => {
  if (!requireAuth()) return;

  const ownerName = $('biz-owner-name').value.trim();
  const ownerEmail = $('biz-owner-email').value.trim();
  const ownerPassword = $('biz-owner-password').value;
  const errEl = $('create-biz-error');
  errEl.textContent = '';

  if (!ownerName) { $('biz-owner-name').focus(); errEl.textContent = 'Owner name is required.'; return; }
  if (!ownerEmail) { $('biz-owner-email').focus(); errEl.textContent = 'Owner email is required.'; return; }
  if (!ownerPassword || ownerPassword.length < 8) {
    $('biz-owner-password').focus();
    errEl.textContent = 'Password must be at least 8 characters.';
    return;
  }

  const btn = $('wizard-submit');
  btn.disabled = true;
  btn.textContent = 'Creating…';

  const payload = {
    name: $('biz-name').value.trim(),
    slug: $('biz-slug').value.trim() || undefined,
    industry: $('biz-industry').value || undefined,
    city: $('biz-city').value.trim() || undefined,
    timezone: $('biz-timezone').value || undefined,
    currency: $('biz-currency').value || undefined,
    ownerName,
    ownerEmail,
    ownerPassword,
    followUpMinutes: parseInt($('biz-followup').value, 10),
    autoReplyEnabled: $('biz-autoreply').checked,
  };

  try {
    const biz = await api.createBusiness(payload);

    /* Store for step-3 display */
    _lastCreated = { name: biz.name, slug: biz.slug, email: ownerEmail, password: ownerPassword };

    /* Populate success screen */
    $('success-biz-name').textContent = biz.name;
    $('success-dashboard-url').textContent = `${location.origin}/dashboard`;
    $('success-email').textContent = ownerEmail;
    $('success-password').textContent = ownerPassword;
    $('success-slug').textContent = biz.slug;

    wizardGoTo(3);

    /* Invalidate businesses cache */
    loadedSections.delete('businesses');
    fetchAndRenderBusinesses();
  } catch (err) {
    errEl.textContent = err.message || 'Failed to create business';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Business';
  }
});

/* ── Step 3 Done ────────────────────────────────────────────────────────── */
$('wizard-done').addEventListener('click', () => {
  closeCreateModal();
  toast(`Business "${_lastCreated?.name}" is live`, 'success');
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* LEADS EXPLORER                                                             */
/* ══════════════════════════════════════════════════════════════════════════ */

function sortLeads(rows) {
  if (!_leadsSort.col) return rows;
  const { col, dir } = _leadsSort;
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (col === 'priority') {
      return mul * ((PRIORITY_ORDER[a.priority] ?? 0) - (PRIORITY_ORDER[b.priority] ?? 0));
    }
    if (col === 'score') {
      return mul * ((a.score ?? 0) - (b.score ?? 0));
    }
    if (col === 'createdAt') {
      return mul * (new Date(a.createdAt) - new Date(b.createdAt));
    }
    const av = (a[col] ?? '').toString().toLowerCase();
    const bv = (b[col] ?? '').toString().toLowerCase();
    return mul * av.localeCompare(bv);
  });
}

function updateLeadSortIndicators() {
  const thead = $('leads-table')?.querySelector('thead');
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

function initLeadsSortHeaders() {
  if (_sortHeadersReady) return;
  const thead = $('leads-table')?.querySelector('thead');
  if (!thead) return;
  _sortHeadersReady = true;
  thead.querySelectorAll('[data-sort]').forEach((th) => {
    th.style.cursor = 'pointer';
    /* Append sort indicator span (matches dashboard pattern) */
    const ind = document.createElement('span');
    ind.className = 'sort-ind';
    th.appendChild(ind);
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (_leadsSort.col === col) {
        _leadsSort.dir = _leadsSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        _leadsSort.col = col;
        _leadsSort.dir = 'asc';
      }
      updateLeadSortIndicators();
      _applyLeadsFilter();
    });
  });
}

function _applyLeadsFilter() {
  const q = ($('leads-search')?.value ?? '').toLowerCase();
  const filtered = q
    ? _allLeads.filter((l) =>
      l.name?.toLowerCase().includes(q) ||
      l.businessName?.toLowerCase().includes(q)
    )
    : _allLeads;
  renderLeadsTable(sortLeads(filtered));
}

async function fetchAndRenderLeads(firstLoad = true) {
  const tbody = $('leads-tbody');

  /* Skeleton only on first visit — subsequent tab switches are silent */
  if (firstLoad) {
    tbody.innerHTML = skeletonRows(8, 6);
    /* Wire sort headers once; they persist across silent re-fetches */
    initLeadsSortHeaders();
  }

  _allLeads = await api.getLeads();

  /* Wire search listener once — guard prevents accumulation */
  if (!_searchListenerReady) {
    _searchListenerReady = true;
    $('leads-search').addEventListener('input', _applyLeadsFilter);
  }

  /* Re-apply current filter (preserves search query across silent refreshes) */
  _applyLeadsFilter();
}

function renderLeadsTable(rows) {
  const tbody = $('leads-tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table__empty">No leads found.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((l) => `
    <tr>
      <td>
        <div class="cell-primary">${esc(l.name)}</div>
        ${l.message ? `<div class="cell-sub"><span class="message-preview" title="${esc(l.message)}">↳ ${esc(truncate(l.message, 96))}</span></div>` : ''}
        <div class="cell-sub">${esc(l.phone ?? '')}</div>
      </td>
      <td>${esc(l.businessName ?? '—')}</td>
      <td><span class="badge badge--status badge--${(l.status ?? '').toLowerCase()}">${esc(l.status ?? '—')}</span></td>
      <td><span class="badge badge--${(l.priority ?? 'low').toLowerCase()}">${esc(l.priority ?? 'LOW')}</span></td>
      <td class="cell-num">${l.score ?? 0}</td>
      <td class="cell-date">${fmtDate(l.createdAt)}</td>
    </tr>
  `).join('');
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* AUTOMATION LOGS                                                            */
/* ══════════════════════════════════════════════════════════════════════════ */

const LOG_ICONS = {
  AGENT_CLASSIFIED: '🏷️',
  AGENT_PRIORITIZED: '⚡',
  FOLLOW_UP_SCHEDULED: '🕐',
  FOLLOW_UP_SENT: '📨',
};

async function fetchAndRenderLogs(firstLoad = true) {
  const feed = $('logs-feed');
  if (firstLoad) feed.innerHTML = skeletonFeed(8);

  const rows = await api.getLogs();

  if (!rows.length) {
    feed.innerHTML = `<p class="feed__empty">No automation events recorded yet.</p>`;
    return;
  }

  feed.innerHTML = rows.map((r) => `
    <div class="feed-item">
      <div class="feed-item__icon">${LOG_ICONS[r.type] ?? '🤖'}</div>
      <div class="feed-item__body">
        <div class="feed-item__primary">${esc(r.type.replace(/_/g, ' '))}</div>
        <div class="feed-item__sub">
          ${esc(r.lead?.name ?? '—')} · ${esc(r.lead?.business?.name ?? '—')}
          ${r.note ? ` · <em>${esc(r.note)}</em>` : ''}
        </div>
      </div>
      <div class="feed-item__time">${fmtDate(r.createdAt)}</div>
    </div>
  `).join('');
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* SKELETON HELPERS                                                           */
/* ══════════════════════════════════════════════════════════════════════════ */

function skeletonCards(n) {
  return Array.from({ length: n }, () => `
    <div class="stat-card stat-card--skeleton">
      <div class="skel skel--label"></div>
      <div class="skel skel--value"></div>
    </div>`
  ).join('');
}

function skeletonBlock(h = 120) {
  return `<div class="skel skel--block" style="height:${h}px;border-radius:0.5rem"></div>`;
}

function skeletonRows(n, cols) {
  return Array.from({ length: n }, () =>
    `<tr>${Array.from({ length: cols }, () =>
      `<td><div class="skel skel--line"></div></td>`
    ).join('')}</tr>`
  ).join('');
}

function skeletonFeed(n) {
  return Array.from({ length: n }, () => `
    <div class="feed-item feed-item--skeleton">
      <div class="skel skel--icon"></div>
      <div class="feed-item__body">
        <div class="skel skel--line"></div>
        <div class="skel skel--line skel--short"></div>
      </div>
    </div>`
  ).join('');
}

function skeletonSignals() {
  return Array.from({ length: 4 }, (_, i) => `
    <div class="signal-row signal-row--ok">
      <div class="skel" style="width:1.25rem;height:1.25rem;border-radius:50%;flex-shrink:0"></div>
      <div class="skel skel--line" style="flex:1;width:${60 + i * 7}%"></div>
    </div>`
  ).join('');
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* UTILITIES                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

function fmtRelative(iso) {
  if (!iso) return '—';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function truncate(value, max = 80) {
  const text = String(value ?? '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Animate a numeric counter from `from` → `to` using ease-out cubic.
 */
function animateCounter(el, from, to, duration = 900) {
  if (!el) return;
  const start = performance.now();
  const range = to - from;
  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    el.textContent = Math.round(from + range * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/**
 * Animate an SVG <rect> bar from (startY, h=0) → (endY, endH).
 */
function animateBar(bar, startY, endY, endH, duration) {
  const start = performance.now();
  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    const e = 1 - Math.pow(1 - t, 3);
    bar.setAttribute('y', startY + (endY - startY) * e);
    bar.setAttribute('height', endH * e);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* MOBILE SIDEBAR                                                             */
/* ══════════════════════════════════════════════════════════════════════════ */

function closeMobileSidebar() {
  $('sidebar').classList.remove('sidebar--open');
  $('sidebar-overlay').classList.remove('visible');
}

$('sidebar-toggle')?.addEventListener('click', () => {
  $('sidebar').classList.toggle('sidebar--open');
  $('sidebar-overlay').classList.toggle('visible');
});

$('sidebar-overlay')?.addEventListener('click', closeMobileSidebar);

/* ══════════════════════════════════════════════════════════════════════════ */
/* BOOT                                                                       */
/* ══════════════════════════════════════════════════════════════════════════ */
(function init() {
  /* Set explicit display — CSS display:flex on both containers overrides [hidden] */
  $('login-screen').style.display = 'none';
  $('admin-screen').style.display = 'none';

  if (token) {
    showAdmin();
    bootAdmin();
  } else {
    showLogin();
  }
})();
