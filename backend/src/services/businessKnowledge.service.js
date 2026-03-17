'use strict';

const { getAgentConfigPreset } = require('../constants/agentConfig.presets');

const SUPPORTED_KNOWLEDGE_INTENTS = new Set([
  'ADMISSION',
  'BATCH_TIMING',
  'CALLBACK_REQUEST',
  'COURSE_INFO',
  'DEMO_REQUEST',
  'FEE_ENQUIRY',
  'GENERAL_ENQUIRY',
  'SCHOLARSHIP_ENQUIRY',
]);

const KNOWLEDGE_CATEGORIES = [
  'fees',
  'timings',
  'online_classes',
  'demo_class',
  'admission',
  'scholarship',
  'branch_location',
  'courses',
  'general',
];

const KNOWLEDGE_CATEGORY_ALIASES = {
  course: 'courses',
  courses: 'courses',
  demo: 'demo_class',
  demo_class: 'demo_class',
  delivery: 'online_classes',
  online: 'online_classes',
  online_classes: 'online_classes',
  location: 'branch_location',
  branch_location: 'branch_location',
  faq: 'general',
  general: 'general',
};

const KNOWLEDGE_QUERY_TERMS = [
  'fee',
  'fees',
  'price',
  'cost',
  'charges',
  'timing',
  'timings',
  'batch',
  'schedule',
  'demo',
  'trial',
  'scholarship',
  'concession',
  'branch',
  'location',
  'address',
  'where',
  'course',
  'program',
  'programme',
  'syllabus',
  'online',
  'online class',
  'online classes',
  'online coaching',
  'live class',
  'live classes',
  'admission process',
  'how to join',
  'admission',
  'hindi',
  'english',
  'language',
  'callback',
  'call back',
  'call',
  'phone',
];

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'for', 'from', 'hai', 'i', 'in', 'is', 'ka', 'ke', 'ki',
  'me', 'my', 'of', 'on', 'or', 'please', 'the', 'to', 'what', 'when', 'where', 'with', 'you', 'your',
]);

function normalizeStringArray(values = []) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )];
}

function slugify(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

function normalizeKnowledgeCategory(value = '') {
  const category = String(value || '').trim().toLowerCase();
  if (!category) return null;
  if (KNOWLEDGE_CATEGORIES.includes(category)) return category;
  return KNOWLEDGE_CATEGORY_ALIASES[category] || null;
}

function tokenize(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function normalizeKnowledgeEntry(entry = {}, index = 0) {
  const content = typeof entry.content === 'string'
    ? entry.content.trim()
    : typeof entry.answer === 'string'
      ? entry.answer.trim()
      : '';
  const title = String(entry.title || entry.question || `Knowledge ${index + 1}`).trim();
  const rawCategory = String(entry.category || 'general').trim().toLowerCase();
  const category = normalizeKnowledgeCategory(rawCategory) || 'general';
  const fallbackId = slugify(`${category}_${title}`) || `knowledge_${index + 1}`;

  return {
    id: String(entry.id || fallbackId),
    title,
    category,
    intents: normalizeStringArray(entry.intents || []).map((value) => value.toUpperCase()),
    keywords: normalizeStringArray(entry.keywords || []).map((value) => value.toLowerCase()),
    content,
    sourceLabel: String(entry.sourceLabel || entry.title || entry.question || `Knowledge ${index + 1}`).trim(),
    enabled: entry.enabled !== false,
  };
}

function normalizeBusinessKnowledgeConfig(raw = {}, { fallback = null } = {}) {
  const fallbackConfig = fallback && typeof fallback === 'object' && !Array.isArray(fallback) ? fallback : {};
  const base = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const rawEntries = Array.isArray(base.entries)
    ? base.entries
    : Array.isArray(fallbackConfig.entries)
      ? fallbackConfig.entries
      : [];

  return {
    enabled: base.enabled !== undefined
      ? Boolean(base.enabled)
      : Boolean(fallbackConfig.enabled),
    entries: rawEntries
      .map((entry, index) => normalizeKnowledgeEntry(entry, index))
      .filter((entry) => entry.content),
  };
}

function resolveBusinessKnowledge({ businessIndustry = 'other', agentConfig = null } = {}) {
  const industry = businessIndustry || 'other';
  const preset = getAgentConfigPreset(industry);
  const presetKnowledge = preset?.classificationRules?.businessKnowledge || {};
  const businessKnowledge = agentConfig?.classificationRules?.businessKnowledge || {};
  return normalizeBusinessKnowledgeConfig(businessKnowledge, { fallback: presetKnowledge });
}

function isPotentialBusinessKnowledgeQuestion({ message = '', intent = null, tags = [] } = {}) {
  const normalizedIntent = String(intent || '').trim().toUpperCase();
  const text = String(message || '').toLowerCase();
  const hasKnowledgeTerms = KNOWLEDGE_QUERY_TERMS.some((term) => text.includes(term));

  if (!text.trim()) return false;
  if (SUPPORTED_KNOWLEDGE_INTENTS.has(normalizedIntent)) {
    return hasKnowledgeTerms;
  }

  return Array.isArray(tags)
    && tags.some((tag) => SUPPORTED_KNOWLEDGE_INTENTS.has(String(tag || '').trim().toUpperCase()))
    && hasKnowledgeTerms;
}

function scoreKnowledgeEntry(entry, { message, intent = null, tags = [] }) {
  const normalizedMessage = String(message || '').toLowerCase();
  const normalizedIntent = String(intent || '').trim().toUpperCase();
  const normalizedTags = new Set((Array.isArray(tags) ? tags : []).map((tag) => String(tag || '').trim().toUpperCase()));
  const messageTokens = new Set(tokenize(message));
  const titleTokens = tokenize(entry.title);
  const contentTokens = tokenize(entry.content);

  let score = 0;
  let keywordHits = 0;
  const matchedKeywords = [];

  if (entry.intents.includes(normalizedIntent)) score += 8;
  if (entry.intents.some((entryIntent) => normalizedTags.has(entryIntent))) score += 4;

  for (const keyword of entry.keywords) {
    if (normalizedMessage.includes(keyword)) {
      keywordHits += 1;
      score += 6;
      matchedKeywords.push(keyword);
    }
  }

  for (const token of titleTokens) {
    if (messageTokens.has(token)) score += 2;
  }

  for (const token of contentTokens.slice(0, 24)) {
    if (messageTokens.has(token)) score += 1;
  }

  return {
    ...entry,
    score,
    keywordHits,
    matchedKeywords,
    snippet: entry.content,
  };
}

function retrieveBusinessKnowledge({
  message = '',
  intent = null,
  tags = [],
  businessIndustry = 'other',
  agentConfig = null,
  maxMatches = 3,
} = {}) {
  const knowledge = resolveBusinessKnowledge({ businessIndustry, agentConfig });
  const shouldAttempt = knowledge.enabled && isPotentialBusinessKnowledgeQuestion({ message, intent, tags });

  if (!shouldAttempt) {
    return {
      enabled: knowledge.enabled,
      shouldAttempt: false,
      matches: [],
      topMatch: null,
      hasConfidentMatch: false,
    };
  }

  const matches = knowledge.entries
    .filter((entry) => entry.enabled !== false)
    .map((entry) => scoreKnowledgeEntry(entry, { message, intent, tags }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxMatches);

  const topMatch = matches[0] || null;
  const secondMatch = matches[1] || null;
  const hasConfidentMatch = Boolean(
    topMatch
    && topMatch.score >= 10
    && (topMatch.keywordHits > 0 || topMatch.score - (secondMatch?.score || 0) >= 2)
  );

  return {
    enabled: knowledge.enabled,
    shouldAttempt,
    matches,
    topMatch,
    hasConfidentMatch,
  };
}

module.exports = {
  KNOWLEDGE_CATEGORIES,
  normalizeKnowledgeCategory,
  KNOWLEDGE_QUERY_TERMS,
  SUPPORTED_KNOWLEDGE_INTENTS,
  isPotentialBusinessKnowledgeQuestion,
  normalizeBusinessKnowledgeConfig,
  normalizeKnowledgeEntry,
  resolveBusinessKnowledge,
  retrieveBusinessKnowledge,
};
