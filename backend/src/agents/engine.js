'use strict';

const { PrismaClient } = require('@prisma/client');
const { applyBasicPolicy } = require('./policies/basicPolicy');

const prisma = new PrismaClient();

/* Default AgentConfig values used when no config exists for the business yet. */
const DEFAULT_CONFIG = {
  toneStyle:           'professional',
  priorityRules:       [],
  classificationRules: [],
  followUpMinutes:     30,
  autoReplyEnabled:    false,
};

/**
 * run — stateless entry point for AgentEngine.
 *
 * @param {{ type: string, leadId: string, businessId: string }} params
 * @returns {Promise<object>} structured result
 */
async function run({ type, leadId, businessId }) {
  if (type !== 'LEAD_CREATED') {
    return { skipped: true, reason: `Unhandled event type: ${type}` };
  }

  /* 1. Fetch lead — scoped by businessId to prevent cross-tenant access. */
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, businessId },
  });

  if (!lead) {
    throw new Error(`[AgentEngine] Lead ${leadId} not found for business ${businessId}`);
  }

  /* 2. Fetch AgentConfig; create default if none exists. */
  let config = await prisma.agentConfig.findUnique({
    where: { businessId },
  });

  if (!config) {
    config = await prisma.agentConfig.create({
      data: { businessId, ...DEFAULT_CONFIG },
    });
  }

  /* 3. Deterministic classification via policy — no mutation, no LLM. */
  const { priorityScore, tags } = applyBasicPolicy(lead);

  /* 4. Schedule follow-up timestamp. */
  const followUpAt = new Date(Date.now() + config.followUpMinutes * 60 * 1000);

  /* 5. Write LeadActivity rows atomically.
   *    Three entries per LEAD_CREATED event — all scoped to this leadId. */
  await prisma.$transaction([
    prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        type:    'AGENT_CLASSIFIED',
        message: `Lead classified with tags: ${tags.length ? tags.join(', ') : 'none'}`,
        metadata: { tags },
      },
    }),
    prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        type:    'AGENT_PRIORITIZED',
        message: `Priority score assigned: ${priorityScore}`,
        metadata: { priorityScore },
      },
    }),
    prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        type:    'FOLLOW_UP_SCHEDULED',
        message: `Follow-up scheduled in ${config.followUpMinutes} minutes`,
        metadata: {
          followUpAt:     followUpAt.toISOString(),
          followUpMinutes: config.followUpMinutes,
        },
      },
    }),
  ]);

  /* 6. Return structured result — lead table is NOT mutated. */
  return {
    leadId:            lead.id,
    businessId,
    priorityScore,
    tags,
    followUpAt:        followUpAt.toISOString(),
    activitiesCreated: 3,
  };
}

module.exports = { run };
