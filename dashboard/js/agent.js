/**
 * agent.js — AgentConfig editor page.
 *
 * Reads token from sessionStorage (written by dashboard.js on login).
 * Calls GET /api/agent to populate the form.
 * Calls PUT /api/agent on save.
 *
 * No global state. No framework. ES module.
 */

import { API_BASE_URL } from './config.js';

/* ── Auth guard ─────────────────────────────────────────────────────────── */
const token = sessionStorage.getItem('dash_token');
if (!token) {
  window.location.href = '/dashboard/';
  throw new Error('Not authenticated');
}

/* ── API helpers ─────────────────────────────────────────────────────────── */
const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
});

async function fetchConfig() {
  const res = await fetch(`${API_BASE_URL}/api/agent`, {
    method: 'GET',
    headers: headers(),
  });
  if (res.status === 401) {
    sessionStorage.removeItem('dash_token');
    window.location.href = '/dashboard/';
  }
  if (!res.ok) throw new Error(`GET /api/agent → ${res.status}`);
  return res.json();
}

async function saveConfig(body) {
  const res = await fetch(`${API_BASE_URL}/api/agent`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    sessionStorage.removeItem('dash_token');
    window.location.href = '/dashboard/';
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ── DOM helpers ─────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

function showStatus(msg, type /* 'ok' | 'err' */) {
  const el = $('status-banner');
  el.textContent = msg;
  el.className = `status-banner status-banner--${type}`;
  if (type === 'ok') setTimeout(() => { el.className = 'status-banner'; }, 4000);
}

/* ── Classification rules ─────────────────────────────────────────────────
   Each row:  TAG_NAME | keyword1, keyword2, ...  | ✕
─────────────────────────────────────────────────────────────────────────── */
function makeClassRow(tag = '', keywords = '') {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="class-tag"  placeholder="TAG_NAME"  value="${esc(tag)}"      /></td>
    <td><input type="text" class="class-kws"  placeholder="demo, trial, walkthrough" value="${esc(keywords)}" /></td>
    <td><button type="button" class="btn-remove" title="Remove">✕</button></td>
  `;
  tr.querySelector('.btn-remove').addEventListener('click', () => tr.remove());
  return tr;
}

function populateClassRules(classificationRules) {
  const tbody = $('class-tbody');
  tbody.innerHTML = '';
  const keywords = classificationRules?.keywords ?? {};
  for (const [tag, kws] of Object.entries(keywords)) {
    tbody.appendChild(makeClassRow(tag, Array.isArray(kws) ? kws.join(', ') : ''));
  }
  if (tbody.children.length === 0) {
    tbody.appendChild(makeClassRow());
  }
}

function readClassRules() {
  const rows = $('class-tbody').querySelectorAll('tr');
  const keywords = {};
  rows.forEach((tr) => {
    const tag = tr.querySelector('.class-tag').value.trim().toUpperCase().replace(/\s+/g, '_');
    const kws = tr.querySelector('.class-kws').value
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (tag && kws.length) keywords[tag] = kws;
  });
  return { keywords };
}

/* ── Priority rules ────────────────────────────────────────────────────────
   Each row:  keyword | score  | ✕
─────────────────────────────────────────────────────────────────────────── */
function makePrioRow(keyword = '', weight = '') {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text"   class="prio-kw"     placeholder="urgent"  value="${esc(keyword)}"      /></td>
    <td><input type="number" class="prio-weight"  placeholder="30"      value="${esc(String(weight))}" min="0" max="1000" /></td>
    <td><button type="button" class="btn-remove" title="Remove">✕</button></td>
  `;
  tr.querySelector('.btn-remove').addEventListener('click', () => tr.remove());
  return tr;
}

function populatePrioRules(priorityRules) {
  const tbody = $('prio-tbody');
  tbody.innerHTML = '';
  const weights = priorityRules?.weights ?? {};
  for (const [kw, w] of Object.entries(weights)) {
    tbody.appendChild(makePrioRow(kw, w));
  }
  if (tbody.children.length === 0) {
    tbody.appendChild(makePrioRow());
  }
}

function readPrioRules() {
  const rows = $('prio-tbody').querySelectorAll('tr');
  const weights = {};
  rows.forEach((tr) => {
    const kw  = tr.querySelector('.prio-kw').value.trim().toLowerCase();
    const raw = parseFloat(tr.querySelector('.prio-weight').value);
    if (kw && !isNaN(raw)) weights[kw] = raw;
  });
  return { weights };
}

/* ── Escape helper (no XSS in value attrs) ───────────────────────────────── */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ── Init ─────────────────────────────────────────────────────────────────── */
async function init() {
  try {
    const config = await fetchConfig();

    $('followUpMinutes').value = config.followUpMinutes ?? 30;
    populateClassRules(config.classificationRules);
    populatePrioRules(config.priorityRules);
  } catch (err) {
    console.error('[agent.js] init failed:', err);
    showStatus('Failed to load config. Check console.', 'err');
  }
}

/* ── Add-row buttons ─────────────────────────────────────────────────────── */
$('btn-add-class').addEventListener('click', () => {
  $('class-tbody').appendChild(makeClassRow());
});

$('btn-add-prio').addEventListener('click', () => {
  $('prio-tbody').appendChild(makePrioRow());
});

/* ── Save ─────────────────────────────────────────────────────────────────── */
$('btn-save').addEventListener('click', async () => {
  const btn = $('btn-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const followUpMinutes     = parseInt($('followUpMinutes').value, 10);
  const classificationRules = readClassRules();
  const priorityRules       = readPrioRules();

  if (!Number.isInteger(followUpMinutes) || followUpMinutes < 1 || followUpMinutes > 1440) {
    showStatus('Follow-up minutes must be between 1 and 1440.', 'err');
    btn.disabled = false;
    btn.textContent = 'Save changes';
    return;
  }

  try {
    await saveConfig({ followUpMinutes, classificationRules, priorityRules });
    showStatus('Config saved. New leads will use these rules immediately.', 'ok');
  } catch (err) {
    console.error('[agent.js] save failed:', err);
    showStatus(err.message || 'Save failed. Check console.', 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save changes';
  }
});

/* ── Boot ─────────────────────────────────────────────────────────────────── */
init();
