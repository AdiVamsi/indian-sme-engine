'use strict';

const { AgentEngine } = require('../agents');
const { prisma } = require('../lib/prisma');

const createLead = async (businessId, data) => {
  const lead = await prisma.lead.create({ data: { businessId, ...data } });

  /* Run agent pipeline; capture scores for broadcast payload.
   * Errors are logged but never fail the caller. */
  let priorityScore = 0;
  let tags          = [];
  try {
    const result = await AgentEngine.run({ type: 'LEAD_CREATED', leadId: lead.id, businessId: lead.businessId });
    priorityScore = result.priorityScore ?? 0;
    tags          = result.tags          ?? [];

    /* Advance lifecycle stage on the first successful lead — "lead workflow is now active".
     * updateMany with stage: 'STARTING' in the where clause is a no-op for all other stages. */
    await prisma.business.updateMany({
      where: { id: businessId, stage: 'STARTING' },
      data:  { stage: 'LEADS_ACTIVE' },
    });
  } catch (err) {
    console.error('[LeadsService] AgentEngine failed for lead', lead.id, '—', err.message);
  }

  const priority = priorityScore >= 30 ? 'HIGH' : priorityScore >= 10 ? 'NORMAL' : 'LOW';
  return { ...lead, priorityScore, tags, priority };
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

const updateLeadStatus = async (id, businessId, status) => {
  const existing = await prisma.lead.findFirst({ where: { id, businessId } });
  if (!existing) return { count: 0 };
  await prisma.$transaction([
    prisma.lead.update({ where: { id }, data: { status } }),
    prisma.leadActivity.create({
      data: {
        leadId:   id,
        type:     'STATUS_CHANGED',
        message:  `Status changed from ${existing.status} to ${status}`,
        metadata: { oldStatus: existing.status, newStatus: status },
      },
    }),
  ]);
  return { count: 1 };
};

const deleteLead = (id, businessId) =>
  prisma.lead.deleteMany({ where: { id, businessId } });

const getLeadActivity = async (id, businessId) => {
  /* Single query: filter by lead relation for multi-tenant safety */
  const rows = await prisma.leadActivity.findMany({
    where: { leadId: id, lead: { businessId } },
    include: { lead: { select: { name: true, phone: true } } },
    orderBy: { createdAt: 'asc' },
  });

  if (!rows.length) {
    /* No activities yet — confirm lead exists for this business */
    const existing = await prisma.lead.findFirst({ where: { id, businessId } });
    if (!existing) return null;
    return { lead: { id, name: existing.name, phone: existing.phone }, activities: [] };
  }

  const lead       = { id, ...rows[0].lead };
  const activities = rows.map(({ lead: _l, ...act }) => act);
  return { lead, activities };
};

/**
 * getLeadForSuggestions
 * Fetches a lead with all its activities, enriching tags and priorityScore
 * from the AGENT_CLASSIFIED / AGENT_PRIORITIZED activity metadata so that
 * the suggestion engine receives the full picture.
 */
const getLeadForSuggestions = async (id, businessId) => {
  const lead = await prisma.lead.findFirst({
    where:   { id, businessId },
    include: { activities: { orderBy: { createdAt: 'asc' } } },
  });
  if (!lead) return null;

  const classAct = lead.activities.find((a) => a.type === 'AGENT_CLASSIFIED');
  const prioAct  = lead.activities.find((a) => a.type === 'AGENT_PRIORITIZED');

  return {
    ...lead,
    tags:          classAct?.metadata?.tags          ?? [],
    priorityScore: prioAct?.metadata?.priorityScore  ?? 0,
  };
};

/**
 * getLeadForOutreach
 * Same enrichment pattern as getLeadForSuggestions — used by the outreach
 * draft engine to access tags, priorityScore, and the full activity list.
 */
const getLeadForOutreach = async (id, businessId) => {
  const lead = await prisma.lead.findFirst({
    where:   { id, businessId },
    include: { activities: { orderBy: { createdAt: 'asc' } } },
  });
  if (!lead) return null;

  const classAct = lead.activities.find((a) => a.type === 'AGENT_CLASSIFIED');
  const prioAct  = lead.activities.find((a) => a.type === 'AGENT_PRIORITIZED');

  return {
    ...lead,
    tags:          classAct?.metadata?.tags         ?? [],
    priorityScore: prioAct?.metadata?.priorityScore ?? 0,
  };
};

module.exports = { createLead, findLeadsByBusiness, updateLeadStatus, deleteLead, getLeadActivity, getLeadForSuggestions, getLeadForOutreach };
