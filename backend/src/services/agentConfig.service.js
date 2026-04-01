'use strict';

const { getAgentConfigPreset } = require('../constants/agentConfig.presets');
const { prisma } = require('../lib/prisma');
const { normalizeBusinessKnowledgeConfig, resolveBusinessKnowledge } = require('./businessKnowledge.service');
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
    select: { industry: true, name: true },
  });
  const industry = business?.industry || 'other';
  const preset = getAgentConfigPreset(industry);
  const businessKnowledgePreset = resolveBusinessKnowledge({
    businessIndustry: industry,
    agentConfig: null,
  });
  const businessKnowledgeConfig = resolveBusinessKnowledge({
    businessIndustry: industry,
    agentConfig: config,
  });
  const businessKnowledgeUsesPreset = JSON.stringify(businessKnowledgeConfig) === JSON.stringify(businessKnowledgePreset);

  return {
    config,
    industry,
    businessName: business?.name || 'This business',
    preset,
    whatsappReplyPreset: preset?.classificationRules?.whatsappReplyConfig || {},
    whatsappReplyConfig: resolveWhatsAppReplyConfig({
      businessIndustry: industry,
      agentConfig: config,
    }),
    businessKnowledgePreset,
    businessKnowledgeConfig,
    businessKnowledgeUsesPreset,
  };
};

/**
 * Update editable fields of AgentConfig for a business.
 * Uses upsert so it is safe whether or not the row exists yet.
 * Always scoped by businessId.
 */
const update = async (businessId, {
  followUpMinutes,
  classificationRules,
  priorityRules,
  autoReplyEnabled,
}) => {
  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: { industry: true },
  });
  const preset = getAgentConfigPreset(biz?.industry || 'other');
  const existing = await prisma.agentConfig.findUnique({ where: { businessId } });
  const nextFollowUpMinutes = followUpMinutes !== undefined
    ? followUpMinutes
    : existing?.followUpMinutes ?? preset.followUpMinutes;
  const baseClassificationRules = existing?.classificationRules ?? preset.classificationRules;
  let nextClassificationRules = classificationRules !== undefined
    ? {
        ...baseClassificationRules,
        ...classificationRules,
        keywords: classificationRules.keywords
          ?? baseClassificationRules.keywords
          ?? preset.classificationRules.keywords,
        whatsappReplyConfig: classificationRules.whatsappReplyConfig
          ?? baseClassificationRules.whatsappReplyConfig
          ?? preset.classificationRules.whatsappReplyConfig,
      }
    : baseClassificationRules;

  if (classificationRules !== undefined) {
    if (classificationRules.businessKnowledge === null) {
      const { businessKnowledge: _discarded, ...rest } = nextClassificationRules;
      nextClassificationRules = rest;
    } else if (classificationRules.businessKnowledge !== undefined) {
      nextClassificationRules = {
        ...nextClassificationRules,
        businessKnowledge: normalizeBusinessKnowledgeConfig(classificationRules.businessKnowledge),
      };
    }
  }
  const nextPriorityRules = priorityRules !== undefined
    ? {
        ...(existing?.priorityRules ?? preset.priorityRules),
        ...priorityRules,
        weights: priorityRules.weights
          ?? existing?.priorityRules?.weights
          ?? preset.priorityRules.weights,
      }
    : existing?.priorityRules ?? preset.priorityRules;
  const nextAutoReplyEnabled = autoReplyEnabled !== undefined
    ? autoReplyEnabled
    : existing?.autoReplyEnabled ?? preset.autoReplyEnabled;

  return prisma.agentConfig.upsert({
    where: { businessId },
    create: {
      businessId,
      ...preset,
      followUpMinutes: nextFollowUpMinutes,
      classificationRules: nextClassificationRules,
      priorityRules: nextPriorityRules,
      autoReplyEnabled: nextAutoReplyEnabled,
    },
    update: {
      followUpMinutes: nextFollowUpMinutes,
      classificationRules: nextClassificationRules,
      priorityRules: nextPriorityRules,
      autoReplyEnabled: nextAutoReplyEnabled,
    },
  });
};

module.exports = { getOrCreate, getResolved, update };
