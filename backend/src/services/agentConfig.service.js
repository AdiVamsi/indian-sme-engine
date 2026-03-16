'use strict';

const { getAgentConfigPreset } = require('../constants/agentConfig.presets');
const { prisma } = require('../lib/prisma');
const { resolveWhatsAppReplyConfig } = require('./whatsappReplyConfig.service');

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

const getResolved = async (businessId) => {
  const config = await getOrCreate(businessId);
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { industry: true },
  });
  const industry = business?.industry || 'other';
  const preset = getAgentConfigPreset(industry);

  return {
    config,
    industry,
    preset,
    whatsappReplyPreset: preset?.classificationRules?.whatsappReplyConfig || {},
    whatsappReplyConfig: resolveWhatsAppReplyConfig({
      businessIndustry: industry,
      agentConfig: config,
    }),
  };
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
  const existing = await prisma.agentConfig.findUnique({ where: { businessId } });
  const nextFollowUpMinutes = followUpMinutes !== undefined
    ? followUpMinutes
    : existing?.followUpMinutes ?? preset.followUpMinutes;
  const nextClassificationRules = classificationRules !== undefined
    ? {
        ...(existing?.classificationRules ?? preset.classificationRules),
        ...classificationRules,
        keywords: classificationRules.keywords
          ?? existing?.classificationRules?.keywords
          ?? preset.classificationRules.keywords,
        whatsappReplyConfig: classificationRules.whatsappReplyConfig
          ?? existing?.classificationRules?.whatsappReplyConfig
          ?? preset.classificationRules.whatsappReplyConfig,
      }
    : existing?.classificationRules ?? preset.classificationRules;
  const nextPriorityRules = priorityRules !== undefined
    ? {
        ...(existing?.priorityRules ?? preset.priorityRules),
        ...priorityRules,
        weights: priorityRules.weights
          ?? existing?.priorityRules?.weights
          ?? preset.priorityRules.weights,
      }
    : existing?.priorityRules ?? preset.priorityRules;

  return prisma.agentConfig.upsert({
    where: { businessId },
    create: {
      businessId,
      ...preset,
      followUpMinutes: nextFollowUpMinutes,
      classificationRules: nextClassificationRules,
      priorityRules: nextPriorityRules,
    },
    update: {
      followUpMinutes: nextFollowUpMinutes,
      classificationRules: nextClassificationRules,
      priorityRules: nextPriorityRules,
    },
  });
};

module.exports = { getOrCreate, getResolved, update };
