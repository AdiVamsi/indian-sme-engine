'use strict';

const request = require('supertest');
const app = require('../app');
const { createTestContext } = require('./_testHelpers');

describe('Auth', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await createTestContext();
  }, 15000);

  afterAll(async () => {
    await ctx.cleanup();
  });

  describe('POST /api/auth/login', () => {
    it('returns 200 with token on valid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ businessSlug: ctx.slug, email: ctx.email, password: ctx.password });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user.email).toBe(ctx.email);
      expect(res.body.business.slug).toBe(ctx.slug);
    });

    it('returns 401 on wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ businessSlug: ctx.slug, email: ctx.email, password: 'wrongpass' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    });

    it('returns 400 on missing fields', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: ctx.email });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });
});
