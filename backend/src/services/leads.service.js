'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const createLead = (businessId, data) =>
  prisma.lead.create({ data: { businessId, ...data } });

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
