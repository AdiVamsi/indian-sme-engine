'use strict';

const SP = require('./dictionaries/signalPatterns');
const HI = require('./dictionaries/hinglish');

const CLAUSE_BREAK_RE = /[.!?;]+|\b(?:but|however|though|lekin|magar|par)\b/gi;
const FILLER_WORDS = ['a', 'an', 'the', 'to', 'for'];

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

    for (const clause of splitClauses(text)) {
        for (const { p, s } of sorted) {
            const regex = buildPatternRegex(p);
            if (!regex) continue;

            let match = regex.exec(clause.text);
            while (match) {
                out.push({
                    signal: s,
                    phrase: p,
                    position: clause.start + match.index,
                });
                match = regex.exec(clause.text);
            }
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

function splitClauses(text) {
    const clauses = [];
    let lastIndex = 0;
    let match;

    while ((match = CLAUSE_BREAK_RE.exec(text)) !== null) {
        pushClause(clauses, text, lastIndex, match.index);
        lastIndex = match.index + match[0].length;
    }

    pushClause(clauses, text, lastIndex, text.length);
    return clauses;
}

function pushClause(clauses, text, start, end) {
    const slice = text.slice(start, end);
    const trimmed = slice.trim();
    if (!trimmed) return;

    const leadingWs = slice.search(/\S/);
    clauses.push({
        text: trimmed,
        start: start + (leadingWs === -1 ? 0 : leadingWs),
    });
}

function buildPatternRegex(phrase) {
    const tokens = String(phrase ?? '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return null;

    const fillerGroup = FILLER_WORDS.map(escapeRegex).join('|');
    const joiner = tokens.length > 1
        ? `(?:\\s+(?:${fillerGroup}))*\\s+`
        : '';
    const pattern = tokens.map(escapeRegex).join(joiner);

    return new RegExp(`\\b${pattern}\\b`, 'gi');
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { extractSignals };
