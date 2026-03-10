'use strict';

const SP = require('./dictionaries/signalPatterns');
const HI = require('./dictionaries/hinglish');

/**
 * Layer 2 — Extract structured signals from normalized text.
 *
 * Matches patterns from built-in dictionaries AND config.classificationRules.
 * Returns raw (pre-negation) signal matches with positions for Layer 3.
 *
 * @param {string} text  Normalized message text
 * @param {object} config  AgentConfig (classificationRules, industry, etc.)
 * @returns {object} Signal map: { positive, negative, junk, guardian, urgency, channel, wrongFit, vague }
 */
function extractSignals(text, config) {
    if (!text) return emptySignals();

    const result = {
        positive: [],
        negative: [],
        junk: [],
        guardian: [],
        urgency: [],
        channel: [],
        wrongFit: [],
        vague: [],
    };

    /* ── Built-in patterns ───────────────────────────────────────────────── */
    matchAll(text, SP.POSITIVE, result.positive);
    matchAll(text, HI.HINGLISH_POSITIVE, result.positive);
    matchAll(text, SP.NEGATIVE, result.negative);
    matchAll(text, HI.HINGLISH_NEGATIVE, result.negative);
    matchAll(text, SP.JUNK, result.junk);
    matchAll(text, SP.GUARDIAN, result.guardian);
    matchAll(text, SP.URGENCY, result.urgency);
    matchAll(text, SP.CHANNEL, result.channel);
    matchAll(text, SP.VAGUE, result.vague);
    matchAll(text, HI.HINGLISH_VAGUE, result.vague);

    /* ── Wrong-fit (industry-specific) ───────────────────────────────────── */
    const industry = config?.industry || 'other';
    const wrongFitPatterns = SP.WRONG_FIT[industry] || [];
    matchAll(text, wrongFitPatterns, result.wrongFit);

    /* ── Config-defined keywords → additional positive signals ───────────── */
    const keywords = config?.classificationRules?.keywords;
    if (keywords && typeof keywords === 'object') {
        for (const [category, kws] of Object.entries(keywords)) {
            if (!Array.isArray(kws)) continue;
            const cfgPatterns = kws.map((k) => ({ p: k, s: category }));
            matchAll(text, cfgPatterns, result.positive);
        }
    }

    /* Deduplicate each family (same signal + overlapping position) */
    for (const family of Object.keys(result)) {
        result[family] = dedup(result[family]);
    }

    /* ── Gibberish / keyboard smash detection ────────────────────────────── */
    if (SP.KEYBOARD_SMASH_RE.test(text) || (SP.GIBBERISH_RE.test(text) && result.positive.length === 0)) {
        result.junk.push({ signal: 'GIBBERISH', phrase: text, position: 0 });
    }

    return result;
}

/* ── Internal helpers ──────────────────────────────────────────────────────── */

/**
 * Match all patterns against text, appending hits to the output array.
 * Sorts patterns longest-first so compound phrases match before substrings.
 * Enforces word boundaries to prevent 'hi' from matching inside 'abhi' or 'coaching'.
 */
function matchAll(text, patterns, out) {
    /* Sort longest-first (stable) */
    const sorted = [...patterns].sort((a, b) => b.p.length - a.p.length);

    for (const { p, s } of sorted) {
        const phrase = p.toLowerCase();
        let idx = text.indexOf(phrase);
        while (idx !== -1) {
            const before = idx > 0 ? text[idx - 1] : ' ';
            const after = idx + phrase.length < text.length ? text[idx + phrase.length] : ' ';

            const isWordStart = /[\s,.;!?"'()[\]{}]/.test(before);
            const isWordEnd = /[\s,.;!?"'()[\]{}]/.test(after);

            if (isWordStart && isWordEnd) {
                out.push({ signal: s, phrase: p, position: idx });
            }
            idx = text.indexOf(phrase, idx + phrase.length);
        }
    }
}

/** Remove duplicate signals at overlapping positions. */
function dedup(matches) {
    const seen = new Set();
    return matches.filter((m) => {
        const key = `${m.signal}@${m.position}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function emptySignals() {
    return { positive: [], negative: [], junk: [], guardian: [], urgency: [], channel: [], wrongFit: [], vague: [] };
}

module.exports = { extractSignals };
