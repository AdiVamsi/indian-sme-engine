'use strict';

const path    = require('path');
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');

const { NODE_ENV } = require('./config/env');
const authRoutes = require('./routes/auth.routes');
const leadsRoutes = require('./routes/leads.routes');
const servicesRoutes = require('./routes/services.routes');
const testimonialsRoutes = require('./routes/testimonials.routes');
const appointmentsRoutes = require('./routes/appointments.routes');
const publicRoutes = require('./routes/public.routes');
const adminRoutes = require('./routes/admin.routes');
const agentRoutes = require('./routes/agentConfig.routes');
const superadminRoutes = require('./routes/superadmin.routes');
const formRoutes       = require('./routes/form.routes');
const { authenticate } = require('./middleware/auth.middleware');
const { errorHandler } = require('./middleware/error.middleware');

const app = express();

/* ── Security & parsing ── */
app.use(helmet());
app.use(cors()); /* same-origin: all static + API served from one host */
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
app.use('/api/agent', agentRoutes);
app.use('/api/superadmin', superadminRoutes);

/* ── Static sites (mounted after /api so routes are never shadowed) ── */
app.use('/admin',     express.static(path.join(__dirname, '../../admin')));
app.use('/dashboard', express.static(path.join(__dirname, '../../dashboard')));

/* ── Public lead form (slug-aware, server-side rendered) ── */
/* Order matters: route handler first, then static assets, then existing frontend fallback. */
app.use('/form', formRoutes);                                                      /* GET /form/:slug → server-rendered page */
app.use('/form', express.static(path.join(__dirname, '../../form')));              /* form.js, form.css */
app.use('/form', express.static(path.join(__dirname, '../../frontend')));          /* existing frontend assets (unchanged) */
app.use('/',          express.static(path.join(__dirname, '../../landing')));

/* ── Global error handler (must be last) ── */
app.use(errorHandler);

module.exports = app;
