'use strict';

const { Router } = require('express');

const { authenticate } = require('../middleware/auth.middleware');
const {
  login,
  dashboard,
  leads,
  appointments,
  services,
  testimonials,
} = require('../controllers/admin.controller');

const router = Router();

/* ── Public ── */
router.post('/login', login);

/* ── Protected ── */
router.get('/dashboard',    authenticate, dashboard);
router.get('/leads',        authenticate, leads);
router.get('/appointments', authenticate, appointments);
router.get('/services',     authenticate, services);
router.get('/testimonials', authenticate, testimonials);

module.exports = router;
