'use strict';

const { Router } = require('express');
const { findBusinessBySlug } = require('../services/auth.service');
const { getIndustryConfig }  = require('../constants/industry.config');

const router = Router();

/*
 * GET /:slug
 *
 * Accepts any single path segment, then validates it inside the handler.
 * If the segment does not match /^[a-z0-9-]+$/ (i.e. it contains a dot or
 * uppercase letter — e.g. "form.css", "form.js"), next() is called so the
 * request falls through to the express.static middleware registered after
 * this router in app.js.
 *
 * Business slugs: "sharma-jee-academy-delhi"  → handled here
 * Static assets:  "form.css", "form.js"        → passed to static middleware
 */
const SLUG_RE = /^[a-z0-9-]+$/;

router.get('/:slug', async (req, res, next) => {
  const { slug } = req.params;

  /* If the segment looks like a static asset (contains a dot, or fails the
   * slug pattern), pass through so express.static can serve it. */
  if (!SLUG_RE.test(slug)) return next();

  let business;
  try {
    business = await findBusinessBySlug(slug);
  } catch (err) {
    console.error('[FormRoute] DB error for slug:', slug, '—', err.message);
    return res.status(500).send(renderNotFound());
  }

  if (!business) {
    return res.status(404).send(renderNotFound());
  }

  return res.send(renderForm(business.name, slug, business.industry));
});

/* ── HTML helpers ── */

function renderForm(businessName, slug, industry) {
  const name    = escHtml(businessName);
  const s       = escHtml(slug);
  const copy    = getIndustryConfig(industry).formCopy;
  const label   = copy.industryLabel ? `<p class="form-brand">${escHtml(copy.industryLabel)}</p>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${name} — Send an enquiry</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" />
  <link rel="stylesheet" href="/form/form.css" />
</head>
<body>
  <div class="form-card">
    ${label}
    <h1 class="form-heading">${name}</h1>
    <p class="form-sub">${escHtml(copy.sub)}</p>

    <div id="form-wrap">
      <form id="enquiry-form" data-slug="${s}" novalidate>
        <div class="field">
          <label for="f-name">Name *</label>
          <input id="f-name" name="name" type="text" placeholder="Your name" required autocomplete="name" />
        </div>
        <div class="field">
          <label for="f-phone">Phone *</label>
          <input id="f-phone" name="phone" type="tel" placeholder="+91 98765 43210" required autocomplete="tel" />
        </div>
        <div class="field">
          <label for="f-email">Email <span class="field__optional">(optional)</span></label>
          <input id="f-email" name="email" type="email" placeholder="you@example.com" autocomplete="email" />
        </div>
        <div class="field">
          <label for="f-message">Message <span class="field__optional">(optional)</span></label>
          <textarea id="f-message" name="message" placeholder="${escHtml(copy.placeholder)}"></textarea>
        </div>

        <!-- honeypot: hidden from real users, visible to bots -->
        <div class="hp-field" aria-hidden="true">
          <label>Leave this blank</label>
          <input name="hp" tabindex="-1" autocomplete="off" />
        </div>

        <p id="form-error" class="form-error" role="alert"></p>
        <button type="submit" id="submit-btn" class="btn-submit">${escHtml(copy.submitLabel)}</button>
      </form>

      <ol class="form-steps" aria-label="What happens next">
        <li>We receive your enquiry</li>
        <li>Our team reviews your message</li>
        <li>${escHtml(copy.callStep)}</li>
      </ol>
    </div>

    <div id="success-state" class="success-state">
      <div class="success-icon">✓</div>
      <h2 class="success-heading">Enquiry received</h2>
      <p class="success-sub">Thank you. ${name} ${escHtml(copy.successSub)}</p>
      <button id="btn-another" class="btn-another">Submit another enquiry</button>
    </div>
  </div>
  <script src="/form/form.js"></script>
</body>
</html>`;
}

function renderNotFound() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Not found</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" />
  <link rel="stylesheet" href="/form/form.css" />
</head>
<body>
  <div class="form-card not-found">
    <div class="not-found__icon">🔍</div>
    <h1 class="not-found__heading">Page not found</h1>
    <p class="not-found__sub">No business found at this address. Check the link and try again.</p>
  </div>
</body>
</html>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#039;');
}

module.exports = router;
