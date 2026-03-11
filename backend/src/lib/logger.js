'use strict';

const pino = require('pino');
const { NODE_ENV } = require('../config/env');

const logger = pino({
  level: process.env.LOG_LEVEL || (NODE_ENV === 'production' ? 'info' : 'debug'),
  base: {
    service: 'indian-sme-engine-backend',
    env: NODE_ENV,
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
      'headers.cookie',
    ],
    remove: true,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = { logger };
