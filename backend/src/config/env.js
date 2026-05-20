'use strict';

require('dotenv').config({ quiet: process.env.NODE_ENV === 'test' });

const NODE_ENV = process.env.NODE_ENV || 'development';
const REQUIRED = ['DATABASE_URL', 'JWT_SECRET'];

if (
  NODE_ENV === 'production'
  && process.env.REQUIRE_OPENAI_API_KEY !== 'false'
  && (process.env.LLM_CLASSIFIER_PROVIDER || 'openai').toLowerCase() === 'openai'
) {
  REQUIRED.push('OPENAI_API_KEY');
}

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
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || null,
  NODE_ENV,
};
