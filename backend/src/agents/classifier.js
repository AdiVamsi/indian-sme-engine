'use strict';

/**
 * classifier.js — Hybrid intent classifier.
 *
 * Rule-first: uses scoreCategories() from basicPolicy.js (same keyword rules,
 * same match logic, no duplication). Escalates to the model-backed path only
 * when the rule result is low-confidence or ambiguous.
 *
 * CLASSIFIER_MODE (env):
 *   rule_only  — (default) never calls model; safe for dev/CI/no-key environments
 *   hybrid     — rule-first, model fallback for uncertain leads
 *
 * Returns shape:
 *   { bestCategory, confidenceLabel, confidenceScore, tags, via }
 *
 * tags[]       — all categories with ≥1 keyword match (automation-compat; same as applyPolicy)
 * bestCategory — top-ranked category (model may override rule's top for ambiguous leads)
 * via          — 'rule' | 'model' | 'fallback'
 */

const { resolveClassificationRules, scoreCategories } = require('./policies/basicPolicy');
const { classifyWithModel }                            = require('./modelClassifier');

const CLASSIFIER_MODE = (process.env.CLASSIFIER_MODE || 'rule_only').toLowerCase();

if (!['rule_only', 'hybrid'].includes(CLASSIFIER_MODE)) {
  console.warn(
    `[Classifier] Unknown CLASSIFIER_MODE "${CLASSIFIER_MODE}" — defaulting to rule_only`
  );
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/**
 * safeFallback
 * Returns a safe result that never invents a category outside the allowed set.
 * Prefers GENERAL_ENQUIRY; falls back to the first allowed category if absent.
 */
function safeFallback(allowedCategories) {
  const best = allowedCategories.includes('GENERAL_ENQUIRY')
    ? 'GENERAL_ENQUIRY'
    : (allowedCategories[0] ?? 'GENERAL_ENQUIRY');

  return {
    bestCategory:    best,
    confidenceLabel: 'low',
    confidenceScore: 0.0,
    tags:            [],
    via:             'fallback',
  };
}

/**
 * shouldEscalate
 * Decides whether the rule result is weak enough to warrant a model call.
 *
 * Escalates when ANY of these conditions hold:
 *   A. topScore === 0           — no keyword matched at all
 *   B. top === second > 0       — genuine tie; ambiguous intent
 *   C. topScore === 1 AND message is long (>8 words) — single weak match on complex input
 *
 * These are practical heuristics, not sacred constants. Tune as needed.
 */
function shouldEscalate(scores, message) {
  const entries     = Object.entries(scores).sort(([, a], [, b]) => b - a);
  const topScore    = entries[0]?.[1] ?? 0;
  const secondScore = entries[1]?.[1] ?? 0;

  if (topScore === 0)                                                return true;  /* A */
  if (topScore === secondScore && topScore > 0)                      return true;  /* B */
  if (topScore === 1 && (message || '').trim().split(/\s+/).length > 8) return true; /* C */

  return false;
}

/**
 * ruleConfidence
 * Derives a normalized confidence score from raw keyword match counts.
 *
 * confidenceScore = topScore / (topScore + secondScore + 1)
 *   — always in (0, 1); never reaches 1.0 so callers know it is an estimate.
 */
function ruleConfidence(scores) {
  const entries     = Object.entries(scores).sort(([, a], [, b]) => b - a);
  const topScore    = entries[0]?.[1] ?? 0;
  const secondScore = entries[1]?.[1] ?? 0;

  const label = topScore >= 3 ? 'high'
              : topScore >= 2 ? 'medium'
              :                 'low';

  const score = topScore / (topScore + secondScore + 1);

  return { label, score: Math.round(score * 100) / 100 };
}

/* ── Main export ──────────────────────────────────────────────────────────── */

/**
 * classify
 *
 * @param {object} params
 * @param {object} params.lead                                — Prisma Lead row
 * @param {object} params.config                              — Prisma AgentConfig row
 * @param {Record<string,string>} [params.categoryDescriptions] — optional hints for model path
 * @returns {Promise<{
 *   bestCategory:    string,
 *   confidenceLabel: 'high'|'medium'|'low',
 *   confidenceScore: number,
 *   tags:            string[],
 *   via:             'rule'|'model'|'fallback'
 * }>}
 */
async function classify({ lead, config, categoryDescriptions = {} }) {
  const resolvedRules     = resolveClassificationRules(config.classificationRules);
  const allowedCategories = Object.keys(resolvedRules.keywords);
  const fallback          = safeFallback(allowedCategories);

  /* ── 1. Score every category with the rule engine ── */
  let scores;
  try {
    scores = scoreCategories(lead.message || '', resolvedRules);
  } catch (err) {
    console.error('[Classifier] scoreCategories threw:', err.message);
    return fallback;
  }

  /* tags[] = all categories with at least one keyword match.
   * Identical to the tag set applyPolicy() produces — automation rules unchanged. */
  const tags = Object.entries(scores)
    .filter(([, count]) => count > 0)
    .map(([tag]) => tag);

  /* Top-ranked category by keyword count. */
  const topEntry    = Object.entries(scores).sort(([, a], [, b]) => b - a).find(([, c]) => c > 0);
  const topCategory = topEntry?.[0] ?? null;

  /* ── 2. Rule-only path: CLASSIFIER_MODE=rule_only OR confidence is sufficient ── */
  const effectiveMode = ['rule_only', 'hybrid'].includes(CLASSIFIER_MODE) ? CLASSIFIER_MODE : 'rule_only';

  if (effectiveMode === 'rule_only' || !shouldEscalate(scores, lead.message || '')) {
    if (!topCategory) return fallback;
    const { label, score } = ruleConfidence(scores);
    return { bestCategory: topCategory, confidenceLabel: label, confidenceScore: score, tags, via: 'rule' };
  }

  /* ── 3. Model fallback path (hybrid mode, escalation threshold met) ── */
  let modelResult = null;
  try {
    modelResult = await classifyWithModel({
      message:             lead.message || '',
      categories:          allowedCategories,
      categoryDescriptions,
    });
  } catch (err) {
    /* classifyWithModel already catches internally; this is a safety net. */
    console.error('[Classifier] classifyWithModel threw unexpectedly:', err.message);
  }

  if (modelResult) {
    /* bestCategory comes from the model (may differ from topCategory for ambiguous leads).
     * tags[] remains rule-derived so all downstream automations fire as before.
     * via='model' makes the source explicit in the metadata. */
    return {
      bestCategory:    modelResult.bestCategory,
      confidenceLabel: modelResult.confidenceLabel,
      confidenceScore: modelResult.confidenceScore,
      tags,
      via: 'model',
    };
  }

  /* ── 4. Model failed — fall through to rule result or safe fallback ── */
  if (topCategory) {
    const { label, score } = ruleConfidence(scores);
    return { bestCategory: topCategory, confidenceLabel: label, confidenceScore: score, tags, via: 'fallback' };
  }

  return fallback;
}

module.exports = { classify };
