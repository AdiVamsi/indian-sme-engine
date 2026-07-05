'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');

const { login } = require('../controllers/auth.controller');

/* Stricter than the general /api limiter — login is a brute-force target. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();

router.post('/login', loginLimiter, login);

module.exports = router;
