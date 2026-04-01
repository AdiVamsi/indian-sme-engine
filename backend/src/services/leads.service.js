'use strict';

const { AgentEngine } = require('../agents');
const { buildWhatsAppConversationSummary } = require('./leadConversation.service');
const { APPOINTMENT_WITH_LEAD_SELECT } = require('./appointments.service');
const { LEGACY_SAFE_LEAD_SELECT, isMissingLeadSnoozedUntilColumnError } = require('../lib/leadCompat');
const { prisma } = require('../lib/prisma');
const { logger } = require('../lib/logger');

const VALID_SNOOZE_DAYS = new Set([1, 3, 7]);

function decorateLead(lead, {
  priorityScore = 0,
  tags = [],
  source = 'web',
  externalMessageId = null,
  receivedAt = null,
  hasClassification = false,
  hasPrioritization = false,
  conversationStatus = null,
  whatsappDeliveryStatus = null,
  whatsappNeedsAttention = false,
  whatsappFailureTitle = null,
  whatsappFailureDetail = null,
  whatsappFailureCategory = null,
  whatsappFailureAt = null,
  whatsappOperatorActionRequired = null,
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
    hasClassification,
    hasPrioritization,
    conversationStatus,
    handoffReady: conversationStatus === 'handoff',
    whatsappDeliveryStatus,
    whatsappNeedsAttention,
    whatsappFailureTitle,
    whatsappFailureDetail,
    whatsappFailureCategory,
    whatsappFailureAt,
    whatsappOperatorActionRequired,
  };
}

function getSortedActivitiesNewestFirst(activities = []) {
  return [...activities].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function parseScheduledDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getLatestSnoozedUntilFromActivities(activities = []) {
  const latestSnooze = getSortedActivitiesNewestFirst(activities).find((activity) =>
    activity?.metadata?.reason === 'OPERATOR_SNOOZED_QUEUE'
    && parseScheduledDate(activity?.metadata?.snoozedUntil)
  );

  return latestSnooze ? parseScheduledDate(latestSnooze.metadata?.snoozedUntil) : null;
}

function withDerivedSnoozedUntil(lead, activities = []) {
  if (!lead?.id || lead.snoozedUntil) return lead;

  const derivedSnoozedUntil = getLatestSnoozedUntilFromActivities(activities);
  if (!derivedSnoozedUntil) return lead;

  return {
    ...lead,
    snoozedUntil: derivedSnoozedUntil,
  };
}

function buildLeadSelect({ includeSnoozedUntil = false } = {}) {
  return {
    ...LEGACY_SAFE_LEAD_SELECT,
    ...(includeSnoozedUntil ? { snoozedUntil: true } : {}),
  };
}

function getLatestWhatsAppConversationState(activities = []) {
  for (const activity of getSortedActivitiesNewestFirst(activities)) {
    const metadata = activity?.metadata || {};
    if (metadata.channel === 'whatsapp' && metadata.conversationState) {
      return metadata.conversationState;
    }
  }

  return null;
}

function getLatestCallbackDetails(activities = []) {
  const latest = activities.find((activity) =>
    activity.type === 'FOLLOW_UP_SCHEDULED'
    && activity?.metadata?.reason === 'OPERATOR_CALLBACK_SCHEDULED'
  );

  if (!latest) {
    return {
      callbackTime: null,
      callbackAt: null,
      callbackScheduledAt: null,
    };
  }

  return {
    callbackTime: latest.metadata?.callbackTime || null,
    callbackAt: latest.metadata?.callbackAt || null,
    callbackScheduledAt: latest.createdAt || null,
  };
}

function getLatestConversationStatus(activities = []) {
  const latest = getSortedActivitiesNewestFirst(activities).find((activity) => {
    const metadata = activity?.metadata || {};
    return metadata.channel === 'whatsapp' && metadata.conversationState?.status;
  });

  return latest?.metadata?.conversationState?.status || null;
}

function getLatestWhatsAppDeliveryIssue(activities = []) {
  const latestOutbound = getLatestWhatsAppOutboundActivity(activities);

  if (!latestOutbound || latestOutbound?.metadata?.deliveryStatus !== 'failed') {
    return null;
  }

  return {
    deliveryStatus: 'failed',
    failureTitle: latestOutbound.metadata?.failureTitle || 'WhatsApp reply failed',
    failureDetail: latestOutbound.metadata?.failureDetail || latestOutbound.message || null,
    failureCategory: latestOutbound.metadata?.failureCategory || null,
    failureAt: latestOutbound.createdAt || null,
    operatorActionRequired: latestOutbound.metadata?.operatorActionRequired || null,
  };
}

function getLatestWhatsAppOutboundActivity(activities = []) {
  return getSortedActivitiesNewestFirst(activities).find((activity) => {
    const metadata = activity?.metadata || {};
    return metadata.channel === 'whatsapp' && metadata.direction === 'outbound';
  });
}

function buildLeadActivitySummary(activities = []) {
  const classAct = activities.find((a) => a.type === 'AGENT_CLASSIFIED');
  const prioAct = activities.find((a) => a.type === 'AGENT_PRIORITIZED');
  const callback = getLatestCallbackDetails(activities);
  const conversationStatus = getLatestConversationStatus(activities);
  const latestOutbound = getLatestWhatsAppOutboundActivity(activities);
  const whatsappDeliveryIssue = getLatestWhatsAppDeliveryIssue(activities);

  const tags = classAct?.metadata?.tags ?? [];
  const priorityScore = prioAct?.metadata?.priorityScore ?? 0;
  const source = classAct?.metadata?.source ?? 'web';
  const priority = priorityScore >= 30 ? 'HIGH'
    : priorityScore >= 10 ? 'NORMAL'
      : 'LOW';

  return {
    tags,
    priorityScore,
    source,
    priority,
    callbackTime: callback.callbackTime,
    callbackAt: callback.callbackAt,
    callbackScheduledAt: callback.callbackScheduledAt,
    conversationStatus,
    handoffReady: conversationStatus === 'handoff',
    hasClassification: Boolean(classAct),
    hasPrioritization: Boolean(prioAct),
    whatsappDeliveryStatus: whatsappDeliveryIssue?.deliveryStatus || latestOutbound?.metadata?.deliveryStatus || null,
    whatsappNeedsAttention: Boolean(whatsappDeliveryIssue),
    whatsappFailureTitle: whatsappDeliveryIssue?.failureTitle || null,
    whatsappFailureDetail: whatsappDeliveryIssue?.failureDetail || null,
    whatsappFailureCategory: whatsappDeliveryIssue?.failureCategory || null,
    whatsappFailureAt: whatsappDeliveryIssue?.failureAt || null,
    whatsappOperatorActionRequired: whatsappDeliveryIssue?.operatorActionRequired || null,
  };
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
    isActivationTest = false,
    ...leadData
  } = data;

  const lead = await prisma.lead.create({
    data: { businessId, isActivationTest, ...leadData },
    select: LEGACY_SAFE_LEAD_SELECT,
  });

  return decorateLead(lead, {
    source,
    externalMessageId,
    receivedAt,
    hasClassification: false,
    hasPrioritization: false,
  });
};

const findActiveWhatsAppLead = async (businessId, phone) => {
  const leads = await prisma.lead.findMany({
    where: {
      businessId,
      isActivationTest: false,
      phone,
      status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      ...LEGACY_SAFE_LEAD_SELECT,
      activities: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  return leads.find((lead) => {
    const state = getLatestWhatsAppConversationState(lead.activities);
    return state && ['awaiting_user', 'handoff', 'send_failed'].includes(state.status);
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
  let conversationStatus = null;
  let whatsappDeliveryStatus = null;
  let whatsappNeedsAttention = false;
  let whatsappFailureTitle = null;
  let whatsappFailureDetail = null;
  let whatsappFailureCategory = null;
  let whatsappFailureAt = null;
  let whatsappOperatorActionRequired = null;

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
  conversationStatus = result.conversationState?.status || null;
  whatsappDeliveryStatus = result.whatsappReplyFailed
    ? 'failed'
    : result.whatsappReplySent
      ? 'sent'
      : null;
  whatsappNeedsAttention = Boolean(result.whatsappReplyFailed);
  whatsappFailureTitle = result.whatsappFailure?.title || null;
  whatsappFailureDetail = result.whatsappFailure?.detail || null;
  whatsappFailureCategory = result.whatsappFailure?.category || null;
  whatsappFailureAt = result.whatsappFailureAt || null;
  whatsappOperatorActionRequired = result.whatsappFailure?.operatorActionRequired || null;

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
    hasClassification: true,
    hasPrioritization: true,
    conversationStatus,
    whatsappDeliveryStatus,
    whatsappNeedsAttention,
    whatsappFailureTitle,
    whatsappFailureDetail,
    whatsappFailureCategory,
    whatsappFailureAt,
    whatsappOperatorActionRequired,
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
    where:   { businessId, isActivationTest: false, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
    select: {
      ...LEGACY_SAFE_LEAD_SELECT,
      activities: {
        where:   { type: { in: ['AGENT_CLASSIFIED', 'AGENT_PRIORITIZED', 'FOLLOW_UP_SCHEDULED', 'AUTOMATION_ALERT'] } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  return leads.map(({ activities, ...lead }) => {
    return {
      ...lead,
      ...buildLeadActivitySummary(activities),
    };
  });
};

const updateLeadStatus = async (id, businessId, status) => {
  const existing = await prisma.lead.findFirst({
    where: { id, businessId, isActivationTest: false },
    select: { id: true, status: true },
  });
  if (!existing) return { count: 0 };
  await prisma.$transaction([
    prisma.lead.update({
      where: { id },
      data: { status },
      select: { id: true },
    }),
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
  callbackAt = '',
  snoozeDays = undefined,
} = {}) => {
  const lead = await prisma.lead.findFirst({
    where: { id, businessId, isActivationTest: false },
    select: {
      ...LEGACY_SAFE_LEAD_SELECT,
      activities: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!lead) return null;

  const operatorNote = String(note || '').trim() || null;
  const normalizedCallbackTime = String(callbackTime || '').trim() || null;
  const normalizedCallbackAt = String(callbackAt || '').trim() || null;
  const parsedCallbackAt = parseScheduledDate(normalizedCallbackAt);
  const normalizedSnoozeDays = VALID_SNOOZE_DAYS.has(snoozeDays) ? snoozeDays : null;
  const latestConversationState = getLatestWhatsAppConversationState(lead.activities);
  const whatsappConversation = buildWhatsAppConversationSummary({ lead, activities: lead.activities });

  let nextStatus = lead.status;
  let activityType = 'AUTOMATION_ALERT';
  let leadUpdateData = {};
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
      if (!parsedCallbackAt && !normalizedCallbackTime) {
        throw new Error('Callback date and time are required.');
      }

      const callbackSummary = normalizedCallbackTime
        ? `Callback scheduled for ${normalizedCallbackTime}.`
        : 'Callback scheduled for follow-up.';
      message = operatorNote ? `${callbackSummary} Note: ${operatorNote}` : callbackSummary;
      metadata = {
        ...metadata,
        reason: 'OPERATOR_CALLBACK_SCHEDULED',
        callbackTime: normalizedCallbackTime,
        callbackAt: parsedCallbackAt ? parsedCallbackAt.toISOString() : null,
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

    case 'ADD_NOTE':
      if (!operatorNote) {
        throw new Error('Operator note is required.');
      }
      message = `Operator note added. Note: ${operatorNote}`;
      metadata = {
        ...metadata,
        reason: 'OPERATOR_NOTE_ADDED',
        operatorNote,
      };
      break;

    case 'SNOOZE': {
      if (!normalizedSnoozeDays) {
        throw new Error('Unsupported snooze duration.');
      }

      const snoozedUntil = new Date(Date.now() + normalizedSnoozeDays * 24 * 60 * 60 * 1000);
      message = `Operator snoozed this lead for ${normalizedSnoozeDays} day${normalizedSnoozeDays === 1 ? '' : 's'}.`;
      metadata = {
        ...metadata,
        reason: 'OPERATOR_SNOOZED_QUEUE',
        snoozeDays: normalizedSnoozeDays,
        snoozedUntil: snoozedUntil.toISOString(),
      };
      leadUpdateData = {
        snoozedUntil,
      };
      break;
    }

    default:
      throw new Error(`Unsupported lead operator action: ${action}`);
  }

  const statusChanged = nextStatus !== lead.status;

  const persistAction = async ({ persistSnoozedUntil = true } = {}) => {
    await prisma.$transaction(async (tx) => {
      const nextLeadData = {
        ...(statusChanged ? { status: nextStatus } : {}),
        ...(persistSnoozedUntil ? leadUpdateData : {}),
      };

      if (Object.keys(nextLeadData).length > 0) {
        await tx.lead.update({
          where: { id },
          data: nextLeadData,
          select: { id: true },
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
  };

  try {
    await persistAction();
  } catch (err) {
    if (!(action === 'SNOOZE' && isMissingLeadSnoozedUntilColumnError(err))) {
      throw err;
    }

    await persistAction({ persistSnoozedUntil: false });
  }

  logger.info(
    {
      businessId,
      leadId: id,
      action,
      statusChanged,
      previousStatus: lead.status,
      nextStatus,
      callbackTime: normalizedCallbackTime,
      callbackAt: parsedCallbackAt ? parsedCallbackAt.toISOString() : null,
      snoozeDays: normalizedSnoozeDays,
      hasNote: Boolean(operatorNote),
    },
    'Lead operator action completed'
  );

  const refreshed = await getLeadActivity(id, businessId);
  return {
    data: refreshed,
    statusChanged,
    status: nextStatus,
  };
};

const deleteLead = (id, businessId) =>
  prisma.lead.deleteMany({ where: { id, businessId, isActivationTest: false } });

const getLeadActivity = async (id, businessId, { includeActivationTest = false } = {}) => {
  const buildLeadActivityQuery = (includeSnoozedUntil = false) => ({
    where: {
      leadId: id,
      lead: {
        businessId,
        ...(includeActivationTest ? {} : { isActivationTest: false }),
      },
    },
    include: {
      lead: {
        select: buildLeadSelect({ includeSnoozedUntil }),
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  /* Single query: filter by lead relation for multi-tenant safety */
  let rows;
  try {
    rows = await prisma.leadActivity.findMany(buildLeadActivityQuery(true));
  } catch (err) {
    if (!isMissingLeadSnoozedUntilColumnError(err)) throw err;
    rows = await prisma.leadActivity.findMany(buildLeadActivityQuery(false));
  }

  if (!rows.length) {
    /* No activities yet — confirm lead exists for this business */
    let existing;
    try {
      existing = await prisma.lead.findFirst({
        where: {
          id,
          businessId,
          ...(includeActivationTest ? {} : { isActivationTest: false }),
        },
        select: buildLeadSelect({ includeSnoozedUntil: true }),
      });
    } catch (err) {
      if (!isMissingLeadSnoozedUntilColumnError(err)) throw err;
      existing = await prisma.lead.findFirst({
        where: {
          id,
          businessId,
          ...(includeActivationTest ? {} : { isActivationTest: false }),
        },
        select: buildLeadSelect(),
      });
    }
    if (!existing) return null;
    const appointments = await prisma.appointment.findMany({
      where: { businessId, leadId: id },
      orderBy: { scheduledAt: 'asc' },
      select: APPOINTMENT_WITH_LEAD_SELECT,
    });
    return {
      lead: withDerivedSnoozedUntil(existing, []),
      activities: [],
      appointments,
      whatsappConversation: buildWhatsAppConversationSummary({ lead: existing, activities: [] }),
    };
  }

  const activities = rows.map(({ lead: _l, ...act }) => act);
  const lead       = withDerivedSnoozedUntil(rows[0].lead, activities);
  const appointments = await prisma.appointment.findMany({
    where: { businessId, leadId: id },
    orderBy: { scheduledAt: 'asc' },
    select: APPOINTMENT_WITH_LEAD_SELECT,
  });
  return {
    lead,
    activities,
    appointments,
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
    where:   { id, businessId, isActivationTest: false },
    select: {
      ...LEGACY_SAFE_LEAD_SELECT,
      activities: { orderBy: { createdAt: 'asc' } },
    },
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
    where:   { id, businessId, isActivationTest: false },
    select: {
      ...LEGACY_SAFE_LEAD_SELECT,
      activities: { orderBy: { createdAt: 'asc' } },
    },
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
  buildLeadActivitySummary,
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
