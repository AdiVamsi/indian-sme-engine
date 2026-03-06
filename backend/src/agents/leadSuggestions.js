'use strict';

/**
 * getLeadSuggestions
 *
 * Pure, deterministic rule engine — no DB calls, no side effects.
 * Accepts an enriched lead object (with `tags`, `priorityScore`, `activities`).
 *
 * @param {object} lead
 * @returns {Array<{ action: string, label: string, reason: string, confidence: number }>}
 */
function getLeadSuggestions(lead) {
  const suggestions   = [];
  const status        = lead.status        ?? 'NEW';
  const priorityScore = lead.priorityScore ?? 0;
  const tags          = Array.isArray(lead.tags) ? lead.tags : [];
  const activities    = Array.isArray(lead.activities) ? lead.activities : [];

  /* How long since the most recent activity? */
  const lastActivity = activities.length
    ? activities.reduce((latest, a) =>
        new Date(a.createdAt) > new Date(latest.createdAt) ? a : latest
      )
    : null;

  const hoursSinceLast = lastActivity
    ? (Date.now() - new Date(lastActivity.createdAt).getTime()) / 3_600_000
    : null;

  /* ── Rule 1: High score + NEW → call immediately ───────────────────── */
  if (priorityScore >= 30 && status === 'NEW') {
    suggestions.push({
      action:     'CALL_NOW',
      label:      'Call immediately',
      reason:     `High priority score (${priorityScore}) — this lead needs immediate attention.`,
      confidence: Math.min(0.97, 0.60 + priorityScore / 100),
    });
  }

  /* ── Rule 2: DEMO_REQUEST tag → send demo link ──────────────────────── */
  if (tags.includes('DEMO_REQUEST')) {
    suggestions.push({
      action:     'SEND_DEMO_LINK',
      label:      'Send demo link',
      reason:     'Lead explicitly requested a product demo.',
      confidence: 0.92,
    });
  }

  /* ── Rule 3: CONTACTED + no activity > 24 h → follow up ────────────── */
  if (status === 'CONTACTED' && hoursSinceLast !== null && hoursSinceLast > 24) {
    suggestions.push({
      action:     'FOLLOW_UP',
      label:      'Send a follow-up',
      reason:     `No activity in ${Math.floor(hoursSinceLast)} hours — time to follow up.`,
      confidence: 0.85,
    });
  }

  /* ── Rule 4: ADMISSION tag → send admission details ────────────────── */
  if (tags.includes('ADMISSION')) {
    suggestions.push({
      action:     'SEND_ADMISSION_DETAILS',
      label:      'Send admission details',
      reason:     'Lead is interested in admission — share the brochure or form.',
      confidence: 0.90,
    });
  }

  /* Sort by confidence descending so highest-confidence action appears first */
  suggestions.sort((a, b) => b.confidence - a.confidence);

  return suggestions;
}

module.exports = { getLeadSuggestions };
