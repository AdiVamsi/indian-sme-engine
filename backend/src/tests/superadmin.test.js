'use strict';

const request = require('supertest');
const app = require('../app');
const { createTestContext, installLlmFetchMock } = require('./_testHelpers');

describe('Superadmin API', () => {
  let ctx;
  let businessToken;
  let superadminToken;
  let restoreFetch;

  beforeAll(async () => {
    restoreFetch = installLlmFetchMock();
    ctx = await createTestContext();

    const login = await request(app)
      .post('/api/auth/login')
      .send({ businessSlug: ctx.slug, email: ctx.email, password: ctx.password });
    businessToken = login.body.token;

    const superLogin = await request(app)
      .post('/api/superadmin/login')
      .send({ password: process.env.SUPERADMIN_PASSWORD });
    superadminToken = superLogin.body.token;
  }, 15000);

  afterAll(async () => {
    restoreFetch();
    await ctx.cleanup();
  });

  it('GET /api/superadmin/leads includes the original lead message', async () => {
    const message = 'Need admission details and batch timing from tomorrow.';

    const created = await request(app)
      .post('/api/leads')
      .set({ Authorization: `Bearer ${businessToken}` })
      .send({ name: 'Superadmin Lead', phone: '+91 99999 44444', message });

    expect(created.status).toBe(201);

    const list = await request(app)
      .get('/api/superadmin/leads')
      .set({ Authorization: `Bearer ${superadminToken}` });

    expect(list.status).toBe(200);
    const row = list.body.find((lead) => lead.id === created.body.id);
    expect(row).toBeTruthy();
    expect(row.message).toBe(message);
  });
});
