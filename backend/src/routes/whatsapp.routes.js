'use strict';

const { Router } = require('express');

const { emitLeadCreated } = require('../controllers/leads.controller');
const { logger } = require('../lib/logger');
const { continueWhatsAppConversation, recordWhatsAppInboundTurn } = require('../services/automation.service');
const { saveRawLead, processLeadAfterSave, findActiveWhatsAppLead } = require('../services/leads.service');
const { normalizeWhatsAppMessage } = require('../services/messageNormalizer');
const {
  extractIncomingMessages,
  findBusinessForWhatsAppInbound,
  getWhatsAppConfig,
  verifyWhatsAppSignature,
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
      const business = await findBusinessForWhatsAppInbound(incoming, log);
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

      const existingLead = await findActiveWhatsAppLead(business.id, incoming.senderPhone);
      if (existingLead) {
        log.info(
          {
            businessId: business.id,
            slug: business.slug,
            leadId: existingLead.id,
            senderPhone: incoming.senderPhone,
            messageId: incoming.messageId,
          },
          'WhatsApp continuation routed to existing lead'
        );

        const continuationResult = await continueWhatsAppConversation(existingLead.id, {
          phone: incoming.senderPhone,
          message: incoming.message,
          messageId: incoming.messageId,
          timestamp: incoming.timestamp ? Number(incoming.timestamp) * 1000 : null,
        });
        processed += 1;

        const continuationLogContext = {
          businessId: business.id,
          slug: business.slug,
          leadId: existingLead.id,
          replySent: continuationResult.replySent,
          replyFailed: continuationResult.replyFailed || false,
          replyReason: continuationResult.replyReason || null,
          failureCategory: continuationResult.failureCategory || null,
          failureTitle: continuationResult.failureTitle || null,
          conversationState: continuationResult.conversationState || null,
        };

        if (continuationResult.replyFailed) {
          log.warn(continuationLogContext, 'WhatsApp continuation handled with outbound reply failure');
        } else {
          log.info(continuationLogContext, 'WhatsApp continuation handled');
        }
        continue;
      }

      const leadInput = normalizeWhatsAppMessage({
        senderName: incoming.senderName,
        phone: incoming.senderPhone,
        message: incoming.message,
        messageId: incoming.messageId,
        timestamp: incoming.timestamp,
      });

      const rawLead = await saveRawLead(business.id, leadInput);
      await recordWhatsAppInboundTurn(rawLead.id, {
        phone: rawLead.phone,
        message: incoming.message,
        messageId: incoming.messageId,
        timestamp: rawLead.receivedAt,
        conversationMode: 'initial',
      });
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

      const processedLeadLogContext = {
        businessId: business.id,
        slug: business.slug,
        leadId: processedLead.id,
        priority: processedLead.priority,
        priorityScore: processedLead.priorityScore,
        tags: processedLead.tags,
        whatsappNeedsAttention: processedLead.whatsappNeedsAttention || false,
        whatsappFailureTitle: processedLead.whatsappFailureTitle || null,
        whatsappFailureCategory: processedLead.whatsappFailureCategory || null,
      };

      if (processedLead.whatsappNeedsAttention) {
        log.warn(processedLeadLogContext, 'WhatsApp lead processed but outbound reply failed');
      } else {
        log.info(processedLeadLogContext, 'WhatsApp lead processed and broadcast');
      }
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
    const { appSecret } = getWhatsAppConfig();
    const signatureHeader = req.get('x-hub-signature-256');
    const signatureCheck = verifyWhatsAppSignature(req.rawBody, signatureHeader, appSecret);

    if (signatureCheck.checked && !signatureCheck.valid) {
      log.warn(
        {
          reason: signatureCheck.reason,
          hasSignatureHeader: Boolean(signatureHeader),
        },
        'WhatsApp webhook signature verification failed'
      );
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const incomingMessages = extractIncomingMessages(req.body);
    const statusCount = countWebhookStatuses(req.body);

    log.info(
      {
        userAgent: req.get('user-agent'),
        object: req.body?.object || null,
        messageCount: incomingMessages.length,
        statusCount,
        signatureVerified: signatureCheck.checked,
      },
      'Inbound WhatsApp webhook POST received'
    );

    if (!incomingMessages.length) {
      log.info({ statusCount }, 'WhatsApp webhook accepted without inbound messages');
      return res.status(200).json({ received: true, processed: 0 });
    }
    void processIncomingMessages(incomingMessages, log);

    return res.status(200).json({ received: true, accepted: incomingMessages.length });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
