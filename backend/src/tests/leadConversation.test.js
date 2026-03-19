'use strict';

const { buildWhatsAppConversationSummary } = require('../services/leadConversation.service');

describe('WhatsApp conversation summary builder', () => {
  it('builds a useful callback handoff summary', () => {
    const summary = buildWhatsAppConversationSummary({
      lead: { id: 'lead-1' },
      activities: [
        {
          type: 'AGENT_CLASSIFIED',
          createdAt: '2026-03-14T10:00:00.000Z',
          metadata: {
            source: 'whatsapp',
            bestCategory: 'CALLBACK_REQUEST',
            leadDisposition: 'valid',
            suggestedNextAction: 'Call within 30 minutes',
          },
        },
        {
          type: 'AGENT_PRIORITIZED',
          createdAt: '2026-03-14T10:00:01.000Z',
          metadata: { priorityScore: 20 },
        },
        {
          type: 'AUTOMATION_ALERT',
          createdAt: '2026-03-14T10:00:02.000Z',
          metadata: {
            channel: 'whatsapp',
            direction: 'inbound',
            messageText: 'bhai hindi aati hai? koi call karega ? coaching ke baare me puchhni hai',
            reason: 'WHATSAPP_INBOUND_TURN',
          },
        },
        {
          type: 'AUTOMATION_ALERT',
          createdAt: '2026-03-14T10:00:03.000Z',
          metadata: {
            channel: 'whatsapp',
            direction: 'outbound',
            messageText: 'Certainly. Please share the student\'s class and your preferred call time, and our counsellor will call you accordingly.',
            replyIntent: 'CALLBACK_REQUEST',
            conversationState: {
              flowIntent: 'CALLBACK_REQUEST',
              pendingField: 'callback_details',
              status: 'awaiting_user',
              collected: {},
            },
          },
        },
        {
          type: 'AUTOMATION_ALERT',
          createdAt: '2026-03-14T10:05:00.000Z',
          metadata: {
            channel: 'whatsapp',
            direction: 'inbound',
            messageText: 'Class 10, please call after 6 pm',
            reason: 'WHATSAPP_INBOUND_TURN',
          },
        },
        {
          type: 'AUTOMATION_ALERT',
          createdAt: '2026-03-14T10:05:03.000Z',
          metadata: {
            channel: 'whatsapp',
            direction: 'outbound',
            messageText: 'Thank you. Our counsellor will call you after 6 pm regarding Class 10 and assist you with the coaching details.',
            replyIntent: 'CALLBACK_REQUEST_HANDOFF',
            conversationState: {
              flowIntent: 'CALLBACK_REQUEST',
              pendingField: null,
              status: 'handoff',
              collected: {
                studentClass: 'Class 10',
                preferredCallTime: 'after 6 pm',
              },
            },
          },
        },
      ],
    });

    expect(summary.primaryIntent).toBe('CALLBACK_REQUEST');
    expect(summary.primaryIntentLabel).toBe('Callback request');
    expect(summary.conversationStatus).toBe('handoff');
    expect(summary.conversationStatusLabel).toBe('Ready for counsellor handoff');
    expect(summary.capturedFields.studentClass).toBe('Class 10');
    expect(summary.capturedFields.preferredCallTime).toBe('after 6 pm');
    expect(summary.recommendedNextAction).toContain('after 6 pm');
    expect(summary.transcript).toHaveLength(4);
  });

  it('returns null for non-whatsapp leads', () => {
    const summary = buildWhatsAppConversationSummary({
      lead: { id: 'lead-2' },
      activities: [
        {
          type: 'AGENT_CLASSIFIED',
          createdAt: '2026-03-14T10:00:00.000Z',
          metadata: {
            source: 'web',
            bestCategory: 'ADMISSION',
          },
        },
      ],
    });

    expect(summary).toBeNull();
  });

  it('surfaces the scheduled callback in the WhatsApp handoff summary', () => {
    const summary = buildWhatsAppConversationSummary({
      lead: { id: 'lead-3' },
      activities: [
        {
          type: 'AGENT_CLASSIFIED',
          createdAt: '2026-03-14T10:00:00.000Z',
          metadata: {
            source: 'whatsapp',
            bestCategory: 'CALLBACK_REQUEST',
          },
        },
        {
          type: 'AGENT_PRIORITIZED',
          createdAt: '2026-03-14T10:00:01.000Z',
          metadata: { priorityScore: 20 },
        },
        {
          type: 'AUTOMATION_ALERT',
          createdAt: '2026-03-14T10:00:03.000Z',
          metadata: {
            channel: 'whatsapp',
            direction: 'outbound',
            messageText: 'Please share the student class and preferred call time.',
            replyIntent: 'CALLBACK_REQUEST',
            conversationState: {
              flowIntent: 'CALLBACK_REQUEST',
              pendingField: null,
              status: 'handoff',
              collected: {
                studentClass: 'Class 10',
                preferredCallTime: 'Today 6 PM',
              },
            },
          },
        },
        {
          type: 'FOLLOW_UP_SCHEDULED',
          createdAt: '2026-03-14T10:10:00.000Z',
          metadata: {
            reason: 'OPERATOR_CALLBACK_SCHEDULED',
            callbackTime: 'Today 6 PM',
            operatorNote: 'Parent requested an evening call.',
          },
        },
      ],
    });

    expect(summary.latestCallback).toEqual({
      callbackTime: 'Today 6 PM',
      createdAt: '2026-03-14T10:10:00.000Z',
      note: 'Parent requested an evening call.',
    });
    expect(summary.recommendedNextAction).toContain('Callback already scheduled for Today 6 PM');
  });

  it('includes captured course interest in the handoff summary', () => {
    const summary = buildWhatsAppConversationSummary({
      lead: { id: 'lead-5' },
      activities: [
        {
          type: 'AGENT_CLASSIFIED',
          createdAt: '2026-03-14T10:00:00.000Z',
          metadata: {
            source: 'whatsapp',
            bestCategory: 'FEE_ENQUIRY',
          },
        },
        {
          type: 'AGENT_PRIORITIZED',
          createdAt: '2026-03-14T10:00:01.000Z',
          metadata: { priorityScore: 18 },
        },
        {
          type: 'AUTOMATION_ALERT',
          createdAt: '2026-03-14T10:00:03.000Z',
          metadata: {
            channel: 'whatsapp',
            direction: 'outbound',
            messageText: 'Thank you. For IELTS, our counsellor will share the fee details and batch timings shortly on WhatsApp.',
            replyIntent: 'FEE_ENQUIRY_HANDOFF',
            conversationState: {
              flowIntent: 'FEE_ENQUIRY',
              pendingField: null,
              status: 'handoff',
              collected: {
                courseInterest: 'IELTS',
              },
            },
          },
        },
      ],
    });

    expect(summary.capturedFields.courseInterest).toBe('IELTS');
    expect(summary.recommendedNextAction).toContain('for IELTS');
  });

  it('surfaces failed outbound replies that need operator attention', () => {
    const summary = buildWhatsAppConversationSummary({
      lead: { id: 'lead-4' },
      activities: [
        {
          type: 'AGENT_CLASSIFIED',
          createdAt: '2026-03-14T10:00:00.000Z',
          metadata: {
            source: 'whatsapp',
            bestCategory: 'ADMISSION',
          },
        },
        {
          type: 'AGENT_PRIORITIZED',
          createdAt: '2026-03-14T10:00:01.000Z',
          metadata: { priorityScore: 35 },
        },
        {
          type: 'AUTOMATION_ALERT',
          createdAt: '2026-03-14T10:00:05.000Z',
          metadata: {
            channel: 'whatsapp',
            direction: 'outbound',
            deliveryStatus: 'failed',
            replyMessage: 'Please share the student class so we can guide you further.',
            failureTitle: 'Meta access token expired',
            failureDetail: 'Reconnect or refresh the Meta WhatsApp access token.',
            operatorActionRequired: 'Refresh the Meta access token and follow up with the lead manually until sending recovers.',
            conversationState: {
              flowIntent: 'ADMISSION',
              pendingField: 'student_class',
              status: 'send_failed',
              collected: {},
            },
          },
        },
      ],
    });

    expect(summary.conversationStatus).toBe('send_failed');
    expect(summary.conversationStatusLabel).toBe('Reply failed - operator attention needed');
    expect(summary.latestFailedReply).toEqual({
      title: 'Meta access token expired',
      detail: 'Reconnect or refresh the Meta WhatsApp access token.',
      category: null,
      operatorActionRequired: 'Refresh the Meta access token and follow up with the lead manually until sending recovers.',
      attemptedMessage: 'Please share the student class so we can guide you further.',
      createdAt: '2026-03-14T10:00:05.000Z',
    });
    expect(summary.recommendedNextAction).toContain('Meta access token expired');
    expect(summary.transcript).toHaveLength(0);
  });
});
