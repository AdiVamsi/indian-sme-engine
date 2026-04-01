'use strict';

const { Router } = require('express');

const { authenticate } = require('../middleware/auth.middleware');
const {
  login,
  getConfig,
  getBusiness,
  dashboard,
  leads,
  actionQueue,
  leadsByDay,
  appointments,
  services,
  testimonials,
  updateStatus,
  leadActivity,
  leadSuggestions,
  leadOutreachDraft,
} = require('../controllers/admin.controller');
const { activate, runProof, skip } = require('../controllers/activation.controller');

const router = Router();

/* ── Public ── */
router.post('/login', login);

/* ── Protected ── */
router.get('/config',        authenticate, getConfig);
router.get('/business',      authenticate, getBusiness);
router.get('/dashboard',     authenticate, dashboard);
router.get('/action-queue',  authenticate, actionQueue);
router.get  ('/leads',               authenticate, leads);
router.get  ('/leads/by-day',        authenticate, leadsByDay);
router.get  ('/leads/:id/activity',     authenticate, leadActivity);
router.get  ('/leads/:id/suggestions',    authenticate, leadSuggestions);
router.get  ('/leads/:id/outreach-draft', authenticate, leadOutreachDraft);
router.patch('/leads/:id/status',    authenticate, updateStatus);
router.get('/appointments',  authenticate, appointments);
router.get('/services',      authenticate, services);
router.get('/testimonials',  authenticate, testimonials);

/* ── Activation (first-run setup) ── */
router.post('/activate',      authenticate, activate);
router.post('/activate/proof', authenticate, runProof);
router.post('/activate/skip', authenticate, skip);

module.exports = router;
