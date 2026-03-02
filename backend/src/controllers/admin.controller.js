'use strict';

// Login reuses the existing auth controller — same schema, same logic.
const { login } = require('./auth.controller');

const {
  getDashboardSummary,
  getLeads,
  getAppointments,
  getServices,
  getTestimonials,
} = require('../services/admin.service');

const dashboard = async (req, res) => {
  try {
    const summary = await getDashboardSummary(req.user.businessId);
    return res.json(summary);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const leads = async (req, res) => {
  try {
    return res.json(await getLeads(req.user.businessId));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const appointments = async (req, res) => {
  try {
    return res.json(await getAppointments(req.user.businessId));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const services = async (req, res) => {
  try {
    return res.json(await getServices(req.user.businessId));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const testimonials = async (req, res) => {
  try {
    return res.json(await getTestimonials(req.user.businessId));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { login, dashboard, leads, appointments, services, testimonials };
