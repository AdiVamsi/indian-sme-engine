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
 * All businesses with lead count, automation event count, and last-activity timestamp.
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

  /* Automation event count per business (AGENT_CLASSIFIED + AGENT_PRIORITIZED) */
  const bizIds = rows.map((r) => r.id);
  const agentLeads = bizIds.length > 0
    ? await prisma.lead.findMany({
        where: { businessId: { in: bizIds } },
        select: {
          businessId: true,
          _count: {
            select: {
              activities: {
                where: { type: { in: ['AGENT_CLASSIFIED', 'AGENT_PRIORITIZED'] } },
              },
            },
          },
        },
      })
    : [];

  const bizAutoCounts = {};
  for (const l of agentLeads) {
    bizAutoCounts[l.businessId] = (bizAutoCounts[l.businessId] ?? 0) + l._count.activities;
  }

  return rows.map((b) => ({
    id:                   b.id,
    name:                 b.name,
    slug:                 b.slug,
    industry:             b.industry,
    stage:                b.stage,
    city:                 b.city,
    country:              b.country,
    createdAt:            b.createdAt,
    leadCount:            b._count.leads,
    automationEventCount: bizAutoCounts[b.id] ?? 0,
    lastActivity:         b.leads[0]?.createdAt ?? null,
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

/**
 * getAnalytics
 * Platform-level intelligence: stage distribution, stage duration, growth
 * metrics, and lead conversion signals.
 */
async function getAnalytics() {
  const WEB_STAGES  = new Set(['WEBSITE_LIVE', 'LEADS_ACTIVE', 'AUTOMATION_ACTIVE', 'SCALING']);
  const LEAD_STAGES = new Set(['LEADS_ACTIVE', 'AUTOMATION_ACTIVE', 'SCALING']);
  const AUTO_STAGES = new Set(['AUTOMATION_ACTIVE', 'SCALING']);

  const [businesses, allLeads, prioActs, contactActs] = await Promise.all([
    /* Stage + timestamps for distribution + duration calc */
    prisma.business.findMany({
      select: { id: true, stage: true, createdAt: true, updatedAt: true },
    }),
    /* Lead statuses for contact-rate calculation */
    prisma.lead.findMany({
      select: { id: true, status: true },
    }),
    /* Priority scores from agent activities */
    prisma.leadActivity.findMany({
      where:  { type: 'AGENT_PRIORITIZED' },
      select: { metadata: true },
    }),
    /* First STATUS_CHANGED per lead for time-to-contact */
    prisma.leadActivity.findMany({
      where:   { type: 'STATUS_CHANGED' },
      orderBy: { createdAt: 'asc' },
      select: {
        leadId:    true,
        createdAt: true,
        lead: { select: { createdAt: true } },
      },
    }),
  ]);

  /* ── Stage distribution + average duration ──────────────────────────── */
  const now = Date.now();
  const stageDistribution  = {};
  const stageDurationSums  = {};
  const stageDurationCount = {};

  for (const b of businesses) {
    stageDistribution[b.stage]  = (stageDistribution[b.stage]  ?? 0) + 1;
    /* For STARTING use createdAt; for all others use updatedAt (when stage was last set) */
    const ref  = b.stage === 'STARTING' ? b.createdAt : b.updatedAt;
    const days = (now - new Date(ref).getTime()) / 86_400_000;
    stageDurationSums[b.stage]   = (stageDurationSums[b.stage]  ?? 0) + days;
    stageDurationCount[b.stage]  = (stageDurationCount[b.stage] ?? 0) + 1;
  }

  const avgStageDuration = {};
  for (const stage of Object.keys(stageDurationSums)) {
    avgStageDuration[stage] = Math.round(stageDurationSums[stage] / stageDurationCount[stage]);
  }

  /* ── Growth metrics ─────────────────────────────────────────────────── */
  const total          = businesses.length;
  const withWebsite    = businesses.filter((b) => WEB_STAGES.has(b.stage)).length;
  const generatingLeads = businesses.filter((b) => LEAD_STAGES.has(b.stage)).length;
  const usingAutomation = businesses.filter((b) => AUTO_STAGES.has(b.stage)).length;
  const scaling         = businesses.filter((b) => b.stage === 'SCALING').length;
  const activationRate  = total > 0 ? Math.round((generatingLeads / total) * 100) : 0;

  /* ── Lead signals ───────────────────────────────────────────────────── */
  const totalLeads     = allLeads.length;
  const contacted      = allLeads.filter((l) =>
    ['CONTACTED', 'QUALIFIED', 'CLOSED_WON'].includes(l.status)
  ).length;
  const qualifiedOrWon = allLeads.filter((l) =>
    ['QUALIFIED', 'CLOSED_WON'].includes(l.status)
  ).length;

  /* Average priority score */
  const scores = prioActs
    .map((a) => a.metadata?.priorityScore)
    .filter((s) => typeof s === 'number' && s > 0);
  const avgPriorityScore = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;

  /* Average hours to first contact (de-dup: first STATUS_CHANGED per lead) */
  const seenLeads = new Set();
  const hours     = [];
  for (const a of contactActs) {
    if (seenLeads.has(a.leadId)) continue;
    seenLeads.add(a.leadId);
    if (a.lead?.createdAt) {
      const h = (new Date(a.createdAt) - new Date(a.lead.createdAt)) / 3_600_000;
      if (h >= 0) hours.push(h);
    }
  }
  const avgHoursToFirstContact = hours.length > 0
    ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10
    : null;

  return {
    stageDistribution,
    avgStageDuration,
    growthMetrics: { total, withWebsite, generatingLeads, usingAutomation, scaling, activationRate },
    leadSignals: {
      totalLeads,
      avgPriorityScore,
      pctContacted:      totalLeads > 0 ? Math.round((contacted      / totalLeads) * 100) : 0,
      pctQualifiedOrWon: totalLeads > 0 ? Math.round((qualifiedOrWon / totalLeads) * 100) : 0,
      avgHoursToFirstContact,
    },
  };
}

module.exports = { getOverview, getAllBusinesses, getAllLeads, getAutomationLogs, updateBusinessStage, getAnalytics };
