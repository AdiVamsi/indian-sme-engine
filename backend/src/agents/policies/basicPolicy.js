'use strict';

/**
 * applyBasicPolicy — pure, deterministic, no DB side effects.
 *
 * Rules:
 *   Priority scoring:
 *     message contains "urgent"  → +30
 *     message contains "price"   → +10
 *     message.length > 100       → +5
 *
 *   Classification tags:
 *     message contains "demo"      → DEMO_REQUEST
 *     message contains "admission" → ADMISSION
 *
 * @param {object} lead — Prisma Lead row
 * @returns {{ priorityScore: number, tags: string[] }}
 */
function applyBasicPolicy(lead) {
  const message = (lead.message || '').toLowerCase();

  let priorityScore = 0;
  const tags = [];

  /* ── Priority scoring ── */
  if (message.includes('urgent'))    priorityScore += 30;
  if (message.includes('price'))     priorityScore += 10;
  if (message.length > 100)          priorityScore += 5;

  /* ── Classification tags ── */
  if (message.includes('demo'))      tags.push('DEMO_REQUEST');
  if (message.includes('admission')) tags.push('ADMISSION');

  return { priorityScore, tags };
}

module.exports = { applyBasicPolicy };
