'use strict';

const { z } = require('zod');

const { createLead, findLeadsByBusiness, updateLeadStatus, deleteLead } = require('../services/leads.service');

const leadStatusEnum = z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST']);

const createLeadSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional(),
  message: z.string().optional(),
});

const statusSchema = z.object({
  status: leadStatusEnum,
});

const create = async (req, res) => {
  const result = createLeadSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.flatten() });
  }

  try {
    const lead = await createLead(req.user.businessId, result.data);
    return res.status(201).json(lead);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const list = async (req, res) => {
  const { status } = req.query;

  if (status) {
    const parsed = leadStatusEnum.safeParse(status);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid status. Must be one of: NEW, CONTACTED, QUALIFIED, WON, LOST' });
    }
  }

  try {
    const leads = await findLeadsByBusiness(req.user.businessId, status || null);
    return res.json(leads);
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
    const { count } = await updateLeadStatus(req.params.id, req.user.businessId, result.data.status);
    if (count === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    return res.json({ updated: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const remove = async (req, res) => {
  try {
    const { count } = await deleteLead(req.params.id, req.user.businessId);
    if (count === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    return res.status(204).send();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { create, list, updateStatus, remove };
