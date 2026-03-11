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
const { createTestContext } = require('./_testHelpers');

const prisma = new PrismaClient();

describe('WhatsApp webhook integration', () => {
  let ctx;
  let originalFetch;

  beforeAll(async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'whatsapp-test-token';
    process.env.WHATSAPP_TOKEN = 'whatsapp-api-token';
    process.env.WHATSAPP_PHONE_ID = 'phone-id-123';

    ctx = await createTestContext();
    ctx.business = await prisma.business.update({
      where: { id: ctx.business.id },
      data: { phone: '+91 98765 43210' },
    });

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
                  display_phone_number: '+91 98765 43210',
                  phone_number_id: 'phone-id-123',
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
      .set('x-whatsapp-verify-token', 'whatsapp-test-token')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, processed: 1 });

    const lead = await prisma.lead.findFirst({
      where: {
        businessId: ctx.business.id,
        phone: '+919876543210',
      },
      orderBy: { createdAt: 'desc' },
      include: { activities: { orderBy: { createdAt: 'asc' } } },
    });

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

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('graph.facebook.com/v18.0/phone-id-123/messages'),
      expect.objectContaining({ method: 'POST' })
    );

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
