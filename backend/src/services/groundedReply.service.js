'use strict';

const { z } = require('zod');

const DEFAULT_MODEL = process.env.LLM_CLASSIFIER_MODEL || 'gpt-4o-mini';
const DEFAULT_PROVIDER = (process.env.LLM_CLASSIFIER_PROVIDER || 'openai').toLowerCase();
const DEFAULT_BASE_URL = process.env.LLM_CLASSIFIER_BASE_URL || 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT_MS = Number(process.env.LLM_CLASSIFIER_TIMEOUT_MS || 12000);
const DEFAULT_TEMPERATURE = Number(process.env.LLM_CLASSIFIER_TEMPERATURE || 0.1);

const groundedReplySchema = z.object({
  grounded: z.boolean(),
  confidence: z.number().min(0).max(1),
  reply: z.string(),
  usedEntryIds: z.array(z.string()).default([]),
  reason: z.string(),
});

function clampConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function buildGroundedReplySystemPrompt({ businessName, institutionLabel, businessIndustry }) {
  return [
    `You are the WhatsApp front-desk assistant for ${businessName || 'this business'}.`,
    `Industry: ${businessIndustry || 'other'}. Institution label: ${institutionLabel || 'team'}.`,
    'Answer only from the supplied business knowledge snippets.',
    'If the snippets do not clearly answer the customer question, return grounded=false and do not guess.',
    'Keep the reply factual, warm, concise, and suitable for an Indian customer-service context.',
    'Do not use markdown. Do not mention information that is not present in the snippets.',
    'Return JSON only.',
  ].join('\n');
}

function buildGroundedReplyUserPrompt({ message, matches = [] }) {
  return JSON.stringify({
    task: 'grounded_whatsapp_reply',
    customerMessage: message || '',
    retrievedKnowledge: matches.map((match) => ({
      id: match.id,
      title: match.title,
      category: match.category,
      content: match.content,
    })),
  });
}

function buildGroundedReplySchema() {
  return {
    name: 'grounded_whatsapp_reply',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        grounded: { type: 'boolean' },
        confidence: { type: 'number' },
        reply: { type: 'string' },
        usedEntryIds: {
          type: 'array',
          items: { type: 'string' },
        },
        reason: { type: 'string' },
      },
      required: ['grounded', 'confidence', 'reply', 'usedEntryIds', 'reason'],
    },
  };
}

async function requestOpenAIReply({ apiKey, systemPrompt, userPrompt }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${DEFAULT_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: DEFAULT_TEMPERATURE,
        max_tokens: 180,
        response_format: {
          type: 'json_schema',
          json_schema: buildGroundedReplySchema(),
        },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const payload = await response.json();
    return payload?.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timeout);
  }
}

async function generateGroundedWhatsAppReply({
  businessName,
  businessIndustry,
  institutionLabel,
  message,
  matches = [],
} = {}) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_CLASSIFIER_API_KEY;

  if (DEFAULT_PROVIDER !== 'openai') {
    return {
      grounded: false,
      confidence: 0,
      reply: '',
      usedEntryIds: [],
      reason: `Unsupported LLM provider: ${DEFAULT_PROVIDER}`,
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      rawOutput: null,
    };
  }

  if (!apiKey || !matches.length) {
    return {
      grounded: false,
      confidence: 0,
      reply: '',
      usedEntryIds: [],
      reason: !apiKey ? 'Grounded reply API key missing.' : 'No retrieved business knowledge available.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      rawOutput: null,
    };
  }

  try {
    const rawOutput = await requestOpenAIReply({
      apiKey,
      systemPrompt: buildGroundedReplySystemPrompt({
        businessName,
        institutionLabel,
        businessIndustry,
      }),
      userPrompt: buildGroundedReplyUserPrompt({ message, matches }),
    });

    const parsed = groundedReplySchema.parse(JSON.parse(String(rawOutput || '').trim()));
    const allowedEntryIds = new Set(matches.map((match) => match.id));
    const usedEntryIds = parsed.usedEntryIds.filter((id) => allowedEntryIds.has(id));

    return {
      grounded: parsed.grounded && Boolean(parsed.reply.trim()),
      confidence: clampConfidence(parsed.confidence),
      reply: parsed.reply.trim(),
      usedEntryIds,
      reason: parsed.reason.trim(),
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      rawOutput,
    };
  } catch (err) {
    return {
      grounded: false,
      confidence: 0,
      reply: '',
      usedEntryIds: [],
      reason: err.message || 'Grounded reply generation failed.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      rawOutput: null,
    };
  }
}

module.exports = {
  generateGroundedWhatsAppReply,
};
