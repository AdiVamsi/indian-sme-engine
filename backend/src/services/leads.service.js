'use strict';

const { PrismaClient } = require('@prisma/client');
const { AgentEngine } = require('../agents');

const prisma = new PrismaClient();

const createLead = async (businessId, data) => {
  const lead = await prisma.lead.create({ data: { businessId, ...data } });

  /* Run agent pipeline; log errors but never fail the caller. */
  try {
    await AgentEngine.run({ type: 'LEAD_CREATED', leadId: lead.id, businessId: lead.businessId });
  } catch (err) {
    console.error('[LeadsService] AgentEngine failed for lead', lead.id, '—', err.message);
  }

  return lead;
};

const findLeadsByBusiness = async (businessId, status) => {
  const leads = await prisma.lead.findMany({
    where:   { businessId, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
    include: {
      activities: {
        where:   { type: { in: ['AGENT_CLASSIFIED', 'AGENT_PRIORITIZED'] } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  return leads.map(({ activities, ...lead }) => {
    const classAct = activities.find((a) => a.type === 'AGENT_CLASSIFIED');
    const prioAct  = activities.find((a) => a.type === 'AGENT_PRIORITIZED');

    const tags          = classAct?.metadata?.tags         ?? [];
    const priorityScore = prioAct?.metadata?.priorityScore ?? 0;
    const priority      = priorityScore >= 30 ? 'HIGH'
                        : priorityScore >= 10 ? 'NORMAL'
                        :                       'LOW';

    return { ...lead, priorityScore, tags, priority };
  });
};

const updateLeadStatus = (id, businessId, status) =>
  prisma.lead.updateMany({ where: { id, businessId }, data: { status } });

const deleteLead = (id, businessId) =>
  prisma.lead.deleteMany({ where: { id, businessId } });

const getLeadActivity = async (id, businessId) => {
  /* Multi-tenant guard: verify lead belongs to this business */
  const lead = await prisma.lead.findFirst({ where: { id, businessId } });
  if (!lead) return null;
  const activities = await prisma.leadActivity.findMany({
    where: { leadId: id },
    orderBy: { createdAt: 'asc' },
  });
  return { lead, activities };
};

module.exports = { createLead, findLeadsByBusiness, updateLeadStatus, deleteLead, getLeadActivity };
