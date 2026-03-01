'use strict';

const request = require('supertest');
const app = require('../app');
const { createTestContext } = require('./_testHelpers');

describe('Services', () => {
  let ctx;
  let token;
  let serviceId;

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

  it('POST /api/services - returns 201 with id', async () => {
    const res = await request(app)
      .post('/api/services')
      .set(auth())
      .send({ title: 'JEE Foundation Batch', description: '6-month prep', priceInr: 15000 });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.title).toBe('JEE Foundation Batch');
    expect(res.body.priceInr).toBe(15000);
    serviceId = res.body.id;
  });

  it('GET /api/services - includes the created service', async () => {
    const res = await request(app).get('/api/services').set(auth());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((s) => s.id === serviceId)).toBe(true);
  });

  it('PATCH /api/services/:id - updates priceInr; list reflects change', async () => {
    const patch = await request(app)
      .patch(`/api/services/${serviceId}`)
      .set(auth())
      .send({ priceInr: 18000 });

    expect(patch.status).toBe(200);
    expect(patch.body.updated).toBe(true);

    const list = await request(app).get('/api/services').set(auth());
    const svc = list.body.find((s) => s.id === serviceId);
    expect(svc.priceInr).toBe(18000);
  });

  it('DELETE /api/services/:id - returns 204; service gone from list', async () => {
    const del = await request(app).delete(`/api/services/${serviceId}`).set(auth());
    expect(del.status).toBe(204);

    const list = await request(app).get('/api/services').set(auth());
    expect(list.body.some((s) => s.id === serviceId)).toBe(false);
  });

  it('GET /api/services - returns 401 without token', async () => {
    const res = await request(app).get('/api/services');
    expect(res.status).toBe(401);
  });
});
