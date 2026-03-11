'use strict';

const { prisma } = require('../lib/prisma');
const { logger } = require('../lib/logger');
const { sendWhatsAppMessage } = require('./whatsapp.service');

const HIGH_PRIORITY_THRESHOLD = 30;
const HIGH_PRIORITY_WHATSAPP_REPLY = 'Thank you for your enquiry. Our team will contact you shortly.';

const DEMO_TAGS = new Set(['DEMO_REQUEST', 'DEMO', 'BOOK_DEMO']);
const ADMISSION_TAGS = new Set(['ADMISSION', 'COURSE_ENQUIRY']);

async function runLeadAutomations(leadId, {
  tags = [],
  priorityScore = 0,
  source = 'web',
  phone = null,
} = {}) {
  const creates = [];
  const shouldSendWhatsAppReply = source === 'whatsapp'
    && priorityScore >= HIGH_PRIORITY_THRESHOLD
    && Boolean(phone);

  if (priorityScore >= HIGH_PRIORITY_THRESHOLD) {
    creates.push(
      prisma.leadActivity.create({
        data: {
          leadId,
          type: 'AUTOMATION_ALERT',
          message: `Automation: high-priority lead detected (score ${priorityScore})`,
          metadata: {
            reason: 'HIGH_PRIORITY_LEAD',
            score: priorityScore,
            source,
          },
        },
      })
    );
  }

  if (tags.some((tag) => DEMO_TAGS.has(tag))) {
    creates.push(
      prisma.leadActivity.create({
        data: {
          leadId,
          type: 'AUTOMATION_DEMO_INTENT',
          message: 'Automation: demo intent detected',
          metadata: { intent: 'DEMO_REQUEST', source },
        },
      })
    );
  }

  if (tags.some((tag) => ADMISSION_TAGS.has(tag))) {
    creates.push(
      prisma.leadActivity.create({
        data: {
          leadId,
          type: 'AUTOMATION_ADMISSION_INTENT',
          message: 'Automation: admission intent detected',
          metadata: { intent: 'ADMISSION', source },
        },
      })
    );
  }

  if (creates.length) {
    await prisma.$transaction(creates);
  }

  let whatsappReplySent = false;
  if (shouldSendWhatsAppReply) {
    try {
      const replyResult = await sendWhatsAppMessage(phone, HIGH_PRIORITY_WHATSAPP_REPLY);
      whatsappReplySent = true;
      await prisma.leadActivity.create({
        data: {
          leadId,
          type: 'AUTOMATION_ALERT',
          message: 'Automation: WhatsApp acknowledgement sent',
          metadata: {
            reason: 'HIGH_PRIORITY_WHATSAPP_REPLY',
            source,
            channel: 'whatsapp',
            phone,
            replyMessage: HIGH_PRIORITY_WHATSAPP_REPLY,
            providerMessageId: replyResult?.messages?.[0]?.id || null,
          },
        },
      });
    } catch (err) {
      logger.error({ err, leadId, phone }, 'WhatsApp automation reply failed');
    }
  }

  return {
    triggered: creates.length + (whatsappReplySent ? 1 : 0),
    whatsappReplySent,
  };
}

module.exports = { runLeadAutomations };
