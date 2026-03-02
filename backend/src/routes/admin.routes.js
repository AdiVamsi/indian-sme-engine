'use strict';

const { Router } = require('express');

const { authenticate } = require('../middleware/auth.middleware');
const {
  login,
  getConfig,
  getBusiness,
  dashboard,
  leads,
  leadsByDay,
  appointments,
  services,
  testimonials,
} = require('../controllers/admin.controller');

const router = Router();

/* ── Public ── */
router.post('/login', login);

/* ── Protected ── */
router.get('/config',        authenticate, getConfig);
router.get('/business',      authenticate, getBusiness);
router.get('/dashboard',     authenticate, dashboard);
router.get('/leads',         authenticate, leads);
router.get('/leads/by-day',  authenticate, leadsByDay);
router.get('/appointments',  authenticate, appointments);
router.get('/services',      authenticate, services);
router.get('/testimonials',  authenticate, testimonials);

module.exports = router;
