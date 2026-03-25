'use strict';

const { prisma } = require('../lib/prisma');
const { LEGACY_SAFE_LEAD_SELECT } = require('../lib/leadCompat');
const { logger } = require('../lib/logger');
const { getOrCreate: getOrCreateAgentConfig } = require('./agentConfig.service');
const {
  normalizeWhatsAppSendError,
  prepareWhatsAppTextMessage,
  sendWhatsAppMessage,
} = require('./whatsapp.service');
const { retrieveBusinessKnowledge } = require('./businessKnowledge.service');
const { generateGroundedWhatsAppReply } = require('./groundedReply.service');
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
const STRUCTURED_ACADEMY_REPLY_REASONS = new Set([
  'ADMISSION',
  'DEMO_REQUEST',
  'FEE_ENQUIRY',
  'CALLBACK_REQUEST',
  'SCHOLARSHIP_ENQUIRY',
  'GENERAL_ENQUIRY',
]);
const DIRECT_BUSINESS_IDENTITY_PATTERN = /\b(is this|is it|are you|what is this(?: business)?|who are you|which business|which institute|what do you do)\b/;
const DIRECT_BUSINESS_OFFERING_PATTERN = /\b(do you provide|do you offer|do you have|is this for|is it for|do you conduct)\b/;
const CLASS_CLARIFICATION_PATTERN = /\b(?:class|std|standard|grade)\s*(9|10|11|12)\b|\b(9th|10th|11th|12th|ix|x|xi|xii)\b/;
const INDUSTRY_ALIASES = {
  academy: ['academy', 'coaching institute', 'coaching', 'institute', 'jee coaching', 'tuition'],
  gym: ['gym', 'fitness centre', 'fitness center', 'fitness'],
  salon: ['salon', 'beauty parlour', 'beauty salon', 'parlour'],
  clinic: ['clinic', 'medical clinic', 'doctor clinic'],
  restaurant: ['restaurant', 'cafe', 'food outlet'],
  retail: ['shop', 'store', 'retail shop'],
};
const INDUSTRY_LABELS = {
  academy: 'coaching institute',
  gym: 'gym',
  salon: 'salon',
  clinic: 'clinic',
  restaurant: 'restaurant',
  retail: 'store',
};

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

function normalizeComparableText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/classes/g, 'class')
    .replace(/programmes/g, 'programme')
    .replace(/services/g, 'service')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function getBusinessIntro(businessName = null) {
  return businessName ? `This is ${businessName}.` : 'This is our business.';
}

function getBusinessIntroWithAnswer(prefix = 'Yes', businessName = null) {
  if (businessName) {
    return `${prefix}, this is ${businessName}.`;
  }

  return `${prefix}, this is our business.`;
}

function getBusinessOfferingSentence({ businessIndustry = 'other', replyConfig = {} } = {}) {
  if (businessIndustry === 'academy') {
    return `We provide ${replyConfig?.primaryOffering || 'coaching services'}.`;
  }

  const industryLabel = INDUSTRY_LABELS[businessIndustry];
  if (industryLabel) {
    return `We are a ${industryLabel}.`;
  }

  return `We provide ${replyConfig?.primaryOffering || 'our services'}.`;
}

function findMentionedIndustry(message = '') {
  const normalizedMessage = normalizeComparableText(message);

  for (const [industry, aliases] of Object.entries(INDUSTRY_ALIASES)) {
    const matchedAlias = aliases.find((alias) => normalizedMessage.includes(normalizeComparableText(alias)));
    if (matchedAlias) {
      return { industry, label: matchedAlias };
    }
  }

  return null;
}

function getOfferCatalog(replyConfig = {}, { businessIndustry = 'other' } = {}) {
  const catalog = [];

  if (replyConfig?.primaryOffering) catalog.push(replyConfig.primaryOffering);
  if (Array.isArray(replyConfig?.supportedOfferings)) {
    catalog.push(...replyConfig.supportedOfferings);
  }
  if (businessIndustry === 'academy') {
    catalog.push('JEE coaching');
  }

  return [...new Set(catalog.filter(Boolean).map((value) => String(value).trim()))];
}

function findMatchingOffering(message = '', { replyConfig = {}, businessIndustry = 'other' } = {}) {
  const normalizedMessage = normalizeComparableText(message);

  for (const offer of getOfferCatalog(replyConfig, { businessIndustry })) {
    const normalizedOffer = normalizeComparableText(offer);
    if (!normalizedOffer) continue;
    if (normalizedMessage.includes(normalizedOffer)) return offer;

    const offerTokens = normalizedOffer.split(' ').filter((token) => token.length > 2);
    const matchedTokens = offerTokens.filter((token) => normalizedMessage.includes(token));
    if (matchedTokens.length >= Math.min(2, offerTokens.length)) {
      return offer;
    }
  }

  return null;
}

function formatOfferingForReply(offer = '') {
  const normalized = normalizeComparableText(offer);
  if (normalized === 'demo class') return 'demo classes';
  return String(offer || '').trim();
}

function buildDirectClarificationFollowUp({ replyConfig = {}, businessIndustry = 'other', asksClassSupport = false } = {}) {
  if (asksClassSupport && businessIndustry === 'academy') {
    return 'If you are asking about Class 11 or Class 12 guidance, I can help with the right batch details.';
  }

  const offeringsPrompt = getGeneralOfferingsPrompt(replyConfig);
  return offeringsPrompt ? `If you need help with ${offeringsPrompt}, I can help.` : '';
}

function buildDirectBusinessClarificationPlan({
  businessName = null,
  businessIndustry = 'other',
  message = '',
  replyConfig = {},
  flowIntent = null,
  collected = {},
  conversationMode = 'initial',
  existingConversationState = null,
} = {}) {
  const normalizedMessage = normalizeComparableText(message);
  if (!normalizedMessage) return null;

  const asksIdentity = DIRECT_BUSINESS_IDENTITY_PATTERN.test(normalizedMessage);
  const asksOffering = DIRECT_BUSINESS_OFFERING_PATTERN.test(normalizedMessage);
  if (!asksIdentity && !asksOffering) return null;

  const mentionedIndustry = findMentionedIndustry(message);
  const matchedOffering = findMatchingOffering(message, { replyConfig, businessIndustry });
  const asksClassSupport = asksOffering && CLASS_CLARIFICATION_PATTERN.test(normalizedMessage);
  const replyParts = [];

  if (mentionedIndustry) {
    if (mentionedIndustry.industry === businessIndustry) {
      replyParts.push(getBusinessIntroWithAnswer('Yes', businessName));
      replyParts.push(getBusinessOfferingSentence({ businessIndustry, replyConfig }));
    } else {
      replyParts.push(getBusinessIntroWithAnswer('No', businessName));
      replyParts.push(getBusinessOfferingSentence({ businessIndustry, replyConfig }));
      replyParts.push(`We do not provide ${mentionedIndustry.label} services.`);
    }
  } else if (matchedOffering) {
    replyParts.push(getBusinessIntroWithAnswer('Yes', businessName));
    if (normalizeComparableText(matchedOffering) === normalizeComparableText(replyConfig?.primaryOffering || '')) {
      replyParts.push(getBusinessOfferingSentence({ businessIndustry, replyConfig }));
    } else {
      replyParts.push(`We do offer ${formatOfferingForReply(matchedOffering)}.`);
    }
  } else {
    replyParts.push(getBusinessIntro(businessName));
    replyParts.push(getBusinessOfferingSentence({ businessIndustry, replyConfig }));
  }

  const followUp = buildDirectClarificationFollowUp({
    replyConfig,
    businessIndustry,
    asksClassSupport,
  });
  if (followUp) replyParts.push(followUp);

  return {
    reason: 'DIRECT_BUSINESS_CLARIFICATION',
    message: replyParts.join(' ').replace(/\s+/g, ' ').trim(),
    conversationMode,
    conversationState: existingConversationState
      ? {
          ...existingConversationState,
          collected: {
            ...(existingConversationState.collected || {}),
            ...collected,
          },
        }
      : buildKnowledgeFollowUpState({
          flowIntent: flowIntent || 'GENERAL_ENQUIRY',
          collected,
        }),
  };
}

function getGeneralOfferingsPrompt(replyConfig = {}) {
  const offerings = Array.isArray(replyConfig?.supportedOfferings) ? replyConfig.supportedOfferings : [];
  return offerings.length ? formatList(offerings.slice(0, 3)) : 'fee details, a demo class, or admission guidance';
}

function getCourseInterestPrompt(replyConfig = {}) {
  const offerings = Array.isArray(replyConfig?.supportedOfferings) ? replyConfig.supportedOfferings : [];
  if (!offerings.length) return 'the course or programme you need';
  return `the course or programme you need, such as ${formatList(offerings.slice(0, 3))}`;
}

function getPendingFieldForIntent(intent, requiredFields = []) {
  const normalizedIntent = String(intent || '').trim().toUpperCase();
  const fieldSet = new Set(requiredFields);

  if (!fieldSet.size) return null;
  if (normalizedIntent === 'SCHOLARSHIP_ENQUIRY' || fieldSet.has('recentMarks')) return 'recent_marks';
  if (normalizedIntent === 'CALLBACK_REQUEST' || fieldSet.has('preferredCallTime')) return 'callback_details';
  if (normalizedIntent === 'GENERAL_ENQUIRY' || fieldSet.has('topic')) return 'general_enquiry_details';
  if (fieldSet.has('courseInterest')) return 'course_interest';
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

function buildKnowledgeFollowUpState({ flowIntent, collected = {} } = {}) {
  return createConversationState({
    flowIntent,
    stage: 'KNOWLEDGE_SHARED',
    pendingField: 'knowledge_follow_up',
    collected,
    status: 'awaiting_user',
  });
}

function isLikelyFactualAcademyQuestion({ message = '', structuredReason = null } = {}) {
  const text = String(message || '').trim().toLowerCase();
  if (!text) return false;

  const hasWorkflowTerms = /\b(urgent|immediately|asap|join|joining|admission|enroll|enrol|demo|trial|call|callback|phone call)\b/.test(text);
  if (hasWorkflowTerms) return false;

  switch (structuredReason) {
    case 'FEE_ENQUIRY':
      return /\b(fee|fees|price|cost|charges|kitni|fee structure)\b/.test(text);
    case 'SCHOLARSHIP_ENQUIRY':
      return /\b(scholarship|discount|concession|offer|merit)\b/.test(text);
    case 'GENERAL_ENQUIRY':
      return /\b(branch|location|address|where|online|language|hindi|english|course|courses|program|programme|syllabus|timing|timings|schedule|visa|band score|mock test)\b/.test(text);
    default:
      return false;
  }
}

function selectPreferredAcademyReplyPlan({
  businessIndustry = 'other',
  message = '',
  structuredReplyPlan = null,
  groundedReplyPlan = null,
} = {}) {
  if (businessIndustry !== 'academy') {
    return groundedReplyPlan || structuredReplyPlan;
  }

  if (!groundedReplyPlan) {
    return structuredReplyPlan;
  }

  const structuredReason = structuredReplyPlan?.reason || null;
  if (!structuredReason || !STRUCTURED_ACADEMY_REPLY_REASONS.has(structuredReason)) {
    return groundedReplyPlan || structuredReplyPlan;
  }

  if (groundedReplyPlan.reason === 'BUSINESS_KNOWLEDGE_ANSWER') {
    return isLikelyFactualAcademyQuestion({ message, structuredReason })
      ? groundedReplyPlan
      : structuredReplyPlan;
  }

  if (groundedReplyPlan.reason === 'BUSINESS_KNOWLEDGE_UNCERTAIN') {
    return structuredReplyPlan;
  }

  return groundedReplyPlan || structuredReplyPlan;
}

function shouldSkipKnowledgeForStructuredContinuation(conversationState = null) {
  return Boolean(
    conversationState
    && conversationState.status === 'awaiting_user'
    && conversationState.pendingField
    && conversationState.pendingField !== 'knowledge_follow_up'
  );
}

async function maybeBuildGroundedKnowledgeReplyPlan({
  businessName = null,
  businessIndustry = 'other',
  message = '',
  intent = null,
  tags = [],
  agentConfig = null,
  conversationState = null,
  conversationMode = 'initial',
} = {}) {
  const replyConfig = resolveWhatsAppReplyConfig({ businessIndustry, agentConfig });
  const retrieval = retrieveBusinessKnowledge({
    message,
    intent,
    tags,
    businessIndustry,
    agentConfig,
  });

  if (!retrieval.shouldAttempt) {
    return null;
  }

  if (!retrieval.hasConfidentMatch) {
    return {
      ...createConfiguredHandoffPlan({
        reason: 'BUSINESS_KNOWLEDGE_UNCERTAIN',
        templateKey: 'lowConfidence',
        fallbackMessage: 'Thank you. Our counsellor will guide you on this shortly on WhatsApp.',
        replyConfig,
        flowIntent: conversationState?.flowIntent || intent,
        collected: conversationState?.collected || {},
        conversationMode,
      }),
      groundedAnswer: false,
      knowledgeRetrieval: {
        matched: false,
        matchCount: retrieval.matches.length,
        sourceIds: [],
        sourceTitles: [],
      },
    };
  }

  const groundedReply = await generateGroundedWhatsAppReply({
    businessName,
    businessIndustry,
    institutionLabel: getInstitutionLabel(replyConfig),
    message,
    matches: retrieval.matches,
  });

  if (!groundedReply.grounded || groundedReply.confidence < 0.65 || !groundedReply.reply) {
    return {
      ...createConfiguredHandoffPlan({
        reason: 'BUSINESS_KNOWLEDGE_UNCERTAIN',
        templateKey: 'lowConfidence',
        fallbackMessage: 'Thank you. Our counsellor will guide you on this shortly on WhatsApp.',
        replyConfig,
        flowIntent: conversationState?.flowIntent || intent,
        collected: conversationState?.collected || {},
        conversationMode,
      }),
      groundedAnswer: false,
      knowledgeRetrieval: {
        matched: true,
        matchCount: retrieval.matches.length,
        sourceIds: retrieval.matches.map((match) => match.id),
        sourceTitles: retrieval.matches.map((match) => match.title),
        confidence: groundedReply.confidence,
        reason: groundedReply.reason,
      },
    };
  }

  const resolvedIntent = retrieval.topMatch?.intents?.[0] || intent || conversationState?.flowIntent || 'GENERAL_ENQUIRY';
  const collected = {
    ...(conversationState?.collected || {}),
    topic: resolvedIntent,
  };

  return {
    reason: 'BUSINESS_KNOWLEDGE_ANSWER',
    message: groundedReply.reply,
    conversationMode,
    conversationState: buildKnowledgeFollowUpState({
      flowIntent: resolvedIntent,
      collected,
    }),
    groundedAnswer: true,
    knowledgeRetrieval: {
      matched: true,
      matchCount: retrieval.matches.length,
      topScore: retrieval.topMatch?.score || 0,
      sourceIds: groundedReply.usedEntryIds.length
        ? groundedReply.usedEntryIds
        : retrieval.matches.map((match) => match.id),
      sourceTitles: retrieval.matches
        .filter((match) => groundedReply.usedEntryIds.length === 0 || groundedReply.usedEntryIds.includes(match.id))
        .map((match) => match.title),
      snippets: retrieval.matches
        .filter((match) => groundedReply.usedEntryIds.length === 0 || groundedReply.usedEntryIds.includes(match.id))
        .map((match) => ({
          id: match.id,
          title: match.title,
          content: match.content,
        })),
      confidence: groundedReply.confidence,
      provider: groundedReply.provider,
      model: groundedReply.model,
      rawOutput: groundedReply.rawOutput,
      reason: groundedReply.reason,
    },
  };
}

function buildAcademyFirstReplyPlan({
  businessName = null,
  businessIndustry = 'academy',
  message = '',
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
  const directClarificationPlan = buildDirectBusinessClarificationPlan({
    businessName,
    businessIndustry,
    message,
    replyConfig,
    flowIntent: replyIntent || intent,
    conversationMode: 'initial',
  });

  if (directClarificationPlan) {
    return directClarificationPlan;
  }

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
        message: pendingField === 'course_interest'
          ? `Certainly. Please share ${getCourseInterestPrompt(replyConfig)}, and ${institutionPhrase} will help you with the right demo or counselling slot.${languageSupportSuffix}`
          : `Certainly. Please share the student's class, and ${institutionPhrase} will help you with the right demo class.${languageSupportSuffix}`,
        conversationMode: 'initial',
        conversationState: createConversationState({
          flowIntent: 'DEMO_REQUEST',
          stage: pendingField === 'course_interest' ? 'AWAITING_COURSE_INTEREST' : 'AWAITING_STUDENT_CLASS',
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
        message: pendingField === 'course_interest'
          ? `Certainly. Please share ${getCourseInterestPrompt(replyConfig)} so that ${institutionPhrase} can guide you on current discount or offer options.${languageSupportSuffix}`
          : `Certainly. Please share the student's recent marks or percentage so that ${institutionPhrase} can guide you on scholarship options.${languageSupportSuffix}`,
        conversationMode: 'initial',
        conversationState: createConversationState({
          flowIntent: 'SCHOLARSHIP_ENQUIRY',
          stage: pendingField === 'course_interest' ? 'AWAITING_COURSE_INTEREST' : 'AWAITING_RECENT_MARKS',
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
        message: pendingField === 'course_interest'
          ? `Certainly. Please share ${getCourseInterestPrompt(replyConfig)}, and ${institutionPhrase} will help with the fee details and batch timings.${languageSupportSuffix}`
          : `Certainly. Please share the student's class, and ${institutionPhrase} will help with the fee details and batch timings.${languageSupportSuffix}`,
        conversationMode: 'initial',
        conversationState: createConversationState({
          flowIntent: 'FEE_ENQUIRY',
          stage: pendingField === 'course_interest' ? 'AWAITING_COURSE_INTEREST' : 'AWAITING_STUDENT_CLASS',
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
        message: pendingField === 'course_interest'
          ? `Thank you for your interest. Admissions are open for our ${replyConfig?.primaryOffering || 'programmes'}. Please share ${getCourseInterestPrompt(replyConfig)} so that ${institutionPhrase} can guide you properly.${languageSupportSuffix}`
          : `Thank you for your interest. Admissions are open for our ${replyConfig?.primaryOffering || 'programmes'}. Please share the student's class so that ${institutionPhrase} can guide you properly.${languageSupportSuffix}`,
        conversationMode: 'initial',
        conversationState: createConversationState({
          flowIntent: 'ADMISSION',
          stage: pendingField === 'course_interest' ? 'AWAITING_COURSE_INTEREST' : 'AWAITING_STUDENT_CLASS',
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
          : requiredFields.includes('courseInterest') && requiredFields.includes('preferredCallTime')
            ? `Certainly. Please share your preferred call time and ${getCourseInterestPrompt(replyConfig)}, and ${institutionPhrase} will call you accordingly.${languageSupportSuffix}`
          : requiredFields.includes('preferredCallTime')
            ? `Certainly. Please share your preferred call time, and ${institutionPhrase} will call you accordingly.${languageSupportSuffix}`
            : requiredFields.includes('courseInterest')
              ? `Certainly. Please share ${getCourseInterestPrompt(replyConfig)}, and ${institutionPhrase} will call you accordingly.${languageSupportSuffix}`
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
  businessName = null,
  businessIndustry = 'other',
  message = '',
  intent = null,
  tags = [],
  priorityScore = 0,
  confidenceLabel = 'high',
  leadDisposition = 'valid',
  agentConfig = null,
} = {}) {
  const replyConfig = resolveWhatsAppReplyConfig({ businessIndustry, agentConfig });
  const directClarificationPlan = buildDirectBusinessClarificationPlan({
    businessName,
    businessIndustry,
    message,
    replyConfig,
    flowIntent: intent,
    conversationMode: 'initial',
  });

  if (directClarificationPlan) {
    return directClarificationPlan;
  }

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
    businessName,
    businessIndustry,
    message,
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

function extractCourseInterest(message = '') {
  const text = String(message || '').trim().toLowerCase();
  if (!text) return null;

  if (/\bielts\s+academic\b/.test(text)) return 'IELTS Academic';
  if (/\bielts\s+general\b|\bgeneral training\b/.test(text)) return 'IELTS General Training';
  if (/\bspoken english\b|\benglish speaking\b|\bspoken-english\b|\bfluency\b/.test(text)) return 'spoken English';
  if (/\bpte\b/.test(text)) return 'PTE';
  if (/\bielts\b/.test(text)) return 'IELTS';
  if (/\binterview\b|\bcommunication\b/.test(text)) return 'communication support';

  return null;
}

function buildAcademyContinuationPlan({
  businessName = null,
  businessIndustry = 'academy',
  conversationState,
  message,
  priorityScore = 0,
  replyConfig = {},
} = {}) {
  const flowIntent = conversationState?.flowIntent || null;
  const collected = { ...(conversationState?.collected || {}) };
  const institutionPhrase = getInstitutionPhrase(replyConfig);
  const requiredFields = getRequiredCollectedFields(replyConfig, flowIntent);
  const directClarificationPlan = buildDirectBusinessClarificationPlan({
    businessName,
    businessIndustry,
    message,
    replyConfig,
    flowIntent,
    collected,
    conversationMode: 'continuation',
    existingConversationState: conversationState,
  });

  if (directClarificationPlan) {
    return directClarificationPlan;
  }

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

  if (conversationState.pendingField === 'knowledge_follow_up') {
    return createConfiguredHandoffPlan({
      reason: 'HANDOFF_IN_PROGRESS',
      templateKey: 'inProgress',
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
          message: `Thank you. For ${studentClass}, ${institutionPhrase} will guide you on the suitable batch and connect with you shortly.`,
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

  if (conversationState.pendingField === 'course_interest') {
    const courseInterest = extractCourseInterest(message);
    if (!courseInterest) {
      return createConfiguredHandoffPlan({
        reason: 'OFF_FLOW_HANDOFF',
        templateKey: 'offFlow',
        fallbackMessage: 'Thank you. Our counsellor will continue with you on WhatsApp shortly.',
        replyConfig,
        flowIntent,
        collected,
      });
    }

    collected.courseInterest = courseInterest;

    switch (flowIntent) {
      case 'FEE_ENQUIRY':
        return {
          reason: 'FEE_ENQUIRY_HANDOFF',
          message: `Thank you. For ${courseInterest}, ${institutionPhrase} will share the fee details and batch timings shortly on WhatsApp.`,
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
          message: `Thank you. For ${courseInterest}, ${institutionPhrase} will help you with the next available demo or counselling slot shortly.`,
          conversationMode: 'continuation',
          conversationState: createConversationState({
            flowIntent,
            stage: 'HANDOFF_QUEUED',
            pendingField: null,
            collected,
            status: 'handoff',
          }),
        };
      case 'SCHOLARSHIP_ENQUIRY':
        return {
          reason: 'SCHOLARSHIP_ENQUIRY_HANDOFF',
          message: `Thank you. For ${courseInterest}, ${institutionPhrase} will review the current discount options and guide you shortly on WhatsApp.`,
          conversationMode: 'continuation',
          conversationState: createConversationState({
            flowIntent: flowIntent || 'SCHOLARSHIP_ENQUIRY',
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
          message: `Thank you. For ${courseInterest}, ${institutionPhrase} will guide you on the suitable batch and connect with you shortly.`,
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
    const courseInterest = requiredFields.includes('courseInterest') ? extractCourseInterest(message) : null;

    if (!studentClass && !preferredCallTime && !courseInterest) {
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
    if (courseInterest) collected.courseInterest = courseInterest;

    const classText = studentClass ? ` regarding ${studentClass}` : '';
    const courseText = courseInterest
      ? `${classText ? ' and' : ' regarding'} ${courseInterest}`
      : '';
    const callTimeText = preferredCallTime
      ? ` ${preferredCallTime}`
      : ' shortly';

    return {
      reason: 'CALLBACK_REQUEST_HANDOFF',
      message: `Thank you. ${institutionPhrase} will call you${callTimeText}${classText}${courseText} and assist you with the enquiry details.`.replace(/\s+/g, ' ').trim(),
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
    const courseInterest = requiredFields.includes('courseInterest') ? extractCourseInterest(message) : null;

    if (!studentClass && !topic && !courseInterest) {
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
    if (courseInterest) collected.courseInterest = courseInterest;

    const resolvedIntent = topic || 'GENERAL_ENQUIRY';
    const topicLabelMap = {
      FEE_ENQUIRY: 'fee details',
      DEMO_REQUEST: 'demo class details',
      ADMISSION: 'admission details',
      GENERAL_ENQUIRY: 'coaching details',
    };
    const topicLabel = topicLabelMap[resolvedIntent] || 'coaching details';
    const classText = studentClass ? ` for ${studentClass}` : '';
    const courseText = courseInterest ? ` for ${courseInterest}` : '';

    return {
      reason: 'GENERAL_ENQUIRY_HANDOFF',
      message: `Thank you. ${institutionPhrase} will guide you on ${topicLabel}${courseText}${classText} shortly on WhatsApp.`.replace(/\s+/g, ' ').trim(),
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

function buildFailedConversationState(replyPlan, failure) {
  const baseState = replyPlan?.conversationState || createConversationState({
    flowIntent: null,
    stage: 'HANDOFF_QUEUED',
    pendingField: null,
    collected: {},
    status: 'handoff',
  });

  return {
    ...baseState,
    stage: 'REPLY_FAILED',
    status: 'send_failed',
    lastFailure: {
      category: failure.category,
      title: failure.title,
      detail: failure.detail,
    },
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
  groundedAnswer = false,
  knowledgeRetrieval = null,
  conversationMode = 'continuation',
  conversationState = null,
  timestamp = null,
  deliveryStatus = 'sent',
  failureCategory = null,
  failureTitle = null,
  failureDetail = null,
  healthSeverity = null,
  operatorActionRequired = null,
  providerStatus = null,
  providerCode = null,
  providerSubcode = null,
  providerType = null,
  providerMessage = null,
  activityMessage = null,
} = {}) {
  const createdAt = timestamp ? new Date(timestamp) : undefined;
  const metadata = {
    reason,
    source: 'whatsapp',
    channel: 'whatsapp',
    direction,
    ...(direction === 'outbound' ? { deliveryStatus } : {}),
    ...(phone ? { phone } : {}),
    ...(messageText ? { messageText } : {}),
    ...(messageId ? { messageId } : {}),
    ...(providerMessageId ? { providerMessageId } : {}),
    ...(replyIntent ? { replyIntent } : {}),
    ...(direction === 'outbound' ? { replyMessage: messageText } : {}),
    ...(direction === 'outbound' ? { groundedAnswer } : {}),
    ...(direction === 'outbound' && knowledgeRetrieval ? { knowledgeRetrieval } : {}),
    ...(failureCategory ? { failureCategory } : {}),
    ...(failureTitle ? { failureTitle } : {}),
    ...(failureDetail ? { failureDetail } : {}),
    ...(healthSeverity ? { healthSeverity } : {}),
    ...(operatorActionRequired ? { operatorActionRequired } : {}),
    ...(providerStatus != null ? { providerStatus } : {}),
    ...(providerCode != null ? { providerCode } : {}),
    ...(providerSubcode != null ? { providerSubcode } : {}),
    ...(providerType ? { providerType } : {}),
    ...(providerMessage ? { providerMessage } : {}),
    ...(conversationMode ? { conversationMode } : {}),
    ...(conversationState ? { conversationState } : {}),
    ...(createdAt ? { timestamp: createdAt.toISOString() } : {}),
  };

  const resolvedMessage = activityMessage || (
    direction === 'inbound'
      ? 'WhatsApp inbound message received'
      : deliveryStatus === 'failed'
        ? `WhatsApp reply failed${failureTitle ? `: ${failureTitle}` : ''}`
        : 'Automation: WhatsApp reply sent'
  );

  return prisma.leadActivity.create({
    data: {
      leadId,
      type: 'AUTOMATION_ALERT',
      message: resolvedMessage,
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
  const preparedMessage = prepareWhatsAppTextMessage(replyPlan.message);

  try {
    const replyResult = await sendWhatsAppMessage(phone, preparedMessage);
    const providerMessageId = replyResult?.messages?.[0]?.id || null;
    const sentAt = new Date().toISOString();

    logger.info(
      {
        leadId,
        phone,
        replyReason: replyPlan.reason,
        replyLength: preparedMessage.length,
        groundedAnswer: Boolean(replyPlan.groundedAnswer),
        knowledgeSourceIds: replyPlan.knowledgeRetrieval?.sourceIds || [],
        providerMessageId,
      },
      'WhatsApp automation reply sent'
    );

    await logWhatsAppActivity(leadId, {
      direction: 'outbound',
      phone,
      messageText: preparedMessage,
      providerMessageId,
      reason: 'WHATSAPP_AUTO_REPLY',
      replyIntent: replyPlan.reason,
      conversationMode: replyPlan.conversationMode || 'initial',
      conversationState: replyPlan.conversationState || null,
      groundedAnswer: Boolean(replyPlan.groundedAnswer),
      knowledgeRetrieval: replyPlan.knowledgeRetrieval || null,
      deliveryStatus: 'sent',
      timestamp: sentAt,
    });

    return {
      sent: true,
      providerMessageId,
      failure: null,
      conversationState: replyPlan.conversationState || null,
      timestamp: sentAt,
    };
  } catch (err) {
    const failure = normalizeWhatsAppSendError(err);
    const failedConversationState = buildFailedConversationState(replyPlan, failure);
    const failureAt = new Date().toISOString();

    logger.error(
      {
        err,
        leadId,
        phone,
        replyReason: replyPlan.reason,
        replyLength: preparedMessage.length,
        groundedAnswer: Boolean(replyPlan.groundedAnswer),
        failureCategory: failure.category,
        failureTitle: failure.title,
        healthSeverity: failure.healthSeverity,
        providerStatus: failure.status,
        providerCode: failure.providerCode,
        providerSubcode: failure.providerSubcode,
        providerType: failure.providerType,
        retryable: failure.retryable,
      },
      'WhatsApp automation reply failed'
    );

    await logWhatsAppActivity(leadId, {
      direction: 'outbound',
      phone,
      messageText: preparedMessage,
      reason: 'WHATSAPP_AUTO_REPLY_FAILED',
      replyIntent: replyPlan.reason,
      conversationMode: replyPlan.conversationMode || 'initial',
      conversationState: failedConversationState,
      groundedAnswer: Boolean(replyPlan.groundedAnswer),
      knowledgeRetrieval: replyPlan.knowledgeRetrieval || null,
      deliveryStatus: 'failed',
      failureCategory: failure.category,
      failureTitle: failure.title,
      failureDetail: failure.detail,
      healthSeverity: failure.healthSeverity,
      operatorActionRequired: failure.operatorActionRequired,
      providerStatus: failure.status,
      providerCode: failure.providerCode,
      providerSubcode: failure.providerSubcode,
      providerType: failure.providerType,
      providerMessage: failure.providerMessage,
      activityMessage: `WhatsApp reply failed: ${failure.title}`,
      timestamp: failureAt,
    });

    return {
      sent: false,
      providerMessageId: null,
      failure,
      conversationState: failedConversationState,
      timestamp: failureAt,
    };
  }
}

async function continueWhatsAppConversation(leadId, {
  phone = null,
  message = '',
  messageId = null,
  timestamp = null,
} = {}) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      ...LEGACY_SAFE_LEAD_SELECT,
      business: { select: { id: true, name: true, industry: true, slug: true } },
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
  const replyConfig = resolveWhatsAppReplyConfig({
    businessIndustry: lead.business.industry || 'other',
    agentConfig,
  });
  const structuredReplyPlan = buildAcademyContinuationPlan({
    businessName: lead.business.name,
    businessIndustry: lead.business.industry || 'other',
    conversationState: priorState,
    message,
    priorityScore: context.priorityScore,
    replyConfig,
  });
  const groundedReplyPlan = shouldSkipKnowledgeForStructuredContinuation(priorState)
    ? null
    : await maybeBuildGroundedKnowledgeReplyPlan({
        businessName: lead.business.name,
        businessIndustry: lead.business.industry || 'other',
        message,
        intent: priorState?.flowIntent || context.intent,
        tags: context.tags,
        agentConfig,
        conversationState: priorState,
        conversationMode: 'continuation',
      });
  const replyPlan = selectPreferredAcademyReplyPlan({
    businessIndustry: lead.business.industry || 'other',
    message,
    structuredReplyPlan,
    groundedReplyPlan,
  });

  if (!replyPlan?.message) {
    return {
      leadId,
      continued: true,
      replySent: false,
      conversationState: priorState,
    };
  }

  const sendResult = await sendAndLogWhatsAppReply(leadId, phone, replyPlan);
  return {
    leadId,
    continued: true,
    replySent: sendResult.sent,
    replyFailed: !sendResult.sent,
    providerMessageId: sendResult.providerMessageId,
    conversationState: sendResult.conversationState,
    replyReason: replyPlan.reason,
    failureCategory: sendResult.failure?.category || null,
    failureTitle: sendResult.failure?.title || null,
  };
}

async function runLeadAutomations(leadId, {
  businessId = null,
  businessName = null,
  tags = [],
  intent = null,
  priorityScore = 0,
  businessIndustry = 'other',
  source = 'web',
  phone = null,
  leadMessage = '',
  confidenceLabel = 'high',
  leadDisposition = 'valid',
  agentConfig = null,
} = {}) {
  const creates = [];
  const resolvedAgentConfig = agentConfig || (businessId ? await getOrCreateAgentConfig(businessId) : null);
  const structuredReplyPlan = buildWhatsAppReplyPlan({
    businessName,
    businessIndustry,
    message: leadMessage,
    intent,
    tags,
    priorityScore,
    confidenceLabel,
    leadDisposition,
    agentConfig: resolvedAgentConfig,
  });
  const groundedReplyPlan = source === 'whatsapp'
    ? await maybeBuildGroundedKnowledgeReplyPlan({
        businessName,
        businessIndustry,
        message: leadMessage,
        intent,
        tags,
        agentConfig: resolvedAgentConfig,
        conversationMode: 'initial',
      })
    : null;
  const replyPlan = selectPreferredAcademyReplyPlan({
    businessIndustry,
    message: leadMessage,
    structuredReplyPlan,
    groundedReplyPlan,
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
  let whatsappReplyFailed = false;
  let whatsappFailure = null;
  let whatsappFailureAt = null;
  let whatsappConversationState = replyPlan?.conversationState || null;
  if (shouldSendWhatsAppReply) {
    const sendResult = await sendAndLogWhatsAppReply(leadId, phone, replyPlan);
    whatsappReplySent = sendResult.sent;
    whatsappReplyFailed = !sendResult.sent;
    whatsappFailure = sendResult.failure;
    whatsappFailureAt = sendResult.sent ? null : sendResult.timestamp || null;
    whatsappConversationState = sendResult.conversationState;
  }

  return {
    triggered: creates.length + ((whatsappReplySent || whatsappReplyFailed) ? 1 : 0),
    whatsappReplySent,
    whatsappReplyFailed,
    whatsappFailure,
    whatsappFailureAt,
    conversationState: whatsappConversationState,
  };
}

module.exports = {
  buildWhatsAppReplyPlan,
  buildAcademyContinuationPlan,
  maybeBuildGroundedKnowledgeReplyPlan,
  continueWhatsAppConversation,
  getLatestWhatsAppConversationState,
  recordWhatsAppInboundTurn,
  runLeadAutomations,
};
