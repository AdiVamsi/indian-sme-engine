'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const getDashboardSummary = async (businessId) => {
  const [
    totalLeads,
    newLeads,
    totalAppointments,
    upcomingAppointments,
    totalServices,
    totalTestimonials,
  ] = await Promise.all([
    prisma.lead.count({ where: { businessId } }),
    prisma.lead.count({ where: { businessId, status: 'NEW' } }),
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

const getLeads = (businessId) =>
  prisma.lead.findMany({
    where:   { businessId },
    orderBy: { createdAt: 'desc' },
  });

const getAppointments = (businessId) =>
  prisma.appointment.findMany({
    where:   { businessId },
    orderBy: { scheduledAt: 'asc' },
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

module.exports = {
  getDashboardSummary,
  getLeads,
  getAppointments,
  getServices,
  getTestimonials,
};
