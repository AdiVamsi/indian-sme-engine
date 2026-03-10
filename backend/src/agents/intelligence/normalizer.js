'use strict';

const { SPELLING, REPEATED_CHAR_RE } = require('./dictionaries/normalization');

/**
 * Layer 1 — Normalize incoming message text.
 *
 * Steps:
 *  1. Lowercase
 *  2. Collapse whitespace
 *  3. Trim
 *  4. Collapse repeated characters (3+ → 2)
 *  5. Apply spelling / phonetic corrections
 *
 * @param {string|null|undefined} raw
 * @returns {{ normalized: string, corrections: string[] }}
 */
function normalize(raw) {
    if (!raw || typeof raw !== 'string') {
        return { normalized: '', corrections: [] };
    }

    const corrections = [];

    /* 1-3. Lowercase, whitespace collapse, trim */
    let text = raw.toLowerCase().replace(/\s+/g, ' ').trim();

    /* 4. Collapse repeated characters: "feeeees" → "fees" */
    text = text.replace(REPEATED_CHAR_RE, '$1$1');

    /* 5. Spelling / phonetic corrections (word-level) */
    const words = text.split(/\s+/);
    const corrected = words.map((w) => {
        /* Strip trailing punctuation for lookup, re-attach after */
        const match = w.match(/^([a-z]+)([^a-z]*)$/);
        if (!match) return w;
        const [, core, punct] = match;
        if (SPELLING[core]) {
            corrections.push(`${core} → ${SPELLING[core]}`);
            return SPELLING[core] + punct;
        }
        return w;
    });

    return { normalized: corrected.join(' '), corrections };
}

module.exports = { normalize };
