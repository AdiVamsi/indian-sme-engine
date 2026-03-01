'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const authRoutes = require('./routes/auth.routes');
const leadsRoutes = require('./routes/leads.routes');
const servicesRoutes = require('./routes/services.routes');
const { authenticate } = require('./middleware/auth.middleware');

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/leads', authenticate, leadsRoutes);

app.get('/api/me', authenticate, (req, res) => {
  const { userId, businessId, role } = req.user;
  res.json({ userId, businessId, role });
});

app.use('/api/services', authenticate, servicesRoutes);

module.exports = app;
