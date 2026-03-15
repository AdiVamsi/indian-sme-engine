'use strict';

const { prisma } = require('../lib/prisma');
const { logger } = require('../lib/logger');
const { sendWhatsAppMessage } = require('./whatsapp.service');

const HIGH_PRIORITY_THRESHOLD = 30;
const FALLBACK_WHATSAPP_REPLY = 'Thank you for your enquiry. Our team will contact you shortly.';
const HUMAN_HANDOFF_REPLY = 'Thanks. Our counsellor will continue with you on WhatsApp shortly.';

const DEMO_TAGS = new Set(['DEMO_REQUEST', 'DEMO', 'BOOK_DEMO']);
const ADMISSION_TAGS = new Set(['ADMISSION', 'COURSE_ENQUIRY']);
const FEE_TAGS = new Set(['FEE_ENQUIRY', 'FEES']);
const SCHOLARSHIP_TAGS = new Set(['SCHOLARSHIP_ENQUIRY', 'SCHOLARSHIP']);
const WRONG_FIT_TAGS = new Set(['WRONG_FIT']);

function normalizeTagSet(tags = []) {
  return new Set(Array.isArray(tags) ? tags : []);
}

function createConversationState({
  flowIntent = null,
  stage = 'HANDOFF_QUEUED',
  pendingField = null,
  collected = {},
  status = 'handoff',
} = {}) {
  return {
    version: 1,
    channel: 'whatsapp',
    flowIntent,
    stage,
    pendingField,
    collected,
    status,
  };
}

function buildHandoffPlan({
  reason = 'HUMAN_HANDOFF',
  message = HUMAN_HANDOFF_REPLY,
  flowIntent = null,
  collected = {},
  conversationMode = 'continuation',
} = {}) {
  return {
    reason,
    message,
    conversationMode,
    conversationState: createConversationState({
      flowIntent,
      stage: 'HANDOFF_QUEUED',
      pendingField: null,
      collected,
      status: 'handoff',
    }),
  };
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

function buildAcademyFirstReplyPlan({
  intent = null,
  tags = [],
  priorityScore = 0,
  confidenceLabel = 'high',
  leadDisposition = 'valid',
} = {}) {
  const replyIntent = resolveAcademyReplyIntent(intent, tags);

  if (confidenceLabel === 'low' || ['conflicting', 'weak'].includes(leadDisposition)) {
    return buildHandoffPlan({
      reason: 'LOW_CONFIDENCE_HANDOFF',
      flowIntent: replyIntent,
      conversationMode: 'initial',
    });
  }

  switch (replyIntent) {
    case 'WRONG_FIT':
      return {
        reason: 'WRONG_FIT',
        message: 'We currently focus on IIT-JEE coaching. If you are looking for JEE preparation, we can help. Otherwise this may not be the right institute for your requirement.',
        conversationMode: 'initial',
        conversationState: createConversationState({
          flowIntent: 'WRONG_FIT',
          stage: 'CLOSED',
          pendingField: null,
          collected: {},
          status: 'closed',
        }),
      };
    case 'DEMO_REQUEST':
      return {
        reason: 'DEMO_REQUEST',
        message: 'Sure — which class is the student in? I will help you with the right demo batch.',
        conversationMode: 'initial',
        conversationState: createConversationState({
          flowIntent: 'DEMO_REQUEST',
          stage: 'AWAITING_STUDENT_CLASS',
          pendingField: 'student_class',
          collected: {},
          status: 'awaiting_user',
        }),
      };
    case 'SCHOLARSHIP_ENQUIRY':
      return {
        reason: 'SCHOLARSHIP_ENQUIRY',
        message: 'Sure — what were the student\'s recent marks or percentage? That will help us guide you on scholarship options.',
        conversationMode: 'initial',
        conversationState: createConversationState({
          flowIntent: 'SCHOLARSHIP_ENQUIRY',
          stage: 'AWAITING_RECENT_MARKS',
          pendingField: 'recent_marks',
          collected: {},
          status: 'awaiting_user',
        }),
      };
    case 'FEE_ENQUIRY':
      return {
        reason: 'FEE_ENQUIRY',
        message: 'Sure — which class is the student in? I will help with the fee structure and batch options.',
        conversationMode: 'initial',
        conversationState: createConversationState({
          flowIntent: 'FEE_ENQUIRY',
          stage: 'AWAITING_STUDENT_CLASS',
          pendingField: 'student_class',
          collected: {},
          status: 'awaiting_user',
        }),
      };
    case 'ADMISSION':
      return {
        reason: 'ADMISSION',
        message: 'Thanks for reaching out. Admissions are open for our JEE batches. Which class is the student in?',
        conversationMode: 'initial',
        conversationState: createConversationState({
          flowIntent: 'ADMISSION',
          stage: 'AWAITING_STUDENT_CLASS',
          pendingField: 'student_class',
          collected: {},
          status: 'awaiting_user',
        }),
      };
    default:
      if (priorityScore >= HIGH_PRIORITY_THRESHOLD) {
        return buildHandoffPlan({
          reason: 'GENERIC_HIGH_PRIORITY',
          message: FALLBACK_WHATSAPP_REPLY,
          flowIntent: replyIntent,
          conversationMode: 'initial',
        });
      }
      return null;
  }
}

function buildWhatsAppReplyPlan({
  businessIndustry = 'other',
  intent = null,
  tags = [],
  priorityScore = 0,
  confidenceLabel = 'high',
  leadDisposition = 'valid',
} = {}) {
  if (businessIndustry !== 'academy') {
    if (priorityScore >= HIGH_PRIORITY_THRESHOLD) {
      return buildHandoffPlan({
        reason: 'GENERIC_HIGH_PRIORITY',
        message: FALLBACK_WHATSAPP_REPLY,
        flowIntent: intent,
        conversationMode: 'initial',
      });
    }
    return null;
  }

  return buildAcademyFirstReplyPlan({
    intent,
    tags,
    priorityScore,
    confidenceLabel,
    leadDisposition,
  });
}

function extractStudentClass(message = '') {
  const text = String(message || '').trim().toLowerCase();
  if (!text) return null;

  const classPattern = /\b(?:class|std|standard|grade)\s*(9|10|11|12)\b/;
  const ordinalMap = {
    '9th': 'Class 9',
    '10th': 'Class 10',
    '11th': 'Class 11',
    '12th': 'Class 12',
    ix: 'Class 9',
    x: 'Class 10',
    xi: 'Class 11',
    xii: 'Class 12',
  };

  const classMatch = text.match(classPattern);
  if (classMatch) return `Class ${classMatch[1]}`;

  for (const [token, label] of Object.entries(ordinalMap)) {
    if (new RegExp(`\\b${token}\\b`).test(text)) return label;
  }

  return null;
}

function extractMarks(message = '') {
  const text = String(message || '').trim().toLowerCase();
  if (!text) return null;

  const percentMatch = text.match(/\b(\d{2,3})\s*%/);
  if (percentMatch) return `${percentMatch[1]}%`;

  const wordMatch = text.match(/\b(\d{2,3})\s*(?:percent|percentage)\b/);
  if (wordMatch) return `${wordMatch[1]}%`;

  const scoreMatch = text.match(/\b(\d{2,3})\s*\/\s*100\b/);
  if (scoreMatch) return `${scoreMatch[1]}%`;

  return null;
}

function buildAcademyContinuationPlan({
  conversationState,
  message,
  priorityScore = 0,
} = {}) {
  const flowIntent = conversationState?.flowIntent || null;
  const collected = { ...(conversationState?.collected || {}) };

  if (!conversationState || conversationState.status === 'handoff') {
    return buildHandoffPlan({
      reason: 'HANDOFF_IN_PROGRESS',
      flowIntent,
      collected,
    });
  }

  if (conversationState.status !== 'awaiting_user') {
    return buildHandoffPlan({
      reason: 'OFF_FLOW_HANDOFF',
      flowIntent,
      collected,
    });
  }

  if (conversationState.pendingField === 'student_class') {
    const studentClass = extractStudentClass(message);
    if (!studentClass) {
      return buildHandoffPlan({
        reason: 'OFF_FLOW_HANDOFF',
        flowIntent,
        collected,
      });
    }

    collected.studentClass = studentClass;

    switch (flowIntent) {
      case 'FEE_ENQUIRY':
        return {
          reason: 'FEE_ENQUIRY_HANDOFF',
          message: `Thanks. For ${studentClass}, our team will send the fee structure and batch options shortly on WhatsApp.`,
          conversationMode: 'continuation',
          conversationState: createConversationState({
            flowIntent,
            stage: 'HANDOFF_QUEUED',
            pendingField: null,
            collected,
            status: 'handoff',
          }),
        };
      case 'DEMO_REQUEST':
        return {
          reason: 'DEMO_REQUEST_HANDOFF',
          message: `Thanks. For ${studentClass}, we can help with a demo class. Our team will confirm the next available slot shortly.`,
          conversationMode: 'continuation',
          conversationState: createConversationState({
            flowIntent,
            stage: 'HANDOFF_QUEUED',
            pendingField: null,
            collected,
            status: 'handoff',
          }),
        };
      case 'ADMISSION':
      default:
        return {
          reason: 'ADMISSION_HANDOFF',
          message: `Thanks. For ${studentClass}, our counsellor will guide you on the right JEE batch and call you shortly.`,
          conversationMode: 'continuation',
          conversationState: createConversationState({
            flowIntent: flowIntent || 'ADMISSION',
            stage: 'HANDOFF_QUEUED',
            pendingField: null,
            collected,
            status: 'handoff',
          }),
        };
    }
  }

  if (conversationState.pendingField === 'recent_marks') {
    const marks = extractMarks(message);
    if (!marks) {
      return buildHandoffPlan({
        reason: 'OFF_FLOW_HANDOFF',
        flowIntent,
        collected,
      });
    }

    collected.recentMarks = marks;
    const studentClass = extractStudentClass(message);
    if (studentClass) collected.studentClass = studentClass;

    return {
      reason: 'SCHOLARSHIP_ENQUIRY_HANDOFF',
      message: `Thanks. We have noted ${marks}. Our team will review the scholarship options and guide you shortly on WhatsApp.`,
      conversationMode: 'continuation',
      conversationState: createConversationState({
        flowIntent: flowIntent || 'SCHOLARSHIP_ENQUIRY',
        stage: 'HANDOFF_QUEUED',
        pendingField: null,
        collected,
        status: 'handoff',
      }),
    };
  }

  if (priorityScore >= HIGH_PRIORITY_THRESHOLD) {
    return buildHandoffPlan({
      reason: 'GENERIC_HIGH_PRIORITY_HANDOFF',
      flowIntent,
      collected,
    });
  }

  return buildHandoffPlan({
    reason: 'OFF_FLOW_HANDOFF',
    flowIntent,
    collected,
  });
}

function getLatestWhatsAppConversationState(activities = []) {
  for (const activity of [...activities].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))) {
    const metadata = activity?.metadata || {};
    if (metadata.channel === 'whatsapp' && metadata.conversationState) {
      return metadata.conversationState;
    }
  }

  return null;
}

function getLeadConversationContext(lead) {
  const activities = Array.isArray(lead?.activities) ? lead.activities : [];
  const classified = activities.find((activity) => activity.type === 'AGENT_CLASSIFIED');
  const prioritized = activities.find((activity) => activity.type === 'AGENT_PRIORITIZED');

  return {
    intent: classified?.metadata?.bestCategory || null,
    tags: classified?.metadata?.tags || [],
    priorityScore: prioritized?.metadata?.priorityScore || 0,
    confidenceLabel: classified?.metadata?.confidenceLabel || 'medium',
    leadDisposition: classified?.metadata?.leadDisposition || 'valid',
    businessIndustry: lead?.business?.industry || 'other',
  };
}

async function logWhatsAppActivity(leadId, {
  direction,
  phone = null,
  messageText = '',
  messageId = null,
  providerMessageId = null,
  reason,
  replyIntent = null,
  conversationMode = 'continuation',
  conversationState = null,
  timestamp = null,
} = {}) {
  const createdAt = timestamp ? new Date(timestamp) : undefined;
  const metadata = {
    reason,
    source: 'whatsapp',
    channel: 'whatsapp',
    direction,
    ...(phone ? { phone } : {}),
    ...(messageText ? { messageText } : {}),
    ...(messageId ? { messageId } : {}),
    ...(providerMessageId ? { providerMessageId } : {}),
    ...(replyIntent ? { replyIntent } : {}),
    ...(direction === 'outbound' ? { replyMessage: messageText } : {}),
    ...(conversationMode ? { conversationMode } : {}),
    ...(conversationState ? { conversationState } : {}),
    ...(createdAt ? { timestamp: createdAt.toISOString() } : {}),
  };

  return prisma.leadActivity.create({
    data: {
      leadId,
      type: 'AUTOMATION_ALERT',
      message: direction === 'inbound' ? 'WhatsApp inbound message received' : 'Automation: WhatsApp reply sent',
      metadata,
      ...(createdAt ? { createdAt } : {}),
    },
  });
}

async function recordWhatsAppInboundTurn(leadId, {
  phone = null,
  message = '',
  messageId = null,
  timestamp = null,
  conversationState = null,
  conversationMode = 'initial',
} = {}) {
  return logWhatsAppActivity(leadId, {
    direction: 'inbound',
    phone,
    messageText: message,
    messageId,
    reason: 'WHATSAPP_INBOUND_TURN',
    conversationMode,
    conversationState,
    timestamp,
  });
}

async function sendAndLogWhatsAppReply(leadId, phone, replyPlan) {
  const replyResult = await sendWhatsAppMessage(phone, replyPlan.message);
  const providerMessageId = replyResult?.messages?.[0]?.id || null;

  logger.info(
    {
      leadId,
      phone,
      replyReason: replyPlan.reason,
      providerMessageId,
    },
    'WhatsApp automation reply sent'
  );

  await logWhatsAppActivity(leadId, {
    direction: 'outbound',
    phone,
    messageText: replyPlan.message,
    providerMessageId,
    reason: 'WHATSAPP_AUTO_REPLY',
    replyIntent: replyPlan.reason,
    conversationMode: replyPlan.conversationMode || 'initial',
    conversationState: replyPlan.conversationState || null,
  });

  return { providerMessageId };
}

async function continueWhatsAppConversation(leadId, {
  phone = null,
  message = '',
  messageId = null,
  timestamp = null,
} = {}) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      business: { select: { id: true, industry: true, slug: true } },
      activities: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!lead) {
    throw new Error(`Lead ${leadId} not found for WhatsApp continuation`);
  }

  const priorState = getLatestWhatsAppConversationState(lead.activities);
  await recordWhatsAppInboundTurn(leadId, {
    phone,
    message,
    messageId,
    timestamp,
    conversationState: priorState,
    conversationMode: 'continuation',
  });

  const context = getLeadConversationContext(lead);
  const replyPlan = buildAcademyContinuationPlan({
    conversationState: priorState,
    message,
    priorityScore: context.priorityScore,
  });

  if (!replyPlan?.message) {
    return {
      leadId,
      continued: true,
      replySent: false,
      conversationState: priorState,
    };
  }

  const { providerMessageId } = await sendAndLogWhatsAppReply(leadId, phone, replyPlan);
  return {
    leadId,
    continued: true,
    replySent: true,
    providerMessageId,
    conversationState: replyPlan.conversationState,
    replyReason: replyPlan.reason,
  };
}

async function runLeadAutomations(leadId, {
  tags = [],
  intent = null,
  priorityScore = 0,
  businessIndustry = 'other',
  source = 'web',
  phone = null,
  confidenceLabel = 'high',
  leadDisposition = 'valid',
} = {}) {
  const creates = [];
  const replyPlan = buildWhatsAppReplyPlan({
    businessIndustry,
    intent,
    tags,
    priorityScore,
    confidenceLabel,
    leadDisposition,
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
      await sendAndLogWhatsAppReply(leadId, phone, replyPlan);
      whatsappReplySent = true;
    } catch (err) {
      logger.error({ err, leadId, phone }, 'WhatsApp automation reply failed');
    }
  }

  return {
    triggered: creates.length + (whatsappReplySent ? 1 : 0),
    whatsappReplySent,
    conversationState: replyPlan?.conversationState || null,
  };
}

module.exports = {
  buildWhatsAppReplyPlan,
  buildAcademyContinuationPlan,
  continueWhatsAppConversation,
  getLatestWhatsAppConversationState,
  recordWhatsAppInboundTurn,
  runLeadAutomations,
};
