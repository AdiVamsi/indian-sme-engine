'use strict';

jest.mock('../realtime/socket', () => {
  const actual = jest.requireActual('../realtime/socket');
  return {
    ...actual,
    broadcast: jest.fn(),
  };
});

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const { broadcast } = require('../realtime/socket');
const app = require('../app');

const prisma = new PrismaClient();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildWebhookPayload({ phone, message, messageId }) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: {
                display_phone_number: '15556451322',
                phone_number_id: '1000851389785357',
              },
              contacts: [
                {
                  profile: { name: 'WhatsApp Prospect' },
                  wa_id: phone.replace(/^\+/, ''),
                },
              ],
              messages: [
                {
                  from: phone.replace(/^\+/, ''),
                  id: messageId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  text: { body: message },
                  type: 'text',
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

async function waitForLeadByPhone(businessId, phone, predicate = null) {
  let lead = null;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    lead = await prisma.lead.findFirst({
      where: { businessId, phone },
      orderBy: { createdAt: 'desc' },
      include: { activities: { orderBy: { createdAt: 'asc' } } },
    });

    if (lead && (!predicate || predicate(lead))) {
      return lead;
    }

    await sleep(100);
  }

  return lead;
}

describe('WhatsApp webhook integration', () => {
  let ctx;
  let originalFetch;
  const testPhones = ['+919876543210', '+919800000001'];

  beforeAll(async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'whatsapp-test-token';
    process.env.WHATSAPP_TOKEN = 'whatsapp-api-token';
    process.env.WHATSAPP_PHONE_ID = 'phone-id-123';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.LLM_CLASSIFIER_PROVIDER = 'openai';
    process.env.LLM_CLASSIFIER_MODEL = 'gpt-4o-mini';

    const existingShowcase = await prisma.business.findUnique({
      where: { slug: 'sharma-jee-academy-delhi' },
    });

    if (existingShowcase) {
      ctx = {
        business: await prisma.business.update({
          where: { id: existingShowcase.id },
          data: {
            phone: '+91 70000 11111',
            industry: existingShowcase.industry || 'academy',
          },
        }),
        cleanup: async () => {},
      };
    } else {
      const business = await prisma.business.create({
        data: {
          name: 'Sharma JEE Academy',
          slug: 'sharma-jee-academy-delhi',
          industry: 'academy',
          phone: '+91 70000 11111',
        },
      });

      ctx = {
        business,
        cleanup: async () => {
          await prisma.business.deleteMany({ where: { id: business.id } });
        },
      };
    }

    originalFetch = global.fetch;
    global.fetch = jest.fn(async (url) => {
      if (String(url).includes('/chat/completions')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    intent: 'ADMISSION',
                    priority: 'HIGH',
                    priorityScore: 35,
                    tags: ['ADMISSION', 'URGENT'],
                    confidence: 0.94,
                    confidenceLabel: 'high',
                    disposition: 'valid',
                    languageMode: 'english',
                    reasoning: 'Urgent coaching admission request from WhatsApp.',
                    suggestedNextAction: 'Call within 15 minutes',
                  }),
                },
              },
            ],
          }),
        };
      }

      if (String(url).includes('graph.facebook.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            messages: [{ id: 'wamid.reply.123' }],
          }),
        };
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });
  }, 15000);

  afterAll(async () => {
    global.fetch = originalFetch;
    await ctx.cleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.lead.deleteMany({
      where: {
        businessId: ctx.business.id,
        phone: { in: testPhones },
      },
    });
  });

  afterEach(() => {
    broadcast.mockClear();
    if (global.fetch?.mockClear) global.fetch.mockClear();
  });

  it('verifies the WhatsApp webhook challenge', async () => {
    const res = await request(app)
      .get('/api/webhooks/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'whatsapp-test-token',
        'hub.challenge': 'challenge-ok',
      });

    expect(res.status).toBe(200);
    expect(res.text).toBe('challenge-ok');
  });

  it('creates a lead, runs AI classification, sends the first academy follow-up reply, and broadcasts websocket updates', async () => {
    const phone = '+919876543210';
    const res = await request(app)
      .post('/api/webhooks/whatsapp')
      .send(buildWebhookPayload({
        phone,
        message: 'I need coaching immediately',
        messageId: 'wamid.message.123',
      }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, accepted: 1 });

    const lead = await waitForLeadByPhone(ctx.business.id, phone, (candidate) =>
      candidate.activities.some((activity) =>
        activity.type === 'AUTOMATION_ALERT'
        && activity.metadata?.channel === 'whatsapp'
        && activity.metadata?.direction === 'outbound'
      )
    );

    expect(lead).toBeTruthy();

    const classified = lead.activities.find((activity) => activity.type === 'AGENT_CLASSIFIED');
    const prioritized = lead.activities.find((activity) => activity.type === 'AGENT_PRIORITIZED');
    const outboundReply = lead.activities.find((activity) =>
      activity.type === 'AUTOMATION_ALERT'
      && activity.metadata?.channel === 'whatsapp'
      && activity.metadata?.direction === 'outbound'
    );

    expect(classified.metadata.tags).toContain('ADMISSION');
    expect(classified.metadata.source).toBe('whatsapp');
    expect(prioritized.metadata.priorityScore).toBe(35);
    expect(outboundReply).toBeTruthy();
    expect(outboundReply.metadata.replyMessage).toContain('Admissions are open');
    expect(outboundReply.metadata.replyMessage).toContain('Which class is the student in?');
    expect(outboundReply.metadata.conversationState.pendingField).toBe('student_class');
    expect(outboundReply.metadata.providerMessageId).toBe('wamid.reply.123');

    expect(broadcast).toHaveBeenCalledWith(
      ctx.business.id,
      'lead:new',
      expect.objectContaining({
        phone,
        source: 'whatsapp',
        tags: expect.arrayContaining(['ADMISSION']),
      })
    );
  });

  it('treats the next WhatsApp message as a continuation of the same academy lead conversation', async () => {
    const phone = '+919800000001';

    const firstRes = await request(app)
      .post('/api/webhooks/whatsapp')
      .send(buildWebhookPayload({
        phone,
        message: 'Need admission details urgently',
        messageId: 'wamid.message.first',
      }));

    expect(firstRes.status).toBe(200);

    const leadAfterFirstTurn = await waitForLeadByPhone(ctx.business.id, phone, (candidate) =>
      candidate.activities.some((activity) =>
        activity.type === 'AUTOMATION_ALERT'
        && activity.metadata?.channel === 'whatsapp'
        && activity.metadata?.direction === 'outbound'
        && activity.metadata?.conversationMode === 'initial'
      )
    );

    expect(leadAfterFirstTurn).toBeTruthy();

    const secondRes = await request(app)
      .post('/api/webhooks/whatsapp')
      .send(buildWebhookPayload({
        phone,
        message: 'Class 11',
        messageId: 'wamid.message.second',
      }));

    expect(secondRes.status).toBe(200);
    expect(secondRes.body).toEqual({ received: true, accepted: 1 });

    const leadAfterSecondTurn = await waitForLeadByPhone(ctx.business.id, phone, (candidate) =>
      candidate.activities.some((activity) =>
        activity.type === 'AUTOMATION_ALERT'
        && activity.metadata?.channel === 'whatsapp'
        && activity.metadata?.direction === 'outbound'
        && activity.metadata?.conversationMode === 'continuation'
      )
    );

    const leadsForPhone = await prisma.lead.findMany({
      where: { businessId: ctx.business.id, phone },
    });

    expect(leadsForPhone).toHaveLength(1);
    expect(leadAfterSecondTurn).toBeTruthy();

    const inboundTurns = leadAfterSecondTurn.activities.filter((activity) =>
      activity.type === 'AUTOMATION_ALERT'
      && activity.metadata?.channel === 'whatsapp'
      && activity.metadata?.direction === 'inbound'
    );
    const continuationReply = leadAfterSecondTurn.activities.find((activity) =>
      activity.type === 'AUTOMATION_ALERT'
      && activity.metadata?.channel === 'whatsapp'
      && activity.metadata?.direction === 'outbound'
      && activity.metadata?.conversationMode === 'continuation'
    );

    expect(inboundTurns).toHaveLength(2);
    expect(inboundTurns.map((activity) => activity.metadata.messageText)).toContain('Class 11');
    expect(continuationReply.metadata.replyMessage).toContain('For Class 11');
    expect(continuationReply.metadata.replyMessage).toContain('call you shortly');
    expect(continuationReply.metadata.conversationState.status).toBe('handoff');
    expect(continuationReply.metadata.conversationState.collected.studentClass).toBe('Class 11');

    const openAiCalls = global.fetch.mock.calls.filter(([url]) => String(url).includes('/chat/completions'));
    const graphCalls = global.fetch.mock.calls.filter(([url]) => String(url).includes('graph.facebook.com'));

    expect(openAiCalls).toHaveLength(1);
    expect(graphCalls).toHaveLength(2);
  });
});
