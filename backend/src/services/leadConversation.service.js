'use strict';

const INTENT_LABELS = {
  ADMISSION: 'Admission enquiry',
  DEMO_REQUEST: 'Demo request',
  FEE_ENQUIRY: 'Fee enquiry',
  SCHOLARSHIP_ENQUIRY: 'Scholarship enquiry',
  CALLBACK_REQUEST: 'Callback request',
  GENERAL_ENQUIRY: 'General enquiry',
  WRONG_FIT: 'Wrong fit',
  NOT_INTERESTED: 'Not interested',
  JUNK: 'Junk',
};

const TOPIC_LABELS = {
  ADMISSION: 'Admission details',
  DEMO_REQUEST: 'Demo class details',
  FEE_ENQUIRY: 'Fee details',
  SCHOLARSHIP_ENQUIRY: 'Scholarship details',
  GENERAL_ENQUIRY: 'Coaching details',
  CALLBACK_REQUEST: 'Coaching callback',
};

const STATUS_LABELS = {
  awaiting_user: 'Waiting for customer reply',
  handoff: 'Ready for counsellor handoff',
  closed: 'Conversation closed',
};

const PENDING_FIELD_ACTIONS = {
  student_class: 'Wait for the student class, then continue the handoff.',
  recent_marks: 'Wait for the recent marks or percentage, then guide on scholarship.',
  callback_details: 'Wait for the preferred call time and student class, then call the lead.',
  general_enquiry_details: 'Wait for the class and whether they need fees, demo, or admission details.',
  knowledge_follow_up: 'The assistant has already shared grounded business details. Watch the next reply or hand off if the lead needs more specifics.',
};

function getClassificationMeta(activities = []) {
  return activities.find((activity) => activity.type === 'AGENT_CLASSIFIED')?.metadata || {};
}

function getPrioritizationMeta(activities = []) {
  return activities.find((activity) => activity.type === 'AGENT_PRIORITIZED')?.metadata || {};
}

function getWhatsAppActivities(activities = []) {
  return activities.filter((activity) => activity?.metadata?.channel === 'whatsapp');
}

function getLatestConversationState(whatsAppActivities = []) {
  for (const activity of [...whatsAppActivities].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))) {
    if (activity?.metadata?.conversationState) {
      return activity.metadata.conversationState;
    }
  }
  return null;
}

function formatIntentLabel(intent) {
  return INTENT_LABELS[intent] || intent?.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) || 'Unknown';
}

function formatTopicLabel(topic) {
  return TOPIC_LABELS[topic] || formatIntentLabel(topic);
}

function buildCapturedFields(conversationState, classifiedMeta) {
  const collected = conversationState?.collected || {};
  const requestedTopic = collected.topic || (
    ['ADMISSION', 'DEMO_REQUEST', 'FEE_ENQUIRY', 'SCHOLARSHIP_ENQUIRY'].includes(conversationState?.flowIntent)
      ? conversationState.flowIntent
      : null
  );

  return {
    studentClass: collected.studentClass || null,
    requestedTopic: requestedTopic ? formatTopicLabel(requestedTopic) : null,
    preferredCallTime: collected.preferredCallTime || null,
    recentMarks: collected.recentMarks || null,
    languageMode: classifiedMeta.languageMode || null,
  };
}

function buildRecommendedNextAction({ conversationState, capturedFields, classifiedMeta, prioritizedMeta }) {
  const status = conversationState?.status;
  if (status === 'awaiting_user') {
    return PENDING_FIELD_ACTIONS[conversationState.pendingField] || 'Wait for the next WhatsApp reply before handing off.';
  }

  if (status === 'handoff') {
    const primaryIntent = conversationState?.flowIntent || classifiedMeta.bestCategory;

    if (primaryIntent === 'CALLBACK_REQUEST') {
      const callTime = capturedFields.preferredCallTime ? ` around ${capturedFields.preferredCallTime}` : '';
      const studentClass = capturedFields.studentClass ? ` for ${capturedFields.studentClass}` : '';
      return `Call the lead${callTime}${studentClass} and continue the academy conversation.`.replace(/\s+/g, ' ').trim();
    }

    if (primaryIntent === 'SCHOLARSHIP_ENQUIRY') {
      const marks = capturedFields.recentMarks ? ` using ${capturedFields.recentMarks}` : '';
      return `Review scholarship eligibility${marks} and reply on WhatsApp.`.replace(/\s+/g, ' ').trim();
    }

    const topic = capturedFields.requestedTopic ? ` about ${capturedFields.requestedTopic.toLowerCase()}` : '';
    const studentClass = capturedFields.studentClass ? ` for ${capturedFields.studentClass}` : '';
    return `Reach out on call or WhatsApp${studentClass}${topic}.`.replace(/\s+/g, ' ').trim();
  }

  if (status === 'closed') {
    return 'No handoff needed unless the lead asks again about IIT-JEE coaching.';
  }

  if (classifiedMeta.suggestedNextAction) return classifiedMeta.suggestedNextAction;

  const priorityScore = prioritizedMeta.priorityScore || 0;
  if (priorityScore >= 30) return 'Call this lead soon and continue the WhatsApp conversation.';
  return 'Review the WhatsApp conversation and follow up manually.';
}

function buildTranscript(whatsAppActivities = []) {
  return whatsAppActivities
    .filter((activity) => activity?.metadata?.direction && activity?.metadata?.messageText)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((activity) => ({
      direction: activity.metadata.direction,
      speaker: activity.metadata.direction === 'inbound' ? 'Lead' : 'Academy',
      text: activity.metadata.messageText,
      createdAt: activity.createdAt,
      reason: activity.metadata.replyIntent || activity.metadata.reason || null,
    }));
}

function buildWhatsAppConversationSummary({ lead, activities = [] }) {
  const classifiedMeta = getClassificationMeta(activities);
  const source = classifiedMeta.source || 'web';
  const whatsAppActivities = getWhatsAppActivities(activities);

  if (source !== 'whatsapp' && !whatsAppActivities.length) {
    return null;
  }

  const prioritizedMeta = getPrioritizationMeta(activities);
  const conversationState = getLatestConversationState(whatsAppActivities);
  const primaryIntent = conversationState?.flowIntent || classifiedMeta.bestCategory || null;
  const capturedFields = buildCapturedFields(conversationState, classifiedMeta);
  const transcript = buildTranscript(whatsAppActivities);

  return {
    channel: 'whatsapp',
    primaryIntent,
    primaryIntentLabel: formatIntentLabel(primaryIntent),
    conversationStatus: conversationState?.status || (transcript.length ? 'captured' : 'none'),
    conversationStatusLabel: STATUS_LABELS[conversationState?.status] || (transcript.length ? 'Conversation captured' : 'No WhatsApp activity'),
    capturedFields,
    recommendedNextAction: buildRecommendedNextAction({
      conversationState,
      capturedFields,
      classifiedMeta,
      prioritizedMeta,
    }),
    transcript,
    latestState: conversationState,
    priorityScore: prioritizedMeta.priorityScore || 0,
    leadDisposition: classifiedMeta.leadDisposition || null,
    suggestedNextAction: classifiedMeta.suggestedNextAction || null,
    leadId: lead?.id || null,
  };
}

module.exports = {
  buildWhatsAppConversationSummary,
};
