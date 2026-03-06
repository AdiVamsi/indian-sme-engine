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
    city:         b.city,
    country:      b.country,
    createdAt:    b.createdAt,
    leadCount:    b._count.leads,
    lastActivity: b.leads[0]?.createdAt ?? null,
  }));
}

/**
 * getAllLeads
 * Cross-tenant lead list — most recent 100, with business name included.
 */
async function getAllLeads() {
  try {
    const leads = await prisma.lead.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        business: { select: { id: true, name: true } },
      },
    });

    return leads.map((l) => ({
      id:           l.id,
      name:         l.name,
      phone:        l.phone,
      status:       l.status,
      score:        l.score ?? 0,
      businessName: l.business?.name ?? 'Unknown',
      createdAt:    l.createdAt,
    }));
  } catch (err) {
    throw err;
  }
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

module.exports = { getOverview, getAllBusinesses, getAllLeads, getAutomationLogs };
