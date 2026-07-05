'use strict';

const pino = require('pino');
const { NODE_ENV } = require('../config/env');

const defaultLevel = NODE_ENV === 'test'
  ? 'silent'
  : NODE_ENV === 'production'
    ? 'info'
    : 'debug';

const logger = pino({
  level: process.env.LOG_LEVEL || defaultLevel,
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
      'phone',
      'senderPhone',
      'displayPhoneNumber',
      '*.phone',
      '*.senderPhone',
      '*.displayPhoneNumber',
    ],
    remove: true,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = { logger };
