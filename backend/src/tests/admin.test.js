'use strict';

const request = require('supertest');
const app = require('../app');
const { createTestContext } = require('./_testHelpers');

describe('Admin API', () => {
  let ctx;
  let token;

  beforeAll(async () => {
    ctx = await createTestContext();

    const res = await request(app)
      .post('/api/admin/login')
      .send({ businessSlug: ctx.slug, email: ctx.email, password: ctx.password });

    token = res.body.token;
  }, 15000);

  afterAll(async () => {
    await ctx.cleanup();
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
