'use strict';

const { LeadStatus, AppointmentStatus } = require('@prisma/client');

// Login reuses the existing auth controller — same schema, same logic.
const { login } = require('./auth.controller');

const {
  getDashboardSummary,
  getLeads,
  getAppointments,
  getServices,
  getTestimonials,
  getBusinessProfile,
  getLeadsByDay,
} = require('../services/admin.service');

const { getIndustryConfig } = require('../constants/industry.config');

/* ── GET /api/admin/config ──
   Returns all metadata the dashboard needs to render itself:
   - Status enums from Prisma (single source of truth, never hardcoded in frontend)
   - Business profile including industry, timezone, currency, city, logoUrl
   - Industry-aware stat card labels (from industry.config.js, not hardcoded)
   - Industry-aware table column headers per section
   - Mood theme name for CSS body[data-mood] attribute
   - Realtime notification text (industry-aware)
*/
const getConfig = async (req, res) => {
  try {
    const business      = await getBusinessProfile(req.user.businessId);
    const industryConf  = getIndustryConfig(business?.industry);

    return res.json({
      leadStatuses:        Object.values(LeadStatus),
      appointmentStatuses: Object.values(AppointmentStatus),
      business,
      mood:                industryConf.mood,
      statCards:           industryConf.statCards,
      tableColumns:        industryConf.tableColumns,
      notifText:           industryConf.notifText,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/* ── GET /api/admin/business ──
   Business profile with all context fields.
   Separate from /config so the frontend can refresh branding independently.
*/
const getBusiness = async (req, res) => {
  try {
    const business = await getBusinessProfile(req.user.businessId);
    return res.json(business);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

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

/* ── GET /api/admin/leads/by-day?days=7 ──
   Returns per-day lead counts in business timezone for the chart.
*/
const leadsByDay = async (req, res) => {
  try {
    const business = await getBusinessProfile(req.user.businessId);
    const timezone = business?.timezone ?? 'Asia/Kolkata';
    const days     = Math.min(parseInt(req.query.days, 10) || 7, 30);
    const data     = await getLeadsByDay(req.user.businessId, timezone, days);
    return res.json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  login,
  getConfig,
  getBusiness,
  dashboard,
  leads,
  appointments,
  services,
  testimonials,
  leadsByDay,
};
