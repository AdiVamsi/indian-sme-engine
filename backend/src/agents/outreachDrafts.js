'use strict';

/**
 * getOutreachDraft
 *
 * Pure, deterministic rule engine — no DB calls, no side effects.
 * Accepts an enriched lead object (with `tags`, `priorityScore`, `activities`).
 *
 * Rules are evaluated in priority order; the first matching rule wins.
 *
 * @param {object} lead
 * @returns {{ type: string, message: string, confidence: number }}
 */
function getOutreachDraft(lead) {
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

  /* ── Rule 1: DEMO_REQUEST → DEMO_REPLY ──────────────────────────────── */
  if (tags.includes('DEMO_REQUEST')) {
    return {
      type:       'DEMO_REPLY',
      message:    "Hi! Thanks for requesting a demo. I'd be happy to show you how this works. Let me know a convenient time or you can book a slot here.",
      confidence: 0.92,
    };
  }

  /* ── Rule 2: ADMISSION → ADMISSION_REPLY ────────────────────────────── */
  if (tags.includes('ADMISSION')) {
    return {
      type:       'ADMISSION_REPLY',
      message:    "Hi! Thanks for your enquiry about admissions. Seats are currently available for the upcoming batch. Would you like me to share details or schedule a quick call?",
      confidence: 0.90,
    };
  }

  /* ── Rule 3: High score + NEW → URGENT_REPLY ────────────────────────── */
  if (priorityScore >= 30 && status === 'NEW') {
    return {
      type:       'URGENT_REPLY',
      message:    "Hi! I saw your enquiry and wanted to reach out quickly. I'd be happy to help. Would you like to jump on a quick call?",
      confidence: 0.88,
    };
  }

  /* ── Rule 4: CONTACTED + no activity > 24 h → FOLLOW_UP ────────────── */
  if (status === 'CONTACTED' && hoursSinceLast !== null && hoursSinceLast > 24) {
    return {
      type:       'FOLLOW_UP',
      message:    "Hi! Just following up on my previous message. Let me know if you're still interested or if you have any questions.",
      confidence: 0.85,
    };
  }

  /* ── Rule 5: Fallback → GENERAL_REPLY ──────────────────────────────── */
  return {
    type:       'GENERAL_REPLY',
    message:    "Hi! Thanks for reaching out. I'd be happy to help. Let me know how I can assist you.",
    confidence: 0.70,
  };
}

module.exports = { getOutreachDraft };
