'use strict';

const request = require('supertest');
const app = require('../app');
const { createTestContext } = require('./_testHelpers');

describe('Appointments', () => {
  let ctx;
  let token;
  let appointmentId;

  beforeAll(async () => {
    ctx = await createTestContext();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ businessSlug: ctx.slug, email: ctx.email, password: ctx.password });

    token = res.body.token;
  }, 15000);

  afterAll(async () => {
    await ctx.cleanup();
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
    appointmentId = res.body.id;
  });

  it('GET /api/appointments - includes the created appointment', async () => {
    const res = await request(app).get('/api/appointments').set(auth());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((a) => a.id === appointmentId)).toBe(true);
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
