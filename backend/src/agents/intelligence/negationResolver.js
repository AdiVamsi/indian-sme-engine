'use strict';

const { NEGATION_MARKERS, NEGATION_BREAKER_RE } = require('./dictionaries/signalPatterns');

/**
 * Layer 3 — Negation & Contradiction Resolution.
 *
 * 1. Splits the incoming text into functional clauses (separated by punctuation or "but", "lekin").
 * 2. If a clause contains explicit negative signals OR a negation marker, the entire clause is negated.
 * 3. Any positive signal positioned within a negated clause is explicitly cancelled.
 * 4. Checks for strong junk vetos.
 *
 * @param {string} text  Normalized message
 * @param {object} signals  Raw signals from Layer 2
 * @returns {object} { resolved, negatedPositives, junkVeto, hasContradiction }
 */
function resolveNegations(text, signals) {
    const negatedClauses = buildNegatedClauses(text, signals.negative);

    const negatedPositives = [];
    const survivingPositive = [];

    /* ── Check each positive signal against negated clauses ──────────── */
    for (const sig of signals.positive) {
        if (isPosWithinNegatedClause(sig.position, negatedClauses)) {
            negatedPositives.push(sig);
        } else {
            survivingPositive.push(sig);
        }
    }

    /* ── Junk veto: strong junk phrases can nullify everything ──────── */
    const STRONG_JUNK = ['WASTING_TIME', 'TIMEPASS', 'WRONG_NUMBER', 'SPAM', 'GIBBERISH',
        'JUNK_HI', 'ABUSE_HI'];
    const junkVeto = signals.junk.some((j) => STRONG_JUNK.includes(j.signal));

    /* ── Contradiction detection ────────────────────────────────────── */
    const hasExplicitNegative = signals.negative.length > 0;
    const hasContradiction =
        (survivingPositive.length > 0 && (hasExplicitNegative || negatedPositives.length > 0)) ||
        (survivingPositive.length > 0 && signals.junk.length > 0) ||
        (survivingPositive.length > 0 && signals.vague.some((v) =>
            ['MAYBE_LATER', 'NOT_SURE', 'UNDECIDED_HI', 'LATER_HI'].includes(v.signal)
        ));

    return {
        resolved: {
            positive: junkVeto ? [] : survivingPositive,
            negative: signals.negative,
            junk: signals.junk,
            guardian: signals.guardian,
            urgency: signals.urgency,
            channel: signals.channel,
            wrongFit: signals.wrongFit,
            vague: signals.vague,
        },
        negatedPositives,
        junkVeto,
        hasContradiction,
    };
}

/* ── Scope builder ─────────────────────────────────────────────────────────── */

function buildNegatedClauses(text, negativeSignals) {
    const negatedClauses = [];
    if (!text) return negatedClauses;

    /* 1. Identify clause boundaries */
    const breakers = [];
    let m;
    const re = new RegExp(NEGATION_BREAKER_RE.source, 'gi');
    while ((m = re.exec(text)) !== null) {
        breakers.push(m.index);
    }

    const clauses = [];
    let start = 0;
    for (const b of breakers) {
        clauses.push({ start, end: b });
        start = b + 1; /* Skip the breaker character itself in boundary checking */
    }
    clauses.push({ start, end: text.length });

    /* 2. Evaluate each clause for negations */
    for (const clause of clauses) {
        let isNegatedClause = false;

        /* A. If a negative signal originated inside this clause, it's negated */
        for (const neg of negativeSignals) {
            if (neg.position >= clause.start && neg.position <= clause.end) {
                isNegatedClause = true;
                break;
            }
        }

        /* B. If no explicit negative signal, check raw negation markers (word-boundary matched) */
        if (!isNegatedClause) {
            for (const marker of NEGATION_MARKERS) {
                const lower = marker.toLowerCase();
                let idx = text.indexOf(lower, clause.start);

                while (idx !== -1 && idx <= clause.end) {
                    const before = idx > 0 ? text[idx - 1] : ' ';
                    const after = idx + lower.length < text.length ? text[idx + lower.length] : ' ';

                    if (/[\s,.'"]/.test(before) || idx === 0) {
                        if (/[\s,.'"]/.test(after) || idx + lower.length === text.length) {
                            isNegatedClause = true;
                            break;
                        }
                    }
                    idx = text.indexOf(lower, idx + lower.length);
                }
                if (isNegatedClause) break;
            }
        }

        if (isNegatedClause) {
            negatedClauses.push(clause);
        }
    }

    return negatedClauses;
}

function isPosWithinNegatedClause(position, negatedClauses) {
    return negatedClauses.some((clause) => position >= clause.start && position <= clause.end);
}

module.exports = { resolveNegations };
