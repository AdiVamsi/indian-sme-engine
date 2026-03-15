'use strict';

const { prisma } = require('../lib/prisma');
const { logger } = require('../lib/logger');
const { getOrCreate: getOrCreateAgentConfig } = require('./agentConfig.service');
const { sendWhatsAppMessage } = require('./whatsapp.service');
const {
  getRequiredCollectedFields,
  resolveWhatsAppReplyConfig,
} = require('./whatsappReplyConfig.service');

const HIGH_PRIORITY_THRESHOLD = 30;

const DEMO_TAGS = new Set(['DEMO_REQUEST', 'DEMO', 'BOOK_DEMO']);
const ADMISSION_TAGS = new Set(['ADMISSION', 'COURSE_ENQUIRY']);
const FEE_TAGS = new Set(['FEE_ENQUIRY', 'FEES']);
const SCHOLARSHIP_TAGS = new Set(['SCHOLARSHIP_ENQUIRY', 'SCHOLARSHIP']);
const WRONG_FIT_TAGS = new Set(['WRONG_FIT']);
const CALLBACK_TAGS = new Set(['CALLBACK_REQUEST']);

function formatList(items = []) {
  const values = items.filter(Boolean);
  if (!values.length) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

function renderTemplate(template = '', tokens = {}) {
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => tokens[key] || '');
}

function getInstitutionLabel(replyConfig = {}) {
  return replyConfig?.institutionLabel || 'counsellor';
}

function getInstitutionPhrase(replyConfig = {}) {
  return `our ${getInstitutionLabel(replyConfig)}`;
}

function getLanguageSupportSuffix(replyConfig = {}) {
  return /hindi/i.test(String(replyConfig?.preferredLanguage || ''))
    ? ' We can assist in Hindi as well.'
    : '';
}

function getGeneralOfferingsPrompt(replyConfig = {}) {
  const offerings = Array.isArray(replyConfig?.supportedOfferings) ? replyConfig.supportedOfferings : [];
  return offerings.length ? formatList(offerings.slice(0, 3)) : 'fee details, a demo class, or admission guidance';
}

function getPendingFieldForIntent(intent, requiredFields = []) {
  const normalizedIntent = String(intent || '').trim().toUpperCase();
  const fieldSet = new Set(requiredFields);

  if (!fieldSet.size) return null;
  if (normalizedIntent === 'SCHOLARSHIP_ENQUIRY' || fieldSet.has('recentMarks')) return 'recent_marks';
  if (normalizedIntent === 'CALLBACK_REQUEST' || fieldSet.has('preferredCallTime')) return 'callback_details';
  if (normalizedIntent === 'GENERAL_ENQUIRY' || fieldSet.has('topic')) return 'general_enquiry_details';
  if (fieldSet.has('studentClass')) return 'student_class';
  return null;
}

function createConfiguredHandoffPlan({
  reason = 'HUMAN_HANDOFF',
  templateKey = 'inProgress',
  fallbackMessage,
  replyConfig,
  flowIntent = null,
  collected = {},
  conversationMode = 'continuation',
} = {}) {
  const message = renderTemplate(
    replyConfig?.handoffWording?.[templateKey] || fallbackMessage,
    { institutionLabel: getInstitutionLabel(replyConfig) }
  ).trim();

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

function buildWrongFitReply(replyConfig = {}) {
  const primaryOffering = replyConfig?.primaryOffering || 'IIT-JEE coaching';
  const offeringSummary = getGeneralOfferingsPrompt(replyConfig);
  const wrongFitSummary = Array.isArray(replyConfig?.wrongFitCategories) && replyConfig.wrongFitCategories.length
    ? ` Enquiries related to ${formatList(replyConfig.wrongFitCategories.slice(0, 3))} may not be the right fit for this institute.`
    : '';

  return `We currently focus on ${primaryOffering}. If you need help with ${offeringSummary}, ${getInstitutionPhrase(replyConfig)} will be happy to guide you.${wrongFitSummary}`;
}

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
  if (normalizedIntent === 'CALLBACK_REQUEST' || [...CALLBACK_TAGS].some((tag) => tagSet.has(tag))) {
    return 'CALLBACK_REQUEST';
  }
  if (normalizedIntent === 'ADMISSION' || [...ADMISSION_TAGS].some((tag) => tagSet.has(tag))) {
    return 'ADMISSION';
  }
  if (normalizedIntent === 'GENERAL_ENQUIRY') {
    return 'GENERAL_ENQUIRY';
  }

  return null;
}

function buildAcademyFirstReplyPlan({
  intent = null,
  tags = [],
  priorityScore = 0,
  confidenceLabel = 'high',
  leadDisposition = 'valid',
  replyConfig = {},
} = {}) {
  const replyIntent = resolveAcademyReplyIntent(intent, tags);
  const institutionPhrase = getInstitutionPhrase(replyConfig);
  const requiredFields = getRequiredCollectedFields(replyConfig, replyIntent);
  const pendingField = getPendingFieldForIntent(replyIntent, requiredFields);
  const languageSupportSuffix = getLanguageSupportSuffix(replyConfig);

  if (confidenceLabel === 'low' || ['conflicting', 'weak'].includes(leadDisposition)) {
    return createConfiguredHandoffPlan({
      reason: 'LOW_CONFIDENCE_HANDOFF',
      templateKey: 'lowConfidence',
      fallbackMessage: 'Thank you. Our counsellor will continue with you on WhatsApp shortly.',
      replyConfig,
      flowIntent: replyIntent,
      conversationMode: 'initial',
    });
  }

  switch (replyIntent) {
    case 'WRONG_FIT':
      return {
        reason: 'WRONG_FIT',
        message: buildWrongFitReply(replyConfig),
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
      if (!pendingField) {
        return createConfiguredHandoffPlan({
          reason: 'DEMO_REQUEST_DIRECT_HANDOFF',
          fallbackMessage: `Thank you. ${institutionPhrase} will help you with the next available demo class slot shortly.`,
          replyConfig,
          flowIntent: 'DEMO_REQUEST',
          conversationMode: 'initial',
        });
      }
      return {
        reason: 'DEMO_REQUEST',
        message: `Certainly. Please share the student's class, and ${institutionPhrase} will help you with the right demo class.${languageSupportSuffix}`,
        conversationMode: 'initial',
        conversationState: createConversationState({
          flowIntent: 'DEMO_REQUEST',
          stage: 'AWAITING_STUDENT_CLASS',
          pendingField,
          collected: {},
          status: 'awaiting_user',
        }),
      };
    case 'SCHOLARSHIP_ENQUIRY':
      if (!pendingField) {
        return createConfiguredHandoffPlan({
          reason: 'SCHOLARSHIP_ENQUIRY_DIRECT_HANDOFF',
          fallbackMessage: `Thank you. ${institutionPhrase} will guide you on scholarship options shortly.`,
          replyConfig,
          flowIntent: 'SCHOLARSHIP_ENQUIRY',
          conversationMode: 'initial',
        });
      }
      return {
        reason: 'SCHOLARSHIP_ENQUIRY',
        message: `Certainly. Please share the student's recent marks or percentage so that ${institutionPhrase} can guide you on scholarship options.${languageSupportSuffix}`,
        conversationMode: 'initial',
        conversationState: createConversationState({
          flowIntent: 'SCHOLARSHIP_ENQUIRY',
          stage: 'AWAITING_RECENT_MARKS',
          pendingField,
          collected: {},
          status: 'awaiting_user',
        }),
      };
    case 'FEE_ENQUIRY':
      if (!pendingField) {
        return createConfiguredHandoffPlan({
          reason: 'FEE_ENQUIRY_DIRECT_HANDOFF',
          fallbackMessage: `Thank you. ${institutionPhrase} will share the fee details and batch timings shortly on WhatsApp.`,
          replyConfig,
          flowIntent: 'FEE_ENQUIRY',
          conversationMode: 'initial',
        });
      }
      return {
        reason: 'FEE_ENQUIRY',
        message: `Certainly. Please share the student's class, and ${institutionPhrase} will help with the fee details and batch timings.${languageSupportSuffix}`,
        conversationMode: 'initial',
        conversationState: createConversationState({
          flowIntent: 'FEE_ENQUIRY',
          stage: 'AWAITING_STUDENT_CLASS',
          pendingField,
          collected: {},
          status: 'awaiting_user',
        }),
      };
    case 'ADMISSION':
      if (!pendingField) {
        return createConfiguredHandoffPlan({
          reason: 'ADMISSION_DIRECT_HANDOFF',
          fallbackMessage: `Thank you for your interest. ${institutionPhrase} will guide you on admission details shortly.`,
          replyConfig,
          flowIntent: 'ADMISSION',
          conversationMode: 'initial',
        });
      }
      return {
        reason: 'ADMISSION',
        message: `Thank you for your interest. Admissions are open for our JEE batches. Please share the student's class so that ${institutionPhrase} can guide you properly.${languageSupportSuffix}`,
        conversationMode: 'initial',
        conversationState: createConversationState({
          flowIntent: 'ADMISSION',
          stage: 'AWAITING_STUDENT_CLASS',
          pendingField,
          collected: {},
          status: 'awaiting_user',
        }),
      };
    case 'CALLBACK_REQUEST':
      if (!pendingField) {
        return createConfiguredHandoffPlan({
          reason: 'CALLBACK_REQUEST_DIRECT_HANDOFF',
          fallbackMessage: `Thank you. ${institutionPhrase} will call you shortly and assist you with the enquiry.`,
          replyConfig,
          flowIntent: 'CALLBACK_REQUEST',
          conversationMode: 'initial',
        });
      }
      return {
        reason: 'CALLBACK_REQUEST',
        message: requiredFields.includes('studentClass') && requiredFields.includes('preferredCallTime')
          ? `Certainly. Please share the student's class and your preferred call time, and ${institutionPhrase} will call you accordingly.${languageSupportSuffix}`
          : requiredFields.includes('preferredCallTime')
            ? `Certainly. Please share your preferred call time, and ${institutionPhrase} will call you accordingly.${languageSupportSuffix}`
            : `Certainly. Please share the student's class so that ${institutionPhrase} can call you accordingly.${languageSupportSuffix}`,
        conversationMode: 'initial',
        conversationState: createConversationState({
          flowIntent: 'CALLBACK_REQUEST',
          stage: 'AWAITING_CALLBACK_DETAILS',
          pendingField,
          collected: {},
          status: 'awaiting_user',
        }),
      };
    case 'GENERAL_ENQUIRY':
      if (!pendingField) {
        return createConfiguredHandoffPlan({
          reason: 'GENERAL_ENQUIRY_DIRECT_HANDOFF',
          fallbackMessage: `Thank you. ${institutionPhrase} will guide you shortly on WhatsApp.`,
          replyConfig,
          flowIntent: 'GENERAL_ENQUIRY',
          conversationMode: 'initial',
        });
      }
      return {
        reason: 'GENERAL_ENQUIRY',
        message: requiredFields.includes('studentClass') && requiredFields.includes('topic')
          ? `Certainly. Please share the student's class, and let us know if you need ${getGeneralOfferingsPrompt(replyConfig)}.${languageSupportSuffix}`
          : requiredFields.includes('studentClass')
            ? `Certainly. Please share the student's class, and ${institutionPhrase} will guide you further.${languageSupportSuffix}`
            : `Certainly. Please let us know if you need ${getGeneralOfferingsPrompt(replyConfig)}, and ${institutionPhrase} will guide you further.${languageSupportSuffix}`,
        conversationMode: 'initial',
        conversationState: createConversationState({
          flowIntent: 'GENERAL_ENQUIRY',
          stage: 'AWAITING_GENERAL_ENQUIRY_DETAILS',
          pendingField,
          collected: {},
          status: 'awaiting_user',
        }),
      };
    default:
      if (priorityScore >= HIGH_PRIORITY_THRESHOLD) {
        return createConfiguredHandoffPlan({
          reason: 'GENERIC_HIGH_PRIORITY',
          templateKey: 'genericHighPriority',
          fallbackMessage: 'Thank you for your enquiry. Our counsellor will contact you shortly.',
          replyConfig,
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
  agentConfig = null,
} = {}) {
  const replyConfig = resolveWhatsAppReplyConfig({ businessIndustry, agentConfig });

  if (businessIndustry !== 'academy') {
    if (priorityScore >= HIGH_PRIORITY_THRESHOLD) {
      return createConfiguredHandoffPlan({
        reason: 'GENERIC_HIGH_PRIORITY',
        templateKey: 'genericHighPriority',
        fallbackMessage: 'Thank you for your enquiry. Our team will contact you shortly.',
        replyConfig,
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
    replyConfig,
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

function extractPreferredCallTime(message = '') {
  const original = String(message || '').trim();
  const text = original.toLowerCase();
  if (!text) return null;

  const relativeTime = original.match(/\b(?:after|around|before)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i);
  if (relativeTime) return relativeTime[0];

  const explicitTime = original.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i);
  if (explicitTime) return explicitTime[0];

  const bajeMatch = original.match(/\b\d{1,2}(?::\d{2})?\s*baje\b/i);
  if (bajeMatch) return bajeMatch[0];

  const parts = [];
  if (/\b(today|aaj)\b/.test(text)) parts.push('today');
  if (/\b(tomorrow|kal)\b/.test(text)) parts.push('tomorrow');
  if (/\b(morning|subah)\b/.test(text)) parts.push('morning');
  if (/\b(afternoon|dopahar)\b/.test(text)) parts.push('afternoon');
  if (/\b(evening|shaam)\b/.test(text)) parts.push('evening');
  if (/\b(night|raat)\b/.test(text)) parts.push('night');

  return parts.length ? parts.join(' ') : null;
}

function extractAcademyEnquiryTopic(message = '') {
  const text = String(message || '').trim().toLowerCase();
  if (!text) return null;

  if (/\b(fees|fee|price|cost|kitni)\b/.test(text)) return 'FEE_ENQUIRY';
  if (/\b(demo|trial class|demo class)\b/.test(text)) return 'DEMO_REQUEST';
  if (/\b(admission|join|coaching|course|batch)\b/.test(text)) return 'ADMISSION';
  return null;
}

function buildAcademyContinuationPlan({
  conversationState,
  message,
  priorityScore = 0,
  replyConfig = {},
} = {}) {
  const flowIntent = conversationState?.flowIntent || null;
  const collected = { ...(conversationState?.collected || {}) };
  const institutionPhrase = getInstitutionPhrase(replyConfig);

  if (!conversationState || conversationState.status === 'handoff') {
    return createConfiguredHandoffPlan({
      reason: 'HANDOFF_IN_PROGRESS',
      templateKey: 'inProgress',
      fallbackMessage: 'Thank you. Our counsellor will continue with you on WhatsApp shortly.',
      replyConfig,
      flowIntent,
      collected,
    });
  }

  if (conversationState.status !== 'awaiting_user') {
    return createConfiguredHandoffPlan({
      reason: 'OFF_FLOW_HANDOFF',
      templateKey: 'offFlow',
      fallbackMessage: 'Thank you. Our counsellor will continue with you on WhatsApp shortly.',
      replyConfig,
      flowIntent,
      collected,
    });
  }

  if (conversationState.pendingField === 'student_class') {
    const studentClass = extractStudentClass(message);
    if (!studentClass) {
      return createConfiguredHandoffPlan({
        reason: 'OFF_FLOW_HANDOFF',
        templateKey: 'offFlow',
        fallbackMessage: 'Thank you. Our counsellor will continue with you on WhatsApp shortly.',
        replyConfig,
        flowIntent,
        collected,
      });
    }

    collected.studentClass = studentClass;

    switch (flowIntent) {
      case 'FEE_ENQUIRY':
        return {
          reason: 'FEE_ENQUIRY_HANDOFF',
          message: `Thank you. For ${studentClass}, ${institutionPhrase} will share the fee details and batch timings shortly on WhatsApp.`,
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
          message: `Thank you. For ${studentClass}, ${institutionPhrase} will help you with the next available demo class slot shortly.`,
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
          message: `Thank you. For ${studentClass}, ${institutionPhrase} will guide you on the suitable JEE batch and connect with you shortly.`,
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
      return createConfiguredHandoffPlan({
        reason: 'OFF_FLOW_HANDOFF',
        templateKey: 'offFlow',
        fallbackMessage: 'Thank you. Our counsellor will continue with you on WhatsApp shortly.',
        replyConfig,
        flowIntent,
        collected,
      });
    }

    collected.recentMarks = marks;
    const studentClass = extractStudentClass(message);
    if (studentClass) collected.studentClass = studentClass;

    return {
      reason: 'SCHOLARSHIP_ENQUIRY_HANDOFF',
      message: `Thank you. We have noted ${marks}. ${institutionPhrase} will review the scholarship options and guide you shortly on WhatsApp.`,
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

  if (conversationState.pendingField === 'callback_details') {
    const studentClass = extractStudentClass(message);
    const preferredCallTime = extractPreferredCallTime(message);

    if (!studentClass && !preferredCallTime) {
      return createConfiguredHandoffPlan({
        reason: 'OFF_FLOW_HANDOFF',
        templateKey: 'offFlow',
        fallbackMessage: 'Thank you. Our counsellor will continue with you on WhatsApp shortly.',
        replyConfig,
        flowIntent,
        collected,
      });
    }

    if (studentClass) collected.studentClass = studentClass;
    if (preferredCallTime) collected.preferredCallTime = preferredCallTime;

    const classText = studentClass ? ` regarding ${studentClass}` : '';
    const callTimeText = preferredCallTime
      ? ` ${preferredCallTime}`
      : ' shortly';

    return {
      reason: 'CALLBACK_REQUEST_HANDOFF',
      message: `Thank you. ${institutionPhrase} will call you${callTimeText}${classText} and assist you with the coaching details.`.replace(/\s+/g, ' ').trim(),
      conversationMode: 'continuation',
      conversationState: createConversationState({
        flowIntent: 'CALLBACK_REQUEST',
        stage: 'HANDOFF_QUEUED',
        pendingField: null,
        collected,
        status: 'handoff',
      }),
    };
  }

  if (conversationState.pendingField === 'general_enquiry_details') {
    const studentClass = extractStudentClass(message);
    const topic = extractAcademyEnquiryTopic(message);

    if (!studentClass && !topic) {
      return createConfiguredHandoffPlan({
        reason: 'OFF_FLOW_HANDOFF',
        templateKey: 'offFlow',
        fallbackMessage: 'Thank you. Our counsellor will continue with you on WhatsApp shortly.',
        replyConfig,
        flowIntent,
        collected,
      });
    }

    if (studentClass) collected.studentClass = studentClass;
    if (topic) collected.topic = topic;

    const resolvedIntent = topic || 'GENERAL_ENQUIRY';
    const topicLabelMap = {
      FEE_ENQUIRY: 'fee details',
      DEMO_REQUEST: 'demo class details',
      ADMISSION: 'admission details',
      GENERAL_ENQUIRY: 'coaching details',
    };
    const topicLabel = topicLabelMap[resolvedIntent] || 'coaching details';
    const classText = studentClass ? ` for ${studentClass}` : '';

    return {
      reason: 'GENERAL_ENQUIRY_HANDOFF',
      message: `Thank you. ${institutionPhrase} will guide you on ${topicLabel}${classText} shortly on WhatsApp.`.replace(/\s+/g, ' ').trim(),
      conversationMode: 'continuation',
      conversationState: createConversationState({
        flowIntent: resolvedIntent,
        stage: 'HANDOFF_QUEUED',
        pendingField: null,
        collected,
        status: 'handoff',
      }),
    };
  }

  if (priorityScore >= HIGH_PRIORITY_THRESHOLD) {
    return createConfiguredHandoffPlan({
      reason: 'GENERIC_HIGH_PRIORITY_HANDOFF',
      templateKey: 'genericHighPriority',
      fallbackMessage: 'Thank you for your enquiry. Our counsellor will contact you shortly.',
      replyConfig,
      flowIntent,
      collected,
    });
  }

  return createConfiguredHandoffPlan({
    reason: 'OFF_FLOW_HANDOFF',
    templateKey: 'offFlow',
    fallbackMessage: 'Thank you. Our counsellor will continue with you on WhatsApp shortly.',
    replyConfig,
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

  const agentConfig = await getOrCreateAgentConfig(lead.business.id);
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
    replyConfig: resolveWhatsAppReplyConfig({
      businessIndustry: lead.business.industry || 'other',
      agentConfig,
    }),
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
  businessId = null,
  tags = [],
  intent = null,
  priorityScore = 0,
  businessIndustry = 'other',
  source = 'web',
  phone = null,
  confidenceLabel = 'high',
  leadDisposition = 'valid',
  agentConfig = null,
} = {}) {
  const creates = [];
  const resolvedAgentConfig = agentConfig || (businessId ? await getOrCreateAgentConfig(businessId) : null);
  const replyPlan = buildWhatsAppReplyPlan({
    businessIndustry,
    intent,
    tags,
    priorityScore,
    confidenceLabel,
    leadDisposition,
    agentConfig: resolvedAgentConfig,
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
