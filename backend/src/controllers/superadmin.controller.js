'use strict';

const crypto = require('crypto');
const { signSuperAdmin } = require('../utils/superadmin-jwt');
const svc = require('../services/superadmin.service');

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

module.exports = { login, overview, businesses, leads, logs };
