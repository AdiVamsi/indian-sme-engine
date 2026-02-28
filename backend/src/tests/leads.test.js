'use strict';

const request = require('supertest');
const app = require('../app');
const { createTestContext } = require('./_testHelpers');

describe('Leads', () => {
  let ctx;
  let token;
  let leadId;

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
