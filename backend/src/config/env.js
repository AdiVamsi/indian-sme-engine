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

/* The WhatsApp webhook route is always mounted. Without WHATSAPP_APP_SECRET,
   verifyWhatsAppSignature() treats every inbound POST as valid-but-unchecked,
   so any configured production integration must have it set. */
const whatsappConfigured = Boolean(process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_PHONE_ID);
if (
  NODE_ENV === 'production'
  && whatsappConfigured
  && process.env.REQUIRE_WHATSAPP_APP_SECRET !== 'false'
) {
  REQUIRED.push('WHATSAPP_APP_SECRET');
}

/* Without CORS_ORIGIN, app.js falls back to reflecting any request origin
   with credentials enabled — fine for local dev, unsafe in production. */
if (NODE_ENV === 'production') {
  REQUIRED.push('CORS_ORIGIN');
}

for (const key of REQUIRED) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

if (NODE_ENV === 'production' && process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}

module.exports = {
  PORT:          parseInt(process.env.PORT, 10) || 4000,
  DATABASE_URL:  process.env.DATABASE_URL,
  JWT_SECRET:    process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || null,
  NODE_ENV,
};
