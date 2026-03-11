'use strict';

const { classifyWithModel } = require('./modelClassifier');

async function classify({ lead, business }) {
  const result = await classifyWithModel({ lead, business });

  return {
    bestCategory: result.intent,
    confidenceLabel: result.confidenceLabel,
    confidenceScore: result.confidence,
    tags: result.tags,
    via: result.via,
    priority: result.priority,
    priorityScore: result.priorityScore,
    disposition: result.disposition,
    languageMode: result.languageMode,
    reasoning: result.reasoning,
    suggestedNextAction: result.suggestedNextAction,
    provider: result.provider,
    model: result.model,
    vertical: result.vertical,
    promptKey: result.promptKey,
    schemaVersion: result.schemaVersion,
    rawOutput: result.rawOutput,
  };
}

module.exports = { classify };
