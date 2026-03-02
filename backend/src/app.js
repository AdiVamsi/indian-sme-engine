'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { NODE_ENV } = require('./config/env');
const authRoutes = require('./routes/auth.routes');
const leadsRoutes = require('./routes/leads.routes');
const servicesRoutes = require('./routes/services.routes');
const testimonialsRoutes = require('./routes/testimonials.routes');
const appointmentsRoutes = require('./routes/appointments.routes');
const publicRoutes = require('./routes/public.routes');
const adminRoutes = require('./routes/admin.routes');
const { authenticate } = require('./middleware/auth.middleware');
const { errorHandler } = require('./middleware/error.middleware');

const app = express();

/* ── Security & parsing ── */
app.use(helmet());
const allowedOrigins = [
  /* ── Production ── */
  'https://sme-engine-dashboard.netlify.app',  /* deployed dashboard */
  'https://sme-engine.netlify.app',            /* deployed landing page */
  /* ── Legacy Netlify preview URL ── */
  'https://lovely-sawine-2b80f3.netlify.app',
  /* ── Local dev ── */
  'http://localhost:3000',
  'http://localhost:3001',   /* npx serve (dashboard dev) */
  'http://127.0.0.1:3001',
  'http://localhost:5500',   /* VS Code Live Server */
  'http://127.0.0.1:5500',
];

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  credentials: true,
}));
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10kb' }));

/* ── Health ── */
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/health/full', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
  });
});

/* ── Routes ── */
app.use('/api/auth', authRoutes);
app.use('/api/leads', authenticate, leadsRoutes);

app.get('/api/me', authenticate, (req, res) => {
  const { userId, businessId, role } = req.user;
  res.json({ userId, businessId, role });
});

app.use('/api/services', authenticate, servicesRoutes);
app.use('/api/testimonials', authenticate, testimonialsRoutes);
app.use('/api/appointments', authenticate, appointmentsRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/admin', adminRoutes);

/* ── Global error handler (must be last) ── */
app.use(errorHandler);

module.exports = app;
