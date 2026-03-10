'use strict';

const { normalize } = require('./normalizer');
const { extractSignals } = require('./signalExtractor');
const { resolveNegations } = require('./negationResolver');
const { scoreConfidence } = require('./confidenceScorer');
const { resolveFinal } = require('./resolver');

/**
 * Local Intelligence Engine — Orchestrator
 *
 * Analyzes a raw lead message and returns a structured intelligence payload
 * resolving intent, priority, tags, disposition, and LLM fallback necessity.
 *
 * @param {string} rawMessage The raw incoming lead message
 * @param {object} config The AgentConfig (classificationRules, priorityRules, industry, etc.)
 * @returns {object} Final structured result
 */
function analyzeMessage(rawMessage, config) {
    /* Layer 1: Normalization (lowercase, trim, typos, Hinglish transliefcation fixes if any) */
    const { normalized, corrections } = normalize(rawMessage);

    /* Layer 2: Signal Extraction */
    const rawSignals = extractSignals(normalized, config);

    /* Layer 3: Negation & Contradiction Resolution */
    const { resolved, negatedPositives, junkVeto, hasContradiction } = resolveNegations(normalized, rawSignals);

    /* Layer 4: Confidence Scoring */
    const confidence = scoreConfidence(resolved, normalized, hasContradiction, junkVeto);

    /* Layer 5: Final Resolution (Disposition, Priority, Fallback Logic) */
    const result = resolveFinal(resolved, confidence, config);

    /* Attach debug/explainability layer */
    result.debug = {
        normalizedText: normalized,
        correctionsApplied: corrections,
        negatedPositives,
        junkVeto,
        hasContradiction
    };

    return result;
}

module.exports = { analyzeMessage };
