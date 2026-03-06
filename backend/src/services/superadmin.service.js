'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * getOverview
 * Platform-wide aggregate counts for the admin overview section.
 */
async function getOverview() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [businesses, leads, users, logsToday] = await Promise.all([
    prisma.business.count(),
    prisma.lead.count(),
    prisma.user.count(),
    prisma.leadActivity.count({ where: { createdAt: { gte: todayStart } } }),
  ]);

  return { businesses, leads, users, logsToday };
}

/**
 * getAllBusinesses
 * All businesses with lead count and last-activity timestamp.
 */
async function getAllBusinesses() {
  const rows = await prisma.business.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id:        true,
      name:      true,
      slug:      true,
      industry:  true,
      stage:     true,
      city:      true,
      country:   true,
      createdAt: true,
      _count: {
        select: { leads: true },
      },
      leads: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  return rows.map((b) => ({
    id:           b.id,
    name:         b.name,
    slug:         b.slug,
    industry:     b.industry,
    stage:        b.stage,
    city:         b.city,
    country:      b.country,
    createdAt:    b.createdAt,
    leadCount:    b._count.leads,
    lastActivity: b.leads[0]?.createdAt ?? null,
  }));
}

/**
 * getAllLeads
 * Cross-tenant lead list — most recent 100, with business name and enriched
 * priority data derived from AGENT_PRIORITIZED / AGENT_CLASSIFIED activities.
 */
async function getAllLeads() {
  const leads = await prisma.lead.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      business:   { select: { id: true, name: true } },
      activities: {
        where:   { type: { in: ['AGENT_CLASSIFIED', 'AGENT_PRIORITIZED'] } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  return leads.map(({ activities, ...l }) => {
    const prioAct  = activities.find((a) => a.type === 'AGENT_PRIORITIZED');
    const classAct = activities.find((a) => a.type === 'AGENT_CLASSIFIED');

    const priorityScore = prioAct?.metadata?.priorityScore ?? 0;
    const tags          = classAct?.metadata?.tags          ?? [];
    const priority      = priorityScore >= 30 ? 'HIGH'
                        : priorityScore >= 10 ? 'NORMAL'
                        :                       'LOW';

    return {
      id:           l.id,
      name:         l.name,
      phone:        l.phone,
      status:       l.status,
      score:        priorityScore,
      priority,
      tags,
      businessName: l.business?.name ?? 'Unknown',
      createdAt:    l.createdAt,
    };
  });
}

/**
 * getAutomationLogs
 * Cross-tenant lead activity log — most recent 20 events, no enum filter.
 */
async function getAutomationLogs() {
  const rows = await prisma.leadActivity.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: {
      lead: {
        include: {
          business: true,
        },
      },
    },
  });

  return rows.map((a) => ({
    type:         a.type,
    note:         a.note ?? null,
    createdAt:    a.createdAt,
    lead: {
      id:   a.lead?.id,
      name: a.lead?.name,
      business: {
        id:   a.lead?.business?.id,
        name: a.lead?.business?.name,
      },
    },
  }));
}

/**
 * updateBusinessStage
 * Updates the lifecycle stage of a single business.
 * Returns the updated Business or null if not found.
 */
async function updateBusinessStage(id, stage) {
  const existing = await prisma.business.findUnique({ where: { id } });
  if (!existing) return null;

  return prisma.business.update({
    where: { id },
    data:  { stage },
    select: { id: true, name: true, slug: true, stage: true },
  });
}

module.exports = { getOverview, getAllBusinesses, getAllLeads, getAutomationLogs, updateBusinessStage };
