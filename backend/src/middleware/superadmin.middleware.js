'use strict';

const { verifySuperAdmin } = require('../utils/superadmin-jwt');

/**
 * authenticateSuperAdmin
 * Reads `Authorization: Bearer <token>`, verifies signature, enforces role === 'SUPERADMIN'.
 * Attaches decoded payload to req.superadmin.
 */
const authenticateSuperAdmin = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = header.slice(7);
  try {
    const payload = verifySuperAdmin(token);
    if (payload.role !== 'SUPERADMIN') {
      return res.status(403).json({ error: 'Forbidden — SUPERADMIN role required' });
    }
    req.superadmin = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

module.exports = { authenticateSuperAdmin };
