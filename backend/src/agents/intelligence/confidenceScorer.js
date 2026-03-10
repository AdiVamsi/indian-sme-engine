'use strict';

/**
 * Layer 4 — Local Confidence Scoring.
 *
 * Evaluates the reliability of the local resolution based on signal presence,
 * contradictions, and msg length. Returns confidence label/score and a reason.
 *
 * @param {object} resolved  Resolved signals from Layer 3
 * @param {string} text      Normalized text
 * @param {boolean} hasContradiction
 * @param {boolean} junkVeto
 * @returns {object} { label: 'high'|'medium'|'low', score: number, reason: string }
 */
function scoreConfidence(resolved, text, hasContradiction, junkVeto) {
    let score = 1.0;
    const reasons = [];

    const positiveCount = resolved.positive.length;
    const wordCount = text.split(/\s+/).length;

    /* 1. Explicit Contradiction / Mixed signals */
    if (hasContradiction) {
        score *= 0.4;
        reasons.push('contradictory or mixed signals detected');
    }

    /* 2. Strong Junk Vetos */
    if (junkVeto) {
        /* If it's a clear strong junk like "wasting your time", confidence is actually high that it IS junk */
        if (positiveCount === 0) {
            score = 0.95;
            reasons.push('clear junk/spam pattern');
        } else {
            /* If there were positive keywords but strong junk vetoed them, we are medium-low confident */
            score *= 0.5;
            reasons.push('positive signals vetoed by strong junk phrase');
        }
    }

    /* 3. Empty or very short messages */
    if (wordCount === 0) {
        return { label: 'low', score: 0.0, reason: 'empty message' };
    }
    if (wordCount <= 2 && positiveCount === 0 && resolved.junk.length === 0) {
        score *= 0.5;
        reasons.push('very short message with no strong signals');
    }

    /* 4. Wrong-fit signals */
    if (resolved.wrongFit.length > 0) {
        if (positiveCount > 0) {
            score *= 0.6;
            reasons.push('wrong-fit signals mixed with positive intent');
        } else {
            score = 0.9;
            reasons.push('clear wrong-fit pattern');
        }
    }

    /* 5. Vague but valid */
    if (positiveCount === 0 && resolved.vague.length > 0 && !hasContradiction && !junkVeto) {
        score *= 0.7;
        reasons.push('vague enquiry without specific intent');
    }

    /* 6. Clean Explicit Negative */
    if (positiveCount === 0 && resolved.negative.length > 0 && !junkVeto) {
        score = 0.9;
        reasons.push('clear explicit negative intent');
    }

    /* 7. High competing categories */
    const categoryCounts = {};
    resolved.positive.forEach((m) => {
        categoryCounts[m.signal] = (categoryCounts[m.signal] || 0) + 1;
    });
    const numCategories = Object.keys(categoryCounts).length;
    if (numCategories > 3) {
        score *= 0.8;
        reasons.push('many competing positive categories');
    }

    /* 8. Good clean positive match */
    if (positiveCount >= 1 && !hasContradiction && !junkVeto && resolved.wrongFit.length === 0) {
        /* Baseline 0.9 for standard positive, bump to 0.95+ if multiple consistent matches */
        score = positiveCount >= 2 ? Math.min(score * 1.1, 1.0) : Math.min(score, 0.9);
        if (!reasons.length) reasons.push('clear positive intent match');
    } else if (reasons.length === 0) {
        score = 0.5;
        reasons.push('no clear signals extracted');
    }

    /* Determine label */
    let label = 'low';
    if (score >= 0.85) label = 'high';
    else if (score >= 0.6) label = 'medium';

    return {
        label,
        score: Math.round(score * 100) / 100,
        reason: reasons.join(', ') || 'unknown',
    };
}

module.exports = { scoreConfidence };
