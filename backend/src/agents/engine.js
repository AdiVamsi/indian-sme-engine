'use strict';

const { PrismaClient } = require('@prisma/client');
const { analyzeMessage } = require('./intelligence');
const { classifyWithModel } = require('./modelClassifier');
const { runLeadAutomations } = require('../services/leadAutomation.service');
const { getAgentConfigPreset } = require('../constants/agentConfig.presets');

const prisma = new PrismaClient();
const CLASSIFIER_MODE = (process.env.CLASSIFIER_MODE || 'rule_only').toLowerCase();

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

  /* 2. Fetch AgentConfig; create industry-aware default if none exists. */
  let config = await prisma.agentConfig.findUnique({
    where: { businessId },
  });

  if (!config) {
    const biz = await prisma.business.findUnique({
      where: { id: businessId },
      select: { industry: true },
    });
    const preset = getAgentConfigPreset(biz?.industry || 'other');
    config = await prisma.agentConfig.create({
      data: { businessId, ...preset },
    });
  }

  /* 3. Local Intelligence Engine */
  const intelligence = analyzeMessage(lead.message || '', config);

  let bestCategory = intelligence.tags[0] || 'GENERAL_ENQUIRY';
  let confidenceLabel = intelligence.confidence;
  let confidenceScore = intelligence.confidenceScore;
  let priorityScore = intelligence.priorityScore;
  let tags = intelligence.tags;
  let via = 'local_intelligence';

  /* 3b. Optional LLM Fallback (Hybrid Mode) */
  if (intelligence.shouldUseLLMFallback && CLASSIFIER_MODE === 'hybrid') {
    try {
      const allowedCategories = config.classificationRules ? Object.keys(config.classificationRules.keywords) : [];
      if (allowedCategories.length > 0) {
        const modelResult = await classifyWithModel({
          message: lead.message || '',
          categories: allowedCategories,
        });
        if (modelResult) {
          bestCategory = modelResult.bestCategory;
          confidenceLabel = modelResult.confidenceLabel;
          confidenceScore = modelResult.confidenceScore;
          via = 'hybrid_fallback';
        }
      }
    } catch (err) {
      console.error(`[AgentEngine] LLM fallback failed for lead ${lead.id}:`, err.message);
    }
  }

  /* 4. Schedule follow-up using config.followUpMinutes. */
  const followUpAt = new Date(Date.now() + config.followUpMinutes * 60 * 1000);

  /* 5. Write LeadActivity rows atomically — all scoped to this leadId. */
  await prisma.$transaction([
    prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        type: 'AGENT_CLASSIFIED',
        message: `Lead classified with tags: ${tags.length ? tags.join(', ') : 'none'} (Disposition: ${intelligence.leadDisposition})`,
        metadata: {
          tags, bestCategory, confidenceLabel, confidenceScore, via,
          intentPolarity: intelligence.intentPolarity,
          leadDisposition: intelligence.leadDisposition,
          explanation: intelligence.explanation
        },
      },
    }),
    prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        type: 'AGENT_PRIORITIZED',
        message: `Priority score assigned: ${priorityScore} (${intelligence.priority})`,
        metadata: { priorityScore, priorityLabel: intelligence.priority },
      },
    }),
    prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        type: 'FOLLOW_UP_SCHEDULED',
        message: `Follow-up scheduled in ${config.followUpMinutes} minutes`,
        metadata: {
          followUpAt: followUpAt.toISOString(),
          followUpMinutes: config.followUpMinutes,
        },
      },
    }),
  ]);

  /* 6. Run rule-based automations; failures are logged, never propagated. */
  let automationsTriggered = 0;
  try {
    const automationResult = await runLeadAutomations(lead.id, { tags, priorityScore });
    automationsTriggered = automationResult.triggered;
    console.log(`[AgentEngine] Automations triggered for lead ${lead.id}: ${automationsTriggered}`);
  } catch (err) {
    console.error(`[AgentEngine] runLeadAutomations failed for lead ${lead.id} —`, err.message);
  }

  /* 7. Return structured result — Lead table is NOT mutated. */
  return {
    leadId: lead.id,
    businessId,
    priorityScore,
    priority: intelligence.priority,
    tags,
    leadDisposition: intelligence.leadDisposition,
    followUpAt: followUpAt.toISOString(),
    activitiesCreated: 3,
    automationsTriggered,
  };
}

module.exports = { run };
