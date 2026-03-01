'use strict';

/* ─────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

/* ─────────────────────────────────────────────────────────────
   Render: Page meta
───────────────────────────────────────────────────────────── */
function renderMeta() {
  document.title = `${SITE.nav.logo.name} – IIT-JEE Coaching`;
  $('meta-description').content =
    `${SITE.nav.logo.name} – ${SITE.hero.titleLines[0]} ${SITE.hero.titleLines[1]}. ${SITE.about.paragraphs[0].slice(0, 120)}…`;
}

/* ─────────────────────────────────────────────────────────────
   Render: Navigation
───────────────────────────────────────────────────────────── */
function renderNav() {
  $('nav-logo').innerHTML =
    `<span class="nav__logo-icon">${SITE.nav.logo.icon}</span>${SITE.nav.logo.name}`;

  const navLinksEl = $('nav-links');
  navLinksEl.innerHTML =
    SITE.nav.links
      .map(l => `<a href="${l.href}" class="nav__link">${l.label}</a>`)
      .join('') +
    `<a href="#contact" class="btn btn--primary btn--sm nav__cta">${SITE.nav.ctaLabel}</a>`;
}

/* ─────────────────────────────────────────────────────────────
   Render: Hero
───────────────────────────────────────────────────────────── */
function renderHero() {
  const titleHtml = SITE.hero.titleLines
    .map((line, i) =>
      i === SITE.hero.gradientLine
        ? `<span class="hero__gradient-text">${line}</span>`
        : line
    )
    .join('<br />');

  const proofHtml = SITE.hero.proof
    .map((p, i) =>
      (i > 0 ? '<div class="hero__proof-divider" aria-hidden="true"></div>' : '') +
      `<div class="hero__proof-item">
        <strong>${p.value}</strong>
        <span>${p.label}</span>
      </div>`
    )
    .join('');

  $('hero-content').innerHTML = `
    <div class="hero__badge">
      <span class="hero__badge-dot"></span>
      ${SITE.hero.badge}
    </div>
    <h1 class="hero__title">${titleHtml}</h1>
    <p class="hero__sub">${SITE.hero.subtitle}</p>
    <div class="hero__actions">
      <a href="#contact" class="btn btn--accent btn--lg">
        ${SITE.hero.cta.primary} <span class="btn__arrow">→</span>
      </a>
      <a href="#services" class="btn btn--ghost btn--lg">${SITE.hero.cta.secondary}</a>
    </div>
    <div class="hero__proof">${proofHtml}</div>
  `;
}

/* ─────────────────────────────────────────────────────────────
   Render: Stats
───────────────────────────────────────────────────────────── */
function renderStats() {
  $('stats-grid').innerHTML = SITE.stats
    .map((s, i) => `
      <div class="stat animate-fade-up" style="transition-delay:${i * 0.1}s">
        <span class="stat__number" data-target="${s.target}" data-suffix="${s.suffix}">0</span>
        <span class="stat__label">${s.label}</span>
      </div>`)
    .join('');
}

/* ─────────────────────────────────────────────────────────────
   Render: About
───────────────────────────────────────────────────────────── */
function renderAbout() {
  const floatHtml = SITE.about.floatingCards
    .map(f => `
      <div class="about__floating-card pos-${f.pos}">
        <span class="about__floating-icon">${f.icon}</span>
        <div>
          <strong>${f.strong}</strong>
          <span>${f.sub}</span>
        </div>
      </div>`)
    .join('');

  const highlightsHtml = SITE.about.highlights
    .map(h => `
      <div class="about__highlight">
        <span class="about__highlight-icon">✓</span>${h}
      </div>`)
    .join('');

  const parasHtml = SITE.about.paragraphs
    .map(p => `<p>${p}</p>`)
    .join('');

  $('about-content').innerHTML = `
    <div class="about__visual animate-fade-left">
      <div class="about__image-wrap">
        <div class="about__image-placeholder" aria-hidden="true"><span>🎓</span></div>
        ${floatHtml}
      </div>
    </div>
    <div class="about__text-col animate-fade-right">
      <span class="section__label">${SITE.about.label}</span>
      <h2 class="section__title">${SITE.about.title}</h2>
      ${parasHtml}
      <div class="about__highlights">${highlightsHtml}</div>
      <a href="#contact" class="btn btn--primary">${SITE.about.cta}</a>
    </div>
  `;
}

/* ─────────────────────────────────────────────────────────────
   Render: Services cards
───────────────────────────────────────────────────────────── */
function renderServices() {
  $('services-header').innerHTML = `
    <span class="section__label">${SITE.services.label}</span>
    <h2 class="section__title">${SITE.services.title}</h2>
    <p class="section__sub">${SITE.services.subtitle}</p>
  `;

  $('cards-grid').innerHTML = SITE.services.items
    .map((s, i) => {
      const delay = i * 0.1;
      const isFeatured = s.featured;

      const badgeHtml = (isFeatured && s.badge)
        ? `<div class="card__badge">${s.badge}</div>`
        : '';

      const glowHtml = isFeatured
        ? `<div class="card__featured-glow" aria-hidden="true"></div>`
        : `<div class="card__top-accent"></div>
           <div class="card__check" aria-hidden="true">✓</div>`;

      const featuresHtml = s.features
        .map(f => `<li>${f}</li>`)
        .join('');

      const enquireBtn = isFeatured
        ? `<a href="#contact" class="btn btn--white btn--sm">Enquire →</a>`
        : `<a href="#contact" class="btn btn--primary btn--sm">Enquire →</a>`;

      return `
        <div class="card ${isFeatured ? 'card--featured' : 'is-selectable'} animate-fade-up"
             data-programme="${s.title}"
             style="transition-delay:${delay}s">
          ${glowHtml}
          ${badgeHtml}
          <div class="card__icon">${s.icon}</div>
          <h3 class="card__title">${s.title}</h3>
          <p class="card__desc">${s.desc}</p>
          <ul class="card__features">${featuresHtml}</ul>
          <div class="card__footer">
            <div class="card__price-wrap">
              <span class="card__price">${s.price}</span>
              <span class="card__price-period">${s.period}</span>
            </div>
            ${enquireBtn}
          </div>
        </div>`;
    })
    .join('');
}

/* ─────────────────────────────────────────────────────────────
   Render: Testimonials
───────────────────────────────────────────────────────────── */
function renderTestimonials() {
  $('testimonials-header').innerHTML = `
    <span class="section__label">${SITE.testimonials.label}</span>
    <h2 class="section__title">${SITE.testimonials.title}</h2>
    <p class="section__sub">${SITE.testimonials.subtitle}</p>
  `;

  $('testimonials-grid').innerHTML = SITE.testimonials.items
    .map((t, i) => `
      <div class="testimonial animate-fade-up" style="transition-delay:${i * 0.15}s">
        <div class="testimonial__quote-mark" aria-hidden="true">"</div>
        <div class="testimonial__stars" aria-label="${t.stars} stars">
          ${'★'.repeat(t.stars)}
        </div>
        <p class="testimonial__text">${t.text}</p>
        <div class="testimonial__author">
          <div class="avatar" aria-hidden="true">${t.initials}</div>
          <div>
            <strong>${t.name}</strong>
            <span>${t.result}</span>
          </div>
        </div>
      </div>`)
    .join('');
}

/* ─────────────────────────────────────────────────────────────
   Render: Contact info + form header
───────────────────────────────────────────────────────────── */
function renderContact() {
  const detailsHtml = SITE.contact.details
    .map(d => `
      <li>
        <span class="contact__icon" aria-hidden="true">${d.icon}</span>
        ${d.text}
      </li>`)
    .join('');

  const titleHtml = SITE.contact.title
    .split('\n')
    .join('<br />');

  $('contact-info').innerHTML = `
    <span class="section__label section__label--light">${SITE.contact.label}</span>
    <h2 class="section__title section__title--light">${titleHtml}</h2>
    <p>${SITE.contact.subtitle}</p>
    <ul class="contact__details">${detailsHtml}</ul>
  `;

  $('form-header').innerHTML = `
    <h3>${SITE.contact.formHeader}</h3>
    <p>${SITE.contact.formSubheader}</p>
  `;
}

/* ─────────────────────────────────────────────────────────────
   Render: Footer
───────────────────────────────────────────────────────────── */
function renderFooter() {
  $('footer-content').innerHTML = `
    <span class="nav__logo">
      <span class="nav__logo-icon">${SITE.nav.logo.icon}</span>
      ${SITE.nav.logo.name}
    </span>
    <p>${SITE.footer.copy}</p>
  `;
}

/* ─────────────────────────────────────────────────────────────
   Run all renderers
───────────────────────────────────────────────────────────── */
renderMeta();
renderNav();
renderHero();
renderStats();
renderAbout();
renderServices();
renderTestimonials();
renderContact();
renderFooter();

/* ─────────────────────────────────────────────────────────────
   Nav — scroll shadow
───────────────────────────────────────────────────────────── */
const navEl = $('nav');
window.addEventListener('scroll', () => {
  navEl.classList.toggle('is-scrolled', window.scrollY > 20);
}, { passive: true });

/* ─────────────────────────────────────────────────────────────
   Nav — mobile toggle
───────────────────────────────────────────────────────────── */
const navToggle = $('nav-toggle');
const navLinksEl = $('nav-links');

navToggle.addEventListener('click', () => {
  navLinksEl.classList.toggle('is-open');
});
navLinksEl.querySelectorAll('a').forEach((a) => {
  a.addEventListener('click', () => navLinksEl.classList.remove('is-open'));
});

/* ─────────────────────────────────────────────────────────────
   Scroll Spy — active nav link
───────────────────────────────────────────────────────────── */
const spyObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      document.querySelectorAll('.nav__link[href^="#"]').forEach((a) => {
        a.classList.toggle('is-active', a.getAttribute('href') === '#' + entry.target.id);
      });
    }
  });
}, { rootMargin: '-50% 0px -50% 0px' });

document.querySelectorAll('section[id]').forEach((s) => spyObserver.observe(s));

/* ─────────────────────────────────────────────────────────────
   Scroll Animations — fade in on enter
───────────────────────────────────────────────────────────── */
const fadeObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      fadeObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.animate-fade-up, .animate-fade-left, .animate-fade-right')
  .forEach((el) => fadeObserver.observe(el));

/* ─────────────────────────────────────────────────────────────
   Animated Counters
───────────────────────────────────────────────────────────── */
function animateCounter(el) {
  const target   = parseInt(el.dataset.target, 10);
  const suffix   = el.dataset.suffix || '';
  const duration = 1800;
  let   startTime = null;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  const step = (ts) => {
    if (!startTime) startTime = ts;
    const progress = Math.min((ts - startTime) / duration, 1);
    el.textContent = Math.floor(easeOut(progress) * target).toLocaleString('en-IN') +
                     (progress === 1 ? suffix : '');
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      animateCounter(entry.target);
      counterObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.5 });

document.querySelectorAll('.stat__number[data-target]')
  .forEach((el) => counterObserver.observe(el));

/* ─────────────────────────────────────────────────────────────
   Card Selection — creative interaction
───────────────────────────────────────────────────────────── */
function initCardSelection() {
  const selectableCards = document.querySelectorAll('.card.is-selectable');
  const messageField    = $('f-message');

  selectableCards.forEach((card) => {
    card.addEventListener('click', (e) => {
      // Clicking the Enquire button itself → just follow its href, don't select
      if (e.target.closest('.btn')) return;

      const alreadySelected = card.classList.contains('is-selected');

      // Clear all states
      selectableCards.forEach((c) => c.classList.remove('is-selected', 'is-dimmed'));

      if (!alreadySelected) {
        // Select this card
        card.classList.add('is-selected');
        // Dim all others
        selectableCards.forEach((c) => {
          if (c !== card) c.classList.add('is-dimmed');
        });
        // Pre-fill message
        const programme = card.dataset.programme;
        messageField.value = `I'm interested in the "${programme}" programme.`;
        // Clear any previous message validation error
        clearInvalid('f-message');
      } else {
        // Clicking selected card again → deselect
        messageField.value = '';
      }
    });
  });
}

initCardSelection();

/* ─────────────────────────────────────────────────────────────
   Form — validation helpers
───────────────────────────────────────────────────────────── */
function isValidName(name) {
  return name.length >= 2 && /^[a-zA-Z\u0900-\u097F\s'.-]+$/.test(name);
}
function isValidPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  return /^(91|0)?[6-9]\d{9}$/.test(digits);
}
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function markInvalid(fieldId, message) {
  const input = $(fieldId);
  input.classList.add('is-invalid');
  const existing = input.parentElement.querySelector('.field-error');
  if (existing) existing.remove();
  const errEl = document.createElement('span');
  errEl.className = 'field-error';
  errEl.textContent = message;
  input.parentElement.appendChild(errEl);
  input.focus();
}

function clearInvalid(fieldId) {
  const input = $(fieldId);
  input.classList.remove('is-invalid');
  const existing = input.parentElement.querySelector('.field-error');
  if (existing) existing.remove();
}

function clearAllInvalid() {
  ['f-name', 'f-phone', 'f-email', 'f-message'].forEach(clearInvalid);
}

['f-name', 'f-phone', 'f-email', 'f-message'].forEach((id) => {
  $(id).addEventListener('input', () => clearInvalid(id));
});

/* ─────────────────────────────────────────────────────────────
   Form — submit
───────────────────────────────────────────────────────────── */
const form      = $('lead-form');
const submitBtn = $('submit-btn');
const statusEl  = $('form-status');

const API_URL = `${SITE.api.baseUrl}/api/public/${SITE.api.slug}/leads`;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  setStatus('', '');
  clearAllInvalid();

  const name    = $('f-name').value.trim();
  const phone   = $('f-phone').value.trim();
  const email   = $('f-email').value.trim();
  const message = $('f-message').value.trim();
  const hp      = $('hp').value;

  if (!name)             { markInvalid('f-name',  'Full name is required.');                              return; }
  if (!isValidName(name)){ markInvalid('f-name',  'Please enter a valid name (letters and spaces only).'); return; }
  if (!phone)            { markInvalid('f-phone', 'Phone number is required.');                            return; }
  if (!isValidPhone(phone)) {
    markInvalid('f-phone', 'Enter a valid 10-digit Indian mobile number (e.g. 98765 43210).');
    return;
  }
  if (email && !isValidEmail(email)) {
    markInvalid('f-email', 'Please enter a valid email address (e.g. you@example.com).');
    return;
  }

  const payload = { name, phone, hp };
  if (email)   payload.email   = email;
  if (message) payload.message = message;

  submitBtn.disabled    = true;
  submitBtn.textContent = 'Sending…';

  try {
    const res = await fetch(API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    if (res.ok) {
      setStatus('Thank you. We will contact you shortly.', 'success');
      form.reset();
      clearAllInvalid();
      // Clear card selection on success
      document.querySelectorAll('.card.is-selectable').forEach((c) => {
        c.classList.remove('is-selected', 'is-dimmed');
      });
    } else if (res.status === 429) {
      setStatus('Too many requests. Please try again after a few minutes.', 'error');
    } else if (res.status === 404) {
      setStatus('Enquiry could not be submitted right now. Please call us on +91 98000 00000.', 'error');
    } else {
      const data = await res.json().catch(() => ({}));
      setStatus(data.error || 'Something went wrong. Please try again.', 'error');
    }
  } catch {
    setStatus('Could not reach the server. Please check your connection or call us directly.', 'error');
  } finally {
    submitBtn.disabled    = false;
    submitBtn.textContent = 'Send Enquiry →';
  }
});

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className   = 'form__status';
  if (type === 'success') statusEl.classList.add('form__status--success');
  if (type === 'error')   statusEl.classList.add('form__status--error');
  if (message) statusEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
