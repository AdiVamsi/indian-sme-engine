'use strict';

require('dotenv').config();

const REQUIRED = ['DATABASE_URL', 'JWT_SECRET'];

for (const key of REQUIRED) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

module.exports = {
  PORT:          parseInt(process.env.PORT, 10) || 4000,
  DATABASE_URL:  process.env.DATABASE_URL,
  JWT_SECRET:    process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  NODE_ENV:      process.env.NODE_ENV || 'development',
};
