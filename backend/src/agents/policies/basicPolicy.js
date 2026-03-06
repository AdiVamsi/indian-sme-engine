'use strict';

/* ── Fallbacks used when AgentConfig rules are absent or structurally invalid ── */
const FALLBACK_CLASSIFICATION = {
  keywords: {
    DEMO_REQUEST: ['demo'],
    ADMISSION:    ['admission'],
  },
};

const FALLBACK_PRIORITY = {
  weights: {
    urgent:      30,
    immediately: 30,
    asap:        30,
    immediate:   30,
    'need now':  30,
    'right now': 30,
    price:       10,
  },
};

/**
 * Built-in urgency phrases that always add +30, independent of config weights.
 * Ensures "I need a class immediately" is HIGH priority even with minimal config.
 */
const BUILT_IN_URGENT_PHRASES = [
  'immediately',
  'asap',
  'right now',
  'need now',
  'as soon as possible',
  'immediate',
  'today only',
  'very urgent',
];

/**
 * resolveClassificationRules
 * Validates AgentConfig.classificationRules JSONB.
 * Expected shape: { keywords: { TAG_NAME: ["kw1", "kw2", ...], ... } }
 * Falls back to FALLBACK_CLASSIFICATION if shape is missing or malformed.
 */
function resolveClassificationRules(raw) {
  if (
    raw !== null &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    raw.keywords !== null &&
    typeof raw.keywords === 'object' &&
    !Array.isArray(raw.keywords)
  ) {
    return raw;
  }
  return FALLBACK_CLASSIFICATION;
}

/**
 * resolvePriorityRules
 * Validates AgentConfig.priorityRules JSONB.
 * Expected shape: { weights: { keyword: number, ... } }
 * Falls back to FALLBACK_PRIORITY if shape is missing or malformed.
 */
function resolvePriorityRules(raw) {
  if (
    raw !== null &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    raw.weights !== null &&
    typeof raw.weights === 'object' &&
    !Array.isArray(raw.weights)
  ) {
    return raw;
  }
  return FALLBACK_PRIORITY;
}

/**
 * applyPolicy — pure, deterministic, config-driven. No DB access, no side effects.
 *
 * Classification:
 *   Iterates classificationRules.keywords.
 *   Key   = tag name (e.g. "DEMO_REQUEST")
 *   Value = array of trigger keywords (e.g. ["demo", "trial"])
 *   If any keyword matches the lowercased message → tag is added.
 *
 * Priority scoring:
 *   Iterates priorityRules.weights.
 *   Key   = keyword to scan for (e.g. "urgent")
 *   Value = integer score to add (e.g. 30)
 *   Universal rule: +5 if message.length > 100 (always applied, not config-driven).
 *
 * @param {object} lead   — Prisma Lead row
 * @param {object} config — Prisma AgentConfig row
 * @returns {{ priorityScore: number, tags: string[] }}
 */
function applyPolicy(lead, config) {
  const message    = (lead.message || '').toLowerCase();
  const classRules = resolveClassificationRules(config.classificationRules);
  const prioRules  = resolvePriorityRules(config.priorityRules);

  /* ── Classification ── */
  const tags = [];
  for (const [tag, keywords] of Object.entries(classRules.keywords)) {
    if (
      Array.isArray(keywords) &&
      keywords.some((kw) => typeof kw === 'string' && message.includes(kw.toLowerCase()))
    ) {
      tags.push(tag);
    }
  }

  /* ── Priority scoring ── */
  let priorityScore = 0;
  for (const [keyword, weight] of Object.entries(prioRules.weights)) {
    if (typeof weight === 'number' && message.includes(keyword.toLowerCase())) {
      priorityScore += weight;
    }
  }

  /* Universal rule: detailed message signals serious enquiry */
  if (message.length > 100) priorityScore += 5;

  /* Built-in urgency boost — applies regardless of configured keyword weights */
  if (BUILT_IN_URGENT_PHRASES.some((phrase) => message.includes(phrase))) {
    priorityScore += 30;
  }

  return { priorityScore, tags };
}

module.exports = { applyPolicy };
