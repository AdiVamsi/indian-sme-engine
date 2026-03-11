/**
 * lead-priority.js — AI Lead Priority visualization page.
 *
 * Priority score and tags come from the stored AgentEngine output.
 * This page must never re-score leads locally, otherwise it diverges
 * from the backend LLM classifier.
 */

import { API_BASE_URL } from './config.js';

/* ── Auth guard ──────────────────────────────────────────────────────────── */
const token = localStorage.getItem('dash_token');
if (!token) {
  window.location.href = '/dashboard/';
  throw new Error('Not authenticated');
}

/* ── API helpers ─────────────────────────────────────────────────────────── */
const authHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
});

async function apiFetch(path) {
  const res = await fetch(`${API_BASE_URL}${path}`, { headers: authHeaders() });
  if (res.status === 401) {
    localStorage.removeItem('dash_token');
    window.location.href = '/dashboard/';
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status} — ${path}`);
  }
  return res.json();
}

/* ── Badge helpers ───────────────────────────────────────────────────────── */
function getBadge(score) {
  if (score > 50)  return { label: '🔴 HOT LEAD',  cls: 'badge--hot',    cardCls: 'priority-card--hot'    };
  if (score >= 20) return { label: '🟡 WARM LEAD', cls: 'badge--warm',   cardCls: 'priority-card--warm'   };
  return               { label: '⚪ NORMAL',       cls: 'badge--normal', cardCls: 'priority-card--normal' };
}

/* ── XSS-safe HTML escaping ──────────────────────────────────────────────── */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ── Render ──────────────────────────────────────────────────────────────── */
function buildCard(lead, maxScore, index) {
  const badge    = getBadge(lead.priorityScore);
  /* Normalise bar width against max score in set (min floor = 1 to avoid /0) */
  const barWidth = maxScore > 0 ? Math.round((lead.priorityScore / maxScore) * 100) : 0;

  const tagsHtml = lead.tags.length
    ? lead.tags.map((t) => `<span class="tag-chip">${esc(t)}</span>`).join('')
    : '<span class="tag-chip tag-chip--none">no tags</span>';

  return `
    <div class="priority-card ${badge.cardCls}" style="animation-delay:${index * 55}ms">
      <div class="priority-card__header">
        <span class="priority-card__name">${esc(lead.name)}</span>
        <span class="priority-badge ${badge.cls}">${badge.label}</span>
      </div>
      <div class="priority-card__phone">📞 ${esc(lead.phone)}</div>
      <div class="priority-card__score-row">
        <span class="priority-card__score-label">
          Priority Score: <strong>${lead.priorityScore}</strong>
        </span>
        <div class="score-bar">
          <div class="score-bar__fill" style="width:${barWidth}%"></div>
        </div>
      </div>
      <div class="priority-card__tags">${tagsHtml}</div>
    </div>`;
}

/* ── Init ────────────────────────────────────────────────────────────────── */
async function init() {
  const listEl    = document.getElementById('priority-list');
  const subtitleEl = document.getElementById('subtitle');

  try {
    const leads = await apiFetch('/api/admin/leads');

    const scored = leads.map((lead) => ({
      ...lead,
      priorityScore: Number(lead.priorityScore ?? 0),
      tags: Array.isArray(lead.tags) ? lead.tags : [],
    }));

    /* Sort by priorityScore descending — highest priority at the top */
    scored.sort((a, b) => b.priorityScore - a.priorityScore);

    /* Update subtitle */
    const n = scored.length;
    subtitleEl.textContent = n
      ? `${n} lead${n !== 1 ? 's' : ''} sorted by AI priority score`
      : 'No leads found.';

    if (!n) {
      listEl.innerHTML = `
        <div class="empty-priority">
          <p class="empty-priority__icon">📭</p>
          <p>No leads yet. Share your public enquiry endpoint to start capturing leads.</p>
        </div>`;
      return;
    }

    /* Score bar is relative to the highest score in this set */
    const maxScore = scored[0].priorityScore;

    listEl.innerHTML = `
      <div class="priority-list">
        ${scored.map((lead, i) => buildCard(lead, maxScore, i)).join('')}
      </div>`;

  } catch (err) {
    console.error('[lead-priority] init failed:', err);
    subtitleEl.textContent = '';
    listEl.innerHTML = `
      <div class="error-state">
        Failed to load leads: ${esc(err.message)}.
        <a href="/dashboard/">Return to dashboard</a>
      </div>`;
  }
}

init();
