'use strict';

const crypto = require('crypto');
const { BusinessStage } = require('@prisma/client');
const { signSuperAdmin } = require('../utils/superadmin-jwt');
const svc = require('../services/superadmin.service');

const VALID_STAGES = new Set(Object.values(BusinessStage));

/* Fail fast at startup — SUPERADMIN_PASSWORD must be set explicitly. */
if (!process.env.SUPERADMIN_PASSWORD) {
  throw new Error('SUPERADMIN_PASSWORD is not set in environment variables');
}

/* Read once — avoids repeated env lookups per request */
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD;

/* ── Login ─────────────────────────────────────────────────────────────────── */

/**
 * POST /api/superadmin/login
 * Body: { password: string }
 * Uses constant-time comparison to avoid timing attacks.
 */
const login = (req, res) => {
  const { password } = req.body ?? {};

  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'password is required' });
  }

  let match = false;
  try {
    const a = Buffer.from(password, 'utf8');
    const b = Buffer.from(SUPERADMIN_PASSWORD, 'utf8');
    /* timingSafeEqual requires same-length buffers */
    match = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    match = false;
  }

  if (!match) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = signSuperAdmin({ role: 'SUPERADMIN' });
  return res.json({ token });
};

/* ── Data endpoints ─────────────────────────────────────────────────────────── */

const overview = async (_req, res) => {
  try {
    const data = await svc.getOverview();
    res.json(data);
  } catch (err) {
    console.error('[superadmin] overview error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const businesses = async (_req, res) => {
  try {
    const data = await svc.getAllBusinesses();
    res.json(data);
  } catch (err) {
    console.error('[superadmin] businesses error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const leads = async (_req, res) => {
  try {
    const data = await svc.getAllLeads();
    res.json(data);
  } catch (err) {
    console.error('[superadmin] leads error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const logs = async (_req, res) => {
  try {
    const data = await svc.getAutomationLogs();
    res.json(data);
  } catch (err) {
    console.error('[superadmin] logs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/* ── PATCH /api/superadmin/businesses/:id/stage ─────────────────────────────
   Updates the lifecycle stage of a business.
   Body: { stage: BusinessStage }
*/
const updateBusinessStage = async (req, res) => {
  const { stage } = req.body ?? {};

  if (!stage || !VALID_STAGES.has(stage)) {
    return res.status(400).json({
      error: `Invalid stage. Must be one of: ${[...VALID_STAGES].join(', ')}`,
    });
  }

  try {
    const updated = await svc.updateBusinessStage(req.params.id, stage);
    if (!updated) return res.status(404).json({ error: 'Business not found' });
    return res.json(updated);
  } catch (err) {
    console.error('[superadmin] updateBusinessStage error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/* ── GET /api/superadmin/analytics ─────────────────────────────────────────
   Platform intelligence: stage distribution, duration, growth, lead signals.
*/
const analytics = async (_req, res) => {
  try {
    const data = await svc.getAnalytics();
    res.json(data);
  } catch (err) {
    console.error('[superadmin] analytics error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/* ── GET /api/superadmin/slugs/check ────────────────────────────────────────
   Checks whether a slug is available.
   Query: ?slug=xxx
   Returns: { available: boolean, slug: string }
*/
const checkSlug = async (req, res) => {
  const { slug } = req.query;
  if (!slug || typeof slug !== 'string') {
    return res.status(400).json({ error: 'slug query param is required' });
  }
  try {
    const result = await svc.checkSlug(slug);
    return res.json(result);
  } catch (err) {
    console.error('[superadmin] checkSlug error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/* ── POST /api/superadmin/businesses ────────────────────────────────────────
   Onboards a new tenant: creates Business + owner User + default AgentConfig.
   Body: { name, slug?, industry?, phone?, city?, timezone?, currency?,
           ownerName, ownerEmail, ownerPassword, followUpMinutes?, autoReplyEnabled? }
*/
const createBusiness = async (req, res) => {
  const {
    name, slug, industry, phone, city, timezone, currency,
    ownerName, ownerEmail, ownerPassword,
    followUpMinutes, autoReplyEnabled,
  } = req.body ?? {};

  if (!name?.trim())       return res.status(400).json({ error: 'name is required' });
  if (!ownerName?.trim())  return res.status(400).json({ error: 'ownerName is required' });
  if (!ownerEmail?.trim()) return res.status(400).json({ error: 'ownerEmail is required' });
  if (!ownerPassword || ownerPassword.length < 8) {
    return res.status(400).json({ error: 'ownerPassword must be at least 8 characters' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    return res.status(400).json({ error: 'ownerEmail is not a valid email address' });
  }

  try {
    const business = await svc.createBusiness({
      name:             name.trim(),
      slug:             slug?.trim()      || undefined,
      industry:         industry?.trim()  || undefined,
      phone:            phone?.trim()     || undefined,
      city:             city?.trim()      || undefined,
      timezone:         timezone?.trim()  || undefined,
      currency:         currency?.trim()  || undefined,
      ownerName:        ownerName.trim(),
      ownerEmail:       ownerEmail.toLowerCase().trim(),
      ownerPassword,
      followUpMinutes:  followUpMinutes != null ? parseInt(followUpMinutes, 10) : undefined,
      autoReplyEnabled: typeof autoReplyEnabled === 'boolean' ? autoReplyEnabled : undefined,
    });
    return res.status(201).json(business);
  } catch (err) {
    if (err.code === 'SLUG_TAKEN')   return res.status(409).json({ error: err.message });
    if (err.code === 'INVALID_SLUG') return res.status(400).json({ error: err.message });
    console.error('[superadmin] createBusiness error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { login, overview, businesses, leads, logs, updateBusinessStage, analytics, checkSlug, createBusiness };
