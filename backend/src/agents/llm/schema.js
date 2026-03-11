'use strict';

const { z } = require('zod');

function buildOutputSchema(pack) {
  const intentEnum = z.enum(pack.allowedIntents);
  const priorityEnum = z.enum(pack.allowedPriorities);
  const dispositionEnum = z.enum(pack.allowedDispositions);
  const languageEnum = z.enum(pack.allowedLanguageModes);
  const confidenceLabelEnum = z.enum(pack.allowedConfidenceLabels);

  return z.object({
    intent: intentEnum,
    priority: priorityEnum,
    priorityScore: z.number().int().min(0).max(100),
    tags: z.array(z.enum(pack.allowedTags)).max(6),
    confidence: z.number().min(0).max(1),
    confidenceLabel: confidenceLabelEnum,
    disposition: dispositionEnum,
    languageMode: languageEnum,
    reasoning: z.string().trim().min(1).max(160),
    suggestedNextAction: z.string().trim().min(1).max(120),
  });
}

function buildJsonSchema(pack) {
  return {
    name: 'lead_classification',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'intent',
        'priority',
        'priorityScore',
        'tags',
        'confidence',
        'confidenceLabel',
        'disposition',
        'languageMode',
        'reasoning',
        'suggestedNextAction',
      ],
      properties: {
        intent: { type: 'string', enum: pack.allowedIntents },
        priority: { type: 'string', enum: pack.allowedPriorities },
        priorityScore: { type: 'integer', minimum: 0, maximum: 100 },
        tags: {
          type: 'array',
          items: { type: 'string', enum: pack.allowedTags },
          maxItems: 6,
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        confidenceLabel: { type: 'string', enum: pack.allowedConfidenceLabels },
        disposition: { type: 'string', enum: pack.allowedDispositions },
        languageMode: { type: 'string', enum: pack.allowedLanguageModes },
        reasoning: { type: 'string', minLength: 1, maxLength: 160 },
        suggestedNextAction: { type: 'string', minLength: 1, maxLength: 120 },
      },
    },
  };
}

module.exports = { buildOutputSchema, buildJsonSchema };
