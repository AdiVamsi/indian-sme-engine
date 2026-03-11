'use strict';

const { randomUUID } = require('node:crypto');

function attachRequestId(req, res, next) {
  const requestId = req.headers['x-request-id'] || randomUUID();

  req.id = requestId;
  res.locals.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  next();
}

module.exports = { attachRequestId };
