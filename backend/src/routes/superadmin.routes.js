'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { authenticateSuperAdmin } = require('../middleware/superadmin.middleware');
const ctrl = require('../controllers/superadmin.controller');

/* Stricter than the general /api limiter — a single shared password makes
   this login a higher-value brute-force target than per-tenant logins. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();

/* Public */
router.post('/login', loginLimiter, ctrl.login);

/* Protected — SUPERADMIN token required */
router.get  ('/overview',                   authenticateSuperAdmin, ctrl.overview);
router.get  ('/businesses',                 authenticateSuperAdmin, ctrl.businesses);
router.post ('/businesses',                 authenticateSuperAdmin, ctrl.createBusiness);
router.patch('/businesses/:id/stage',       authenticateSuperAdmin, ctrl.updateBusinessStage);
router.get  ('/slugs/check',                authenticateSuperAdmin, ctrl.checkSlug);
router.get  ('/leads',                      authenticateSuperAdmin, ctrl.leads);
router.get  ('/logs',                       authenticateSuperAdmin, ctrl.logs);
router.get  ('/analytics',                  authenticateSuperAdmin, ctrl.analytics);

module.exports = router;
