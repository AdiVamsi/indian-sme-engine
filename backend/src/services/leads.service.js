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

module.exports = { createLead, findLeadsByBusiness, updateLeadStatus, deleteLead };
