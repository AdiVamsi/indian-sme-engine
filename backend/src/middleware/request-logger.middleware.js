'use strict';

const { logger } = require('../lib/logger');

function logRequests(req, res, next) {
  const startedAt = process.hrtime.bigint();
  req.log = logger.child({ requestId: req.id });

  req.log.info({
    req: {
      method: req.method,
      path: req.originalUrl,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    },
  }, 'request started');

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    req.log.info({
      res: {
        statusCode: res.statusCode,
      },
      durationMs: Number(durationMs.toFixed(2)),
    }, 'request completed');
  });

  next();
}

module.exports = { logRequests };
