'use strict';

const jwt = require('jsonwebtoken');

/* Fail fast at startup — SUPERADMIN_SECRET must be set explicitly.
   No fallback to JWT_SECRET: the two auth systems must be cryptographically independent. */
if (!process.env.SUPERADMIN_SECRET) {
  throw new Error('SUPERADMIN_SECRET is not set in environment variables');
}

const SECRET     = process.env.SUPERADMIN_SECRET;
const EXPIRES_IN = '12h';

const signSuperAdmin   = (payload) => jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
const verifySuperAdmin = (token)   => jwt.verify(token, SECRET);

module.exports = { signSuperAdmin, verifySuperAdmin };
