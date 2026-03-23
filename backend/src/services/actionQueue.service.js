'use strict';

const { prisma } = require('../lib/prisma');
const { isMissingLeadSnoozedUntilColumnError } = require('../lib/leadCompat');
const { getLeadSuggestions } = require('../agents/leadSuggestions');
const { getOutreachDraft } = require('../agents/outreachDrafts');

const TERMINAL_LEAD_STATUSES = new Set(['WON', 'LOST']);
// Keep "needs attention" aligned with the repo's actionable lead lifecycle.
const ACTIVE_LEAD_STATUSES = new Set(['NEW', 'CONTACTED', 'QUALIFIED']);
// WhatsApp conversation turns, handoff state, and delivery failures are stored on AUTOMATION_ALERT rows.
const QUEUE_ACTIVITY_TYPES = [
  'AGENT_CLASSIFIED',
  'AGENT_PRIORITIZED',
  'FOLLOW_UP_SCHEDULED',
  'STATUS_CHANGED',
  'AUTOMATION_ALERT',
  'AUTOMATION_DEMO_INTENT',
  'AUTOMATION_ADMISSION_INTENT',
];
const DUE_SOON_WINDOW_MS = 30 * 60 * 1000;
const MESSAGE_PREVIEW_MAX = 160;
const OUTREACH_PREVIEW_MAX = 180;

function truncateText(value, max = MESSAGE_PREVIEW_MAX) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function derivePriorityFromScore(score = 0) {
  if (score >= 30) return 'HIGH';
  if (score >= 10) return 'NORMAL';
  return 'LOW';
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getLatestMatchingActivity(activities = [], predicate) {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    if (predicate(activities[index])) return activities[index];
  }

  return null;
}

function isActivityAfter(activity, referenceActivity = null) {
  if (!activity) return false;
  if (!referenceActivity) return true;
  return new Date(activity.createdAt).getTime() > new Date(referenceActivity.createdAt).getTime();
}

function getLatestClassificationActivity(activities = []) {
  return getLatestMatchingActivity(activities, (activity) => activity.type === 'AGENT_CLASSIFIED');
}

function getLatestPrioritizationActivity(activities = []) {
  return getLatestMatchingActivity(activities, (activity) => activity.type === 'AGENT_PRIORITIZED');
}

function getLatestMachineFollowUpActivity(activities = []) {
  return getLatestMatchingActivity(activities, (activity) =>
    activity.type === 'FOLLOW_UP_SCHEDULED'
    && activity?.metadata?.reason !== 'OPERATOR_CALLBACK_SCHEDULED'
    && Boolean(parseDate(activity?.metadata?.followUpAt))
  );
}

function getLatestOperatorCallbackActivity(activities = []) {
  return getLatestMatchingActivity(activities, (activity) =>
    activity.type === 'FOLLOW_UP_SCHEDULED'
    && activity?.metadata?.reason === 'OPERATOR_CALLBACK_SCHEDULED'
    && Boolean(parseDate(activity?.metadata?.callbackAt))
  );
}

function isOperatorHandledActivity(activity) {
  const metadata = activity?.metadata || {};

  if (activity?.type === 'STATUS_CHANGED') return true;
  if (metadata.operatorAction) return true;
  if (activity?.type === 'FOLLOW_UP_SCHEDULED' && metadata.reason === 'OPERATOR_CALLBACK_SCHEDULED') {
    return true;
  }

  return false;
}

function getLatestOperatorActivity(activities = [], { after = null } = {}) {
  const afterTime = after ? new Date(after).getTime() : null;

  return getLatestMatchingActivity(activities, (activity) => {
    if (!isOperatorHandledActivity(activity)) return false;
    if (afterTime === null) return true;
    return new Date(activity.createdAt).getTime() > afterTime;
  });
}

function getLatestWhatsAppConversationState(activities = []) {
  const activity = getLatestMatchingActivity(activities, (item) =>
    item?.metadata?.channel === 'whatsapp' && Boolean(item?.metadata?.conversationState)
  );

  return activity?.metadata?.conversationState || null;
}

function getLatestWhatsAppFailureActivity(activities = []) {
  return getLatestMatchingActivity(activities, (activity) => (
    activity?.metadata?.channel === 'whatsapp'
    && activity?.metadata?.direction === 'outbound'
    && activity?.metadata?.deliveryStatus === 'failed'
  ));
}

function hasOutboundWhatsAppReplyAfter(activities = [], after = null) {
  const afterTime = after ? new Date(after).getTime() : null;

  return activities.some((activity) => {
    const metadata = activity?.metadata || {};
    if (metadata.channel !== 'whatsapp' || metadata.direction !== 'outbound') return false;
    if (afterTime === null) return true;
    return new Date(activity.createdAt).getTime() > afterTime;
  });
}

function buildQueueReason(code, label, detail) {
  return { code, label, detail };
}

function getLatestRelevantActivityAt(lead, activities = []) {
  return activities[activities.length - 1]?.createdAt || lead.createdAt;
}

function getLatestFollowUpDueAt(activities = [], { latestOperatorActivity = null } = {}) {
  const followUpActivity = getLatestMachineFollowUpActivity(activities);
  if (!followUpActivity) return null;

  if (
    latestOperatorActivity
    && new Date(latestOperatorActivity.createdAt).getTime() > new Date(followUpActivity.createdAt).getTime()
  ) {
    return null;
  }

  return parseDate(followUpActivity.metadata?.followUpAt);
}

function getLatestCallbackDueAt(activities = []) {
  const callbackActivity = getLatestOperatorCallbackActivity(activities);
  if (!callbackActivity) return null;

  const laterOperatorActivity = getLatestOperatorActivity(activities, {
    after: callbackActivity.createdAt,
  });
  if (laterOperatorActivity) return null;

  return parseDate(callbackActivity.metadata?.callbackAt);
}

function buildQueueReasons(lead, activities = [], now = new Date()) {
  const classificationActivity = getLatestClassificationActivity(activities);
  const prioritizationActivity = getLatestPrioritizationActivity(activities);
  const classification = classificationActivity?.metadata || {};
  const prioritization = prioritizationActivity?.metadata || {};
  const latestOperatorActivity = getLatestOperatorActivity(activities, {
    after: classificationActivity?.createdAt || null,
  });
  const followUpDueAt = getLatestFollowUpDueAt(activities, { latestOperatorActivity });
  const callbackDueAt = getLatestCallbackDueAt(activities);
  const dueAt = [followUpDueAt, callbackDueAt]
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime())[0] || null;
  const conversationState = getLatestWhatsAppConversationState(activities);
  const latestWhatsAppFailure = getLatestWhatsAppFailureActivity(activities);

  const priorityScore = prioritization.priorityScore ?? 0;
  const priority = prioritization.priorityLabel || derivePriorityFromScore(priorityScore);
  const source = classification.source || 'web';
  const confidenceLabel = classification.confidenceLabel || null;
  const disposition = classification.leadDisposition || null;
  const via = classification.via || null;
  const isActiveLead = ACTIVE_LEAD_STATUSES.has(String(lead.status || '').toUpperCase());
  const hasOperatorTouchAfterClassification = Boolean(latestOperatorActivity);
  const isFollowUpOverdue = Boolean(followUpDueAt && followUpDueAt.getTime() <= now.getTime());
  const isOverdue = Boolean(dueAt && dueAt.getTime() <= now.getTime());
  const isDueSoon = Boolean(
    dueAt
    && dueAt.getTime() > now.getTime()
    && dueAt.getTime() <= now.getTime() + DUE_SOON_WINDOW_MS
  );
  const hasOutboundWhatsAppReply = hasOutboundWhatsAppReplyAfter(activities, classificationActivity?.createdAt || null);
  const isCallbackDue = Boolean(
    callbackDueAt
    && callbackDueAt.getTime() <= now.getTime() + DUE_SOON_WINDOW_MS
  );
  const isCallbackOverdue = Boolean(callbackDueAt && callbackDueAt.getTime() <= now.getTime());
  const hasOutstandingWhatsAppFailure = Boolean(
    latestWhatsAppFailure
    && isActivityAfter(latestWhatsAppFailure, latestOperatorActivity)
  );
  const needsWhatsAppHandoff = conversationState?.status === 'handoff' && !hasOperatorTouchAfterClassification;
  const needsInitialWhatsAppResponse = !hasOperatorTouchAfterClassification && !hasOutboundWhatsAppReply;

  const reasons = [];

  if (isActiveLead && priority === 'HIGH' && !hasOperatorTouchAfterClassification) {
    reasons.push(buildQueueReason(
      'HIGH_PRIORITY',
      'High priority lead',
      `AI scored this lead ${priorityScore}, so it should be handled before lower-priority enquiries.`
    ));
  }

  if (isActiveLead && isFollowUpOverdue) {
    reasons.push(buildQueueReason(
      'FOLLOW_UP_OVERDUE',
      'Follow-up overdue',
      'The latest AI follow-up target has already passed and still needs an operator touch.'
    ));
  }

  if (isActiveLead && isCallbackDue) {
    reasons.push(buildQueueReason(
      'CALLBACK_DUE',
      isCallbackOverdue ? 'Callback overdue' : 'Callback due soon',
      'A scheduled callback time is now due, so this lead needs operator follow-up.'
    ));
  }

  if (isActiveLead && classificationActivity && !hasOperatorTouchAfterClassification) {
    reasons.push(buildQueueReason(
      'UNHANDLED_AFTER_CLASSIFICATION',
      'No operator action yet',
      'AI has already classified this lead, but no human action is recorded after that point.'
    ));
  }

  if (
    isActiveLead
    && source === 'whatsapp'
    && (
      hasOutstandingWhatsAppFailure
      || needsWhatsAppHandoff
      || needsInitialWhatsAppResponse
    )
  ) {
    const detail = hasOutstandingWhatsAppFailure
      ? (latestWhatsAppFailure.metadata?.operatorActionRequired || latestWhatsAppFailure.metadata?.failureDetail || 'The latest outbound WhatsApp reply failed and needs a manual follow-up.')
      : needsWhatsAppHandoff
        ? 'The AI handoff is ready, so a human should continue the WhatsApp conversation.'
        : 'This WhatsApp lead does not have a logged operator follow-up yet.';

    reasons.push(buildQueueReason(
      'WHATSAPP_RESPONSE_REQUIRED',
      'WhatsApp follow-up needed',
      detail
    ));
  }

  if (
    isActiveLead
    && classificationActivity
    && !hasOperatorTouchAfterClassification
    && (
      confidenceLabel === 'low'
      || disposition === 'weak'
      || disposition === 'conflicting'
      || via === 'llm_fallback'
    )
  ) {
    reasons.push(buildQueueReason(
      'LOW_CONFIDENCE_REVIEW',
      'Needs classification review',
      'The AI result is weak, conflicting, or fallback-based, so a human should verify the next move.'
    ));
  }

  return {
    reasons,
    dueAt,
    isOverdue,
    isDueSoon,
    source,
    priority,
    priorityScore,
    tags: Array.isArray(classification.tags) ? classification.tags : [],
    bestCategory: classification.bestCategory || null,
    confidenceLabel,
    disposition,
    suggestedNextAction: classification.suggestedNextAction || null,
    latestRelevantActivityAt: getLatestRelevantActivityAt(lead, activities),
  };
}

function buildQueueSortRank(item) {
  if (item.isOverdue) return 0;
  if (item.priority === 'HIGH') return 1;
  if (item.isDueSoon) return 2;
  return 3;
}

function compareQueueItems(a, b) {
  const rankDiff = buildQueueSortRank(a) - buildQueueSortRank(b);
  if (rankDiff !== 0) return rankDiff;

  if (a.isOverdue && b.isOverdue) {
    const dueDiff = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    if (dueDiff !== 0) return dueDiff;
  }

  const priorityDiff = (b.priorityScore || 0) - (a.priorityScore || 0);
  if (priorityDiff !== 0) return priorityDiff;

  if (a.dueAt && b.dueAt) {
    const dueDiff = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    if (dueDiff !== 0) return dueDiff;
  }

  const activityDiff = new Date(b.latestRelevantActivityAt).getTime() - new Date(a.latestRelevantActivityAt).getTime();
  if (activityDiff !== 0) return activityDiff;

  const createdDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  if (createdDiff !== 0) return createdDiff;

  return String(a.leadId).localeCompare(String(b.leadId));
}

async function getActionQueueForBusiness(businessId) {
  const now = new Date();
  const buildQueueLeadQuery = (includeSnoozeFilter = true) => ({
    where: {
      businessId,
      status: { in: Array.from(ACTIVE_LEAD_STATUSES) },
      ...(includeSnoozeFilter ? {
        OR: [
          { snoozedUntil: null },
          { snoozedUntil: { lte: now } },
        ],
      } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      phone: true,
      message: true,
      status: true,
      createdAt: true,
      activities: {
        where: { type: { in: QUEUE_ACTIVITY_TYPES } },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          type: true,
          message: true,
          metadata: true,
          createdAt: true,
        },
      },
    },
  });

  let leads;
  try {
    leads = await prisma.lead.findMany(buildQueueLeadQuery(true));
  } catch (err) {
    if (!isMissingLeadSnoozedUntilColumnError(err)) throw err;
    leads = await prisma.lead.findMany(buildQueueLeadQuery(false));
  }

  const queueItems = [];

  for (const lead of leads) {
    if (TERMINAL_LEAD_STATUSES.has(String(lead.status || '').toUpperCase())) continue;

    const queueState = buildQueueReasons(lead, lead.activities, now);
    if (!queueState.reasons.length) continue;

    const enrichedLead = {
      ...lead,
      tags: queueState.tags,
      priorityScore: queueState.priorityScore,
      source: queueState.source,
      activities: lead.activities,
    };
    const suggestions = getLeadSuggestions(enrichedLead);
    const outreachDraft = getOutreachDraft(enrichedLead);

    queueItems.push({
      leadId: lead.id,
      leadName: lead.name,
      phone: lead.phone,
      messagePreview: truncateText(lead.message, MESSAGE_PREVIEW_MAX),
      createdAt: lead.createdAt,
      status: lead.status,
      source: queueState.source,
      priority: queueState.priority,
      priorityScore: queueState.priorityScore,
      tags: queueState.tags,
      bestCategory: queueState.bestCategory,
      confidenceLabel: queueState.confidenceLabel,
      dueAt: queueState.dueAt ? queueState.dueAt.toISOString() : null,
      isOverdue: queueState.isOverdue,
      queueReasons: queueState.reasons,
      suggestedNextAction: suggestions[0]?.label || queueState.suggestedNextAction || queueState.reasons[0]?.label || 'Review the lead and decide the next operator step.',
      outreachDraftPreview: outreachDraft?.message ? truncateText(outreachDraft.message, OUTREACH_PREVIEW_MAX) : null,
      latestRelevantActivityAt: queueState.latestRelevantActivityAt,
    });
  }

  return queueItems.sort(compareQueueItems);
}

module.exports = {
  ACTIVE_LEAD_STATUSES,
  buildQueueReasons,
  compareQueueItems,
  getActionQueueForBusiness,
  getLatestFollowUpDueAt,
};
