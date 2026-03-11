'use strict';

const { Router } = require('express');

const { emitLeadCreated } = require('../controllers/leads.controller');
const { createLead } = require('../services/leads.service');
const { normalizeWhatsAppMessage } = require('../services/messageNormalizer');
const {
  extractIncomingMessages,
  findBusinessForWhatsAppInbound,
  getWhatsAppConfig,
} = require('../services/whatsapp.service');

const router = Router();

function verifyWhatsAppWebhook(req, res, next) {
  const { verifyToken } = getWhatsAppConfig();
  const suppliedToken = req.get('x-whatsapp-verify-token') || req.query.verify_token;

  if (!verifyToken || suppliedToken !== verifyToken) {
    return res.status(403).json({ error: 'Invalid WhatsApp webhook token' });
  }

  return next();
}

router.get('/', (req, res) => {
  const { verifyToken } = getWhatsAppConfig();
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === verifyToken) {
    return res.status(200).send(challenge);
  }

  return res.status(403).json({ error: 'Webhook verification failed' });
});

router.post('/', verifyWhatsAppWebhook, async (req, res, next) => {
  try {
    const incomingMessages = extractIncomingMessages(req.body);
    if (!incomingMessages.length) {
      return res.status(200).json({ received: true, processed: 0 });
    }

    let processed = 0;

    for (const incoming of incomingMessages) {
      const business = await findBusinessForWhatsAppInbound(incoming);
      if (!business) {
        req.log?.warn({ incoming }, 'No business matched inbound WhatsApp destination');
        continue;
      }

      const leadInput = normalizeWhatsAppMessage({
        senderName: incoming.senderName,
        phone: incoming.senderPhone,
        message: incoming.message,
        messageId: incoming.messageId,
        timestamp: incoming.timestamp,
      });

      const lead = await createLead(business.id, leadInput);
      emitLeadCreated(business.id, lead);
      processed += 1;
    }

    return res.status(200).json({ received: true, processed });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
