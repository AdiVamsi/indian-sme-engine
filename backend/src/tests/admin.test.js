'use strict';

const { PrismaClient } = require('@prisma/client');
const request = require('supertest');
const app = require('../app');
const { createTestContext } = require('./_testHelpers');

describe('Admin API', () => {
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

  /* ── Login ── */
  it('POST /api/admin/login - returns token, user, business', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ businessSlug: ctx.slug, email: ctx.email, password: ctx.password });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('user');
    expect(res.body).toHaveProperty('business');
    expect(res.body.business.slug).toBe(ctx.slug);
  });

  it('POST /api/admin/login - returns 401 with wrong password', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ businessSlug: ctx.slug, email: ctx.email, password: 'wrongpassword' });

    expect(res.status).toBe(401);
  });

  it('POST /api/admin/login - returns 400 with missing fields', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ email: ctx.email });

    expect(res.status).toBe(400);
  });

  /* ── Dashboard ── */
  it('GET /api/admin/dashboard - returns summary with correct keys', async () => {
    const res = await request(app).get('/api/admin/dashboard').set(auth());

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalLeads');
    expect(res.body).toHaveProperty('newLeads');
    expect(res.body).toHaveProperty('totalAppointments');
    expect(res.body).toHaveProperty('upcomingAppointments');
    expect(res.body).toHaveProperty('totalServices');
    expect(res.body).toHaveProperty('totalTestimonials');
  });

  it('GET /api/admin/dashboard - returns 401 without token', async () => {
    const res = await request(app).get('/api/admin/dashboard');
    expect(res.status).toBe(401);
  });

  /* ── Leads ── */
  it('GET /api/admin/leads - returns an array', async () => {
    const res = await request(app).get('/api/admin/leads').set(auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/admin/leads - preserves the lead source for WhatsApp leads after reload', async () => {
    const lead = await prisma.lead.create({
      data: {
        businessId: ctx.business.id,
        name: 'WhatsApp Admin Lead',
        phone: '+91 99999 70001',
        message: 'fees kitni hai',
      },
    });

    await prisma.leadActivity.createMany({
      data: [
        {
          leadId: lead.id,
          type: 'AGENT_CLASSIFIED',
          message: 'Lead classified as FEE_ENQUIRY',
          metadata: {
            source: 'whatsapp',
            bestCategory: 'FEE_ENQUIRY',
            tags: ['FEE_ENQUIRY'],
          },
        },
        {
          leadId: lead.id,
          type: 'AGENT_PRIORITIZED',
          message: 'Priority score assigned: 18 (NORMAL)',
          metadata: {
            priorityScore: 18,
            priorityLabel: 'NORMAL',
          },
        },
      ],
    });

    const res = await request(app).get('/api/admin/leads').set(auth());

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: lead.id,
          source: 'whatsapp',
          priority: 'NORMAL',
          priorityScore: 18,
          tags: ['FEE_ENQUIRY'],
          hasClassification: true,
          hasPrioritization: true,
        }),
      ])
    );
  });

  it('GET /api/admin/leads - returns the latest scheduled callback details for operator follow-up', async () => {
    const callbackAt = '2026-03-14T12:30:00.000Z';
    const lead = await prisma.lead.create({
      data: {
        businessId: ctx.business.id,
        name: 'Callback Admin Lead',
        phone: '+91 99999 70011',
        message: 'Please call in the evening',
      },
    });

    await prisma.leadActivity.createMany({
      data: [
        {
          leadId: lead.id,
          type: 'AGENT_CLASSIFIED',
          message: 'Lead classified as CALLBACK_REQUEST',
          metadata: {
            source: 'whatsapp',
            bestCategory: 'CALLBACK_REQUEST',
            tags: ['CALLBACK_REQUEST'],
          },
        },
        {
          leadId: lead.id,
          type: 'AGENT_PRIORITIZED',
          message: 'Priority score assigned: 20 (NORMAL)',
          metadata: {
            priorityScore: 20,
            priorityLabel: 'NORMAL',
          },
        },
        {
          leadId: lead.id,
          type: 'FOLLOW_UP_SCHEDULED',
          message: 'Callback scheduled for Today 6 PM.',
          metadata: {
            reason: 'OPERATOR_CALLBACK_SCHEDULED',
            callbackTime: 'Today 6 PM',
            callbackAt,
          },
        },
      ],
    });

    const res = await request(app).get('/api/admin/leads').set(auth());

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: lead.id,
          callbackTime: 'Today 6 PM',
          callbackAt,
          callbackScheduledAt: expect.any(String),
        }),
      ])
    );
  });

  it('GET /api/admin/leads - marks handoff-ready WhatsApp leads for operator attention', async () => {
    const lead = await prisma.lead.create({
      data: {
        businessId: ctx.business.id,
        name: 'Handoff Admin Lead',
        phone: '+91 99999 70021',
        message: 'Please call after 5 PM',
      },
    });

    await prisma.leadActivity.createMany({
      data: [
        {
          leadId: lead.id,
          type: 'AGENT_CLASSIFIED',
          message: 'Lead classified as CALLBACK_REQUEST',
          metadata: {
            source: 'whatsapp',
            bestCategory: 'CALLBACK_REQUEST',
            tags: ['CALLBACK_REQUEST'],
          },
        },
        {
          leadId: lead.id,
          type: 'AUTOMATION_ALERT',
          message: 'WhatsApp handoff ready',
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

    const res = await request(app).get('/api/admin/leads').set(auth());

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

  it('GET /api/admin/leads - surfaces failed outbound WhatsApp replies for operator attention', async () => {
    const lead = await prisma.lead.create({
      data: {
        businessId: ctx.business.id,
        name: 'WhatsApp Failure Lead',
        phone: '+91 99999 70031',
        message: 'Need admission details',
      },
    });

    await prisma.leadActivity.createMany({
      data: [
        {
          leadId: lead.id,
          type: 'AGENT_CLASSIFIED',
          message: 'Lead classified as ADMISSION',
          metadata: {
            source: 'whatsapp',
            bestCategory: 'ADMISSION',
            tags: ['ADMISSION'],
          },
        },
        {
          leadId: lead.id,
          type: 'AUTOMATION_ALERT',
          message: 'WhatsApp reply failed: Meta access token expired',
          metadata: {
            channel: 'whatsapp',
            direction: 'outbound',
            deliveryStatus: 'failed',
            failureTitle: 'Meta access token expired',
            failureDetail: 'Reconnect or refresh the Meta WhatsApp access token.',
            failureCategory: 'META_TOKEN_EXPIRED',
            operatorActionRequired: 'Refresh the Meta access token and follow up manually.',
            conversationState: {
              status: 'send_failed',
            },
          },
        },
      ],
    });

    const res = await request(app).get('/api/admin/leads').set(auth());

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: lead.id,
          conversationStatus: 'send_failed',
          handoffReady: false,
          whatsappDeliveryStatus: 'failed',
          whatsappNeedsAttention: true,
          whatsappFailureTitle: 'Meta access token expired',
          whatsappFailureCategory: 'META_TOKEN_EXPIRED',
          whatsappFailureDetail: 'Reconnect or refresh the Meta WhatsApp access token.',
          whatsappOperatorActionRequired: 'Refresh the Meta access token and follow up manually.',
        }),
      ])
    );
  });

  it('GET /api/admin/leads - returns 401 without token', async () => {
    const res = await request(app).get('/api/admin/leads');
    expect(res.status).toBe(401);
  });

  /* ── Appointments ── */
  it('GET /api/admin/appointments - returns an array', async () => {
    const res = await request(app).get('/api/admin/appointments').set(auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/admin/appointments - includes linked lead details when an appointment is tied to a lead', async () => {
    const lead = await prisma.lead.create({
      data: {
        businessId: ctx.business.id,
        name: 'Appointment Linked Lead',
        phone: '+91 99999 70111',
      },
    });

    const appointment = await prisma.appointment.create({
      data: {
        businessId: ctx.business.id,
        leadId: lead.id,
        customerName: lead.name,
        phone: lead.phone,
        scheduledAt: new Date('2026-04-05T11:00:00.000Z'),
      },
    });

    const res = await request(app).get('/api/admin/appointments').set(auth());

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: appointment.id,
          leadId: lead.id,
          lead: expect.objectContaining({
            id: lead.id,
            name: 'Appointment Linked Lead',
          }),
        }),
      ])
    );
  });

  /* ── Services ── */
  it('GET /api/admin/services - returns an array', async () => {
    const res = await request(app).get('/api/admin/services').set(auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  /* ── Testimonials ── */
  it('GET /api/admin/testimonials - returns an array', async () => {
    const res = await request(app).get('/api/admin/testimonials').set(auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
