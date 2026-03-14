'use strict';

const { Router } = require('express');

const { emitLeadCreated } = require('../controllers/leads.controller');
const { logger } = require('../lib/logger');
const { saveRawLead, processLeadAfterSave } = require('../services/leads.service');
const { normalizeWhatsAppMessage } = require('../services/messageNormalizer');
const {
  extractIncomingMessages,
  findBusinessForWhatsAppInbound,
  getWhatsAppConfig,
} = require('../services/whatsapp.service');

const router = Router();

function countWebhookStatuses(payload = {}) {
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  let count = 0;

  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      const statuses = Array.isArray(change?.value?.statuses) ? change.value.statuses : [];
      count += statuses.length;
    }
  }

  return count;
}

async function processIncomingMessages(incomingMessages, log) {
  let processed = 0;

  for (const incoming of incomingMessages) {
    try {
      const business = await findBusinessForWhatsAppInbound(incoming);
      if (!business) {
        log.warn(
          {
            displayPhoneNumber: incoming.displayPhoneNumber,
            phoneNumberId: incoming.phoneNumberId,
            senderPhone: incoming.senderPhone,
            messageId: incoming.messageId,
          },
          'WhatsApp tenant resolution failed'
        );
        continue;
      }

      log.info(
        {
          businessId: business.id,
          slug: business.slug,
          senderPhone: incoming.senderPhone,
          messageId: incoming.messageId,
        },
        'WhatsApp tenant resolved'
      );

      const leadInput = normalizeWhatsAppMessage({
        senderName: incoming.senderName,
        phone: incoming.senderPhone,
        message: incoming.message,
        messageId: incoming.messageId,
        timestamp: incoming.timestamp,
      });

      const rawLead = await saveRawLead(business.id, leadInput);
      log.info(
        {
          businessId: business.id,
          slug: business.slug,
          leadId: rawLead.id,
          phone: rawLead.phone,
          source: rawLead.source,
        },
        'WhatsApp lead saved'
      );

      const processedLead = await processLeadAfterSave(rawLead, {
        businessId: business.id,
        source: rawLead.source,
        externalMessageId: rawLead.externalMessageId,
        receivedAt: rawLead.receivedAt,
      });

      emitLeadCreated(business.id, processedLead);
      processed += 1;

      log.info(
        {
          businessId: business.id,
          slug: business.slug,
          leadId: processedLead.id,
          priority: processedLead.priority,
          priorityScore: processedLead.priorityScore,
          tags: processedLead.tags,
        },
        'WhatsApp lead processed and broadcast'
      );
    } catch (err) {
      log.error(
        {
          err,
          senderPhone: incoming.senderPhone,
          messageId: incoming.messageId,
          displayPhoneNumber: incoming.displayPhoneNumber,
        },
        'WhatsApp webhook background processing failed'
      );
    }
  }

  log.info({ processed, received: incomingMessages.length }, 'WhatsApp webhook background processing finished');
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

router.post('/', async (req, res, next) => {
  try {
    const log = req.log || logger;
    const incomingMessages = extractIncomingMessages(req.body);
    const statusCount = countWebhookStatuses(req.body);

    log.info(
      {
        userAgent: req.get('user-agent'),
        object: req.body?.object || null,
        messageCount: incomingMessages.length,
        statusCount,
      },
      'Inbound WhatsApp webhook POST received'
    );

    if (!incomingMessages.length) {
      log.info({ statusCount }, 'WhatsApp webhook accepted without inbound messages');
      return res.status(200).json({ received: true, processed: 0 });
    }

    /* TODO: add Meta X-Hub-Signature-256 verification for POST requests. GET verification
     * is correct today, but production POST authenticity should be validated via signature,
     * not a custom shared header. */
    void processIncomingMessages(incomingMessages, log);

    return res.status(200).json({ received: true, accepted: incomingMessages.length });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
