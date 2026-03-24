'use strict';

const { PrismaClient } = require('@prisma/client');
const request = require('supertest');
const app = require('../app');
const { prisma: sharedPrisma } = require('../lib/prisma');
const { createTestContext, installLlmFetchMock } = require('./_testHelpers');

describe('Leads', () => {
  const prisma = new PrismaClient();
  let ctx;
  let token;
  let leadId;
  let restoreFetch;

  beforeAll(async () => {
    restoreFetch = installLlmFetchMock();
    ctx = await createTestContext();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ businessSlug: ctx.slug, email: ctx.email, password: ctx.password });

    token = res.body.token;
  }, 15000);

  afterAll(async () => {
    restoreFetch();
    await ctx.cleanup();
    await prisma.$disconnect();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('POST /api/leads - returns 201 with id and status NEW', async () => {
    const res = await request(app)
      .post('/api/leads')
      .set(auth())
      .send({ name: 'Test Lead', phone: '+91 88888 00001' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.status).toBe('NEW');
    leadId = res.body.id;
  });

  it('GET /api/leads - includes the created lead', async () => {
    const res = await request(app).get('/api/leads').set(auth());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((l) => l.id === leadId)).toBe(true);
  });

  it('PATCH /api/leads/:id/status - updates status; list reflects change', async () => {
    const patch = await request(app)
      .patch(`/api/leads/${leadId}/status`)
      .set(auth())
      .send({ status: 'CONTACTED' });

    expect(patch.status).toBe(200);
    expect(patch.body.updated).toBe(true);

    const list = await request(app).get('/api/leads').set(auth());
    const lead = list.body.find((l) => l.id === leadId);
    expect(lead.status).toBe('CONTACTED');
  });

  it('POST /api/leads/:id/actions - logs operator actions and returns refreshed drawer payload', async () => {
    const callbackAt = new Date('2026-03-24T12:30:00.000Z');
    const created = await request(app)
      .post('/api/leads')
      .set(auth())
      .send({ name: 'Operator Lead', phone: '+91 88888 00031', message: 'Please call me for fee details' });

    const res = await request(app)
      .post(`/api/leads/${created.body.id}/actions`)
      .set(auth())
      .send({
        action: 'SCHEDULE_CALLBACK',
        callbackTime: '24 Mar 2026, 6:00 pm',
        callbackAt: callbackAt.toISOString(),
        note: 'Parent asked for an evening callback.',
      });

    expect(res.status).toBe(200);
    expect(res.body.lead.id).toBe(created.body.id);

    const scheduled = res.body.activities.find(
      (activity) => activity.type === 'FOLLOW_UP_SCHEDULED' && activity.metadata?.reason === 'OPERATOR_CALLBACK_SCHEDULED'
    );

    expect(scheduled).toBeTruthy();
    expect(scheduled.metadata.callbackTime).toBe('24 Mar 2026, 6:00 pm');
    expect(scheduled.metadata.callbackAt).toBe(callbackAt.toISOString());
    expect(scheduled.message).toContain('Parent asked for an evening callback.');

    const list = await request(app).get('/api/leads').set(auth());
    const listedLead = list.body.find((item) => item.id === created.body.id);
    expect(listedLead.callbackTime).toBe('24 Mar 2026, 6:00 pm');
    expect(listedLead.callbackAt).toBe(callbackAt.toISOString());
    expect(listedLead.callbackScheduledAt).toEqual(expect.any(String));
  });

  it('POST /api/leads/:id/actions - saves a lightweight operator note', async () => {
    const created = await request(app)
      .post('/api/leads')
      .set(auth())
      .send({ name: 'Notes Lead', phone: '+91 88888 00035', message: 'Need Class 11 fee details' });

    const res = await request(app)
      .post(`/api/leads/${created.body.id}/actions`)
      .set(auth())
      .send({
        action: 'ADD_NOTE',
        note: 'Parent requested evening call and prefers Hindi.',
      });

    expect(res.status).toBe(200);

    const noteActivity = res.body.activities.find(
      (activity) => activity.metadata?.reason === 'OPERATOR_NOTE_ADDED'
    );

    expect(noteActivity).toBeTruthy();
    expect(noteActivity.metadata.operatorNote).toBe('Parent requested evening call and prefers Hindi.');
    expect(noteActivity.message).toContain('Operator note added');
  });

  it('POST /api/leads/:id/actions - snoozes a lead for a fixed number of days', async () => {
    const created = await request(app)
      .post('/api/leads')
      .set(auth())
      .send({ name: 'Snooze Lead', phone: '+91 88888 00037', message: 'Please call back later this week' });

    const res = await request(app)
      .post(`/api/leads/${created.body.id}/actions`)
      .set(auth())
      .send({
        action: 'SNOOZE',
        snoozeDays: 3,
      });

    expect(res.status).toBe(200);
    expect(res.body.lead.id).toBe(created.body.id);
    expect(res.body.lead.snoozedUntil).toEqual(expect.any(String));

    const snoozeActivity = res.body.activities.find(
      (activity) => activity.metadata?.reason === 'OPERATOR_SNOOZED_QUEUE'
    );

    expect(snoozeActivity).toBeTruthy();
    expect(snoozeActivity.metadata.snoozeDays).toBe(3);
    expect(snoozeActivity.metadata.snoozedUntil).toEqual(expect.any(String));

    const dbLead = await prisma.lead.findUnique({ where: { id: created.body.id } });
    expect(dbLead.snoozedUntil).toEqual(expect.any(Date));
    expect(dbLead.snoozedUntil.getTime()).toBeGreaterThan(Date.now() + (2.5 * 24 * 60 * 60 * 1000));
  });

  it('POST /api/leads/:id/actions - falls back to activity-based snooze when snoozedUntil persistence is unavailable', async () => {
    const created = await request(app)
      .post('/api/leads')
      .set(auth())
      .send({ name: 'Compat Snooze Lead', phone: '+91 88888 00038', message: 'Please follow up next week' });

    const actualTransaction = sharedPrisma.$transaction.bind(sharedPrisma);
    let shouldFailOnce = true;
    const transactionSpy = jest.spyOn(sharedPrisma, '$transaction').mockImplementation(async (...args) => {
      if (shouldFailOnce) {
        shouldFailOnce = false;
        throw new Error("The column 'Lead.snoozedUntil' does not exist in the current database.");
      }

      return actualTransaction(...args);
    });

    try {
      const res = await request(app)
        .post(`/api/leads/${created.body.id}/actions`)
        .set(auth())
        .send({
          action: 'SNOOZE',
          snoozeDays: 1,
        });

      expect(res.status).toBe(200);
      expect(res.body.lead.id).toBe(created.body.id);
      expect(res.body.lead.snoozedUntil).toEqual(expect.any(String));

      const snoozeActivity = res.body.activities.find(
        (activity) => activity.metadata?.reason === 'OPERATOR_SNOOZED_QUEUE'
      );

      expect(snoozeActivity).toBeTruthy();
      expect(snoozeActivity.metadata.snoozeDays).toBe(1);
      expect(snoozeActivity.metadata.snoozedUntil).toEqual(expect.any(String));
    } finally {
      transactionSpy.mockRestore();
    }
  });

  it('POST /api/leads/:id/actions - rejects empty operator notes', async () => {
    const created = await request(app)
      .post('/api/leads')
      .set(auth())
      .send({ name: 'Invalid Note Lead', phone: '+91 88888 00036' });

    const res = await request(app)
      .post(`/api/leads/${created.body.id}/actions`)
      .set(auth())
      .send({
        action: 'ADD_NOTE',
        note: '   ',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors.note).toContain('Operator note is required.');
  });

  it('POST /api/leads/:id/actions - can close a WhatsApp handoff and move the lead forward', async () => {
    const lead = await prisma.lead.create({
      data: {
        businessId: ctx.business.id,
        name: 'WhatsApp Lead',
        phone: '+91 88888 00041',
        message: 'Please arrange a callback after school hours',
      },
    });

    await prisma.leadActivity.createMany({
      data: [
        {
          leadId: lead.id,
          type: 'AGENT_CLASSIFIED',
          message: 'Lead classified as CALLBACK_REQUEST',
          metadata: {
            tags: ['CALLBACK_REQUEST'],
            bestCategory: 'CALLBACK_REQUEST',
            source: 'whatsapp',
          },
        },
        {
          leadId: lead.id,
          type: 'AUTOMATION_ALERT',
          message: 'WhatsApp reply sent',
          metadata: {
            channel: 'whatsapp',
            direction: 'outbound',
            messageText: 'Please share the student class and preferred call time.',
            replyIntent: 'CALLBACK_REQUEST',
            conversationState: {
              version: 1,
              channel: 'whatsapp',
              flowIntent: 'CALLBACK_REQUEST',
              stage: 'HANDOFF_QUEUED',
              pendingField: null,
              collected: {
                studentClass: 'Class 11',
                preferredCallTime: 'After 6 PM',
              },
              status: 'handoff',
            },
          },
        },
      ],
    });

    const res = await request(app)
      .post(`/api/leads/${lead.id}/actions`)
      .set(auth())
      .send({
        action: 'MARK_HANDOFF_COMPLETE',
        note: 'Counsellor has taken over on phone.',
      });

    expect(res.status).toBe(200);
    expect(res.body.lead.status).toBe('QUALIFIED');
    expect(res.body.whatsappConversation.conversationStatus).toBe('closed');

    const completed = res.body.activities.find(
      (activity) => activity.metadata?.reason === 'OPERATOR_HANDOFF_COMPLETED'
    );

    expect(completed).toBeTruthy();
    expect(completed.metadata.conversationState.status).toBe('closed');
  });

  it('GET /api/leads - includes handoff-ready state for active WhatsApp leads', async () => {
    const lead = await prisma.lead.create({
      data: {
        businessId: ctx.business.id,
        name: 'Handoff List Lead',
        phone: '+91 88888 00051',
        message: 'Need a callback after tuition',
      },
    });

    await prisma.leadActivity.createMany({
      data: [
        {
          leadId: lead.id,
          type: 'AGENT_CLASSIFIED',
          message: 'Lead classified as CALLBACK_REQUEST',
          metadata: {
            tags: ['CALLBACK_REQUEST'],
            bestCategory: 'CALLBACK_REQUEST',
            source: 'whatsapp',
          },
        },
        {
          leadId: lead.id,
          type: 'AUTOMATION_ALERT',
          message: 'WhatsApp reply sent',
          metadata: {
            channel: 'whatsapp',
            direction: 'outbound',
            conversationState: {
              status: 'handoff',
            },
          },
        },
      ],
    });

    const res = await request(app).get('/api/leads').set(auth());

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: lead.id,
          conversationStatus: 'handoff',
          handoffReady: true,
        }),
      ])
    );
  });

  it('DELETE /api/leads/:id - returns 204; lead gone from list', async () => {
    const del = await request(app).delete(`/api/leads/${leadId}`).set(auth());
    expect(del.status).toBe(204);

    const list = await request(app).get('/api/leads').set(auth());
    expect(list.body.some((l) => l.id === leadId)).toBe(false);
  });

  it('GET /api/leads?status=NEW - filters by status', async () => {
    const res = await request(app).get('/api/leads?status=NEW').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.every((l) => l.status === 'NEW')).toBe(true);
  });

  it('GET /api/leads - returns 401 without token', async () => {
    const res = await request(app).get('/api/leads');
    expect(res.status).toBe(401);
  });
});
