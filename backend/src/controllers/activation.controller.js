'use strict';

const { z } = require('zod');

const { getAgentConfigPreset, getTestMessage } = require('../constants/agentConfig.presets');
const { prisma } = require('../lib/prisma');
const { createLead, getLeadActivity } = require('../services/leads.service');

const activationProofSchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

async function getBusinessForActivation(businessId) {
  return prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, stage: true, industry: true },
  });
}

async function ensureAgentConfig(businessId, industry) {
  const preset = getAgentConfigPreset(industry);
  await prisma.agentConfig.upsert({
    where: { businessId },
    update: preset,
    create: { businessId, ...preset },
  });
}

/**
 * POST /api/admin/activate
 *
 * First-run setup: upserts an industry-specific AgentConfig.
 * Does NOT advance business.stage — that happens when the first lead
 * runs through the agent engine successfully.
 *
 * Idempotent: safe to call multiple times. Returns { alreadyActivated: true }
 * when the business has already moved past STARTING.
 */
const activate = async (req, res) => {
  try {
    const businessId = req.user.businessId;
    const business = await getBusinessForActivation(businessId);

    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    if (business.stage !== 'STARTING') {
      return res.json({ alreadyActivated: true });
    }

    await ensureAgentConfig(businessId, business.industry);

    return res.json({ testMessage: getTestMessage(business.industry) });
  } catch (err) {
    console.error('[Activation] activate failed:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * POST /api/admin/activate/proof
 *
 * Runs the real lead pipeline using an internal activation-test lead so the
 * tenant can see classification/prioritization proof without polluting
 * operational lead surfaces or analytics.
 */
const runProof = async (req, res) => {
  const parsed = activationProofSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const businessId = req.user.businessId;
    const business = await getBusinessForActivation(businessId);

    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    if (business.stage !== 'STARTING') {
      return res.json({ alreadyActivated: true });
    }

    await ensureAgentConfig(businessId, business.industry);

    const lead = await createLead(businessId, {
      name: 'Activation Proof Lead',
      phone: '+91 00000 00000',
      message: parsed.data.message,
      isActivationTest: true,
      source: 'web',
    });

    const activity = await getLeadActivity(lead.id, businessId, { includeActivationTest: true });
    const classified = activity?.activities?.find((item) => item.type === 'AGENT_CLASSIFIED');
    const prioritized = activity?.activities?.find((item) => item.type === 'AGENT_PRIORITIZED');

    return res.json({
      leadId: lead.id,
      bestCategory: classified?.metadata?.bestCategory || null,
      tags: Array.isArray(classified?.metadata?.tags) ? classified.metadata.tags : [],
      via: classified?.metadata?.via || null,
      priorityScore: prioritized?.metadata?.priorityScore ?? 0,
    });
  } catch (err) {
    console.error('[Activation] runProof failed:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * POST /api/admin/activate/skip
 *
 * Dismisses the activation overlay without advancing stage.
 * Still upserts the AgentConfig so real leads that arrive later
 * will be classified correctly by the industry-specific rules.
 */
const skip = async (req, res) => {
  try {
    const businessId = req.user.businessId;
    const business = await getBusinessForActivation(businessId);

    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    if (business.stage !== 'STARTING') {
      return res.json({ dismissed: true });
    }

    await ensureAgentConfig(businessId, business.industry);

    return res.json({ dismissed: true });
  } catch (err) {
    console.error('[Activation] skip failed:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { activate, runProof, skip };
