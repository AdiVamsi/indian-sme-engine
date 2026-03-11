'use strict';

const { getAgentConfigPreset, getTestMessage } = require('../constants/agentConfig.presets');
const { prisma } = require('../lib/prisma');

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

    const business = await prisma.business.findUnique({
      where:  { id: businessId },
      select: { stage: true, industry: true },
    });

    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    if (business.stage !== 'STARTING') {
      return res.json({ alreadyActivated: true });
    }

    const preset = getAgentConfigPreset(business.industry);
    await prisma.agentConfig.upsert({
      where:  { businessId },
      update: preset,
      create: { businessId, ...preset },
    });

    return res.json({ testMessage: getTestMessage(business.industry) });
  } catch (err) {
    console.error('[Activation] activate failed:', err.message);
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

    const business = await prisma.business.findUnique({
      where:  { id: businessId },
      select: { stage: true, industry: true },
    });

    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    if (business.stage !== 'STARTING') {
      return res.json({ dismissed: true });
    }

    /* Ensure the right config is in place even if the test lead is never submitted */
    const preset = getAgentConfigPreset(business.industry);
    await prisma.agentConfig.upsert({
      where:  { businessId },
      update: preset,
      create: { businessId, ...preset },
    });

    return res.json({ dismissed: true });
  } catch (err) {
    console.error('[Activation] skip failed:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { activate, skip };
