'use strict';

const path    = require('path');
const express = require('express');
const cors    = require('cors');
const compression = require('compression');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');

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
const { attachRequestId } = require('./middleware/request-id.middleware');
const { logRequests } = require('./middleware/request-logger.middleware');
const { errorHandler } = require('./middleware/error.middleware');

const app = express();
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
  : null;
const healthPayload = () => ({
  status: 'ok',
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
});
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: NODE_ENV === 'production' ? 300 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

/* ── Security & parsing ── */
app.set('trust proxy', NODE_ENV === 'production' ? 1 : false);
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
  origin: corsOrigins || true,
  credentials: true,
}));
app.use(compression());
app.use(attachRequestId);
app.use(logRequests);
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

/* ── Health ── */
app.get('/health', (_req, res) => res.json(healthPayload()));
app.get('/api/health', (_req, res) => res.json(healthPayload()));
app.use('/api', apiLimiter);

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

/* ── Full business website (Sharma JEE Academy reference implementation) ──
   Clean canonical URL: /site  e.g. http://localhost:3000/site
   The same assets also remain accessible under /form/* (see below) for
   backward-compatibility with any saved links. */
app.use('/site', express.static(path.join(__dirname, '../../frontend')));

/* ── Public lead form (slug-aware, server-side rendered) ── */
/* Order matters: route handler first, then static assets, then frontend fallback. */
app.use('/form', formRoutes);                                                      /* GET /form/:slug → server-rendered per-business enquiry form */
app.use('/form', express.static(path.join(__dirname, '../../form')));              /* form.js, form.css */
app.use('/form', express.static(path.join(__dirname, '../../frontend')));          /* frontend assets for the full website (also at /site) */
app.use('/',          express.static(path.join(__dirname, '../../landing')));

app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    requestId: req.id,
  });
});

/* ── Global error handler (must be last) ── */
app.use(errorHandler);

module.exports = app;
