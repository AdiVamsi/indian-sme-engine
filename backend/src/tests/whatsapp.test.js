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

function buildClassificationForMessage(message) {
  const text = String(message || '').toLowerCase();

  if (text.includes('fees') || text.includes('fee') || text.includes('kitni')) {
    return {
      intent: 'FEE_ENQUIRY',
      priority: 'NORMAL',
      priorityScore: 18,
      tags: ['FEE_ENQUIRY'],
      confidence: 0.9,
      confidenceLabel: 'high',
      disposition: 'valid',
      languageMode: 'hinglish',
      reasoning: 'Asked for fee details.',
      suggestedNextAction: 'Share the fee structure',
    };
  }

  if (text.includes('call karega') || text.includes('preferred call') || text.includes('coaching ke baare me puchhni hai')) {
    return {
      intent: 'CALLBACK_REQUEST',
      priority: 'NORMAL',
      priorityScore: 20,
      tags: ['CALLBACK_REQUEST', 'GENERAL_ENQUIRY'],
      confidence: 0.9,
      confidenceLabel: 'high',
      disposition: 'valid',
      languageMode: 'hinglish',
      reasoning: 'Caller wants a callback to discuss coaching details.',
      suggestedNextAction: 'Call within 30 minutes',
    };
  }

  if (text.includes('fees details chahiye') || text.includes('demo details') || text.includes('admission details')) {
    return {
      intent: 'GENERAL_ENQUIRY',
      priority: 'NORMAL',
      priorityScore: 20,
      tags: ['GENERAL_ENQUIRY'],
      confidence: 0.88,
      confidenceLabel: 'high',
      disposition: 'valid',
      languageMode: 'hinglish',
      reasoning: 'General coaching enquiry that needs narrowing.',
      suggestedNextAction: 'Ask whether they need fees, demo, or admission details',
    };
  }

  return {
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
  let defaultFetchImpl;
  const testPhones = ['+919876543210', '+919800000001', '+919811111111'];

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

    await prisma.agentConfig.upsert({
      where: { businessId: ctx.business.id },
      update: {
        classificationRules: {
          keywords: {
            ADMISSION: ['admission', 'coaching', 'join'],
            FEE_ENQUIRY: ['fee', 'fees', 'cost', 'charges'],
            GENERAL_ENQUIRY: ['details', 'information'],
          },
          businessKnowledge: {
            enabled: true,
            entries: [
              {
                id: 'fees_overview',
                title: 'Fee structure',
                category: 'fees',
                intents: ['FEE_ENQUIRY', 'GENERAL_ENQUIRY'],
                keywords: ['fee', 'fees', 'fee structure', 'cost'],
                content: 'Classroom programmes start from INR 78,000 per year depending on class, batch, and scholarship eligibility.',
              },
              {
                id: 'branch_location',
                title: 'Branch location',
                category: 'location',
                intents: ['GENERAL_ENQUIRY'],
                keywords: ['branch', 'location', 'address', 'where'],
                content: 'The branch is shown as Connaught Place, New Delhi.',
              },
            ],
          },
        },
        priorityRules: { weights: { fee: 10, fees: 10, urgent: 30 } },
      },
      create: {
        businessId: ctx.business.id,
        toneStyle: 'professional',
        followUpMinutes: 30,
        autoReplyEnabled: false,
        classificationRules: {
          keywords: {
            ADMISSION: ['admission', 'coaching', 'join'],
            FEE_ENQUIRY: ['fee', 'fees', 'cost', 'charges'],
            GENERAL_ENQUIRY: ['details', 'information'],
          },
          businessKnowledge: {
            enabled: true,
            entries: [
              {
                id: 'fees_overview',
                title: 'Fee structure',
                category: 'fees',
                intents: ['FEE_ENQUIRY', 'GENERAL_ENQUIRY'],
                keywords: ['fee', 'fees', 'fee structure', 'cost'],
                content: 'Classroom programmes start from INR 78,000 per year depending on class, batch, and scholarship eligibility.',
              },
              {
                id: 'branch_location',
                title: 'Branch location',
                category: 'location',
                intents: ['GENERAL_ENQUIRY'],
                keywords: ['branch', 'location', 'address', 'where'],
                content: 'The branch is shown as Connaught Place, New Delhi.',
              },
            ],
          },
        },
        priorityRules: { weights: { fee: 10, fees: 10, urgent: 30 } },
      },
    });

    defaultFetchImpl = async (url, options = {}) => {
      if (String(url).includes('/chat/completions')) {
        const payload = JSON.parse(options.body || '{}');
        const userMessage = payload.messages?.find((entry) => entry.role === 'user')?.content || '{}';
        const userPayload = JSON.parse(userMessage);

        if (userPayload?.task === 'grounded_whatsapp_reply') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      grounded: true,
                      confidence: 0.93,
                      reply: 'Certainly. Classroom programmes start from INR 78,000 per year depending on class, batch, and scholarship eligibility.',
                      usedEntryIds: ['fees_overview'],
                      reason: 'Used the stored fee overview entry.',
                    }),
                  },
                },
              ],
            }),
          };
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify(buildClassificationForMessage(userPayload?.message)),
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
    };

    originalFetch = global.fetch;
    global.fetch = jest.fn(defaultFetchImpl);
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
    if (global.fetch?.mockImplementation) {
      global.fetch.mockImplementation(defaultFetchImpl);
    }
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
    expect(outboundReply.metadata.replyMessage).toContain('Please share the student\'s class');
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

  it('answers direct business-identity questions before using generic WhatsApp handoff wording', async () => {
    const phone = '+919833333333';
    testPhones.push(phone);

    const res = await request(app)
      .post('/api/webhooks/whatsapp')
      .send(buildWebhookPayload({
        phone,
        message: 'Hello. is this a gym ?',
        messageId: 'wamid.message.identity',
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

    const outboundReply = lead.activities.find((activity) =>
      activity.type === 'AUTOMATION_ALERT'
      && activity.metadata?.channel === 'whatsapp'
      && activity.metadata?.direction === 'outbound'
    );

    expect(outboundReply.metadata.replyIntent).toBe('DIRECT_BUSINESS_CLARIFICATION');
    expect(outboundReply.metadata.replyMessage).toContain('Sharma JEE Academy');
    expect(outboundReply.metadata.replyMessage).toContain('IIT-JEE coaching');
    expect(outboundReply.metadata.replyMessage).toContain('do not provide gym services');
    expect(outboundReply.metadata.replyMessage).not.toContain('will continue with you on WhatsApp shortly');
  });

  it('records an operator-visible failure activity when Meta rejects the outbound WhatsApp reply because the access token expired', async () => {
    const phone = '+919822222222';
    testPhones.push(phone);

    global.fetch.mockImplementation(async (url, options = {}) => {
      if (String(url).includes('graph.facebook.com')) {
        return {
          ok: false,
          status: 401,
          json: async () => ({
            error: {
              message: 'Error validating access token: Session has expired.',
              type: 'OAuthException',
              code: 190,
              error_subcode: 463,
            },
          }),
        };
      }

      return defaultFetchImpl(url, options);
    });

    const res = await request(app)
      .post('/api/webhooks/whatsapp')
      .send(buildWebhookPayload({
        phone,
        message: 'I need coaching immediately',
        messageId: 'wamid.message.expired-token',
      }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, accepted: 1 });

    const lead = await waitForLeadByPhone(ctx.business.id, phone, (candidate) =>
      candidate.activities.some((activity) =>
        activity.type === 'AUTOMATION_ALERT'
        && activity.metadata?.reason === 'WHATSAPP_AUTO_REPLY_FAILED'
      )
    );

    expect(lead).toBeTruthy();

    const classified = lead.activities.find((activity) => activity.type === 'AGENT_CLASSIFIED');
    const prioritized = lead.activities.find((activity) => activity.type === 'AGENT_PRIORITIZED');
    const outboundFailure = lead.activities.find((activity) =>
      activity.type === 'AUTOMATION_ALERT'
      && activity.metadata?.reason === 'WHATSAPP_AUTO_REPLY_FAILED'
    );
    const outboundSuccess = lead.activities.find((activity) =>
      activity.type === 'AUTOMATION_ALERT'
      && activity.metadata?.reason === 'WHATSAPP_AUTO_REPLY'
    );

    expect(classified).toBeTruthy();
    expect(prioritized).toBeTruthy();
    expect(outboundFailure).toBeTruthy();
    expect(outboundSuccess).toBeUndefined();
    expect(outboundFailure.message).toBe('WhatsApp reply failed: Meta access token expired');
    expect(outboundFailure.metadata.deliveryStatus).toBe('failed');
    expect(outboundFailure.metadata.failureCategory).toBe('META_TOKEN_EXPIRED');
    expect(outboundFailure.metadata.failureTitle).toBe('Meta access token expired');
    expect(outboundFailure.metadata.failureDetail).toContain('Automated WhatsApp replies are not being delivered');
    expect(outboundFailure.metadata.operatorActionRequired).toContain('Refresh the Meta access token');
    expect(outboundFailure.metadata.providerStatus).toBe(401);
    expect(outboundFailure.metadata.providerCode).toBe(190);
    expect(outboundFailure.metadata.providerSubcode).toBe(463);
    expect(outboundFailure.metadata.conversationState.status).toBe('send_failed');
    expect(outboundFailure.metadata.conversationState.pendingField).toBe('student_class');
    expect(outboundFailure.metadata.replyMessage).toContain('Admissions are open');

    expect(broadcast).toHaveBeenCalledWith(
      ctx.business.id,
      'lead:new',
      expect.objectContaining({
        phone,
        source: 'whatsapp',
        whatsappNeedsAttention: true,
        whatsappFailureTitle: 'Meta access token expired',
      })
    );
  });

  it('treats the next WhatsApp message as a continuation of the same academy lead conversation', async () => {
    const phone = '+919800000001';

    const firstRes = await request(app)
      .post('/api/webhooks/whatsapp')
      .send(buildWebhookPayload({
        phone,
        message: 'Need coaching urgently',
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
    expect(continuationReply.metadata.replyMessage).toContain('connect with you shortly');
    expect(continuationReply.metadata.conversationState.status).toBe('handoff');
    expect(continuationReply.metadata.conversationState.collected.studentClass).toBe('Class 11');

    const openAiCalls = global.fetch.mock.calls.filter(([url]) => String(url).includes('/chat/completions'));
    const graphCalls = global.fetch.mock.calls.filter(([url]) => String(url).includes('graph.facebook.com'));

    expect(openAiCalls).toHaveLength(1);
    expect(graphCalls).toHaveLength(2);
  });

  it('sends a grounded business-knowledge answer for factual fee questions', async () => {
    const phone = '+919844444444';
    testPhones.push(phone);

    const res = await request(app)
      .post('/api/webhooks/whatsapp')
      .send(buildWebhookPayload({
        phone,
        message: 'fees kitni hai?',
        messageId: 'wamid.message.fees',
      }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, accepted: 1 });

    const lead = await waitForLeadByPhone(ctx.business.id, phone, (candidate) =>
      candidate.activities.some((activity) =>
        activity.type === 'AUTOMATION_ALERT'
        && activity.metadata?.channel === 'whatsapp'
        && activity.metadata?.direction === 'outbound'
        && activity.metadata?.replyIntent === 'BUSINESS_KNOWLEDGE_ANSWER'
      )
    );

    expect(lead).toBeTruthy();

    const outboundReply = lead.activities.find((activity) =>
      activity.type === 'AUTOMATION_ALERT'
      && activity.metadata?.channel === 'whatsapp'
      && activity.metadata?.direction === 'outbound'
      && activity.metadata?.replyIntent === 'BUSINESS_KNOWLEDGE_ANSWER'
    );

    expect(outboundReply).toBeTruthy();
    expect(outboundReply.metadata.replyIntent).toBe('BUSINESS_KNOWLEDGE_ANSWER');
    expect(outboundReply.metadata.replyMessage).toContain('INR 78,000');
    expect(outboundReply.metadata.knowledgeRetrieval.sourceIds).toContain('fees_overview');
    expect(outboundReply.metadata.conversationState.pendingField).toBe('knowledge_follow_up');
  });

  it('sends a callback-focused first reply for callback request plus general enquiry academy leads', async () => {
    const phone = '+919811111111';
    const res = await request(app)
      .post('/api/webhooks/whatsapp')
      .send(buildWebhookPayload({
        phone,
        message: 'bhai hindi aati hai? koi call karega ? coaching ke baare me puchhni hai',
        messageId: 'wamid.message.callback',
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

    expect(classified.metadata.bestCategory).toBe('CALLBACK_REQUEST');
    expect(classified.metadata.tags).toEqual(expect.arrayContaining(['CALLBACK_REQUEST', 'GENERAL_ENQUIRY']));
    expect(prioritized.metadata.priorityScore).toBe(20);
    expect(outboundReply.metadata.replyIntent).toBe('CALLBACK_REQUEST');
    expect(outboundReply.metadata.replyMessage).toContain('preferred call time');
    expect(outboundReply.metadata.replyMessage).toContain('Please share the student\'s class');
    expect(outboundReply.metadata.conversationState.pendingField).toBe('callback_details');
  });
});
