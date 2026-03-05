/**
 * lead-activity.js — Lead Activity Timeline page.
 *
 * Reads leadId from URL: /dashboard/lead-activity.html?leadId=abc123
 * Reads auth token from localStorage (written by dashboard.js on login).
 * Fetches GET /api/leads/:id/activity
 * Renders a vertical timeline of agent + system events.
 */

import { API_BASE_URL } from './config.js';

/* ── Auth guard ─────────────────────────────────────────────────────────── */
const token = localStorage.getItem('dash_token');
if (!token) {
  window.location.href = '/dashboard/';
}

/* ── Read leadId from URL ────────────────────────────────────────────────── */
const params = new URLSearchParams(window.location.search);
const leadId = params.get('leadId');

if (!leadId) {
  renderError('No leadId in URL. Go back and click a lead\'s timeline link.');
}

/* ── API helpers ─────────────────────────────────────────────────────────── */
const authHeaders = () => ({ Authorization: `Bearer ${token}` });

async function fetchActivity(id) {
  const res = await fetch(`${API_BASE_URL}/api/admin/leads/${id}/activity`, {
    headers: authHeaders(),
  });
  if (res.status === 401) {
    localStorage.removeItem('dash_token');
    window.location.href = '/dashboard/';
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data; /* expected: { lead, activities } or activities[] */
}

/* ── Activity type config ───────────────────────────────────────────────── */
const ACTIVITY_MAP = {
  LEAD_CREATED: {
    label: 'Lead created',
    icon: '📋',
    dotClass: 'tl-dot--created',
  },
  AGENT_CLASSIFIED: {
    label: 'Agent classified lead',
    icon: '🏷️',
    dotClass: 'tl-dot--classified',
  },
  AGENT_PRIORITIZED: {
    label: 'Priority score assigned',
    icon: '⚡',
    dotClass: 'tl-dot--prioritized',
  },
  FOLLOW_UP_SCHEDULED: {
    label: 'Follow-up scheduled',
    icon: '📅',
    dotClass: 'tl-dot--followup',
  },
  STATUS_CHANGED: {
    label: 'Status updated',
    icon: '🔄',
    dotClass: 'tl-dot--default',
  },
};

function resolveType(type) {
  return ACTIVITY_MAP[type] ?? {
    label: type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
    icon: '●',
    dotClass: 'tl-dot--default',
  };
}

/* ── Metadata rendering ─────────────────────────────────────────────────── */
/**
 * Returns an HTML string for the metadata section of a card.
 * Handles the known shapes; falls back to generic key-value pairs.
 *
 * Known shapes:
 *   AGENT_CLASSIFIED    → { tags: string[] }
 *   AGENT_PRIORITIZED   → { score: number }
 *   FOLLOW_UP_SCHEDULED → { inMinutes?: number, scheduledAt?: string }
 */
function renderMeta(type, meta) {
  if (!meta || typeof meta !== 'object') return '';

  /* AGENT_CLASSIFIED — show tags as pills */
  if (type === 'AGENT_CLASSIFIED') {
    const tags = Array.isArray(meta.tags) ? meta.tags : [];
    if (!tags.length) return '';
    const pills = tags
      .map((t) => `<span class="tl-meta__pill">${escHtml(t)}</span>`)
      .join('');
    return `<div class="tl-meta">${pills}</div>`;
  }

  /* AGENT_PRIORITIZED — score badge (AgentEngine stores as priorityScore) */
  if (type === 'AGENT_PRIORITIZED') {
    const score = meta.priorityScore ?? meta.score;
    if (score == null) return '';
    return `
      <div class="tl-meta">
        <span class="tl-meta__kv">
          <span class="tl-meta__kv-label">Score:</span>
          <span class="tl-meta__kv-value">${escHtml(String(score))}</span>
        </span>
      </div>`;
  }

  /* FOLLOW_UP_SCHEDULED — show relative time or absolute time */
  if (type === 'FOLLOW_UP_SCHEDULED') {
    let parts = [];
    if (meta.inMinutes != null) {
      parts.push(`<span class="tl-meta__kv">
        <span class="tl-meta__kv-label">In:</span>
        <span class="tl-meta__kv-value">${escHtml(String(meta.inMinutes))} minutes</span>
      </span>`);
    }
    if (meta.scheduledAt) {
      const fmt = formatDateTime(meta.scheduledAt);
      parts.push(`<span class="tl-meta__kv">
        <span class="tl-meta__kv-label">At:</span>
        <span class="tl-meta__kv-value">${escHtml(fmt)}</span>
      </span>`);
    }
    if (!parts.length) return '';
    return `<div class="tl-meta">${parts.join('')}</div>`;
  }

  /* Generic fallback — render every non-null key as a kv pair */
  const entries = Object.entries(meta).filter(([, v]) => v != null);
  if (!entries.length) return '';
  const kvs = entries.map(([k, v]) => `
    <span class="tl-meta__kv">
      <span class="tl-meta__kv-label">${escHtml(humanKey(k))}:</span>
      <span class="tl-meta__kv-value">${escHtml(String(v))}</span>
    </span>`).join('');
  return `<div class="tl-meta">${kvs}</div>`;
}

/* ── Timeline rendering ─────────────────────────────────────────────────── */
/**
 * Builds the full timeline HTML from an array of activity objects.
 *
 * Each activity is expected to have:
 *   { id, type, createdAt, metadata? }
 *
 * Rendering flow:
 *   1. Sort activities by createdAt ascending (oldest first → newest last).
 *   2. For each activity, resolve its display label, icon, and dot colour
 *      from ACTIVITY_MAP (or fall back to a humanised version of the type string).
 *   3. Build a .tl-item containing:
 *      - .tl-dot  — coloured circle icon on the vertical line
 *      - .tl-card — card with event name, timestamp, and parsed metadata
 *   4. Stagger the card entrance animations via CSS animation-delay.
 */
function buildTimeline(activities) {
  const sorted = [...activities].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  );

  return sorted.map((act, i) => {
    const { label, icon, dotClass } = resolveType(act.type);
    const time = formatDateTime(act.createdAt);
    const metaHtml = renderMeta(act.type, act.metadata);

    const msgHtml = act.message
      ? `<p class="tl-card__msg">${escHtml(act.message)}</p>`
      : '';

    return `
      <div class="tl-item" style="animation-delay:${i * 60}ms">
        <div class="tl-dot ${escHtml(dotClass)}" aria-hidden="true">${icon}</div>
        <div class="tl-card">
          <div class="tl-card__head">
            <span class="tl-card__event">${escHtml(label)}</span>
            <span class="tl-card__time">${escHtml(time)}</span>
          </div>
          ${msgHtml}
          ${metaHtml}
        </div>
      </div>`;
  }).join('');
}

/* ── DOM helpers ────────────────────────────────────────────────────────── */
function setRoot(html) {
  document.getElementById('timeline-root').innerHTML = html;
}

function renderLoading() {
  setRoot(`
    <div class="activity-loading">
      <div class="activity-loading__spinner"></div>
      Loading timeline…
    </div>`);
}

function renderError(msg) {
  setRoot(`<p class="activity-error">Error: ${escHtml(msg)}</p>`);
}

function renderEmpty() {
  setRoot(`
    <div class="activity-empty">
      <div class="activity-empty__icon">📭</div>
      <p>No activity recorded for this lead yet.</p>
    </div>`);
}

function renderLeadMeta(lead) {
  if (!lead) return;
  const metaEl  = document.getElementById('lead-meta');
  const nameEl  = document.getElementById('leadName');
  const phoneEl = document.getElementById('leadPhone');
  if (nameEl)  nameEl.textContent  = lead.name ?? 'Unknown lead';
  if (phoneEl) phoneEl.textContent = lead.phone ?? '';
  if (metaEl)  metaEl.classList.remove('hidden');
}

/* ── Utilities ──────────────────────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Convert camelCase / snake_case key to "Human Label" */
function humanKey(key) {
  return key
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^\s+/, '')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

/* ── Boot ───────────────────────────────────────────────────────────────── */
async function boot() {
  if (!leadId) return; /* error already rendered above */

  renderLoading();

  try {
    const payload = await fetchActivity(leadId);

    /*
     * API may return either:
     *   { lead, activities }   — preferred shape (includes lead meta)
     *   activities[]           — bare array fallback
     */
    let activities;
    let lead = null;

    if (Array.isArray(payload)) {
      activities = payload;
    } else {
      activities = payload.activities ?? [];
      lead       = payload.lead ?? null;
    }

    renderLeadMeta(lead);

    if (!activities.length) {
      renderEmpty();
      return;
    }

    setRoot(`<div class="timeline">${buildTimeline(activities)}</div>`);

  } catch (err) {
    console.error('[LeadActivity] fetch failed:', err);
    renderError(err.message ?? 'Could not load activity.');
  }
}

boot();
