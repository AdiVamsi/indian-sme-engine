'use strict';

const { retrieveBusinessKnowledge } = require('./businessKnowledge.service');
const { generateGroundedWhatsAppReply } = require('./groundedReply.service');
const { resolveWhatsAppReplyConfig } = require('./whatsappReplyConfig.service');

const PREVIEW_INTENT_HINTS = [
  { intent: 'FEE_ENQUIRY', terms: ['fee', 'fees', 'price', 'cost', 'charges'] },
  { intent: 'DEMO_REQUEST', terms: ['demo', 'trial', 'sample class', 'demo class'] },
  { intent: 'SCHOLARSHIP_ENQUIRY', terms: ['scholarship', 'concession'] },
  { intent: 'BATCH_TIMING', terms: ['timing', 'timings', 'schedule', 'slot', 'batch time'] },
  { intent: 'ADMISSION', terms: ['admission', 'join', 'enrol', 'enroll', 'admission process', 'how to join'] },
  { intent: 'COURSE_INFO', terms: ['course', 'courses', 'program', 'programme', 'syllabus'] },
  { intent: 'GENERAL_ENQUIRY', terms: ['branch', 'location', 'address', 'where', 'online', 'live class', 'live classes'] },
];

function inferKnowledgePreviewIntent(message = '') {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) return null;

  const matched = PREVIEW_INTENT_HINTS.find(({ terms }) => terms.some((term) => text.includes(term)));
  return matched?.intent || null;
}

function buildMatchSignalLabel({ shouldAttempt = false, hasConfidentMatch = false, matches = [] } = {}) {
  if (!shouldAttempt) return 'No knowledge lookup';
  if (hasConfidentMatch) return 'Strong match';
  if (matches.length) return 'Possible match';
  return 'No match';
}

function summarizeMatch(match = {}, inferredIntent = null) {
  return {
    id: match.id,
    title: match.title,
    category: match.category,
    sourceLabel: match.sourceLabel || match.title,
    intents: Array.isArray(match.intents) ? match.intents : [],
    score: Number(match.score || 0),
    keywordHits: Number(match.keywordHits || 0),
    matchedKeywords: Array.isArray(match.matchedKeywords) ? match.matchedKeywords : [],
    intentMatched: Boolean(inferredIntent && Array.isArray(match.intents) && match.intents.includes(inferredIntent)),
    contentPreview: String(match.content || match.snippet || '').trim(),
  };
}

async function previewBusinessKnowledgeAnswer({
  businessName = '',
  businessIndustry = 'other',
  agentConfig = null,
  message = '',
} = {}) {
  const normalizedMessage = String(message || '').trim();
  const inferredIntent = inferKnowledgePreviewIntent(normalizedMessage);
  const retrieval = retrieveBusinessKnowledge({
    message: normalizedMessage,
    intent: inferredIntent,
    tags: inferredIntent ? [inferredIntent] : [],
    businessIndustry,
    agentConfig,
    maxMatches: 3,
  });
  const summarizedMatches = retrieval.matches.map((match) => summarizeMatch(match, inferredIntent));
  const topMatch = summarizedMatches[0] || null;

  if (!retrieval.enabled) {
    return {
      previewOnly: true,
      message: normalizedMessage,
      inferredIntent,
      retrieval: {
        enabled: false,
        shouldAttempt: false,
        hasConfidentMatch: false,
        signalLabel: 'Knowledge disabled',
        matchCount: 0,
        topMatch: null,
        matches: [],
      },
      outcome: {
        mode: 'handoff',
        wouldUseGroundedAnswer: false,
        previewAnswer: '',
        fallbackMessage: 'Grounded business answers are disabled for this business, so this question would be handed to a human.',
        reason: 'Business knowledge is disabled.',
        confidence: 0,
      },
    };
  }

  if (!retrieval.shouldAttempt) {
    return {
      previewOnly: true,
      message: normalizedMessage,
      inferredIntent,
      retrieval: {
        enabled: true,
        shouldAttempt: false,
        hasConfidentMatch: false,
        signalLabel: 'No knowledge lookup',
        matchCount: 0,
        topMatch: null,
        matches: [],
      },
      outcome: {
        mode: 'handoff',
        wouldUseGroundedAnswer: false,
        previewAnswer: '',
        fallbackMessage: 'This question does not look like a grounded business knowledge query, so the system would likely hand it to a human.',
        reason: 'The sample question did not trigger grounded knowledge retrieval.',
        confidence: 0,
      },
    };
  }

  if (!retrieval.hasConfidentMatch) {
    return {
      previewOnly: true,
      message: normalizedMessage,
      inferredIntent,
      retrieval: {
        enabled: true,
        shouldAttempt: true,
        hasConfidentMatch: false,
        signalLabel: buildMatchSignalLabel(retrieval),
        matchCount: summarizedMatches.length,
        topMatch,
        matches: summarizedMatches,
      },
      outcome: {
        mode: 'handoff',
        wouldUseGroundedAnswer: false,
        previewAnswer: '',
        fallbackMessage: 'No strong knowledge entry matched this question. The system would likely hand it to a human.',
        reason: 'No strong business knowledge match was found.',
        confidence: 0,
      },
    };
  }

  const replyConfig = resolveWhatsAppReplyConfig({ businessIndustry, agentConfig });
  const groundedReply = await generateGroundedWhatsAppReply({
    businessName,
    businessIndustry,
    institutionLabel: replyConfig.institutionLabel,
    message: normalizedMessage,
    matches: retrieval.matches,
  });
  const wouldUseGroundedAnswer = Boolean(
    groundedReply.grounded
    && groundedReply.reply
    && groundedReply.confidence >= 0.65
  );

  return {
    previewOnly: true,
    message: normalizedMessage,
    inferredIntent,
    retrieval: {
      enabled: true,
      shouldAttempt: true,
      hasConfidentMatch: true,
      signalLabel: buildMatchSignalLabel(retrieval),
      matchCount: summarizedMatches.length,
      topMatch,
      matches: summarizedMatches,
    },
    outcome: {
      mode: wouldUseGroundedAnswer ? 'grounded_answer' : 'handoff',
      wouldUseGroundedAnswer,
      previewAnswer: wouldUseGroundedAnswer ? groundedReply.reply : '',
      fallbackMessage: wouldUseGroundedAnswer
        ? ''
        : 'A matching entry was found, but the system would likely hand this to a human if it could not ground the answer confidently.',
      reason: groundedReply.reason,
      confidence: Number(groundedReply.confidence || 0),
    },
  };
}

module.exports = {
  inferKnowledgePreviewIntent,
  previewBusinessKnowledgeAnswer,
};
