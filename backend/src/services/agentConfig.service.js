'use strict';

const { PrismaClient } = require('@prisma/client');
const { getAgentConfigPreset } = require('../constants/agentConfig.presets');

const prisma = new PrismaClient();

/**
 * Fetch AgentConfig for a business. Creates one with industry-aware defaults
 * if missing. Always scoped by businessId.
 */
const getOrCreate = async (businessId) => {
  let config = await prisma.agentConfig.findUnique({ where: { businessId } });
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
  return config;
};

/**
 * Update editable fields of AgentConfig for a business.
 * Uses upsert so it is safe whether or not the row exists yet.
 * Always scoped by businessId.
 */
const update = async (businessId, { followUpMinutes, classificationRules, priorityRules }) => {
  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: { industry: true },
  });
  const preset = getAgentConfigPreset(biz?.industry || 'other');
  return prisma.agentConfig.upsert({
    where: { businessId },
    create: { businessId, ...preset, followUpMinutes, classificationRules, priorityRules },
    update: { followUpMinutes, classificationRules, priorityRules },
  });
};

module.exports = { getOrCreate, update };
