'use strict';

const { PrismaClient } = require('@prisma/client');
const request = require('supertest');
const app = require('../app');
const { createTestContext, installLlmFetchMock } = require('./_testHelpers');

const prisma = new PrismaClient();

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
    await prisma.$disconnect();
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

  it('GET /api/superadmin/logs returns lead activity messages without querying missing fields', async () => {
    const created = await request(app)
      .post('/api/leads')
      .set({ Authorization: `Bearer ${businessToken}` })
      .send({ name: 'Superadmin Log Lead', phone: '+91 99999 45555', message: 'Need demo class details.' });

    expect(created.status).toBe(201);

    const res = await request(app)
      .get('/api/superadmin/logs')
      .set({ Authorization: `Bearer ${superadminToken}` });

    expect(res.status).toBe(200);
    const row = res.body.find((item) => item.lead?.id === created.body.id);
    expect(row).toBeTruthy();
    expect(typeof row.note).toBe('string');
    expect(row.note.length).toBeGreaterThan(0);
  });

  it('GET /api/superadmin/analytics uses the current lead status enum values', async () => {
    await prisma.leadActivity.deleteMany();
    await prisma.lead.deleteMany();

    await prisma.lead.createMany({
      data: [
        { businessId: ctx.business.id, name: 'New Lead', phone: '+91 90000 00001', status: 'NEW' },
        { businessId: ctx.business.id, name: 'Contacted Lead', phone: '+91 90000 00002', status: 'CONTACTED' },
        { businessId: ctx.business.id, name: 'Qualified Lead', phone: '+91 90000 00003', status: 'QUALIFIED' },
        { businessId: ctx.business.id, name: 'Won Lead', phone: '+91 90000 00004', status: 'WON' },
        { businessId: ctx.business.id, name: 'Lost Lead', phone: '+91 90000 00005', status: 'LOST' },
      ],
    });

    const res = await request(app)
      .get('/api/superadmin/analytics')
      .set({ Authorization: `Bearer ${superadminToken}` });

    expect(res.status).toBe(200);
    expect(res.body.leadSignals.totalLeads).toBeGreaterThanOrEqual(5);
    expect(res.body.leadSignals.pctContacted).toBe(80);
    expect(res.body.leadSignals.pctQualifiedOrWon).toBe(40);
  });
});
