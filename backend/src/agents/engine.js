'use strict';

const { PrismaClient }        = require('@prisma/client');
const { applyPolicy }         = require('./policies/basicPolicy');
const { runLeadAutomations }  = require('../services/leadAutomation.service');

const prisma = new PrismaClient();

/*
 * DEFAULT_CONFIG — used when no AgentConfig row exists for a business yet.
 * JSONB fields match the exact shapes expected by applyPolicy.
 */
const DEFAULT_CONFIG = {
  toneStyle:    'professional',
  priorityRules: {
    weights: {
      urgent: 30,
      price:  10,
    },
  },
  classificationRules: {
    keywords: {
      DEMO_REQUEST: ['demo'],
      ADMISSION:    ['admission'],
    },
  },
  followUpMinutes:  30,
  autoReplyEnabled: false,
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

  /* 3. Config-driven classification and priority scoring.
   *    config.classificationRules and config.priorityRules are passed in
   *    so the policy reads from DB, not from hardcoded values. */
  const { priorityScore, tags } = applyPolicy(lead, config);

  /* 4. Schedule follow-up using config.followUpMinutes. */
  const followUpAt = new Date(Date.now() + config.followUpMinutes * 60 * 1000);

  /* 5. Write LeadActivity rows atomically — all scoped to this leadId. */
  await prisma.$transaction([
    prisma.leadActivity.create({
      data: {
        leadId:   lead.id,
        type:     'AGENT_CLASSIFIED',
        message:  `Lead classified with tags: ${tags.length ? tags.join(', ') : 'none'}`,
        metadata: { tags },
      },
    }),
    prisma.leadActivity.create({
      data: {
        leadId:   lead.id,
        type:     'AGENT_PRIORITIZED',
        message:  `Priority score assigned: ${priorityScore}`,
        metadata: { priorityScore },
      },
    }),
    prisma.leadActivity.create({
      data: {
        leadId:   lead.id,
        type:     'FOLLOW_UP_SCHEDULED',
        message:  `Follow-up scheduled in ${config.followUpMinutes} minutes`,
        metadata: {
          followUpAt:      followUpAt.toISOString(),
          followUpMinutes: config.followUpMinutes,
        },
      },
    }),
  ]);

  /* 6. Run rule-based automations; failures are logged, never propagated. */
  let automationsTriggered = 0;
  try {
    const automationResult = await runLeadAutomations(lead.id, { tags, priorityScore });
    automationsTriggered   = automationResult.triggered;
    console.log(`[AgentEngine] Automations triggered for lead ${lead.id}: ${automationsTriggered}`);
  } catch (err) {
    console.error(`[AgentEngine] runLeadAutomations failed for lead ${lead.id} —`, err.message);
  }

  /* 7. Return structured result — Lead table is NOT mutated. */
  return {
    leadId:               lead.id,
    businessId,
    priorityScore,
    tags,
    followUpAt:           followUpAt.toISOString(),
    activitiesCreated:    3,
    automationsTriggered,
  };
}

module.exports = { run };
