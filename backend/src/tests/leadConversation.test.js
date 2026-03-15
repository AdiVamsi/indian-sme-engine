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
            messageText: 'Sure — please share the student\'s class and your preferred call time. Our counsellor will call you accordingly.',
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
            messageText: 'Thanks. Our counsellor will call for Class 10 after 6 pm and help you with the coaching details.',
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
});
