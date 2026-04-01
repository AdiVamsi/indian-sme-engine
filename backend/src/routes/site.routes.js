'use strict';

const fs = require('fs');
const path = require('path');
const { Router } = require('express');

const { getPublicSiteDataBySlug } = require('../services/publicSite.service');

const router = Router();
const SLUG_RE = /^[a-z0-9-]+$/;
const FRONTEND_INDEX_PATH = path.join(__dirname, '../../../frontend/index.html');
const FRONTEND_INDEX_HTML = fs.readFileSync(FRONTEND_INDEX_PATH, 'utf8');

router.get('/', async (req, res, next) => {
  const slug = typeof req.query.slug === 'string'
    ? req.query.slug.trim().toLowerCase()
    : '';

  if (!slug || !SLUG_RE.test(slug)) return next();

  const site = await getPublicSiteDataBySlug(slug);
  if (!site) return res.status(404).send(renderNotFound(slug));

  return res.send(renderSite(site));
});

router.get('/:slug', async (req, res, next) => {
  const { slug } = req.params;
  if (!SLUG_RE.test(slug)) return next();

  const site = await getPublicSiteDataBySlug(slug);
  if (!site) return res.status(404).send(renderNotFound(slug));

  return res.send(renderSite(site));
});

function renderSite(site) {
  const bootstrapScript = `<script id="site-bootstrap" type="application/json">${serializeJsonForHtml(site)}</script>`;

  return FRONTEND_INDEX_HTML
    .replace(
      '<meta name="description" id="meta-description" content="" />',
      `<meta name="description" id="meta-description" content="${escHtml(site.meta?.description || '')}" />`
    )
    .replace(
      '<title id="page-title">Loading…</title>',
      `<title id="page-title">${escHtml(site.meta?.title || site.business?.name || 'Business')}</title>`
    )
    .replace(
      '<script src="config.js"></script>',
      `${bootstrapScript}\n  <script src="config.js"></script>`
    );
}

function renderNotFound(slug) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Public site not found</title>
  <style>
    body {
      margin: 0;
      font-family: Inter, system-ui, sans-serif;
      background: #f8fafc;
      color: #0f172a;
      display: grid;
      place-items: center;
      min-height: 100vh;
      padding: 24px;
    }
    .card {
      width: min(100%, 560px);
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 20px;
      padding: 32px;
      box-shadow: 0 12px 40px rgba(15, 23, 42, 0.08);
    }
    h1 {
      margin: 0 0 12px;
      font-size: 28px;
      line-height: 1.1;
    }
    p {
      margin: 0 0 12px;
      line-height: 1.6;
      color: #475569;
    }
    code {
      background: #f1f5f9;
      border-radius: 6px;
      padding: 2px 6px;
    }
  </style>
</head>
<body>
  <main class="card">
    <h1>Public site not found</h1>
    <p>No business site is available for <code>${escHtml(slug)}</code>.</p>
    <p>Check the URL slug and try again.</p>
  </main>
</body>
</html>`;
}

function serializeJsonForHtml(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = router;
