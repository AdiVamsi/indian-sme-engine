'use strict';

const { PrismaClient } = require('@prisma/client');
const request = require('supertest');

const app = require('../app');
const { prisma: sharedPrisma } = require('../lib/prisma');
const { createTestContext } = require('./_testHelpers');

describe('Action Queue API', () => {
  let ctx;
  let token;
  const prisma = new PrismaClient();

  beforeAll(async () => {
    ctx = await createTestContext();

    const res = await request(app)
      .post('/api/admin/login')
      .send({ businessSlug: ctx.slug, email: ctx.email, password: ctx.password });

    token = res.body.token;
  }, 15000);

  afterAll(async () => {
    await ctx.cleanup();
    await prisma.$disconnect();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  function minutesFromNow(minutes) {
    return new Date(Date.now() + minutes * 60 * 1000);
  }

  async function createQueueLead({
    businessId,
    name,
    phone,
    status = 'NEW',
    message = 'Need details',
    createdAt = new Date(),
    snoozedUntil = null,
    source = 'web',
    bestCategory = 'GENERAL_ENQUIRY',
    tags = [],
    priorityScore = 0,
    confidenceLabel = 'high',
    leadDisposition = 'valid',
    suggestedNextAction = 'Review the lead',
    via = 'llm_classifier',
    followUpAt = null,
    followUpCreatedAt = null,
    statusChangedAt = null,
    statusChangeFrom = 'NEW',
    extraActivities = [],
  } = {}) {
    const lead = await prisma.lead.create({
      data: {
        businessId,
        name,
        phone: phone || `+91 99999${Math.floor(Math.random() * 100000).toString().padStart(5, '0')}`,
        message,
        status,
        snoozedUntil,
        createdAt,
      },
    });

    const baseTime = createdAt.getTime();
    const activities = [
      {
        leadId: lead.id,
        type: 'AGENT_CLASSIFIED',
        message: `Lead classified as ${bestCategory}`,
        createdAt: new Date(baseTime + 1_000),
        metadata: {
          source,
          bestCategory,
          tags,
          confidenceLabel,
          leadDisposition,
          suggestedNextAction,
          via,
        },
      },
      {
        leadId: lead.id,
        type: 'AGENT_PRIORITIZED',
        message: `Priority score assigned: ${priorityScore}`,
        createdAt: new Date(baseTime + 2_000),
        metadata: {
          priorityScore,
          priorityLabel: priorityScore >= 30 ? 'HIGH' : priorityScore >= 10 ? 'NORMAL' : 'LOW',
        },
      },
    ];

    if (followUpAt) {
      activities.push({
        leadId: lead.id,
        type: 'FOLLOW_UP_SCHEDULED',
        message: 'Follow-up scheduled by AI',
        createdAt: followUpCreatedAt || new Date(baseTime + 3_000),
        metadata: {
          followUpAt: new Date(followUpAt).toISOString(),
          followUpMinutes: 30,
          source,
        },
      });
    }

    if (statusChangedAt) {
      activities.push({
        leadId: lead.id,
        type: 'STATUS_CHANGED',
        message: `Status changed from ${statusChangeFrom} to ${status}`,
        createdAt: statusChangedAt,
        metadata: {
          oldStatus: statusChangeFrom,
          newStatus: status,
        },
      });
    }

    activities.push(...extraActivities.map((activity) => ({
      leadId: lead.id,
      ...activity,
    })));

    await prisma.leadActivity.createMany({ data: activities });

    return lead;
  }

  it('GET /api/admin/action-queue - only returns leads for the authenticated business', async () => {
    const ownLead = await createQueueLead({
      businessId: ctx.business.id,
      name: 'Own Queue Lead',
      priorityScore: 38,
    });

    const otherCtx = await createTestContext();
    try {
      await createQueueLead({
        businessId: otherCtx.business.id,
        name: 'Foreign Queue Lead',
        priorityScore: 42,
      });

      const res = await request(app).get('/api/admin/action-queue').set(auth());

      expect(res.status).toBe(200);
      expect(res.body.map((item) => item.leadId)).toContain(ownLead.id);
      expect(res.body.some((item) => item.leadName === 'Foreign Queue Lead')).toBe(false);
    } finally {
      await otherCtx.cleanup();
    }
  });

  it('GET /api/admin/action-queue - includes a high-priority untouched lead', async () => {
    const lead = await createQueueLead({
      businessId: ctx.business.id,
      name: 'High Priority Queue Lead',
      priorityScore: 44,
      bestCategory: 'ADMISSION',
      tags: ['ADMISSION'],
      suggestedNextAction: 'Call within 15 minutes',
    });

    const res = await request(app).get('/api/admin/action-queue').set(auth());

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          leadId: lead.id,
          priority: 'HIGH',
          priorityScore: 44,
          bestCategory: 'ADMISSION',
          tags: ['ADMISSION'],
          queueReasons: expect.arrayContaining([
            expect.objectContaining({ code: 'HIGH_PRIORITY' }),
            expect.objectContaining({ code: 'UNHANDLED_AFTER_CLASSIFICATION' }),
          ]),
          suggestedNextAction: 'Call immediately',
        }),
      ])
    );
  });

  it('GET /api/admin/action-queue - includes a lead with an overdue AI follow-up', async () => {
    const lead = await createQueueLead({
      businessId: ctx.business.id,
      name: 'Overdue Follow-up Lead',
      priorityScore: 14,
      followUpAt: minutesFromNow(-20),
    });

    const res = await request(app).get('/api/admin/action-queue').set(auth());
    const item = res.body.find((entry) => entry.leadId === lead.id);

    expect(res.status).toBe(200);
    expect(item).toEqual(expect.objectContaining({
      leadId: lead.id,
      isOverdue: true,
      dueAt: expect.any(String),
      queueReasons: expect.arrayContaining([
        expect.objectContaining({ code: 'FOLLOW_UP_OVERDUE' }),
      ]),
    }));
  });

  it('GET /api/admin/action-queue - excludes a handled lead once an operator action happened after classification', async () => {
    const createdAt = minutesFromNow(-90);

    await createQueueLead({
      businessId: ctx.business.id,
      name: 'Handled Queue Lead',
      status: 'CONTACTED',
      priorityScore: 36,
      followUpAt: minutesFromNow(-30),
      createdAt,
      statusChangedAt: new Date(createdAt.getTime() + 4_000),
    });

    const res = await request(app).get('/api/admin/action-queue').set(auth());

    expect(res.status).toBe(200);
    expect(res.body.some((item) => item.leadName === 'Handled Queue Lead')).toBe(false);
  });

  it('GET /api/admin/action-queue - includes weak or fallback classifications for review', async () => {
    const lead = await createQueueLead({
      businessId: ctx.business.id,
      name: 'Weak Confidence Lead',
      priorityScore: 8,
      confidenceLabel: 'low',
      leadDisposition: 'weak',
      via: 'llm_fallback',
    });

    const res = await request(app).get('/api/admin/action-queue').set(auth());
    const item = res.body.find((entry) => entry.leadId === lead.id);

    expect(res.status).toBe(200);
    expect(item).toEqual(expect.objectContaining({
      leadId: lead.id,
      confidenceLabel: 'low',
      queueReasons: expect.arrayContaining([
        expect.objectContaining({ code: 'LOW_CONFIDENCE_REVIEW' }),
      ]),
    }));
  });

  it('GET /api/admin/action-queue - excludes leads while snoozed and includes them again once snooze expires', async () => {
    await createQueueLead({
      businessId: ctx.business.id,
      name: 'Snoozed Queue Lead',
      priorityScore: 38,
      snoozedUntil: minutesFromNow(24 * 60),
    });

    const expiredSnoozeLead = await createQueueLead({
      businessId: ctx.business.id,
      name: 'Expired Snooze Queue Lead',
      priorityScore: 38,
      snoozedUntil: minutesFromNow(-60),
    });

    const res = await request(app).get('/api/admin/action-queue').set(auth());

    expect(res.status).toBe(200);
    expect(res.body.some((item) => item.leadName === 'Snoozed Queue Lead')).toBe(false);
    expect(res.body.some((item) => item.leadId === expiredSnoozeLead.id)).toBe(true);
  });

  it('GET /api/admin/action-queue - excludes leads using snooze activity metadata when the lead column is unavailable', async () => {
    await createQueueLead({
      businessId: ctx.business.id,
      name: 'Activity Snoozed Lead',
      priorityScore: 36,
      extraActivities: [
        {
          type: 'AUTOMATION_ALERT',
          message: 'Operator snoozed this lead for 3 days.',
          createdAt: minutesFromNow(-10),
          metadata: {
            channel: 'operator',
            operatorAction: 'SNOOZE',
            reason: 'OPERATOR_SNOOZED_QUEUE',
            snoozeDays: 3,
            snoozedUntil: minutesFromNow(3 * 24 * 60).toISOString(),
          },
        },
      ],
    });

    const res = await request(app).get('/api/admin/action-queue').set(auth());

    expect(res.status).toBe(200);
    expect(res.body.some((item) => item.leadName === 'Activity Snoozed Lead')).toBe(false);
  });

  it('GET /api/admin/action-queue - falls back when Prisma reports the missing snooze column via P2022 metadata', async () => {
    const lead = await createQueueLead({
      businessId: ctx.business.id,
      name: 'P2022 Fallback Lead',
      priorityScore: 36,
    });

    const originalFindMany = sharedPrisma.lead.findMany.bind(sharedPrisma.lead);
    const spy = jest.spyOn(sharedPrisma.lead, 'findMany');
    let callCount = 0;

    spy.mockImplementation((args) => {
      callCount += 1;

      if (callCount === 1) {
        const err = new Error('The column `main.Lead.snoozedUntil` does not exist in the current database.');
        err.code = 'P2022';
        err.meta = {
          modelName: 'Lead',
          column: 'main.Lead.snoozedUntil',
        };
        throw err;
      }

      return originalFindMany(args);
    });

    try {
      const res = await request(app).get('/api/admin/action-queue').set(auth());

      expect(res.status).toBe(200);
      expect(res.body).toEqual(expect.arrayContaining([
        expect.objectContaining({ leadId: lead.id }),
      ]));
      expect(callCount).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('GET /api/admin/action-queue - includes leads whose scheduled callback is due or overdue', async () => {
    const lead = await createQueueLead({
      businessId: ctx.business.id,
      name: 'Callback Due Lead',
      status: 'CONTACTED',
      priorityScore: 12,
      extraActivities: [
        {
          type: 'FOLLOW_UP_SCHEDULED',
          message: 'Callback scheduled for later today',
          createdAt: minutesFromNow(-45),
          metadata: {
            reason: 'OPERATOR_CALLBACK_SCHEDULED',
            operatorAction: 'SCHEDULE_CALLBACK',
            callbackTime: 'Today 5:30 PM',
            callbackAt: minutesFromNow(-15).toISOString(),
          },
        },
      ],
    });

    const res = await request(app).get('/api/admin/action-queue').set(auth());
    const item = res.body.find((entry) => entry.leadId === lead.id);

    expect(res.status).toBe(200);
    expect(item).toEqual(expect.objectContaining({
      leadId: lead.id,
      isOverdue: true,
      dueAt: expect.any(String),
      queueReasons: expect.arrayContaining([
        expect.objectContaining({ code: 'CALLBACK_DUE' }),
      ]),
    }));
  });

  it('GET /api/admin/action-queue - includes WhatsApp handoff leads based on automation activity history', async () => {
    const createdAt = minutesFromNow(-40);
    const lead = await createQueueLead({
      businessId: ctx.business.id,
      name: 'WhatsApp Handoff Lead',
      createdAt,
      source: 'whatsapp',
      extraActivities: [
        {
          type: 'AUTOMATION_ALERT',
          message: 'WhatsApp handoff ready',
          createdAt: minutesFromNow(-25),
          metadata: {
            channel: 'whatsapp',
            direction: 'outbound',
            reason: 'WHATSAPP_AUTO_REPLY',
            replyIntent: 'CALLBACK_REQUEST_HANDOFF',
            deliveryStatus: 'sent',
            messageText: 'A counsellor will follow up with you shortly.',
            conversationState: {
              channel: 'whatsapp',
              flowIntent: 'CALLBACK_REQUEST',
              status: 'handoff',
            },
          },
        },
      ],
    });

    const res = await request(app).get('/api/admin/action-queue').set(auth());
    const item = res.body.find((entry) => entry.leadId === lead.id);

    expect(res.status).toBe(200);
    expect(item?.queueReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WHATSAPP_RESPONSE_REQUIRED' }),
    ]));
  });

  it('GET /api/admin/action-queue - excludes WhatsApp handoff leads after an operator callback is scheduled', async () => {
    const createdAt = minutesFromNow(-40);
    await createQueueLead({
      businessId: ctx.business.id,
      name: 'WhatsApp Callback Scheduled Lead',
      createdAt,
      source: 'whatsapp',
      extraActivities: [
        {
          type: 'AUTOMATION_ALERT',
          message: 'WhatsApp handoff ready',
          createdAt: minutesFromNow(-25),
          metadata: {
            channel: 'whatsapp',
            direction: 'outbound',
            reason: 'WHATSAPP_AUTO_REPLY',
            replyIntent: 'CALLBACK_REQUEST_HANDOFF',
            deliveryStatus: 'sent',
            messageText: 'A counsellor will follow up with you shortly.',
            conversationState: {
              channel: 'whatsapp',
              flowIntent: 'CALLBACK_REQUEST',
              status: 'handoff',
            },
          },
        },
        {
          type: 'FOLLOW_UP_SCHEDULED',
          message: 'Callback scheduled for tomorrow',
          createdAt: minutesFromNow(-15),
          metadata: {
            channel: 'whatsapp',
            reason: 'OPERATOR_CALLBACK_SCHEDULED',
            operatorAction: 'SCHEDULE_CALLBACK',
            callbackTime: 'Tomorrow 4:00 PM',
            callbackAt: minutesFromNow(24 * 60).toISOString(),
            conversationState: {
              channel: 'whatsapp',
              flowIntent: 'CALLBACK_REQUEST',
              status: 'handoff',
            },
          },
        },
      ],
    });

    const res = await request(app).get('/api/admin/action-queue').set(auth());

    expect(res.status).toBe(200);
    expect(res.body.some((item) => item.leadName === 'WhatsApp Callback Scheduled Lead')).toBe(false);
  });

  it('GET /api/admin/action-queue - keeps WhatsApp delivery failures queued when the failure is newer than the last operator touch', async () => {
    const createdAt = minutesFromNow(-40);
    const lead = await createQueueLead({
      businessId: ctx.business.id,
      name: 'WhatsApp Delivery Failure Lead',
      createdAt,
      source: 'whatsapp',
      extraActivities: [
        {
          type: 'FOLLOW_UP_SCHEDULED',
          message: 'Callback scheduled earlier',
          createdAt: minutesFromNow(-30),
          metadata: {
            channel: 'whatsapp',
            reason: 'OPERATOR_CALLBACK_SCHEDULED',
            operatorAction: 'SCHEDULE_CALLBACK',
            callbackTime: 'Today 5:30 PM',
            callbackAt: minutesFromNow(-20).toISOString(),
          },
        },
        {
          type: 'AUTOMATION_ALERT',
          message: 'WhatsApp reply failed: Token expired',
          createdAt: minutesFromNow(-10),
          metadata: {
            channel: 'whatsapp',
            direction: 'outbound',
            reason: 'WHATSAPP_AUTO_REPLY_FAILED',
            deliveryStatus: 'failed',
            failureTitle: 'Token expired',
            operatorActionRequired: 'Refresh the Meta access token and follow up manually.',
            conversationState: {
              channel: 'whatsapp',
              flowIntent: 'CALLBACK_REQUEST',
              status: 'send_failed',
            },
          },
        },
      ],
    });

    const res = await request(app).get('/api/admin/action-queue').set(auth());
    const item = res.body.find((entry) => entry.leadId === lead.id);

    expect(res.status).toBe(200);
    expect(item?.queueReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WHATSAPP_RESPONSE_REQUIRED' }),
    ]));
  });

  it('GET /api/admin/action-queue - orders overdue, then high priority, then due soon, then newest', async () => {
    const overdueLead = await createQueueLead({
      businessId: ctx.business.id,
      name: 'Queue Order Overdue',
      createdAt: minutesFromNow(-50),
      priorityScore: 15,
      followUpAt: minutesFromNow(-10),
    });

    const highPriorityLead = await createQueueLead({
      businessId: ctx.business.id,
      name: 'Queue Order High',
      createdAt: minutesFromNow(-40),
      priorityScore: 40,
      followUpAt: minutesFromNow(180),
    });

    const dueSoonLead = await createQueueLead({
      businessId: ctx.business.id,
      name: 'Queue Order Due Soon',
      createdAt: minutesFromNow(-30),
      priorityScore: 12,
      followUpAt: minutesFromNow(10),
    });

    const newestLead = await createQueueLead({
      businessId: ctx.business.id,
      name: 'Queue Order Newest',
      createdAt: minutesFromNow(-5),
      priorityScore: 11,
      followUpAt: minutesFromNow(120),
    });

    const res = await request(app).get('/api/admin/action-queue').set(auth());
    const relevantIds = res.body
      .filter((item) => item.leadName.startsWith('Queue Order '))
      .map((item) => item.leadId);

    expect(res.status).toBe(200);
    expect(relevantIds).toEqual([
      overdueLead.id,
      highPriorityLead.id,
      dueSoonLead.id,
      newestLead.id,
    ]);
  });
});
