/**
 * ui.js — All DOM rendering and animation for the admin dashboard.
 *
 * Exports DashUI(config) where config = response from GET /api/admin/config.
 * Zero API calls — purely presentation and motion.
 */

export function DashUI(config) {

  /* ── Formatting helpers ── */
  const tz  = config.business?.timezone ?? 'Asia/Kolkata';
  const cur = config.business?.currency ?? 'INR';

  const esc = (str) => {
    const d = document.createElement('div');
    d.textContent = String(str ?? '');
    return d.innerHTML;
  };

  const fmtDate = (iso) =>
    new Date(iso).toLocaleString('en-IN', {
      timeZone:  tz,
      dateStyle: 'medium',
      timeStyle: 'short',
    });

  const fmtCurrency = (amount) => {
    if (amount == null) return '—';
    try {
      return new Intl.NumberFormat('en-IN', {
        style:    'currency',
        currency: cur,
        maximumFractionDigits: 0,
      }).format(amount);
    } catch {
      return `₹${Number(amount).toLocaleString('en-IN')}`;
    }
  };

  /* ── DOM helpers ── */
  const $ = (id) => document.getElementById(id);

  /* ── Greeting ── */
  function buildGreeting() {
    const biz  = config.business;
    if (!biz) return '';
    const hour = new Date().toLocaleString('en-IN', { timeZone: tz, hour: 'numeric', hour12: false });
    const h    = parseInt(hour, 10);
    const tod  = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const loc  = biz.city ? ` (${biz.city})` : '';
    return `${tod}, ${biz.name}${loc}`;
  }

  /* ── Mood / industry theme ── */
  function applyMood() {
    document.body.dataset.mood = config.mood ?? 'default';
  }

  /* ── Business header ── */
  function renderBizHeader() {
    const biz = config.business;
    if (!biz) return;

    const nameEl = $('biz-name');
    if (nameEl) nameEl.textContent = biz.name ?? '';

    const greetEl = $('greeting');
    if (greetEl) greetEl.textContent = buildGreeting();

    const logoEl = $('biz-logo');
    if (logoEl) {
      if (biz.logoUrl) {
        logoEl.src           = biz.logoUrl;
        logoEl.alt           = biz.name ?? 'Logo';
        logoEl.style.display = 'inline-block';
      } else {
        logoEl.style.display = 'none';
      }
    }
  }

  /* ── Skeleton loaders ── */
  function showSkeletonStats(n) {
    $('stats-grid').innerHTML = Array(n ?? config.statCards.length).fill(0).map(() => `
      <div class="stat-card">
        <div class="skeleton skeleton--sm" style="margin-bottom:0.5rem"></div>
        <div class="skeleton" style="width:55%;height:2.25rem;border-radius:0.4rem"></div>
      </div>`).join('');
  }

  function showSkeletonRows(tbodyId, dataCols) {
    const cell = () => '<td><div class="skeleton"></div></td>';
    $(tbodyId).innerHTML = Array(5).fill(0).map(() =>
      `<tr>${Array(dataCols).fill(0).map(cell).join('')}<td></td></tr>`
    ).join('');
  }

  /* ── Count-up animation ── */
  function countUp(el, target) {
    if (!el) return;
    const from  = parseInt(el.textContent, 10) || 0;
    const dur   = 700;
    const start = Date.now();
    const tick  = () => {
      const p    = Math.min((Date.now() - start) / dur, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (target - from) * ease);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* ─────────────────────────────────────────────
     3D CARD TILT — mouse-tracked perspective tilt
  ───────────────────────────────────────────── */
  function initCardTilt(card) {
    /* Skip on touch devices — CSS media query handles the static case */
    if (!window.matchMedia('(hover: hover)').matches) return;

    card.addEventListener('mousemove', (e) => {
      const r  = card.getBoundingClientRect();
      const dx = ((e.clientX - r.left)  / r.width  - 0.5) * 2;
      const dy = ((e.clientY - r.top)   / r.height - 0.5) * 2;
      const rx = dy * -7;
      const ry = dx *  7;
      /* Dynamic shadow follows inverse of tilt direction */
      const sx = dx * -10;
      const sy = dy *  10;
      card.style.transform = `perspective(600px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(6px)`;
      card.style.boxShadow = `${sx}px ${sy}px 28px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.07)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
      card.style.boxShadow = '';
    });
  }

  /* ── Stats ── */
  function renderStats(summary) {
    const grid = $('stats-grid');
    grid.innerHTML = '';
    config.statCards.forEach(({ key, label }, index) => {
      const card = document.createElement('div');
      card.className = 'stat-card';
      /* Stagger entrance animation */
      card.style.setProperty('--card-index', String(index));

      const lbl = document.createElement('span');
      lbl.className   = 'stat-card__label';
      lbl.textContent = label;

      const val = document.createElement('span');
      val.className    = 'stat-card__value';
      val.dataset.stat = key;
      val.textContent  = '0';

      card.append(lbl, val);
      grid.appendChild(card);
      countUp(val, summary[key] ?? 0);

      /* Wire 3D tilt after card is in DOM */
      initCardTilt(card);
    });
  }

  /* ── Stat helpers ── */
  const getStat = (key) => {
    const el = document.querySelector(`[data-stat="${key}"]`);
    return el ? (parseInt(el.textContent, 10) || 0) : 0;
  };

  const updateStat = (key, value) => {
    const el = document.querySelector(`[data-stat="${key}"]`);
    if (el) countUp(el, value);
  };

  /* ── Table column headers ── */
  function renderColumns(theadId, cols) {
    const tr = $(theadId);
    if (!tr) return;
    tr.innerHTML = cols.map((c) => `<th>${esc(c)}</th>`).join('') + '<th></th>';
  }

  /* ── Status select ── */
  function buildStatusSelect(id, currentStatus, statuses) {
    const sc   = `status--${currentStatus.toLowerCase()}`;
    const opts = statuses
      .map((s) => `<option value="${s}"${s === currentStatus ? ' selected' : ''}>${s}</option>`)
      .join('');
    return `<select class="status-select ${sc}" data-id="${esc(id)}">${opts}</select>`;
  }

  /* ── Row builders ── */
  function buildLeadRow(lead, isNew = false) {
    const tr = document.createElement('tr');
    tr.dataset.leadId = lead.id;
    if (isNew) tr.classList.add('row-enter');

    tr.innerHTML = `
      <td>${esc(lead.name)}</td>
      <td>${esc(lead.phone)}</td>
      <td>${esc(lead.email || '—')}</td>
      <td>${buildStatusSelect(lead.id, lead.status, config.leadStatuses)}</td>
      <td>${fmtDate(lead.createdAt)}</td>
      <td style="white-space:nowrap">
        <a class="btn-timeline" href="/dashboard/lead-activity.html?leadId=${esc(lead.id)}" title="View timeline">⏱</a>
        <button class="btn-delete" data-id="${esc(lead.id)}" title="Delete">🗑</button>
      </td>
    `;
    return tr;
  }

  function buildApptRow(appt) {
    const tr = document.createElement('tr');
    tr.dataset.apptId = appt.id;
    tr.classList.add('row-enter');

    tr.innerHTML = `
      <td>${esc(appt.customerName)}</td>
      <td>${esc(appt.phone)}</td>
      <td>${fmtDate(appt.scheduledAt)}</td>
      <td>${buildStatusSelect(appt.id, appt.status, config.appointmentStatuses)}</td>
      <td>${esc(appt.notes || '—')}</td>
      <td><button class="btn-delete" data-id="${esc(appt.id)}" title="Delete">🗑</button></td>
    `;
    return tr;
  }

  function buildServiceRow(svc) {
    const tr = document.createElement('tr');
    tr.dataset.serviceId = svc.id;
    tr.classList.add('row-enter');

    tr.innerHTML = `
      <td>${esc(svc.title)}</td>
      <td class="td-desc">${esc(svc.description || '—')}</td>
      <td>${fmtCurrency(svc.priceInr)}</td>
      <td>${fmtDate(svc.createdAt)}</td>
      <td class="td-actions">
        <button class="btn-edit"   data-id="${esc(svc.id)}" title="Edit">✏️</button>
        <button class="btn-delete" data-id="${esc(svc.id)}" title="Delete">🗑</button>
      </td>
    `;
    return tr;
  }

  function buildTestimonialRow(t) {
    const tr = document.createElement('tr');
    tr.dataset.testimonialId = t.id;
    tr.classList.add('row-enter');

    const stars = t.rating
      ? '★'.repeat(t.rating) + '☆'.repeat(5 - t.rating)
      : '—';

    tr.innerHTML = `
      <td>${esc(t.customerName)}</td>
      <td class="td-desc">${esc(t.text)}</td>
      <td class="td-stars">${stars}</td>
      <td>${fmtDate(t.createdAt)}</td>
      <td><button class="btn-delete" data-id="${esc(t.id)}" title="Delete">🗑</button></td>
    `;
    return tr;
  }

  /* ─────────────────────────────────────────────
     SVG BAR CHART — leads by day with animated entry
  ───────────────────────────────────────────── */
  function animateChartBars() {
    document.querySelectorAll('.chart-bar rect').forEach((rect, i) => {
      setTimeout(() => rect.classList.add('bar--visible'), i * 90);
    });
  }

  function renderChart(data) {
    const container = $('chart-container');
    if (!container) return;

    if (!data || !data.length) {
      container.innerHTML = '<p class="chart-empty">No leads in the last 7 days.</p>';
      return;
    }

    const max = Math.max(...data.map((d) => d.count), 1);
    const W   = 300;
    const H   = 90;
    const gap = 5;
    const bw  = Math.floor((W - gap * (data.length - 1)) / data.length);

    const bars = data.map((d, i) => {
      const bh    = Math.max(Math.round((d.count / max) * H), d.count > 0 ? 4 : 1);
      const x     = i * (bw + gap);
      const y     = H - bh;
      const label = new Date(d.date + 'T12:00:00').toLocaleDateString('en-IN', {
        timeZone: tz, weekday: 'short',
      });
      return `
        <g class="chart-bar" title="${label}: ${d.count}">
          <rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="3" ry="3" />
          <text x="${x + bw / 2}" y="${H + 14}" class="chart-label" text-anchor="middle">${esc(label)}</text>
          ${d.count > 0 ? `<text x="${x + bw / 2}" y="${y - 4}" class="chart-val" text-anchor="middle">${d.count}</text>` : ''}
        </g>`;
    }).join('');

    container.innerHTML = `
      <svg viewBox="0 0 ${W} ${H + 22}" class="leads-chart" role="img" aria-label="Leads per day">
        ${bars}
      </svg>`;

    /* Stagger bar entrance after next paint */
    requestAnimationFrame(animateChartBars);
  }

  /* ── Row animation helpers ── */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function animateRowOut(row) {
    if (!row) return;
    row.classList.add('row-exit');
    await wait(260);
    row.style.maxHeight  = row.offsetHeight + 'px';
    row.style.overflow   = 'hidden';
    row.style.transition = 'max-height 0.22s ease, opacity 0.22s ease';
    requestAnimationFrame(() => { row.style.maxHeight = '0'; row.style.opacity = '0'; });
    await wait(240);
  }

  function applyStatusPulse(select) {
    select.classList.remove('status-pulse');
    void select.offsetWidth;
    select.classList.add('status-pulse');
    select.addEventListener('animationend', () => select.classList.remove('status-pulse'), { once: true });
  }

  /* ── Empty row placeholder ── */
  function checkEmpty(tbodyId, dataCols, msg = 'No items yet.') {
    const tbody = $(tbodyId);
    if (tbody && !tbody.querySelector('tr:not(.empty-row)')) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${dataCols + 1}" class="empty">${esc(msg)}</td></tr>`;
    }
  }

  function prependRow(tbodyId, row) {
    const tbody = $(tbodyId);
    const empty = tbody.querySelector('.empty-row');
    if (empty) empty.remove();
    tbody.insertBefore(row, tbody.firstChild);
  }

  /* ── Toast ── */
  function showToast(msg, type = 'info') {
    const el = $('notif');
    el.textContent = msg;
    el.className   = 'notif notif--show' + (type !== 'info' ? ` notif--${type}` : '');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('notif--show'), 3500);
  }

  /* ── Generic create / edit form modal ── */
  let _formHandler = null;
  let _formFields  = [];

  function showFormModal(title, fields, onSubmit, defaults = {}) {
    $('form-modal-title').textContent = title;
    _formHandler = onSubmit;
    _formFields  = fields;

    const container = $('form-modal-fields');
    container.innerHTML = fields.map((f) => {
      const val   = String(defaults[f.name] ?? '');
      const extra = (f.min !== undefined ? ` min="${f.min}"` : '')
                  + (f.max !== undefined ? ` max="${f.max}"` : '');
      const attrs = `id="fm-${f.name}" name="${f.name}"${extra}${f.required ? ' required' : ''}`;
      const input = f.type === 'textarea'
        ? `<textarea ${attrs}>${esc(val)}</textarea>`
        : `<input ${attrs} type="${f.type}" value="${esc(val)}">`;
      return `<div class="form-group"><label for="fm-${f.name}">${esc(f.label)}</label>${input}</div>`;
    }).join('');

    $('form-modal').classList.remove('hidden');
    container.querySelector('input,textarea')?.focus();
  }

  $('form-modal-cancel').addEventListener('click', () =>
    $('form-modal').classList.add('hidden')
  );

  $('form-modal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw  = new FormData(e.target);
    const data = {};

    _formFields.forEach((f) => {
      const v = raw.get(f.name);
      if (v === null || v === '') return;
      data[f.name] = f.type === 'number' ? Number(v) : v;
    });

    const btn = $('form-modal-submit');
    btn.disabled    = true;
    btn.textContent = 'Saving…';

    try {
      await _formHandler(data);
      $('form-modal').classList.add('hidden');
      e.target.reset();
      $('form-modal-fields').innerHTML = '';
    } catch (err) {
      showToast(err.message || 'Could not save', 'error');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Save';
    }
  });

  /* ── Delete modal ── */
  let _pendingDelete = null;

  function showDeleteModal(id, fn, label = 'item') {
    _pendingDelete = { id, fn };
    $('delete-modal-msg').textContent = `Delete this ${label}? This cannot be undone.`;
    $('delete-modal').classList.remove('hidden');
  }

  $('modal-cancel').addEventListener('click', () => {
    $('delete-modal').classList.add('hidden');
    _pendingDelete = null;
  });

  $('modal-confirm').addEventListener('click', async () => {
    $('delete-modal').classList.add('hidden');
    if (!_pendingDelete) return;
    const { id, fn } = _pendingDelete;
    _pendingDelete = null;
    await fn(id);
  });

  /* ── Public API ── */
  return {
    esc,
    fmtDate,
    fmtCurrency,
    applyMood,
    renderBizHeader,
    renderStats,
    renderColumns,
    renderChart,
    buildLeadRow,
    buildApptRow,
    buildServiceRow,
    buildTestimonialRow,
    animateRowOut,
    applyStatusPulse,
    showSkeletonStats,
    showSkeletonRows,
    checkEmpty,
    prependRow,
    countUp,
    getStat,
    updateStat,
    showToast,
    showFormModal,
    showDeleteModal,
  };
}

/* ─────────────────────────────────────────────────────────
   LOGIN CARD 3D TILT
   Runs once at module load (ES modules defer, so DOM is ready).
   Gives the login card a subtle perspective tilt tracking the cursor.
───────────────────────────────────────────────────────── */
(function initLoginCardTilt() {
  const card = document.getElementById('login-card');
  if (!card || !window.matchMedia('(hover: hover)').matches) return;

  card.addEventListener('mousemove', (e) => {
    const r  = card.getBoundingClientRect();
    const dx = ((e.clientX - r.left)  / r.width  - 0.5) * 2;
    const dy = ((e.clientY - r.top)   / r.height - 0.5) * 2;
    card.style.transform = `perspective(900px) rotateX(${dy * -6}deg) rotateY(${dx * 6}deg)`;
  });

  card.addEventListener('mouseleave', () => {
    /* Smooth spring-back */
    card.style.transition = 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)';
    card.style.transform  = '';
    setTimeout(() => { card.style.transition = ''; }, 620);
  });
}());
