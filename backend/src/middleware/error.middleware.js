'use strict';

const { logger } = require('../lib/logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || err.status || 500;
  const requestLogger = req?.log || logger;

  requestLogger.error({
    err,
    requestId: req?.id,
  }, 'request failed');

  if (res.headersSent) {
    return next(err);
  }

  return res.status(statusCode).json({
    error: statusCode >= 500 ? 'Internal server error' : (err.message || 'Request failed'),
    requestId: req?.id,
  });
}

module.exports = { errorHandler };
