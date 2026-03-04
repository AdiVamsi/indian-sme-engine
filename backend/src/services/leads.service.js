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

const findLeadsByBusiness = (businessId, status) =>
  prisma.lead.findMany({
    where: { businessId, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
  });

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
