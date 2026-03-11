'use strict';

/**
 * Layer 5 — Final Resolution
 *
 * Aggregates signals and confidence into a final structured output, calculates
 * priority score (mimicking applyPolicy), determines disposition, and decides
 * on LLM fallback.
 *
 * @param {object} resolved      Resolved signals
 * @param {object} confidence    Confidence label/score/reason
 * @param {object} config        AgentConfig
 * @returns {object} Final intelligence payload
 */
function resolveFinal(resolved, confidence, config) {
    const BUILT_IN_URGENCY_WEIGHTS = {
        IMMEDIATELY: 25,
        RIGHT_NOW: 25,
        ASAP: 25,
        URGENT: 30,
        TODAY: 20,
        TOMORROW: 20,
        THIS_WEEK: 12,
        NEXT_WEEK: 15,
        NEXT_MONTH: 10,
        FROM_NEXT: 10,
        NOW_HI: 25,
        IMMEDIATELY_HI: 25,
        QUICK_HI: 15,
        TOMORROW_HI: 20,
        THIS_WEEK_HI: 12,
        NEXT_WEEK_HI: 15,
        NEXT_MONTH_HI: 10,
    };

    /* 1. Extract final tags, mapping internal verbs into business outcomes */
    const INTERNAL_SIGNALS = new Set([
        'COACHING_NEED', 'ENROLLMENT', 'NEED_WANT', 'WANT_TO_TAKE',
        'WANT_TO_DO', 'START_INTENT', 'FOR_PURPOSE',
        'AVAILABILITY_CHECK', 'TEACHING_CHECK', 'ENQUIRING', 'INFO_REQUEST'
    ]);

    const tagsSet = new Set();
    for (const m of resolved.positive) {
        let sig = m.signal;
        if (['COACHING_NEED', 'ENROLLMENT', 'START_INTENT', 'WANT_TO_TAKE', 'WANT_TO_DO'].includes(sig)) {
            sig = 'ADMISSION';
        }
        if (!INTERNAL_SIGNALS.has(sig)) {
            tagsSet.add(sig);
        }
    }
    const tags = Array.from(tagsSet);

    /* 2. Base Priority scoring (backward-compatible with basicPolicy) */
    const weights = config?.priorityRules?.weights || {};
    let priorityScore = 0;

    /* Score based on raw matches of configured weights */
    const matchingPhrases = new Set();

    resolved.positive.forEach(m => matchingPhrases.add(m.phrase.toLowerCase()));
    resolved.urgency.forEach(m => matchingPhrases.add(m.phrase.toLowerCase()));
    resolved.guardian.forEach(m => matchingPhrases.add(m.phrase.toLowerCase()));

    for (const [key, weight] of Object.entries(weights)) {
        if (matchingPhrases.has(key.toLowerCase()) && typeof weight === 'number') {
            priorityScore += weight;
        }
    }

    const appliedUrgencySignals = new Set();
    for (const match of resolved.urgency) {
        const configuredWeight = weights[match.phrase.toLowerCase()];
        const builtInWeight = BUILT_IN_URGENCY_WEIGHTS[match.signal];
        if (typeof configuredWeight === 'number' || typeof builtInWeight !== 'number') continue;
        if (appliedUrgencySignals.has(match.signal)) continue;
        priorityScore += builtInWeight;
        appliedUrgencySignals.add(match.signal);
    }

    /* Baseline logic — mimicking applyPolicy */
    if (priorityScore === 0 && tags.length > 0) {
        priorityScore = 5; /* Base score for valid categorization */
    }

    /* 3. Determine Disposition, Polarity, and Overrides */
    let leadDisposition = 'valid';
    let intentPolarity = 'positive';

    /* Override: Strong Junk */
    if (resolved.junk.length > 0) {
        leadDisposition = 'junk';
        intentPolarity = 'negative';
        priorityScore = 0;
        tags.length = 0;
    }
    /* Override: Wrong Fit (e.g. NEET on JEE center) suppresses admission */
    else if (resolved.wrongFit.length > 0) {
        leadDisposition = 'wrong_fit';
        intentPolarity = 'negative';
        priorityScore = 0;
        tags.length = 0;
        tags.push('WRONG_FIT');
    }
    /* Override: Explicit Negative Intent strongly suppresses / wipes */
    else if (resolved.negative.length > 0) {
        intentPolarity = 'negative';
        if (tags.length > 0) {
            /* Has surviving positives but also explicit negative (e.g. across different clauses) */
            leadDisposition = 'conflicting';
            priorityScore = Math.floor(priorityScore / 2); /* Suppress score */
        } else {
            /* Clear negative completely overrides */
            leadDisposition = 'not_interested';
            priorityScore = 0;
        }
    }
    /* Override: Vague / Weak hesitant intent ("maybe later", "just asking") */
    else if (resolved.vague.length > 0) {
        if (tags.length === 0) {
            leadDisposition = 'weak';
            intentPolarity = 'neutral';
        } else {
            leadDisposition = 'weak';
            intentPolarity = 'mixed';
            priorityScore = Math.floor(priorityScore / 2); /* Suppress priority for hesitant leads */
        }
    }
    /* Fallback: Empty tags when nothing else triggered */
    else if (tags.length === 0 && priorityScore === 0) {
        leadDisposition = 'weak';
        intentPolarity = 'neutral';
    }

    /* Handle confidence-based contradiction overrides */
    if (confidence.label === 'low' && confidence.reason.includes('contradictory')) {
        leadDisposition = 'conflicting';
        intentPolarity = 'mixed';
    }

    let priority = priorityScore >= 30 ? 'HIGH' : priorityScore >= 10 ? 'NORMAL' : 'LOW';

    /* 4. Determine LLM Fallback (Hybrid Mode) */
    let shouldUseLLMFallback = false;
    let fallbackReason = null;

    if (confidence.label === 'low') {
        shouldUseLLMFallback = true;
        fallbackReason = `Low confidence: ${confidence.reason}`;
    } else if (leadDisposition === 'conflicting') {
        shouldUseLLMFallback = true;
        fallbackReason = 'Conflicting signals require deep semantic resolution';
    }

    return {
        tags,
        priorityScore,
        priority,
        confidence: confidence.label,
        confidenceScore: confidence.score,
        intentPolarity,
        leadDisposition,
        matchedSignals: resolved,
        shouldUseLLMFallback,
        fallbackReason,
        explanation: confidence.reason,
    };
}

module.exports = { resolveFinal };
