'use strict';

const { prisma } = require('../lib/prisma');
const { logger } = require('../lib/logger');
const { sendWhatsAppMessage } = require('./whatsapp.service');

const HIGH_PRIORITY_THRESHOLD = 30;
const FALLBACK_WHATSAPP_REPLY = 'Thank you for your enquiry. Our team will contact you shortly.';

const DEMO_TAGS = new Set(['DEMO_REQUEST', 'DEMO', 'BOOK_DEMO']);
const ADMISSION_TAGS = new Set(['ADMISSION', 'COURSE_ENQUIRY']);
const FEE_TAGS = new Set(['FEE_ENQUIRY', 'FEES']);
const SCHOLARSHIP_TAGS = new Set(['SCHOLARSHIP_ENQUIRY', 'SCHOLARSHIP']);
const WRONG_FIT_TAGS = new Set(['WRONG_FIT']);

function normalizeTagSet(tags = []) {
  return new Set(Array.isArray(tags) ? tags : []);
}

function deriveActionHint(suggestedNextAction = '') {
  const text = String(suggestedNextAction || '').trim().toLowerCase();
  if (!text) return '';
  if (text.includes('call')) return ' Our counsellor will call you shortly.';
  if (text.includes('demo')) return ' We will confirm the next demo slot shortly.';
  if (text.includes('whatsapp') || text.includes('share')) return ' We can share the details here on WhatsApp.';
  return '';
}

function resolveAcademyReplyIntent(intent, tags) {
  const tagSet = normalizeTagSet(tags);
  const normalizedIntent = String(intent || '').trim().toUpperCase();

  if (normalizedIntent === 'WRONG_FIT' || [...WRONG_FIT_TAGS].some((tag) => tagSet.has(tag))) {
    return 'WRONG_FIT';
  }
  if (normalizedIntent === 'DEMO_REQUEST' || [...DEMO_TAGS].some((tag) => tagSet.has(tag))) {
    return 'DEMO_REQUEST';
  }
  if (normalizedIntent === 'SCHOLARSHIP_ENQUIRY' || [...SCHOLARSHIP_TAGS].some((tag) => tagSet.has(tag))) {
    return 'SCHOLARSHIP_ENQUIRY';
  }
  if (normalizedIntent === 'FEE_ENQUIRY' || [...FEE_TAGS].some((tag) => tagSet.has(tag))) {
    return 'FEE_ENQUIRY';
  }
  if (normalizedIntent === 'ADMISSION' || [...ADMISSION_TAGS].some((tag) => tagSet.has(tag))) {
    return 'ADMISSION';
  }

  return null;
}

function buildWhatsAppReplyPlan({
  businessIndustry = 'other',
  intent = null,
  tags = [],
  priorityScore = 0,
  suggestedNextAction = '',
} = {}) {
  if (businessIndustry !== 'academy') {
    if (priorityScore >= HIGH_PRIORITY_THRESHOLD) {
      return {
        reason: 'GENERIC_HIGH_PRIORITY',
        message: FALLBACK_WHATSAPP_REPLY,
      };
    }
    return null;
  }

  const replyIntent = resolveAcademyReplyIntent(intent, tags);
  const actionHint = deriveActionHint(suggestedNextAction);

  switch (replyIntent) {
    case 'WRONG_FIT':
      return {
        reason: 'WRONG_FIT',
        message: 'We currently focus on IIT-JEE coaching. If you are looking for JEE preparation, we can help. Otherwise this may not be the right institute for your requirement.',
      };
    case 'DEMO_REQUEST':
      return {
        reason: 'DEMO_REQUEST',
        message: 'Sure — we can arrange a demo class. Please share the student\'s class and preferred timing, and our team will confirm the next available slot.',
      };
    case 'SCHOLARSHIP_ENQUIRY':
      return {
        reason: 'SCHOLARSHIP_ENQUIRY',
        message: 'Yes, we do guide eligible students on scholarship options. Please share the student\'s class and recent marks, and our team will explain the criteria.',
      };
    case 'FEE_ENQUIRY':
      return {
        reason: 'FEE_ENQUIRY',
        message: 'Sure — please share the student\'s class, and we will send the fee structure and batch options here on WhatsApp.',
      };
    case 'ADMISSION':
      return {
        reason: 'ADMISSION',
        message: `Thanks for reaching out. Admissions are open for our JEE batches. Please share the student\'s class, and our counsellor will guide you on the right batch.${actionHint}`.trim(),
      };
    default:
      if (priorityScore >= HIGH_PRIORITY_THRESHOLD) {
        return {
          reason: 'GENERIC_HIGH_PRIORITY',
          message: `${FALLBACK_WHATSAPP_REPLY}${actionHint}`.trim(),
        };
      }
      return null;
  }
}

async function runLeadAutomations(leadId, {
  tags = [],
  intent = null,
  priorityScore = 0,
  businessIndustry = 'other',
  source = 'web',
  phone = null,
  suggestedNextAction = '',
} = {}) {
  const creates = [];
  const replyPlan = buildWhatsAppReplyPlan({
    businessIndustry,
    intent,
    tags,
    priorityScore,
    suggestedNextAction,
  });
  const shouldSendWhatsAppReply = source === 'whatsapp'
    && Boolean(phone)
    && Boolean(replyPlan?.message);

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
      const replyResult = await sendWhatsAppMessage(phone, replyPlan.message);
      whatsappReplySent = true;
      logger.info(
        {
          leadId,
          phone,
          replyReason: replyPlan.reason,
          providerMessageId: replyResult?.messages?.[0]?.id || null,
        },
        'WhatsApp automation reply sent'
      );
      await prisma.leadActivity.create({
        data: {
          leadId,
          type: 'AUTOMATION_ALERT',
          message: 'Automation: WhatsApp acknowledgement sent',
          metadata: {
            reason: 'WHATSAPP_AUTO_REPLY',
            source,
            channel: 'whatsapp',
            phone,
            replyIntent: replyPlan.reason,
            replyMessage: replyPlan.message,
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

module.exports = { buildWhatsAppReplyPlan, runLeadAutomations };
