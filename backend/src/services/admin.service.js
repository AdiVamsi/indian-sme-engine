'use strict';

const { prisma } = require('../lib/prisma');
const { LEGACY_SAFE_LEAD_SELECT } = require('../lib/leadCompat');
const { buildLeadActivitySummary } = require('./leads.service');
const { APPOINTMENT_WITH_LEAD_SELECT } = require('./appointments.service');

const getDashboardSummary = async (businessId) => {
  const [
    totalLeads,
    newLeads,
    totalAppointments,
    upcomingAppointments,
    totalServices,
    totalTestimonials,
  ] = await Promise.all([
    prisma.lead.count({ where: { businessId, isActivationTest: false } }),
    prisma.lead.count({ where: { businessId, isActivationTest: false, status: 'NEW' } }),
    prisma.appointment.count({ where: { businessId } }),
    prisma.appointment.count({
      where: {
        businessId,
        status: { in: ['NEW', 'CONFIRMED'] },
        scheduledAt: { gte: new Date() },
      },
    }),
    prisma.service.count({ where: { businessId } }),
    prisma.testimonial.count({ where: { businessId } }),
  ]);

  return {
    totalLeads,
    newLeads,
    totalAppointments,
    upcomingAppointments,
    totalServices,
    totalTestimonials,
  };
};

const getLeads = async (businessId) => {
  const leads = await prisma.lead.findMany({
    where:   { businessId, isActivationTest: false },
    orderBy: { createdAt: 'desc' },
    select: {
      ...LEGACY_SAFE_LEAD_SELECT,
      activities: {
        where:  { type: { in: ['AGENT_CLASSIFIED', 'AGENT_PRIORITIZED', 'FOLLOW_UP_SCHEDULED', 'AUTOMATION_ALERT'] } },
        orderBy: { createdAt: 'desc' },
        select: { type: true, metadata: true, createdAt: true },
      },
    },
  });

  return leads.map(({ activities, ...lead }) => {
    return {
      ...lead,
      ...buildLeadActivitySummary(activities),
    };
  });
};

const getAppointments = (businessId) =>
  prisma.appointment.findMany({
    where:   { businessId },
    orderBy: { scheduledAt: 'asc' },
    select: APPOINTMENT_WITH_LEAD_SELECT,
  });

const getServices = (businessId) =>
  prisma.service.findMany({
    where:   { businessId },
    orderBy: { createdAt: 'desc' },
  });

const getTestimonials = (businessId) =>
  prisma.testimonial.findMany({
    where:   { businessId },
    orderBy: { createdAt: 'desc' },
  });

/* Returns all business context fields needed by the dashboard */
const getBusinessProfile = (businessId) =>
  prisma.business.findUnique({
    where:  { id: businessId },
    select: {
      name:     true,
      phone:    true,
      email:    true,
      address:  true,
      industry: true,
      city:     true,
      country:  true,
      timezone: true,
      currency: true,
      logoUrl:  true,
      stage:    true,
      slug:     true,
    },
  });

/*
  Returns lead counts grouped by calendar day (in the business's timezone)
  for the last `days` days.

  We do the date math in JS to stay DB-agnostic (works with Neon, PlanetScale,
  local Postgres, etc.).  For large datasets a raw SQL query with AT TIME ZONE
  would be better, but for a typical SME (< 10k leads) this is fine.
*/
const getLeadsByDay = async (businessId, timezone = 'Asia/Kolkata', days = 7) => {
  const now   = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);

  const leads = await prisma.lead.findMany({
    where:  { businessId, isActivationTest: false, createdAt: { gte: since } },
    select: { createdAt: true },
  });

  /* Build a map: localDateString → count */
  const fmt = new Intl.DateTimeFormat('en-CA', {   /* 'en-CA' gives YYYY-MM-DD */
    timeZone:  timezone,
    year:      'numeric',
    month:     '2-digit',
    day:       '2-digit',
  });

  const counts = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    counts[fmt.format(d)] = 0;
  }

  for (const { createdAt } of leads) {
    const key = fmt.format(createdAt);
    if (key in counts) counts[key]++;
  }

  /* Return ordered array of { date, count } */
  return Object.entries(counts)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, count]) => ({ date, count }));
};

module.exports = {
  getDashboardSummary,
  getLeads,
  getAppointments,
  getServices,
  getTestimonials,
  getBusinessProfile,
  getLeadsByDay,
};
