'use strict';

const { getPromptPack } = require('./llm/promptPacks');
const { buildJsonSchema, buildOutputSchema } = require('./llm/schema');

const DEFAULT_MODEL = process.env.LLM_CLASSIFIER_MODEL || 'gpt-4o-mini';
const DEFAULT_PROVIDER = (process.env.LLM_CLASSIFIER_PROVIDER || 'openai').toLowerCase();
const DEFAULT_BASE_URL = process.env.LLM_CLASSIFIER_BASE_URL || 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT_MS = Number(process.env.LLM_CLASSIFIER_TIMEOUT_MS || 12000);
const DEFAULT_TEMPERATURE = Number(process.env.LLM_CLASSIFIER_TEMPERATURE || 0.1);

let warnedMissingKey = false;

function buildKeywordHintLine(config = null) {
  const keywords = config?.classificationRules?.keywords;
  if (!keywords || typeof keywords !== 'object' || Array.isArray(keywords)) return null;

  const parts = Object.entries(keywords)
    .filter(([, values]) => Array.isArray(values) && values.length)
    .slice(0, 8)
    .map(([intent, values]) => {
      const examples = values
        .filter((value) => typeof value === 'string' && value.trim())
        .slice(0, 4)
        .join(', ');
      return examples ? `${intent}: ${examples}` : null;
    })
    .filter(Boolean);

  return parts.length ? `Business keyword hints: ${parts.join(' | ')}.` : null;
}

function buildPriorityHintLine(config = null) {
  const weights = config?.priorityRules?.weights;
  if (!weights || typeof weights !== 'object' || Array.isArray(weights)) return null;

  const parts = Object.entries(weights)
    .filter(([, weight]) => typeof weight === 'number' && Number.isFinite(weight))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([term, weight]) => `${term}=${weight}`);

  return parts.length
    ? `Business priority hints: if these terms are present, reflect their urgency or commercial value when assigning priorityScore: ${parts.join(', ')}.`
    : null;
}

function buildSystemPrompt(pack, businessName, config = null) {
  return [
    `${pack.nicheRole} Messages may be English, Hinglish, transliterated Hindi, mixed-language, typo-heavy, or WhatsApp-style.`,
    `Business: ${businessName || 'Unknown business'}. Industry: ${pack.label}. Judge fit for this business, not a generic business.`,
    `Allowed intents: ${pack.allowedIntents.join(', ')}.`,
    `Allowed dispositions: ${pack.allowedDispositions.join(', ')}.`,
    `Allowed tags: ${pack.allowedTags.join(', ')}.`,
    `Priority guidance: ${pack.priorityGuidance.join(' ')}`,
    buildKeywordHintLine(config),
    buildPriorityHintLine(config),
    `Wrong-fit examples: ${pack.wrongFitExamples.join('; ')}.`,
    `Junk examples: ${pack.junkExamples.join('; ')}.`,
    `Next-action guidance: ${pack.nextActionGuidance.join(' ')}`,
    'Return JSON only. Keep reasoning short and concrete. Never output markdown.',
  ].filter(Boolean).join('\n');
}

function buildUserPrompt({ message, businessName, industry }) {
  return JSON.stringify({
    task: 'classify_lead',
    businessName: businessName || 'Unknown business',
    industry: industry || 'other',
    message: message || '',
  });
}

function deriveConfidenceLabel(score) {
  if (score >= 0.8) return 'high';
  if (score >= 0.45) return 'medium';
  return 'low';
}

function derivePriorityFromScore(score) {
  if (score >= 30) return 'HIGH';
  if (score >= 10) return 'NORMAL';
  return 'LOW';
}

function clampScore(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeText(value, fallback) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || fallback;
}

function safeFallback({ pack, reason, provider, model, rawOutput }) {
  return {
    intent: pack.safeIntent,
    priority: 'LOW',
    priorityScore: 0,
    tags: [],
    confidence: 0.05,
    confidenceLabel: 'low',
    disposition: 'weak',
    languageMode: 'other',
    reasoning: reason || 'Classifier unavailable; manual review needed.',
    suggestedNextAction: 'Review manually',
    via: 'llm_fallback',
    provider,
    model,
    vertical: pack.vertical,
    promptKey: pack.key,
    schemaVersion: pack.version,
    rawOutput: rawOutput ?? null,
  };
}

function normalizeClassification({ parsed, pack, provider, model, rawOutput }) {
  const allowedTags = new Set(pack.allowedTags);
  const rawConfidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
  const confidence = Math.max(0, Math.min(1, Number(rawConfidence)));
  const confidenceLabel = deriveConfidenceLabel(confidence);

  let intent = pack.allowedIntents.includes(parsed.intent) ? parsed.intent : pack.safeIntent;
  let tags = Array.isArray(parsed.tags)
    ? parsed.tags.filter((tag, index) => allowedTags.has(tag) && parsed.tags.indexOf(tag) === index).slice(0, 6)
    : [];

  if (allowedTags.has(intent) && !tags.includes(intent) && !['WRONG_FIT', 'NOT_INTERESTED', 'JUNK'].includes(intent)) {
    tags.unshift(intent);
  }

  let disposition = parsed.disposition;
  if (!pack.allowedDispositions.includes(disposition)) disposition = 'weak';

  let priorityScore = clampScore(parsed.priorityScore);
  let priority = derivePriorityFromScore(priorityScore);

  if (disposition === 'wrong_fit') {
    intent = pack.allowedIntents.includes('WRONG_FIT') ? 'WRONG_FIT' : pack.safeIntent;
    tags = tags.includes('WRONG_FIT') ? ['WRONG_FIT'] : (allowedTags.has('WRONG_FIT') ? ['WRONG_FIT'] : []);
    priorityScore = Math.min(priorityScore, 9);
    priority = 'LOW';
  } else if (disposition === 'not_interested' || disposition === 'junk') {
    if (pack.allowedIntents.includes(intent.toUpperCase())) intent = intent.toUpperCase();
    tags = [];
    priorityScore = Math.min(priorityScore, 5);
    priority = 'LOW';
  } else if (disposition === 'conflicting') {
    priorityScore = Math.min(priorityScore, 20);
    priority = derivePriorityFromScore(priorityScore);
  }

  return {
    intent,
    priority,
    priorityScore,
    tags,
    confidence: Math.round(confidence * 100) / 100,
    confidenceLabel,
    disposition,
    languageMode: pack.allowedLanguageModes.includes(parsed.languageMode) ? parsed.languageMode : 'other',
    reasoning: normalizeText(parsed.reasoning, 'Short classification rationale unavailable.'),
    suggestedNextAction: normalizeText(parsed.suggestedNextAction, priority === 'HIGH' ? 'Call soon' : 'Review manually'),
    via: 'llm_classifier',
    provider,
    model,
    vertical: pack.vertical,
    promptKey: pack.key,
    schemaVersion: pack.version,
    rawOutput: rawOutput ?? null,
  };
}

async function requestOpenAIClassification({ apiKey, model, baseUrl, systemPrompt, userPrompt, schema }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: DEFAULT_TEMPERATURE,
        max_tokens: 220,
        response_format: {
          type: 'json_schema',
          json_schema: schema,
        },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const payload = await response.json();
    const rawOutput = payload?.choices?.[0]?.message?.content ?? '';
    return { rawOutput };
  } finally {
    clearTimeout(timeout);
  }
}

async function classifyWithModel({ lead, business, config = null }) {
  const pack = getPromptPack(business?.industry);
  const provider = DEFAULT_PROVIDER;
  const model = DEFAULT_MODEL;
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_CLASSIFIER_API_KEY;

  if (provider !== 'openai') {
    return safeFallback({
      pack,
      provider,
      model,
      reason: `Unsupported LLM provider: ${provider}`,
    });
  }

  if (!apiKey) {
    if (!warnedMissingKey) {
      console.warn('[ModelClassifier] OPENAI_API_KEY not set — classifier will fall back safely');
      warnedMissingKey = true;
    }
    return safeFallback({
      pack,
      provider,
      model,
      reason: 'LLM API key missing; manual review needed.',
    });
  }

  if (!lead?.message?.trim()) {
    return safeFallback({
      pack,
      provider,
      model,
      reason: 'Lead message is empty; manual review needed.',
    });
  }

  const systemPrompt = buildSystemPrompt(pack, business?.name, config);
  const userPrompt = buildUserPrompt({
    message: lead.message,
    businessName: business?.name,
    industry: pack.vertical,
  });
  const schema = buildJsonSchema(pack);
  const outputSchema = buildOutputSchema(pack);

  try {
    const { rawOutput } = await requestOpenAIClassification({
      apiKey,
      model,
      baseUrl: DEFAULT_BASE_URL,
      systemPrompt,
      userPrompt,
      schema,
    });

    const parsed = JSON.parse(rawOutput.trim());
    const validated = outputSchema.parse(parsed);
    return normalizeClassification({
      parsed: validated,
      pack,
      provider,
      model,
      rawOutput,
    });
  } catch (err) {
    console.error('[ModelClassifier] Classification failed:', err.message);
    return safeFallback({
      pack,
      provider,
      model,
      rawOutput: err.name === 'SyntaxError' ? 'INVALID_JSON' : null,
      reason: 'Classifier failed validation; manual review needed.',
    });
  }
}

module.exports = {
  DEFAULT_MODEL,
  buildSystemPrompt,
  classifyWithModel,
  deriveConfidenceLabel,
  derivePriorityFromScore,
  getPromptPack,
};
