'use strict';

const { prisma } = require('../lib/prisma');

const APPOINTMENT_WITH_LEAD_SELECT = Object.freeze({
  id: true,
  businessId: true,
  leadId: true,
  customerName: true,
  phone: true,
  scheduledAt: true,
  notes: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  lead: {
    select: {
      id: true,
      name: true,
      phone: true,
      status: true,
    },
  },
});

function createLeadNotFoundError() {
  const err = new Error('Lead not found');
  err.code = 'LEAD_NOT_FOUND';
  return err;
}

function createInvalidScheduledAtError() {
  const err = new Error('Invalid appointment date and time');
  err.code = 'INVALID_APPOINTMENT_DATETIME';
  return err;
}

function isLeadNotFoundError(err) {
  return err?.code === 'LEAD_NOT_FOUND';
}

function isInvalidScheduledAtError(err) {
  return err?.code === 'INVALID_APPOINTMENT_DATETIME';
}

function parseScheduledAt(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw createInvalidScheduledAtError();
  }
  return parsed;
}

async function findLeadForAppointment(tx, businessId, leadId) {
  if (!leadId) return null;

  const lead = await tx.lead.findFirst({
    where: { id: leadId, businessId, isActivationTest: false },
    select: {
      id: true,
      name: true,
      phone: true,
      status: true,
    },
  });

  if (!lead) {
    throw createLeadNotFoundError();
  }

  return lead;
}

function formatScheduledAtForMessage(scheduledAt) {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(scheduledAt);
}

async function createAppointmentWithOptionalLead(businessId, data) {
  const normalizedScheduledAt = parseScheduledAt(data.scheduledAt);

  return prisma.$transaction(async (tx) => {
    const linkedLead = await findLeadForAppointment(tx, businessId, data.leadId);
    const customerName = String(data.customerName || linkedLead?.name || '').trim();
    const phone = String(data.phone || linkedLead?.phone || '').trim();

    const appointment = await tx.appointment.create({
      data: {
        businessId,
        leadId: linkedLead?.id || null,
        customerName,
        phone,
        scheduledAt: normalizedScheduledAt,
        notes: String(data.notes || '').trim() || null,
      },
      select: APPOINTMENT_WITH_LEAD_SELECT,
    });

    if (linkedLead) {
      await tx.leadActivity.create({
        data: {
          leadId: linkedLead.id,
          type: 'APPOINTMENT_CREATED',
          message: `Appointment created for ${formatScheduledAtForMessage(appointment.scheduledAt)}.`,
          metadata: {
            appointmentId: appointment.id,
            appointmentStatus: appointment.status,
            scheduledAt: appointment.scheduledAt.toISOString(),
            notes: appointment.notes,
            linkedFrom: 'appointment',
          },
        },
      });
    }

    return appointment;
  });
}

const createAppointment = (businessId, data) =>
  createAppointmentWithOptionalLead(businessId, data);

const createAppointmentForLead = (businessId, leadId, data) =>
  createAppointmentWithOptionalLead(businessId, {
    ...data,
    leadId,
  });

const findAppointmentsByBusiness = (businessId, status) =>
  prisma.appointment.findMany({
    where: { businessId, ...(status ? { status } : {}) },
    orderBy: { scheduledAt: 'asc' },
    select: APPOINTMENT_WITH_LEAD_SELECT,
  });

const updateAppointmentStatus = (id, businessId, status) =>
  prisma.appointment.updateMany({ where: { id, businessId }, data: { status } });

const deleteAppointment = (id, businessId) =>
  prisma.appointment.deleteMany({ where: { id, businessId } });

module.exports = {
  APPOINTMENT_WITH_LEAD_SELECT,
  createAppointment,
  createAppointmentForLead,
  findAppointmentsByBusiness,
  updateAppointmentStatus,
  deleteAppointment,
  isLeadNotFoundError,
  isInvalidScheduledAtError,
};
