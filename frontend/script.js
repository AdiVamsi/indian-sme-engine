'use strict';

import { createLead } from './js/api.js';

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

function escHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function readSiteBootstrap() {
  const el = $('site-bootstrap');
  if (!el) return null;

  try {
    return JSON.parse(el.textContent || 'null');
  } catch {
    return null;
  }
}

function joinList(items = []) {
  const values = items.filter(Boolean);
  if (!values.length) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

function humanizeIndustry(industry = '') {
  const value = String(industry || 'business').replace(/[_-]+/g, ' ').trim();
  if (!value) return 'Business';
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

function getIndustryIcon(industry = 'other') {
  return {
    academy: '🎯',
    gym: '💪',
    salon: '✨',
    restaurant: '🍽',
    clinic: '🩺',
    retail: '🛍️',
    other: '⚡',
  }[industry] || '⚡';
}

function getInitials(name = '') {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) return 'CU';
  return parts.map((part) => part[0].toUpperCase()).join('');
}

function formatLocation(business = {}) {
  return [business.city, business.country].filter(Boolean).join(', ');
}

function formatAddress(business = {}) {
  return [business.address, business.city, business.country].filter(Boolean).join(', ');
}

function formatPriceInr(priceInr) {
  if (typeof priceInr !== 'number' || !Number.isFinite(priceInr)) {
    return { price: 'Contact', period: 'for details' };
  }

  return {
    price: new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(priceInr),
    period: '',
  };
}

function buildTenantSiteModel(raw = {}) {
  const business = raw.business || {};
  const services = Array.isArray(raw.services) ? raw.services : [];
  const testimonials = Array.isArray(raw.testimonials) ? raw.testimonials : [];
  const industryConfig = raw.industryConfig || {};
  const formCopy = industryConfig.formCopy || {};
  const businessName = business.name || 'This business';
  const industryLabel = industryConfig.label || humanizeIndustry(business.industry);
  const location = formatLocation(business);
  const addressLine = formatAddress(business);
  const serviceNames = services.map((service) => service.title).filter(Boolean);
  const featuredOfferings = joinList(serviceNames.slice(0, 3));
  const directContactCount = [business.phone, business.email, addressLine].filter(Boolean).length;
  const ratingValues = testimonials
    .map((testimonial) => testimonial.rating)
    .filter((rating) => typeof rating === 'number' && rating > 0);
  const avgRating = ratingValues.length
    ? (ratingValues.reduce((sum, rating) => sum + rating, 0) / ratingValues.length).toFixed(1)
    : null;
  const publicFormHref = raw.publicFormPath || (business.slug ? `/form/${business.slug}` : '#contact');
  const servicesTitle = services.length === 1 ? 'Service' : 'Services';
  const reviewsTitle = testimonials.length === 1 ? 'Review' : 'Reviews';

  const heroSubtitle = services.length
    ? `${businessName}${location ? ` serves ${location}` : ''}. Ask about ${featuredOfferings}.`
    : `${businessName}${location ? ` serves ${location}` : ''}. Send an enquiry and we will help you with the right option.`;

  const aboutParagraphs = [
    services.length
      ? `${businessName}${addressLine ? ` is based in ${addressLine}` : ''} currently offers ${featuredOfferings}.`
      : `${businessName}${addressLine ? ` is based in ${addressLine}` : ''} is ready to help with your enquiry.`,
    'Use the live enquiry form below to ask about pricing, availability, scheduling, or the right fit for your needs.',
  ];

  const detailItems = [];
  if (addressLine) {
    detailItems.push({ icon: '📍', text: addressLine });
  }
  if (business.phone) {
    detailItems.push({
      icon: '📞',
      html: `<a href="tel:${escHtml(String(business.phone).replace(/\s+/g, ''))}">${escHtml(business.phone)}</a>`,
    });
  }
  if (business.email) {
    detailItems.push({
      icon: '✉️',
      html: `<a href="mailto:${escHtml(business.email)}">${escHtml(business.email)}</a>`,
    });
  }
  if (!detailItems.length) {
    detailItems.push({
      icon: '💬',
      text: 'Send an enquiry below and we will get back to you shortly.',
    });
  }

  return {
    api: {
      baseUrl: window.location.origin,
      slug: business.slug || null,
    },
    nav: {
      logo: {
        icon: getIndustryIcon(business.industry),
        name: businessName,
      },
      links: [
        { label: 'About', href: '#about' },
        { label: servicesTitle, href: '#services' },
        ...(testimonials.length ? [{ label: reviewsTitle, href: '#testimonials' }] : []),
        { label: 'Contact', href: '#contact' },
      ],
      ctaLabel: 'Send Enquiry',
      ctaHref: '#contact',
    },
    hero: {
      badge: [industryLabel, location].filter(Boolean).join(' · '),
      titleLines: [
        businessName,
        services[0]?.title || `Trusted ${industryLabel}`,
      ].filter(Boolean),
      gradientLine: 1,
      subtitleHtml: escHtml(heroSubtitle),
      cta: {
        primary: 'Send an Enquiry',
        primaryHref: '#contact',
        secondary: 'Open Quick Form',
        secondaryHref: publicFormHref,
      },
      proof: [
        { value: String(services.length), label: services.length === 1 ? 'Service Listed' : 'Services Listed' },
        { value: String(testimonials.length), label: reviewsTitle },
        { value: avgRating ? `${avgRating}/5` : '24h', label: avgRating ? 'Average Rating' : 'Response Goal' },
      ],
    },
    stats: [
      { target: services.length, suffix: '', label: services.length === 1 ? 'Service listed' : 'Services listed' },
      { target: testimonials.length, suffix: '', label: reviewsTitle },
      { target: directContactCount, suffix: '', label: directContactCount === 1 ? 'Direct contact option' : 'Direct contact options' },
      { target: 24, suffix: 'h', label: 'Response goal' },
    ],
    about: {
      label: 'About',
      title: `Why contact ${businessName}?`,
      paragraphs: aboutParagraphs,
      highlights: [
        services.length ? `${services.length} listed ${servicesTitle.toLowerCase()}` : null,
        location ? `Serving ${location}` : null,
        business.phone ? 'Phone enquiries available' : null,
        business.email ? 'Email enquiries available' : null,
      ].filter(Boolean),
      cta: 'Open Quick Form →',
      ctaHref: publicFormHref,
      heroIcon: getIndustryIcon(business.industry),
      floatingCards: [
        services.length
          ? { icon: '◈', strong: String(services.length), sub: services.length === 1 ? 'service listed' : 'services listed', pos: 'bottom-left' }
          : null,
        avgRating
          ? { icon: '★', strong: `${avgRating}/5`, sub: `from ${testimonials.length} review${testimonials.length === 1 ? '' : 's'}`, pos: 'top-right' }
          : null,
      ].filter(Boolean),
    },
    services: {
      label: servicesTitle,
      title: services.length ? `Current ${servicesTitle}` : 'Tell us what you need',
      subtitle: services.length
        ? `Explore the current ${servicesTitle.toLowerCase()} from ${businessName}.`
        : `${businessName} has not published ${servicesTitle.toLowerCase()} yet. Send an enquiry and the team will guide you directly.`,
      items: services.map((service) => {
        const price = formatPriceInr(service.priceInr);
        return {
          icon: getIndustryIcon(business.industry),
          title: service.title,
          desc: service.description || 'Contact us for more details.',
          features: [],
          price: price.price,
          period: price.period,
          featured: false,
        };
      }),
      emptyState: {
        title: 'No services published yet',
        description: 'Use the enquiry form below and the team will guide you to the right offering directly.',
      },
    },
    testimonials: {
      label: reviewsTitle,
      title: testimonials.length ? 'Customer feedback' : 'Testimonials coming soon',
      subtitle: testimonials.length
        ? `Real feedback currently stored for ${businessName}.`
        : `${businessName} has not added testimonials yet.`,
      items: testimonials.map((testimonial) => ({
        stars: typeof testimonial.rating === 'number' ? testimonial.rating : 0,
        text: testimonial.text,
        name: testimonial.customerName,
        result: 'Customer feedback',
        initials: getInitials(testimonial.customerName),
      })),
      emptyState: 'This business has not published testimonials yet. Contact the team for more information.',
    },
    contact: {
      label: 'Contact',
      title: `Talk to ${businessName}\nabout your enquiry`,
      subtitle: formCopy.sub || 'Fill in your details and we will get back to you shortly.',
      details: detailItems,
      formHeader: 'Send an enquiry',
      formSubheader: `Use the form below and ${businessName} will reply directly.`,
      messagePlaceholder: formCopy.placeholder || 'Tell us what you are looking for…',
      submitLabel: formCopy.submitLabel || 'Send Enquiry →',
      successMessage: `Thank you. ${businessName} ${formCopy.successSub || 'will be in touch shortly.'}`,
    },
    footer: {
      copy: `© ${new Date().getFullYear()} ${businessName}. All rights reserved.`,
    },
    metaTitle: businessName,
    metaDescription: `${businessName}${location ? ` in ${location}` : ''}. ${featuredOfferings ? `Explore ${featuredOfferings}. ` : ''}Send an enquiry online.`,
  };
}

function buildSiteModel(raw) {
  if (raw?.nav && raw?.hero) {
    return {
      ...raw,
      api: {
        baseUrl: raw.api?.baseUrl || window.location.origin,
        slug: raw.api?.slug || null,
      },
      nav: {
        ...raw.nav,
        ctaHref: raw.nav?.ctaHref || '#contact',
      },
      hero: {
        ...raw.hero,
        subtitleHtml: raw.hero?.subtitleHtml || raw.hero?.subtitle || '',
        cta: {
          primary: raw.hero?.cta?.primary || 'Send Enquiry',
          secondary: raw.hero?.cta?.secondary || 'View Services',
          primaryHref: raw.hero?.cta?.primaryHref || '#contact',
          secondaryHref: raw.hero?.cta?.secondaryHref || '#services',
        },
      },
      about: {
        ...raw.about,
        ctaHref: raw.about?.ctaHref || '#contact',
        heroIcon: raw.about?.heroIcon || raw.nav?.logo?.icon || '⚡',
      },
      contact: {
        ...raw.contact,
        messagePlaceholder: raw.contact?.messagePlaceholder || 'Which programme are you interested in?',
        submitLabel: raw.contact?.submitLabel || 'Send Enquiry →',
        successMessage: raw.contact?.successMessage || 'Thank you! We will call you within 24 hours.',
      },
      metaTitle: raw.metaTitle || `${raw.nav?.logo?.name || 'Business'} – Public site`,
      metaDescription: raw.metaDescription
        || `${raw.nav?.logo?.name || 'Business'} – ${raw.about?.paragraphs?.[0] || 'Send us an enquiry.'}`,
    };
  }

  return buildTenantSiteModel(raw || {});
}

const SITE_VIEW = buildSiteModel(readSiteBootstrap() || SITE);

/* ─────────────────────────────────────────────────────────────
   Render: Page meta
───────────────────────────────────────────────────────────── */
function renderMeta() {
  document.title = SITE_VIEW.metaTitle;
  $('meta-description').content = SITE_VIEW.metaDescription;
}

/* ─────────────────────────────────────────────────────────────
   Render: Navigation
───────────────────────────────────────────────────────────── */
function renderNav() {
  $('nav-logo').innerHTML =
    `<span class="nav__logo-icon">${escHtml(SITE_VIEW.nav.logo.icon)}</span>${escHtml(SITE_VIEW.nav.logo.name)}`;

  const navLinksEl = $('nav-links');
  navLinksEl.innerHTML =
    SITE_VIEW.nav.links
      .map((l) => `<a href="${escHtml(l.href)}" class="nav__link">${escHtml(l.label)}</a>`)
      .join('') +
    `<a href="${escHtml(SITE_VIEW.nav.ctaHref || '#contact')}" class="btn btn--primary btn--sm nav__cta">${escHtml(SITE_VIEW.nav.ctaLabel)}</a>`;
}

/* ─────────────────────────────────────────────────────────────
   Render: Hero
───────────────────────────────────────────────────────────── */
function renderHero() {
  const titleHtml = SITE_VIEW.hero.titleLines
    .filter(Boolean)
    .map((line, i) =>
      i === SITE_VIEW.hero.gradientLine
        ? `<span class="hero__gradient-text">${escHtml(line)}</span>`
        : escHtml(line)
    )
    .join('<br />');

  const proofHtml = SITE_VIEW.hero.proof
    .map((p, i) =>
      (i > 0 ? '<div class="hero__proof-divider" aria-hidden="true"></div>' : '') +
      `<div class="hero__proof-item">
        <strong>${escHtml(p.value)}</strong>
        <span>${escHtml(p.label)}</span>
      </div>`
    )
    .join('');

  $('hero-content').innerHTML = `
    <div class="hero__badge">
      <span class="hero__badge-dot"></span>
      ${escHtml(SITE_VIEW.hero.badge)}
    </div>
    <h1 class="hero__title">${titleHtml}</h1>
    <p class="hero__sub">${SITE_VIEW.hero.subtitleHtml}</p>
    <div class="hero__actions">
      <a href="${escHtml(SITE_VIEW.hero.cta.primaryHref || '#contact')}" class="btn btn--accent btn--lg">
        ${escHtml(SITE_VIEW.hero.cta.primary)} <span class="btn__arrow">→</span>
      </a>
      <a href="${escHtml(SITE_VIEW.hero.cta.secondaryHref || '#services')}" class="btn btn--ghost btn--lg">${escHtml(SITE_VIEW.hero.cta.secondary)}</a>
    </div>
    <div class="hero__proof">${proofHtml}</div>
  `;
}

/* ─────────────────────────────────────────────────────────────
   Render: Stats
───────────────────────────────────────────────────────────── */
function renderStats() {
  $('stats-grid').innerHTML = SITE_VIEW.stats
    .map((s, i) => `
      <div class="stat animate-fade-up" style="transition-delay:${i * 0.1}s">
        <span class="stat__number" data-target="${s.target}" data-suffix="${s.suffix}">0</span>
        <span class="stat__label">${escHtml(s.label)}</span>
      </div>`)
    .join('');
}

/* ─────────────────────────────────────────────────────────────
   Render: About
───────────────────────────────────────────────────────────── */
function renderAbout() {
  const floatHtml = SITE_VIEW.about.floatingCards
    .map(f => `
      <div class="about__floating-card pos-${f.pos}">
        <span class="about__floating-icon">${escHtml(f.icon)}</span>
        <div>
          <strong>${escHtml(f.strong)}</strong>
          <span>${escHtml(f.sub)}</span>
        </div>
      </div>`)
    .join('');

  const highlightsHtml = SITE_VIEW.about.highlights
    .map(h => `
      <div class="about__highlight">
        <span class="about__highlight-icon">✓</span>${escHtml(h)}
      </div>`)
    .join('');

  const parasHtml = SITE_VIEW.about.paragraphs
    .map((p) => `<p>${escHtml(p)}</p>`)
    .join('');

  $('about-content').innerHTML = `
    <div class="about__visual animate-fade-left">
      <div class="about__image-wrap">
        <div class="about__image-placeholder" aria-hidden="true"><span>${escHtml(SITE_VIEW.about.heroIcon)}</span></div>
        ${floatHtml}
      </div>
    </div>
    <div class="about__text-col animate-fade-right">
      <span class="section__label">${escHtml(SITE_VIEW.about.label)}</span>
      <h2 class="section__title">${escHtml(SITE_VIEW.about.title)}</h2>
      ${parasHtml}
      <div class="about__highlights">${highlightsHtml}</div>
      <a href="${escHtml(SITE_VIEW.about.ctaHref || '#contact')}" class="btn btn--primary">${escHtml(SITE_VIEW.about.cta)}</a>
    </div>
  `;
}

/* ─────────────────────────────────────────────────────────────
   Render: Services cards
───────────────────────────────────────────────────────────── */
function renderServices() {
  $('services-header').innerHTML = `
    <span class="section__label">${escHtml(SITE_VIEW.services.label)}</span>
    <h2 class="section__title">${escHtml(SITE_VIEW.services.title)}</h2>
    <p class="section__sub">${escHtml(SITE_VIEW.services.subtitle)}</p>
  `;

  if (!SITE_VIEW.services.items.length) {
    $('cards-grid').innerHTML = `
      <div class="card animate-fade-up">
        <div class="card__top-accent"></div>
        <div class="card__icon">${escHtml(SITE_VIEW.nav.logo.icon)}</div>
        <h3 class="card__title">${escHtml(SITE_VIEW.services.emptyState.title)}</h3>
        <p class="card__desc">${escHtml(SITE_VIEW.services.emptyState.description)}</p>
        <div class="card__footer">
          <a href="#contact" class="btn btn--primary btn--sm">Send Enquiry →</a>
        </div>
      </div>`;
    return;
  }

  $('cards-grid').innerHTML = SITE_VIEW.services.items
    .map((s, i) => {
      const delay = i * 0.1;
      const isFeatured = s.featured;

      const badgeHtml = (isFeatured && s.badge)
        ? `<div class="card__badge">${escHtml(s.badge)}</div>`
        : '';

      const glowHtml = isFeatured
        ? `<div class="card__featured-glow" aria-hidden="true"></div>`
        : `<div class="card__top-accent"></div>
           <div class="card__check" aria-hidden="true">✓</div>`;

      const featuresHtml = Array.isArray(s.features) && s.features.length
        ? `<ul class="card__features">${s.features.map((f) => `<li>${escHtml(f)}</li>`).join('')}</ul>`
        : '';

      const enquireBtn = isFeatured
        ? `<a href="#contact" class="btn btn--white btn--sm">Enquire →</a>`
        : `<a href="#contact" class="btn btn--primary btn--sm">Enquire →</a>`;

      return `
        <div class="card ${isFeatured ? 'card--featured' : 'is-selectable'} animate-fade-up"
             data-programme="${escHtml(s.title)}"
             style="transition-delay:${delay}s">
          ${glowHtml}
          ${badgeHtml}
          <div class="card__icon">${escHtml(s.icon)}</div>
          <h3 class="card__title">${escHtml(s.title)}</h3>
          <p class="card__desc">${escHtml(s.desc)}</p>
          ${featuresHtml}
          <div class="card__footer">
            <div class="card__price-wrap">
              <span class="card__price">${escHtml(s.price)}</span>
              <span class="card__price-period">${escHtml(s.period || '')}</span>
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
    <span class="section__label">${escHtml(SITE_VIEW.testimonials.label)}</span>
    <h2 class="section__title">${escHtml(SITE_VIEW.testimonials.title)}</h2>
    <p class="section__sub">${escHtml(SITE_VIEW.testimonials.subtitle)}</p>
  `;

  if (!SITE_VIEW.testimonials.items.length) {
    $('testimonials-grid').innerHTML = `
      <div class="testimonial animate-fade-up">
        <div class="testimonial__quote-mark" aria-hidden="true">"</div>
        <p class="testimonial__text">${escHtml(SITE_VIEW.testimonials.emptyState)}</p>
      </div>`;
    return;
  }

  $('testimonials-grid').innerHTML = SITE_VIEW.testimonials.items
    .map((t, i) => `
      <div class="testimonial animate-fade-up" style="transition-delay:${i * 0.15}s">
        <div class="testimonial__quote-mark" aria-hidden="true">"</div>
        ${t.stars > 0 ? `
          <div class="testimonial__stars" aria-label="${t.stars} stars">
            ${'★'.repeat(t.stars)}
          </div>` : ''}
        <p class="testimonial__text">${escHtml(t.text)}</p>
        <div class="testimonial__author">
          <div class="avatar" aria-hidden="true">${escHtml(t.initials)}</div>
          <div>
            <strong>${escHtml(t.name)}</strong>
            <span>${escHtml(t.result)}</span>
          </div>
        </div>
      </div>`)
    .join('');
}

/* ─────────────────────────────────────────────────────────────
   Render: Contact info + form header
───────────────────────────────────────────────────────────── */
function renderContact() {
  const detailsHtml = SITE_VIEW.contact.details
    .map(d => `
      <li>
        <span class="contact__icon" aria-hidden="true">${escHtml(d.icon)}</span>
        ${d.html || escHtml(d.text)}
      </li>`)
    .join('');

  const titleHtml = SITE_VIEW.contact.title
    .split('\n')
    .map((line) => escHtml(line))
    .join('<br />');

  $('contact-info').innerHTML = `
    <span class="section__label section__label--light">${escHtml(SITE_VIEW.contact.label)}</span>
    <h2 class="section__title section__title--light">${titleHtml}</h2>
    <p>${escHtml(SITE_VIEW.contact.subtitle)}</p>
    <ul class="contact__details">${detailsHtml}</ul>
  `;

  $('form-header').innerHTML = `
    <h3>${escHtml(SITE_VIEW.contact.formHeader)}</h3>
    <p>${escHtml(SITE_VIEW.contact.formSubheader)}</p>
  `;

  $('f-message').placeholder = SITE_VIEW.contact.messagePlaceholder;
  $('submit-btn').textContent = SITE_VIEW.contact.submitLabel;
}

/* ─────────────────────────────────────────────────────────────
   Render: Footer
───────────────────────────────────────────────────────────── */
function renderFooter() {
  $('footer-content').innerHTML = `
    <span class="nav__logo">
      <span class="nav__logo-icon">${escHtml(SITE_VIEW.nav.logo.icon)}</span>
      ${escHtml(SITE_VIEW.nav.logo.name)}
    </span>
    <p>${escHtml(SITE_VIEW.footer.copy)}</p>
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

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  setStatus('', '');
  clearAllInvalid();

  const name    = $('f-name').value.trim();
  const phone   = $('f-phone').value.trim();
  const email   = $('f-email').value.trim();
  const message = $('f-message').value.trim();
  const hp      = $('hp').value;

  if (!name)             { markInvalid('f-name',  'Full name is required.');                               return; }
  if (!isValidName(name)){ markInvalid('f-name',  'Please enter a valid name (letters and spaces only).'); return; }
  if (!phone)            { markInvalid('f-phone', 'Phone number is required.');                             return; }
  if (!isValidPhone(phone)) {
    markInvalid('f-phone', 'Enter a valid 10-digit Indian mobile number (e.g. 98765 43210).');
    return;
  }
  if (email && !isValidEmail(email)) {
    markInvalid('f-email', 'Please enter a valid email address (e.g. you@example.com).');
    return;
  }

  submitBtn.disabled    = true;
  submitBtn.textContent = 'Sending…';

  try {
    await createLead(SITE_VIEW.api.slug, {
      name,
      phone,
      email:   email   || undefined,
      message: message || undefined,
      hp:      '',
    });

    setStatus(SITE_VIEW.contact.successMessage, 'success');
    form.reset();
    clearAllInvalid();
    document.querySelectorAll('.card.is-selectable').forEach((c) => {
      c.classList.remove('is-selected', 'is-dimmed');
    });
    /* Auto-clear so the form is visually ready for another submission */
    setTimeout(() => setStatus('', ''), 2000);
  } catch (err) {
    setStatus(err.message || 'Request failed', 'error');
  } finally {
    submitBtn.disabled    = false;
    submitBtn.textContent = SITE_VIEW.contact.submitLabel;
  }
});

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className   = 'form__status';
  if (type === 'success') statusEl.classList.add('form__status--success');
  if (type === 'error')   statusEl.classList.add('form__status--error');
  if (message) statusEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
