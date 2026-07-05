'use strict';

const jwt = require('jsonwebtoken');
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

    it('accepts mixed-case slug and email input', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          businessSlug: ctx.slug.toUpperCase(),
          email: ctx.email.toUpperCase(),
          password: ctx.password,
        });

      expect(res.status).toBe(200);
      expect(res.body.business.slug).toBe(ctx.slug);
      expect(res.body.user.email).toBe(ctx.email);
    });

    it('returns 400 on missing fields', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: ctx.email });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('authenticate middleware', () => {
    let validToken;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ businessSlug: ctx.slug, email: ctx.email, password: ctx.password });
      validToken = res.body.token;
    });

    it('returns 401 with no Authorization header', async () => {
      const res = await request(app).get('/api/me');
      expect(res.status).toBe(401);
    });

    it('returns 401 with a malformed token', async () => {
      const res = await request(app)
        .get('/api/me')
        .set({ Authorization: 'Bearer not-a-real-jwt' });

      expect(res.status).toBe(401);
    });

    it('returns 401 with a token signed with the wrong secret', async () => {
      const tamperedToken = jwt.sign(
        { userId: 'fake', businessId: 'fake', role: 'OWNER' },
        'a-completely-different-secret'
      );

      const res = await request(app)
        .get('/api/me')
        .set({ Authorization: `Bearer ${tamperedToken}` });

      expect(res.status).toBe(401);
    });

    it('returns 401 with an expired token', async () => {
      const decoded = jwt.decode(validToken);
      const expiredToken = jwt.sign(
        { userId: decoded.userId, businessId: decoded.businessId, role: decoded.role },
        process.env.JWT_SECRET,
        { expiresIn: -10 }
      );

      const res = await request(app)
        .get('/api/me')
        .set({ Authorization: `Bearer ${expiredToken}` });

      expect(res.status).toBe(401);
    });

    it('returns 200 with a valid token', async () => {
      const res = await request(app)
        .get('/api/me')
        .set({ Authorization: `Bearer ${validToken}` });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('businessId');
    });
  });
});
