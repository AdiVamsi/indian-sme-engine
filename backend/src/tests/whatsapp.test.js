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

describe('WhatsApp webhook integration', () => {
  let ctx;
  let originalFetch;

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

  it('creates a lead, runs AI classification, sends automation reply, and broadcasts websocket updates', async () => {
    const payload = {
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
                    wa_id: '919876543210',
                  },
                ],
                messages: [
                  {
                    from: '919876543210',
                    id: 'wamid.message.123',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    text: { body: 'I need coaching immediately' },
                    type: 'text',
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const res = await request(app)
      .post('/api/webhooks/whatsapp')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, accepted: 1 });

    let lead = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      lead = await prisma.lead.findFirst({
        where: {
          businessId: ctx.business.id,
          phone: '+919876543210',
        },
        orderBy: { createdAt: 'desc' },
        include: { activities: { orderBy: { createdAt: 'asc' } } },
      });

      if (lead?.activities?.some((activity) => activity.type === 'AGENT_CLASSIFIED')) {
        break;
      }

      await sleep(100);
    }

    expect(lead).toBeTruthy();

    const classified = lead.activities.find((activity) => activity.type === 'AGENT_CLASSIFIED');
    const prioritized = lead.activities.find((activity) => activity.type === 'AGENT_PRIORITIZED');
    const whatsappAlert = lead.activities.find((activity) =>
      activity.type === 'AUTOMATION_ALERT'
      && activity.metadata?.channel === 'whatsapp'
    );

    expect(classified.metadata.tags).toContain('ADMISSION');
    expect(classified.metadata.source).toBe('whatsapp');
    expect(prioritized.metadata.priorityScore).toBe(35);
    expect(whatsappAlert).toBeTruthy();
    expect(whatsappAlert.metadata.replyMessage).toContain('Our team will contact you shortly');
    expect(whatsappAlert.metadata.providerMessageId).toBe('wamid.reply.123');

    expect(broadcast).toHaveBeenCalledWith(
      ctx.business.id,
      'lead:new',
      expect.objectContaining({
        phone: '+919876543210',
        source: 'whatsapp',
        tags: expect.arrayContaining(['ADMISSION']),
      })
    );
  });
});
