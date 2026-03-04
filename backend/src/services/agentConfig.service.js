'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/* Mirrors DEFAULT_CONFIG in engine.js — source of truth for new rows. */
const DEFAULT_CONFIG = {
  toneStyle:           'professional',
  priorityRules:       { weights: { urgent: 30, price: 10 } },
  classificationRules: { keywords: { DEMO_REQUEST: ['demo'], ADMISSION: ['admission'] } },
  followUpMinutes:     30,
  autoReplyEnabled:    false,
};

/**
 * Fetch AgentConfig for a business. Creates one with defaults if missing.
 * Always scoped by businessId.
 */
const getOrCreate = async (businessId) => {
  let config = await prisma.agentConfig.findUnique({ where: { businessId } });
  if (!config) {
    config = await prisma.agentConfig.create({
      data: { businessId, ...DEFAULT_CONFIG },
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
  return prisma.agentConfig.upsert({
    where:  { businessId },
    create: { businessId, ...DEFAULT_CONFIG, followUpMinutes, classificationRules, priorityRules },
    update: { followUpMinutes, classificationRules, priorityRules },
  });
};

module.exports = { getOrCreate, update };
