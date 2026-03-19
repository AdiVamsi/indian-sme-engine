'use strict';

const { classify } = require('./classifier');
const { runLeadAutomations } = require('../services/automation.service');
const { getAgentConfigPreset } = require('../constants/agentConfig.presets');
const { prisma } = require('../lib/prisma');

/**
 * run — stateless entry point for AgentEngine.
 *
 * @param {{ type: string, leadId: string, businessId: string }} params
 * @returns {Promise<object>} structured result
 */
async function run({ type, leadId, businessId, source = 'web', externalMessageId = null, receivedAt = null }) {
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
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { name: true, industry: true },
  });

  if (!config) {
    const preset = getAgentConfigPreset(business?.industry || 'other');
    config = await prisma.agentConfig.create({
      data: { businessId, ...preset },
    });
  }

  /* 3. LLM classification */
  const intelligence = await classify({
    lead,
    business: {
      name: business?.name || 'Unknown business',
      industry: business?.industry || 'other',
    },
    config,
  });

  const bestCategory = intelligence.bestCategory || 'GENERAL_ENQUIRY';
  const confidenceLabel = intelligence.confidenceLabel;
  const confidenceScore = intelligence.confidenceScore;
  const priorityScore = intelligence.priorityScore;
  const tags = intelligence.tags;
  const via = intelligence.via;

  /* 4. Schedule follow-up using config.followUpMinutes. */
  const followUpAt = new Date(Date.now() + config.followUpMinutes * 60 * 1000);

  /* 5. Write LeadActivity rows atomically — all scoped to this leadId. */
  await prisma.$transaction([
    prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        type: 'AGENT_CLASSIFIED',
        message: `Lead classified as ${bestCategory} with tags: ${tags.length ? tags.join(', ') : 'none'} (Disposition: ${intelligence.disposition})`,
        metadata: {
          tags, bestCategory, confidenceLabel, confidenceScore, via,
          leadDisposition: intelligence.disposition,
          languageMode: intelligence.languageMode,
          suggestedNextAction: intelligence.suggestedNextAction,
          explanation: intelligence.reasoning,
          provider: intelligence.provider,
          model: intelligence.model,
          vertical: intelligence.vertical,
          promptKey: intelligence.promptKey,
          schemaVersion: intelligence.schemaVersion,
          rawOutput: intelligence.rawOutput,
          source,
          externalMessageId,
          receivedAt,
          correction: null,
        },
      },
    }),
    prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        type: 'AGENT_PRIORITIZED',
        message: `Priority score assigned: ${priorityScore} (${intelligence.priority})`,
        metadata: {
          priorityScore,
          priorityLabel: intelligence.priority,
          confidenceScore,
          leadDisposition: intelligence.disposition,
          source,
        },
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
          source,
        },
      },
    }),
  ]);

  /* 6. Run rule-based automations; failures are logged, never propagated. */
  let automationsTriggered = 0;
  let whatsappReplySent = false;
  let whatsappReplyFailed = false;
  let whatsappFailure = null;
  let whatsappFailureAt = null;
  let conversationState = null;
  try {
    const automationResult = await runLeadAutomations(lead.id, {
      businessId,
      businessName: business?.name || null,
      tags,
      intent: bestCategory,
      priorityScore,
      businessIndustry: business?.industry || 'other',
      source,
      phone: lead.phone,
      leadMessage: lead.message || '',
      confidenceLabel,
      leadDisposition: intelligence.disposition,
      agentConfig: config,
    });
    automationsTriggered = automationResult.triggered;
    whatsappReplySent = Boolean(automationResult.whatsappReplySent);
    whatsappReplyFailed = Boolean(automationResult.whatsappReplyFailed);
    whatsappFailure = automationResult.whatsappFailure || null;
    whatsappFailureAt = automationResult.whatsappFailureAt || null;
    conversationState = automationResult.conversationState || null;
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
    source,
    leadDisposition: intelligence.disposition,
    followUpAt: followUpAt.toISOString(),
    activitiesCreated: 3,
    automationsTriggered,
    whatsappReplySent,
    whatsappReplyFailed,
    whatsappFailure,
    whatsappFailureAt,
    conversationState,
  };
}

module.exports = { run };
