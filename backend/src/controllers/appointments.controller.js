'use strict';

const { z } = require('zod');

const {
  createAppointment,
  findAppointmentsByBusiness,
  updateAppointmentStatus,
  deleteAppointment,
} = require('../services/appointments.service');

const appointmentStatusEnum = z.enum(['NEW', 'CONFIRMED', 'CANCELLED', 'COMPLETED']);

const createSchema = z.object({
  customerName: z.string().min(1),
  phone: z.string().min(1),
  scheduledAt: z.string().min(1),
  notes: z.string().optional(),
});

const statusSchema = z.object({
  status: appointmentStatusEnum,
});

const create = async (req, res) => {
  const result = createSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.flatten() });
  }

  try {
    const appointment = await createAppointment(req.user.businessId, result.data);
    return res.status(201).json(appointment);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const list = async (req, res) => {
  const { status } = req.query;

  if (status) {
    const parsed = appointmentStatusEnum.safeParse(status);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid status. Must be one of: NEW, CONFIRMED, CANCELLED, COMPLETED' });
    }
  }

  try {
    const appointments = await findAppointmentsByBusiness(req.user.businessId, status || null);
    return res.json(appointments);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const updateStatus = async (req, res) => {
  const result = statusSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.flatten() });
  }

  try {
    const { count } = await updateAppointmentStatus(req.params.id, req.user.businessId, result.data.status);
    if (count === 0) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    return res.json({ updated: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const remove = async (req, res) => {
  try {
    const { count } = await deleteAppointment(req.params.id, req.user.businessId);
    if (count === 0) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    return res.status(204).send();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { create, list, updateStatus, remove };
