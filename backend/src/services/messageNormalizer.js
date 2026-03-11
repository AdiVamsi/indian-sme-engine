'use strict';

function normalizePhoneNumber(phone, { withPlus = true } = {}) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;

  const normalizedDigits = digits.length === 10 ? `91${digits}` : digits;
  return withPlus ? `+${normalizedDigits}` : normalizedDigits;
}

function normalizeWhatsAppMessage({
  senderName,
  phone,
  message,
  messageId,
  timestamp,
} = {}) {
  return {
    name: (senderName || 'WhatsApp User').trim() || 'WhatsApp User',
    phone: normalizePhoneNumber(phone),
    message: typeof message === 'string' ? message.trim() : '',
    source: 'whatsapp',
    externalMessageId: messageId || null,
    receivedAt: timestamp ? new Date(Number(timestamp) * 1000).toISOString() : new Date().toISOString(),
  };
}

module.exports = {
  normalizePhoneNumber,
  normalizeWhatsAppMessage,
};
