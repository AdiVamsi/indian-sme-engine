'use strict';

const { AgentEngine } = require('../agents');
const { buildWhatsAppConversationSummary } = require('./leadConversation.service');
const { prisma } = require('../lib/prisma');
const { logger } = require('../lib/logger');

function decorateLead(lead, {
  priorityScore = 0,
  tags = [],
  source = 'web',
  externalMessageId = null,
  receivedAt = null,
} = {}) {
  const priority = priorityScore >= 30 ? 'HIGH' : priorityScore >= 10 ? 'NORMAL' : 'LOW';

  return {
    ...lead,
    priorityScore,
    tags,
    priority,
    source,
    externalMessageId,
    receivedAt,
  };
}

function getLatestWhatsAppConversationState(activities = []) {
  for (const activity of activities) {
    const metadata = activity?.metadata || {};
    if (metadata.channel === 'whatsapp' && metadata.conversationState) {
      return metadata.conversationState;
    }
  }

  return null;
}

function mergeConversationState(baseState = null, {
  flowIntent,
  stage,
  pendingField,
  status,
  collected = {},
} = {}) {
  return {
    version: baseState?.version || 1,
    channel: 'whatsapp',
    flowIntent: flowIntent ?? baseState?.flowIntent ?? null,
    stage: stage ?? baseState?.stage ?? 'HANDOFF_QUEUED',
    pendingField: pendingField ?? baseState?.pendingField ?? null,
    collected: {
      ...(baseState?.collected || {}),
      ...collected,
    },
    status: status ?? baseState?.status ?? 'handoff',
  };
}

const saveRawLead = async (businessId, data) => {
  const {
    source = 'web',
    externalMessageId = null,
    receivedAt = null,
    ...leadData
  } = data;

  const lead = await prisma.lead.create({ data: { businessId, ...leadData } });

  return decorateLead(lead, {
    source,
    externalMessageId,
    receivedAt,
  });
};

const findActiveWhatsAppLead = async (businessId, phone) => {
  const leads = await prisma.lead.findMany({
    where: {
      businessId,
      phone,
      status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: {
      activities: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  return leads.find((lead) => {
    const state = getLatestWhatsAppConversationState(lead.activities);
    return state && ['awaiting_user', 'handoff'].includes(state.status);
  }) || null;
};

const processLeadAfterSave = async (lead, {
  businessId,
  source = 'web',
  externalMessageId = null,
  receivedAt = null,
} = {}) => {
  let priorityScore = 0;
  let tags = [];
  let leadSource = source;

  /* Run agent pipeline; capture scores for broadcast payload.
   * Errors are logged but never fail the caller. */
  const result = await AgentEngine.run({
    type: 'LEAD_CREATED',
    leadId: lead.id,
    businessId: lead.businessId,
    source,
    externalMessageId,
    receivedAt,
  });
  priorityScore = result.priorityScore ?? 0;
  tags = result.tags ?? [];
  leadSource = result.source ?? source;

  /* Advance lifecycle stage on the first successful lead — "lead workflow is now active".
   * updateMany with stage: 'STARTING' in the where clause is a no-op for all other stages. */
  await prisma.business.updateMany({
    where: { id: businessId, stage: 'STARTING' },
    data:  { stage: 'LEADS_ACTIVE' },
  });

  return decorateLead(lead, {
    priorityScore,
    tags,
    source: leadSource,
    externalMessageId,
    receivedAt,
  });
};

const createLead = async (businessId, data) => {
  const lead = await saveRawLead(businessId, data);

  try {
    return await processLeadAfterSave(lead, {
      businessId,
      source: lead.source,
      externalMessageId: lead.externalMessageId,
      receivedAt: lead.receivedAt,
    });
  } catch (err) {
    logger.error({ err, leadId: lead.id, businessId }, 'AgentEngine failed after lead save');
    return lead;
  }
};

const findLeadsByBusiness = async (businessId, status) => {
  const leads = await prisma.lead.findMany({
    where:   { businessId, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
    include: {
      activities: {
        where:   { type: { in: ['AGENT_CLASSIFIED', 'AGENT_PRIORITIZED'] } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  return leads.map(({ activities, ...lead }) => {
    const classAct = activities.find((a) => a.type === 'AGENT_CLASSIFIED');
    const prioAct  = activities.find((a) => a.type === 'AGENT_PRIORITIZED');

    const tags          = classAct?.metadata?.tags         ?? [];
    const priorityScore = prioAct?.metadata?.priorityScore ?? 0;
    const source        = classAct?.metadata?.source       ?? 'web';
    const priority      = priorityScore >= 30 ? 'HIGH'
                        : priorityScore >= 10 ? 'NORMAL'
                        :                       'LOW';

    return { ...lead, priorityScore, tags, priority, source };
  });
};

const updateLeadStatus = async (id, businessId, status) => {
  const existing = await prisma.lead.findFirst({ where: { id, businessId } });
  if (!existing) return { count: 0 };
  await prisma.$transaction([
    prisma.lead.update({ where: { id }, data: { status } }),
    prisma.leadActivity.create({
      data: {
        leadId:   id,
        type:     'STATUS_CHANGED',
        message:  `Status changed from ${existing.status} to ${status}`,
        metadata: { oldStatus: existing.status, newStatus: status },
      },
    }),
  ]);
  return { count: 1 };
};

const runLeadOperatorAction = async (id, businessId, {
  action,
  note = '',
  callbackTime = '',
} = {}) => {
  const lead = await prisma.lead.findFirst({
    where: { id, businessId },
    include: {
      activities: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!lead) return null;

  const operatorNote = String(note || '').trim() || null;
  const normalizedCallbackTime = String(callbackTime || '').trim() || null;
  const latestConversationState = getLatestWhatsAppConversationState(lead.activities);
  const whatsappConversation = buildWhatsAppConversationSummary({ lead, activities: lead.activities });

  let nextStatus = lead.status;
  let activityType = 'AUTOMATION_ALERT';
  let message = '';
  let metadata = {
    reason: null,
    channel: 'operator',
    operatorAction: action,
  };

  switch (action) {
    case 'MARK_CALLED':
      if (lead.status === 'NEW') nextStatus = 'CONTACTED';
      message = operatorNote
        ? `Operator marked this lead as called. Note: ${operatorNote}`
        : 'Operator marked this lead as called.';
      metadata = {
        ...metadata,
        reason: 'OPERATOR_MARKED_CALLED',
        operatorNote,
      };
      break;

    case 'SCHEDULE_CALLBACK': {
      activityType = 'FOLLOW_UP_SCHEDULED';
      const callbackSummary = normalizedCallbackTime
        ? `Callback scheduled for ${normalizedCallbackTime}.`
        : 'Callback scheduled for follow-up.';
      message = operatorNote ? `${callbackSummary} Note: ${operatorNote}` : callbackSummary;
      metadata = {
        ...metadata,
        reason: 'OPERATOR_CALLBACK_SCHEDULED',
        callbackTime: normalizedCallbackTime,
        operatorNote,
      };

      if (whatsappConversation) {
        metadata.channel = 'whatsapp';
        metadata.conversationState = mergeConversationState(latestConversationState, {
          stage: 'HANDOFF_QUEUED',
          pendingField: null,
          status: 'handoff',
          collected: normalizedCallbackTime ? { preferredCallTime: normalizedCallbackTime } : {},
        });
      }
      break;
    }

    case 'SEND_FEE_DETAILS':
      if (lead.status === 'NEW') nextStatus = 'CONTACTED';
      message = operatorNote
        ? `Operator sent fee details to the lead. Note: ${operatorNote}`
        : 'Operator sent fee details to the lead.';
      metadata = {
        ...metadata,
        reason: 'OPERATOR_FEE_DETAILS_SENT',
        operatorNote,
      };
      break;

    case 'MARK_HANDOFF_COMPLETE':
      if (lead.status === 'NEW' || lead.status === 'CONTACTED') nextStatus = 'QUALIFIED';
      message = operatorNote
        ? `Operator marked the WhatsApp handoff as complete. Note: ${operatorNote}`
        : 'Operator marked the WhatsApp handoff as complete.';
      metadata = {
        ...metadata,
        reason: 'OPERATOR_HANDOFF_COMPLETED',
        channel: 'whatsapp',
        operatorNote,
        conversationState: mergeConversationState(latestConversationState, {
          stage: 'HANDOFF_COMPLETED',
          pendingField: null,
          status: 'closed',
        }),
      };
      break;

    default:
      throw new Error(`Unsupported lead operator action: ${action}`);
  }

  const statusChanged = nextStatus !== lead.status;

  await prisma.$transaction(async (tx) => {
    if (statusChanged) {
      await tx.lead.update({
        where: { id },
        data: { status: nextStatus },
      });
    }

    await tx.leadActivity.create({
      data: {
        leadId: id,
        type: activityType,
        message,
        metadata,
      },
    });
  });

  const refreshed = await getLeadActivity(id, businessId);
  return {
    data: refreshed,
    statusChanged,
    status: nextStatus,
  };
};

const deleteLead = (id, businessId) =>
  prisma.lead.deleteMany({ where: { id, businessId } });

const getLeadActivity = async (id, businessId) => {
  /* Single query: filter by lead relation for multi-tenant safety */
  const rows = await prisma.leadActivity.findMany({
    where: { leadId: id, lead: { businessId } },
    include: {
      lead: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          message: true,
          status: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (!rows.length) {
    /* No activities yet — confirm lead exists for this business */
    const existing = await prisma.lead.findFirst({ where: { id, businessId } });
    if (!existing) return null;
    return {
      lead: existing,
      activities: [],
      whatsappConversation: buildWhatsAppConversationSummary({ lead: existing, activities: [] }),
    };
  }

  const lead       = rows[0].lead;
  const activities = rows.map(({ lead: _l, ...act }) => act);
  return {
    lead,
    activities,
    whatsappConversation: buildWhatsAppConversationSummary({ lead, activities }),
  };
};

/**
 * getLeadForSuggestions
 * Fetches a lead with all its activities, enriching tags and priorityScore
 * from the AGENT_CLASSIFIED / AGENT_PRIORITIZED activity metadata so that
 * the suggestion engine receives the full picture.
 */
const getLeadForSuggestions = async (id, businessId) => {
  const lead = await prisma.lead.findFirst({
    where:   { id, businessId },
    include: { activities: { orderBy: { createdAt: 'asc' } } },
  });
  if (!lead) return null;

  const classAct = lead.activities.find((a) => a.type === 'AGENT_CLASSIFIED');
  const prioAct  = lead.activities.find((a) => a.type === 'AGENT_PRIORITIZED');

  return {
    ...lead,
    tags:          classAct?.metadata?.tags          ?? [],
    priorityScore: prioAct?.metadata?.priorityScore  ?? 0,
    source:        classAct?.metadata?.source        ?? 'web',
  };
};

/**
 * getLeadForOutreach
 * Same enrichment pattern as getLeadForSuggestions — used by the outreach
 * draft engine to access tags, priorityScore, and the full activity list.
 */
const getLeadForOutreach = async (id, businessId) => {
  const lead = await prisma.lead.findFirst({
    where:   { id, businessId },
    include: { activities: { orderBy: { createdAt: 'asc' } } },
  });
  if (!lead) return null;

  const classAct = lead.activities.find((a) => a.type === 'AGENT_CLASSIFIED');
  const prioAct  = lead.activities.find((a) => a.type === 'AGENT_PRIORITIZED');

  return {
    ...lead,
    tags:          classAct?.metadata?.tags         ?? [],
    priorityScore: prioAct?.metadata?.priorityScore ?? 0,
    source:        classAct?.metadata?.source       ?? 'web',
  };
};

module.exports = {
  createLead,
  saveRawLead,
  processLeadAfterSave,
  findActiveWhatsAppLead,
  findLeadsByBusiness,
  updateLeadStatus,
  runLeadOperatorAction,
  deleteLead,
  getLeadActivity,
  getLeadForSuggestions,
  getLeadForOutreach,
};
