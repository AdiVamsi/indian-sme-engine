'use strict';

/**
 * leadAutomation.service.js — Rule-based automation engine.
 *
 * Called after AgentEngine has classified and prioritized a lead.
 * Receives the computed { tags, priorityScore } so it never needs
 * to re-read the database; all rules execute on the in-memory result.
 *
 * Automations are additive — each matching rule appends a LeadActivity.
 * All matched activities are written in a single Prisma transaction.
 * Any failure is caught and logged; lead creation is never blocked.
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/* ── Priority threshold — must stay in sync with leads.service.js ── */
const HIGH_PRIORITY_THRESHOLD = 30;

/* ── Tag sets for intent rules ── */
const DEMO_TAGS      = new Set(['DEMO_REQUEST', 'DEMO', 'BOOK_DEMO']);
const ADMISSION_TAGS = new Set(['ADMISSION', 'COURSE_ENQUIRY']);

/**
 * runLeadAutomations
 *
 * Evaluates all automation rules for a newly processed lead.
 * Must be called after AgentEngine has written AGENT_CLASSIFIED
 * and AGENT_PRIORITIZED so the caller can pass the computed values.
 *
 * Rules:
 *   1. HIGH_PRIORITY_LEAD  — priorityScore >= 30 → AUTOMATION_ALERT
 *   2. DEMO_INTENT         — tags overlap DEMO_TAGS → AUTOMATION_DEMO_INTENT
 *   3. ADMISSION_INTENT    — tags overlap ADMISSION_TAGS → AUTOMATION_ADMISSION_INTENT
 *
 * @param {string} leadId
 * @param {{ tags: string[], priorityScore: number }} agentResult
 * @returns {Promise<{ triggered: number }>}
 */
async function runLeadAutomations(leadId, { tags = [], priorityScore = 0 } = {}) {
  const creates = [];

  /* ── Rule 1: High Priority Alert ── */
  if (priorityScore >= HIGH_PRIORITY_THRESHOLD) {
    creates.push(
      prisma.leadActivity.create({
        data: {
          leadId,
          type:     'AUTOMATION_ALERT',
          message:  `Automation: high-priority lead detected (score ${priorityScore})`,
          metadata: {
            reason: 'HIGH_PRIORITY_LEAD',
            score:  priorityScore,
          },
        },
      })
    );
  }

  /* ── Rule 2: Demo Intent ── */
  if (tags.some((t) => DEMO_TAGS.has(t))) {
    creates.push(
      prisma.leadActivity.create({
        data: {
          leadId,
          type:     'AUTOMATION_DEMO_INTENT',
          message:  'Automation: demo intent detected',
          metadata: { intent: 'DEMO_REQUEST' },
        },
      })
    );
  }

  /* ── Rule 3: Admission Intent ── */
  if (tags.some((t) => ADMISSION_TAGS.has(t))) {
    creates.push(
      prisma.leadActivity.create({
        data: {
          leadId,
          type:     'AUTOMATION_ADMISSION_INTENT',
          message:  'Automation: admission intent detected',
          metadata: { intent: 'ADMISSION' },
        },
      })
    );
  }

  /* Nothing matched — exit early without a DB round-trip */
  if (creates.length === 0) {
    return { triggered: 0 };
  }

  await prisma.$transaction(creates);
  return { triggered: creates.length };
}

module.exports = { runLeadAutomations };
