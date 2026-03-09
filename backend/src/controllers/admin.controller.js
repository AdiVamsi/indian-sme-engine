'use strict';

const { LeadStatus, AppointmentStatus } = require('@prisma/client');
const z = require('zod');

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

const { updateLeadStatus, getLeadActivity, getLeadForSuggestions, getLeadForOutreach } = require('../services/leads.service');
const { getLeadSuggestions } = require('../agents/leadSuggestions');
const { getOutreachDraft }   = require('../agents/outreachDrafts');
const { broadcast }        = require('../realtime/socket');

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
      needsActivation:     business?.stage === 'STARTING',
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

const leadStatusSchema = z.object({
  status: z.enum(Object.values(LeadStatus)),
});

/* ── PATCH /api/admin/leads/:id/status ──
   Updates a lead's status and logs a STATUS_CHANGED activity.
   Broadcasts the change to all connected clients for this business.
*/
const updateStatus = async (req, res) => {
  const parsed = leadStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  try {
    const result = await updateLeadStatus(req.params.id, req.user.businessId, parsed.data.status);
    if (result.count === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    broadcast(req.user.businessId, 'lead:status_changed', {
      id:     req.params.id,
      status: parsed.data.status,
    });
    return res.json({ updated: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/* ── GET /api/admin/leads/:id/activity ──
   Returns the lead record + all its activity events for the timeline page.
   Multi-tenant guard is inside getLeadActivity (checks businessId).
*/
const leadActivity = async (req, res) => {
  try {
    const result = await getLeadActivity(req.params.id, req.user.businessId);
    if (!result) return res.status(404).json({ error: 'Lead not found' });
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/* ── GET /api/admin/leads/:id/suggestions ──
   Fetches the lead (scoped by businessId), runs the deterministic suggestion
   engine, and returns the ranked suggestion list. No DB writes — read-only.
*/
const leadSuggestions = async (req, res) => {
  try {
    const lead = await getLeadForSuggestions(req.params.id, req.user.businessId);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    return res.json(getLeadSuggestions(lead));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/* ── GET /api/admin/leads/:id/outreach-draft ──
   Fetches the lead (scoped by businessId), runs the deterministic outreach
   draft engine, and returns a single suggested message. No DB writes — read-only.
*/
const leadOutreachDraft = async (req, res) => {
  try {
    const lead = await getLeadForOutreach(req.params.id, req.user.businessId);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    return res.json(getOutreachDraft(lead));
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
  updateStatus,
  leadActivity,
  leadSuggestions,
  leadOutreachDraft,
};
