'use strict';

const { prisma } = require('../lib/prisma');
const { logger } = require('../lib/logger');
const { normalizePhoneNumber } = require('./messageNormalizer');

const GRAPH_API_BASE_URL = 'https://graph.facebook.com/v18.0';

function getWhatsAppConfig() {
  return {
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_ID,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
  };
}

function extractIncomingMessages(payload = {}) {
  const extracted = [];
  const entries = Array.isArray(payload.entry) ? payload.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];

    for (const change of changes) {
      const value = change?.value || {};
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const messages = Array.isArray(value.messages) ? value.messages : [];
      const metadata = value.metadata || {};

      for (const message of messages) {
        const text =
          message?.text?.body
          || message?.button?.text
          || message?.interactive?.button_reply?.title
          || message?.interactive?.list_reply?.title
          || '';

        if (!text.trim()) continue;

        const contact = contacts.find((candidate) => candidate.wa_id === message.from) || contacts[0] || {};
        extracted.push({
          senderPhone: normalizePhoneNumber(message.from),
          senderName: contact?.profile?.name || 'WhatsApp User',
          message: text.trim(),
          timestamp: message.timestamp,
          messageId: message.id,
          displayPhoneNumber: metadata.display_phone_number,
          phoneNumberId: metadata.phone_number_id,
        });
      }
    }
  }

  return extracted;
}

async function findBusinessForWhatsAppInbound({ displayPhoneNumber } = {}) {
  const normalizedDestination = normalizePhoneNumber(displayPhoneNumber);
  if (!normalizedDestination) return null;

  const businesses = await prisma.business.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      phone: true,
      industry: true,
    },
  });

  return businesses.find((business) => normalizePhoneNumber(business.phone) === normalizedDestination) || null;
}

async function sendWhatsAppMessage(phone, message) {
  const { token, phoneNumberId } = getWhatsAppConfig();

  if (!token || !phoneNumberId) {
    throw new Error('WhatsApp API credentials are not configured');
  }

  const to = normalizePhoneNumber(phone, { withPlus: false });
  if (!to) {
    throw new Error('Invalid WhatsApp recipient phone number');
  }

  const response = await fetch(`${GRAPH_API_BASE_URL}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    logger.error({ payload }, 'WhatsApp API request failed');
    throw new Error(payload?.error?.message || `WhatsApp API error ${response.status}`);
  }

  return payload;
}

module.exports = {
  extractIncomingMessages,
  findBusinessForWhatsAppInbound,
  getWhatsAppConfig,
  sendWhatsAppMessage,
};
