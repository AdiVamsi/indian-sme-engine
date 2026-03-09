'use strict';

/**
 * modelClassifier.js — Model-backed intent classification.
 *
 * Called only when CLASSIFIER_MODE=hybrid and the rule-based pass
 * did not produce a high-confidence result. All failures return null
 * so the caller (classifier.js) can fall through to the rule result.
 *
 * Requires: ANTHROPIC_API_KEY env var.
 * Install:  npm install @anthropic-ai/sdk   (only needed for hybrid mode)
 */

/* Lazy-initialized client — never instantiated in rule_only mode. */
let _client    = null;
let _warnedOnce = false;

function getClient() {
  if (_client) return _client;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    if (!_warnedOnce) {
      console.warn('[ModelClassifier] ANTHROPIC_API_KEY not set — model path disabled');
      _warnedOnce = true;
    }
    return null;
  }

  try {
    /* eslint-disable-next-line global-require */
    const { default: Anthropic } = require('@anthropic-ai/sdk');
    _client = new Anthropic({ apiKey });
  } catch {
    if (!_warnedOnce) {
      console.warn('[ModelClassifier] @anthropic-ai/sdk not installed — run: npm install @anthropic-ai/sdk');
      _warnedOnce = true;
    }
    return null;
  }

  return _client;
}

/**
 * classifyWithModel
 *
 * Sends the lead message to Claude Haiku for intent classification.
 * The model must pick exactly one category from the provided list.
 *
 * @param {object}   params
 * @param {string}   params.message                        — raw lead message
 * @param {string[]} params.categories                     — allowed category names
 * @param {Record<string,string>} [params.categoryDescriptions] — optional per-category hints
 * @returns {Promise<{ bestCategory: string, confidenceLabel: string, confidenceScore: number } | null>}
 */
async function classifyWithModel({ message, categories, categoryDescriptions = {} }) {
  if (!message || !categories?.length) return null;

  const client = getClient();
  if (!client) return null;

  /* Build the category list string; include descriptions when provided. */
  const categoryList = categories
    .map((c) => {
      const desc = categoryDescriptions[c];
      return desc ? `- ${c}: ${desc}` : `- ${c}`;
    })
    .join('\n');

  const systemPrompt = [
    'You are an intent classifier for lead enquiry messages sent to Indian small businesses.',
    'Classify the message into exactly one of the provided categories.',
    'Respond with JSON only — no explanation, no markdown.',
    'Response schema: { "category": "<allowed category>", "confidence_score": <0.0–1.0> }',
    '',
    'Rules:',
    '- category must be exactly one value from the Allowed Categories list.',
    '- Do not invent or abbreviate category names.',
    '- confidence_score is your certainty (0.0 = no idea, 1.0 = certain).',
    '',
    'Allowed Categories:',
    categoryList,
  ].join('\n');

  let rawText;
  try {
    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 128,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: message }],
    });
    rawText = response.content?.[0]?.text ?? '';
  } catch (err) {
    console.error('[ModelClassifier] API call failed:', err.message);
    return null;
  }

  /* Parse JSON response. */
  let parsed;
  try {
    parsed = JSON.parse(rawText.trim());
  } catch {
    console.error('[ModelClassifier] Failed to parse model response as JSON:', rawText);
    return null;
  }

  const category = parsed?.category;
  const rawScore = parsed?.confidence_score;

  /* Validate: category must be in the allowed set — never invent one. */
  if (!categories.includes(category)) {
    console.error('[ModelClassifier] Model returned a category not in allowed set:', category);
    return null;
  }

  if (typeof rawScore !== 'number' || rawScore < 0 || rawScore > 1) {
    console.error('[ModelClassifier] Model returned invalid confidence_score:', rawScore);
    return null;
  }

  const confidenceLabel = rawScore >= 0.75 ? 'high'
                        : rawScore >= 0.45 ? 'medium'
                        :                   'low';

  return {
    bestCategory:    category,
    confidenceLabel,
    confidenceScore: Math.round(rawScore * 100) / 100,
  };
}

module.exports = { classifyWithModel };
