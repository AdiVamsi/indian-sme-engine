'use strict';

const bcrypt = require('bcrypt');
const { getAgentConfigPreset } = require('../constants/agentConfig.presets');
const { LEGACY_SAFE_LEAD_SELECT } = require('../lib/leadCompat');
const { prisma } = require('../lib/prisma');

/**
 * getOverview
 * Platform-wide aggregate counts for the admin overview section.
 */
async function getOverview() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [businesses, leads, users, logsToday] = await Promise.all([
    prisma.business.count(),
    prisma.lead.count({ where: { isActivationTest: false } }),
    prisma.user.count(),
    prisma.leadActivity.count({
      where: {
        createdAt: { gte: todayStart },
        lead: { isActivationTest: false },
      },
    }),
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
      id: true,
      name: true,
      slug: true,
      industry: true,
      stage: true,
      city: true,
      country: true,
      createdAt: true,
      leads: {
        where: { isActivationTest: false },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  const bizIds = rows.map((r) => r.id);
  const [leadCounts, agentLeads] = bizIds.length > 0
    ? await Promise.all([
      prisma.lead.groupBy({
        by: ['businessId'],
        where: {
          businessId: { in: bizIds },
          isActivationTest: false,
        },
        _count: { _all: true },
      }),
      prisma.lead.findMany({
        where: {
          businessId: { in: bizIds },
          isActivationTest: false,
        },
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
      }),
    ])
    : [[], []];

  const bizLeadCounts = {};
  for (const leadCount of leadCounts) {
    bizLeadCounts[leadCount.businessId] = leadCount._count._all;
  }

  /* Automation event count per business (AGENT_CLASSIFIED + AGENT_PRIORITIZED) */
  const bizAutoCounts = {};
  for (const l of agentLeads) {
    bizAutoCounts[l.businessId] = (bizAutoCounts[l.businessId] ?? 0) + l._count.activities;
  }

  return rows.map((b) => ({
    id: b.id,
    name: b.name,
    slug: b.slug,
    industry: b.industry,
    stage: b.stage,
    city: b.city,
    country: b.country,
    createdAt: b.createdAt,
    leadCount: bizLeadCounts[b.id] ?? 0,
    automationEventCount: bizAutoCounts[b.id] ?? 0,
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
    where: { isActivationTest: false },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      ...LEGACY_SAFE_LEAD_SELECT,
      business: { select: { id: true, name: true } },
      activities: {
        where: { type: { in: ['AGENT_CLASSIFIED', 'AGENT_PRIORITIZED'] } },
        orderBy: { createdAt: 'desc' },
        select: {
          type: true,
          metadata: true,
          createdAt: true,
        },
      },
    },
  });

  return leads.map(({ activities, ...l }) => {
    const prioAct = activities.find((a) => a.type === 'AGENT_PRIORITIZED');
    const classAct = activities.find((a) => a.type === 'AGENT_CLASSIFIED');

    const priorityScore = prioAct?.metadata?.priorityScore ?? 0;
    const tags = classAct?.metadata?.tags ?? [];
    const priority = priorityScore >= 30 ? 'HIGH'
      : priorityScore >= 10 ? 'NORMAL'
        : 'LOW';

    return {
      id: l.id,
      name: l.name,
      phone: l.phone,
      message: l.message,
      status: l.status,
      score: priorityScore,
      priority,
      tags,
      businessName: l.business?.name ?? 'Unknown',
      createdAt: l.createdAt,
    };
  });
}

/**
 * getAutomationLogs
 * Cross-tenant lead activity log — most recent 20 events, no enum filter.
 */
async function getAutomationLogs() {
  const rows = await prisma.leadActivity.findMany({
    where: {
      lead: { isActivationTest: false },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      type: true,
      message: true,
      createdAt: true,
      lead: {
        select: {
          ...LEGACY_SAFE_LEAD_SELECT,
          business: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  return rows.map((a) => ({
    type: a.type,
    note: a.message ?? null,
    createdAt: a.createdAt,
    lead: {
      id: a.lead?.id,
      name: a.lead?.name,
      business: {
        id: a.lead?.business?.id,
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
    data: { stage },
    select: { id: true, name: true, slug: true, stage: true },
  });
}

/**
 * getAnalytics
 * Platform-level intelligence: stage distribution, stage duration, growth
 * metrics, and lead conversion signals.
 */
async function getAnalytics() {
  const WEB_STAGES = new Set(['WEBSITE_LIVE', 'LEADS_ACTIVE', 'AUTOMATION_ACTIVE', 'SCALING']);
  const AUTO_STAGES = new Set(['AUTOMATION_ACTIVE', 'SCALING']);

  const [businesses, allLeads, prioActs, contactActs] = await Promise.all([
    /* Stage + timestamps for distribution + duration calc */
    prisma.business.findMany({
      select: { id: true, stage: true, createdAt: true, updatedAt: true },
    }),
    /* Lead statuses for contact-rate calculation */
    prisma.lead.findMany({
      where: { isActivationTest: false },
      select: { id: true, businessId: true, status: true },
    }),
    /* Priority scores from agent activities */
    prisma.leadActivity.findMany({
      where: { type: 'AGENT_PRIORITIZED', lead: { isActivationTest: false } },
      select: { metadata: true },
    }),
    /* First STATUS_CHANGED per lead for time-to-contact */
    prisma.leadActivity.findMany({
      where: { type: 'STATUS_CHANGED', lead: { isActivationTest: false } },
      orderBy: { createdAt: 'asc' },
      select: {
        leadId: true,
        createdAt: true,
        lead: { select: { createdAt: true } },
      },
    }),
  ]);

  /* ── Stage distribution + average duration ──────────────────────────── */
  const now = Date.now();
  const stageDistribution = {};
  const stageDurationSums = {};
  const stageDurationCount = {};

  for (const b of businesses) {
    stageDistribution[b.stage] = (stageDistribution[b.stage] ?? 0) + 1;
    /* For STARTING use createdAt; for all others use updatedAt (when stage was last set) */
    const ref = b.stage === 'STARTING' ? b.createdAt : b.updatedAt;
    const days = (now - new Date(ref).getTime()) / 86_400_000;
    stageDurationSums[b.stage] = (stageDurationSums[b.stage] ?? 0) + days;
    stageDurationCount[b.stage] = (stageDurationCount[b.stage] ?? 0) + 1;
  }

  const avgStageDuration = {};
  for (const stage of Object.keys(stageDurationSums)) {
    avgStageDuration[stage] = Math.round(stageDurationSums[stage] / stageDurationCount[stage]);
  }

  /* ── Growth metrics ─────────────────────────────────────────────────── */
  const total = businesses.length;
  const withWebsite = businesses.filter((b) => WEB_STAGES.has(b.stage)).length;
  const generatingLeads = new Set(allLeads.map((lead) => lead.businessId)).size;
  const usingAutomation = businesses.filter((b) => AUTO_STAGES.has(b.stage)).length;
  const scaling = businesses.filter((b) => b.stage === 'SCALING').length;
  const activationRate = total > 0 ? Math.round((generatingLeads / total) * 100) : 0;

  /* ── Lead signals ───────────────────────────────────────────────────── */
  const totalLeads = allLeads.length;
  const contacted = allLeads.filter((l) => l.status !== 'NEW').length;
  const qualifiedOrWon = allLeads.filter((l) =>
    ['QUALIFIED', 'WON'].includes(l.status)
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
  const hours = [];
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
      pctContacted: totalLeads > 0 ? Math.round((contacted / totalLeads) * 100) : 0,
      pctQualifiedOrWon: totalLeads > 0 ? Math.round((qualifiedOrWon / totalLeads) * 100) : 0,
      avgHoursToFirstContact,
    },
  };
}

/**
 * checkSlug
 * Returns whether a slug is available (not taken by any existing business).
 * Sanitizes the input the same way createBusiness does.
 */
async function checkSlug(slug) {
  const sanitized = slug.toLowerCase().trim().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '');
  if (!sanitized) return { available: false, slug: sanitized };
  const existing = await prisma.business.findUnique({ where: { slug: sanitized } });
  return { available: !existing, slug: sanitized };
}

/**
 * createBusiness
 * Creates a new tenant: Business + owner User + default AgentConfig in a
 * single transaction. Slug is auto-generated from name if not supplied.
 *
 * Throws with err.code:
 *   'SLUG_TAKEN'    — slug already exists
 *   'INVALID_SLUG'  — slug could not be derived from name
 */
async function createBusiness({
  name, slug, industry, phone, city, timezone, currency,
  whatsAppPhoneNumberId, whatsAppDisplayPhoneNumber,
  ownerName, ownerEmail, ownerPassword,
  followUpMinutes, autoReplyEnabled,
}) {
  /* Derive slug ─────────────────────────────────────────────────────── */
  const finalSlug = slug
    ? slug.toLowerCase().trim().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '')
    : name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  if (!finalSlug) {
    const err = new Error('Could not generate a valid slug from the business name');
    err.code = 'INVALID_SLUG';
    throw err;
  }

  /* Slug uniqueness check ────────────────────────────────────────────── */
  const existing = await prisma.business.findUnique({ where: { slug: finalSlug } });
  if (existing) {
    const err = new Error(`Slug "${finalSlug}" is already taken`);
    err.code = 'SLUG_TAKEN';
    throw err;
  }

  /* Hash password before entering transaction ─────────────────────── */
  const passwordHash = await bcrypt.hash(ownerPassword, 12);

  /* Atomic create ─────────────────────────────────────────────────── */
  const business = await prisma.$transaction(async (tx) => {
    const biz = await tx.business.create({
      data: {
        name,
        slug: finalSlug,
        industry: industry || null,
        phone: phone || null,
        whatsAppPhoneNumberId: whatsAppPhoneNumberId || null,
        whatsAppDisplayPhoneNumber: whatsAppDisplayPhoneNumber || null,
        city: city || null,
        timezone: timezone || 'Asia/Kolkata',
        currency: currency || 'INR',
        stage: 'STARTING',
      },
    });

    await tx.user.create({
      data: {
        businessId: biz.id,
        name: ownerName,
        email: ownerEmail,
        passwordHash,
        role: 'OWNER',
      },
    });

    const preset = getAgentConfigPreset(industry || 'other');
    await tx.agentConfig.create({
      data: {
        businessId: biz.id,
        ...preset,
        followUpMinutes: followUpMinutes ?? preset.followUpMinutes,
        autoReplyEnabled: autoReplyEnabled ?? preset.autoReplyEnabled,
      },
    });

    return biz;
  });

  return {
    id: business.id,
    name: business.name,
    slug: business.slug,
    industry: business.industry,
    whatsAppPhoneNumberId: business.whatsAppPhoneNumberId,
    whatsAppDisplayPhoneNumber: business.whatsAppDisplayPhoneNumber,
    city: business.city,
    timezone: business.timezone,
    currency: business.currency,
    stage: business.stage,
    createdAt: business.createdAt,
  };
}

module.exports = { getOverview, getAllBusinesses, getAllLeads, getAutomationLogs, updateBusinessStage, getAnalytics, checkSlug, createBusiness };
