'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const createAppointment = (businessId, data) =>
  prisma.appointment.create({ data: { businessId, ...data } });

const findAppointmentsByBusiness = (businessId, status) =>
  prisma.appointment.findMany({
    where: { businessId, ...(status ? { status } : {}) },
    orderBy: { scheduledAt: 'asc' },
  });

const updateAppointmentStatus = (id, businessId, status) =>
  prisma.appointment.updateMany({ where: { id, businessId }, data: { status } });

const deleteAppointment = (id, businessId) =>
  prisma.appointment.deleteMany({ where: { id, businessId } });

module.exports = { createAppointment, findAppointmentsByBusiness, updateAppointmentStatus, deleteAppointment };
