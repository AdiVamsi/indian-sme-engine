'use strict';

const { PrismaClient } = require('@prisma/client');
const request = require('supertest');

const app = require('../app');
const { createTestContext, installLlmFetchMock } = require('./_testHelpers');

const prisma = new PrismaClient();

describe('Activation proof flow', () => {
  let ctx;
  let adminToken;
  let superadminToken;
  let restoreFetch;

  beforeAll(async () => {
    restoreFetch = installLlmFetchMock();
    ctx = await createTestContext();

    const adminLogin = await request(app)
      .post('/api/admin/login')
      .send({ businessSlug: ctx.slug, email: ctx.email, password: ctx.password });
    adminToken = adminLogin.body.token;

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

  const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });
  const superAuth = () => ({ Authorization: `Bearer ${superadminToken}` });

  it('runs activation proof through the real pipeline without polluting operational surfaces', async () => {
    const activate = await request(app)
      .post('/api/admin/activate')
      .set(adminAuth());

    expect(activate.status).toBe(200);
    expect(typeof activate.body.testMessage).toBe('string');
    expect(activate.body.testMessage.length).toBeGreaterThan(0);

    const proof = await request(app)
      .post('/api/admin/activate/proof')
      .set(adminAuth())
      .send({ message: activate.body.testMessage });

    expect(proof.status).toBe(200);
    expect(proof.body).toEqual(expect.objectContaining({
      leadId: expect.any(String),
      tags: expect.any(Array),
      priorityScore: expect.any(Number),
    }));

    const lead = await prisma.lead.findUnique({
      where: { id: proof.body.leadId },
      select: {
        id: true,
        businessId: true,
        isActivationTest: true,
      },
    });

    expect(lead).toEqual(expect.objectContaining({
      id: proof.body.leadId,
      businessId: ctx.business.id,
      isActivationTest: true,
    }));

    const business = await prisma.business.findUnique({
      where: { id: ctx.business.id },
      select: { stage: true },
    });
    expect(business.stage).toBe('LEADS_ACTIVE');

    const activities = await prisma.leadActivity.findMany({
      where: { leadId: proof.body.leadId },
      orderBy: { createdAt: 'asc' },
    });
    expect(activities.some((item) => item.type === 'AGENT_CLASSIFIED')).toBe(true);
    expect(activities.some((item) => item.type === 'AGENT_PRIORITIZED')).toBe(true);

    const dashboard = await request(app)
      .get('/api/admin/dashboard')
      .set(adminAuth());
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.totalLeads).toBe(0);
    expect(dashboard.body.newLeads).toBe(0);

    const adminLeads = await request(app)
      .get('/api/admin/leads')
      .set(adminAuth());
    expect(adminLeads.status).toBe(200);
    expect(adminLeads.body.find((item) => item.id === proof.body.leadId)).toBeUndefined();

    const hiddenActivity = await request(app)
      .get(`/api/admin/leads/${proof.body.leadId}/activity`)
      .set(adminAuth());
    expect(hiddenActivity.status).toBe(404);

    const byDay = await request(app)
      .get('/api/admin/leads/by-day?days=7')
      .set(adminAuth());
    expect(byDay.status).toBe(200);
    expect(byDay.body.reduce((sum, row) => sum + row.count, 0)).toBe(0);

    const queue = await request(app)
      .get('/api/admin/action-queue')
      .set(adminAuth());
    expect(queue.status).toBe(200);
    expect(queue.body.find((item) => item.leadId === proof.body.leadId)).toBeUndefined();

    const overview = await request(app)
      .get('/api/superadmin/overview')
      .set(superAuth());
    expect(overview.status).toBe(200);
    expect(overview.body.leads).toBe(0);
    expect(overview.body.logsToday).toBe(0);

    const superLeads = await request(app)
      .get('/api/superadmin/leads')
      .set(superAuth());
    expect(superLeads.status).toBe(200);
    expect(superLeads.body.find((item) => item.id === proof.body.leadId)).toBeUndefined();

    const logs = await request(app)
      .get('/api/superadmin/logs')
      .set(superAuth());
    expect(logs.status).toBe(200);
    expect(logs.body.find((item) => item.lead?.id === proof.body.leadId)).toBeUndefined();

    const analytics = await request(app)
      .get('/api/superadmin/analytics')
      .set(superAuth());
    expect(analytics.status).toBe(200);
    expect(analytics.body.leadSignals.totalLeads).toBe(0);
    expect(analytics.body.growthMetrics.generatingLeads).toBe(0);
    expect(analytics.body.growthMetrics.activationRate).toBe(0);
  });
});
