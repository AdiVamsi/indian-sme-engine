'use strict';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');

const app = require('../app');
const { createTestContext } = require('./_testHelpers');

const prisma = new PrismaClient();

describe('Appointments', () => {
  let ctx;
  let otherCtx;
  let token;
  let appointmentId;
  let leadId;

  beforeAll(async () => {
    ctx = await createTestContext();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ businessSlug: ctx.slug, email: ctx.email, password: ctx.password });

    token = res.body.token;

    const lead = await prisma.lead.create({
      data: {
        businessId: ctx.business.id,
        name: 'Lead Linked Student',
        phone: '+91 98765 22222',
        email: 'linked@example.test',
        message: 'Please book a counselling appointment.',
      },
    });

    leadId = lead.id;
  }, 15000);

  afterAll(async () => {
    if (otherCtx) {
      await otherCtx.cleanup();
    }
    await ctx.cleanup();
    await prisma.$disconnect();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('POST /api/appointments - returns 201 with id and status NEW', async () => {
    const res = await request(app)
      .post('/api/appointments')
      .set(auth())
      .send({ customerName: 'Rahul Verma', phone: '+91 98000 11111', scheduledAt: '2026-04-01T10:00:00.000Z' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.status).toBe('NEW');
    expect(res.body.customerName).toBe('Rahul Verma');
    expect(res.body.leadId).toBeNull();
    appointmentId = res.body.id;
  });

  it('GET /api/appointments - includes the created appointment', async () => {
    const res = await request(app).get('/api/appointments').set(auth());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((a) => a.id === appointmentId)).toBe(true);
  });

  it('POST /api/leads/:id/appointments - creates a tenant-safe linked appointment and records lead activity', async () => {
    const res = await request(app)
      .post(`/api/leads/${leadId}/appointments`)
      .set(auth())
      .send({
        scheduledAt: '2026-04-02T11:30:00.000Z',
        notes: 'Parent requested an in-person counselling slot.',
      });

    expect(res.status).toBe(201);
    expect(res.body.leadId).toBe(leadId);
    expect(res.body.customerName).toBe('Lead Linked Student');
    expect(res.body.phone).toBe('+91 98765 22222');
    expect(res.body.lead).toEqual(expect.objectContaining({
      id: leadId,
      name: 'Lead Linked Student',
    }));

    const list = await request(app).get('/api/appointments').set(auth());
    const linked = list.body.find((a) => a.id === res.body.id);
    expect(linked).toEqual(expect.objectContaining({
      id: res.body.id,
      leadId,
      customerName: 'Lead Linked Student',
    }));
    expect(linked.lead).toEqual(expect.objectContaining({
      id: leadId,
      name: 'Lead Linked Student',
    }));

    const activity = await request(app)
      .get(`/api/leads/${leadId}/activity`)
      .set(auth());

    expect(activity.status).toBe(200);
    expect(activity.body.appointments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: res.body.id,
          leadId,
        }),
      ])
    );
    expect(activity.body.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'APPOINTMENT_CREATED',
          metadata: expect.objectContaining({
            appointmentId: res.body.id,
            appointmentStatus: 'NEW',
          }),
        }),
      ])
    );
  });

  it('POST /api/leads/:id/appointments - returns 404 for a lead from another tenant', async () => {
    otherCtx = await createTestContext();
    const otherLead = await prisma.lead.create({
      data: {
        businessId: otherCtx.business.id,
        name: 'Other Tenant Lead',
        phone: '+91 99999 00000',
      },
    });

    const res = await request(app)
      .post(`/api/leads/${otherLead.id}/appointments`)
      .set(auth())
      .send({ scheduledAt: '2026-04-03T09:00:00.000Z' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Lead not found');
  });

  it('PATCH /api/appointments/:id/status - updates status; list reflects change', async () => {
    const patch = await request(app)
      .patch(`/api/appointments/${appointmentId}/status`)
      .set(auth())
      .send({ status: 'CONFIRMED' });

    expect(patch.status).toBe(200);
    expect(patch.body.updated).toBe(true);

    const list = await request(app).get('/api/appointments').set(auth());
    const appt = list.body.find((a) => a.id === appointmentId);
    expect(appt.status).toBe('CONFIRMED');
  });

  it('DELETE /api/appointments/:id - returns 204; appointment gone from list', async () => {
    const del = await request(app).delete(`/api/appointments/${appointmentId}`).set(auth());
    expect(del.status).toBe(204);

    const list = await request(app).get('/api/appointments').set(auth());
    expect(list.body.some((a) => a.id === appointmentId)).toBe(false);
  });

  it('GET /api/appointments - returns 401 without token', async () => {
    const res = await request(app).get('/api/appointments');
    expect(res.status).toBe(401);
  });
});
