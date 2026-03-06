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

  /* ── Relative timestamp ── */
  const fmtRelativeDate = (iso) => {
    const now     = Date.now();
    const then    = new Date(iso).getTime();
    const diff    = now - then;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours   = Math.floor(minutes / 60);
    const days    = Math.floor(hours / 24);

    if (seconds < 60)  return 'just now';
    if (minutes < 60)  return `${minutes}m ago`;
    if (hours < 24)    return `${hours}h ago`;
    if (days === 1)    return 'Yesterday';
    if (days < 7)      return `${days} days ago`;

    return new Date(iso).toLocaleString('en-IN', {
      timeZone: tz,
      dateStyle: 'medium',
    });
  };

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

    /* Topbar business name */
    const nameEl = $('biz-name');
    if (nameEl) nameEl.textContent = biz.name ?? '';

    /* Overview section greeting as section-title */
    const greetEl = $('greeting');
    if (greetEl) greetEl.textContent = buildGreeting();

    /* Sub-label under greeting */
    const subEl = $('biz-name-sub');
    if (subEl) {
      const parts = [];
      if (biz.city)     parts.push(biz.city);
      if (biz.country)  parts.push(biz.country);
      if (biz.industry) parts.push(biz.industry.charAt(0).toUpperCase() + biz.industry.slice(1));
      subEl.textContent = parts.join(' · ');
    }

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
    const dur   = 400;
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
    if (!window.matchMedia('(hover: hover)').matches) return;

    card.addEventListener('mousemove', (e) => {
      const r  = card.getBoundingClientRect();
      const dx = ((e.clientX - r.left)  / r.width  - 0.5) * 2;
      const dy = ((e.clientY - r.top)   / r.height - 0.5) * 2;
      const rx = dy * -6;
      const ry = dx *  6;
      const sx = dx * -8;
      const sy = dy *  8;
      card.style.transform = `perspective(600px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(6px)`;
      card.style.boxShadow = `${sx}px ${sy}px 28px rgba(0,0,0,0.5), 0 0 0 1px rgba(245,158,11,0.08)`;
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

  /* ── Priority badge ── */
  function buildPriorityBadge(priority) {
    const cls = priority === 'HIGH'   ? 'badge--hot'
              : priority === 'NORMAL' ? 'badge--warm'
              :                         'badge--normal';
    return `<span class="priority-badge ${cls}">${esc(priority || 'LOW')}</span>`;
  }

  /* ── Row builders ── */
  function buildLeadRow(lead, isNew = false) {
    const tr = document.createElement('tr');
    tr.dataset.leadId = lead.id;
    if (isNew) tr.classList.add('row-enter');

    const tags    = Array.isArray(lead.tags) ? lead.tags : [];
    const tagHtml = tags.length
      ? `<div class="tag-chips">${tags.map((t) => `<span class="tag-chip">${esc(t)}</span>`).join('')}</div>`
      : '';

    tr.innerHTML = `
      <td><button class="lead-name-btn" data-lead-id="${esc(lead.id)}">${esc(lead.name)}</button></td>
      <td>${esc(lead.phone)}</td>
      <td>${esc(lead.email || '—')}</td>
      <td>${buildStatusSelect(lead.id, lead.status, config.leadStatuses)}</td>
      <td>${buildPriorityBadge(lead.priority)}</td>
      <td><span class="score-val">${esc(String(lead.priorityScore ?? 0))}</span>${tagHtml}</td>
      <td class="td-reltime" title="${esc(fmtDate(lead.createdAt))}">${esc(fmtRelativeDate(lead.createdAt))}</td>
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
     SVG LINE CHART — leads by day with animated draw
  ───────────────────────────────────────────── */
  function renderChart(data) {
    const container = $('chart-container');
    if (!container) return;

    if (!data || !data.length) {
      container.innerHTML = '<p class="chart-empty">No leads in the last 7 days.</p>';
      return;
    }

    const max  = Math.max(...data.map((d) => d.count), 1);
    const W    = 400;
    const H    = 96;
    const padL = 6;
    const padR = 6;
    const padT = 16;
    const plotW = W - padL - padR;
    const plotH = H - padT;

    /* Compute SVG point coords */
    const pts = data.map((d, i) => ({
      x:     padL + (data.length > 1 ? (i / (data.length - 1)) * plotW : plotW / 2),
      y:     padT + plotH - (d.count / max) * plotH,
      count: d.count,
      date:  d.date,
    }));

    const linePath  = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const areaPath  = `${linePath} L ${pts[pts.length - 1].x.toFixed(1)} ${H} L ${pts[0].x.toFixed(1)} ${H} Z`;

    const labels = pts.map((p) => {
      const label = new Date(p.date + 'T12:00:00').toLocaleDateString('en-IN', {
        timeZone: tz, weekday: 'short',
      });
      return `<text x="${p.x.toFixed(1)}" y="${H + 14}" class="chart-label" text-anchor="middle">${esc(label)}</text>`;
    }).join('');

    const dots = pts.map((p, i) => `
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" class="chart-dot" style="--dot-i:${i}" />
      ${p.count > 0 ? `<text x="${p.x.toFixed(1)}" y="${(p.y - 8).toFixed(1)}" class="chart-val" text-anchor="middle">${p.count}</text>` : ''}`
    ).join('');

    container.innerHTML = `
      <svg viewBox="0 0 ${W} ${H + 20}" class="leads-chart" role="img" aria-label="Leads per day">
        <defs>
          <linearGradient id="lineAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="var(--accent)" stop-opacity="0.22"/>
            <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.01"/>
          </linearGradient>
        </defs>
        <path d="${areaPath}" fill="url(#lineAreaGrad)" />
        <path d="${linePath}" fill="none" stroke="var(--accent)" stroke-width="2"
              stroke-linejoin="round" stroke-linecap="round" class="chart-line" />
        ${dots}
        ${labels}
      </svg>`;

    /* Animate: draw line, then fade in dots */
    requestAnimationFrame(() => {
      const line = container.querySelector('.chart-line');
      if (line) {
        const len = line.getTotalLength ? line.getTotalLength() : 1200;
        line.style.strokeDasharray  = `${len}`;
        line.style.strokeDashoffset = `${len}`;
        line.classList.add('chart-line--animate');
      }
      container.querySelectorAll('.chart-dot').forEach((dot, i) => {
        setTimeout(() => dot.classList.add('chart-dot--visible'), 300 + i * 60);
      });
    });
  }

  /* ─────────────────────────────────────────────
     SVG DONUT CHART — lead status distribution
  ───────────────────────────────────────────── */
  const DONUT_COLORS = {
    NEW:       '#F59E0B',
    CONTACTED: '#D97706',
    QUALIFIED: '#92400E',
    WON:       '#22C55E',
    LOST:      '#71717A',
  };
  const DONUT_DEFAULT = '#4B5563';

  function renderDonutChart(leads) {
    const container = $('donut-container');
    if (!container) return;

    const total = leads.length;
    if (!total) {
      container.innerHTML = '<p class="chart-empty">No lead data yet.</p>';
      return;
    }

    /* Tally statuses */
    const counts = {};
    leads.forEach((l) => { counts[l.status] = (counts[l.status] || 0) + 1; });

    const size         = 130;
    const cx           = size / 2;
    const cy           = size / 2;
    const r            = 46;
    const circumference = 2 * Math.PI * r;

    /* Sort by count descending */
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    let offset = 0;
    const segments = entries.map(([status, count]) => {
      const pct   = count / total;
      const dash  = pct * circumference;
      const color = DONUT_COLORS[status] ?? DONUT_DEFAULT;
      const seg   = { status, count, dash, offset, color };
      offset += dash;
      return seg;
    });

    const svgSegments = segments.map((seg) => `
      <circle
        class="donut-segment"
        cx="${cx}" cy="${cy}" r="${r}"
        fill="none"
        stroke="${seg.color}"
        stroke-width="18"
        stroke-dasharray="${seg.dash.toFixed(2)} ${(circumference - seg.dash).toFixed(2)}"
        stroke-dashoffset="${(circumference - seg.offset).toFixed(2)}"
        transform="rotate(-90 ${cx} ${cy})"
      />`).join('');

    const legend = segments.map((seg, i) => `
      <div class="donut-legend-item" style="--legend-i:${i}">
        <span class="donut-legend-dot" style="background:${seg.color}"></span>
        <span class="donut-legend-label">${esc(seg.status)}</span>
        <span class="donut-legend-count">${seg.count}</span>
      </div>`).join('');

    container.innerHTML = `
      <div class="donut-wrap">
        <div class="donut-svg-wrap">
          <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="donut-svg" role="img" aria-label="Lead status distribution">
            <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="18" />
            ${svgSegments}
            <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="donut-center-num">${total}</text>
            <text x="${cx}" y="${cy + 14}" text-anchor="middle" class="donut-center-label">Leads</text>
          </svg>
        </div>
        <div class="donut-legend">
          ${legend}
        </div>
      </div>`;

    /* Stagger-animate segments in */
    requestAnimationFrame(() => {
      container.querySelectorAll('.donut-segment').forEach((seg, i) => {
        setTimeout(() => seg.classList.add('donut-segment--visible'), i * 80 + 60);
      });
    });
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
    fmtRelativeDate,
    fmtCurrency,
    applyMood,
    renderBizHeader,
    renderStats,
    renderColumns,
    renderChart,
    renderDonutChart,
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
    card.style.transition = 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)';
    card.style.transform  = '';
    setTimeout(() => { card.style.transition = ''; }, 620);
  });
}());
