'use strict';

const { z } = require('zod');

const {
  createLead,
  findLeadsByBusiness,
  updateLeadStatus,
  runLeadOperatorAction,
  deleteLead,
  getLeadActivity,
  getLeadForSuggestions,
} = require('../services/leads.service');
const { getLeadSuggestions } = require('../agents/leadSuggestions');
const { broadcast } = require('../realtime/socket');

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

const snoozeDaysSchema = z.union([z.literal(1), z.literal(3), z.literal(7)]);

const operatorActionSchema = z.object({
  action: z.enum(['MARK_CALLED', 'SCHEDULE_CALLBACK', 'SEND_FEE_DETAILS', 'MARK_HANDOFF_COMPLETE', 'ADD_NOTE', 'SNOOZE']),
  note: z.string().max(500).optional(),
  callbackTime: z.string().max(120).optional(),
  callbackAt: z.string().max(64).optional(),
  snoozeDays: snoozeDaysSchema.optional(),
}).superRefine((data, ctx) => {
  if (data.action === 'ADD_NOTE' && !String(data.note || '').trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['note'],
      message: 'Operator note is required.',
    });
  }

  if (data.action === 'SNOOZE' && data.snoozeDays === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['snoozeDays'],
      message: 'Snooze duration is required.',
    });
  }

  if (data.action === 'SCHEDULE_CALLBACK' && !String(data.callbackAt || '').trim() && !String(data.callbackTime || '').trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['callbackAt'],
      message: 'Callback date and time are required.',
    });
  }
});

function buildLeadRealtimePayload(lead) {
  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    message: lead.message,
    status: lead.status,
    priority: lead.priority,
    priorityScore: lead.priorityScore,
    tags: lead.tags,
    source: lead.source || 'web',
    hasClassification: Boolean(lead.hasClassification),
    hasPrioritization: Boolean(lead.hasPrioritization),
    conversationStatus: lead.conversationStatus || null,
    handoffReady: Boolean(lead.handoffReady),
    whatsappDeliveryStatus: lead.whatsappDeliveryStatus || null,
    whatsappNeedsAttention: Boolean(lead.whatsappNeedsAttention),
    whatsappFailureTitle: lead.whatsappFailureTitle || null,
    whatsappFailureDetail: lead.whatsappFailureDetail || null,
    whatsappFailureCategory: lead.whatsappFailureCategory || null,
    whatsappFailureAt: lead.whatsappFailureAt || null,
    whatsappOperatorActionRequired: lead.whatsappOperatorActionRequired || null,
    createdAt: lead.createdAt,
    timestamp: lead.createdAt,
  };
}

function emitLeadCreated(businessId, lead) {
  broadcast(businessId, 'lead:new', buildLeadRealtimePayload(lead));
}

const create = async (req, res) => {
  const result = createLeadSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.flatten() });
  }

  try {
    const lead = await createLead(req.user.businessId, result.data);

    /* Non-blocking broadcast — never let WS failure affect the HTTP response */
    try {
      emitLeadCreated(req.user.businessId, lead);
    } catch (wsErr) {
      console.error('[LeadsController] broadcast lead:new failed:', wsErr.message);
    }

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
    broadcast(req.user.businessId, 'lead:status_changed', { id: req.params.id, status: result.data.status });
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
    broadcast(req.user.businessId, 'lead:deleted', { id: req.params.id });
    return res.status(204).send();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const activity = async (req, res) => {
  try {
    const result = await getLeadActivity(req.params.id, req.user.businessId);
    if (!result) return res.status(404).json({ error: 'Lead not found' });
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const runAction = async (req, res) => {
  const result = operatorActionSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.flatten() });
  }

  try {
    const actionResult = await runLeadOperatorAction(req.params.id, req.user.businessId, result.data);
    if (!actionResult) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (actionResult.statusChanged) {
      broadcast(req.user.businessId, 'lead:status_changed', {
        id: req.params.id,
        status: actionResult.status,
      });
    }

    return res.json(actionResult.data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { create, list, updateStatus, runAction, remove, activity, buildLeadRealtimePayload, emitLeadCreated };
